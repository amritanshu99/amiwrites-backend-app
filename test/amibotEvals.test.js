const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCase,
  scoreResult,
  summarizeRun,
  caseFingerprint,
} = require("../utils/amibotEvals");
const { buildKnowledgeContext } = require("../utils/amibotKnowledge");
const { runOfflineEvals } = require("../evals/amibot/run");

const id = "507f1f77bcf86cd799439011";
const definition = {
  title: "Role",
  query: "What is your role?",
  category: "Career",
  expectedOutcome: "knowledge",
  expectedFacts: ["Platform Engineer", "Northstar Labs"],
  expectedChunkIds: [id],
  referenceAnswer: "Platform Engineer at Northstar Labs.",
  history: [],
};
const output = {
  outcome: "knowledge",
  answer: "A platform-engineer at Northstar Labs.",
  diagnostics: [],
  latencyMs: 100,
  chunks: [
    { id, rank: 2, contextText: "Platform Engineer at Northstar Labs." },
  ],
};

test("offline retrieval benchmark has no regressions", () => {
  const failed = runOfflineEvals().filter((result) => !result.passed);
  assert.deepEqual(failed, []);
});
test("case validation rejects vacuous, malformed, and oversized expectations", () => {
  assert.equal(validateCase(definition).expectedFacts.length, 2);
  for (const override of [
    { expectedFacts: [] },
    { expectedChunkIds: [] },
    { query: " " },
    { title: 5 },
    { expectedFacts: ["!!!"] },
    { expectedFacts: [false] },
    { expectedChunkIds: ["invalid"] },
    { history: [null] },
    { history: [{ sender: "system", text: "test" }] },
    { query: "x".repeat(4001) },
    { expectedOutcome: "unknown" },
    { expectedOutcome: "invalid" },
  ]) {
    assert.throws(() => validateCase({ ...definition, ...override }), {
      status: 400,
    });
  }
  assert.throws(() => validateCase(null), { status: 400 });
});
test("all configured checks must pass and rank is recorded", () => {
  const score = scoreResult(definition, output);
  assert.equal(score.status, "passed");
  assert.equal(
    score.checks.find((check) => check.key === "evidence").reciprocalRank,
    0.5,
  );
  assert.equal(
    scoreResult(definition, { ...output, outcome: "unknown" }).status,
    "failed",
  );
  assert.equal(
    scoreResult(definition, { ...output, answer: "Platform engineer" }).status,
    "failed",
  );
  assert.equal(
    scoreResult(definition, { ...output, chunks: [] }).status,
    "failed",
  );
});
test("phrase checks use boundaries and preserve Unicode", () => {
  const value = {
    ...definition,
    expectedFacts: ["art", "हिंदी"],
    expectedChunkIds: [],
  };
  assert.equal(
    scoreResult(value, { ...output, answer: "cart हिंदी" }).status,
    "failed",
  );
  assert.equal(
    scoreResult(value, { ...output, answer: "Art, हिंदी!" }).status,
    "passed",
  );
});
test("retrieved evidence excluded from context does not pass", () => {
  const score = scoreResult(definition, {
    ...output,
    chunks: [{ id, rank: 8, contextText: "" }],
  });
  assert.equal(score.status, "failed");
  assert.equal(scoreResult(definition, {
    ...output,
    chunks: [{ id, rank: 1, contextText: "Partial passage", contextTruncated: true }],
  }).status, "failed");
  assert.equal(score.checks.find((check) => check.key === "evidence").score, 0);
});
test("pipeline failures cannot count as correct abstentions", () => {
  const value = {
    ...definition,
    expectedOutcome: "unknown",
    expectedFacts: [],
    expectedChunkIds: [],
  };
  assert.equal(
    scoreResult(value, {
      ...output,
      outcome: "unknown",
      diagnostics: ["Keyword search failed."],
    }).status,
    "error",
  );
  assert.equal(
    scoreResult(value, { ...output, outcome: "unknown" }).status,
    "passed",
  );
});
test("empty and partial runs do not fabricate perfect scores; errors lower the overall rate", () => {
  assert.equal(summarizeRun([]).passRate, null);
  const summary = summarizeRun([
    {
      status: "passed",
      output,
      checks: scoreResult(definition, output).checks,
    },
    { status: "error" },
    { status: "pending" },
  ]);
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.completed, 2);
  assert.equal(summary.total, 3);
  assert.equal(summary.status, "incomplete");
  assert.equal(summary.evidenceRate, 1);
  assert.equal(summary.p95LatencyMs, 100);
});
test("context trace reports exactly the included text", () => {
  const context = buildKnowledgeContext(
    [
      { _id: id, sourceName: "One", chunkText: "a".repeat(80) },
      { _id: "second", chunkText: "b".repeat(80) },
    ],
    60,
  );
  assert.equal(context.context.length, 60);
  assert.equal(context.chunks.length, 1);
  assert.equal(context.chunks[0].contextText, context.context);
});
test("case fingerprint ignores storage metadata and changes when expectations change", () => {
  assert.equal(
    caseFingerprint(definition),
    caseFingerprint({ ...definition, _id: id, updatedAt: "later" }),
  );
  assert.notEqual(
    caseFingerprint(definition),
    caseFingerprint({ ...definition, expectedFacts: ["different"] }),
  );
});
