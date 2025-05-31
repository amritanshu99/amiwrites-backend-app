// routes/portfolioRoutes.js
const express = require("express");
const router = express.Router();
const { getPortfolio } = require("../controllers/portfolioController");

router.get("/", getPortfolio);

module.exports = router;
