const express = require("express");
const router = express.Router();
const spamController = require("../controllers/spamController");

router.post("/spam-check", spamController.checkSpam);

module.exports = router;
