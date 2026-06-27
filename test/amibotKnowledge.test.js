const test = require("node:test");
const assert = require("node:assert/strict");
const {
  KNOWLEDGE_RECORD_SEPARATOR,
  chunkKnowledgeText,
  chunkText,
  cosineSimilarity,
  getDirectAmiBotReply,
  normalizeQuestion,
  normalizeEmbeddingVector,
  normalizeSearchTokens,
  parseStructuredContent,
  parseStructuredAnswer,
  rowsToSheetText,
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

test("rowsToSheetText expands AmiBot API content fields into searchable records", () => {
  const text = rowsToSheetText("AmiBot_API", [
    ["Document_ID", "Content"],
    [
      "AMI-033",
      "Topic: Current Designation. Answer: Associate Consultant Technology at GlobalLogic. Search phrases: designation, role in company, job title. Tags: career, current-designation. Category: Career",
    ],
  ]);

  assert.match(text, /Document ID: AMI-033/);
  assert.match(text, /Topic: Current Designation\./);
  assert.match(text, /Answer: Associate Consultant Technology at GlobalLogic\./);
  assert.match(text, /Search phrases: designation, role in company, job title\./);
  assert.doesNotMatch(text, /Content: Topic:/);
});

test("parseStructuredContent extracts fields from a single API-ready content cell", () => {
  assert.deepEqual(
    parseStructuredContent(
      "Topic: Age. Answer: Currently 29. Search phrases: how old, your age. Tags: personal, age. Category: Personal"
    ),
    {
      Topic: "Age.",
      Answer: "Currently 29.",
      "Search phrases": "how old, your age.",
      Tags: "personal, age.",
      Category: "Personal",
    }
  );
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

test("scoreKnowledgeChunks uses supplemental context without overpowering the current query", () => {
  const scored = scoreKnowledgeChunks(
    [
      {
        _id: "company",
        chunkText: "Topic: Current Organizations\nAnswer: Currently working at GlobalLogic.",
      },
      {
        _id: "designation",
        chunkText: "Topic: Current Designation\nAnswer: Associate Consultant Technology at GlobalLogic.",
      },
    ],
    "What about designation?",
    {
      supplementalQuery: "Where do you work now? Currently working at GlobalLogic.",
      primaryWeight: 3,
    }
  );

  assert.equal(scored[0]._id, "designation");
});

test("scoreKnowledgeChunks can rank chunks by semantic similarity", () => {
  const scored = scoreKnowledgeChunks(
    [
      {
        _id: "career",
        chunkText: "Topic: Work\nAnswer: Associate Consultant Technology.",
        embedding: [0.98, 0.1, 0],
      },
      {
        _id: "fitness",
        chunkText: "Topic: Fitness\nAnswer: Running and strength training.",
        embedding: [0.1, 0.98, 0],
      },
    ],
    "occupation",
    {
      semanticQueryEmbedding: [1, 0, 0],
      semanticWeight: 10,
      minSemanticScore: 0.5,
    }
  );

  assert.equal(scored[0]._id, "career");
  assert.ok(scored[0].semanticScore > scored[1]?.semanticScore || scored.length === 1);
});

test("cosineSimilarity normalizes numeric embedding values", () => {
  assert.deepEqual(normalizeEmbeddingVector(["1", 2, "bad", null]), [1, 2]);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
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
