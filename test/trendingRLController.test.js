const test = require("node:test");
const assert = require("node:assert/strict");
const Blog = require("../models/Blog");
const BlogStat = require("../models/BlogStat");
const TrendingEventReceipt = require("../models/TrendingEventReceipt");
const controller = require("../controllers/trendingRLController");
const { getEpoch } = require("../utils/trendingPolicy");

const POST_ID = "64b000000000000000000001";
const OTHER_POST_ID = "64b000000000000000000002";
const OLD_POST_ID = "64b000000000000000000003";

const originals = {
  blogFind: Blog.find,
  blogFindById: Blog.findById,
  blogFindOne: Blog.findOne,
  statCreate: BlogStat.create,
  statFind: BlogStat.find,
  statUpdateOne: BlogStat.updateOne,
  receiptCreate: TrendingEventReceipt.create,
  receiptDeleteOne: TrendingEventReceipt.deleteOne,
};

function lean(value) {
  return { lean: async () => value };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

function request(body = {}, query = {}) {
  return { body, query };
}

function defaultBlog(overrides = {}) {
  return {
    _id: POST_ID,
    title: "Test post",
    content: "word ".repeat(200),
    words: 200,
    category: "engineering",
    date: new Date(),
    ...overrides,
  };
}

function resetModelFakes() {
  const blog = defaultBlog();
  Blog.findById = () => lean(blog);
  Blog.findOne = () => lean(null);
  Blog.find = () => lean([]);
  BlogStat.find = () => lean([]);
  BlogStat.updateOne = async () => ({ acknowledged: true, matchedCount: 1 });
  BlogStat.create = async (document) => document;
  TrendingEventReceipt.create = async (document) => ({ _id: "receipt", ...document });
  TrendingEventReceipt.deleteOne = async () => ({ acknowledged: true, deletedCount: 1 });
  controller._test.clearTrendingEpochCache();
}

test.after(() => {
  Blog.find = originals.blogFind;
  Blog.findById = originals.blogFindById;
  Blog.findOne = originals.blogFindOne;
  BlogStat.create = originals.statCreate;
  BlogStat.find = originals.statFind;
  BlogStat.updateOne = originals.statUpdateOne;
  TrendingEventReceipt.create = originals.receiptCreate;
  TrendingEventReceipt.deleteOne = originals.receiptDeleteOne;
});

test("eventId validation requires a bounded canonical opaque id", () => {
  assert.deepEqual(controller._test.validateEventId("event-123456"), {
    eventId: "event-123456",
  });
  for (const invalid of [
    undefined,
    null,
    123,
    "short",
    " leading-space",
    "contains/slash",
    "x".repeat(129),
  ]) {
    assert.ok(controller._test.validateEventId(invalid).error);
  }
});

test("read-end validation rejects malformed telemetry and accepts real booleans", () => {
  const valid = {
    eventId: "read-12345678",
    dwell_ms: 1000,
    scroll_depth: 0.5,
    bookmarked: false,
    shared: true,
  };
  assert.deepEqual(controller._test.validateReadEndPayload(valid), {
    eventId: valid.eventId,
    dwellMs: 1000,
    scrollDepth: 0.5,
    bookmarked: false,
    shared: true,
  });

  for (const dwell_ms of [undefined, "1000", NaN, Infinity, -1, 6 * 60 * 60 * 1000 + 1]) {
    assert.match(
      controller._test.validateReadEndPayload({ ...valid, dwell_ms }).error,
      /dwell_ms/
    );
  }
  for (const scroll_depth of [undefined, "0.5", NaN, Infinity, -0.01, 1.01]) {
    assert.match(
      controller._test.validateReadEndPayload({ ...valid, scroll_depth }).error,
      /scroll_depth/
    );
  }
  assert.match(
    controller._test.validateReadEndPayload({ ...valid, shared: "false" }).error,
    /shared/
  );
  assert.match(
    controller._test.validateReadEndPayload({ ...valid, bookmarked: 1 }).error,
    /bookmarked/
  );
});

test("tracking word counts are capped so the ratio threshold remains reachable", () => {
  const { MAX_DWELL_MS, MAX_TRACKING_WORDS } = controller._test;
  const expectedMs = controller._test.computeExpectedMs(MAX_TRACKING_WORDS + 1);

  assert.equal(MAX_TRACKING_WORDS, 120_000);
  assert.equal(controller._test.wordCountForBlog({ words: MAX_TRACKING_WORDS + 1 }), 120_000);
  assert.equal(expectedMs, 10 * 60 * 60 * 1000);
  assert.equal(expectedMs * 0.6, MAX_DWELL_MS);
});

test("trending always applies the canonical window, ignores all=1, and caches its epoch slate", async () => {
  resetModelFakes();
  const epoch = getEpoch(new Date());
  const recentDate = new Date(epoch.startedAt.getTime() - 24 * 60 * 60 * 1000);
  const posts = [
    defaultBlog({ _id: POST_ID, publishedAt: recentDate }),
    defaultBlog({ _id: OTHER_POST_ID, publishedAt: recentDate, category: "ai" }),
    defaultBlog({
      _id: OLD_POST_ID,
      publishedAt: new Date(epoch.startedAt.getTime() - 90 * 24 * 60 * 60 * 1000),
      date: recentDate,
      category: "old",
    }),
  ];
  const findCalls = [];
  let statFindCalls = 0;

  Blog.find = (query) => {
    findCalls.push(query);
    return lean(posts);
  };
  BlogStat.find = () => {
    statFindCalls += 1;
    return lean([
      { postId: POST_ID, alpha: 8, beta: 2 },
      { postId: OTHER_POST_ID, alpha: 4, beta: 3 },
    ]);
  };

  const first = mockResponse();
  const second = mockResponse();
  await controller.getTrending(request({}, { limit: "2", all: "1" }), first);
  await controller.getTrending(request({}, { limit: "1", all: "1" }), second);

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.items.length, 2);
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.items[0]._id, first.body.items[0]._id);
  assert.equal(first.body.items.some((post) => post._id === OLD_POST_ID), false);
  assert.equal(findCalls.length, 1);
  assert.equal(statFindCalls, 1);
  assert.ok(Array.isArray(findCalls[0].$or));
  assert.notDeepEqual(findCalls[0], {});
  assert.equal(first.body.meta.windowDays, 60);
  assert.equal(typeof first.body.meta.epochId, "string");
  assert.match(first.body.meta.epochStartedAt, /Z$/);
  assert.match(first.body.meta.epochEndsAt, /Z$/);
  assert.match(first.headers["Cache-Control"], /^public, max-age=/);
});

