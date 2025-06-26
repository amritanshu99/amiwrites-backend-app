const Task = require("../models/Task");

const cache = require("../utils/cache");

// GET /tasks (User-specific)
exports.getAllTasks = async (req, res) => {
  const cacheKey = `tasks_${req.user.id}`;

  const cachedTasks = cache.get(cacheKey);
  if (cachedTasks) return res.json(cachedTasks);

  try {
    const tasks = await Task.find({ userId: req.user.id, isDeleted: false }).sort({ createdAt: -1 });
    cache.set(cacheKey, tasks);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /tasks
exports.createTask = async (req, res) => {
  const { title, description } = req.body;

  try {
    const task = await Task.create({
      title,
      description,
      userId: req.user.id,
    });

    cache.del(`tasks_${req.user.id}`);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// PUT /tasks/:id
exports.updateTask = async (req, res) => {
  const { id } = req.params;
  const { title, description, completed, isDeleted } = req.body;

  try {
    const task = await Task.findOne({ _id: id, userId: req.user.id });
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (completed !== undefined) task.completed = completed;
    if (isDeleted !== undefined) task.isDeleted = isDeleted;

    const updatedTask = await task.save();

    cache.del(`tasks_${req.user.id}`);
    res.json(updatedTask);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// DELETE /tasks/:id (Hard delete - optional)
exports.deleteTask = async (req, res) => {
  const { id } = req.params;

  try {
    const deletedTask = await Task.findOneAndDelete({ _id: id, userId: req.user.id });
    if (!deletedTask) return res.status(404).json({ error: "Task not found" });

    cache.del(`tasks_${req.user.id}`);
    res.json({ message: "Task permanently deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Optional: GET /tasks/stats
exports.getTaskStats = async (req, res) => {
  try {
    const allTasks = await Task.find({ userId: req.user.id, isDeleted: false });
    const total = allTasks.length;
    const completed = allTasks.filter(t => t.completed).length;

    res.json({
      total,
      completed,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};