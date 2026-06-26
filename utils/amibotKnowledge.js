const { escapeRegExp } = require("./security");

const DEFAULT_CHUNK_CHARS = 1800;
const DEFAULT_CHUNK_OVERLAP = 220;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "am",
  "an",
  "and",
  "are",
  "as",
  "ask",
  "be",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "give",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "show",
  "tell",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function normalizeQuestion(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 4000);
}

function normalizeSearchTokens(query = "", { maxTokens = 12 } = {}) {
  const seen = new Set();
  const tokens = String(query)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });

  return tokens.slice(0, maxTokens);
}

function makeTokenRegex(tokens) {
  if (!tokens.length) return null;
  return new RegExp(tokens.map(escapeRegExp).join("|"), "i");
}

function scoreChunkAgainstTokens(chunkText = "", tokens = []) {
  if (!tokens.length) return 0;

  const normalizedText = String(chunkText).toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const tokenRegex = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (tokenRegex.test(normalizedText)) score += 2;
    else if (normalizedText.includes(token)) score += 1;
  }

  return score;
}

function scoreKnowledgeChunks(chunks = [], query = "") {
  const tokens = normalizeSearchTokens(query);

  return chunks
    .map((chunk) => ({
      ...chunk,
      relevanceScore:
        Number(chunk.score || chunk.relevanceScore || 0) +
        scoreChunkAgainstTokens(chunk.chunkText || "", tokens),
    }))
    .filter((chunk) => chunk.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function splitLongParagraph(paragraph, maxChars) {
  const parts = [];
  let remaining = paragraph.trim();

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(" ", maxChars);
    if (splitAt < Math.floor(maxChars * 0.55)) splitAt = maxChars;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

function chunkText(text = "", { maxChars = DEFAULT_CHUNK_CHARS, overlap = DEFAULT_CHUNK_OVERLAP } = {}) {
  const normalizedText = String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalizedText) return [];

  const paragraphs = normalizedText
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxChars))
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    const previousTail = overlap > 0 && current.length > overlap
      ? current.slice(-overlap)
      : "";
    current = previousTail ? `${previousTail}\n\n${paragraph}` : paragraph;
  }

  if (current) chunks.push(current);
  return chunks;
}

function formatKnowledgeContext(chunks = [], maxChars = 7000) {
  let usedChars = 0;
  const formatted = [];

  for (const chunk of chunks) {
    const label = `Source: ${chunk.sourceName || "AmiBot knowledge"} | Chunk ${chunk.chunkIndex ?? "?"}`;
    const block = `[${label}]\n${chunk.chunkText || ""}`.trim();
    if (!block) continue;

    if (usedChars + block.length > maxChars && formatted.length) break;

    const available = Math.max(0, maxChars - usedChars);
    formatted.push(block.slice(0, available));
    usedChars += Math.min(block.length, available);
  }

  return formatted.join("\n\n---\n\n");
}

function parseStructuredAnswer(raw = "") {
  const text = String(raw).trim();
  if (!text) return null;

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [unfenced];
  const objectMatch = unfenced.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.answer === "string") {
        return {
          answer: parsed.answer.trim(),
          answerable: parsed.answerable !== false,
        };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

module.exports = {
  chunkText,
  formatKnowledgeContext,
  makeTokenRegex,
  normalizeQuestion,
  normalizeSearchTokens,
  parseStructuredAnswer,
  scoreChunkAgainstTokens,
  scoreKnowledgeChunks,
};
