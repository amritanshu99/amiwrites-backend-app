const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authRateLimiter } = require("../middleware/rateLimiters");

router.post("/signup", authRateLimiter, authController.signup);
router.post("/login", authRateLimiter, authController.login);
router.post("/request-reset", authRateLimiter, authController.requestPasswordReset);
router.post("/reset", authRateLimiter, authController.resetPassword);
router.get("/validate-reset-token/:token", authController.validateResetToken);
router.post("/verify-token", authController.verifyToken);

module.exports = router;
