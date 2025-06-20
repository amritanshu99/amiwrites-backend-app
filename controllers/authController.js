const User = require("../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

// Setup reusable transporter object with Gmail SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail email
    pass: process.env.EMAIL_PASS, // Your Gmail app password or regular password if less secure apps enabled
  },
});

// Helper to send emails
async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"AmiVerse Support" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    // optionally continue without blocking signup/login
  }
}

exports.signup = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    const passwordRegex = /^(?=.*[0-9])(?=.*[!@#$%^&*])/;
    if (!password || password.length < 10 || !passwordRegex.test(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 10 characters long and include at least one number and one special character",
      });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    // Send welcome email on signup
    await sendEmail({
      to: email,
      subject: "Welcome to AmiVerse! Your new writing adventure begins here.",
      html: `
        <h2>Welcome, ${username}!</h2>
        <p>Thank you for joining AmiVerse — a community where your creativity takes flight and your stories find their voice.</p>
        <p>We’re thrilled to have you onboard as you embark on your writing journey. Whether you want to share your thoughts, publish your work, or just explore, AmiVerse is here to support you every step of the way.</p>
        <p>If you ever need assistance or have questions, our support team is just an email away. We're excited to see what amazing content you'll create!</p>
        <p>Happy writing and welcome to the family!</p>
        <p>Best regards,<br/><strong>The AmiVerse Team</strong></p>
      `,
    });

    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({ message: "Signup successful", token });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Send "Welcome Back" email on login
    await sendEmail({
      to: user.email,
      subject: "Welcome Back to AmiVerse! Keep creating your magic.",
      html: `
        <h2>Welcome back, ${username}!</h2>
        <p>We’re so glad to see you again at AmiVerse.</p>
        <p>Your passion for storytelling inspires us! Whether you’re here to write a new chapter or just to catch up, remember that your creative journey is important and we're here to support it.</p>
        <p>Keep sharing your voice and creating amazing content. If there’s anything you need, don’t hesitate to reach out to our support team.</p>
        <p>Thanks for being a part of AmiVerse!</p>
        <p>Warm wishes,<br/><strong>The AmiVerse Team</strong></p>
      `,
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
    await user.save();

    // ✅ Use production reset URL
    const resetURL = `https://www.amiverse.in/reset-password/${token}`;

    try {
      await sendEmail({
        to: user.email,
        subject: "Password Reset",
        html: `
          <p>Hello ${user.username},</p>
          <p>You requested a password reset.</p>
          <p>Click <a href="${resetURL}">here</a> to reset your password. This link expires in 1 hour.</p>
          <p>If you did not request this, please ignore this email.</p>
          <br />
          <p>Regards,<br/><strong>AmiVerse Team</strong></p>
        `,
      });

      console.log(`✅ Password reset email sent to ${user.email}`);
      res.json({ message: "Password reset email sent" });
    } catch (emailErr) {
      console.error("❌ Failed to send password reset email:", emailErr);
      res.status(500).json({ message: "Failed to send password reset email" });
    }

  } catch (err) {
    console.error("❌ requestPasswordReset error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};



exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    const passwordRegex = /^(?=.*[0-9])(?=.*[!@#$%^&*])/;
    if (newPassword.length < 10 || !passwordRegex.test(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 10 characters long and include at least one number and one special character",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.validateResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ valid: false, message: "Invalid or expired token" });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error("❌ validateResetToken error:", err);
    res.status(500).json({ valid: false, error: "Server error" });
  }
};