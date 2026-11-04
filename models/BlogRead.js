const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "Blog", required: true },
  readerKey: { type: String, required: true },
  day: { type: String, required: true },
  recordedAt: { type: Date, required: true },
});

// Server-enforced deduplication survives refreshes, retries and concurrent tabs.
schema.index({ postId: 1, readerKey: 1, day: 1 }, { unique: true });
schema.index({ recordedAt: 1, postId: 1 });

module.exports = mongoose.model("BlogRead", schema);