test("cache invalidation cannot be undone by an older in-flight trending read", async () => {
  resetModelFakes();
  const epoch = getEpoch(new Date());
  const publishedAt = new Date(epoch.startedAt.getTime() - 60_000);
  const stalePost = defaultBlog({ _id: POST_ID, title: "Stale post", publishedAt });
  const freshPost = defaultBlog({
    _id: OTHER_POST_ID,
    title: "Fresh post",
    publishedAt,
  });
  let resolveFirstFind;
  let findCalls = 0;

  Blog.find = () => {
    findCalls += 1;
    if (findCalls === 1) {
      return {
        lean: () =>
          new Promise((resolve) => {
            resolveFirstFind = resolve;
          }),
      };
    }
    return lean([freshPost]);
  };

  const first = mockResponse();
  const firstRequest = controller.getTrending(request({}, {}), first);
  assert.equal(typeof resolveFirstFind, "function");

  const generationBefore = controller._test.getTrendingCacheGeneration();
  controller.invalidateTrendingCache();
  assert.equal(controller._test.getTrendingCacheGeneration(), generationBefore + 1);

  resolveFirstFind([stalePost]);
  await firstRequest;
  assert.equal(first.body.items[0]._id, POST_ID);

  const second = mockResponse();
  await controller.getTrending(request({}, {}), second);

  assert.equal(findCalls, 2);
  assert.equal(second.body.items[0]._id, OTHER_POST_ID);
});

test("trending clamps oversized limits and handles fewer or zero eligible posts", async () => {
  resetModelFakes();
  const epoch = getEpoch(new Date());
  const publishedAt = new Date(epoch.startedAt.getTime() - 60_000);
  const manyPosts = Array.from({ length: 12 }, (_, index) => ({
    _id: `post-${index}`,
    title: `Post ${index}`,
    content: "content",
    category: `category-${index % 3}`,
    publishedAt,
  }));
  Blog.find = () => lean(manyPosts);

  const clamped = mockResponse();
  await controller.getTrending(request({}, { limit: "999" }), clamped);
  assert.equal(clamped.body.items.length, 10);

  controller._test.clearTrendingEpochCache();
  Blog.find = () => lean(manyPosts.slice(0, 2));
  const fewer = mockResponse();
  await controller.getTrending(request({}, { limit: "10" }), fewer);
  assert.equal(fewer.body.items.length, 2);

  controller._test.clearTrendingEpochCache();
  Blog.find = () => lean([]);
  let statReads = 0;
  BlogStat.find = () => {
    statReads += 1;
    return lean([]);
  };
  const empty = mockResponse();
  await controller.getTrending(request({}, { limit: "4" }), empty);
  assert.deepEqual(empty.body.items, []);
  assert.equal(statReads, 0);
});

