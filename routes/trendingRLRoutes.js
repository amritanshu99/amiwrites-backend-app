const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/trendingRLController");

// Trending rail
router.get("/trending", ctrl.getTrending);

// Events
router.post("/events/impression", ctrl.trackImpression);
router.post("/events/click", ctrl.trackClick);
router.post("/events/read-end", ctrl.trackReadEnd);

module.exports = router;
