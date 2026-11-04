const { createHash } = require("node:crypto");
const Blog = require("../models/Blog");
const BlogRead = require("../models/BlogRead");
const { canonicalPublicationDate } = require("../utils/trendingPolicy");
const { TRACKING_STARTED_AT, MIN_READ_MS, MAX_READ_MS, MOST_READ_LIMIT, readerDay } = require("../utils/mostReadPolicy");

exports.recordRead = async (req, res) => {
  const { postId, readerId, dwell_ms: dwellMs } = req.body || {};
  if (typeof postId !== "string" || !/^[a-f0-9]{24}$/i.test(postId) ||
      typeof readerId !== "string" || !/^[a-z0-9][a-z0-9._:-]{15,127}$/i.test(readerId) ||
      typeof dwellMs !== "number" || !Number.isFinite(dwellMs) || dwellMs < 0 || dwellMs > MAX_READ_MS) {
    return res.status(400).json({ error: "Invalid read event" });
  }

  const now = new Date();
  if (now < TRACKING_STARTED_AT || dwellMs < MIN_READ_MS) {
    return res.json({ ok: true, counted: false });
  }

  try {
    const blog = await Blog.findById(postId).select("publishedAt date createdAt").lean();
    const publishedAt = canonicalPublicationDate(blog);
    if (!blog || !publishedAt || publishedAt > now) {
      return res.status(404).json({ error: "Published blog not found" });
    }
    await BlogRead.create({
      postId,
      readerKey: createHash("sha256").update(readerId).digest("hex"),
      day: readerDay(now),
      recordedAt: now,
    });
    return res.json({ ok: true, counted: true });
  } catch (error) {
    if (error?.code === 11000) return res.json({ ok: true, counted: false, duplicate: true });
    console.error("Recording blog read failed:", error?.message);
    return res.status(500).json({ error: "read_internal_error" });
  }
};

exports.getMostRead = async (req, res) => {
  try {
    const now = new Date();
    const items = await BlogRead.aggregate([
      { $match: { recordedAt: { $gte: TRACKING_STARTED_AT, $lte: now } } },
      { $group: { _id: "$postId", readCount: { $sum: 1 }, lastReadAt: { $max: "$recordedAt" } } },
      { $lookup: { from: Blog.collection.name, localField: "_id", foreignField: "_id", as: "blog" } },
      { $unwind: "$blog" },
      { $addFields: { publicationDate: { $ifNull: ["$blog.publishedAt", { $ifNull: ["$blog.date", "$blog.createdAt"] }] } } },
      { $match: { publicationDate: { $type: "date", $lte: now } } },
      { $sort: { readCount: -1, lastReadAt: -1, _id: 1 } },
      { $limit: MOST_READ_LIMIT },
      { $replaceRoot: { newRoot: { $mergeObjects: ["$blog", { readCount: "$readCount" }] } } },
    ]);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      items,
      meta: {
        trackingStartedAt: TRACKING_STARTED_AT.toISOString(),
        refreshAt: new Date(now.getTime() + 60_000).toISOString(),
        minimumReadMs: MIN_READ_MS,
        limit: MOST_READ_LIMIT,
      },
    });
  } catch (error) {
    console.error("Most read failed:", error?.message);
    return res.status(500).json({ error: "most_read_internal_error" });
  }
};
