const express = require("express");
const router = express.Router();
const { generateGeminiContent } = require("../controllers/geminiController");
const { aiRateLimiter } = require("../middleware/rateLimiters");

router.post("/generate", aiRateLimiter, generateGeminiContent);

module.exports = router;
