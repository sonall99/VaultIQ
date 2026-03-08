import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  ingestDocument, ingestFile,
  bulkGenerate, generateSingle,
  deleteFromVectorStore,
  checkBackendHealth,
} from "../lib/gemini";
import { parseFileToText } from "../lib/fileParser";
import { exportTXT, exportCSV, exportDOCX, exportPDF } from "../lib/exporters";
import {
  saveDocument, deleteDocument,
  saveQuestionnaire, createRun, finalizeRun,
  saveAnswers, updateAnswer,
  getRuns, getRunWithAnswers,
  trackEvent, getAnalytics,
} from "../lib/db";

// ── Demo docs ─────────────────────────────────────────────
const DEMO_DOCS = [
  {
    id: "demo1", title: "VaultIQ Security & Encryption Policy",
    content: `VaultIQ Security Policy

VaultIQ uses AES-256 encryption to protect all sensitive financial data stored within the platform. 
All network communication is secured using TLS 1.3 encryption.

Access to production systems is restricted using role-based access control (RBAC). 
Multi-factor authentication is mandatory for all administrative accounts.

Security logs are monitored continuously by the security operations team to detect suspicious activities.`
  },
  {
    id: "demo2", title: "VaultIQ Regulatory Compliance Framework",
    content: `VaultIQ Compliance Framework

VaultIQ maintains compliance with major financial industry regulations including 
PCI-DSS, SOC 2 Type II, and ISO 27001 security standards.

The platform supports regulatory reporting workflows that help financial institutions 
prepare compliance documentation for audits and regulatory authorities.`
  },
  {
    id: "demo3", title: "VaultIQ Infrastructure Architecture",
    content: `VaultIQ Infrastructure Overview

VaultIQ operates on a cloud-native architecture hosted on AWS using multiple availability zones.

Critical services are deployed across redundant infrastructure to ensure high availability 
and fault tolerance.

Infrastructure monitoring is performed using automated monitoring tools that track system 
health, performance, and security alerts.`
  },
  {
    id: "demo4", title: "VaultIQ Data Residency & Privacy Policy",
    content: `VaultIQ Data Residency Policy

Customer financial data is stored in secure regional cloud environments.

VaultIQ supports data residency options that allow financial institutions to select 
specific geographic regions for storing sensitive financial information.

All data processing follows strict privacy protection guidelines.`
  },
  {
    id: "demo5", title: "VaultIQ Business Continuity & Disaster Recovery",
    content: `VaultIQ Business Continuity Plan

VaultIQ performs automated encrypted backups of all critical systems daily.

The platform maintains a Recovery Time Objective (RTO) of 4 hours and a Recovery Point 
Objective (RPO) of 1 hour to ensure minimal service disruption.`
  },
  {
    id: "demo6", title: "VaultIQ Customer Support & SLA",
    content: `VaultIQ Service Level Agreement

VaultIQ guarantees 99.95% uptime for enterprise customers.

Critical incidents are acknowledged within 30 minutes and resolved with priority by 
the engineering team.

Support is available 24/7 for enterprise clients through dedicated support channels.`
  },
];

const SAMPLE_Q= `Financial Vendor Security Assessment
Vendor: VaultIQ

1. What encryption standards are used to protect financial data?
2. Does VaultIQ support role-based access control for user access?
3. What regulatory compliance certifications does VaultIQ maintain?
4. What cloud infrastructure provider hosts the platform?
5. How does VaultIQ ensure high availability of its services?
6. What is the recovery time objective in the event of system failure?
7. Does VaultIQ provide regional data residency options?
8. How frequently are system backups performed?
9. What monitoring systems are used to detect security incidents?
10. What uptime SLA does VaultIQ guarantee for enterprise customers?`;

function parseQuestions(text) {
  return text.split("\n").map(l=>l.trim()).filter(Boolean).reduce((acc,line)=>{
    const m=line.match(/^(\d+)[.)]\s+(.+)/);
    if(m) acc.push({id:`q${m[1]}`,num:parseInt(m[1]),text:m[2]});
    return acc;
  },[]);
}

function suggestRunName(text, count=0) {
  const firstQuestion = text.split("\n")
    .map((l) => l.trim())
    .find((line) => /^(\d+)[.)]\s+(.+)/.test(line));
  const date = new Date().toLocaleDateString();
  if (!firstQuestion) return count ? `Questionnaire (${count} Qs) - ${date}` : "";
  const clean = firstQuestion.replace(/^(\d+)[.)]\s+/, "").replace(/[?.,:;]+$/g, "");
  const title = clean.slice(0, 36).trim();
  return `${title || "Questionnaire"} - ${date}`;
}

function normalizeDocName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveCitationDoc(citation, docs=[]) {
  const needle = normalizeDocName(citation);
  if (!needle) return null;

  let best = null;
  let bestScore = 0;
  const needleTokens = new Set(needle.split(" ").filter(t => t.length > 2));

  for (const doc of docs) {
    const title = normalizeDocName(doc.title);
    if (!title) continue;

    let score = 0;
    if (title === needle) score = 100;
    else if (title.includes(needle) || needle.includes(title)) score = 70;
    else {
      const overlap = title
        .split(" ")
        .filter(token => token.length > 2 && needleTokens.has(token)).length;
      score = overlap;
    }

    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }

  return bestScore >= 2 || bestScore >= 70 ? best : null;
}

function confBadge(score) {
  if(score>=0.75) return {label:"High",   color:"#22d3a0",bg:"rgba(34,211,160,0.1)",  dot:"#22d3a0"};
  if(score>=0.45) return {label:"Medium", color:"#f59e0b",bg:"rgba(245,158,11,0.1)",  dot:"#f59e0b"};
  if(score>0)     return {label:"Low",    color:"#f87171",bg:"rgba(248,113,113,0.1)", dot:"#f87171"};
  return                  {label:"N/A",   color:"#4b5563",bg:"rgba(75,85,99,0.1)",    dot:"#4b5563"};
}

function confidenceHint(label) {
  if (label === "High") return "This answer was generated using strong matches from the reference documents.";
  if (label === "Medium") return "Partial matches were found in the reference documents.";
  if (label === "Low") return "Limited supporting context was found in the reference documents.";
  return "No confidence signal is available for this answer.";
}

// ── NAV items ─────────────────────────────────────────────
const NAV = [
  { id:"docs",          icon:IconDocs,    label:"Reference Docs",  sub:"Upload & index" },
  { id:"questionnaire", icon:IconClip,    label:"Questionnaire",   sub:"Upload & parse"  },
  { id:"generate",      icon:IconZap,     label:"Generate",        sub:"Run AI pipeline" },
  { id:"review",        icon:IconEdit,    label:"Review & Export", sub:"Edit & download" },
  { id:"history",       icon:IconClock,   label:"History",         sub:"Past runs"       },
  { id:"analytics",     icon:IconChart,   label:"Analytics",       sub:"Usage stats"     },
];

