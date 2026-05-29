const express = require("express");
const router = express.Router();
const { analyzeEmotion } = require("../controllers/emotionController");
const { aiRateLimiter } = require("../middleware/rateLimiters");

router.get("/:text", aiRateLimiter, analyzeEmotion);

module.exports = router;
