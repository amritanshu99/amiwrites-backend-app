const mongoose = require("mongoose");
const cache = require("../utils/cache");
const { sendNotificationToAll } = require("./pushController");
const Blog = require("../models/Blog");
const BlogStat = require("../models/BlogStat");
const { clampPositiveInt, escapeRegExp } = require("../utils/security");

const BLOG_CACHE_PREFIX = "blogs-page-";

function countWords(s = "") {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function invalidateBlogListCache() {
  cache.keys().forEach((key) => {
    if (key.startsWith(BLOG_CACHE_PREFIX)) cache.del(key);
  });
}

exports.createBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can create blogs" });
    }

    const words = countWords(req.body.content || req.body.html || req.body.text || "");

    const blog = new Blog({
      ...req.body,
      words,
      date: new Date(),
    });
    await blog.save();

    invalidateBlogListCache();

    sendNotificationToAll({
      title: "New Blog Published!",
      body: `Read "${blog.title}" on AmiVerse now!`,
      icon: "https://www.amiverse.in/images/favicon.ico",
      url: "https://www.amiverse.in/blog/",
    }).catch((err) => console.error("Blog notification failed:", err?.message || err));

    res.status(201).json(blog);
  } catch (err) {
    console.error("Blog creation failed:", err.message || err);
    res.status(400).json({ error: err.message });
  }
};

exports.getBlogs = async (req, res) => {
  try {
    const page = clampPositiveInt(req.query.page, { defaultValue: 1, min: 1, max: 10000 });
    const limit = clampPositiveInt(req.query.limit, { defaultValue: 2, min: 1, max: 50 });
    const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const search = rawSearch.slice(0, 100);
    const sort = req.query.sort === "oldest" ? 1 : -1;

    const query = search
      ? { title: { $regex: new RegExp(escapeRegExp(search), "i") } }
      : {};

    const cacheKey = `${BLOG_CACHE_PREFIX}${page}-limit-${limit}-search-${search}-sort-${sort}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const [blogs, total] = await Promise.all([
      Blog.find(query)
        .sort({ date: sort })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Blog.countDocuments(query),
    ]);

    const response = { blogs, hasMore: page * limit < total };
    cache.set(cacheKey, response, 300);
    res.json(response);
  } catch (err) {
    console.error("Error fetching blogs:", err.message || err);
    res.status(500).json({ error: err.message });
  }
};

exports.getBlogById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid blog id" });
    }

    const blog = await Blog.findById(req.params.id).lean();
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

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid blog id" });
    }

    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) {
      return res.status(404).json({ error: "Blog not found" });
    }

    invalidateBlogListCache();
    await BlogStat.deleteOne({ postId: blog._id });

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
    invalidateBlogListCache();
    cache.del("blogs");
    await BlogStat.deleteMany({});

    res.json({ message: "All blogs deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
