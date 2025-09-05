// models/BlogStat.js
const mongoose = require("mongoose");

const BlogStatSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Blog", unique: true, index: true },
    alpha: { type: Number, default: 1.5 }, // Thompson Sampling priors
    beta:  { type: Number, default: 1.0 },
    impressions:   { type: Number, default: 0 },
    clicks:        { type: Number, default: 0 },
    engaged_count: { type: Number, default: 0 },
    words: { type: Number, default: 0 },
    category: { type: String, index: true },
    publishedAt: { type: Date, index: true },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BlogStat", BlogStatSchema);