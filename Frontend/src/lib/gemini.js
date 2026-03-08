const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = 45000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.ok) return response;

      if (response.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError || new Error("Request failed");
}

export async function checkBackendHealth() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(`${BACKEND_URL}/health`, {}, 15000);
      if (res.ok) return true;
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
  }
  return false;
}


export async function ingestDocument(docId, title, content) {
  const res = await fetchWithRetry(`${BACKEND_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, title, content }),
  });
  if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
  return res.json();
}

export async function ingestFile(file, docId, title) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("doc_id", docId || file.name);
  formData.append("title", title || file.name);

  const res = await fetchWithRetry(
    `${BACKEND_URL}/ingest-file`,
    { method: "POST", body: formData },
    1,
    90000,
  );
  if (!res.ok) throw new Error(`File ingest failed: ${res.status}`);
  return res.json();
}

export async function bulkGenerate(questions, onProgress) {
  try {
    const res = await fetchWithRetry(
      `${BACKEND_URL}/bulk-generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions, top_k: 5 }),
      },
      2,
      120000,
    );

    if (res.ok) {
      const data = await res.json();
      onProgress(questions.length, questions.length, "Complete");
      return data.results;
    }
  } catch {
    // Fall through to sequential strategy.
  }

  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    onProgress(i, questions.length, q.text);

    try {
      const res = await fetchWithRetry(
        `${BACKEND_URL}/generate-answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q.text, top_k: 5 }),
        },
        1,
        60000,
      );

      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      results.push({ ...q, ...data });
    } catch {
      results.push({
        ...q,
        answer: "Not found in references.",
        citations: [],
        evidence: "",
        confidence: 0,
        hallucination_risk: "high",
      });
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  return results;
}

export async function generateSingle(question) {
  const res = await fetchWithRetry(
    `${BACKEND_URL}/generate-answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, top_k: 5 }),
    },
    1,
    60000,
  );

  if (!res.ok) throw new Error(`Generate failed: ${res.status}`);
  return res.json();
}

export async function listIngestedDocs() {
  const res = await fetchWithRetry(`${BACKEND_URL}/documents`, {}, 1, 30000);
  if (!res.ok) throw new Error("Failed to list documents");
  return res.json();
}

export async function deleteFromVectorStore(docId) {
  const res = await fetchWithRetry(
    `${BACKEND_URL}/documents/${docId}`,
    { method: "DELETE" },
    1,
    30000,
  );
  if (!res.ok) throw new Error("Failed to delete from vector store");
  return res.json();
}

export async function getDocumentPreview(docId) {
  const res = await fetchWithRetry(
    `${BACKEND_URL}/documents/${encodeURIComponent(docId)}/preview`,
    {},
    1,
    30000,
  );
  if (!res.ok) throw new Error("Failed to fetch document preview");
  return res.json();
}
