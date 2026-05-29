const express = require('express');
const router = express.Router();
const pushController = require('../controllers/pushController');
const { publicWriteRateLimiter } = require('../middleware/rateLimiters');

router.post('/subscribe', publicWriteRateLimiter, pushController.subscribe);

module.exports = router;
