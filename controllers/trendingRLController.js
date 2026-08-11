const mongoose = require("mongoose");
const Blog = require("../models/Blog");
const BlogStat = require("../models/BlogStat");
const TrendingEventReceipt = require("../models/TrendingEventReceipt");
const { clampPositiveInt } = require("../utils/security");
const {
  PRIORS,
  buildCanonicalPublicationWindowQuery,
  canonicalPublicationDate,
  clampEpochMs,
  getEpoch,
  rankTrendingPosts,
} = require("../utils/trendingPolicy");

const DEFAULT_WINDOW_DAYS = 60;
const MAX_DWELL_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKING_WORDS = 120_000;
const MIN_SCROLL_ENGAGEMENT_MS = 5000;
const INSTANT_EXIT_MS = 1000;
const INSTANT_EXIT_MAX_SCROLL = 0.05;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const trendingEpochCache = new Map();
let trendingCacheGeneration = 0;

function wordsFromBlog(blog) {
  const raw = blog?.content || blog?.html || blog?.text || "";
  const stripped = String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const count = stripped ? stripped.split(" ").length : 0;
  return Math.min(MAX_TRACKING_WORDS, Math.max(50, count));
}

function computeExpectedMs(words = 0) {
  const numericWords = Number(words);
  const boundedWords = Number.isFinite(numericWords) && numericWords > 0
    ? Math.min(MAX_TRACKING_WORDS, Math.max(50, numericWords))
    : 50;
  return (boundedWords / 200) * 60 * 1000;
}

function wordCountForBlog(blog) {
  const storedWords = Number(blog?.words);
  return Number.isFinite(storedWords) && storedWords > 0
    ? Math.min(MAX_TRACKING_WORDS, Math.max(50, storedWords))
    : wordsFromBlog(blog);
}

function bad(res, status, message) {
  return res.status(status).json({ error: message });
}

function ok(res, payload = {}) {
  return res.status(200).json({ ok: true, ...payload });
}

function normalizeBlogRef(ref) {
  if (typeof ref !== "string") return null;
  const value = ref.trim();
  if (!value || value.length > 120) return null;
  return value;
}

