const express = require("express");
const router = express.Router();
const { getMovieRecommendations } = require("../controllers/recommenderController");
const { aiRateLimiter } = require("../middleware/rateLimiters");

router.post("/recommend", aiRateLimiter, getMovieRecommendations);

module.exports = router;
