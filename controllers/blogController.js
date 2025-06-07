const Blog = require("../models/Blog");
const cache = require("../utils/cache");
const { sendNotificationToAll } = require("./pushController");
// ✅ Create Blog (invalidates cache)
exports.createBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can create blogs" });
    }

    const blog = new Blog(req.body);
    await blog.save();

    // Invalidate cache
    cache.del("blogs");

    // Call the notification function here
    await sendNotificationToAll();

    res.status(201).json(blog);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ✅ Get All Blogs (with caching)
exports.getBlogs = async (req, res) => {
  try {
    const cachedBlogs = cache.get("blogs");
    if (cachedBlogs) {
      console.log("🔁 Serving from cache Blogs");
      return res.json(cachedBlogs);
    }

    const blogs = await Blog.find().sort({ date: -1 });

    // ✅ Store in cache
    cache.set("blogs", blogs);
    console.log("🗃️ Serving from DB and caching result Blogs");

    res.json(blogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Get Blog by ID (no caching here)
exports.getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ error: "Blog not found" });
    }
    res.json(blog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Delete Blog by ID (invalidates cache)
exports.deleteBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can delete blogs" });
    }

    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) {
      return res.status(404).json({ error: "Blog not found" });
    }

    // ❌ Invalidate cache
    cache.del("blogs");

    res.json({ message: "Blog deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Delete All Blogs (invalidates cache)
exports.deleteAllBlogs = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can delete all blogs" });
    }

    await Blog.deleteMany({});

    // ❌ Invalidate cache
    cache.del("blogs");

    res.json({ message: "All blogs deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
