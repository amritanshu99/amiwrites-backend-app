// routes/newsRoutes.js
const express = require("express");
const router = express.Router();
const { getTechNews } = require("../controllers/newsController");

router.get("/tech-news", getTechNews);

module.exports = router;
