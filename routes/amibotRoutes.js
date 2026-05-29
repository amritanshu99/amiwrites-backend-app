const express = require("express");
const router = express.Router();
const { askAmibot } = require("../controllers/amibotController");
const { aiRateLimiter } = require("../middleware/rateLimiters");

// POST /api/amibot
router.post("/", aiRateLimiter, askAmibot);

module.exports = router;
