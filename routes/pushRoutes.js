const express = require('express');
const router = express.Router();
const pushController = require('../controllers/pushController');

router.post('/subscribe', pushController.subscribe);

module.exports = router;
