const { escapeRegExp } = require("./security");

const DEFAULT_CHUNK_CHARS = 1800;
const DEFAULT_CHUNK_OVERLAP = 220;
const KNOWLEDGE_RECORD_SEPARATOR = "\n\n--- AMIBOT KNOWLEDGE RECORD ---\n\n";
const STRUCTURED_CONTENT_FIELDS = ["Topic", "Answer", "Search phrases", "Tags", "Category"];
const DIRECT_REPLIES = {
  greeting: {
    answer: "Hi! I am AmiBot. Ask me anything from the uploaded AmiBot knowledge.",
    knowledgeQuery: "hello greeting hi hey namaste amibot",
  },
  thanks: {
    answer: "You're welcome! Ask me whenever you need something from the uploaded AmiBot knowledge.",
    knowledgeQuery: "thanks thank you welcome amibot",
  },
  farewell: {
    answer: "Bye! I will be here when you want to ask about the uploaded AmiBot knowledge.",
    knowledgeQuery: "bye goodbye farewell amibot",
  },
};

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
  "did",
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

const QUERY_ALIASES = [
  {
    pattern: /\b(who are you|whats your name|what is your name|your name|full name|preferred name|short name|nickname)\b/,
    terms: ["name", "identity", "who-are-you", "your-name", "full-name", "preferred-name"],
  },
  {
    pattern: /\b(what do you do|profession|occupation|job role|work role|your role)\b/,
    terms: ["profession", "occupation", "job", "role", "what-do-you-do"],
  },
  {
    pattern: /\b(how old|your age|current age)\b/,
    terms: ["age", "how-old", "your-age", "current-age"],
  },
  {
    pattern: /\b(date of birth|birthdate|birthday|dob|when born|when were you born)\b/,
    terms: ["date-of-birth", "birthdate", "birthday", "dob", "when-born"],
  },
  {
    pattern: /\b(where born|birth place|birth city|native place|where were you born)\b/,
    terms: ["birth-place", "where-born", "birth-city", "native-place"],
  },
  {
    pattern: /\b(where are you based|where do you live|current location|living in|base location|based in)\b/,
    terms: ["base-location", "based-in", "current-location", "living-in"],
  },
  {
    pattern: /\b(where do you work|work now|current company|present company|current employer|current organization|current organisation)\b/,
    terms: ["current-organizations", "work-now", "present-company", "current-employer"],
  },
  {
    pattern: /\b(designation|job title|role in company|current designation)\b/,
    terms: ["current-designation", "designation", "job-title", "role-in-company"],
  },
  {
    pattern: /\b(tech stack|tools you use|technologies used)\b/,
    terms: ["skills", "key-skills", "main-skills", "tech-stack", "technologies-used"],
  },
  {
    pattern: /\b(ongoing projects|current projects|dream projects|what are you building|what projects are you building)\b/,
    terms: ["projects", "ongoing-projects", "current-projects", "dream-projects"],
  },
  {
    pattern: /\b(hobbies|interests|free time|leisure|what do you like to do)\b/,
    terms: ["hobbies", "interests", "free-time-activities", "leisure"],
  },
  {
    pattern: /\b(workout|training|fitness routine|health goal|athletic goal|fitness goal)\b/,
    terms: ["fitness", "fitness-routine", "workout", "training", "fitness-goal"],
  },
  {
    pattern: /\b(college|university|degree|qualification|education|where did you study|alma mater|graduation year|schooling|school)\b/,
    terms: ["education", "college", "university", "degree", "qualification", "graduation-year", "schooling"],
  },
  {
    pattern: /\b(married|marital status|single or married|wife|relationship|couple|wedding)\b/,
    terms: ["relationship-status", "marriage", "marital-status", "wife", "couple"],
  },
  {
    pattern: /\b(fav|favorite|favourite|preferred|you like|love to)\b/,
    terms: ["favorite", "favourite", "preferred", "preferences-interests"],
  },
  {
    pattern: /\b(what is amibot|who is amibot|about amibot|amiverse bot|digital soul)\b/,
    terms: ["amibot", "bot-persona", "digital-soul", "amiverse-bot"],
  },
];

function normalizeQuestion(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 4000);
}

function normalizeCasualMessage(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeSearchText(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ");
}

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function normalizeHeaderLabel(value = "") {
  return String(value)
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function parseStructuredContent(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return {};

  const labelPattern = /\b(Topic|Answer|Search phrases|Tags|Category)\s*:/gi;
  const matches = [...text.matchAll(labelPattern)];
  if (!matches.length) return {};

  const fields = {};

  matches.forEach((match, index) => {
    const label = STRUCTURED_CONTENT_FIELDS.find(
      (field) => field.toLowerCase() === match[1].toLowerCase()
    );
    if (!label) return;

    const valueStart = match.index + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? text.length;
    const fieldValue = text
      .slice(valueStart, valueEnd)
      .trim()
      .replace(/^\.+\s*/, "")
      .replace(/\s+/g, " ");

    if (fieldValue) fields[label] = fieldValue;
  });

  return fields;
}

function rowsToSheetText(sheetName, rows = []) {
  const headerRow = Array.isArray(rows[0])
    ? rows[0].map(formatCellValue)
    : [];
  const hasHeader = headerRow.some(Boolean);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const records = [];

  dataRows.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row.map(formatCellValue) : [];
    if (!values.some(Boolean)) return;

    const excelRowNumber = hasHeader ? rowIndex + 2 : rowIndex + 1;
    const lines = [
      `Sheet: ${sheetName || "Sheet 1"}`,
      `Row: ${excelRowNumber}`,
    ];
    const addedStructuredLabels = new Set();

    values.forEach((value, cellIndex) => {
      if (!value) return;

      const rawLabel = hasHeader && headerRow[cellIndex]
        ? headerRow[cellIndex]
        : `Column ${cellIndex + 1}`;
      const label = normalizeHeaderLabel(rawLabel);
      const structuredFields = label.toLowerCase() === "content"
        ? parseStructuredContent(value)
        : {};
      const structuredEntries = STRUCTURED_CONTENT_FIELDS
        .map((field) => [field, structuredFields[field]])
        .filter(([, fieldValue]) => fieldValue);

      if (structuredEntries.length) {
        structuredEntries.forEach(([field, fieldValue]) => {
          addedStructuredLabels.add(field.toLowerCase());
          lines.push(`${field}: ${fieldValue}`);
        });
        return;
      }

      if (addedStructuredLabels.has(label.toLowerCase())) return;
      lines.push(`${label}: ${value}`);
    });

    if (lines.length > 2) records.push(lines.join("\n"));
  });

  return records.join(KNOWLEDGE_RECORD_SEPARATOR);
}

