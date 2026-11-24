const { AmiBotEvalCase, AmiBotEvalRun } = require("../models/AmiBotEval");
const KnowledgeChunk = require("../models/AmiBotKnowledgeChunk");
const { resolveAmiBotAnswer, getAmiBotRagConfig } = require("./amibotController");
const {
  getGeminiModels,
  getGeminiEmbeddingModel,
} = require("../utils/geminiService");
const {
  EVAL_VERSION,
  MAX_CASES,
  validateCase,
  caseFingerprint,
  scoreResult,
  summarizeRun,
} = require("../utils/amibotEvals");

const validId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const serializeRun = (run) => ({ ...run, summary: summarizeRun(run.results) });
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error("AmiBot eval request failed:", error.message);
      res
        .status(error.status || 500)
        .json({
          error: error.status
            ? error.message
            : "Could not save or load evaluations. Please try again.",
        });
    }
  };
}
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function definition(body) {
  const value = validateCase(body);
  if (value.expectedChunkIds.length) {
    const count = await KnowledgeChunk.countDocuments({
      _id: { $in: value.expectedChunkIds },
    });
    if (count !== value.expectedChunkIds.length)
      fail(
        400,
        "An evidence passage no longer exists. Choose an active passage.",
      );
  }
  return value;
}

exports.listCases = handler(async (req, res) => {
  const cases = await AmiBotEvalCase.find()
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();
  res.json({ cases, maxCasesPerRun: MAX_CASES });
});
exports.saveCase = handler(async (req, res) => {
  if (req.params.id && !validId(req.params.id))
    fail(400, "Invalid test case ID.");
  const value = await definition(req.body);
  let saved;
  if (req.params.id) {
    saved = await AmiBotEvalCase.findByIdAndUpdate(
      req.params.id,
      { $set: value },
      { new: true, runValidators: true },
    ).lean();
    if (!saved) fail(404, "Test case not found.");
  } else {
    if ((await AmiBotEvalCase.countDocuments()) >= MAX_CASES)
      fail(
        400,
        `This suite supports up to ${MAX_CASES} cases. Edit or remove an existing case first.`,
      );
    saved = (await AmiBotEvalCase.create(value)).toObject();
  }
  res.status(req.params.id ? 200 : 201).json({ testCase: saved });
});
exports.deleteCase = handler(async (req, res) => {
  if (!validId(req.params.id)) fail(400, "Invalid test case ID.");
  const result = await AmiBotEvalCase.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) fail(404, "Test case not found.");
  res.json({ deleted: true });
});
exports.listEvidence = handler(async (req, res) => {
  const query = String(req.query.q || "")
    .trim()
    .slice(0, 120);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const criteria = query ? { chunkText: new RegExp(escaped, "i") } : {};
  const chunks = await KnowledgeChunk.find(criteria)
    .select("sourceId sourceName chunkIndex chunkText")
    .sort({ createdAt: -1 })
    .limit(25)
    .lean();
  res.json({ chunks });
});
exports.createRun = handler(async (req, res) => {
  const cases = await AmiBotEvalCase.find()
    .sort({ createdAt: 1 })
    .limit(MAX_CASES + 1)
    .lean();
  if (!cases.length) fail(400, "Add a test case before running evaluations.");
  if (cases.length > MAX_CASES)
    fail(400, `A run supports at most ${MAX_CASES} cases.`);
  const config = {
    models: getGeminiModels(),
    embeddingModel: getGeminiEmbeddingModel(),
    ...getAmiBotRagConfig(),
    knowledgeCount: await KnowledgeChunk.countDocuments(),
    knowledgeUpdatedAt:
      (
        await KnowledgeChunk.findOne()
          .sort({ updatedAt: -1 })
          .select("updatedAt")
          .lean()
      )?.updatedAt || null,
  };
  const results = cases.map((testCase) => ({
    caseId: String(testCase._id),
    fingerprint: caseFingerprint(testCase),
    testCase,
    status: "pending",
  }));
  const run = await AmiBotEvalRun.create({
    evaluatorVersion: EVAL_VERSION,
    config,
    suiteFingerprint: caseFingerprint({
      cases: results.map((result) => [result.caseId, result.fingerprint]),
    }),
    createdBy: req.user?.id || req.user?._id,
    results,
  });
  res.status(201).json({ run: serializeRun(run.toObject()) });
});

exports.listRuns = handler(async (req, res) => {
  const runs = await AmiBotEvalRun.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .select("-results.output.chunks -results.output.answer -results.testCase")
    .lean();
  res.json({ runs: runs.map(serializeRun) });
});

async function expireStaleCases(runId) {
  await AmiBotEvalRun.updateOne(
    { _id: runId },
    {
      $set: {
        "results.$[stale].status": "error",
        "results.$[stale].reason":
          "Execution was interrupted or exceeded five minutes. Start a new run to retry.",
        "results.$[stale].completedAt": new Date(),
      },
    },
    {
      arrayFilters: [
        {
          "stale.status": "running",
          "stale.startedAt": { $lt: new Date(Date.now() - 300000) },
        },
      ],
    },
  );
}
exports.getRun = handler(async (req, res) => {
  if (!validId(req.params.id)) fail(400, "Invalid run ID.");
  await expireStaleCases(req.params.id);
  const run = await AmiBotEvalRun.findById(req.params.id).lean();
  if (!run) fail(404, "Evaluation run not found.");
  res.json({ run: serializeRun(run) });
});

exports.executeCase = handler(async (req, res) => {
  const { id, caseId } = req.params;
  if (!validId(id) || !validId(caseId)) fail(400, "Invalid run or case ID.");
  // Atomic claim: repeated requests never execute the same case twice.
  const run = await AmiBotEvalRun.findOneAndUpdate(
    { _id: id, results: { $elemMatch: { caseId, status: "pending" } } },
    {
      $set: {
        "results.$.status": "running",
        "results.$.startedAt": new Date(),
      },
    },
    { new: true },
  ).lean();
  if (!run)
    fail(
      409,
      "This case is already running or completed. Refresh the run to see its result.",
    );
  const testCase = run.results.find(
    (result) => result.caseId === caseId,
  ).testCase;
  let result;
  try {
    const output = await resolveAmiBotAnswer(testCase.query, {
      history: testCase.history,
    });
    result = { ...scoreResult(testCase, output), output };
  } catch (error) {
    console.error("AmiBot eval execution failed:", error.message);
    result = {
      status: "error",
      checks: [],
      reason:
        "The RAG pipeline could not complete this case. Check model availability and backend logs, then start a new run.",
    };
  }
  const updates = Object.fromEntries(
    Object.entries({ ...result, completedAt: new Date() }).map(
      ([key, value]) => [`results.$.${key}`, value],
    ),
  );
  const saved = await AmiBotEvalRun.findOneAndUpdate(
    { _id: id, results: { $elemMatch: { caseId, status: "running" } } },
    { $set: updates },
    { new: true },
  ).lean();
  if (!saved)
    fail(
      409,
      "This execution expired. Refresh the run and retry in a new run.",
    );
  res.json({ run: serializeRun(saved) });
});
