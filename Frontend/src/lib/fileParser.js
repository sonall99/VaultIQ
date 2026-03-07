// src/lib/fileParser.js
// Parse uploaded files into plain text for reference document storage
// Supports: TXT, PDF (via pdf.js), DOCX (via mammoth)

/**
 * Parse any supported file to plain text
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function parseFileToText(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  switch (ext) {
    case "txt":
    case "md":
      return readAsText(file);

    case "pdf":
      return parsePDF(file);

    case "docx":
      return parseDOCX(file);

    case "csv":
      return parseCSV(file);

    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

async function parsePDF(file) {
  // pdf.js loaded from CDN — add to index.html:
  // <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) throw new Error("PDF.js not loaded");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textPages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    textPages.push(content.items.map(item => item.str).join(" "));
  }
  return textPages.join("\n\n");
}

async function parseDOCX(file) {
  // mammoth.js loaded from CDN — add to index.html:
  // <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
  const mammoth = window.mammoth;
  if (!mammoth) throw new Error("Mammoth.js not loaded");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function parseCSV(file) {
  const text = await readAsText(file);
  // Convert CSV rows to readable text format
  const lines = text.split("\n").filter(Boolean);
  return lines.join("\n");
}

/**
 * Chunk text into overlapping segments for RAG
 * @param {string} text - Full document text
 * @param {number} chunkSize - Words per chunk
 * @param {number} overlap - Overlapping words between chunks
 */
export function chunkText(text, chunkSize = 150, overlap = 30) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim().length > 50) chunks.push(chunk);
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}
