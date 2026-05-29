const DEFAULT_PRODUCTION_ORIGINS = [
  "https://www.amiverse.in",
  "https://amiverse.in",
];

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

const ORIGIN_ENV_KEYS = [
  "ALLOWED_ORIGINS",
  "CLIENT_URL",
  "CORS_ORIGINS",
  "CORS_ORIGIN",
  "PUBLIC_FRONTEND_URL",
];

function splitEnvList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function isProductionEnv(env = process.env) {
  return env.NODE_ENV === "production";
}

function normalizeOrigin(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "*") return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin = "") {
  try {
    const { hostname } = new URL(origin);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

function getCorsMaxAge(env = process.env) {
  const configured = Number.parseInt(env.CORS_MAX_AGE_SECONDS, 10);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return isProductionEnv(env) ? 86400 : 600;
}

function buildAllowedOrigins(env = process.env) {
  const configuredOrigins = ORIGIN_ENV_KEYS
    .flatMap((key) => splitEnvList(env[key]))
    .map(normalizeOrigin)
    .filter(Boolean);

  const allowedOrigins = new Set(configuredOrigins);

  DEFAULT_PRODUCTION_ORIGINS.forEach((origin) => allowedOrigins.add(origin));

  if (!isProductionEnv(env)) {
    LOCAL_DEVELOPMENT_ORIGINS.forEach((origin) => allowedOrigins.add(origin));
  }

  if (isProductionEnv(env)) {
    for (const origin of allowedOrigins) {
      if (isLocalOrigin(origin)) allowedOrigins.delete(origin);
    }
  }

  return allowedOrigins;
}

function buildCorsOptions(env = process.env) {
  const allowedOrigins = buildAllowedOrigins(env);
  const credentials = parseBoolean(env.CORS_CREDENTIALS, false);

  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      return callback(null, allowedOrigins.has(normalizeOrigin(origin)));
    },
    credentials,
    maxAge: getCorsMaxAge(env),
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
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }

    return next();
  };
}

module.exports = {
  buildAllowedOrigins,
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