function getDirectAmiBotReply(query = "") {
  const normalized = normalizeCasualMessage(query);
  if (!normalized) return null;

  const greetingPattern =
    /^(hi+|hello+|hey+|heya|hiya|yo|namaste|good (morning|afternoon|evening))( there| amibot| ami| amiverse)?$/;
  const thanksPattern = /^(thanks|thank you|thankyou|thx|ty)( amibot| ami)?$/;
  const farewellPattern = /^(bye|goodbye|see you|see ya|talk to you later)( amibot| ami)?$/;

  if (greetingPattern.test(normalized)) {
    return { type: "greeting", ...DIRECT_REPLIES.greeting };
  }

  if (thanksPattern.test(normalized)) {
    return { type: "thanks", ...DIRECT_REPLIES.thanks };
  }

  if (farewellPattern.test(normalized)) {
    return { type: "farewell", ...DIRECT_REPLIES.farewell };
  }

  return null;
}

function normalizeSearchTokens(query = "", { maxTokens = 12 } = {}) {
  const seen = new Set();
  const tokens = [];
  const normalizedQuery = normalizeSearchText(query);
  const rawTokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter(Boolean);

  const addToken = (value) => {
    const token = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "");

    if (token.length < 3) return;
    if (!token.includes("-") && STOP_WORDS.has(token)) return;
    if (seen.has(token)) return;

    seen.add(token);
    tokens.push(token);
  };

  rawTokens.forEach(addToken);

  if (tokens.length <= 2) {
    for (const alias of QUERY_ALIASES) {
      if (alias.pattern.test(normalizedQuery)) {
        alias.terms.forEach(addToken);
      }
    }
  }

  if (tokens.length <= 2) {
    addShortQueryPhrases(rawTokens, addToken);
  }

  return tokens.slice(0, maxTokens);
}

function addShortQueryPhrases(rawTokens = [], addToken) {
  const phraseWords = rawTokens.filter((token) => token.length >= 2 && token !== "please");

  if (phraseWords.length < 2 || phraseWords.length > 8) return;

  const maxWindow = Math.min(4, phraseWords.length);
  for (let size = maxWindow; size >= 2; size -= 1) {
    for (let index = 0; index <= phraseWords.length - size; index += 1) {
      addToken(phraseWords.slice(index, index + size).join("-"));
    }
  }
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
    const spacedToken = token.replace(/-/g, " ");
    const tokenRegex = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    const spacedRegex = spacedToken !== token
      ? new RegExp(`\\b${escapeRegExp(spacedToken)}\\b`, "i")
      : null;

    if (token.includes("-") && (normalizedText.includes(token) || spacedRegex?.test(normalizedText))) {
      score += 4;
    } else if (tokenRegex.test(normalizedText)) score += 2;
    else if (normalizedText.includes(token)) score += 1;
  }

  return score;
}

function scoreKnowledgeChunks(chunks = [], query = "", options = {}) {
  const tokens = normalizeSearchTokens(query);
  const supplementalTokens = normalizeSearchTokens(options.supplementalQuery || "", {
    maxTokens: options.maxSupplementalTokens || 18,
  }).filter((token) => !tokens.includes(token));
  const primaryWeight = Number.isFinite(options.primaryWeight) ? options.primaryWeight : 1;
  const supplementalWeight = Number.isFinite(options.supplementalWeight)
    ? options.supplementalWeight
    : 1;

  return chunks
    .map((chunk) => ({
      ...chunk,
      relevanceScore:
        Number(chunk.score || chunk.relevanceScore || 0) +
        scoreChunkAgainstTokens(chunk.chunkText || "", tokens) * primaryWeight +
        scoreChunkAgainstTokens(chunk.chunkText || "", supplementalTokens) * supplementalWeight,
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

function chunkKnowledgeText(text = "", options = {}) {
  const records = String(text)
    .split(KNOWLEDGE_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean);

  if (records.length <= 1) return chunkText(text, options);

  return records.flatMap((record) => chunkText(record, options));
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
  KNOWLEDGE_RECORD_SEPARATOR,
  chunkKnowledgeText,
  chunkText,
  formatKnowledgeContext,
  getDirectAmiBotReply,
  makeTokenRegex,
  normalizeQuestion,
  normalizeSearchTokens,
  parseStructuredContent,
  parseStructuredAnswer,
  rowsToSheetText,
  scoreChunkAgainstTokens,
  scoreKnowledgeChunks,
};
