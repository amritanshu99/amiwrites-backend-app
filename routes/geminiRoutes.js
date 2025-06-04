const express = require("express");
const router = express.Router();
const { generateGeminiContent } = require("../controllers/geminiController");

router.post("/generate", generateGeminiContent);

module.exports = router;
