const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_CLICK_BOOST,
  PRIORS,
  buildCanonicalPublicationWindowQuery,
  canonicalPublicationDate,
  createSeededRng,
  getEpoch,
  normalizePosterior,
  rankTrendingPosts,
  scoreTrendingPost,
  softDiversityOrder,
  weakClickSignal,
} = require("../utils/trendingPolicy");

test("canonical publication dates prefer publishedAt, then date, then createdAt", () => {
  const post = {
    publishedAt: "2026-08-01T00:00:00.000Z",
    date: "2026-08-02T00:00:00.000Z",
    createdAt: "2026-08-03T00:00:00.000Z",
  };

  assert.deepEqual(canonicalPublicationDate(post), new Date(post.publishedAt));
  assert.deepEqual(
    canonicalPublicationDate({ ...post, publishedAt: "not-a-date" }),
    new Date(post.date)
  );
  assert.deepEqual(
    canonicalPublicationDate({ createdAt: post.createdAt }),
    new Date(post.createdAt)
  );
  assert.equal(canonicalPublicationDate({}), null);
});

test("canonical Mongo window query cannot fall through an explicit publication date", () => {
  const start = new Date("2026-06-12T00:00:00.000Z");
  const end = new Date("2026-08-11T00:00:00.000Z");

  assert.deepEqual(buildCanonicalPublicationWindowQuery(start, end), {
    $or: [
      { publishedAt: { $gte: start, $lte: end } },
      { publishedAt: null, date: { $gte: start, $lte: end } },
      {
        publishedAt: null,
        date: null,
        createdAt: { $gte: start, $lte: end },
      },
    ],
  });
  assert.throws(
    () => buildCanonicalPublicationWindowQuery(end, start),
    RangeError
  );
});

test("epoch ids and seeded random streams are stable inside an epoch", () => {
  const first = getEpoch("2026-08-11T12:01:00.000Z", 5 * 60 * 1000);
  const second = getEpoch("2026-08-11T12:04:59.999Z", 5 * 60 * 1000);
  const next = getEpoch("2026-08-11T12:05:00.000Z", 5 * 60 * 1000);

  assert.equal(first.id, second.id);
  assert.notEqual(first.id, next.id);
  assert.deepEqual(
    Array.from({ length: 10 }, createSeededRng("same-seed")),
    Array.from({ length: 10 }, createSeededRng("same-seed"))
  );
});

test("ranking is deterministic for an epoch and independent of database row order", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const posts = [
    { _id: "a", category: "web", publishedAt: "2026-08-10T00:00:00.000Z" },
    { _id: "b", category: "web", publishedAt: "2026-08-09T00:00:00.000Z" },
    { _id: "c", category: "ai", publishedAt: "2026-07-20T00:00:00.000Z" },
    { _id: "d", category: "life", publishedAt: "2026-07-21T00:00:00.000Z" },
  ];
  const stats = new Map([
    ["a", { alpha: 20, beta: 5, clicks: 20, impressions: 200 }],
    ["b", { alpha: 12, beta: 3, clicks: 10, impressions: 100 }],
    ["c", { alpha: 4, beta: 4, clicks: 2, impressions: 30 }],
    ["d", { alpha: 8, beta: 2, clicks: 8, impressions: 80 }],
  ]);
  const options = { now, epochId: "epoch-42", seedSalt: "test" };

  const first = rankTrendingPosts(posts, stats, options).map((post) => post._id);
  const second = rankTrendingPosts([...posts].reverse(), stats, options).map(
    (post) => post._id
  );

  assert.deepEqual(first, second);
});

test("corrupt posterior values are floored to valid priors before sampling", () => {
  assert.deepEqual(normalizePosterior({ alpha: -10, beta: Infinity }), PRIORS);
  assert.deepEqual(normalizePosterior({ alpha: 0, beta: 0 }), PRIORS);

  const scored = scoreTrendingPost(
    { _id: "corrupt", date: "2026-08-10T00:00:00.000Z" },
    { alpha: NaN, beta: -1 },
    { now: "2026-08-11T00:00:00.000Z", epochId: "safe" }
  );
  assert.equal(scored.alpha, PRIORS.alpha);
  assert.equal(scored.beta, PRIORS.beta);
  assert.equal(Number.isFinite(scored.score), true);
});

test("weak CTR signal is smoothed, exposure-aware, and strictly bounded", () => {
  const noEvidence = weakClickSignal({ clicks: 0, impressions: 0 });
  const oneForOne = weakClickSignal({ clicks: 1, impressions: 1 });
  const tenForHundred = weakClickSignal({ clicks: 10, impressions: 100 });
  const corrupt = weakClickSignal({ clicks: 1000, impressions: 10 });
  const huge = weakClickSignal({ clicks: 1_000_000, impressions: 1_000_000 });

  assert.equal(noEvidence.boost, 1);
  assert.ok(oneForOne.boost > 1);
  assert.ok(oneForOne.boost < tenForHundred.boost);
  assert.equal(corrupt.clicks, 10);
  assert.ok(corrupt.boost <= MAX_CLICK_BOOST);
  assert.ok(huge.boost <= MAX_CLICK_BOOST);
});

test("category diversity is a soft penalty rather than a hard category quota", () => {
  const base = [
    { postId: "first", category: "web", score: 1, post: { _id: "first" } },
    { postId: "second", category: "web", score: 0.99, post: { _id: "second" } },
    { postId: "other", category: "ai", score: 0.98, post: { _id: "other" } },
  ];
  assert.deepEqual(
    softDiversityOrder(base).map((item) => item.postId),
    ["first", "other", "second"]
  );

  const lowQualityAlternative = [
    base[0],
    base[1],
    { postId: "weak", category: "ai", score: 0.4, post: { _id: "weak" } },
  ];
  assert.deepEqual(
    softDiversityOrder(lowQualityAlternative).map((item) => item.postId),
    ["first", "second", "weak"]
  );
});

test("freshness is only a score multiplier and future dates are never fresh", () => {
  const future = scoreTrendingPost(
    { _id: "future", publishedAt: "2026-08-12T00:00:00.000Z" },
    { alpha: 2, beta: 2 },
    { now: "2026-08-11T00:00:00.000Z", epochId: "epoch" }
  );
  assert.equal(future.isFresh, false);

  const ordered = softDiversityOrder([
    { postId: "strong-old", category: "web", score: 0.9, isFresh: false },
    { postId: "strong-old-2", category: "ai", score: 0.8, isFresh: false },
    { postId: "weak-fresh", category: "life", score: 0.1, isFresh: true },
  ]);
  assert.deepEqual(
    ordered.slice(0, 2).map((item) => item.postId),
    ["strong-old", "strong-old-2"]
  );
});
