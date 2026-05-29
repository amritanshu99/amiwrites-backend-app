const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  slug: { type: String, index: true },
  category: { type: String, index: true },
  words: Number,
  publishedAt: { type: Date, index: true },
  date: { type: Date, default: Date.now }
});

blogSchema.index({ date: -1 });
blogSchema.index({ title: 1 });

module.exports = mongoose.model("Blog", blogSchema);
