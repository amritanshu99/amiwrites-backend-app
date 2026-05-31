const express = require("express");
const pulseController = require("../controllers/pulse.controller");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/public", pulseController.getPublicPulse);
router.get("/weather", pulseController.getOwnerWeather);
router.get("/admin/reverse-geocode", authMiddleware, pulseController.reverseGeocodeLocation);
router.get("/admin", authMiddleware, pulseController.getAdminPulse);
router.put("/admin", authMiddleware, pulseController.updatePulse);

module.exports = router;
