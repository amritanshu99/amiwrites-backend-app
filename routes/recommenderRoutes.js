const express = require("express");
const router = express.Router();
const { getMovieRecommendations } = require("../controllers/recommenderController");

// 🎬 POST /api/recommender/recommend
router.post("/recommend", getMovieRecommendations);

module.exports = router;
