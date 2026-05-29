const { createRateLimiter } = require("../utils/security");

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

const authRateLimiter = createRateLimiter({
  windowMs: envInt("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("AUTH_RATE_LIMIT_MAX", 30),
});

const publicWriteRateLimiter = createRateLimiter({
  windowMs: envInt("PUBLIC_WRITE_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("PUBLIC_WRITE_RATE_LIMIT_MAX", 120),
});

const aiRateLimiter = createRateLimiter({
  windowMs: envInt("AI_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("AI_RATE_LIMIT_MAX", 60),
});

const eventRateLimiter = createRateLimiter({
  windowMs: envInt("EVENT_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("EVENT_RATE_LIMIT_MAX", 300),
});

module.exports = {
  aiRateLimiter,
  authRateLimiter,
  eventRateLimiter,
  publicWriteRateLimiter,
};
