const mongoose = require("mongoose");
const cache = require("../utils/cache");
const { sendNotificationToAll } = require("./pushController");
const Blog = require("../models/Blog");

// 🔽 RL stats model
const BlogStat = require("../models/BlogStat");

// 🔽 helper: word count (robust against HTML/plain)
function countWords(s = "") {
  return String(s)
    .replace(/<[^>]*>/g, " ") // strip HTML
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

// ✅ Create Blog
exports.createBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can create blogs" });
    }

    const words = countWords(req.body.content || req.body.html || req.body.text || "");

    const blog = new Blog({
      ...req.body,
      words,
      date: new Date(), // consistent ordering
    });
    await blog.save();

    // 🔽 Ensure BlogStat exists for this blog
    try {
      await BlogStat.updateOne(
        { postId: new mongoose.Types.ObjectId(blog._id) },
        {
          $setOnInsert: {
            postId: new mongoose.Types.ObjectId(blog._id),
            alpha: 1.5,
            beta: 1.0,
            impressions: 0,
            clicks: 0,
            engaged_count: 0,
            words,
            category: blog.category || null,
            publishedAt: blog.date || new Date(),
            lastUpdated: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (err) {
      console.warn("⚠️ BlogStat create failed (non-fatal):", err.message);
    }

    // Invalidate paginated cache
    const keys = cache.keys();
    keys.forEach((key) => {
      if (key.startsWith("blogs-page-")) {
        cache.del(key);
      }
    });

    console.log("🔔 Sending notification for new blog:", blog.title);

    await sendNotificationToAll({
      title: "📝 New Blog Published!",
      body: `Read "${blog.title}" on AmiVerse now!`,
      icon: "https://www.amiverse.in/images/favicon.ico",
      url: `https://www.amiverse.in/blog/`, // TODO: replace with dynamic slug if available
    });

    res.status(201).json(blog);
  } catch (err) {
    console.error("❌ Blog creation failed:", err);
    res.status(400).json({ error: err.message });
  }
};

// ✅ Get Blogs (with pagination + cache)
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

// ✅ Get Blog by ID
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

// ✅ Delete Blog by ID
exports.deleteBlog = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can delete blogs" });
    }

    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) {
      return res.status(404).json({ error: "Blog not found" });
    }

    // Invalidate cache
    const keys = cache.keys();
    keys.forEach((key) => {
      if (key.startsWith("blogs-page-")) {
        cache.del(key);
      }
    });

    // 🔽 Remove BlogStat row
    try {
      await BlogStat.deleteOne({ postId: new mongoose.Types.ObjectId(blog._id) });
    } catch (err) {
      console.warn("⚠️ BlogStat delete failed (non-fatal):", err.message);
    }

    res.json({ message: "Blog deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Delete All Blogs
exports.deleteAllBlogs = async (req, res) => {
  try {
    if (req.user.username !== "amritanshu99") {
      return res.status(403).json({ message: "Only admin can delete all blogs" });
    }

    await Blog.deleteMany({});

    // Invalidate cache
    cache.del("blogs");

    // 🔽 Clear BlogStat collection
    try {
      await BlogStat.deleteMany({});
    } catch (err) {
      console.warn("⚠️ BlogStat deleteMany failed (non-fatal):", err.message);
    }

    res.json({ message: "All blogs deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
