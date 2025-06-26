const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    completed: { type: Boolean, default: false }, // ✅ for productivity tracking
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", taskSchema);