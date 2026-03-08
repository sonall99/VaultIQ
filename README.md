<div align="center">

# 🏦 VaultIQ
### AI-Powered Vendor Questionnaire Answering Tool

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-FF6B35?style=for-the-badge&logo=groq&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)

**Upload a questionnaire → AI answers from your reference docs → Export in seconds**

> 🏦 **Fictional Company Context:** VaultIQ is an imaginary FinTech company that helps banks store and manage sensitive financial data securely. It is used here as the demo scenario — the reference documents, sample questionnaire, and AI answers are all based on VaultIQ as a pretend vendor being evaluated by a bank.

[🚀 Live Demo](https://vault-iq-sand.vercel.app) • [📡 API Docs](https://vaultiq-1-j7qn.onrender.com/docs) • [💻 GitHub](https://github.com/sonall99/VaultIQ)
# VaultIQ — AI-Powered Questionnaire Answering Tool

> AI-powered vendor questionnaire automation for FinTech compliance teams.  
> Upload a questionnaire → ground answers in reference docs → export a complete, cited response document in seconds.

---
## Links

| | |
|---|---|
| **Live App** | https://vault-iq-sand.vercel.app |
| **Backend API** | https://vaultiq-1-j7qn.onrender.com |
| **API Docs** | https://vaultiq-1-j7qn.onrender.com/docs |
| **GitHub** | https://github.com/sonall99/VaultIQ |

------

## Company Overview

**Industry:** FinTech / Financial Infrastructure  
**Type:** B2B SaaS  
**Clients:** Banks, payment processors, financial service providers

VaultIQ is a fintech infrastructure platform that helps banks and financial institutions securely manage sensitive financial data, automate compliance workflows, and monitor operational risk. The platform provides tools for encryption management, audit logging, regulatory reporting, and vendor risk assessment — used by 200+ enterprise clients across 14 countries.

---

## What I Built

A full-stack AI application that automates the completion of vendor security questionnaires. Instead of a compliance officer spending hours manually answering the same questions across every client engagement, VaultIQ's tool:

1. Parses any uploaded questionnaire into individual questions
2. Retrieves the most relevant chunks from reference documents using semantic search (RAG)
3. Sends grounded context to an LLM that generates precise, cited answers
4. Allows reviewing, editing, and regenerating individual answers
5. Exports a clean, structured document ready to send

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER BROWSER                             │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│   │  Auth Screen │───▶│  Dashboard   │───▶│  Review & Export │  │
│   │  (Supabase)  │    │  (React UI)  │    │  (Edit + DOCX)   │  │
│   └──────────────┘    └──────┬───────┘    └──────────────────┘  │
└──────────────────────────────│──────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FASTAPI BACKEND                            │
│                                                                 │
│   POST /ingest          POST /bulk-generate    GET /health      │
│   POST /ingest-file     POST /generate-answer  GET /documents   │
│   DELETE /documents/{id}                                        │
│                                                                 │
│   ┌─────────────────┐         ┌──────────────────────────────┐  │
│   │   RAG Pipeline  │         │         Groq LLM Client      │  │
│   │  chunk_text()   │         │  llama-3.3-70b-versatile     │  │
│   │  embed_text()   │         │  temperature: 0.1            │  │
│   │  retrieve()     │         │  answer + citations +        │  │
│   │  ingest()       │         │  evidence + confidence       │  │
│   └────────┬────────┘         └──────────────────────────────┘  │
└────────────│────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 SUPABASE (PostgreSQL + pgvector)                 │
│                                                                 │
│   document_chunks      profiles        questionnaires           │
│   ┌──────────────┐    ┌──────────┐    ┌─────────────────────┐   │
│   │ doc_id       │    │ id       │    │ id                  │   │
│   │ doc_title    │    │ email    │    │ user_id             │   │
│   │ chunk_index  │    │ name     │    │ title               │   │
│   │ text         │    └──────────┘    │ question_count      │   │
│   │ embedding    │                    └─────────────────────┘   │
│   │ (768-dim)    │    runs            answers                   │
│   └──────────────┘    ┌──────────┐    ┌─────────────────────┐   │
│                       │ id       │    │ run_id              │   │
│   cosine similarity   │ user_id  │    │ question_text       │   │
│   via match_chunks()  │ status   │    │ answer_text         │   │
│   RPC function        │ coverage │    │ citations[]         │   │
│                       └──────────┘    │ confidence          │   │
│                                       │ evidence            │   │
│                                       └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│           GOOGLE AI — text-embedding-004 (768-dim)              │
│           Embeddings for semantic RAG retrieval                  │
└─────────────────────────────────────────────────────────────────┘
```

### RAG Pipeline

```
DOCUMENT INGESTION                      QUERY TIME
──────────────────                      ──────────

 Raw Text / PDF / DOCX                  User Question
          │                                  │
          ▼                                  ▼
    chunk_text()                       embed_query()
    150 words/chunk                    task_type=
    30 word overlap                    "retrieval_query"
          │                                  │
          ▼                                  ▼
    embed_text()                   pgvector cosine search
    task_type=                      match_chunks() RPC
    "retrieval_document"            similarity ≥ 0.3
          │                                  │
          ▼                                  ▼
    INSERT →                         top-5 chunks
    document_chunks                  + doc titles
    (Supabase)                             │
                                           ▼
                                   Groq LLM Prompt
                                   (grounded JSON)
                                           │
                                           ▼
                                   { answer, citations[],
                                     evidence, confidence,
                                     hallucination_risk }
```

### Frontend Structure

```
App.jsx
 └── AuthScreen.jsx           ← Supabase Auth (sign up / sign in)
 └── Dashboard.jsx
      ├── Sidebar
      │    ├── Reference Docs     ← Upload & index documents
      │    ├── Questionnaire      ← Upload or paste questions
      │    ├── Generate           ← Run AI pipeline
      │    ├── Review & Export    ← Edit answers, download
      │    ├── History            ← Past runs from Supabase
      │    └── Analytics          ← Usage stats
      └── lib/
           ├── gemini.js          ← All API calls to backend
           ├── db.js              ← Supabase CRUD operations
           ├── fileParser.js      ← PDF / DOCX / TXT parsing
           ├── exporters.js       ← TXT / CSV / DOCX export
           └── dashboardUtils.js  ← Utility functions
```

---

## Features

### Phase 1 — Core Workflow

| Feature | Status |
|---|---|
| User sign up and login | ✅ Supabase Auth with JWT |
| Upload questionnaire (PDF / TXT / paste) | ✅ |
| Upload reference documents | ✅ PDF, DOCX, TXT |
| Parse questionnaire into individual questions | ✅ Auto-detects numbered lists |
| Retrieve relevant content via RAG | ✅ pgvector cosine similarity |
| Generate grounded answer per question | ✅ Groq LLM |
| Citation per answer | ✅ Exact document titles |
| Not found in references fallback | ✅ |

### Phase 2 — Review and Export

| Feature | Status |
|---|---|
| Review answers in structured web view | ✅ |
| Edit individual answers inline | ✅ |
| Export as downloadable document | ✅ TXT, CSV, DOCX |
| Original question order preserved | ✅ |
| Citations included in export | ✅ |

### Nice-to-Have (All 5 implemented)

| Feature | Status |
|---|---|
| Confidence Score | ✅ 0.0–1.0 float with High / Medium / Low badge |
| Evidence Snippets | ✅ Near-verbatim quotes from source chunks |
| Partial Regeneration | ✅ Regenerate any single question |
| Version History | ✅ All runs saved to Supabase |
| Coverage Summary | ✅ Answered / Not Found / Flagged stats |

---

## Reference Documents

| # | Document | Key Content |
|---|---|---|
| 1 | VaultIQ Security & Encryption Policy | AES-256, TLS 1.3, RBAC, MFA, SOC monitoring |
| 2 | VaultIQ Regulatory Compliance Framework | PCI-DSS, SOC 2 Type II, ISO 27001 |
| 3 | VaultIQ Infrastructure Architecture | AWS multi-AZ, cloud-native, automated monitoring |
| 4 | VaultIQ Data Residency & Privacy Policy | Regional data storage, GDPR alignment |
| 5 | VaultIQ Business Continuity & Disaster Recovery | Daily backups, RTO 4hr, RPO 1hr |
| 6 | VaultIQ Customer Support & SLA | 99.95% uptime, 30-min P1 response, 24/7 support |

---

## Sample Questionnaire

**Financial Vendor Security Assessment — 10 Questions**

```
1.  What encryption standards are used to protect financial data?
2.  Does VaultIQ support role-based access control for user access?
3.  What regulatory compliance certifications does VaultIQ maintain?
4.  What cloud infrastructure provider hosts the platform?
5.  How does VaultIQ ensure high availability of its services?
6.  What is the recovery time objective in the event of system failure?
7.  Does VaultIQ provide regional data residency options?
8.  How frequently are system backups performed?
9.  What monitoring systems are used to detect security incidents?
10. What uptime SLA does VaultIQ guarantee for enterprise customers?
```

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React + Vite | Fast builds, component model |
| Styling | CSS Variables + DM Sans | Custom light theme, no UI library dependency |
| Auth | Supabase Auth | JWT sessions, email/password out of the box |
| Database | Supabase PostgreSQL | Managed Postgres with pgvector extension |
| Vector Search | pgvector cosine similarity | Runs inside Postgres, no extra infrastructure |
| Embeddings | Google text-embedding-004 | 768-dim, strong retrieval quality |
| LLM | Groq — llama-3.3-70b-versatile | Free tier, fast inference, JSON output |
| Backend | FastAPI + Python | Async, typed, auto-docs at /docs |
| File Parsing | PyMuPDF + python-docx | Server-side PDF and DOCX parsing |
| Frontend Deploy | Vercel | Zero-config deployment from GitHub |
| Backend Deploy | Render | Docker-free Python hosting |

---

## Local Setup

### Prerequisites

- Node.js 18+
- Python 3.11
- Supabase project (free tier works)
- Groq API key — [console.groq.com](https://console.groq.com) (free, no card required)
- Google AI Studio key — [aistudio.google.com](https://aistudio.google.com) (for embeddings only)

### 1. Clone

```bash
git clone https://github.com/sonall99/VaultIQ
```

### 2. Frontend

```bash
cd Frontend
npm install
```

Create `Frontend/.env.local`:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_BACKEND_URL=http://localhost:8000
```

### 3. Backend

```bash
cd Backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Create `Backend/.env`:

```env
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_google_ai_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
PORT=8000
```

### 4. Database

Run `supabase/schema.sql` in your Supabase SQL Editor. Enable pgvector first:

```sql
create extension if not exists vector;
```

### 5. Run

```bash
# Terminal 1 — Backend
cd Backend && uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd Frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Project Structure

```
VaultIQ/
├── Frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── AuthScreen.jsx
│   │   │   └── Dashboard.jsx
│   │   └── lib/
│   │       ├── gemini.js
│   │       ├── db.js
│   │       ├── fileParser.js
│   │       ├── exporters.js
│   │       └── dashboardUtils.js
│   └── package.json
├── Backend/
│   ├── main.py
│   ├── rag.py
│   ├── gemini_client.py
│   ├── document_parser.py
│   └── requirements.txt
└── supabase/
    └── schema.sql
```

---

## Assumptions

- Reference documents are pre-loaded on app start so evaluators can test immediately without manual uploads
- Questions must be numbered using format `1.` or `1)` for the parser to detect them
- Groq free tier is sufficient for all demo scenarios (14,400 requests per day)
- Google text-embedding-004 is used only for generating embeddings, not for answer generation
- The app is fully multi-user via Supabase Auth but demo data is shared across sessions

> **Note:** The backend is hosted on Render's free tier and may take 30–60 seconds to wake up on first visit. The app will automatically detect when the backend is online and begin indexing documents without requiring a manual refresh.

---

## Trade-offs

| Decision | Trade-off |
|---|---|
| pgvector over Pinecone | No extra paid service, runs inside existing Postgres — less scalable at very high document counts |
| Groq over OpenAI | Free tier with fast inference — requires stricter JSON prompting for consistent output |
| Sequential question generation | Avoids rate limits on free tier — 10 questions take ~20s instead of ~3s with parallelism |
| Client-side file parsing | Reduces backend load — large PDFs can be slow in the browser |
| Hardcoded demo documents | Instant demo without manual uploads — less flexible for fully custom testing |

---

## What I Would Improve With More Time

1. **Streaming answers** — stream each token via Server-Sent Events so the UI feels instant
2. **Parallel generation with queue** — job queue with smart rate-limit retry for faster bulk generation
3. **Document versioning** — flag answers that may be stale when reference docs are updated
4. **Better confidence calibration** — use retrieval similarity scores instead of LLM self-reporting
5. **Team workspaces** — shared document libraries across an organisation's users
6. **Excel export** — one sheet per run with full formatting preserved

---



---

Built for the **Almabase GTM Engineering Internship** assignment by **Sonal Singh**
