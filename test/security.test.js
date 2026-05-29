const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAllowedOrigins,
  buildCorsOptions,
  clampPositiveInt,
  escapeHtml,
  escapeRegExp,
  getBearerToken,
  isValidEmail,
  normalizeEmail,
} = require("../utils/security");

function corsAllows(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (err, allowed) => {
      if (err) return reject(err);
      return resolve(allowed);
    });
  });
}

test("escapeHtml escapes user-controlled email content", () => {
  assert.equal(
    escapeHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"
  );
});

test("email validation normalizes safe addresses and rejects invalid values", () => {
  assert.equal(normalizeEmail("  USER@Example.COM  "), "user@example.com");
  assert.equal(isValidEmail("  USER@Example.COM  "), true);
  assert.equal(isValidEmail("not-an-email"), false);
});

test("query integer parsing clamps pagination-style inputs", () => {
  assert.equal(clampPositiveInt("25", { defaultValue: 2, min: 1, max: 50 }), 25);
  assert.equal(clampPositiveInt("-10", { defaultValue: 2, min: 1, max: 50 }), 1);
  assert.equal(clampPositiveInt("5000", { defaultValue: 2, min: 1, max: 50 }), 50);
  assert.equal(clampPositiveInt("nope", { defaultValue: 2, min: 1, max: 50 }), 2);
});

test("regex search input is escaped before building Mongo regexes", () => {
  assert.equal(escapeRegExp("a+b.c?"), "a\\+b\\.c\\?");
});

test("bearer token parsing only accepts bearer authorization headers", () => {
  const req = (value) => ({ header: () => value });

  assert.equal(getBearerToken(req("Bearer abc.def")), "abc.def");
  assert.equal(getBearerToken(req("bearer token")), "token");
  assert.equal(getBearerToken(req("Basic abc.def")), null);
});

test("CORS allows local development origins outside production", async () => {
  const options = buildCorsOptions({ NODE_ENV: "development" });

  assert.equal(await corsAllows(options, "http://localhost:3000"), true);
  assert.equal(await corsAllows(options, "http://localhost:5173"), true);
  assert.equal(await corsAllows(options, "http://127.0.0.1:3000"), true);
  assert.equal(await corsAllows(options, "http://127.0.0.1:5173"), true);
  assert.equal(await corsAllows(options, "http://evil.example"), false);
  assert.equal(options.credentials, false);
});

test("CORS production origins come from env and exclude localhost and wildcards", async () => {
  const env = {
    NODE_ENV: "production",
    ALLOWED_ORIGINS: "https://app.example.com,*,http://localhost:3000",
    CLIENT_URL: "https://www.amiverse.in/",
    CORS_CREDENTIALS: "true",
  };
  const allowedOrigins = buildAllowedOrigins(env);
  const options = buildCorsOptions(env);

  assert.deepEqual(
    [...allowedOrigins].sort(),
    ["https://app.example.com", "https://www.amiverse.in"]
  );
  assert.equal(await corsAllows(options, "https://app.example.com"), true);
  assert.equal(await corsAllows(options, "http://localhost:3000"), false);
  assert.equal(options.credentials, true);
});
