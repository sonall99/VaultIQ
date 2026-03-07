"""
VaultIQ — RAG Pipeline
Handles:
  1. Chunking documents into overlapping segments
  2. Generating embeddings via Gemini text-embedding-004
  3. Storing embeddings in Supabase pgvector
  4. Semantic similarity search at query time
"""

import os
import json
import asyncio
from typing import List, Dict
import google.generativeai as genai
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")  # service key for backend
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

genai.configure(api_key=GEMINI_API_KEY)

EMBEDDING_MODEL = "models/gemini-embedding-001"  # 768 dimensions
CHUNK_SIZE = 150       # words per chunk
CHUNK_OVERLAP = 30     # overlapping words between chunks


class RAGPipeline:

    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── 1. CHUNKING ───────────────────────────────────────

    def chunk_text(self, text: str) -> List[str]:
        """
        Split text into overlapping chunks.
        Overlap ensures context at chunk boundaries is not lost.

        Example (chunk_size=5, overlap=2):
        "A B C D E F G H" → ["A B C D E", "D E F G H"]
        """
        words = text.split()
        chunks = []
        step = CHUNK_SIZE - CHUNK_OVERLAP

        for i in range(0, len(words), step):
            chunk = " ".join(words[i : i + CHUNK_SIZE])
            if len(chunk.strip()) > 40:  # skip tiny trailing chunks
                chunks.append(chunk)
            if i + CHUNK_SIZE >= len(words):
                break

        return chunks

    # ── 2. EMBEDDING ─────────────────────────────────────

    def embed_text(self, text: str) -> List[float]:
        """
        Generate a 768-dimensional embedding for a text string
        using Google's text-embedding-004 model.
        """
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=text,
            task_type="retrieval_document",  # optimised for storage
        )
        return result["embedding"]

    def embed_query(self, query: str) -> List[float]:
        """
        Embed a search query.
        Uses task_type='retrieval_query' for better search performance.
        """
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=query,
            task_type="retrieval_query",  # optimised for search
        )
        return result["embedding"]

    # ── 3. INGEST ─────────────────────────────────────────

    async def ingest(self, doc_id: str, title: str, content: str) -> int:
        """
        Full ingestion pipeline for one document:
          1. Delete old chunks for this doc (for re-ingestion)
          2. Split into chunks
          3. Embed each chunk
          4. Store in Supabase document_chunks table

        Returns number of chunks stored.
        """
        # Delete existing chunks for this doc (idempotent re-ingest)
        self.supabase.table("document_chunks") \
            .delete() \
            .eq("doc_id", doc_id) \
            .execute()

        chunks = self.chunk_text(content)
        rows = []

        for idx, chunk_text in enumerate(chunks):
            embedding = self.embed_text(chunk_text)
            rows.append({
                "doc_id": doc_id,
                "doc_title": title,
                "chunk_index": idx,
                "text": chunk_text,
                "embedding": embedding,  # pgvector stores as float array
            })

        # Batch insert (Supabase handles up to 1000 rows per call)
        if rows:
            self.supabase.table("document_chunks").insert(rows).execute()

        return len(rows)

    # ── 4. RETRIEVE ───────────────────────────────────────

    async def retrieve(self, question: str, top_k: int = 5) -> List[Dict]:
        """
        Semantic similarity search:
          1. Embed the question
          2. Call pgvector cosine similarity search via Supabase RPC
          3. Return top-k most relevant chunks

        The match_chunks function is defined in supabase/schema.sql
        """
        query_embedding = self.embed_query(question)

        response = self.supabase.rpc(
            "match_chunks",
            {
                "query_embedding": query_embedding,
                "match_count": top_k,
                "similarity_threshold": 0.3,  # ignore irrelevant chunks
            },
        ).execute()

        chunks = response.data or []

        # Format for Gemini context
        return [
            {
                "doc_title": c["doc_title"],
                "text": c["text"],
                "similarity": round(c["similarity"], 3),
            }
            for c in chunks
        ]

    # ── 5. HELPERS ────────────────────────────────────────

    async def delete_document(self, doc_id: str) -> int:
        """Remove all chunks for a document"""
        result = self.supabase.table("document_chunks") \
            .delete() \
            .eq("doc_id", doc_id) \
            .execute()
        return len(result.data or [])

    async def list_documents(self) -> List[Dict]:
        """List unique documents in the vector store"""
        result = self.supabase.table("document_chunks") \
            .select("doc_id, doc_title") \
            .execute()

        # Deduplicate by doc_id
        seen = {}
        for row in (result.data or []):
            if row["doc_id"] not in seen:
                seen[row["doc_id"]] = row["doc_title"]

        return [{"doc_id": k, "doc_title": v} for k, v in seen.items()]
