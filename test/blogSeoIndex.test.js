const test = require("node:test");
const assert = require("node:assert/strict");
const Blog = require("../models/Blog");
const cache = require("../utils/cache");
const blogController = require("../controllers/blogController");

const originalFind = Blog.find;

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test.beforeEach(() => {
  cache.flushAll();
});

test.after(() => {
  Blog.find = originalFind;
  cache.flushAll();
});

test("SEO index returns a bounded, projected newest-first blog feed with cache headers", async () => {
  const calls = {};
  const records = [
    {
      _id: "64b000000000000000000012",
      slug: "newer-post",
      title: "Newer post",
      category: "engineering",
      content: `<p>R&amp;D turns <strong>${"useful engineering details ".repeat(22)}</strong></p><script>alert("skip me")</script>`,
      date: new Date("2026-08-10T00:00:00.000Z"),
      publishedAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  ];
  const query = {
    select(projection) {
      calls.projection = projection;
      return this;
    },
    sort(sort) {
      calls.sort = sort;
      return this;
    },
    limit(limit) {
      calls.limit = limit;
      return this;
    },
    async lean() {
      return records;
    },
  };

  Blog.find = (filter) => {
    calls.filter = filter;
    return query;
  };

  const res = response();
  await blogController.getBlogSeoIndex({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.blogs[0]._id, records[0]._id);
  assert.equal(res.body.blogs[0].content, undefined);
  assert.match(res.body.blogs[0].excerpt, /^R&D turns useful engineering details/);
  assert.doesNotMatch(res.body.blogs[0].excerpt, /<[^>]+>|skip me/);
  assert.ok(res.body.blogs[0].excerpt.length >= 300);
  assert.ok(res.body.blogs[0].excerpt.length <= 400);
  assert.match(
    res.headers["Cache-Control"],
    /^public, max-age=300, s-maxage=900, stale-while-revalidate=86400$/
  );
  assert.equal(calls.limit, 1000);
  assert.deepEqual(calls.sort, { date: -1, _id: -1 });
  assert.deepEqual(calls.projection, {
    _id: 1,
    slug: 1,
    title: 1,
    category: 1,
    content: 1,
    date: 1,
    publishedAt: 1,
    updatedAt: 1,
  });
  assert.equal(calls.filter.$or[0].publishedAt.$exists, false);
  assert.equal(calls.filter.$or[1].publishedAt, null);
  assert.ok(calls.filter.$or[2].publishedAt.$lte instanceof Date);
});

test("SEO index reuses its short-lived server cache without exposing content", async () => {
  let findCalls = 0;
  const records = [{
    _id: "64b000000000000000000013",
    title: "Cached post",
    content: "A safe cached description.",
  }];

  Blog.find = () => {
    findCalls += 1;
    return {
      select() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      async lean() {
        return records;
      },
    };
  };

  const first = response();
  const second = response();
  await blogController.getBlogSeoIndex({ query: {} }, first);
  await blogController.getBlogSeoIndex({ query: {} }, second);

  assert.equal(findCalls, 1);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.body.blogs[0].content, undefined);
  assert.equal(second.body.blogs[0].excerpt, "A safe cached description.");
  assert.equal(second.headers["Cache-Control"], first.headers["Cache-Control"]);
});

test("SEO index route is registered before the dynamic blog id route", () => {
  const router = require("../routes/blogRoutes");
  const getPaths = router.stack
    .filter((layer) => layer.route?.methods?.get)
    .map((layer) => layer.route.path);

  assert.ok(getPaths.indexOf("/seo-index") >= 0);
  assert.ok(getPaths.indexOf("/seo-index") < getPaths.indexOf("/:id"));
});
