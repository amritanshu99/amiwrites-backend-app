const test = require("node:test");
const assert = require("node:assert/strict");
const ChatMessage = require("../models/AmiBotChatMessage");
const KnowledgeChunk = require("../models/AmiBotKnowledgeChunk");
const KnowledgeSource = require("../models/AmiBotKnowledgeSource");
const Question = require("../models/AmiBotQuestion");
const User = require("../models/Users");
const geminiService = require("../utils/geminiService");

const userId = "507f1f77bcf86cd799439011";
const pendingId = "507f1f77bcf86cd799439012";
const query = "What is the launch date of the next project?";
const unknownReply = "I do not have this answer in the uploaded AmiBot knowledge yet.";

function mockQuery(value) {
  return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

function setup(t, { chunks = [], text = "", existing = null } = {}) {
  const controllerPath = require.resolve("../controllers/amibotController");
  const previousController = require.cache[controllerPath];
  const oldEmbeddings = process.env.AMIBOT_EMBEDDINGS_ENABLED;
  const oldResend = process.env.RESEND_API_KEY;
  process.env.AMIBOT_EMBEDDINGS_ENABLED = "false";
  delete process.env.RESEND_API_KEY;
  t.after(() => {
    if (oldEmbeddings === undefined) delete process.env.AMIBOT_EMBEDDINGS_ENABLED;
    else process.env.AMIBOT_EMBEDDINGS_ENABLED = oldEmbeddings;
    if (oldResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldResend;
    delete require.cache[controllerPath];
    if (previousController) require.cache[controllerPath] = previousController;
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const generate = t.mock.method(geminiService, "generateGeminiText", async () => ({ text }));
  const chatCreate = t.mock.method(ChatMessage, "create", async (message) => message);
  t.mock.method(ChatMessage, "find", () => mockQuery([]));
  t.mock.method(KnowledgeChunk, "find", () => mockQuery(chunks));
  t.mock.method(User, "findById", () => mockQuery({ username: "Reader", email: "reader@example.com" }));
  const questionFind = t.mock.method(Question, "findOne", () => mockQuery(existing));
  const questionCreate = t.mock.method(Question, "create", async (question) => ({ _id: pendingId, ...question }));
  delete require.cache[controllerPath];
  const controller = require("../controllers/amibotController");
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { ...controller, res, generate, chatCreate, questionFind, questionCreate };
}

test("an unknown guest question returns a clear fallback without queuing admin review", async (t) => {
  const { askAmibot, res, generate, questionCreate } = setup(t);
  await askAmibot({ body: { query } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.response, unknownReply);
  assert.equal(res.body.answeredFromKnowledge, false);
  assert.equal(res.body.pendingQuestionId, null);
  assert.deepEqual(res.body.sources, []);
  assert.equal(questionCreate.mock.callCount(), 0);
  assert.equal(generate.mock.callCount(), 0);
});

test("an unknown signed-in question is queued and saved in chat history", async (t) => {
  const { askAmibot, res, questionCreate, chatCreate } = setup(t);
  await askAmibot({ body: { query }, user: { id: userId } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.response, /sent your question to the admin/);
  assert.equal(res.body.pendingQuestionId, pendingId);
  assert.equal(questionCreate.mock.calls[0].arguments[0].userEmail, "reader@example.com");
  assert.deepEqual(chatCreate.mock.calls.map(({ arguments: [message] }) => message.sender), ["user", "bot"]);
  assert.equal(chatCreate.mock.calls[1].arguments[0].metadata.pendingQuestionId, pendingId);
});

test("a repeated unknown question reuses its pending admin review", async (t) => {
  const { askAmibot, res, questionCreate, questionFind } = setup(t, { existing: { _id: pendingId } });
  await askAmibot({ body: { query: `  ${query.toUpperCase()}  ` }, user: { id: userId } }, res);
  assert.equal(res.body.pendingQuestionId, pendingId);
  assert.equal(questionFind.mock.calls[0].arguments[0].normalizedQuestion, query.toLowerCase());
  assert.equal(questionCreate.mock.callCount(), 0);
});

for (const failure of ["lookup", "create"]) {
  test(`admin queue ${failure} failure still returns an honest unknown answer`, async (t) => {
    const { askAmibot, res, chatCreate } = setup(t);
    t.mock.method(Question, failure === "lookup" ? "findOne" : "create", () => {
      throw new Error("Database unavailable");
    });
    await askAmibot({ body: { query }, user: { id: userId } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.response, /could not send your question/);
    assert.equal(res.body.pendingQuestionId, null);
    assert.equal(res.body.answeredFromKnowledge, false);
    assert.equal(chatCreate.mock.callCount(), 2);
  });
}

for (const [name, text] of [
  ["explicit missing answer", JSON.stringify({ answerable: false, answer: "Missing." })],
  ["plain-text refusal", unknownReply],
  ["invalid JSON", '{"answerable":'],
  ["missing answerability", '{"answer":"Unverified answer"}'],
  ["string answerability", '{"answerable":"false","answer":"Missing."}'],
  ["empty answer", '{"answerable":true,"answer":"   "}'],
]) {
  test(`${name} with keyword matches goes to admin instead of claiming knowledge`, async (t) => {
    const { askAmibot, res, generate } = setup(t, {
      chunks: [{ _id: "project", chunkText: "Projects: AmiVerse portfolio", sourceName: "Profile.pdf" }],
      text,
    });
    await askAmibot({ body: { query }, user: { id: userId } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.answeredFromKnowledge, false);
    assert.equal(res.body.pendingQuestionId, pendingId);
    assert.deepEqual(res.body.sources, []);
    assert.match(res.body.response, /sent your question to the admin/);
    assert.equal(generate.mock.callCount(), 1);
    assert.equal(generate.mock.calls[0].arguments[1].generationConfig.responseMimeType, "application/json");
  });
}

test("malformed conversation entries do not break an unknown question", async (t) => {
  const { askAmibot, res } = setup(t);
  await askAmibot({ body: { query, history: [null, "old message", [], 42, { sender: "user", text: "Previous question" }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.response, unknownReply);
});

test("a request without a body is rejected as invalid input", async (t) => {
  const { askAmibot, res } = setup(t);
  await askAmibot({}, res);
  assert.equal(res.statusCode, 400);
});

test("admin knowledge failure leaves the question pending so its answer can be retried", async (t) => {
  const { answerAdminQuestion, res, chatCreate } = setup(t);
  const question = { _id: pendingId, userId, question: query, status: "pending", save: t.mock.fn() };
  t.mock.method(Question, "findById", async () => question);
  t.mock.method(KnowledgeSource, "create", async () => { throw new Error("Storage unavailable"); });
  await answerAdminQuestion({ params: { id: pendingId }, body: { answer: "Launch is next month.", addToKnowledge: true }, user: { id: userId } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(question.status, "pending");
  assert.equal(question.save.mock.callCount(), 0);
  assert.equal(chatCreate.mock.callCount(), 0);
});

test("admin answer is added to knowledge and delivered to the original user", async (t) => {
  const { answerAdminQuestion, res, chatCreate } = setup(t);
  const question = { _id: pendingId, userId, question: query, status: "pending", save: t.mock.fn(async () => {}) };
  t.mock.method(Question, "findById", async () => question);
  t.mock.method(KnowledgeSource, "create", async () => ({ _id: "source-id" }));
  const insertChunks = t.mock.method(KnowledgeChunk, "insertMany", async () => []);
  await answerAdminQuestion({ params: { id: pendingId }, body: { answer: "Launch is next month.", addToKnowledge: true }, user: { id: userId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(question.status, "answered");
  assert.equal(res.body.knowledgeSourceId, "source-id");
  assert.match(insertChunks.mock.calls[0].arguments[0][0].chunkText, /Launch is next month/);
  assert.equal(chatCreate.mock.calls[0].arguments[0].userId, userId);
  assert.equal(chatCreate.mock.calls[0].arguments[0].metadata.answerSource, "admin");
});

test("failed admin answer save removes its newly created knowledge", async (t) => {
  const { answerAdminQuestion, res, chatCreate } = setup(t);
  t.mock.method(Question, "findById", async () => ({
    _id: pendingId, userId, question: query, status: "pending",
    save: async () => { throw new Error("Save failed"); },
  }));
  t.mock.method(KnowledgeSource, "create", async () => ({ _id: "source-id" }));
  t.mock.method(KnowledgeChunk, "insertMany", async () => []);
  const deleteChunks = t.mock.method(KnowledgeChunk, "deleteMany", async () => ({}));
  const deleteSource = t.mock.method(KnowledgeSource, "findByIdAndDelete", async () => ({}));
  await answerAdminQuestion({ params: { id: pendingId }, body: { answer: "Launch is next month.", addToKnowledge: true }, user: { id: userId } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(deleteChunks.mock.calls[0].arguments[0], { sourceId: "source-id" });
  assert.equal(deleteSource.mock.calls[0].arguments[0], "source-id");
  assert.equal(chatCreate.mock.callCount(), 0);
});
