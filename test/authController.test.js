const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/Users");
const authController = require("../controllers/authController");

const originalEnv = {
  adminUsername: process.env.AMIBOT_ADMIN_USERNAME,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  jwtSecret: process.env.JWT_SECRET,
};
const originals = {
  compare: bcrypt.compare,
  exists: User.exists,
  findById: User.findById,
  findOne: User.findOne,
  findOneAndUpdate: User.findOneAndUpdate,
  hash: bcrypt.hash,
  save: User.prototype.save,
};

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

function installGooglePayload(payload) {
  authController.__test.setGoogleTokenVerifier({
    async verifyIdToken({ idToken, audience }) {
      assert.equal(idToken, "google-id-token");
      assert.equal(audience, "test-client.apps.googleusercontent.com");
      return { getPayload: () => payload };
    },
  });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test.beforeEach(() => {
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  delete process.env.AMIBOT_ADMIN_USERNAME;
  authController.__test.setEmailSender(async () => {});
});

test.afterEach(() => {
  bcrypt.compare = originals.compare;
  bcrypt.hash = originals.hash;
  User.exists = originals.exists;
  User.findById = originals.findById;
  User.findOne = originals.findOne;
  User.findOneAndUpdate = originals.findOneAndUpdate;
  User.prototype.save = originals.save;
  authController.__test.resetEmailSender();
  authController.__test.resetGoogleTokenVerifier();
});

test.after(() => {
  restoreEnv("AMIBOT_ADMIN_USERNAME", originalEnv.adminUsername);
  restoreEnv("GOOGLE_CLIENT_ID", originalEnv.googleClientId);
  restoreEnv("JWT_SECRET", originalEnv.jwtSecret);
});

test("public signup reserves fallback and configured admin usernames case-insensitively", async () => {
  process.env.AMIBOT_ADMIN_USERNAME = "SiteOwner";
  let databaseCalled = false;
  User.findOne = () => {
    databaseCalled = true;
    throw new Error("reserved usernames must be rejected before querying");
  };

  for (const username of ["AMRITANSHU99", "siteowner"]) {
    const res = response();
    await authController.signup({
      body: {
        username,
        email: `${username.toLowerCase()}@example.com`,
        password: "password!1",
      },
    }, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "USERNAME_RESERVED");
  }

  assert.equal(databaseCalled, false);
});

test("Google username generation avoids admin names and resolves collisions deterministically", async () => {
  process.env.AMIBOT_ADMIN_USERNAME = "Owner";
  const seen = [];
  const username = await authController.__test.generateUniqueGoogleUsername(
    {
      email: "OWNER@example.com",
      displayName: "Owner",
      googleSub: "1234567890",
    },
    async (candidate) => {
      seen.push(candidate);
      return candidate === "writer-owner";
    }
  );

  assert.equal(authController.__test.isReservedAdminUsername(username), false);
  assert.equal(username, "writer-owner_1234567890");
  assert.deepEqual(seen, ["writer-owner", "writer-owner_1234567890"]);
  assert.ok(username.length <= 50);
});

test("Google profile claims normalize names, resize Google avatars, and reject unsafe URLs", () => {
  assert.equal(
    authController.__test.normalizeDisplayName("  A\nName\u202e  "),
    "A Name"
  );
  assert.equal(
    authController.__test.normalizeAvatarUrl(
      "https://lh3.googleusercontent.com/a/profile=s96-c#ignored"
    ),
    "https://lh3.googleusercontent.com/a/profile=s256-c"
  );
  assert.equal(
    authController.__test.normalizeAvatarUrl("https://images.example.com/avatar.png"),
    "https://images.example.com/avatar.png"
  );
  assert.equal(authController.__test.normalizeAvatarUrl("http://images.example.com/avatar.png"), "");
  assert.equal(authController.__test.normalizeAvatarUrl("https://user:pass@example.com/avatar.png"), "");
  assert.equal(authController.__test.normalizeAvatarUrl(`https://example.com/${"a".repeat(2050)}`), "");
});

test("user schema requires a password for local accounts but not Google accounts", () => {
  const localUser = new User({ username: "local-user", email: "local@example.com" });
  const googleUser = new User({
    username: "google-user",
    email: "google@example.com",
    googleSub: "google-sub",
    authProviders: ["google"],
  });

  assert.ok(localUser.validateSync()?.errors.password);
  assert.equal(googleUser.validateSync(), undefined);
  assert.deepEqual([...googleUser.authProviders], ["google"]);
  assert.equal(googleUser.authVersion, 0);
});

test("signup maps a database uniqueness race to a stable 409 response", async () => {
  User.findOne = () => ({ lean: async () => null });
  bcrypt.hash = async () => "hashed-password";
  User.prototype.save = async () => {
    const error = new Error("duplicate key");
    error.code = 11000;
    throw error;
  };

  const res = response();
  await authController.signup({
    body: {
      username: "new-user",
      email: "new-user@example.com",
      password: "password!1",
    },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    code: "ACCOUNT_EXISTS",
    message: "An account with that username or email already exists",
  });
});

test("Google auth returns 503 when its client ID is not configured", async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  const res = response();

  await authController.googleAuth({ body: { credential: "google-id-token" } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    code: "GOOGLE_AUTH_NOT_CONFIGURED",
    message: "Google authentication is not configured",
  });
});

