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
  } = req.body;

  if (!TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid task status" });
  }

  if (!TASK_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Invalid task priority" });
  }

  try {
    const task = await Task.create({
      title,
      description,
      status,
      priority,
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

    cache.del(taskCacheKey(req.user.id));
    res.json({ message: "Task permanently deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
