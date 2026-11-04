const router = require("express").Router();
const { getMostRead, recordRead } = require("../controllers/mostReadController");
const { eventRateLimiter } = require("../middleware/rateLimiters");

router.get("/", getMostRead);
router.post("/reads", eventRateLimiter, recordRead);

module.exports = router;
