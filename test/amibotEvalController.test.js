const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const { AmiBotEvalCase, AmiBotEvalRun } = require("../models/AmiBotEval");
const KnowledgeChunk = require("../models/AmiBotKnowledgeChunk");
const ChatMessage = require("../models/AmiBotChatMessage");
const Question = require("../models/AmiBotQuestion");
const User = require("../models/Users");
const gemini = require("../utils/geminiService");

const id = "507f1f77bcf86cd799439011";
const caseId = "507f1f77bcf86cd799439012";
const definition = {
  _id: caseId,
  title: "Role",
  category: "Career",
  query: "What is your designation?",
  expectedOutcome: "knowledge",
  expectedFacts: ["Platform Engineer"],
  expectedChunkIds: [id],
  history: [],
};
const chunk = {
  _id: id,
  sourceId: id,
  sourceName: "Profile",
  chunkIndex: 0,
  chunkText: "Topic: Designation\nAnswer: Platform Engineer.",
  updatedAt: new Date(),
};
const chain = (value) => ({
  sort() {
    return this;
  },
  select() {
    return this;
  },
  limit() {
    return this;
  },
  lean: async () => value,
});
const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

function setup(
  t,
  {
    text = '{"answerable":true,"answer":"Platform Engineer."}',
    chunks = [chunk],
  } = {},
) {
  const controllerPath = require.resolve("../controllers/amibotController");
  const evalPath = require.resolve("../controllers/amibotEvalController");
  const old = {
    controller: require.cache[controllerPath],
    eval: require.cache[evalPath],
    embeddings: process.env.AMIBOT_EMBEDDINGS_ENABLED,
  };
  process.env.AMIBOT_EMBEDDINGS_ENABLED = "false";
  t.after(() => {
    delete require.cache[controllerPath];
    delete require.cache[evalPath];
    if (old.controller) require.cache[controllerPath] = old.controller;
    if (old.eval) require.cache[evalPath] = old.eval;
    if (old.embeddings === undefined)
      delete process.env.AMIBOT_EMBEDDINGS_ENABLED;
    else process.env.AMIBOT_EMBEDDINGS_ENABLED = old.embeddings;
  });
  t.mock.method(console, "error", () => {});
  const generate = t.mock.method(gemini, "generateGeminiText", async () => ({
    text,
    model: "test-model",
  }));
  t.mock.method(KnowledgeChunk, "find", () => chain(chunks));
  t.mock.method(KnowledgeChunk, "countDocuments", async () => chunks.length);
  t.mock.method(KnowledgeChunk, "findOne", () => chain(chunk));
  const chatWrite = t.mock.method(ChatMessage, "create", () => {
    throw new Error("Eval attempted chat write");
  });
  const questionWrite = t.mock.method(Question, "create", () => {
    throw new Error("Eval attempted admin notification");
  });
  delete require.cache[controllerPath];
  delete require.cache[evalPath];
  return {
    rag: require("../controllers/amibotController"),
    controller: require("../controllers/amibotEvalController"),
    generate,
    chatWrite,
    questionWrite,
  };
}

