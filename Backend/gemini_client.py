"""
VaultIQ — LLM Client (Groq)
Free tier: 14,400 requests/day, no billing needed
Uses run_in_executor to avoid blocking FastAPI's async event loop
"""

import os
import json
import re
import asyncio
from typing import List, Dict
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("MISSING: GROQ_API_KEY not set in .env")


class GeminiClient:  # name kept so main.py needs no changes

    def __init__(self):
        self.client = Groq(api_key=GROQ_API_KEY)
        self.model = "llama-3.3-70b-versatile"

    def _build_context(self, chunks: List[Dict]) -> str:
        parts = []
        for i, chunk in enumerate(chunks, 1):
            parts.append(f"[Source {i}: {chunk['doc_title']}]\n{chunk['text']}")
        return "\n\n---\n\n".join(parts)

    def _build_prompt(self, question: str, context: str) -> str:
        return f"""You are an AI assistant completing a vendor security and compliance questionnaire for VaultIQ.

Answer ONLY using the reference context below. Do NOT use outside knowledge.

REFERENCE CONTEXT:
{context}

QUESTION:
{question}

Respond in this EXACT JSON format with no extra text, no markdown, no code fences:
{{
  "answer": "Your precise answer here. If context lacks relevant info write: Not found in references.",
  "citations": ["Exact source document title"],
  "evidence": "Short verbatim snippet from source. Empty string if not found.",
  "confidence": 0.85,
  "hallucination_risk": "low"
}}

Rules:
- answer: concise, direct, from context only
- citations: exact document titles from [Source N: Title] labels
- confidence: 0.0-1.0 float
- hallucination_risk: "low" / "medium" / "high"
- If not in context: answer="Not found in references.", citations=[], confidence=0.0, hallucination_risk="high"
"""

    def _sync_call(self, prompt: str) -> str:
        """Synchronous Groq call — called via run_in_executor to not block event loop"""
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance assistant. Respond with valid JSON only. No markdown, no code fences, no extra text."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        return response.choices[0].message.content.strip()

    async def generate(self, question: str, chunks: List[Dict]) -> Dict:
        context = self._build_context(chunks)
        prompt = self._build_prompt(question, context)

        try:
            # Run sync Groq call in thread pool — prevents blocking FastAPI event loop
            loop = asyncio.get_event_loop()
            raw = await loop.run_in_executor(None, self._sync_call, prompt)

            # Strip markdown fences if model adds them
            clean = re.sub(r"```json|```", "", raw).strip()
            result = json.loads(clean)

            return {
                "answer":             result.get("answer", "Not found in references."),
                "citations":          result.get("citations", []),
                "evidence":           result.get("evidence", ""),
                "confidence":         float(result.get("confidence", 0.0)),
                "hallucination_risk": result.get("hallucination_risk", "high"),
            }

        except json.JSONDecodeError:
            return {
                "answer": "Not found in references.",
                "citations": [],
                "evidence": "",
                "confidence": 0.0,
                "hallucination_risk": "high",
            }
        except Exception as e:
            raise RuntimeError(f"Groq generation failed: {str(e)}")
