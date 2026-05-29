const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.amiverse.in",
  "https://amiverse.in",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
];

function splitEnvList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCorsOptions() {
  const configuredOrigins = splitEnvList(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
  const allowedOrigins = new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has("*") || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    optionsSuccessStatus: 204,
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEmail(value = "") {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(value = "") {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clampPositiveInt(value, { defaultValue, min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

function getBearerToken(req) {
  const header = req.header("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "yourSecretKey") {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = "Too many requests, please try again later.",
  keyGenerator = (req) => req.ip || req.socket?.remoteAddress || "unknown",
} = {}) {
  const hits = new Map();
  let nextCleanup = Date.now() + windowMs;

  return function rateLimiter(req, res, next) {
    const now = Date.now();

    if (now >= nextCleanup) {
      for (const [key, entry] of hits.entries()) {
        if (entry.resetAt <= now) hits.delete(key);
      }
      nextCleanup = now + windowMs;
    }

    const key = keyGenerator(req);
    const current = hits.get(key);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

    entry.count += 1;
    hits.set(key, entry);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return res.status(429).json({ message });
    }

    return next();
  };
}

module.exports = {
  buildCorsOptions,
  clampPositiveInt,
  createRateLimiter,
  escapeHtml,
  escapeRegExp,
  getBearerToken,
  isValidEmail,
  normalizeEmail,
  requireJwtSecret,
};
