const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["backlog", "todo", "in-progress", "done"],
      default: "todo",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    labels: {
      type: [{ type: String, trim: true, maxlength: 30 }],
      default: [],
    },
    position: { type: Number, default: 0 },
    // Kept in sync for backwards compatibility with older clients and data.
    completed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

taskSchema.index({ userId: 1, status: 1, position: 1 });
taskSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Task", taskSchema);
