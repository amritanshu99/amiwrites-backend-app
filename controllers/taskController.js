const mongoose = require("mongoose");
const Task = require("../models/Task");
const cache = require("../utils/cache");

function taskCacheKey(userId) {
  return `tasks_${userId}`;
}

exports.getAllTasks = async (req, res) => {
  const cacheKey = taskCacheKey(req.user.id);
  const cachedTasks = cache.get(cacheKey);
  if (cachedTasks) return res.json(cachedTasks);

  try {
    const tasks = await Task.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    cache.set(cacheKey, tasks);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTask = async (req, res) => {
  const { title, description } = req.body;

  try {
    const task = await Task.create({
      title,
      description,
      userId: req.user.id,
    });

    cache.del(taskCacheKey(req.user.id));
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateTask = async (req, res) => {
  const { id } = req.params;
  const { title, description, completed } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid task id" });
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (completed !== undefined) updates.completed = completed;

  try {
    const updatedTask = await Task.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedTask) return res.status(404).json({ error: "Task not found" });

    cache.del(taskCacheKey(req.user.id));
    res.json(updatedTask);
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
