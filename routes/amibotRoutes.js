const express = require("express");
const router = express.Router();
const { askAmibot } = require("../controllers/amibotController");

// POST /api/amibot
router.post("/", askAmibot);

module.exports = router;
