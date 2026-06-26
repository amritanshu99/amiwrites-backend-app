const mongoose = require("mongoose");

const amiBotKnowledgeSourceSchema = new mongoose.Schema(
  {
    sourceName: { type: String, required: true, trim: true, maxlength: 240 },
    sourceType: {
      type: String,
      enum: ["pdf", "excel", "manual"],
      required: true,
      index: true,
    },
    originalName: { type: String, trim: true, maxlength: 240 },
    mimeType: { type: String, trim: true, maxlength: 160 },
    size: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    chunkCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

amiBotKnowledgeSourceSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AmiBotKnowledgeSource", amiBotKnowledgeSourceSchema);