test("future canonical publication dates are excluded even if a fallback date is recent", async () => {
  resetModelFakes();
  const epoch = getEpoch(new Date());
  const posts = [
    defaultBlog({
      publishedAt: new Date(epoch.endsAt.getTime() + 24 * 60 * 60 * 1000),
      date: new Date(epoch.startedAt.getTime() - 1000),
    }),
  ];
  Blog.find = () => lean(posts);

  const res = mockResponse();
  await controller.getTrending(request({}, {}), res);

  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.meta.windowDays, 60);
});

test("impression claims a durable receipt before atomically incrementing stats", async () => {
  resetModelFakes();
  const calls = [];
  TrendingEventReceipt.create = async (document) => {
    calls.push(["receipt", document]);
    return document;
  };
  BlogStat.updateOne = async (...args) => {
    calls.push(["stat", ...args]);
    return { acknowledged: true, matchedCount: 1 };
  };

  const res = mockResponse();
  await controller.trackImpression(
    request({ postId: POST_ID, eventId: "impression-12345" }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls[0][0], "receipt");
  assert.equal(calls[0][1].eventType, "impression");
  assert.equal(calls[1][0], "stat");
  assert.deepEqual(calls[1][2].$inc, { impressions: 1 });
  assert.deepEqual(calls[1][3], { upsert: true });
});

test("duplicate event receipts return duplicate:true without retraining", async () => {
  resetModelFakes();
  let statWrites = 0;
  TrendingEventReceipt.create = async () => {
    const error = new Error("duplicate");
    error.code = 11000;
    throw error;
  };
  BlogStat.updateOne = async () => {
    statWrites += 1;
    return { matchedCount: 1 };
  };

  const res = mockResponse();
  await controller.trackClick(
    request({ postId: POST_ID, eventId: "click-duplicate-1" }),
    res
  );

  assert.deepEqual(res.body, { ok: true, duplicate: true });
  assert.equal(statWrites, 0);
});

test("click events increment clicks only and never manufacture an impression", async () => {
  resetModelFakes();
  const updates = [];
  BlogStat.updateOne = async (...args) => {
    updates.push(args);
    return { acknowledged: true, matchedCount: 1 };
  };

  const res = mockResponse();
  await controller.trackClick(
    request({ postId: POST_ID, eventId: "click-success-001" }),
    res
  );

  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(updates[0][1].$inc, { clicks: 1 });
  assert.equal(updates[0][1].$inc.impressions, undefined);
});

test("a failed stat write rolls back its event receipt so a retry can train", async () => {
  resetModelFakes();
  const deleted = [];
  BlogStat.updateOne = async () => {
    throw new Error("database unavailable");
  };
  TrendingEventReceipt.deleteOne = async (filter) => {
    deleted.push(filter);
    return { deletedCount: 1 };
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const res = mockResponse();
    await controller.trackClick(
      request({ postId: POST_ID, eventId: "click-rollback-1" }),
      res
    );

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "internal_error_click" });
    assert.deepEqual(deleted, [{ eventId: "click-rollback-1" }]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("an essentially instant low-signal exit is deduped but does not train", async () => {
  resetModelFakes();
  let statWrites = 0;
  BlogStat.updateOne = async () => {
    statWrites += 1;
    return { matchedCount: 1 };
  };

  const res = mockResponse();
  await controller.trackReadEnd(
    request({
      postId: POST_ID,
      eventId: "read-instant-001",
      dwell_ms: 500,
      scroll_depth: 0.01,
    }),
    res
  );

  assert.deepEqual(res.body, {
    ok: true,
    ignored: true,
    reason: "instant_low_signal_exit",
  });
  assert.equal(statWrites, 0);
});

test("genuine short bounces increment beta instead of being discarded", async () => {
  resetModelFakes();
  const updates = [];
  BlogStat.updateOne = async (...args) => {
    updates.push(args);
    return { matchedCount: 1 };
  };

  const res = mockResponse();
  await controller.trackReadEnd(
    request({
      postId: POST_ID,
      eventId: "read-bounce-0001",
      dwell_ms: 2000,
      scroll_depth: 0.05,
    }),
    res
  );

  assert.equal(res.body.ok, true);
  assert.equal(res.body.engaged, false);
  assert.deepEqual(updates[0][1].$inc, { engaged_count: 0, beta: 1 });
});

test("scroll-only engagement starts at five seconds of dwell", async () => {
  for (const [eventId, dwellMs, expectedEngaged] of [
    ["read-scroll-low1", 4999, false],
    ["read-scroll-edge", 5000, true],
  ]) {
    resetModelFakes();
    const updates = [];
    BlogStat.updateOne = async (...args) => {
      updates.push(args);
      return { matchedCount: 1 };
    };
    const res = mockResponse();

    await controller.trackReadEnd(
      request({
        postId: POST_ID,
        eventId,
        dwell_ms: dwellMs,
        scroll_depth: 0.7,
      }),
      res
    );

    assert.equal(res.body.engaged, expectedEngaged, eventId);
    assert.deepEqual(
      updates[0][1].$inc,
      expectedEngaged
        ? { engaged_count: 1, alpha: 1 }
        : { engaged_count: 0, beta: 1 }
    );
  }
});

test("threshold, bookmark, and share signals increment alpha even on short reads", async () => {
  for (const [eventId, payload] of [
    ["read-scroll-0001", { dwell_ms: 5000, scroll_depth: 0.7 }],
    ["read-ratio-00001", { dwell_ms: 36_000, scroll_depth: 0 }],
    ["read-bookmark-01", { dwell_ms: 100, scroll_depth: 0, bookmarked: true }],
    ["read-shared-0001", { dwell_ms: 100, scroll_depth: 0, shared: true }],
  ]) {
    resetModelFakes();
    const updates = [];
    BlogStat.updateOne = async (...args) => {
      updates.push(args);
      return { matchedCount: 1 };
    };
    const res = mockResponse();

    await controller.trackReadEnd(
      request({ postId: POST_ID, eventId, ...payload }),
      res
    );

    assert.equal(res.body.engaged, true, eventId);
    assert.deepEqual(updates[0][1].$inc, { engaged_count: 1, alpha: 1 });
  }
});

test("new read stats preserve priors and recover from a concurrent insert race", async () => {
  resetModelFakes();
  const updates = [];
  let updateNumber = 0;
  BlogStat.updateOne = async (...args) => {
    updates.push(args);
    updateNumber += 1;
    return { matchedCount: updateNumber === 1 ? 0 : 1 };
  };
  BlogStat.create = async () => {
    const error = new Error("concurrent insert");
    error.code = 11000;
    throw error;
  };

  const res = mockResponse();
  await controller.trackReadEnd(
    request({
      postId: POST_ID,
      eventId: "read-race-000001",
      dwell_ms: 36_000,
      scroll_depth: 0,
    }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.engaged, true);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0][1].$inc, { engaged_count: 1, alpha: 1 });
  assert.deepEqual(updates[1][1].$inc, { engaged_count: 1, alpha: 1 });
});

test("invalid or unknown events are rejected before a receipt is claimed", async () => {
  resetModelFakes();
  let receipts = 0;
  TrendingEventReceipt.create = async () => {
    receipts += 1;
  };

  const invalid = mockResponse();
  await controller.trackImpression(request({ postId: POST_ID }), invalid);
  assert.equal(invalid.statusCode, 400);

  Blog.findById = () => lean(null);
  const missing = mockResponse();
  await controller.trackClick(
    request({ postId: POST_ID, eventId: "click-unknown-01" }),
    missing
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(receipts, 0);
});

test("receipt schema enforces global event uniqueness and expiry", () => {
  assert.equal(TrendingEventReceipt.schema.path("eventId").options.unique, true);
  assert.deepEqual(
    TrendingEventReceipt.schema.path("eventType").enumValues,
    ["impression", "click", "read-end"]
  );
  const ttlIndex = TrendingEventReceipt.schema
    .indexes()
    .find(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0);
  assert.ok(ttlIndex);

  const receipt = new TrendingEventReceipt({
    eventId: "receipt-123456",
    eventType: "click",
    postId: POST_ID,
  });
  assert.equal(receipt.validateSync(), undefined);
  assert.ok(receipt.expiresAt > new Date());
});
