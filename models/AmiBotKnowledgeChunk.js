const mongoose = require("mongoose");

const amiBotKnowledgeChunkSchema = new mongoose.Schema(
  {
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AmiBotKnowledgeSource",
      required: true,
      index: true,
    },
    sourceName: { type: String, required: true, trim: true, maxlength: 240 },
    sourceType: {
      type: String,
      enum: ["pdf", "excel", "manual"],
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true },
    chunkText: { type: String, required: true },
    embedding: { type: [Number], default: undefined },
    embeddingModel: { type: String, trim: true },
    embeddedAt: { type: Date },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

amiBotKnowledgeChunkSchema.index({ chunkText: "text", sourceName: "text" });
amiBotKnowledgeChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
amiBotKnowledgeChunkSchema.index({ embeddingModel: 1, embeddedAt: -1 });

module.exports = mongoose.model("AmiBotKnowledgeChunk", amiBotKnowledgeChunkSchema);