test("shared eval path uses actual retrieval, conversation, and generation without chat side effects", async (t) => {
  const { rag, generate, chatWrite, questionWrite } = setup(t);
  const result = await rag.resolveAmiBotAnswer(definition.query, {
    history: [{ sender: "user", text: "Tell me about your work." }],
  });
  assert.equal(result.outcome, "knowledge");
  assert.equal(result.model, "test-model");
  assert.equal(result.chunks[0].id, id);
  assert.match(result.chunks[0].contextText, /Platform Engineer/);
  assert.match(generate.mock.calls[0].arguments[0], /Tell me about your work/);
  assert.equal(chatWrite.mock.callCount(), 0);
  assert.equal(questionWrite.mock.callCount(), 0);
});
test("invalid model output is an eval diagnostic, not a successful unknown answer", async (t) => {
  const { rag } = setup(t, { text: "I don't know" });
  const result = await rag.resolveAmiBotAnswer(definition.query);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.diagnostics.length, 1);
});
test("retrieval outages are surfaced even when the resulting answer is unknown", async (t) => {
  const { rag } = setup(t);
  t.mock.method(KnowledgeChunk, "find", () => ({
    ...chain([]),
    lean: async () => {
      throw new Error("database offline");
    },
  }));
  const result = await rag.resolveAmiBotAnswer(definition.query);
  assert.equal(result.outcome, "unknown");
  assert.ok(result.diagnostics.includes("Keyword search failed."));
});
test("empty retrieval and greetings skip generation and never create review questions", async (t) => {
  const { rag, generate, questionWrite } = setup(t, { chunks: [] });
  assert.equal((await rag.resolveAmiBotAnswer("Hi")).outcome, "direct");
  assert.equal(
    (await rag.resolveAmiBotAnswer("quasar luminosity")).outcome,
    "unknown",
  );
  assert.equal(generate.mock.callCount(), 0);
  assert.equal(questionWrite.mock.callCount(), 0);
});
test("save rejects deleted evidence and invalid case IDs before writing", async (t) => {
  const { controller } = setup(t, { chunks: [] });
  const create = t.mock.method(AmiBotEvalCase, "create", () => {
    throw new Error("unexpected write");
  });
  const res = response();
  await controller.saveCase({ params: {}, body: definition }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /no longer exists/);
  await controller.saveCase({ params: { id: "bad" }, body: definition }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(create.mock.callCount(), 0);
});
test("create run snapshots definitions and configuration before execution", async (t) => {
  const { controller, generate } = setup(t);
  t.mock.method(AmiBotEvalCase, "find", () => chain([definition]));
  const create = t.mock.method(AmiBotEvalRun, "create", async (value) => ({
    toObject: () => ({ _id: id, ...value }),
  }));
  const res = response();
  await controller.createRun({ user: { id } }, res);
  assert.equal(res.statusCode, 201);
  const stored = create.mock.calls[0].arguments[0];
  assert.equal(stored.results[0].testCase.query, definition.query);
  assert.equal(stored.results[0].status, "pending");
  assert.ok(stored.suiteFingerprint);
  assert.equal(stored.config.topK, 8);
  assert.equal(stored.config.knowledgeCount, 1);
  assert.equal(generate.mock.callCount(), 0);
});
test("execution claims once, persists score, and refuses repeated requests", async (t) => {
  const { controller, generate } = setup(t);
  const run = {
    _id: id,
    results: [{ caseId, testCase: definition, status: "pending" }],
  };
  const updates = [];
  t.mock.method(AmiBotEvalRun, "findOneAndUpdate", (criteria, update) => {
    updates.push(update);
    if (criteria.results.$elemMatch.status !== run.results[0].status)
      return chain(null);
    for (const [key, value] of Object.entries(update.$set))
      run.results[0][key.replace("results.$.", "")] = value;
    return chain(run);
  });
  const res = response();
  await controller.executeCase({ params: { id, caseId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.run.summary.passRate, 1);
  assert.equal(run.results[0].output.answer, "Platform Engineer.");
  assert.equal(updates.length, 2);
  await controller.executeCase({ params: { id, caseId } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(generate.mock.callCount(), 1);
});
test("provider failure persists an error instead of leaving a running case", async (t) => {
  const { controller } = setup(t);
  // The controller captures this mocked function at load time.
  gemini.generateGeminiText.mock.mockImplementation(async () => {
    throw new Error("provider unavailable");
  });
  const run = {
    _id: id,
    results: [{ caseId, testCase: definition, status: "pending" }],
  };
  t.mock.method(AmiBotEvalRun, "findOneAndUpdate", (criteria, update) => {
    for (const [key, value] of Object.entries(update.$set))
      run.results[0][key.replace("results.$.", "")] = value;
    return chain(run);
  });
  const res = response();
  await controller.executeCase({ params: { id, caseId } }, res);
  assert.equal(res.body.run.summary.errors, 1);
  assert.equal(res.body.run.summary.passRate, 0);
  assert.equal(run.results[0].status, "error");
});
test("every eval endpoint enforces authentication and admin access over HTTP", async (t) => {
  setup(t);
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "eval-test-only-secret";
  t.after(() => {
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  t.mock.method(User, "findById", () =>
    chain({ _id: id, username: "reader", authVersion: 0 }),
  );
  const app = express();
  app.use(express.json());
  app.use("/api/amibot", require("../routes/amibotRoutes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/amibot/admin/evals`;
  const token = jwt.sign({ id, username: "reader" }, process.env.JWT_SECRET, {
    expiresIn: "5m",
  });
  for (const [method, path] of [
    ["GET", "/cases"],
    ["POST", "/cases"],
    ["PUT", `/cases/${id}`],
    ["DELETE", `/cases/${id}`],
    ["GET", "/evidence"],
    ["GET", "/runs"],
    ["POST", "/runs"],
    ["GET", `/runs/${id}`],
    ["POST", `/runs/${id}/cases/${caseId}`],
  ]) {
    assert.equal(
      (await fetch(base + path, { method })).status,
      401,
      `${method} ${path} anonymous`,
    );
    assert.equal(
      (
        await fetch(base + path, {
          method,
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      403,
      `${method} ${path} non-admin`,
    );
  }
});
