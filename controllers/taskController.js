const mongoose = require("mongoose");
const Task = require("../models/Task");
const cache = require("../utils/cache");

const TASK_STATUSES = ["backlog", "todo", "in-progress", "done"];
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"];

function taskCacheKey(userId) {
  return `tasks_${userId}`;
}

function normalizeTask(task) {
  const status = TASK_STATUSES.includes(task.status)
    ? task.status
    : task.completed
      ? "done"
      : "todo";

  return {
    ...task,
    boardType: task.boardType === "daily" ? "daily" : "goals",
    plannedDate: task.plannedDate || null,
    linkedGoalId: task.linkedGoalId || null,
    status,
    priority: TASK_PRIORITIES.includes(task.priority) ? task.priority : "medium",
    labels: Array.isArray(task.labels) ? task.labels : [],
    position: Number.isFinite(task.position)
      ? task.position
      : new Date(task.createdAt).getTime(),
    completed: status === "done",
    completedAt:
      status === "done" ? task.completedAt || task.updatedAt || task.createdAt : null,
  };
}

function cleanLabels(labels) {
  if (!Array.isArray(labels)) return [];

  return [
    ...new Set(
      labels
        .filter((label) => typeof label === "string")
        .map((label) => label.trim())
        .filter(Boolean)
        .slice(0, 8)
    ),
  ];
}

async function validatePlanning({ boardType, plannedDate, linkedGoalId }, userId, taskId) {
  if (!["goals", "daily"].includes(boardType)) throw new Error("Invalid task board");
  if (boardType === "goals") {
    if (plannedDate || linkedGoalId) throw new Error("Only daily tasks can have a planned date or linked goal");
    return;
  }
  if (typeof plannedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) {
    throw new Error("Choose a valid planned date");
  }
  const parsed = new Date(`${plannedDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== plannedDate) {
    throw new Error("Choose a valid planned date");
  }
  if (!linkedGoalId) return;
  if (!mongoose.isObjectIdOrHexString(linkedGoalId) || String(linkedGoalId) === String(taskId)) {
    throw new Error("Invalid linked goal");
  }
  const goal = await Task.findOne({
    _id: linkedGoalId,
    userId,
    $or: [{ boardType: "goals" }, { boardType: { $exists: false } }],
  }).lean();
  if (!goal) throw new Error("Choose a long-term goal from your own board");
}

exports.getAllTasks = async (req, res) => {
  const cacheKey = taskCacheKey(req.user.id);
  const cachedTasks = cache.get(cacheKey);
  if (cachedTasks) return res.json(cachedTasks);

  try {
    const tasks = await Task.find({ userId: req.user.id })
      .sort({ status: 1, position: 1, createdAt: -1 })
      .lean();
    const normalizedTasks = tasks.map(normalizeTask);
    cache.set(cacheKey, normalizedTasks);
    res.json(normalizedTasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTask = async (req, res) => {
  const {
    title,
    description = "",
    status = "backlog",
    priority = "medium",
    dueDate = null,
    labels = [],
    position = Date.now(),
    boardType = "goals",
    plannedDate = null,
    linkedGoalId = null,
  } = req.body;

  if (!TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid task status" });
  }

  if (!TASK_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Invalid task priority" });
  }

  try {
    await validatePlanning({ boardType, plannedDate, linkedGoalId }, req.user.id);
    const task = await Task.create({
      title,
      description,
      status,
      priority,
      boardType,
      plannedDate: plannedDate || null,
      linkedGoalId: linkedGoalId || null,
      dueDate: dueDate || null,
      labels: cleanLabels(labels),
      position: Number.isFinite(Number(position)) ? Number(position) : Date.now(),
      completed: status === "done",
      completedAt: status === "done" ? new Date() : null,
      userId: req.user.id,
    });

    cache.del(taskCacheKey(req.user.id));
    res.status(201).json(normalizeTask(task.toObject()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateTask = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    completed,
    status,
    priority,
    dueDate,
    labels,
    position,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid task id" });
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;

  if (priority !== undefined) {
    if (!TASK_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Invalid task priority" });
    }
    updates.priority = priority;
  }

  if (dueDate !== undefined) updates.dueDate = dueDate || null;
  if (labels !== undefined) updates.labels = cleanLabels(labels);
  if (position !== undefined && Number.isFinite(Number(position))) {
    updates.position = Number(position);
  }

  if (status !== undefined) {
    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid task status" });
    }
    updates.status = status;
    updates.completed = status === "done";
    updates.completedAt = status === "done" ? new Date() : null;
  } else if (completed !== undefined) {
    updates.completed = Boolean(completed);
    updates.status = completed ? "done" : "todo";
    updates.completedAt = completed ? new Date() : null;
  }

  try {
    const existing = await Task.findOne({ _id: id, userId: req.user.id }).lean();
    if (!existing) return res.status(404).json({ error: "Task not found" });
    const boardType = existing.boardType || "goals";
    if (req.body.boardType !== undefined && req.body.boardType !== boardType) {
      return res.status(400).json({ error: "A task must stay on its original board" });
    }
    if (req.body.plannedDate !== undefined) updates.plannedDate = req.body.plannedDate || null;
    if (req.body.linkedGoalId !== undefined) updates.linkedGoalId = req.body.linkedGoalId || null;
    await validatePlanning({
      boardType,
      plannedDate: updates.plannedDate === undefined ? existing.plannedDate : updates.plannedDate,
      linkedGoalId: updates.linkedGoalId === undefined ? existing.linkedGoalId : updates.linkedGoalId,
    }, req.user.id, id);
    const updatedTask = await Task.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedTask) return res.status(404).json({ error: "Task not found" });

    cache.del(taskCacheKey(req.user.id));
    res.json(normalizeTask(updatedTask.toObject()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.reorderTasks = async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
    return res.status(400).json({ error: "A valid task order is required" });
  }

  const invalidItem = items.find(
    (item) =>
      !mongoose.Types.ObjectId.isValid(item.id) ||
      !TASK_STATUSES.includes(item.status) ||
      !Number.isFinite(Number(item.position))
  );

  if (invalidItem) {
    return res.status(400).json({ error: "Invalid task order payload" });
  }

  try {
    await Task.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { _id: item.id, userId: req.user.id },
          update: {
            $set: {
              status: item.status,
              position: Number(item.position),
              completed: item.status === "done",
              completedAt:
                item.status === "done"
                  ? item.completedAt
                    ? new Date(item.completedAt)
                    : new Date()
                  : null,
            },
          },
        },
      }))
    );

    cache.del(taskCacheKey(req.user.id));
    const tasks = await Task.find({ userId: req.user.id })
      .sort({ status: 1, position: 1, createdAt: -1 })
      .lean();
    res.json(tasks.map(normalizeTask));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteTask = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid task id" });
  }

  try {
    const deleted = await Task.findOneAndDelete({ _id: id, userId: req.user.id });
    if (!deleted) return res.status(404).json({ error: "Task not found" });

    // Keep daily work when its parent goal is removed.
    await Task.updateMany(
      { userId: req.user.id, linkedGoalId: id },
      { $set: { linkedGoalId: null } }
    );
    cache.del(taskCacheKey(req.user.id));
    res.json({ message: "Task permanently deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