test("Google auth never silently links an existing password account", async () => {
  installGooglePayload({
    sub: "google-sub",
    email: "legacy@example.com",
    email_verified: true,
    name: "Legacy User",
  });
  const legacyUser = {
    _id: "507f1f77bcf86cd799439011",
    username: "legacy-user",
    email: "legacy@example.com",
    password: "stored-hash",
  };
  User.findOne = async (query) => (query.googleSub ? null : legacyUser);

  const res = response();
  await authController.googleAuth({ body: { credential: "google-id-token" } }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    code: "ACCOUNT_LINK_REQUIRED",
    message: "Enter your existing account password to link Google",
    email: "legacy@example.com",
  });
  assert.equal(legacyUser.googleSub, undefined);
});

test("Google auth links a legacy account only after password confirmation and preserves admin username", async () => {
  installGooglePayload({
    sub: "google-sub",
    email: "admin@example.com",
    email_verified: true,
    name: "Admin Name",
    picture: "https://lh3.googleusercontent.com/a/admin=s96-c",
  });
  const sentEmails = [];
  authController.__test.setEmailSender(async (message) => {
    sentEmails.push(message);
  });
  const adminUser = {
    _id: "507f1f77bcf86cd799439011",
    username: "amritanshu99",
    email: "admin@example.com",
    password: "stored-hash",
    authProviders: ["password"],
  };
  User.findOne = async (query) => (query.googleSub ? null : adminUser);
  User.findOneAndUpdate = async (filter, update, options) => {
    assert.equal(String(filter._id), adminUser._id);
    assert.deepEqual(filter.$or, [
      { googleSub: { $exists: false } },
      { googleSub: null },
      { googleSub: "" },
    ]);
    assert.deepEqual(options, { new: true, runValidators: true });
    Object.assign(adminUser, update.$set);
    adminUser.authProviders = [...new Set([...adminUser.authProviders, update.$addToSet.authProviders])];
    return adminUser;
  };
  bcrypt.compare = async (password, hash) => password === "correct-password" && hash === "stored-hash";

  const res = response();
  await authController.googleAuth({
    body: { credential: "google-id-token", password: "correct-password" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Google account linked successfully");
  assert.equal(res.body.user.username, "amritanshu99");
  assert.equal(adminUser.googleSub, "google-sub");
  assert.equal(adminUser.emailVerified, true);
  assert.deepEqual(adminUser.authProviders, ["password", "google"]);
  assert.deepEqual(
    (({ id, username }) => ({ id, username }))(jwt.verify(res.body.token, process.env.JWT_SECRET)),
    { id: adminUser._id, username: "amritanshu99" }
  );
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).authVersion, 0);
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).displayName, "Admin Name");
  assert.equal(
    jwt.verify(res.body.token, process.env.JWT_SECRET).avatarUrl,
    "https://lh3.googleusercontent.com/a/admin=s256-c"
  );
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "admin@example.com");
  assert.match(sentEmails[0].subject, /^Welcome Back to AmiVerse!/);
});

test("new Google accounts receive sanitized profile claims in the app JWT", async () => {
  installGooglePayload({
    sub: "new-google-sub",
    email: "new-google@example.com",
    email_verified: true,
    name: "  New\nWriter  ",
    picture: "https://lh3.googleusercontent.com/a/new-writer=s64-c",
  });
  let savedUser;
  const sentEmails = [];
  authController.__test.setEmailSender(async (message) => {
    sentEmails.push(message);
  });
  User.findOne = async () => null;
  User.exists = async () => false;
  User.prototype.save = async function save() {
    savedUser = this;
    return this;
  };

  const res = response();
  await authController.googleAuth({ body: { credential: "google-id-token" } }, res);

  const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
  assert.equal(res.statusCode, 201);
  assert.equal(claims.id, String(savedUser._id));
  assert.equal(claims.username, "new-google");
  assert.equal(claims.authVersion, 0);
  assert.equal(claims.displayName, "New Writer");
  assert.equal(
    claims.avatarUrl,
    "https://lh3.googleusercontent.com/a/new-writer=s256-c"
  );
  assert.equal(res.body.user.avatarUrl, claims.avatarUrl);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "new-google@example.com");
  assert.match(sentEmails[0].subject, /^Welcome to AmiVerse!/);
});

