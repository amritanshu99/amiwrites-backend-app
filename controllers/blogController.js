const mongoose = require("mongoose");
const cache = require("../utils/cache");
const { sendNotificationToAll } = require("./pushController");
const Blog = require("../models/Blog");
const BlogStat = require("../models/BlogStat");
const TrendingEventReceipt = require("../models/TrendingEventReceipt");
const { invalidateTrendingCache } = require("./trendingRLController");
const { clampPositiveInt, escapeRegExp } = require("../utils/security");

const BLOG_CACHE_PREFIX = "blogs-page-";
const BLOG_SEO_INDEX_CACHE_KEY = "blogs-seo-index-v1";
const BLOG_SEO_INDEX_LIMIT = 1000;
const BLOG_SEO_EXCERPT_LENGTH = 400;
const BLOG_SEO_INDEX_CACHE_SECONDS = 300;
const BLOG_SEO_INDEX_CACHE_CONTROL =
  "public, max-age=300, s-maxage=900, stale-while-revalidate=86400";

function countWords(s = "") {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function decodeBasicHtmlEntities(value = "") {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return String(value)
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name.toLowerCase()] ?? " ")
    .replace(/&#(\d+);/g, (match, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : " ";
    })
    .replace(/&#x([\da-f]+);/gi, (match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : " ";
    });
}

function createSeoExcerpt(content = "") {
  const plainText = decodeBasicHtmlEntities(
    String(content)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  if (plainText.length <= BLOG_SEO_EXCERPT_LENGTH) return plainText;

  const candidate = plainText.slice(0, BLOG_SEO_EXCERPT_LENGTH - 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const cutoff = wordBoundary >= 300 ? wordBoundary : candidate.length;
  return `${candidate.slice(0, cutoff).trimEnd()}\u2026`;
}

function invalidateBlogListCache() {
  cache.keys().forEach((key) => {
    if (key.startsWith(BLOG_CACHE_PREFIX)) cache.del(key);
  });
  cache.del(BLOG_SEO_INDEX_CACHE_KEY);
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
    invalidateTrendingCache();

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

exports.getBlogSeoIndex = async (req, res) => {
  try {
    const cached = cache.get(BLOG_SEO_INDEX_CACHE_KEY);
    if (cached) {
      res.setHeader("Cache-Control", BLOG_SEO_INDEX_CACHE_CONTROL);
      return res.json(cached);
    }

    const now = new Date();
    const publishedFilter = {
      $or: [
        { publishedAt: { $exists: false } },
        { publishedAt: null },
        { publishedAt: { $lte: now } },
      ],
    };

    const blogs = await Blog.find(publishedFilter)
      .select({
        _id: 1,
        slug: 1,
        title: 1,
        category: 1,
        content: 1,
        date: 1,
        publishedAt: 1,
        updatedAt: 1,
      })
      .sort({ date: -1, _id: -1 })
      .limit(BLOG_SEO_INDEX_LIMIT)
      .lean();

    const safeBlogs = blogs.map(({ content, ...blog }) => ({
      ...blog,
      excerpt: createSeoExcerpt(content),
    }));
    const response = { blogs: safeBlogs, count: safeBlogs.length };
    cache.set(BLOG_SEO_INDEX_CACHE_KEY, response, BLOG_SEO_INDEX_CACHE_SECONDS);

    res.setHeader("Cache-Control", BLOG_SEO_INDEX_CACHE_CONTROL);
    return res.json(response);
  } catch (err) {
    console.error("Error fetching blog SEO index:", err.message || err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "Failed to fetch blog SEO index" });
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
    await Promise.all([
      BlogStat.deleteOne({ postId: blog._id }),
      TrendingEventReceipt.deleteMany({ postId: blog._id }),
    ]);
    invalidateTrendingCache();

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
    await Promise.all([
      BlogStat.deleteMany({}),
      TrendingEventReceipt.deleteMany({}),
    ]);
    invalidateTrendingCache();

    res.json({ message: "All blogs deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
