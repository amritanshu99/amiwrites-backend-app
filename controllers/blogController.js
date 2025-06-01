const Blog = require("../models/Blog");

exports.createBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can create blogs" });
    }

    const blog = new Blog(req.body);
    await blog.save();
    res.status(201).json(blog);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getBlogs = async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ date: -1 });
    res.json(blogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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

exports.deleteBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can delete blogs" });
    }

    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) {
      return res.status(404).json({ error: "Blog not found" });
    }
    res.json({ message: "Blog deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAllBlogs = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can delete all blogs" });
    }

    await Blog.deleteMany({});
    res.json({ message: "All blogs deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
