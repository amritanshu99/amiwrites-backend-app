const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/trendingRLController");
const { eventRateLimiter } = require("../middleware/rateLimiters");

// Trending rail
router.get("/trending", ctrl.getTrending);

// Events
router.post("/events/impression", eventRateLimiter, ctrl.trackImpression);
router.post("/events/click", eventRateLimiter, ctrl.trackClick);
router.post("/events/read-end", eventRateLimiter, ctrl.trackReadEnd);

module.exports = router;
