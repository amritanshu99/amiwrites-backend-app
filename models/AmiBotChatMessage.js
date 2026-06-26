const mongoose = require("mongoose");

const amiBotChatMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sender: {
      type: String,
      enum: ["user", "bot", "admin"],
      required: true,
    },
    text: { type: String, required: true, maxlength: 12000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

amiBotChatMessageSchema.index({ userId: 1, createdAt: 1 });

module.exports = mongoose.model("AmiBotChatMessage", amiBotChatMessageSchema);
