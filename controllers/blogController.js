const cache = require("../utils/cache");
const { sendNotificationToAll } = require("./pushController");
const Blog = require('../models/Blog');

// 🔽 NEW: import RL stats model (non-breaking)
const BlogStat = require("../models/BlogStat");

// 🔽 NEW: helper to compute word count (robust to HTML/plain text)
function countWords(s = "") {
  return String(s)
    .replace(/<[^>]*>/g, " ")     // strip HTML
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

// ✅ Create Blog (invalidates cache)
exports.createBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can create blogs" });
    }

    // 🔽 NEW: compute words once so RL has accurate expected read time
    const words = countWords(req.body.content || req.body.html || req.body.text || "");

    const blog = new Blog({
      ...req.body,
      words,           // 🔽 NEW: persisted word count (harmless even if Blog schema ignores it)
      date: new Date(), // ensure consistent sorting if needed
    });
    await blog.save();

    // ✅ Invalidate all paginated blog cache
    const keys = cache.keys();
    keys.forEach((key) => {
      if (key.startsWith("blogs-page-")) {
        cache.del(key);
      }
    });

    console.log('🔔 Sending notification for new blog:', blog.title);

    await sendNotificationToAll({
      title: '📝 New Blog Published!',
      body: `Read "${blog.title}" on AmiVerse now!`,
      icon: 'https://www.amiverse.in/images/favicon.ico',
      url: `https://www.amiverse.in/blog/`, // or dynamic slug if applicable
    });

    res.status(201).json(blog);
  } catch (err) {
    console.error('❌ Blog creation failed:', err);
    res.status(400).json({ error: err.message });
  }
};


// ✅ Get Blogs with Pagination and Caching
exports.getBlogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 2;
    const search = req.query.search?.trim() || "";
    const sort = req.query.sort === "oldest" ? 1 : -1;

    const query = search
      ? { title: { $regex: new RegExp(search, "i") } }
      : {};

    const cacheKey = `blogs-page-${page}-limit-${limit}-search-${search}-sort-${sort}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`🔁 From cache: ${cacheKey}`);
      return res.json(cached);
    }

    const blogs = await Blog.find(query)
      .sort({ date: sort })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Blog.countDocuments(query);
    const hasMore = page * limit < total;

    const response = { blogs, hasMore };

    cache.set(cacheKey, response, 300);
    console.log(`🗃️ From DB and cached: ${cacheKey}`);
    res.json(response);
  } catch (err) {
    console.error("❌ Error fetching blogs:", err);
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

    // ✅ Invalidate all blog list cache entries
    const keys = cache.keys();
    keys.forEach((key) => {
      if (key.startsWith("blogs-page-")) {
        cache.del(key);
      }
    });

    // 🔽 NEW: clean up RL stats for this post (safe no-op if none)
    await BlogStat.deleteOne({ postId: blog._id });

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

    // 🔽 NEW: clear all RL stats rows to avoid orphans
    await BlogStat.deleteMany({});

    res.json({ message: "All blogs deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};