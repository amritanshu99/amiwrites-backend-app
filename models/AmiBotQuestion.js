const mongoose = require("mongoose");

const amiBotQuestionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    username: { type: String, trim: true, maxlength: 80 },
    userEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    question: { type: String, required: true, maxlength: 4000 },
    normalizedQuestion: { type: String, required: true, maxlength: 4000, index: true },
    status: {
      type: String,
      enum: ["pending", "answered", "closed"],
      default: "pending",
      index: true,
    },
    adminAnswer: { type: String, maxlength: 12000 },
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    emailNotifiedAt: { type: Date },
    answeredAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

amiBotQuestionSchema.index({ status: 1, createdAt: -1 });
amiBotQuestionSchema.index({ userId: 1, normalizedQuestion: 1, status: 1 });

module.exports = mongoose.model("AmiBotQuestion", amiBotQuestionSchema);
