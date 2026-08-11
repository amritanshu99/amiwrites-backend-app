const test = require("node:test");
const assert = require("node:assert/strict");
const Blog = require("../models/Blog");
const BlogStat = require("../models/BlogStat");
const TrendingEventReceipt = require("../models/TrendingEventReceipt");
const trendingController = require("../controllers/trendingRLController");
const { getEpoch } = require("../utils/trendingPolicy");
const pushController = require("../controllers/pushController");

const originalPush = pushController.sendNotificationToAll;
pushController.sendNotificationToAll = async () => ({ ok: true });
delete require.cache[require.resolve("../controllers/blogController")];
const blogController = require("../controllers/blogController");

const POST_ID = "64b000000000000000000011";
const originals = {
  blogDeleteMany: Blog.deleteMany,
  blogFind: Blog.find,
  blogFindByIdAndDelete: Blog.findByIdAndDelete,
  blogSave: Blog.prototype.save,
  statDeleteMany: BlogStat.deleteMany,
  statDeleteOne: BlogStat.deleteOne,
  statFind: BlogStat.find,
  receiptDeleteMany: TrendingEventReceipt.deleteMany,
};

function lean(value) {
  return { lean: async () => value };
}

function response() {
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

function installTrendingSource() {
  const publishedAt = new Date(getEpoch(new Date()).startedAt.getTime() - 60_000);
  let findCalls = 0;
  Blog.find = () => {
    findCalls += 1;
    return lean([{
      _id: POST_ID,
      title: "Cached post",
      content: "cached post content",
      words: 50,
      category: "test",
      publishedAt,
    }]);
  };
  BlogStat.find = () => lean([]);
  trendingController.invalidateTrendingCache();
  return () => findCalls;
}

async function fetchTrending() {
  const res = response();
  await trendingController.getTrending({ query: { limit: "1" } }, res);
  assert.equal(res.statusCode, 200);
  return res;
}

test.after(() => {
  pushController.sendNotificationToAll = originalPush;
  Blog.deleteMany = originals.blogDeleteMany;
  Blog.find = originals.blogFind;
  Blog.findByIdAndDelete = originals.blogFindByIdAndDelete;
  Blog.prototype.save = originals.blogSave;
  BlogStat.deleteMany = originals.statDeleteMany;
  BlogStat.deleteOne = originals.statDeleteOne;
  BlogStat.find = originals.statFind;
  TrendingEventReceipt.deleteMany = originals.receiptDeleteMany;
});

test("blog creation invalidates the active trending epoch cache", async () => {
  const getFindCalls = installTrendingSource();
  Blog.prototype.save = async function save() {
    this._id = POST_ID;
    return this;
  };

  await fetchTrending();
  await fetchTrending();
  assert.equal(getFindCalls(), 1);

  const res = response();
  await blogController.createBlog(
    {
      user: { username: "amritanshu99" },
      body: { title: "New post", content: "one two three" },
    },
    res
  );
  assert.equal(res.statusCode, 201);

  await fetchTrending();
  assert.equal(getFindCalls(), 2);
});

test("single-blog deletion removes stats and receipts and invalidates trending", async () => {
  const getFindCalls = installTrendingSource();
  const cleanup = [];
  Blog.findByIdAndDelete = async () => ({ _id: POST_ID });
  BlogStat.deleteOne = async (filter) => {
    cleanup.push(["stats", filter]);
    return { deletedCount: 1 };
  };
  TrendingEventReceipt.deleteMany = async (filter) => {
    cleanup.push(["receipts", filter]);
    return { deletedCount: 3 };
  };

  await fetchTrending();
  assert.equal(getFindCalls(), 1);

  const res = response();
  await blogController.deleteBlog(
    { user: { username: "amritanshu99" }, params: { id: POST_ID } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(cleanup, [
    ["stats", { postId: POST_ID }],
    ["receipts", { postId: POST_ID }],
  ]);

  await fetchTrending();
  assert.equal(getFindCalls(), 2);
});

test("delete-all removes every stat and receipt and invalidates trending", async () => {
  const getFindCalls = installTrendingSource();
  const cleanup = [];
  Blog.deleteMany = async () => ({ deletedCount: 2 });
  BlogStat.deleteMany = async (filter) => {
    cleanup.push(["stats", filter]);
    return { deletedCount: 2 };
  };
  TrendingEventReceipt.deleteMany = async (filter) => {
    cleanup.push(["receipts", filter]);
    return { deletedCount: 5 };
  };

  await fetchTrending();
  const res = response();
  await blogController.deleteAllBlogs(
    { user: { username: "amritanshu99" } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(cleanup, [
    ["stats", {}],
    ["receipts", {}],
  ]);
  await fetchTrending();
  assert.equal(getFindCalls(), 2);
});
