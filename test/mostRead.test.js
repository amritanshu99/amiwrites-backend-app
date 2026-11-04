const test = require("node:test");
const assert = require("node:assert/strict");
const Blog = require("../models/Blog");
const BlogRead = require("../models/BlogRead");
const controller = require("../controllers/mostReadController");
const { TRACKING_STARTED_AT, MIN_READ_MS, readerDay } = require("../utils/mostReadPolicy");

const postId = "64b000000000000000000001";
const readerId = "browser-unique-id-00000001";
const original = { findById: Blog.findById, create: BlogRead.create, aggregate: BlogRead.aggregate };
const response = () => ({
  statusCode: 200, headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(key, value) { this.headers[key] = value; },
});
const request = (extra = {}) => ({ body: { postId, readerId, dwell_ms: MIN_READ_MS, ...extra } });
let saved;
test.beforeEach(() => {
  saved = [];
  Blog.findById = () => ({ select: () => ({ lean: async () => ({ _id: postId, date: new Date("2025-09-26") }) }) });
  BlogRead.create = async (doc) => { saved.push(doc); return doc; };
});
test.after(() => {
  Blog.findById = original.findById;
  BlogRead.create = original.create;
  BlogRead.aggregate = original.aggregate;
});

test("launch starts at midnight IST and daily deduplication changes at midnight IST", () => {
  assert.equal(TRACKING_STARTED_AT.toISOString(), "2026-11-03T18:30:00.000Z");
  assert.equal(readerDay(new Date("2026-11-04T18:29:59Z")), "2026-11-04");
  assert.equal(readerDay(new Date("2026-11-04T18:30:00Z")), "2026-11-05");
});

test("an old article earns a read after 30 seconds, with server time and a hashed browser identity", async () => {
  const res = response();
  await controller.recordRead(request({ recordedAt: "2020-01-01", day: "2020-01-01" }), res);
  assert.equal(res.body.counted, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].postId, postId);
  assert.match(saved[0].readerKey, /^[a-f0-9]{64}$/);
  assert.notEqual(saved[0].readerKey, readerId);
  assert.ok(saved[0].recordedAt >= TRACKING_STARTED_AT);
  assert.equal(saved[0].day, readerDay(saved[0].recordedAt));
});

test("brief visits and share/bookmark signals cannot manufacture a read", async () => {
  const res = response();
  await controller.recordRead(request({ dwell_ms: 29_999, shared: true, bookmarked: true }), res);
  assert.equal(res.body.counted, false);
  assert.equal(saved.length, 0);
});

test("invalid input is rejected before any database write", async () => {
  for (const extra of [{ postId: {} }, { postId: "missing" }, { readerId: "short" }, { dwell_ms: "30000" }, { dwell_ms: NaN }, { dwell_ms: -1 }, { dwell_ms: 21_600_001 }]) {
    const res = response();
    await controller.recordRead(request(extra), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(saved.length, 0);
});

test("missing and future-dated blogs cannot earn reads", async () => {
  for (const blog of [null, { publishedAt: new Date("2999-01-01"), date: new Date("2025-01-01") }]) {
    Blog.findById = () => ({ select: () => ({ lean: async () => blog }) });
    const res = response();
    await controller.recordRead(request(), res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(saved.length, 0);
});

test("concurrent retries use the same database unique key and duplicate reads succeed without recounting", async () => {
  const keys = new Set();
  BlogRead.create = async (doc) => {
    const key = `${doc.postId}:${doc.readerKey}:${doc.day}`;
    if (keys.has(key)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    keys.add(key);
  };
  const responses = [response(), response(), response()];
  await Promise.all(responses.map((res) => controller.recordRead(request(), res)));
  assert.equal(responses.filter((res) => res.body.counted).length, 1);
  assert.equal(responses.filter((res) => res.body.duplicate).length, 2);
  assert.ok(BlogRead.schema.indexes().some(([fields, options]) => options.unique && fields.postId && fields.readerKey && fields.day));
});

test("read failures remain retryable instead of claiming a successful count", async () => {
  BlogRead.create = async () => { throw new Error("offline"); };
  const res = response();
  await controller.recordRead(request(), res);
  assert.equal(res.statusCode, 500);
});

test("ranking counts only launch-era reads, excludes deleted posts before limiting, and resolves ties deterministically", async () => {
  let pipeline;
  const items = [{ _id: postId, readCount: 3, date: "2025-09-26" }];
  BlogRead.aggregate = async (stages) => { pipeline = stages; return items; };
  const res = response();
  await controller.getMostRead({ query: { limit: 999, windowDays: 1 } }, res);
  assert.deepEqual(res.body.items, items);
  assert.equal(pipeline[0].$match.recordedAt.$gte, TRACKING_STARTED_AT);
  assert.deepEqual(pipeline.find((stage) => stage.$sort).$sort, { readCount: -1, lastReadAt: -1, _id: 1 });
  assert.ok(pipeline.findIndex((stage) => stage.$unwind) < pipeline.findIndex((stage) => stage.$limit));
  assert.equal(pipeline.find((stage) => stage.$limit).$limit, 4);
  assert.equal(res.body.meta.minimumReadMs, 30_000);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("a fresh launch returns no badges instead of inventing reads", async () => {
  BlogRead.aggregate = async () => [];
  const res = response();
  await controller.getMostRead({}, res);
  assert.deepEqual(res.body.items, []);
});
