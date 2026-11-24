const mongoose = require("mongoose");
const { Schema } = mongoose;

const caseSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    query: { type: String, required: true, maxlength: 4000 },
    category: { type: String, default: "General" },
    expectedOutcome: {
      type: String,
      enum: ["knowledge", "unknown", "direct"],
      required: true,
    },
    referenceAnswer: String,
    expectedFacts: [String],
    expectedChunkIds: [String],
    history: [{ _id: false, sender: String, text: String }],
  },
  { timestamps: true },
);

const resultSchema = new Schema(
  {
    caseId: { type: String, required: true },
    fingerprint: String,
    testCase: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "passed", "failed", "error"],
      default: "pending",
    },
    startedAt: Date,
    completedAt: Date,
    output: Schema.Types.Mixed,
    checks: [Schema.Types.Mixed],
    reason: String,
  },
  { _id: false },
);

const runSchema = new Schema(
  {
    evaluatorVersion: { type: String, required: true },
    suiteFingerprint: String,
    config: Schema.Types.Mixed,
    results: [resultSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
runSchema.index({ createdAt: -1 });

module.exports = {
  AmiBotEvalCase: mongoose.model("AmiBotEvalCase", caseSchema),
  AmiBotEvalRun: mongoose.model("AmiBotEvalRun", runSchema),
};
