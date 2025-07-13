// routes/emotionRoutes.js
const express = require("express");
const router = express.Router();
const { analyzeEmotion } = require("../controllers/emotionController");

// ✅ GET /api/emotion/:text
router.get("/:text", analyzeEmotion);

module.exports = router;
