const express = require("express");
const router = express.Router();
const { sendContactMail } = require("../controllers/contactController");
const { publicWriteRateLimiter } = require("../middleware/rateLimiters");

router.post("/contact", publicWriteRateLimiter, sendContactMail);

module.exports = router;
