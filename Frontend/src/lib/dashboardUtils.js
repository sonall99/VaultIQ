export function parseQuestions(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const m = line.match(/^(\d+)[.)]\s+(.+)/);
      if (m) acc.push({ id: `q${m[1]}`, num: Number.parseInt(m[1], 10), text: m[2] });
      return acc;
    }, []);
}

export function suggestRunName(text, count = 0) {
  const firstQuestion = text
    .split("\n")
    .map((l) => l.trim())
    .find((line) => /^(\d+)[.)]\s+(.+)/.test(line));
  const date = new Date().toLocaleDateString();
  if (!firstQuestion) return count ? `Questionnaire (${count} Qs) - ${date}` : "";
  const clean = firstQuestion.replace(/^(\d+)[.)]\s+/, "").replace(/[?.,:;]+$/g, "");
  const title = clean.slice(0, 36).trim();
  return `${title || "Questionnaire"} - ${date}`;
}

export function normalizeDocName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreMatch(needle, title) {
  if (title === needle) return 100;
  if (title.includes(needle) || needle.includes(title)) return 80;

  const titleTokens = new Set(title.split(" ").filter((t) => t.length > 2));
  const needleTokens = new Set(needle.split(" ").filter((t) => t.length > 2));
  const overlap = [...needleTokens].filter((token) => titleTokens.has(token)).length;
  const union = new Set([...titleTokens, ...needleTokens]).size || 1;
  const jaccard = overlap / union;
  return Math.round(jaccard * 100);
}

export function resolveCitationDoc(citation, docs = []) {
  const needle = normalizeDocName(citation);
  if (!needle) return null;

  let best = null;
  let bestScore = -1;

  for (const doc of docs) {
    const title = normalizeDocName(doc.title);
    if (!title) continue;
    const score = scoreMatch(needle, title);
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }

  return bestScore >= 35 ? best : null;
}

export function confBadge(score) {
  if (score >= 0.75) return { label: "High", color: "#22d3a0", bg: "rgba(34,211,160,0.1)", dot: "#22d3a0" };
  if (score >= 0.45) return { label: "Medium", color: "#f59e0b", bg: "rgba(245,158,11,0.1)", dot: "#f59e0b" };
  if (score > 0) return { label: "Low", color: "#f87171", bg: "rgba(248,113,113,0.1)", dot: "#f87171" };
  return { label: "N/A", color: "#4b5563", bg: "rgba(75,85,99,0.1)", dot: "#4b5563" };
}

export function confidenceHint(label) {
  if (label === "High") return "This answer was generated using strong matches from the reference documents.";
  if (label === "Medium") return "Partial matches were found in the reference documents.";
  if (label === "Low") return "Limited supporting context was found in the reference documents.";
  return "No confidence signal is available for this answer.";
}