test("returning Google sign-in refreshes signed display name and avatar", async () => {
  installGooglePayload({
    sub: "returning-google-sub",
    email: "returning@example.com",
    email_verified: true,
    name: " Updated\tName ",
    picture: "https://lh3.googleusercontent.com/a/returning=s48-c",
  });
  let saveCalls = 0;
  const sentEmails = [];
  authController.__test.setEmailSender(async (message) => {
    sentEmails.push(message);
  });
  const user = {
    _id: "507f1f77bcf86cd799439031",
    username: "returning-user",
    email: "returning@example.com",
    googleSub: "returning-google-sub",
    displayName: "Old Name",
    avatarUrl: "https://lh3.googleusercontent.com/a/returning=s256-c",
    authProviders: ["google"],
    authVersion: 2,
    async save() {
      saveCalls += 1;
      return this;
    },
  };
  User.findOne = async () => user;

  const res = response();
  await authController.googleAuth({ body: { credential: "google-id-token" } }, res);

  const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
  assert.equal(res.statusCode, 200);
  assert.equal(saveCalls, 1);
  assert.equal(user.displayName, "Updated Name");
  assert.equal(user.avatarUrl, "https://lh3.googleusercontent.com/a/returning=s256-c");
  assert.equal(claims.displayName, "Updated Name");
  assert.equal(claims.avatarUrl, user.avatarUrl);
  assert.equal(claims.authVersion, 2);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "returning@example.com");
  assert.match(sentEmails[0].subject, /^Welcome Back to AmiVerse!/);
});

test("Google auth treats a lost legacy-link race as a subject mismatch", async () => {
  installGooglePayload({
    sub: "incoming-sub",
    email: "race@example.com",
    email_verified: true,
  });
  const legacyUser = {
    _id: "507f1f77bcf86cd799439014",
    username: "race-user",
    email: "race@example.com",
    password: "stored-hash",
  };
  User.findOne = async (query) => (query.googleSub ? null : legacyUser);
  User.findOneAndUpdate = async () => null;
  User.findById = async () => ({ ...legacyUser, googleSub: "winning-sub" });
  bcrypt.compare = async () => true;

  const res = response();
  await authController.googleAuth({
    body: { credential: "google-id-token", password: "correct-password" },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "GOOGLE_ACCOUNT_MISMATCH");
});

test("Google auth rejects an email already linked to a different Google subject", async () => {
  installGooglePayload({
    sub: "incoming-sub",
    email: "linked@example.com",
    email_verified: true,
  });
  User.findOne = async (query) => (
    query.googleSub
      ? null
      : {
          _id: "507f1f77bcf86cd799439012",
          username: "linked-user",
          email: "linked@example.com",
          googleSub: "different-sub",
        }
  );

  const res = response();
  await authController.googleAuth({ body: { credential: "google-id-token", password: "anything" } }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "GOOGLE_ACCOUNT_MISMATCH");
});

test("password login accepts a normalized email identifier and returns the unified auth payload", async () => {
  let lookup;
  const sentEmails = [];
  authController.__test.setEmailSender(async (message) => {
    sentEmails.push(message);
  });
  const user = {
    _id: "507f1f77bcf86cd799439013",
    username: "email-user",
    email: "email@example.com",
    password: "stored-hash",
    authProviders: ["password"],
    async save() {
      return this;
    },
  };
  User.findOne = async (query) => {
    lookup = query;
    return user;
  };
  bcrypt.compare = async () => true;

  const res = response();
  await authController.login({
    body: { identifier: "  EMAIL@Example.COM ", password: "password!1" },
  }, res);

  assert.deepEqual(lookup, { email: "email@example.com" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Login successful");
  assert.equal(res.body.user.username, "email-user");
  assert.ok(res.body.token);
  const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
  assert.equal(claims.username, "email-user");
  assert.equal(claims.authVersion, 0);
  assert.equal(Object.hasOwn(claims, "displayName"), false);
  assert.equal(Object.hasOwn(claims, "avatarUrl"), false);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "email@example.com");
  assert.match(sentEmails[0].subject, /^Welcome Back to AmiVerse!/);
});

test("welcome-email delivery failures do not fail a successful login", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  authController.__test.setEmailSender(async () => {
    throw new Error("mail provider unavailable");
  });
  const user = {
    _id: "507f1f77bcf86cd799439041",
    username: "mail-safe-user",
    email: "mail-safe@example.com",
    password: "stored-hash",
    authProviders: ["password"],
    async save() {
      return this;
    },
  };
  User.findOne = async () => user;
  bcrypt.compare = async () => true;

  try {
    const res = response();
    await authController.login({
      body: { identifier: "mail-safe-user", password: "password!1" },
    }, res);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, "Login successful");
    assert.ok(res.body.token);
  } finally {
    console.error = originalConsoleError;
  }
});

