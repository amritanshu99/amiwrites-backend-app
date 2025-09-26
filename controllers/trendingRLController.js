// controllers/trendingRLController.js
const mongoose = require("mongoose");
const Blog = require("../models/Blog");
const BlogStat = require("../models/BlogStat");
const { betaSample } = require("../utils/beta");

const PRIORS = { alpha: 1.5, beta: 1.0 };
const FRESH_HOURS = 72;
const FRESH_MULTIPLIER = 1.10;

// ---------- helpers ----------
function wordsFromBlog(blog) {
  const raw = blog?.content || blog?.html || blog?.text || "";
  const stripped = String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const count = stripped ? stripped.split(" ").length : 0;
  return Math.max(50, count); // floor to avoid zero
}
function computeExpectedMs(words = 0) {
  return (Math.max(50, words) / 200) * 60 * 1000;
}
function isBotLike(dwell_ms, scroll_depth) {
  // --- 7 sec logic: ignore any read-end fired within the first 7 seconds ---
  if (dwell_ms != null && Number(dwell_ms) < 7000) return true;

  // keep the original heuristic as-is for safety (unchanged otherwise)
  return (dwell_ms != null && Number(dwell_ms) < 5000) &&
         (scroll_depth != null && Number(scroll_depth) < 0.15);
}
function safeDate(doc) {
  // prefer explicit publishedAt/date, then createdAt
  return doc?.publishedAt || doc?.date || doc?.createdAt || null;
}
function bad(res, status, msg) { return res.status(status).json({ error: msg }); }
function ok(res, payload = { ok: true }) { return res.status(200).json(payload); }

// Extract a valid 24-hex ObjectId if present (handles ObjectId("..."), concatenations)
function extractObjectIdHex(str = "") {
  if (typeof str !== "string") return null;
  const wrapped = str.match(/ObjectId\(["']([0-9a-fA-F]{24})["']\)/);
  if (wrapped) return wrapped[1];
  if (/^[0-9a-fA-F]{24}$/.test(str)) return str;
  const first24 = str.match(/[0-9a-fA-F]{24}/);
  return first24 ? first24[0] : null;
}

// Resolve a blog by flexible ref: ObjectId (strict/loose) or slug
async function resolveBlogByRef(ref) {
  const hex = extractObjectIdHex(ref);
  if (hex && mongoose.Types.ObjectId.isValid(hex)) {
    const byId = await Blog.findById(hex).lean();
    if (byId) return { blog: byId, postId: hex };
  }
  if (typeof ref === "string") {
    const bySlug = await Blog.findOne({ slug: ref }).lean();
    if (bySlug) return { blog: bySlug, postId: String(bySlug._id) };
  }
  return { blog: null, postId: null };
}

// ---------- GET /api/trending-rl/trending?limit=4&windowDays=60&all=0 ----------
exports.getTrending = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "4", 10), 1), 10);
    const windowDays = parseInt(req.query.windowDays || "60", 10);
    const all = req.query.all === "1"; // debug bypass: include all posts regardless of time
    const now = new Date();

    let posts = [];
    if (all) {
      posts = await Blog.find({}).lean();
    } else {
      const startDate = new Date(now.getTime() - windowDays * 24 * 3600 * 1000);
      // Accept posts with `date` in range OR (no date but createdAt in range)
      posts = await Blog.find({
        $or: [
          { date: { $gte: startDate, $lte: now } },
          { date: { $exists: false }, createdAt: { $gte: startDate, $lte: now } },
        ],
      }).lean();
    }

    if (!posts.length) return res.json({ items: [] });

    const ids = posts.map((p) => p._id);
    const statRows = await BlogStat.find({ postId: { $in: ids } }).lean();
    const stats = new Map(statRows.map((s) => [String(s.postId), s]));

    const scored = posts.map((p) => {
      const s =
        stats.get(String(p._id)) || {
          alpha: PRIORS.alpha,
          beta: PRIORS.beta,
          words: p.words || wordsFromBlog(p),
          category: p.category,
          publishedAt: safeDate(p),
          // default zeros so weak-click boost is neutral on brand-new posts
          clicks: 0,
          impressions: 0,
        };

      const alpha = Number(s.alpha) || PRIORS.alpha;
      const beta  = Number(s.beta)  || PRIORS.beta;

      // Weak click signal (tiny multiplicative boost, strictly capped)
      const clicks = Number(s.clicks || 0);
      const imps   = Number(s.impressions || 0);
      const ctr    = imps > 0 ? (clicks / imps) : 0;

      let weakClickBoost = 1.0;
      if (clicks > 0 && imps > 0) {
        const ctrPart = Math.min(0.05, ctr * 0.05);                // up to +5% from CTR
        const qtyPart = Math.min(0.03, Math.log1p(clicks) * 0.01); // up to +3% from volume
        weakClickBoost += Math.min(0.08, ctrPart + qtyPart);       // hard cap +8%
      }

      const theta = betaSample(alpha, beta);

      const pub = safeDate(p);
      const hoursOld = pub ? (now - new Date(pub)) / 3600000 : Number.POSITIVE_INFINITY;
      const freshBoost = hoursOld <= FRESH_HOURS ? FRESH_MULTIPLIER : 1.0;
      const jitter = 1 + Math.random() * 0.02; // tiny tie-break

      return { post: p, score: theta * weakClickBoost * freshBoost * jitter };
    });

    scored.sort((a, b) => b.score - a.score);

    // Diversity (by category) then fill
    const chosen = [];
    const seenCats = new Set();
    for (const item of scored) {
      const cat = String(item.post.category || "");
      if (seenCats.has(cat)) continue;
      chosen.push(item.post);
      seenCats.add(cat);
      if (chosen.length === limit) break;
    }
    for (const item of scored) {
      if (chosen.length === limit) break;
      if (!chosen.find((p) => String(p._id) === String(item.post._id))) chosen.push(item.post);
    }

    // Ensure one fresh if possible
    const hasFresh = chosen.some((p) => {
      const d = safeDate(p);
      return d && (now - new Date(d)) / 3600000 <= FRESH_HOURS;
    });
    if (!hasFresh && chosen.length > 0) {
      const fresh = scored.find((x) => {
        const d = safeDate(x.post);
        return d &&
          (now - new Date(d)) / 3600000 <= FRESH_HOURS &&
          !chosen.find((p) => String(p._id) === String(x.post._id));
      });
      if (fresh) chosen[chosen.length - 1] = fresh.post;
    }

    return res.json({ items: chosen });
  } catch (e) {
    console.error("Trending failed:", e?.message, e?.stack);
    return bad(res, 500, "trending_internal_error");
  }
};

