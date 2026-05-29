const User = require("../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");
const {
  escapeHtml,
  getBearerToken,
  isValidEmail,
  normalizeEmail,
  requireJwtSecret,
} = require("../utils/security");

const PASSWORD_REGEX = /^(?=.*[0-9])(?=.*[!@#$%^&*])/;
const RESET_TOKEN_REGEX = /^[0-9a-f]{64}$/i;

const MAIL_FROM = process.env.MAIL_FROM;
let resendClient;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not set. Configure RESEND_API_KEY env var.");
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 10 && PASSWORD_REGEX.test(password);
}

function passwordMessage() {
  return "Password must be at least 10 characters long and include at least one number and one special character";
}

function signAuthToken(user, secret) {
  return jwt.sign(
    { id: user._id, username: user.username },
    secret,
    { expiresIn: "7d", algorithm: "HS256" }
  );
}

async function sendEmail({ to, subject, html }) {
  if (!MAIL_FROM) throw new Error("MAIL_FROM not set. Configure MAIL_FROM env var.");

  const { error } = await getResendClient().emails.send({
    from: MAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) throw error;
}

exports.signup = async (req, res) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!username || username.length > 50) {
      return res.status(400).json({ message: "Username is required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ message: passwordMessage() });
    }

    const jwtSecret = requireJwtSecret();
    const existingUser = await User.findOne({ $or: [{ username }, { email }] }).lean();

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    const safeUsername = escapeHtml(username);
    sendEmail({
      to: email,
      subject: "Welcome to AmiVerse! Your new writing adventure begins here.",
      html: `
        <h2>Welcome, ${safeUsername}!</h2>
        <p>Thank you for joining AmiVerse - a community where your creativity takes flight and your stories find their voice.</p>
        <p>We're thrilled to have you onboard as you embark on your writing journey. Whether you want to share your thoughts, publish your work, or just explore, AmiVerse is here to support you every step of the way.</p>
        <p>If you ever need assistance or have questions, our support team is just an email away. We're excited to see what amazing content you'll create!</p>
        <p>Happy writing and welcome to the family!</p>
        <p>Best regards,<br/><strong>The AmiVerse Team</strong></p>
      `,
    }).catch((err) => console.error("Welcome email error:", err?.message || err));

    const token = signAuthToken(user, jwtSecret);
    res.status(201).json({ message: "Signup successful", token });
  } catch (err) {
    console.error("Signup error:", err.message || err);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

exports.login = async (req, res) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const { password } = req.body;

    if (!username || typeof password !== "string") {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = signAuthToken(user, requireJwtSecret());
    const safeUsername = escapeHtml(username);

    sendEmail({
      to: user.email,
      subject: "Welcome Back to AmiVerse! Keep creating your magic.",
      html: `
        <h2>Welcome back, ${safeUsername}!</h2>
        <p>We're so glad to see you again at AmiVerse.</p>
        <p>Your passion for storytelling inspires us! Whether you're here to write a new chapter or just to catch up, remember that your creative journey is important and we're here to support it.</p>
        <p>Keep sharing your voice and creating amazing content. If there's anything you need, don't hesitate to reach out to our support team.</p>
        <p>Thanks for being a part of AmiVerse!</p>
        <p>Warm wishes,<br/><strong>The AmiVerse Team</strong></p>
      `,
    }).catch((err) => console.error("Login email error:", err?.message || err));

    res.json({ token });
  } catch (err) {
    console.error("Login error:", err.message || err);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 3600000;
    await user.save();

    const frontendUrl = process.env.PUBLIC_FRONTEND_URL || "https://www.amiverse.in";
    const resetURL = `${frontendUrl.replace(/\/$/, "")}/reset-password/${token}`;
    const safeUsername = escapeHtml(user.username);

    try {
      await sendEmail({
        to: user.email,
        subject: "Password Reset",
        html: `
          <p>Hello ${safeUsername},</p>
          <p>You requested a password reset.</p>
          <p>Click <a href="${resetURL}">here</a> to reset your password. This link expires in 1 hour.</p>
          <p>If you did not request this, please ignore this email.</p>
          <br />
          <p>Regards,<br/><strong>AmiVerse Team</strong></p>
        `,
      });

      console.log(`Password reset email sent to ${user.email}`);
      res.json({ message: "Password reset email sent" });
    } catch (emailErr) {
      console.error("Failed to send password reset email:", emailErr?.message || emailErr);
      res.status(500).json({ message: "Failed to send password reset email" });
    }
  } catch (err) {
    console.error("requestPasswordReset error:", err.message || err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (typeof token !== "string" || !RESET_TOKEN_REGEX.test(token)) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    if (!validatePassword(newPassword)) {
      return res.status(400).json({ message: passwordMessage() });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("resetPassword error:", err.message || err);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

exports.validateResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (typeof token !== "string" || !RESET_TOKEN_REGEX.test(token)) {
      return res.status(400).json({ valid: false, message: "Invalid or expired token" });
    }

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() },
    }).lean();

    if (!user) {
      return res.status(400).json({ valid: false, message: "Invalid or expired token" });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error("validateResetToken error:", err.message || err);
    res.status(500).json({ valid: false, error: "Server error" });
  }
};

exports.verifyToken = (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ valid: false, message: "Missing token" });
  }

  try {
    const decoded = jwt.verify(token, requireJwtSecret(), { algorithms: ["HS256"] });
    return res.status(200).json({ valid: true, user: decoded });
  } catch (err) {
    if (err.message === "JWT_SECRET is not configured") {
      console.error(err.message);
      return res.status(500).json({ valid: false, error: "Server configuration error" });
    }
    return res.status(401).json({ valid: false, message: "Invalid or expired token" });
  }
};