function extractObjectIdHex(ref = "") {
  const value = normalizeBlogRef(ref);
  if (!value) return null;

  const wrapped = value.match(/^ObjectId\(["']([0-9a-fA-F]{24})["']\)$/);
  if (wrapped) return wrapped[1];
  return /^[0-9a-fA-F]{24}$/.test(value) ? value : null;
}

async function resolveBlogByRef(ref) {
  const value = normalizeBlogRef(ref);
  if (!value) return { blog: null, postId: null };

  const hex = extractObjectIdHex(value);
  if (hex && mongoose.Types.ObjectId.isValid(hex)) {
    const byId = await Blog.findById(hex).lean();
    if (byId) return { blog: byId, postId: String(byId._id || hex) };
  }

  const bySlug = await Blog.findOne({ slug: value }).lean();
  if (bySlug) return { blog: bySlug, postId: String(bySlug._id) };
  return { blog: null, postId: null };
}

function validateEventId(value) {
  if (typeof value !== "string" || !EVENT_ID_PATTERN.test(value)) {
    return {
      error: "eventId must be 8-128 characters using letters, numbers, '.', '_', ':', or '-'",
    };
  }
  return { eventId: value };
}

function validateReadEndPayload(body = {}) {
  const event = validateEventId(body.eventId);
  if (event.error) return event;

  if (
    typeof body.dwell_ms !== "number" ||
    !Number.isFinite(body.dwell_ms) ||
    body.dwell_ms < 0 ||
    body.dwell_ms > MAX_DWELL_MS
  ) {
    return { error: `dwell_ms must be a finite number from 0 to ${MAX_DWELL_MS}` };
  }

  if (
    typeof body.scroll_depth !== "number" ||
    !Number.isFinite(body.scroll_depth) ||
    body.scroll_depth < 0 ||
    body.scroll_depth > 1
  ) {
    return { error: "scroll_depth must be a finite number from 0 to 1" };
  }

  for (const field of ["bookmarked", "shared"]) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return { error: `${field} must be a boolean when provided` };
    }
  }

  return {
    eventId: event.eventId,
    dwellMs: body.dwell_ms,
    scrollDepth: body.scroll_depth,
    bookmarked: body.bookmarked === true,
    shared: body.shared === true,
  };
}

function isInstantLowSignalExit({ dwellMs, scrollDepth, bookmarked, shared }) {
  return (
    dwellMs < INSTANT_EXIT_MS &&
    scrollDepth < INSTANT_EXIT_MAX_SCROLL &&
    !bookmarked &&
    !shared
  );
}

function duplicateKey(error) {
  return error?.code === 11000;
}

async function processEventOnce({ eventId, eventType, postId, operation }) {
  try {
    await TrendingEventReceipt.create({ eventId, eventType, postId });
  } catch (error) {
    if (duplicateKey(error)) return { duplicate: true };
    throw error;
  }

  try {
    return { duplicate: false, result: await operation() };
  } catch (error) {
    try {
      await TrendingEventReceipt.deleteOne({ eventId });
    } catch (rollbackError) {
      console.error(
        "Trending event receipt rollback failed:",
        rollbackError?.message || rollbackError
      );
    }
    throw error;
  }
}

function statInsertFields(blog) {
  return {
    alpha: PRIORS.alpha,
    beta: PRIORS.beta,
    words: wordCountForBlog(blog),
    category: blog.category || null,
    publishedAt: canonicalPublicationDate(blog) || new Date(),
  };
}

function clearExpiredEpochCache(activeEpochId) {
  for (const key of trendingEpochCache.keys()) {
    if (!key.startsWith(`${activeEpochId}:`)) trendingEpochCache.delete(key);
  }
}

function clearTrendingEpochCache() {
  trendingCacheGeneration += 1;
  trendingEpochCache.clear();
}

exports.invalidateTrendingCache = clearTrendingEpochCache;

// GET /api/trending-rl/trending?limit=4&windowDays=60
exports.getTrending = async (req, res) => {
  try {
    const limit = clampPositiveInt(req.query.limit, { defaultValue: 4, min: 1, max: 10 });
    const windowDays = clampPositiveInt(req.query.windowDays, {
      defaultValue: DEFAULT_WINDOW_DAYS,
      min: 1,
      max: 365,
    });
    const epoch = getEpoch(new Date(), clampEpochMs(process.env.TRENDING_EPOCH_MS));
    const cacheKey = `${epoch.id}:${windowDays}`;

    clearExpiredEpochCache(epoch.id);
    let cached = trendingEpochCache.get(cacheKey);

    if (!cached) {
      const cacheGeneration = trendingCacheGeneration;
      // Evaluate at the epoch boundary so new posts and feedback enter on the next
      // epoch, keeping every response within this epoch internally consistent.
      const evaluatedAt = epoch.startedAt;
      const startDate = new Date(
        evaluatedAt.getTime() - windowDays * 24 * 60 * 60 * 1000
      );
      const publicationQuery = buildCanonicalPublicationWindowQuery(startDate, evaluatedAt);
      const queriedPosts = await Blog.find(publicationQuery).lean();
      const posts = queriedPosts.filter((post) => {
        const publishedAt = canonicalPublicationDate(post);
        return publishedAt && publishedAt >= startDate && publishedAt <= evaluatedAt;
      });

      const ids = posts.map((post) => post._id);
      const statRows = ids.length
        ? await BlogStat.find({ postId: { $in: ids } }).lean()
        : [];
      const stats = new Map(statRows.map((stat) => [String(stat.postId), stat]));
      const orderedPosts = rankTrendingPosts(posts, stats, {
        now: evaluatedAt,
        epochId: epoch.id,
        seedSalt: process.env.TRENDING_SEED_SALT || "amiverse-trending-v1",
      });

      cached = {
        orderedPosts,
        meta: {
          epochId: epoch.id,
          epochStartedAt: epoch.startedAt.toISOString(),
          epochEndsAt: epoch.endsAt.toISOString(),
          windowDays,
        },
      };
      // A create/delete may invalidate the cache while these database reads are
      // in flight. Never let that older snapshot repopulate the cleared cache.
      if (cacheGeneration === trendingCacheGeneration) {
        trendingEpochCache.set(cacheKey, cached);
      }
    }

    const maxAgeSeconds = Math.max(
      0,
      Math.floor((epoch.endsAt.getTime() - Date.now()) / 1000)
    );
    res.setHeader?.("Cache-Control", `public, max-age=${maxAgeSeconds}`);
    return res.json({ items: cached.orderedPosts.slice(0, limit), meta: cached.meta });
  } catch (error) {
    console.error("Trending failed:", error?.message, error?.stack);
    return bad(res, 500, "trending_internal_error");
  }
};

async function resolveEventBlog(req, res) {
  const { postId: ref, eventId: rawEventId } = req.body || {};
  if (!ref) {
    bad(res, 400, "postId required");
    return null;
  }

  const event = validateEventId(rawEventId);
  if (event.error) {
    bad(res, 400, event.error);
    return null;
  }

  const resolved = await resolveBlogByRef(ref);
  if (!resolved.blog) {
    bad(res, 404, "Blog not found for given postId/slug");
    return null;
  }

  return { ...resolved, eventId: event.eventId };
}

exports.trackImpression = async (req, res) => {
  try {
    const event = await resolveEventBlog(req, res);
    if (!event) return undefined;

    const processed = await processEventOnce({
      eventId: event.eventId,
      eventType: "impression",
      postId: event.postId,
      operation: () =>
        BlogStat.updateOne(
          { postId: event.postId },
          {
            $setOnInsert: statInsertFields(event.blog),
            $inc: { impressions: 1 },
            $set: { lastUpdated: new Date() },
          },
          { upsert: true }
        ),
    });

    return ok(res, processed.duplicate ? { duplicate: true } : {});
  } catch (error) {
    console.error("Impression failed:", error?.message, error?.stack);
    return bad(res, 500, "internal_error_impression");
  }
};

exports.trackClick = async (req, res) => {
  try {
    const event = await resolveEventBlog(req, res);
    if (!event) return undefined;

    const processed = await processEventOnce({
      eventId: event.eventId,
      eventType: "click",
      postId: event.postId,
      operation: () =>
        BlogStat.updateOne(
          { postId: event.postId },
          {
            $setOnInsert: statInsertFields(event.blog),
            $inc: { clicks: 1 },
            $set: { lastUpdated: new Date() },
          },
          { upsert: true }
        ),
    });

    return ok(res, processed.duplicate ? { duplicate: true } : {});
  } catch (error) {
    console.error("Click failed:", error?.message, error?.stack);
    return bad(res, 500, "internal_error_click");
  }
};

async function recordReadOutcome({ blog, postId, engaged }) {
  const inc = { engaged_count: engaged ? 1 : 0 };
  if (engaged) inc.alpha = 1;
  else inc.beta = 1;

  const updateResult = await BlogStat.updateOne(
    { postId },
    { $inc: inc, $set: { lastUpdated: new Date() } },
    { upsert: false }
  );

  if (updateResult.matchedCount === 1) return;

  const words = wordCountForBlog(blog);
  const base = {
    postId,
    alpha: PRIORS.alpha + (engaged ? 1 : 0),
    beta: PRIORS.beta + (engaged ? 0 : 1),
    impressions: 0,
    clicks: 0,
    engaged_count: engaged ? 1 : 0,
    words,
    category: blog.category || null,
    publishedAt: canonicalPublicationDate(blog) || new Date(),
    lastUpdated: new Date(),
  };

  try {
    await BlogStat.create(base);
  } catch (error) {
    if (!duplicateKey(error)) throw error;

    const retryResult = await BlogStat.updateOne(
      { postId },
      { $inc: inc, $set: { lastUpdated: new Date() } },
      { upsert: false }
    );
    if (retryResult.matchedCount !== 1) {
      throw new Error("BlogStat duplicate-key retry did not find the existing row");
    }
  }
}

exports.trackReadEnd = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.postId) return bad(res, 400, "postId required");

    const input = validateReadEndPayload(body);
    if (input.error) return bad(res, 400, input.error);

    const { blog, postId } = await resolveBlogByRef(body.postId);
    if (!blog) return bad(res, 404, "Blog not found for given postId/slug");

    const processed = await processEventOnce({
      eventId: input.eventId,
      eventType: "read-end",
      postId,
      operation: async () => {
        if (isInstantLowSignalExit(input)) {
          return { ignored: true, reason: "instant_low_signal_exit" };
        }

        const words = wordCountForBlog(blog);
        const expectedMs = computeExpectedMs(words);
        const ratio = expectedMs > 0 ? input.dwellMs / expectedMs : 0;
        const engaged =
          ratio >= 0.6 ||
          (input.dwellMs >= MIN_SCROLL_ENGAGEMENT_MS && input.scrollDepth >= 0.7) ||
          input.bookmarked ||
          input.shared;

        await recordReadOutcome({ blog, postId, engaged });
        return { engaged, ratio };
      },
    });

    if (processed.duplicate) return ok(res, { duplicate: true });
    return ok(res, processed.result);
  } catch (error) {
    console.error("ReadEnd failed:", error?.message, error?.stack);
    return bad(res, 500, "internal_error_read_end");
  }
};

exports._test = {
  DEFAULT_WINDOW_DAYS,
  EVENT_ID_PATTERN,
  INSTANT_EXIT_MAX_SCROLL,
  INSTANT_EXIT_MS,
  MAX_DWELL_MS,
  MAX_TRACKING_WORDS,
  MIN_SCROLL_ENGAGEMENT_MS,
  clearTrendingEpochCache,
  getTrendingCacheGeneration: () => trendingCacheGeneration,
  computeExpectedMs,
  extractObjectIdHex,
  isInstantLowSignalExit,
  processEventOnce,
  recordReadOutcome,
  resolveBlogByRef,
  validateEventId,
  validateReadEndPayload,
  wordCountForBlog,
  wordsFromBlog,
};
