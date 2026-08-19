const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const User = require("../models/Users");
const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

const originalFindById = User.findById;
const originalJwtSecret = process.env.JWT_SECRET;
const USER_ID = "507f1f77bcf86cd799439021";

function response() {
  return {
    statusCode: 200,
    body: null,
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

function bearerRequest(token) {
  return {
    header(name) {
      return name === "Authorization" ? `Bearer ${token}` : "";
    },
  };
}

function mockUserLookup(result) {
  User.findById = (id) => {
    assert.equal(id, USER_ID);
    return {
      select(fields) {
        assert.equal(fields, "_id username authVersion");
        return this;
      },
      lean: async () => result,
    };
  };
}

test.beforeEach(() => {
  process.env.JWT_SECRET = "middleware-test-secret-with-enough-entropy";
});

test.afterEach(() => {
  User.findById = originalFindById;
});

test.after(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

test("required auth loads the current account before attaching JWT claims", async () => {
  mockUserLookup({ _id: USER_ID, username: "current-user" });
  const token = jwt.sign({ id: USER_ID, username: "current-user" }, process.env.JWT_SECRET);
  const req = bearerRequest(token);
  const res = response();
  let nextCalls = 0;

  await authMiddleware(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(req.user.id, USER_ID);
  assert.equal(req.user.username, "current-user");
});

test("required auth rejects deleted accounts, stale usernames, and revoked auth versions", async () => {
  const token = jwt.sign({ id: USER_ID, username: "old-admin" }, process.env.JWT_SECRET);

  for (const currentUser of [
    null,
    { _id: USER_ID, username: "renamed-user" },
    { _id: USER_ID, username: "old-admin", authVersion: 1 },
  ]) {
    mockUserLookup(currentUser);
    const req = bearerRequest(token);
    const res = response();
    let nextCalls = 0;

    await authMiddleware(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { message: "Invalid token" });
  }
});

test("optional auth treats deleted, renamed, or revoked-token accounts as guests", async () => {
  const token = jwt.sign({ id: USER_ID, username: "old-user" }, process.env.JWT_SECRET);

  for (const currentUser of [
    null,
    { _id: USER_ID, username: "renamed-user" },
    { _id: USER_ID, username: "old-user", authVersion: 1 },
  ]) {
    mockUserLookup(currentUser);
    const req = bearerRequest(token);
    req.user = { username: "must-be-cleared" };
    const res = response();
    let nextCalls = 0;

    await optionalAuthMiddleware(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 1);
    assert.equal(req.user, undefined);
    assert.equal(res.statusCode, 200);
  }
});