// ── SVG Icons ─────────────────────────────────────────────
function IconDocs({size=16,color="currentColor"})   { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>; }
function IconClip({size=16,color="currentColor"})   { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>; }
function IconZap({size=16,color="currentColor"})    { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>; }
function IconEdit({size=16,color="currentColor"})   { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconClock({size=16,color="currentColor"})  { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconChart({size=16,color="currentColor"})  { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>; }
function IconUpload({size=16,color="currentColor"}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>; }
function IconTrash({size=14,color="currentColor"})  { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }
function IconRefresh({size=14,color="currentColor"}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function IconCheck({size=14,color="currentColor"})  { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IconX({size=14,color="currentColor"})      { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IconExport({size=14,color="currentColor"}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function IconInfo({size=12,color="currentColor"})   { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>; }
function IconChevron({size=12,color="currentColor"}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }

// ── Spinner ───────────────────────────────────────────────
function Spinner({size=20,color="var(--acc)"}) {
  return <div style={{width:size,height:size,border:`2px solid rgba(15,23,42,0.15)`,borderTop:`2px solid ${color}`,borderRadius:"50%",animation:"_spin .65s linear infinite",flexShrink:0}} />;
}

// ── CSS ───────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }

:root {
  --bg:      #f4f7fb;
  --surface: #ffffff;
  --s2:      #f8fafc;
  --s3:      #eef2f7;
  --border:  rgba(15,23,42,0.10);
  --border2: rgba(15,23,42,0.16);
  --acc:     #2563eb;
  --acc-h:   #1d4ed8;
  --acc-dim: rgba(37,99,235,0.10);
  --acc-glow:rgba(37,99,235,0.22);
  --green:   #22d3a0;
  --yellow:  #f59e0b;
  --red:     #f87171;
  --t1:      #0f172a;
  --t2:      #475569;
  --t3:      #94a3b8;
  --radius:  12px;
  --radius-sm:8px;
}

body { background:var(--bg); color:var(--t1); font-family:'DM Sans',sans-serif; line-height:1.6; -webkit-font-smoothing:antialiased; }
input,textarea,button,select { font-family:inherit; }
.mono { font-family:'DM Mono',monospace; }

@keyframes _spin { to { transform:rotate(360deg); } }
@keyframes _fade-in { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
@keyframes _slide-in { from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)} }
@keyframes _toast-in { from{opacity:0;transform:translateY(12px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)} }
@keyframes _pulse { 0%,100%{opacity:1}50%{opacity:0.5} }

/* ── Layout ── */
.app { display:flex; height:100vh; overflow:hidden; }

/* ── Sidebar ── */
.sidebar {
  width:220px; flex-shrink:0;
  background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);
  border-right:1px solid var(--border);
  display:flex; flex-direction:column;
  padding:0; overflow:hidden;
}
.sidebar-logo {
  padding:22px 20px 18px;
  border-bottom:1px solid var(--border);
}
.sidebar-logo-mark {
  display:flex; align-items:center; gap:9px;
}
.logo-icon {
  width:30px; height:30px; border-radius:8px;
  background:linear-gradient(135deg,var(--acc),#a78bfa);
  display:flex; align-items:center; justify-content:center;
  font-size:15px; font-weight:800; color:#fff;
  letter-spacing:-0.5px; flex-shrink:0;
  box-shadow:0 4px 12px var(--acc-glow);
}
.logo-text { font-size:16px; font-weight:700; letter-spacing:-0.3px; }
.logo-text em { color:var(--acc-h); font-style:normal; }

.sidebar-nav { flex:1; padding:12px 10px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }

.nav-item {
  display:flex; align-items:center; gap:11px;
  padding:9px 12px; border-radius:var(--radius-sm);
  cursor:pointer; border:none; background:none;
  color:var(--t2); font-size:13px; font-weight:500;
  text-align:left; width:100%;
  transition:all .15s;
  position:relative;
}
.nav-item:hover { background:var(--s3); color:var(--t1); }
.nav-item.active {
  background:var(--acc-dim);
  color:var(--t1);
}
.nav-item.active::before {
  content:''; position:absolute; left:0; top:50%; transform:translateY(-50%);
  width:3px; height:60%; background:var(--acc); border-radius:0 3px 3px 0;
}
.nav-item-icon { width:16px; flex-shrink:0; opacity:0.7; }
.nav-item.active .nav-item-icon { opacity:1; }
.nav-badge {
  margin-left:auto; background:var(--acc); color:#fff;
  font-size:10px; font-weight:700; padding:1px 6px; border-radius:99px;
  font-family:'DM Mono',monospace;
}

.sidebar-footer {
  padding:14px 10px;
  border-top:1px solid var(--border);
  position:relative;
}
.user-row {
  display:flex; align-items:center; gap:10px;
  padding:8px 12px; border-radius:var(--radius-sm);
  background:var(--s3);
  cursor:pointer;
  border:1px solid transparent;
  transition:.15s;
}
.user-row:hover,
.user-row.open { border-color:var(--border2); background:#eaf0f8; }
.user-avatar {
  width:26px; height:26px; border-radius:50%;
  background:linear-gradient(135deg,var(--acc),#a78bfa);
  display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:700; color:#fff; flex-shrink:0;
}
.user-name { font-size:12px; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.btn-signout {
  background:none; border:none; cursor:pointer;
  color:var(--t3); padding:4px; border-radius:4px;
  transition:.15s; display:flex; align-items:center;
}
.btn-signout:hover { color:var(--red); background:rgba(248,113,113,0.1); }
.user-menu {
  position:absolute;
  bottom:58px;
  left:10px;
  right:10px;
  background:var(--surface);
  border:1px solid var(--border2);
  border-radius:10px;
  box-shadow:0 12px 24px rgba(15,23,42,0.12);
  padding:6px;
  z-index:40;
}
.user-menu-item {
  width:100%;
  border:none;
  background:none;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:8px 10px;
  border-radius:8px;
  font-size:12px;
  color:var(--t1);
  cursor:pointer;
}
.user-menu-item:hover { background:var(--s2); }
.user-menu-item.danger { color:#b91c1c; }
.user-menu-item.danger:hover { background:rgba(248,113,113,0.1); }

.backend-pill {
  display:flex; align-items:center; gap:6px;
  padding:6px 12px; border-radius:var(--radius-sm);
  font-size:11px; font-weight:500; margin-bottom:6px;
}
.backend-pill.online  { background:rgba(34,211,160,0.08); color:var(--green); }
.backend-pill.offline { background:rgba(248,113,113,0.08); color:var(--red); }
.backend-pill.checking{ background:rgba(245,158,11,0.08);  color:var(--yellow); }
.dot { width:6px; height:6px; border-radius:50%; background:currentColor; flex-shrink:0; }
.dot.pulse { animation:_pulse 1.5s ease infinite; }

/* ── Main content ── */
.content {
  flex:1; overflow-y:auto;
  background:
    radial-gradient(circle at 10% 0%, rgba(37,99,235,0.08), transparent 35%),
    linear-gradient(180deg, #f8fbff 0%, var(--bg) 45%);
}
.content-inner {
  max-width:900px; margin:0 auto;
  padding:36px 36px 60px;
  animation:_fade-in .25s ease;
}

/* ── Page header ── */
.page-header { margin-bottom:28px; }
.page-title { font-size:22px; font-weight:700; letter-spacing:-0.4px; margin-bottom:4px; }
.page-sub { font-size:13px; color:var(--t2); }

/* ── Cards ── */
.card {
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:22px;
  margin-bottom:16px;
  box-shadow:0 8px 28px rgba(15,23,42,0.05);
}
.card-inset {
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:var(--radius-sm);
  padding:14px 16px;
  margin-bottom:8px;
}
.card-title {
  font-size:13px; font-weight:600; color:var(--t1);
  margin-bottom:16px; display:flex; align-items:center; gap:8px;
}
.card-title-sm { font-size:12px; font-weight:600; color:var(--t2); text-transform:uppercase; letter-spacing:.06em; margin-bottom:12px; }

/* ── Grid ── */
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
@media(max-width:700px){ .grid2 { grid-template-columns:1fr; } }

/* ── Form elements ── */
.label { display:block; font-size:11px; font-weight:600; color:var(--t2); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
.input {
  width:100%; background:var(--bg); border:1px solid var(--border);
  border-radius:var(--radius-sm); padding:9px 13px;
  color:var(--t1); font-size:13px; outline:none; transition:.15s;
}
.input:focus { border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-dim); }
.input::placeholder { color:var(--t3); }
textarea.input { resize:vertical; min-height:120px; font-family:'DM Mono',monospace; font-size:12px; line-height:1.7; }

/* ── Buttons ── */
.btn {
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  padding:8px 16px; border-radius:var(--radius-sm);
  font-size:13px; font-weight:600; cursor:pointer; border:none;
  transition:all .15s; white-space:nowrap; position:relative; overflow:hidden;
}
.btn:disabled { opacity:.4; cursor:not-allowed; }
.btn-primary {
  background:var(--acc); color:#fff;
  box-shadow:0 4px 12px rgba(37,99,235,0.22), 0 0 0 0 var(--acc-glow);
}
.btn-primary:hover:not(:disabled) {
  background:var(--acc-h); box-shadow:0 6px 16px rgba(37,99,235,0.24), 0 0 16px var(--acc-glow);
  transform:translateY(-1px);
}
.btn-secondary { background:var(--s3); color:var(--t1); border:1px solid var(--border2); }
.btn-secondary:hover:not(:disabled) { border-color:var(--acc); color:var(--acc-h); background:var(--acc-dim); }
.btn-danger { background:transparent; color:var(--red); border:1px solid rgba(248,113,113,0.3); }
.btn-danger:hover:not(:disabled) { background:rgba(248,113,113,0.1); }
.btn-ghost { background:transparent; color:var(--t2); border:none; padding:6px 8px; }
.btn-ghost:hover:not(:disabled) { color:var(--t1); background:var(--s3); }
.btn-sm { padding:5px 11px; font-size:12px; }
.btn-xs { padding:3px 9px; font-size:11px; }
.btn-wide { padding:11px 28px; font-size:14px; }
.btn-full { width:100%; }

/* ── Drop zone ── */
.dropzone {
  border:1.5px dashed var(--border2); border-radius:var(--radius);
  padding:28px 20px; text-align:center; cursor:pointer;
  transition:all .2s; margin-bottom:14px;
  background:transparent;
}
.dropzone:hover { border-color:var(--acc); background:var(--acc-dim); }
.dropzone-icon { color:var(--acc); margin:0 auto 10px; display:block; }
.dropzone-title { font-size:13px; font-weight:600; margin-bottom:4px; }
.dropzone-sub { font-size:11px; color:var(--t3); }

/* ── Badge / Pill ── */
.badge { display:inline-flex; align-items:center; gap:5px; padding:2px 9px; border-radius:99px; font-size:11px; font-weight:600; }
.badge-green  { background:rgba(34,211,160,0.1); color:var(--green); }
.badge-yellow { background:rgba(245,158,11,0.1); color:var(--yellow); }
.badge-red    { background:rgba(248,113,113,0.1); color:var(--red); }
.badge-purple { background:var(--acc-dim); color:var(--acc-h); }
.badge-gray   { background:rgba(75,85,99,0.15); color:var(--t2); }

/* ── Progress bar ── */
.progress-track { height:4px; background:var(--s3); border-radius:99px; overflow:hidden; }
.progress-fill  { height:100%; border-radius:99px; background:linear-gradient(90deg,var(--acc),#a78bfa); transition:width .4s ease; }

/* ── Doc item ── */
.doc-row {
  display:flex; align-items:center; gap:12px;
  background:var(--bg); border:1px solid var(--border);
  border-radius:var(--radius-sm); padding:11px 14px; margin-bottom:8px;
  transition:.15s;
}
.doc-row:hover { border-color:var(--border2); }
.doc-row-icon {
  width:32px; height:32px; border-radius:8px;
  background:var(--acc-dim); display:flex; align-items:center; justify-content:center;
  color:var(--acc-h); flex-shrink:0;
}
.doc-row-body { flex:1; min-width:0; }
.doc-row-name { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.doc-row-meta { font-size:11px; color:var(--t3); margin-top:2px; }

/* ── Q card ── */
.q-card {
  background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); overflow:hidden; margin-bottom:18px;
  transition:border-color .15s;
  box-shadow:0 12px 24px rgba(15,23,42,0.06);
}
.q-card.editing { border-color:var(--acc); box-shadow:0 0 0 1px var(--acc); }
.q-card.flagged { border-color:rgba(248,113,113,0.4); }
.q-card-head {
  display:flex; align-items:flex-start; gap:12px;
  padding:18px 20px 12px;
  border-bottom:1px solid var(--border);
  background:var(--s2);
}
.q-num {
  font-family:'DM Mono',monospace; font-size:10px; font-weight:500;
  color:var(--t3); background:var(--s3);
  border:1px solid var(--border); border-radius:5px;
  padding:2px 7px; flex-shrink:0; margin-top:3px;
}
.q-text { font-size:17px; font-weight:600; flex:1; line-height:1.45; color:var(--t1); }
.q-card-body { padding:16px 20px 20px; }

.q-head-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0; }
.conf-wrap { display:flex; align-items:center; gap:6px; }
.conf-help {
  border:none; background:var(--s3); color:var(--t2); width:18px; height:18px;
  border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
  cursor:help;
}
.conf-note { font-size:12px; color:var(--t2); max-width:280px; text-align:right; line-height:1.4; }

.ans-box {
  background:var(--bg); border:1px solid var(--border);
  border-radius:var(--radius-sm); padding:14px 16px;
  font-size:15px; line-height:1.75; color:var(--t1); margin-bottom:12px;
}
.ans-box.not-found { color:var(--t3); font-style:italic; }
.ans-edit {
  width:100%; background:var(--bg);
  border:1px solid var(--acc); border-radius:var(--radius-sm);
  padding:14px 16px; font-size:15px; line-height:1.7; color:var(--t1);
  outline:none; resize:vertical; min-height:80px; margin-bottom:10px;
  box-shadow:0 0 0 3px var(--acc-dim);
}

.not-found-wrap {
  background:rgba(248,113,113,0.08);
  border:1px solid rgba(248,113,113,0.32);
  border-radius:var(--radius-sm);
  padding:14px 16px;
  margin-bottom:12px;
}
.not-found-title { color:#b91c1c; font-weight:700; font-size:15px; margin-bottom:6px; }
.not-found-desc { color:#7f1d1d; font-size:13px; line-height:1.6; }

.cites { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.cite {
  display:inline-flex; align-items:center; gap:6px; padding:5px 10px;
  border-radius:99px; font-size:12px; font-weight:600;
  background:#f8fbff; color:#1d4ed8; border:1px solid rgba(37,99,235,0.24);
  cursor:pointer;
  text-decoration:none;
  transition:.15s;
}
.cite:hover {
  background:#eef5ff;
  border-color:rgba(37,99,235,0.4);
}

.evidence {
  border-left:3px solid var(--acc); padding:12px 14px;
  background:#f5f9ff; border-radius:0 var(--radius-sm) var(--radius-sm) 0;
  font-family:'DM Mono',monospace; font-size:13px; color:#334155;
  line-height:1.7; margin-bottom:12px;
}
.evidence-label { font-size:11px; font-weight:700; color:var(--acc-h); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; font-family:'DM Sans',sans-serif; }

.q-actions { display:flex; gap:6px; flex-wrap:wrap; }

/* ── Stat tile ── */
.stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
@media(max-width:640px){ .stat-grid { grid-template-columns:repeat(2,1fr); } }
.stat-tile {
  background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); padding:18px;
  box-shadow:0 8px 24px rgba(15,23,42,0.06);
}
.stat-top { display:flex; align-items:center; gap:8px; margin-bottom:8px; color:var(--t2); font-size:12px; font-weight:600; }
.stat-val { font-family:'DM Mono',monospace; font-size:32px; font-weight:500; line-height:1; margin-bottom:6px; }
.stat-key { font-size:12px; color:var(--t2); font-weight:500; }

/* ── Checklist ── */
.checklist-item {
  display:flex; align-items:center; gap:12px;
  padding:12px 16px; border-bottom:1px solid var(--border);
}
.checklist-item:last-child { border-bottom:none; }
.check-icon { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.check-icon.ok { background:rgba(34,211,160,0.15); color:var(--green); }
.check-icon.no { background:var(--s3); color:var(--t3); }

/* ── Coverage bar ── */
.cov-track { height:11px; background:var(--s3); border-radius:99px; overflow:hidden; margin-top:8px; }
.cov-fill { height:100%; border-radius:99px; background:linear-gradient(90deg,var(--green),var(--acc)); transition:width .6s ease; }

.review-header-actions { display:flex; gap:8px; flex-wrap:wrap; }
.export-panel {
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:14px 16px;
  display:flex;
  gap:12px;
  align-items:center;
  flex-wrap:wrap;
}
.export-panel-title { font-size:12px; color:var(--t2); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }

/* ── Version row ── */
.ver-row {
  display:flex; align-items:center; gap:12px;
  background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius-sm); padding:13px 16px;
  cursor:pointer; transition:.15s; margin-bottom:8px;
}
.ver-row:hover { border-color:var(--acc); background:var(--s2); }

/* ── Flow steps strip ── */
.flow-strip {
  display:flex; gap:0; margin-bottom:28px;
  background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); overflow:hidden;
}
.flow-step {
  flex:1; display:flex; align-items:center; justify-content:center;
  flex-direction:column; gap:2px; padding:14px 8px;
  font-size:11px; font-weight:600; color:var(--t3); cursor:pointer;
  border-right:1px solid var(--border); transition:.15s; text-align:center;
}
.flow-step:last-child { border-right:none; }
.flow-step:hover { color:var(--t2); background:var(--s2); }
.flow-step.done { color:var(--green); }
.flow-step.current { color:var(--acc-h); background:var(--acc-dim); }

/* ── Toast ── */
.toast {
  position:fixed; bottom:24px; right:24px;
  background:var(--s2); border:1px solid var(--border2);
  border-radius:var(--radius); padding:12px 16px;
  font-size:13px; z-index:9999;
  animation:_toast-in .25s ease;
  display:flex; align-items:center; gap:10px;
  max-width:320px; box-shadow:0 12px 30px rgba(15,23,42,0.14);
}
.toast.ok  { border-color:rgba(34,211,160,0.3); }
.toast.err { border-color:rgba(248,113,113,0.3); }

/* ── Divider ── */
hr { border:none; border-top:1px solid var(--border); margin:20px 0; }

/* ── Empty state ── */
.empty { text-align:center; padding:48px 20px; color:var(--t3); }
.empty-icon { font-size:32px; margin-bottom:12px; opacity:.5; }
.empty-text { font-size:14px; margin-bottom:16px; }

.q-page .page-sub { font-size:15px; max-width:760px; }
.q-page .card-title { font-size:15px; }
.q-page .label { font-size:12px; font-weight:700; color:#334155; }
.q-page .input { font-size:15px; padding:11px 14px; }
.q-page textarea.input { font-size:14px; min-height:140px; line-height:1.75; }
.q-page .dropzone-title { font-size:15px; }
.q-empty-note { font-size:16px; font-weight:800; color:#1e3a8a; margin-bottom:4px; }
.q-empty-sub { font-size:13px; color:var(--t2); }
.ai-assist {
  margin-top:12px;
  padding:10px 12px;
  border:1px solid rgba(37,99,235,0.2);
  background:linear-gradient(135deg,#f7fbff,#eef5ff);
  border-radius:10px;
  display:flex;
  gap:8px;
  align-items:flex-start;
}
.ai-assist-title { font-size:12px; font-weight:700; color:#1e40af; margin-bottom:1px; }
.ai-assist-sub { font-size:12px; color:#334155; }

/* ── Responsive ── */
@media (max-width: 1100px) {
  .content-inner { padding:28px 24px 44px; }
}

@media (max-width: 900px) {
  .app { flex-direction:column; height:auto; min-height:100vh; }

  .sidebar {
    width:100%;
    border-right:none;
    border-bottom:1px solid var(--border);
    overflow:visible;
  }

  .sidebar-logo { padding:16px 14px 12px; }

  .sidebar-nav {
    flex:none;
    display:flex;
    flex-direction:row;
    gap:8px;
    padding:10px 10px 12px;
    overflow-x:auto;
  }

  .nav-item {
    width:auto;
    min-width:max-content;
    border:1px solid var(--border);
    background:var(--surface);
    border-radius:10px;
  }

  .nav-item.active::before { display:none; }

  .sidebar-footer {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    padding:10px;
  }

  .backend-pill { margin-bottom:0; }
  .content { min-height:0; }

  .flow-strip {
    overflow-x:auto;
    -webkit-overflow-scrolling:touch;
  }

  .flow-step { min-width:140px; padding:12px 8px; }

  .q-card-head { flex-direction:column; align-items:flex-start; }
  .q-head-right { align-items:flex-start; }
}

@media (max-width: 640px) {
  .content-inner { padding:18px 12px 28px; }
  .page-title { font-size:20px; }
  .page-sub { font-size:12px; }
  .card { padding:14px; border-radius:10px; }
  .dropzone { padding:20px 12px; }
  .q-text { font-size:15px; }
  .ans-box { font-size:14px; line-height:1.6; }
  .stat-grid { grid-template-columns:1fr; }

  .toast {
    left:12px;
    right:12px;
    bottom:12px;
    max-width:none;
  }
}
`;

function ConfidenceBadge({ score=0 }) {
  const conf = confBadge(score);
  const hint = confidenceHint(conf.label);
  return (
    <>
      <div className="conf-wrap">
        <span className="badge" style={{ background:conf.bg, color:conf.color, flexShrink:0 }}>
          {conf.label} confidence
        </span>
        <span className="conf-help" title={hint}>
          <IconInfo size={10} />
        </span>
      </div>
      <div className="conf-note">{hint}</div>
    </>
  );
}

function CitationTag({ citation, onClick }) {
  return (
    <button type="button" className="cite" title={`Open source: ${citation}`} onClick={onClick}>
      <IconDocs size={10} />
      <span>{citation}</span>
    </button>
  );
}

function EvidenceBlock({ text }) {
  if (!text) return null;
  return (
    <div className="evidence">
      <div className="evidence-label">Evidence</div>
      "{text}"
    </div>
  );
}

function QuestionCard({
  qa, editingId, setEditingId, editText, setEditText, saveEdit, regenOne, regenningId, onOpenCitation,
}) {
  const isEdit = editingId===qa.id;
  const isRegen = regenningId===qa.id;
  const isNF = qa.answer?.includes("Not found");
  const isFlagged = qa.hallucination_risk==="high" && !isNF;

  return (
    <div className={`q-card ${isEdit?"editing":""} ${isFlagged?"flagged":""}`}>
      <div className="q-card-head">
        <div className="q-num">Q{qa.num}</div>
        <div className="q-text">{qa.text}</div>
        <div className="q-head-right">
          <ConfidenceBadge score={qa.confidence || 0} />
          {isFlagged && <span className="badge badge-red" style={{flexShrink:0}}>Needs review</span>}
        </div>
      </div>
      <div className="q-card-body">
        {isEdit ? (
          <textarea className="ans-edit" value={editText} onChange={e=>setEditText(e.target.value)}/>
        ) : isNF ? (
          <div className="not-found-wrap">
            <div className="not-found-title">Not found in references.</div>
            <div className="not-found-desc">
              This question could not be answered using the uploaded reference documents.
              You may need to upload additional documents or answer this question manually.
            </div>
          </div>
        ) : (
          <div className="ans-box">
            {isRegen
              ? <span style={{color:"var(--t3)",display:"flex",alignItems:"center",gap:8}}><Spinner size={12}/>Regenerating…</span>
              : qa.answer}
          </div>
        )}

        {!isNF && qa.citations?.length>0 && (
          <div className="cites">
            {qa.citations.map((c,i)=><CitationTag key={`${qa.id}_c_${i}`} citation={c} onClick={()=>onOpenCitation(c)} />)}
          </div>
        )}

        {!isNF && <EvidenceBlock text={qa.evidence} />}

        <div className="q-actions">
          {isEdit ? (
            <>
              <button className="btn btn-primary btn-xs" onClick={()=>saveEdit(qa)}><IconCheck size={11}/>Save</button>
              <button className="btn btn-secondary btn-xs" onClick={()=>setEditingId(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-xs" onClick={()=>{setEditingId(qa.id);setEditText(qa.answer);}}>
                <IconEdit size={11}/>Edit
              </button>
              <button className="btn btn-secondary btn-xs" disabled={isRegen} onClick={()=>regenOne(qa)}>
                <IconRefresh size={11}/>Regenerate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────
export default function Dashboard({ user }) {
  const [tab,      setTab]      = useState("docs");
  const [toast,    setToast]    = useState(null);

  // Backend
  const [backendOnline, setBackendOnline] = useState(null);

  // Docs
  const [docs,         setDocs]         = useState(DEMO_DOCS);
  const [ingestStatus, setIngestStatus] = useState({});
  const [uploading,    setUploading]    = useState(false);

  // Questionnaire
  const [qName,     setQName]     = useState("");
  const [qText,     setQText]     = useState("");
  const [questions, setQuestions] = useState([]);
  const [qNameTouched, setQNameTouched] = useState(false);

  // Generate
  const [generating, setGenerating] = useState(false);
  const [progress,   setProgress]   = useState({ cur:0, total:0, msg:"" });

  // Review
  const [qaResults,   setQaResults]   = useState([]);
  const [editingId,   setEditingId]   = useState(null);
  const [editText,    setEditText]    = useState("");
  const [regenningId, setRegenningId] = useState(null);

  // History / Analytics
  const [versions,  setVersions]  = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const userName = user.user_metadata?.full_name || user.email.split("@")[0];
  const userInitial = userName[0]?.toUpperCase();

  const toast$ = (msg, type="ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // On mount: health check + ingest demo docs
  useEffect(() => {
  let intervalId = null;
  let cancelled = false;
  let bootstrapped = false;

  const ingestDemoDocs = async () => {
    if (bootstrapped) return;
    bootstrapped = true;
    for (const doc of DEMO_DOCS) {
      setIngestStatus(s => ({ ...s, [doc.id]: "ingesting" }));
      try {
        await ingestDocument(doc.id, doc.title, doc.content);
        if (!cancelled) setIngestStatus(s => ({ ...s, [doc.id]: "done" }));
      } catch {
        if (!cancelled) setIngestStatus(s => ({ ...s, [doc.id]: "error" }));
      }
    }
  };

  const checkAndInit = async () => {
    const online = await checkBackendHealth();
    if (cancelled) return;
    setBackendOnline(online);
    if (online) {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      await ingestDemoDocs();
    }
  };

  checkAndInit();

  intervalId = setInterval(checkAndInit, 15000);

  return () => {
    cancelled = true;
    if (intervalId) clearInterval(intervalId);
  };
}, []);


  useEffect(() => {
    if (tab === "history")   getRuns().then(v => setVersions(v||[])).catch(()=>{});
    if (tab === "analytics") getAnalytics().then(setAnalytics).catch(()=>{});
  }, [tab]);

  useEffect(() => { setQuestions(parseQuestions(qText)); }, [qText]);

  useEffect(() => {
    if (qNameTouched) return;
    const suggested = suggestRunName(qText, questions.length);
    setQName(suggested);
  }, [qText, questions.length, qNameTouched]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // ── Handlers ──────────────────────────────────────────
  const handleDocUpload = async (file) => {
    setUploading(true);
    const docId = `up_${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);
    try {
      setDocs(d => [{
        id:docId,
        title:file.name,
        content:"",
        objectUrl,
        mimeType:file.type || "",
        ext:file.name.split(".").pop()?.toLowerCase() || "",
        isUploaded:true,
      }, ...d]);
      setIngestStatus(s => ({ ...s, [docId]:"ingesting" }));
      toast$(`Indexing "${file.name}"…`);
      await ingestFile(file, docId, file.name);
      await saveDocument(file.name, file.name, file.name.split(".").pop()).catch(()=>{});
      setIngestStatus(s => ({ ...s, [docId]:"done" }));
      toast$(`"${file.name}" indexed ✓`);
    } catch(e) {
      URL.revokeObjectURL(objectUrl);
      setDocs(d => d.filter(x => x.id !== docId));
      setIngestStatus(s => ({ ...s, [docId]:"error" }));
      toast$(e.message, "err");
    } finally { setUploading(false); }
  };

  const handleDeleteDoc = async (doc) => {
    if (doc.objectUrl) URL.revokeObjectURL(doc.objectUrl);
    setDocs(d => d.filter(x => x.id !== doc.id));
    try {
      await deleteFromVectorStore(doc.id);
      await deleteDocument(doc.id).catch(()=>{});
    } catch {}
    toast$("Removed");
  };

  const openCitationDocument = (citation) => {
    const doc = resolveCitationDoc(citation, docs);
    if (!doc) {
      toast$(`No matching document found for "${citation}"`, "err");
      return;
    }

    if (doc.objectUrl) {
      window.open(doc.objectUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (doc.url) {
      window.open(doc.url, "_blank", "noopener,noreferrer");
      return;
    }

    if (doc.content) {
      const blob = new Blob([doc.content], { type:"text/plain" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }

    toast$("Document preview is not available in this session.", "err");
  };

  const handleQUpload = async (file) => {
    try {
      const text = await parseFileToText(file);
      setQText(text);
      setQName(file.name.replace(/\.[^.]+$/,""));
      setQNameTouched(true);
      toast$(`${parseQuestions(text).length} questions loaded`);
    } catch(e) { toast$(e.message,"err"); }
  };

  const handleGenerate = async () => {
    if (!questions.length) return toast$("No questions found.","err");
    setGenerating(true);
    setQaResults([]);
    setProgress({ cur:0, total:questions.length, msg:"Connecting…" });
    const results = await bulkGenerate(questions, (i,total,msg) => {
      setProgress({ cur:i, total, msg });
    });
    try {
      const q   = await saveQuestionnaire(qName, qText);
      const run = await createRun(q.id, `Run ${new Date().toLocaleString()}`, questions.length);
      await saveAnswers(run.id, results);
      const answered = results.filter(r=>!r.answer?.includes("Not found")).length;
      const avg = results.reduce((s,r)=>s+(r.confidence||0),0)/results.length;
      await finalizeRun(run.id, answered, avg);
      await trackEvent("questionnaire_run",{questions:results.length});
    } catch {}
    setQaResults(results);
    setGenerating(false);
    setTab("review");
    toast$(`${results.length} answers ready`);
  };

  const saveEdit = async (qa) => {
    setQaResults(r => r.map(q => q.id===qa.id ? {...q,answer:editText} : q));
    setEditingId(null);
    try { if(qa.dbId) await updateAnswer(qa.dbId, editText); } catch {}
    toast$("Saved");
  };

  const regenOne = async (qa) => {
    setRegenningId(qa.id);
    try {
      const result = await generateSingle(qa.text);
      setQaResults(r => r.map(q => q.id===qa.id ? {...q,...result} : q));
      toast$("Regenerated ✓");
    } catch { toast$("Failed","err"); }
    finally { setRegenningId(null); }
  };

  const loadVersion = async (v) => {
    try {
      const data = await getRunWithAnswers(v.id);
      setQaResults(data.answers.map(a=>({
        id:`q${a.question_num}`,num:a.question_num,text:a.question_text,
        answer:a.answer_text,citations:a.citations,evidence:a.evidence,
        confidence:a.confidence,hallucination_risk:a.hallucination_risk,dbId:a.id,
      })));
      setTab("review");
      toast$(`Loaded run`);
    } catch { toast$("Failed","err"); }
  };

  const doExport = async (fmt) => {
    trackEvent("export",{format:fmt}).catch(()=>{});
    if(fmt==="txt")  exportTXT(qaResults, qName);
    if(fmt==="csv")  exportCSV(qaResults, qName);
    if(fmt==="docx") await exportDOCX(qaResults, qName);
    if(fmt==="pdf")  exportPDF(qaResults, qName);
    toast$(`Exported as ${fmt.toUpperCase()}`);
  };

  // ── Stats ──────────────────────────────────────────────
  const answered = qaResults.filter(r=>!r.answer?.includes("Not found")).length;
  const notFound = qaResults.filter(r=> r.answer?.includes("Not found")).length;
  const flagged  = qaResults.filter(r=>r.hallucination_risk==="high"&&!r.answer?.includes("Not found")).length;
  const covPct   = qaResults.length ? Math.round((answered/qaResults.length)*100) : 0;
  const doneCount= Object.values(ingestStatus).filter(s=>s==="done").length;

  // Flow step states
  const step1done = doneCount > 0;
  const step2done = questions.length > 0;
  const step3done = qaResults.length > 0;

  return (
    <>
      <style>{CSS}</style>

      <div className="app">
        {/* ── Sidebar ──────────────────────────────────── */}
        <aside className="sidebar">
          {/* Logo */}
          <div className="sidebar-logo">
            <div className="sidebar-logo-mark">
              <div className="logo-icon">V</div>
              <div className="logo-text">Vault<em>IQ</em></div>
            </div>
          </div>

          {/* Nav */}
          <nav className="sidebar-nav">
            {NAV.map(({ id, icon: Icon, label, sub }) => {
              const badgeCount =
                id === "docs"    ? docs.length :
                id === "questionnaire" && questions.length ? questions.length :
                id === "review"  && qaResults.length ? qaResults.length : null;
              return (
                <button
                  key={id}
                  className={`nav-item ${tab===id?"active":""}`}
                  onClick={() => setTab(id)}
                >
                  <span className="nav-item-icon">
                    <Icon size={15} color={tab===id?"var(--acc-h)":"currentColor"} />
                  </span>
                  <span>{label}</span>
                  {badgeCount ? <span className="nav-badge">{badgeCount}</span> : null}
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="sidebar-footer">
            {/* Backend status */}
            <div className={`backend-pill ${backendOnline===null?"checking":backendOnline?"online":"offline"}`}>
              <span className={`dot ${backendOnline===null?"pulse":""}`} />
              {backendOnline===null ? "Checking backend…" : backendOnline ? "Backend online" : "Backend offline"}
            </div>
            <div ref={userMenuRef}>
              {userMenuOpen && (
                <div className="user-menu">
                  <button className="user-menu-item" onClick={()=>{setTab("history"); setUserMenuOpen(false);}}>
                    <span>Open history</span>
                  </button>
                  <button className="user-menu-item" onClick={()=>{setTab("analytics"); setUserMenuOpen(false);}}>
                    <span>View analytics</span>
                  </button>
                  <button className="user-menu-item danger" onClick={()=>{setUserMenuOpen(false); supabase.auth.signOut();}}>
                    <span>Log out</span>
                  </button>
                </div>
              )}
              <div className={`user-row ${userMenuOpen?"open":""}`} onClick={()=>setUserMenuOpen(v=>!v)}>
                <div className="user-avatar">{userInitial}</div>
                <div className="user-name">{userName}</div>
                <span className="btn-signout" title="Account menu">
                  <IconChevron size={13} />
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Content ──────────────────────────────────── */}
        <main className="content">
          <div className="content-inner" key={tab}>

            {/* Flow progress strip (only on workflow tabs) */}
            {["docs","questionnaire","generate","review"].includes(tab) && (
              <div className="flow-strip">
                {[
                  { id:"docs",          label:"1 · Upload Docs",     done:step1done },
                  { id:"questionnaire", label:"2 · Questionnaire",   done:step2done },
                  { id:"generate",      label:"3 · Generate",        done:step3done },
                  { id:"review",        label:"4 · Review & Export", done:false     },
                ].map(s => (
                  <div
                    key={s.id}
                    className={`flow-step ${tab===s.id?"current":s.done?"done":""}`}
                    onClick={() => setTab(s.id)}
                  >
                    {s.done && tab!==s.id && <span style={{fontSize:10}}>✓</span>}
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ═══ DOCS TAB ═══════════════════════════════ */}
            {tab==="docs" && (
              <>
                <div className="page-header">
                  <div className="page-title">Reference Documents</div>
                  <div className="page-sub" style={{fontSize:15,lineHeight:1.7,maxWidth:760}}>
                    Upload company docs. Either continue with already stored company docs or attach other documents.
                  </div>
                </div>

                {/* Upload card */}
                <div className="card">
                  <div className="card-title"><IconUpload size={14} color="var(--acc-h)"/>Upload New Document</div>
                  <div
                    className="dropzone"
                    onClick={() => {
                      if(uploading) return;
                      const i=document.createElement("input");
                      i.type="file"; i.accept=".pdf,.docx,.txt,.csv";
                      i.onchange=e=>handleDocUpload(e.target.files[0]); i.click();
                    }}
                  >
                    {uploading
                      ? <><Spinner size={22} /><div style={{marginTop:10,fontSize:13,color:"var(--t2)"}}>Uploading & indexing via /ingest-file…</div></>
                      : <>
                          <IconUpload size={22} color="var(--acc)" style={{display:"block",margin:"0 auto 10px"}} />
                          <div className="dropzone-title">Click to upload</div>
                          <div className="dropzone-sub">PDF · DOCX · TXT — parsed server-side</div>
                        </>
                    }
                  </div>
                  {!backendOnline && (
                    <div style={{fontSize:12,color:"var(--red)",display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                      <span>⚠</span> Backend Loading — refresh in 15–30s while server wakes up
                    </div>
                  )}
                </div>

                {/* Document list */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                    <div className="card-title" style={{marginBottom:0}}>
                      <IconDocs size={14} color="var(--acc-h)"/>
                      Reference Documents
                      <span className="badge badge-purple">{docs.length}</span>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={()=>setTab("questionnaire")}>
                      Next →
                    </button>
                  </div>

                  {docs.map(d => {
                    const st = ingestStatus[d.id];
                    return (
                      <div key={d.id} className="doc-row">
                        <div className="doc-row-icon"><IconDocs size={14} /></div>
                        <div className="doc-row-body">
                          <div className="doc-row-name">{d.title}</div>
                          <div className="doc-row-meta">
                            {d.id.startsWith("demo") ? "Built-in demo" : "Uploaded"} · /ingest
                          </div>
                        </div>
                        {st==="ingesting" && <span className="badge badge-yellow"><Spinner size={10} color="var(--yellow)"/>Indexing</span>}
                        {st==="done"      && <span className="badge badge-green"><IconCheck size={10}/>Indexed</span>}
                        {st==="error"     && <span className="badge badge-red"><IconX size={10}/>Failed</span>}
                        {!st             && <span className="badge badge-gray">Pending</span>}
                        {!d.id.startsWith("demo") && (
                          <button className="btn btn-ghost btn-xs" style={{color:"var(--red)",marginLeft:4}} onClick={()=>handleDeleteDoc(d)}>
                            <IconTrash size={13}/>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ═══ QUESTIONNAIRE TAB ══════════════════════ */}
            {tab==="questionnaire" && (
              <>
                <div className="page-header q-page">
                  <div className="page-title">Questionnaire</div>
                  <div className="page-sub">Paste or upload your questionnaire above, then continue to generate answers using the stored reference documents.</div>
                </div>

                <div className="grid2 q-page">
                  {/* Input */}
                  <div className="card" style={{marginBottom:0}}>
                    <div className="card-title"><IconClip size={14} color="var(--acc-h)"/>Input</div>

                    <div style={{marginBottom:14}}>
                      <label className="label">Run Name</label>
                      <input
                        className="input"
                        value={qName}
                        placeholder="Auto-generated from your questionnaire"
                        onChange={e=>{ setQName(e.target.value); setQNameTouched(true); }}
                      />
                    </div>

                    <div
                      className="dropzone"
                      style={{marginBottom:12}}
                      onClick={()=>{
                        const i=document.createElement("input");
                        i.type="file"; i.accept=".pdf,.docx,.txt,.csv";
                        i.onchange=e=>handleQUpload(e.target.files[0]); i.click();
                      }}
                    >
                      <IconClip size={18} color="var(--acc)" style={{display:"block",margin:"0 auto 8px"}} />
                      <div className="dropzone-title">Upload questionnaire file</div>
                      <div className="dropzone-sub">PDF · DOCX · TXT</div>
                    </div>

                    <label className="label">Or paste text</label>
                    <textarea
                      className="input"
                      placeholder={"1. What encryption do you use?\n2. Do you have SOC 2?\n3. What is your uptime SLA?"}
                      value={qText}
                      onChange={e=>setQText(e.target.value)}
                    />

                    <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setQText(SAMPLE_Q);setQNameTouched(false);toast$("Sample loaded");}}>
                        Load sample (10 Qs)
                      </button>
                      {qText && <button className="btn btn-danger btn-sm" onClick={()=>setQText("")}>Clear</button>}
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="card" style={{marginBottom:0}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <div className="card-title" style={{marginBottom:0}}>
                        <IconClip size={14} color="var(--acc-h)"/>Detected Questions
                        {questions.length>0 && <span className="badge badge-green">{questions.length}</span>}
                      </div>
                    </div>

                    {questions.length===0 ? (
                      <div className="empty" style={{padding:"32px 0"}}>
                        <div className="q-empty-note">Questions must start with a number.</div>
                        <div className="q-empty-sub">Use format like "1." or "1)" so questions are detected.</div>
                      </div>
                    ) : (
                      <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:380,overflowY:"auto"}}>
                        {questions.map(q=>(
                          <div key={q.id} className="card-inset" style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                            <span className="mono" style={{fontSize:10,color:"var(--acc-h)",flexShrink:0,marginTop:3}}>Q{q.num}</span>
                            <span style={{fontSize:12,lineHeight:1.5}}>{q.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {questions.length>0 && (
                      <button className="btn btn-primary btn-full" style={{marginTop:14}} onClick={()=>setTab("generate")}>
                        Next: Generate Answers →
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ═══ GENERATE TAB ═══════════════════════════ */}
            {tab==="generate" && (
              <>
                <div className="page-header">
                  <div className="page-title">Generate Answers</div>
                  <div className="page-sub">Runs the full RAG pipeline: embed → pgvector search → Gemini generation.</div>
                </div>

                {/* Checklist */}
                <div className="card" style={{marginBottom:16}}>
                  <div className="card-title"><IconZap size={14} color="var(--acc-h)"/>Pre-flight</div>
                  {[
                    { label:"Backend online", ok:backendOnline===true, detail: backendOnline===null?"Checking…":backendOnline?"Backend reachable":"Waiting for backend wake-up" },
                    { label:"Documents indexed",    ok:doneCount>0, detail:`${doneCount} / ${docs.length} docs in pgvector` },
                    { label:"Questions loaded",     ok:questions.length>0, detail:questions.length>0?`${questions.length} questions ready`:"Go to Questionnaire tab" },
                  ].map(item=>(
                    <div key={item.label} className="checklist-item">
                      <div className={`check-icon ${item.ok?"ok":"no"}`}>
                        {item.ok ? <IconCheck size={10}/> : <span style={{fontSize:9,fontFamily:"DM Mono",fontWeight:700}}>—</span>}
                      </div>
                      <div>
                        <div style={{fontSize:13,fontWeight:600}}>{item.label}</div>
                        <div style={{fontSize:11,color:"var(--t3)",marginTop:1}}>{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Generate or progress */}
                {generating ? (
                  <div className="card" style={{textAlign:"center",padding:"48px 20px"}}>
                    <Spinner size={36} />
                    <div style={{fontSize:15,fontWeight:700,marginTop:18,marginBottom:6}}>Generating answers…</div>
                    <div style={{fontSize:12,color:"var(--t2)",marginBottom:18}}>{progress.msg}</div>
                    <div style={{maxWidth:340,margin:"0 auto"}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--t3)",marginBottom:6}}>
                        <span className="mono">{progress.cur} / {progress.total}</span>
                        <span className="mono">{progress.total?Math.round((progress.cur/progress.total)*100):0}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{width:`${progress.total?(progress.cur/progress.total)*100:0}%`}} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Ready to generate</div>
                      <div style={{fontSize:12,color:"var(--t2)"}}>
                        {questions.length} questions · {doneCount} docs indexed · POST /bulk-generate
                      </div>
                    </div>
                    <button
                      className="btn btn-primary btn-wide"
                      disabled={questions.length===0}
                      onClick={handleGenerate}
                    >
                      <IconZap size={14}/> Generate Answers
                    </button>
                  </div>
                )}

                {qaResults.length>0 && !generating && (
                  <div style={{marginTop:14,textAlign:"right"}}>
                    <button className="btn btn-primary btn-sm" onClick={()=>setTab("review")}>
                      View {qaResults.length} answers →
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ═══ REVIEW TAB ═════════════════════════════ */}
            {tab==="review" && (
              <>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24,flexWrap:"wrap",gap:12}}>
                  <div>
                    <div className="page-title">Review & Export</div>
                    <div className="page-sub">Edit any answer inline, then export as DOCX, PDF, CSV, or TXT.</div>
                  </div>
                  <div className="review-header-actions">
                    <div className="export-panel">
                      <div className="export-panel-title">Export questionnaire</div>
                      <button className="btn btn-secondary btn-sm" onClick={()=>doExport("txt")}><IconExport size={12}/>TXT</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>doExport("csv")}><IconExport size={12}/>CSV</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>doExport("pdf")}><IconExport size={12}/>PDF</button>
                      <button className="btn btn-primary btn-sm" onClick={()=>doExport("docx")}><IconExport size={12}/>DOCX</button>
                    </div>
                  </div>
                </div>

                {qaResults.length===0 ? (
                  <div className="empty">
                    <div className="empty-icon">📄</div>
                    <div className="empty-text">No answers yet.</div>
                    <button className="btn btn-primary btn-sm" onClick={()=>setTab("generate")}>Generate answers →</button>
                  </div>
                ) : (
                  <>
                    {/* Stats */}
                    <div className="stat-grid">
                      {[
                        {val:qaResults.length, key:"Total Questions", icon:"📊", color:"var(--t1)"},
                        {val:answered,         key:"Answered",        icon:"✔",  color:"var(--green)"},
                        {val:notFound,         key:"Not Found",       icon:"⚠",  color:"var(--yellow)"},
                        {val:flagged,          key:"Needs Review",    icon:"🚩", color:"var(--red)"},
                      ].map(s=>(
                        <div key={s.key} className="stat-tile">
                          <div className="stat-top">
                            <span>{s.icon}</span>
                            <span>{s.key}</span>
                          </div>
                          <div className="stat-val" style={{color:s.color}}>{s.val}</div>
                          <div className="stat-key">{s.key} count</div>
                        </div>
                      ))}
                    </div>

                    {/* Coverage */}
                    <div className="card" style={{padding:"14px 18px",marginBottom:20}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:2}}>
                        <span style={{fontWeight:600,color:"var(--t2)"}}>Coverage</span>
                        <span className="mono" style={{color:"var(--acc-h)",fontSize:13,fontWeight:700}}>{covPct}%</span>
                      </div>
                      <div className="cov-track"><div className="cov-fill" style={{width:`${covPct}%`}}/></div>
                    </div>

                    {/* Q&A */}
                    {qaResults.map(qa=>(
                      <QuestionCard
                        key={qa.id}
                        qa={qa}
                        editingId={editingId}
                        setEditingId={setEditingId}
                        editText={editText}
                        setEditText={setEditText}
                        saveEdit={saveEdit}
                        regenOne={regenOne}
                        regenningId={regenningId}
                        onOpenCitation={openCitationDocument}
                      />
                    ))}

                    {/* Bottom export */}
                    <div className="card" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:14,marginTop:8}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>Export completed questionnaire</div>
                        <div style={{fontSize:11,color:"var(--t2)",marginTop:2}}>{answered}/{qaResults.length} answered · citations included</div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn btn-secondary btn-sm" onClick={()=>doExport("txt")}><IconExport size={12}/>TXT</button>
                        <button className="btn btn-secondary btn-sm" onClick={()=>doExport("csv")}><IconExport size={12}/>CSV</button>
                        <button className="btn btn-secondary btn-sm" onClick={()=>doExport("pdf")}><IconExport size={12}/>PDF</button>
                        <button className="btn btn-primary btn-sm" onClick={()=>doExport("docx")}><IconExport size={12}/>DOCX</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ═══ HISTORY ════════════════════════════════ */}
            {tab==="history" && (
              <>
                <div className="page-header">
                  <div className="page-title">Version History</div>
                  <div className="page-sub">All past questionnaire runs stored in Supabase. Click any to reload into Review.</div>
                </div>
                {versions.length===0
                  ? <div className="empty"><div className="empty-text">No runs yet.</div></div>
                  : versions.map(v=>(
                    <div key={v.id} className="ver-row" onClick={()=>loadVersion(v)}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:"var(--acc)",flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{v.questionnaires?.name||"Questionnaire"}</div>
                        <div style={{fontSize:11,color:"var(--t2)",marginTop:1}}>{new Date(v.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:12,color:"var(--green)",fontFamily:"DM Mono"}}>{v.answered_count}/{v.total_questions} answered</div>
                        <div style={{fontSize:11,color:"var(--t3)"}}>{Math.round((v.avg_confidence||0)*100)}% confidence</div>
                      </div>
                    </div>
                  ))
                }
              </>
            )}

            {/* ═══ ANALYTICS ══════════════════════════════ */}
            {tab==="analytics" && (
              <>
                <div className="page-header">
                  <div className="page-title">Analytics</div>
                  <div className="page-sub">Usage data from Supabase analytics_events table.</div>
                </div>
                {!analytics
                  ? <div style={{display:"flex",justifyContent:"center",padding:48}}><Spinner size={32}/></div>
                  : <>
                      <div className="stat-grid">
                        {[
                          {val:analytics.totalQuestionnaires, key:"Questionnaires",    color:"var(--acc-h)"},
                          {val:analytics.totalAnswered,        key:"Answers Generated", color:"var(--green)"},
                          {val:`${analytics.avgConfidence}%`,  key:"Avg Confidence",   color:"var(--yellow)"},
                          {val:analytics.documentsUploaded,    key:"Docs in Library",  color:"var(--t1)"},
                        ].map(s=>(
                          <div key={s.key} className="stat-tile">
                            <div className="stat-val" style={{color:s.color}}>{s.val}</div>
                            <div className="stat-key">{s.key}</div>
                          </div>
                        ))}
                      </div>
                      <div className="card">
                        <div className="card-title"><IconClock size={14} color="var(--acc-h)"/>Recent Runs</div>
                        {analytics.recentRuns.length===0
                          ? <p style={{color:"var(--t2)",fontSize:13}}>No runs yet.</p>
                          : analytics.recentRuns.map(r=>(
                            <div key={r.id} className="card-inset" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <span style={{fontSize:12}}>{new Date(r.created_at).toLocaleDateString()}</span>
                              <span className="mono badge badge-green" style={{fontSize:11}}>{r.answered_count}/{r.total_questions}</span>
                            </div>
                          ))
                        }
                      </div>
                    </>
                }
              </>
            )}
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span style={{color:toast.type==="ok"?"var(--green)":"var(--red)"}}>
            {toast.type==="ok" ? <IconCheck size={14}/> : <IconX size={14}/>}
          </span>
          {toast.msg}
        </div>
      )}
    </>
  );
}
