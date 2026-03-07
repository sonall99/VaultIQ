"""
VaultIQ — FastAPI Backend
Handles RAG pipeline: document ingestion, embedding, retrieval, and answer generation
"""
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from rag import RAGPipeline
from document_parser import parse_file_bytes
from gemini_client import GeminiClient


app = FastAPI(title="VaultIQ API", version="1.0.0")

# ── CORS — allow React frontend ───────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Singletons ────────────────────────────────────────────
rag = RAGPipeline()
gemini = GeminiClient()


# ── Request / Response Models ─────────────────────────────

class IngestRequest(BaseModel):
    doc_id: str
    title: str
    content: str          # plain text already parsed on frontend


class IngestResponse(BaseModel):
    doc_id: str
    chunks_stored: int
    message: str


class AnswerRequest(BaseModel):
    question: str
    top_k: int = 5        # how many chunks to retrieve


class AnswerResponse(BaseModel):
    answer: str
    citations: List[str]
    evidence: str
    confidence: float
    hallucination_risk: str
    chunks_used: int


class BulkAnswerRequest(BaseModel):
    questions: List[dict]  # [{ "num": 1, "text": "..." }, ...]
    top_k: int = 5


class BulkAnswerResponse(BaseModel):
    results: List[dict]


# ── Routes ────────────────────────────────────────────────

@app.get("/health")
def health():
    """Health check — verify backend is running"""
    return {"status": "ok", "service": "VaultIQ API"}


@app.post("/ingest", response_model=IngestResponse)
async def ingest_document(req: IngestRequest):
    """
    Ingest a reference document into the RAG pipeline.
    Chunks the text, generates embeddings, stores in pgvector.
    """
    try:
        chunks_stored = await rag.ingest(
            doc_id=req.doc_id,
            title=req.title,
            content=req.content,
        )
        return IngestResponse(
            doc_id=req.doc_id,
            chunks_stored=chunks_stored,
            message=f"Successfully ingested '{req.title}' into {chunks_stored} chunks",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest-file", response_model=IngestResponse)
async def ingest_file(
    file: UploadFile = File(...),
    doc_id: str = "",
    title: str = "",
):
    """
    Upload a PDF, DOCX, or TXT file directly.
    Parses it server-side, then ingests into RAG pipeline.
    """
    try:
        file_bytes = await file.read()
        file_ext = file.filename.split(".")[-1].lower()
        text = parse_file_bytes(file_bytes, file_ext)

        doc_id = doc_id or file.filename
        title = title or file.filename

        chunks_stored = await rag.ingest(doc_id=doc_id, title=title, content=text)

        return IngestResponse(
            doc_id=doc_id,
            chunks_stored=chunks_stored,
            message=f"Parsed and ingested '{title}' into {chunks_stored} chunks",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-answer", response_model=AnswerResponse)
async def generate_answer(req: AnswerRequest):
    """
    Core RAG endpoint.
    1. Embed the question
    2. Retrieve top-k similar chunks from pgvector
    3. Send chunks + question to Gemini
    4. Return structured answer with citations
    """
    try:
        # Step 1: Retrieve relevant chunks via vector similarity
        chunks = await rag.retrieve(question=req.question, top_k=req.top_k)

        if not chunks:
            return AnswerResponse(
                answer="Not found in references.",
                citations=[],
                evidence="",
                confidence=0.0,
                hallucination_risk="high",
                chunks_used=0,
            )

        # Step 2: Generate answer using Gemini with retrieved context
        result = await gemini.generate(question=req.question, chunks=chunks)

        return AnswerResponse(
            **result,
            chunks_used=len(chunks),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/bulk-generate", response_model=BulkAnswerResponse)
async def bulk_generate(req: BulkAnswerRequest):
    """
    Generate answers for all questions in a questionnaire.
    Runs questions sequentially to avoid rate limiting.
    """
    results = []

    for q in req.questions:
        try:
            chunks = await rag.retrieve(question=q["text"], top_k=req.top_k)

            if not chunks:
                results.append({
                    **q,
                    "answer": "Not found in references.",
                    "citations": [],
                    "evidence": "",
                    "confidence": 0.0,
                    "hallucination_risk": "high",
                    "chunks_used": 0,
                })
                continue

            result = await gemini.generate(question=q["text"], chunks=chunks)
            results.append({**q, **result, "chunks_used": len(chunks)})

        except Exception as e:
            results.append({
                **q,
                "answer": "Error generating answer.",
                "citations": [],
                "evidence": "",
                "confidence": 0.0,
                "hallucination_risk": "high",
                "chunks_used": 0,
                "error": str(e),
            })

    return BulkAnswerResponse(results=results)


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    """Delete all chunks for a document from the vector store"""
    try:
        deleted = await rag.delete_document(doc_id)
        return {"doc_id": doc_id, "chunks_deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/documents")
async def list_documents():
    """List all ingested documents"""
    try:
        docs = await rag.list_documents()
        return {"documents": docs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