// ---------- POST /api/trending-rl/events/impression ----------
exports.trackImpression = async (req, res) => {
  try {
    const { postId: ref } = req.body || {};
    if (!ref) return bad(res, 400, "postId required");

    const { blog, postId } = await resolveBlogByRef(ref);
    if (!blog) return bad(res, 404, "Blog not found for given postId/slug");

    await BlogStat.updateOne(
      { postId },
      {
        $setOnInsert: {
          alpha: PRIORS.alpha,
          beta: PRIORS.beta,
          words: blog.words || wordsFromBlog(blog),
          category: blog.category || null,
          publishedAt: safeDate(blog) || new Date(),
        },
        $inc: { impressions: 1 },
        $set: { lastUpdated: new Date() },
      },
      { upsert: true }
    );
    return ok(res);
  } catch (e) {
    console.error("Impression failed:", e?.message, e?.stack);
    return bad(res, 500, "internal_error_impression");
  }
};

// ---------- POST /api/trending-rl/events/click ----------
exports.trackClick = async (req, res) => {
  try {
    const { postId: ref } = req.body || {};
    if (!ref) return bad(res, 400, "postId required");

    const { blog, postId } = await resolveBlogByRef(ref);
    if (!blog) return bad(res, 404, "Blog not found for given postId/slug");

    await BlogStat.updateOne(
      { postId },
      {
        $setOnInsert: {
          alpha: PRIORS.alpha,
          beta: PRIORS.beta,
          words: blog.words || wordsFromBlog(blog),
          category: blog.category || null,
          publishedAt: safeDate(blog) || new Date(),
        },
        $inc: { clicks: 1 },
        $set: { lastUpdated: new Date() },
      },
      { upsert: true }
    );
    return ok(res);
  } catch (e) {
    console.error("Click failed:", e?.message, e?.stack);
    return bad(res, 500, "internal_error_click");
  }
};

// POST /api/trending-rl/events/read-end
exports.trackReadEnd = async (req, res) => {
  try {
    const { postId: ref, dwell_ms, scroll_depth, bookmarked, shared } = req.body || {};
    if (!ref) return res.status(400).json({ error: "postId required" });

    // resolve id or slug
    const { blog, postId } = await resolveBlogByRef(ref);
    if (!blog) return res.status(404).json({ error: "Blog not found for given postId/slug" });

    if (isBotLike(dwell_ms, scroll_depth)) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const words = blog.words || wordsFromBlog(blog);
    const expected = computeExpectedMs(words);
    const dwell = Number(dwell_ms) || 0;
    const scroll = Number(scroll_depth);
    const ratio = expected > 0 ? dwell / expected : 0;
    const engaged =
      ratio >= 0.6 ||
      (Number.isFinite(scroll) && scroll >= 0.7) ||
      !!bookmarked ||
      !!shared;

    // 1) Try update existing (NO upsert) to avoid alpha/beta conflict
    const inc = { engaged_count: engaged ? 1 : 0 };
    if (engaged) inc.alpha = 1; else inc.beta = 1;

    const updateRes = await BlogStat.updateOne(
      { postId },
      { $inc: inc, $set: { lastUpdated: new Date() } }, // no $setOnInsert here
      { upsert: false }
    );

    if (updateRes.matchedCount === 1) {
      // updated an existing row
      return res.status(200).json({ ok: true, engaged, ratio });
    }

    // 2) Row didn't exist — create it with priors + this outcome applied
    const base = {
      postId,
      alpha: PRIORS.alpha + (engaged ? 1 : 0),
      beta:  PRIORS.beta  + (engaged ? 0 : 1),
      impressions: 0,
      clicks: 0,
      engaged_count: engaged ? 1 : 0,
      words,
      category: blog.category || null,
      publishedAt: safeDate(blog) || new Date(),
      lastUpdated: new Date(),
    };

    await BlogStat.create(base);
    return res.status(200).json({ ok: true, engaged, ratio });
  } catch (e) {
    console.error("ReadEnd failed:", e?.message, e?.stack);
    return res.status(500).json({ error: "internal_error_read_end" });
  }
};
