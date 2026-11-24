const { createHash } = require("node:crypto");

const EVAL_VERSION = "amibot-rag-v1";
const MAX_CASES = 30;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function string(value, label, max, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw invalid(
      `${label} must be ${required ? "nonempty and " : ""}at most ${max} characters.`,
    );
  }
  return value.trim();
}

function validateCase(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid("A test case is required.");
  const outcome = input.expectedOutcome;
  if (!["knowledge", "unknown", "direct"].includes(outcome))
    throw invalid(
      "Choose answer from knowledge, say unknown, or casual reply.",
    );
  const facts = input.expectedFacts ?? [];
  const evidence = input.expectedChunkIds ?? [];
  if (!Array.isArray(facts) || facts.length > 12)
    throw invalid("Use at most 12 expected facts.");
  if (
    !Array.isArray(evidence) ||
    evidence.length > 8 ||
    evidence.some((id) => typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id))
  ) {
    throw invalid("Choose up to 8 valid knowledge passages.");
  }
  const expectedFacts = [
    ...new Set(facts.map((fact) => string(fact, "Each expected fact", 240))),
  ];
  if (expectedFacts.some((fact) => !normalizeFact(fact)))
    throw invalid("Expected facts must contain letters or numbers.");
  if (outcome === "knowledge" && (!expectedFacts.length || !evidence.length)) {
    throw invalid(
      "Knowledge tests need at least one expected fact and one evidence passage.",
    );
  }
  if (outcome !== "knowledge" && evidence.length)
    throw invalid("Evidence passages are only used for knowledge answers.");
  if (outcome === "unknown" && expectedFacts.length)
    throw invalid(
      "Unknown-answer tests check refusal behavior, not expected facts.",
    );
  const history = input.history ?? [];
  if (!Array.isArray(history) || history.length > 8)
    throw invalid("Use at most 8 conversation messages.");
  return {
    title: string(input.title, "Title", 120),
    query: string(input.query, "Question", 4000),
    category: string(input.category || "General", "Category", 60),
    expectedOutcome: outcome,
    referenceAnswer: string(
      input.referenceAnswer || "",
      "Reference answer",
      4000,
      false,
    ),
    expectedFacts,
    expectedChunkIds: [...new Set(evidence)],
    history: history.map((message) => {
      if (!message || !["user", "bot"].includes(message.sender))
        throw invalid("Conversation speakers must be user or bot.");
      return {
        sender: message.sender,
        text: string(message.text, "Conversation message", 1200),
      };
    }),
  };
}

function normalizeFact(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function caseFingerprint(value) {
  const { _id, createdAt, updatedAt, __v, ...definition } = value;
  return createHash("sha256")
    .update(JSON.stringify(definition))
    .digest("hex")
    .slice(0, 16);
}

function scoreResult(testCase, output) {
  if (output.diagnostics?.length) {
    return {
      status: "error",
      checks: [],
      reason: output.diagnostics.join(" "),
    };
  }
  const checks = [
    {
      key: "behavior",
      label: "Answer behavior",
      passed: output.outcome === testCase.expectedOutcome,
      detail: `Expected ${testCase.expectedOutcome}; received ${output.outcome}.`,
    },
  ];
  const answer = ` ${normalizeFact(output.answer)} `;
  if (testCase.expectedFacts.length) {
    const missing = testCase.expectedFacts.filter(
      (fact) => !answer.includes(` ${normalizeFact(fact)} `),
    );
    checks.push({
      key: "facts",
      label: "Expected facts",
      passed: !missing.length,
      score:
        (testCase.expectedFacts.length - missing.length) /
        testCase.expectedFacts.length,
      detail: missing.length
        ? `Missing exact phrases: ${missing.join("; ")}.`
        : "Every expected phrase appears in the answer.",
      missing,
    });
  }
  if (testCase.expectedChunkIds.length) {
    const matches = output.chunks.filter((chunk) =>
      testCase.expectedChunkIds.includes(chunk.id),
    );
    const inContext = matches.filter(
      (chunk) => chunk.contextText && !chunk.contextTruncated,
    );
    const firstRank = matches.length
      ? Math.min(...matches.map((chunk) => chunk.rank))
      : null;
    checks.push({
      key: "evidence",
      label: "Evidence in context",
      passed: inContext.length === testCase.expectedChunkIds.length,
      score: inContext.length / testCase.expectedChunkIds.length,
      firstRank,
      reciprocalRank: firstRank ? 1 / firstRank : 0,
      detail: `${inContext.length} of ${testCase.expectedChunkIds.length} expected passages reached the answer context in full. ${firstRank ? `First retrieved at rank ${firstRank}.` : "None retrieved in the top 8."}`,
    });
  }
  const failed = checks.filter((check) => !check.passed);
  return {
    status: failed.length ? "failed" : "passed",
    checks,
    reason: failed.length
      ? failed.map((check) => check.detail).join(" ")
      : "All configured checks passed. Review the answer for additional unsupported claims.",
  };
}

function summarizeRun(results = []) {
  const count = (status) =>
    results.filter((result) => result.status === status).length;
  const completed = results.filter((result) =>
    ["passed", "failed", "error"].includes(result.status),
  );
  const valid = completed.filter((result) => result.status !== "error");
  const average = (values) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const checkRate = (key) =>
    average(
      valid.flatMap((result) =>
        (result.checks || [])
          .filter((check) => check.key === key)
          .map((check) => Number(check.passed)),
      ),
    );
  const latencies = valid
    .map((result) => result.output?.latencyMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    total: results.length,
    completed: completed.length,
    passed: count("passed"),
    failed: count("failed"),
    errors: count("error"),
    pending: count("pending"),
    running: count("running"),
    passRate: completed.length ? count("passed") / completed.length : null,
    behaviorRate: checkRate("behavior"),
    factsRate: checkRate("facts"),
    evidenceRate: checkRate("evidence"),
    mrr: average(
      valid.flatMap((result) =>
        (result.checks || [])
          .filter((check) => check.key === "evidence")
          .map((check) => check.reciprocalRank),
      ),
    ),
    p95LatencyMs: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
    status:
      completed.length === results.length && results.length
        ? "completed"
        : "incomplete",
  };
}

module.exports = {
  EVAL_VERSION,
  MAX_CASES,
  validateCase,
  caseFingerprint,
  scoreResult,
  summarizeRun,
  normalizeFact,
};
