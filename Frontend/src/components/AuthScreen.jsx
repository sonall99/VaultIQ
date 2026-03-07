import { useState } from "react";
import { supabase } from "../lib/supabase";

const S = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#07080f;font-family:'Bricolage Grotesque',sans-serif}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(108,92,231,.14) 0%,transparent 65%),#07080f}
.card{width:100%;max-width:420px;background:#0f1018;border:1px solid #23253a;border-radius:14px;padding:44px 40px;box-shadow:0 16px 64px rgba(0,0,0,.6)}
.logo{font-size:26px;font-weight:800;color:#eeeef5;margin-bottom:5px}
.logo em{color:#6c5ce7;font-style:normal}
.sub{font-size:13px;color:#8888aa;margin-bottom:32px}
.tabs{display:flex;gap:3px;background:#07080f;border-radius:8px;padding:3px;border:1px solid #23253a;margin-bottom:26px}
.tab{flex:1;padding:9px;text-align:center;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;color:#8888aa;transition:.15s;border:none;background:none;font-family:inherit}
.tab.on{background:#6c5ce7;color:#fff}
.grp{margin-bottom:18px}
.lbl{display:block;font-size:11px;font-weight:700;color:#8888aa;text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}
.inp{width:100%;background:#07080f;border:1px solid #23253a;border-radius:7px;padding:11px 14px;color:#eeeef5;font-size:14px;font-family:inherit;outline:none;transition:.15s}
.inp:focus{border-color:#6c5ce7}
.inp::placeholder{color:#44445a}
.btn{width:100%;padding:13px;background:#6c5ce7;color:#fff;border:none;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s;margin-top:6px}
.btn:hover:not(:disabled){background:#5a4ed0;transform:translateY(-1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.err{color:#e17055;font-size:13px;margin-top:10px;text-align:center}
.hint{font-size:11px;color:#44445a;text-align:center;margin-top:14px}
`;

export default function AuthScreen() {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErr(""); setLoading(true);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password: pass,
          options: { data: { full_name: name } },
        });
        if (error) throw error;
        setDone(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        // onAuthStateChange in App.jsx will handle redirect
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{S}</style>
      <div className="wrap">
        <div className="card">
          <div className="logo">Vault<em>IQ</em></div>
          <div className="sub">AI-powered compliance questionnaire automation</div>

          {done ? (
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:32, marginBottom:12 }}>📬</div>
              <div style={{ fontWeight:700, marginBottom:6 }}>Check your email</div>
              <div style={{ fontSize:13, color:"#8888aa" }}>We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.</div>
            </div>
          ) : (
            <>
              <div className="tabs">
                <button className={`tab ${tab==="login"?"on":""}`} onClick={() => setTab("login")}>Sign In</button>
                <button className={`tab ${tab==="signup"?"on":""}`} onClick={() => setTab("signup")}>Sign Up</button>
              </div>

              {tab === "signup" && (
                <div className="grp">
                  <label className="lbl">Full Name</label>
                  <input className="inp" placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} />
                </div>
              )}
              <div className="grp">
                <label className="lbl">Email</label>
                <input className="inp" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="grp">
                <label className="lbl">Password</label>
                <input className="inp" type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key==="Enter" && submit()} />
              </div>
              {err && <div className="err">{err}</div>}
              <button className="btn" disabled={loading || !email || !pass} onClick={submit}>
                {loading ? "…" : tab === "signup" ? "Create Account →" : "Sign In →"}
              </button>
              <div className="hint">Powered by Supabase Auth · Secured with JWT</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
