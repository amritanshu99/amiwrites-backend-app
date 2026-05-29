const express = require("express");
const router = express.Router();
const spamController = require("../controllers/spamController");
const { aiRateLimiter } = require("../middleware/rateLimiters");

router.post("/spam-check", aiRateLimiter, spamController.checkSpam);

module.exports = router;