test("auth handlers reject missing request bodies without throwing", async () => {
  const loginRes = response();
  await authController.login({}, loginRes);
  assert.equal(loginRes.statusCode, 400);
  assert.equal(loginRes.body.code, "INVALID_CREDENTIALS");

  const googleRes = response();
  await authController.googleAuth({}, googleRes);
  assert.equal(googleRes.statusCode, 400);
  assert.equal(googleRes.body.code, "INVALID_GOOGLE_CREDENTIAL");
});

test("reset requests are non-enumerating and reset-token lookups use a hash", async () => {
  const invalidRes = response();
  await authController.requestPasswordReset({ body: { email: "not-an-email" } }, invalidRes);

  User.findOne = async () => null;
  const unknownRes = response();
  await authController.requestPasswordReset({ body: { email: "unknown@example.com" } }, unknownRes);

  assert.equal(invalidRes.statusCode, 200);
  assert.deepEqual(unknownRes.body, invalidRes.body);

  const rawToken = "a".repeat(64);
  let resetLookup;
  User.findOne = (query) => {
    resetLookup = query;
    return Promise.resolve(null);
  };
  const resetRes = response();
  await authController.resetPassword({
    body: { token: rawToken, newPassword: "new-password!1" },
  }, resetRes);

  assert.equal(resetRes.statusCode, 400);
  assert.notEqual(resetLookup.resetToken, rawToken);
  assert.equal(resetLookup.resetToken, authController.__test.hashResetToken(rawToken));
  assert.match(resetLookup.resetToken, /^[0-9a-f]{64}$/);
});

test("password-reset requests persist only a reset-token digest", async () => {
  let saveCalls = 0;
  const user = {
    username: "reset-user",
    email: "reset@example.com",
    async save() {
      saveCalls += 1;
      return this;
    },
  };
  User.findOne = async () => user;

  const res = response();
  await authController.requestPasswordReset({ body: { email: "reset@example.com" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(saveCalls, 1);
  assert.match(user.resetToken, /^[0-9a-f]{64}$/);
  assert.ok(user.resetTokenExpiry > Date.now());
});

test("password reset consumes a matching token with one conditional update", async () => {
  const rawToken = "b".repeat(64);
  const userId = "507f1f77bcf86cd799439015";
  let updateCall;
  User.findOne = async () => ({ _id: userId });
  User.findOneAndUpdate = async (filter, update, options) => {
    updateCall = { filter, update, options };
    return { _id: userId };
  };
  bcrypt.hash = async () => "new-hash";

  const res = response();
  await authController.resetPassword({
    body: { token: rawToken, newPassword: "new-password!1" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Password reset successful");
  assert.equal(updateCall.filter._id, userId);
  assert.equal(updateCall.filter.resetToken, authController.__test.hashResetToken(rawToken));
  assert.deepEqual(updateCall.update, {
    $set: { password: "new-hash" },
    $unset: { resetToken: "", resetTokenExpiry: "" },
    $addToSet: { authProviders: "password" },
    $inc: { authVersion: 1 },
  });
  assert.deepEqual(updateCall.options, { new: true, runValidators: true });
});

test("verify-token rejects deleted users and stale username claims", async () => {
  const userId = "507f1f77bcf86cd799439016";
  const token = jwt.sign({ id: userId, username: "old-admin-name" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
  });
  const req = { header: () => `Bearer ${token}` };

  User.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: userId, username: "old-admin-name", authVersion: 0 }),
  });
  const validRes = response();
  await authController.verifyToken(req, validRes);
  assert.equal(validRes.statusCode, 200);
  assert.equal(validRes.body.user.username, "old-admin-name");

  User.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: userId, username: "renamed-user", authVersion: 0 }),
  });
  const renamedRes = response();
  await authController.verifyToken(req, renamedRes);
  assert.equal(renamedRes.statusCode, 401);
  assert.equal(renamedRes.body.valid, false);

  User.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: userId, username: "old-admin-name", authVersion: 1 }),
  });
  const revokedRes = response();
  await authController.verifyToken(req, revokedRes);
  assert.equal(revokedRes.statusCode, 401);
  assert.equal(revokedRes.body.valid, false);

  User.findById = () => ({
    select() {
      return this;
    },
    lean: async () => null,
  });
  const staleRes = response();
  await authController.verifyToken(req, staleRes);
  assert.equal(staleRes.statusCode, 401);
  assert.equal(staleRes.body.valid, false);
});
