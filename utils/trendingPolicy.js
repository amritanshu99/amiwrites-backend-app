const { betaSample } = require("./beta");

const PRIORS = Object.freeze({ alpha: 1.5, beta: 1.0 });
const DEFAULT_EPOCH_MS = 5 * 60 * 1000;
const MIN_EPOCH_MS = 60 * 1000;
const MAX_EPOCH_MS = 60 * 60 * 1000;
const FRESH_HOURS = 72;
const FRESH_MULTIPLIER = 1.1;
const MAX_CLICK_BOOST = 1.06;
const CTR_PRIOR_CLICKS = 1;
const CTR_PRIOR_IMPRESSIONS = 20;
const DIVERSITY_PENALTY = 0.08;
const MAX_DIVERSITY_PENALTY = 0.24;

function validDate(value) {
  if (value === undefined || value === null || value === "") return null;

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function canonicalPublicationDate(post) {
  if (!post || typeof post !== "object") return null;

  return (
    validDate(post.publishedAt) ||
    validDate(post.date) ||
    validDate(post.createdAt) ||
    null
  );
}

function buildCanonicalPublicationWindowQuery(startDate, endDate) {
  const start = validDate(startDate);
  const end = validDate(endDate);

  if (!start || !end || start > end) {
    throw new RangeError("A valid publication window is required");
  }

  const range = { $gte: start, $lte: end };
  return {
    $or: [
      { publishedAt: range },
      { publishedAt: null, date: range },
      { publishedAt: null, date: null, createdAt: range },
    ],
  };
}

function clampEpochMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_EPOCH_MS;
  return Math.min(Math.max(parsed, MIN_EPOCH_MS), MAX_EPOCH_MS);
}

function getEpoch(now = new Date(), epochMs = DEFAULT_EPOCH_MS) {
  const current = validDate(now);
  if (!current) throw new RangeError("A valid epoch time is required");

  const durationMs = clampEpochMs(epochMs);
  const startMs = Math.floor(current.getTime() / durationMs) * durationMs;
  const endMs = startMs + durationMs;

  return {
    id: startMs.toString(36),
    durationMs,
    startedAt: new Date(startMs),
    endsAt: new Date(endMs),
  };
}

function hashSeed(value = "") {
  const input = String(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRng(seed) {
  let state = hashSeed(seed);

  return function seededRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function posteriorShape(value, floor) {
  const number = Number(value);
  return Number.isFinite(number) && number >= floor ? number : floor;
}

function normalizePosterior(stat = {}) {
  return {
    alpha: posteriorShape(stat.alpha, PRIORS.alpha),
    beta: posteriorShape(stat.beta, PRIORS.beta),
  };
}

function weakClickSignal(stat = {}) {
  const impressions = finiteCount(stat.impressions);
  const rawClicks = finiteCount(stat.clicks);
  const clicks = Math.min(rawClicks, impressions);

  if (impressions === 0 || clicks === 0) {
    return {
      boost: 1,
      clicks,
      impressions,
      smoothedCtr: CTR_PRIOR_CLICKS / CTR_PRIOR_IMPRESSIONS,
    };
  }

  const smoothedCtr =
    (clicks + CTR_PRIOR_CLICKS) / (impressions + CTR_PRIOR_IMPRESSIONS);
  const confidence = impressions / (impressions + CTR_PRIOR_IMPRESSIONS);
  const ratePart = smoothedCtr * confidence * 0.5;
  const volumePart = Math.min(0.015, Math.log1p(clicks) * 0.004);
  const boost = Math.min(MAX_CLICK_BOOST, 1 + ratePart + volumePart);

  return { boost, clicks, impressions, smoothedCtr };
}

function categoryKey(post) {
  const category = typeof post?.category === "string" ? post.category.trim().toLowerCase() : "";
  return category || "__uncategorized__";
}

function stablePostId(post) {
  return String(post?._id || post?.slug || post?.title || "");
}

function scoreTrendingPost(post, stat, {
  now = new Date(),
  epochId = getEpoch(now).id,
  seedSalt = "amiverse-trending-v1",
} = {}) {
  const current = validDate(now);
  if (!current) throw new RangeError("A valid scoring time is required");

  const { alpha, beta } = normalizePosterior(stat);
  const rng = createSeededRng(`${seedSalt}:${epochId}:${stablePostId(post)}`);
  const sampledEngagement = betaSample(alpha, beta, rng);
  const click = weakClickSignal(stat);
  const publishedAt = canonicalPublicationDate(post);
  const ageMs = publishedAt ? current.getTime() - publishedAt.getTime() : Infinity;
  const isFresh = ageMs >= 0 && ageMs <= FRESH_HOURS * 60 * 60 * 1000;
  const freshnessBoost = isFresh ? FRESH_MULTIPLIER : 1;
  const score = sampledEngagement * click.boost * freshnessBoost;

  return {
    post,
    postId: stablePostId(post),
    category: categoryKey(post),
    score: Number.isFinite(score) ? score : 0,
    sampledEngagement,
    clickBoost: click.boost,
    alpha,
    beta,
    publishedAt,
    isFresh,
  };
}

function compareRanked(left, right) {
  if (right.adjustedScore !== left.adjustedScore) {
    return right.adjustedScore - left.adjustedScore;
  }
  if (right.score !== left.score) return right.score - left.score;
  return left.postId.localeCompare(right.postId);
}

function softDiversityOrder(scoredPosts, {
  penalty = DIVERSITY_PENALTY,
  maxPenalty = MAX_DIVERSITY_PENALTY,
} = {}) {
  const remaining = Array.isArray(scoredPosts) ? [...scoredPosts] : [];
  const ordered = [];
  const categoryCounts = new Map();

  while (remaining.length > 0) {
    const ranked = remaining
      .map((item, index) => {
        const seenCount = categoryCounts.get(item.category) || 0;
        const appliedPenalty = Math.min(maxPenalty, Math.max(0, penalty) * seenCount);
        return {
          ...item,
          originalIndex: index,
          adjustedScore: item.score * (1 - appliedPenalty),
        };
      })
      .sort(compareRanked);

    const selected = ranked[0];
    remaining.splice(selected.originalIndex, 1);
    categoryCounts.set(selected.category, (categoryCounts.get(selected.category) || 0) + 1);
    ordered.push(selected);
  }

  return ordered;
}

function lookupStat(stats, post) {
  const id = stablePostId(post);
  if (stats instanceof Map) return stats.get(id);
  if (stats && typeof stats === "object") return stats[id];
  return undefined;
}

function rankTrendingPosts(posts, stats, options = {}) {
  const scored = (Array.isArray(posts) ? posts : []).map((post) =>
    scoreTrendingPost(post, lookupStat(stats, post), options)
  );

  return softDiversityOrder(scored, options).map((item) => item.post);
}

module.exports = {
  DEFAULT_EPOCH_MS,
  DIVERSITY_PENALTY,
  FRESH_HOURS,
  FRESH_MULTIPLIER,
  MAX_CLICK_BOOST,
  MAX_DIVERSITY_PENALTY,
  PRIORS,
  buildCanonicalPublicationWindowQuery,
  canonicalPublicationDate,
  clampEpochMs,
  createSeededRng,
  getEpoch,
  normalizePosterior,
  rankTrendingPosts,
  scoreTrendingPost,
  softDiversityOrder,
  validDate,
  weakClickSignal,
};
