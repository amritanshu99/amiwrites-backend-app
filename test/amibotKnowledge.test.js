const test = require("node:test");
const assert = require("node:assert/strict");
const {
  KNOWLEDGE_RECORD_SEPARATOR,
  chunkKnowledgeText,
  chunkText,
  getDirectAmiBotReply,
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

test("normalizeSearchTokens expands natural profile questions into sheet tags", () => {
  assert.deepEqual(
    normalizeSearchTokens("Who are you?").slice(0, 3),
    ["name", "identity", "who-are-you"]
  );

  assert.ok(normalizeSearchTokens("What do you do?").includes("profession"));
});

test("getDirectAmiBotReply handles casual chat without requiring knowledge", () => {
  const reply = getDirectAmiBotReply("Hi");

  assert.equal(reply.type, "greeting");
  assert.equal(
    reply.answer,
    "Hi! I am AmiBot. Ask me anything from the uploaded AmiBot knowledge."
  );
  assert.match(reply.knowledgeQuery, /hello/);

  assert.equal(getDirectAmiBotReply("How does AmiBot use knowledge?"), null);
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

test("chunkKnowledgeText keeps imported sheet records separate", () => {
  const chunks = chunkKnowledgeText(
    [
      "Sheet: AmiBot_API\nRow: 2\nContent: Topic: Name. Answer: Ami.",
      "Sheet: AmiBot_API\nRow: 3\nContent: Topic: Age. Answer: 29.",
    ].join(KNOWLEDGE_RECORD_SEPARATOR)
  );

  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /Topic: Name/);
  assert.match(chunks[1], /Topic: Age/);
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
