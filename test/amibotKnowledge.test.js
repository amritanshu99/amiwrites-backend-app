const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chunkText,
  normalizeQuestion,
  normalizeSearchTokens,
  parseStructuredAnswer,
  scoreKnowledgeChunks,
} = require("../utils/amibotKnowledge");

test("normalizeQuestion trims, lowercases, and compacts whitespace", () => {
  assert.equal(normalizeQuestion("  What   Is AmiBot?  "), "what is amibot?");
});

test("normalizeSearchTokens removes filler words and keeps useful unique tokens", () => {
  assert.deepEqual(
    normalizeSearchTokens("Tell me about AmiBot projects and AmiBot skills"),
    ["amibot", "projects", "skills"]
  );
});

test("chunkText splits long text into bounded chunks", () => {
  const longParagraphs = Array.from({ length: 10 }, (_, index) =>
    `Paragraph ${index + 1} contains AmiBot knowledge for testing chunk boundaries.`
  ).join("\n\n");

  const chunks = chunkText(longParagraphs, { maxChars: 140, overlap: 20 });

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 180));
  assert.match(chunks.join("\n"), /Paragraph 10/);
});

test("scoreKnowledgeChunks ranks matching chunks above unrelated chunks", () => {
  const scored = scoreKnowledgeChunks(
    [
      {
        _id: "1",
        chunkText: "AmiBot answers from uploaded PDF and Excel knowledge.",
      },
      {
        _id: "2",
        chunkText: "This paragraph is about weather and unrelated notes.",
      },
    ],
    "How does AmiBot use Excel knowledge?"
  );

  assert.equal(scored[0]._id, "1");
  assert.equal(scored.length, 1);
});

test("parseStructuredAnswer accepts raw JSON and fenced JSON", () => {
  assert.deepEqual(
    parseStructuredAnswer('{"answerable":true,"answer":"From the PDF."}'),
    { answerable: true, answer: "From the PDF." }
  );

  assert.deepEqual(
    parseStructuredAnswer('```json\n{"answerable":false,"answer":"Missing."}\n```'),
    { answerable: false, answer: "Missing." }
  );
});

test("parseStructuredAnswer returns null for non-json model text", () => {
  assert.equal(parseStructuredAnswer("Just a sentence."), null);
});
