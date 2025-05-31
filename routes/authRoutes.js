const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { signup, login } = authController;

router.post("/signup", signup);
router.post("/login", login);
router.post("/request-reset", authController.requestPasswordReset);
router.post("/reset-password", authController.resetPassword);

module.exports = router;
