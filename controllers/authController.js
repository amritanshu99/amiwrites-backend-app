const User = require("../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");
const { OAuth2Client } = require("google-auth-library");
const {
  escapeHtml,
  getBearerToken,
  isValidEmail,
  normalizeAuthVersion,
  normalizeEmail,
  requireJwtSecret,
} = require("../utils/security");

const PASSWORD_REGEX = /^(?=.*[0-9])(?=.*[!@#$%^&*])/;
const RESET_TOKEN_REGEX = /^[0-9a-f]{64}$/i;
const DEFAULT_ADMIN_USERNAME = "amritanshu99";
const MAX_USERNAME_LENGTH = 50;
const MAX_PASSWORD_BYTES = 72;
const MAX_PASSWORD_INPUT_BYTES = 1024;
const MAX_GOOGLE_CREDENTIAL_LENGTH = 16 * 1024;
const GENERIC_RESET_MESSAGE = "If an account exists for that email, a password reset link has been sent.";

const MAIL_FROM = process.env.MAIL_FROM;
let resendClient;
let googleTokenVerifier;

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
  return typeof password === "string" &&
    password.length >= 10 &&
    Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES &&
    PASSWORD_REGEX.test(password);
}

function passwordMessage() {
  return "Password must be 10 to 72 bytes long and include at least one number and one special character";
}

function getRequestBody(req) {
  return req?.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
}

function isBoundedPasswordInput(password) {
  return typeof password === "string" && Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_INPUT_BYTES;
}

function signAuthToken(user, secret) {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      authVersion: normalizeAuthVersion(user.authVersion),
    },
    secret,
    { expiresIn: "7d", algorithm: "HS256" }
  );
}

function serializeUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || null,
    emailVerified: Boolean(user.emailVerified),
    authProviders: Array.isArray(user.authProviders) ? [...user.authProviders] : [],
  };
}

function sendAuthResponse(res, status, message, user) {
  return res.status(status).json({
    message,
    token: signAuthToken(user, requireJwtSecret()),
    user: serializeUser(user),
  });
}

function sendAuthError(res, status, code, message, details = {}) {
  return res.status(status).json({ code, message, ...details });
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function getReservedAdminUsernames() {
  return new Set([
    DEFAULT_ADMIN_USERNAME,
    process.env.AMIBOT_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME,
  ].map((username) => username.trim().toLowerCase()));
}

function isReservedAdminUsername(username) {
  return typeof username === "string" && getReservedAdminUsernames().has(username.trim().toLowerCase());
}

function sanitizeGeneratedUsername(value) {
  const username = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX_USERNAME_LENGTH);

  return username || "writer";
}

function appendUsernameSuffix(base, suffix) {
  const safeSuffix = sanitizeGeneratedUsername(suffix).replace(/^[._-]+/, "") || "account";
  const baseLength = Math.max(1, MAX_USERNAME_LENGTH - safeSuffix.length - 1);
  return `${base.slice(0, baseLength)}_${safeSuffix}`;
}

async function generateUniqueGoogleUsername({ email, displayName, googleSub }, usernameExists) {
  const emailPrefix = normalizeEmail(email).split("@")[0];
  let base = sanitizeGeneratedUsername(emailPrefix || displayName);

  if (isReservedAdminUsername(base)) {
    base = sanitizeGeneratedUsername(`writer-${base}`);
  }

  const exists = usernameExists || (async (username) => Boolean(await User.exists({ username })));
  if (!isReservedAdminUsername(base) && !(await exists(base))) return base;

  const stableSuffix = sanitizeGeneratedUsername(String(googleSub || "").slice(-10)) || "google";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? stableSuffix : `${stableSuffix}-${attempt + 1}`;
    const candidate = appendUsernameSuffix(base, suffix);
    if (!isReservedAdminUsername(candidate) && !(await exists(candidate))) return candidate;
  }

  const error = new Error("Unable to allocate a unique username");
  error.code = "USERNAME_UNAVAILABLE";
  throw error;
}

function addAuthProvider(user, provider) {
  const providers = new Set(Array.isArray(user.authProviders) ? user.authProviders : []);
  providers.add(provider);
  user.authProviders = [...providers];
}

function normalizeDisplayName(value) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeAvatarUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return "";

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function applyGoogleProfile(user, payload) {
  const now = new Date();
  const displayName = normalizeDisplayName(payload.name);
  const avatarUrl = normalizeAvatarUrl(payload.picture);

  user.googleSub = payload.sub;
  user.emailVerified = true;
  user.googleLinkedAt = user.googleLinkedAt || now;
  user.lastLoginAt = now;
  if (displayName) user.displayName = displayName;
  if (avatarUrl) user.avatarUrl = avatarUrl;
  addAuthProvider(user, "google");
}

function buildGoogleLinkUpdate(payload) {
  const now = new Date();
  const displayName = normalizeDisplayName(payload.name);
  const avatarUrl = normalizeAvatarUrl(payload.picture);
  const fields = {
    googleSub: payload.sub,
    emailVerified: true,
    googleLinkedAt: now,
    lastLoginAt: now,
  };

  if (displayName) fields.displayName = displayName;
  if (avatarUrl) fields.avatarUrl = avatarUrl;

  return {
    $set: fields,
    $addToSet: { authProviders: "google" },
  };
}

function getGoogleTokenVerifier() {
  if (!googleTokenVerifier) googleTokenVerifier = new OAuth2Client();
  return googleTokenVerifier;
}

async function verifyGoogleCredential(credential) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) {
    const error = new Error("GOOGLE_CLIENT_ID is not configured");
    error.code = "GOOGLE_AUTH_NOT_CONFIGURED";
    throw error;
  }

  const ticket = await getGoogleTokenVerifier().verifyIdToken({
    idToken: credential,
    audience: clientId,
  });
  return ticket.getPayload();
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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
    const body = getRequestBody(req);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = normalizeEmail(body.email);
    const { password } = body;

    if (!username || username.length > MAX_USERNAME_LENGTH) {
      return sendAuthError(res, 400, "INVALID_USERNAME", "Username is required and must be 50 characters or fewer");
    }

    if (isReservedAdminUsername(username)) {
      return sendAuthError(res, 409, "USERNAME_RESERVED", "Username is unavailable");
    }

    if (!isValidEmail(email)) {
      return sendAuthError(res, 400, "INVALID_EMAIL", "Please provide a valid email address");
    }

    if (!validatePassword(password)) {
      return sendAuthError(res, 400, "INVALID_PASSWORD", passwordMessage());
    }

    requireJwtSecret();
    const existingUser = await User.findOne({ $or: [{ username }, { email }] }).lean();

    if (existingUser) {
      return sendAuthError(res, 409, "ACCOUNT_EXISTS", "An account with that username or email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      email,
      password: hashedPassword,
      authProviders: ["password"],
      lastLoginAt: new Date(),
    });
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

    return sendAuthResponse(res, 201, "Signup successful", user);
  } catch (err) {
    console.error("Signup error:", err.message || err);
    if (isDuplicateKeyError(err)) {
      return sendAuthError(res, 409, "ACCOUNT_EXISTS", "An account with that username or email already exists");
    }
    return sendAuthError(res, 500, "SERVER_ERROR", "Server error. Please try again later.");
  }
};

exports.login = async (req, res) => {
  try {
    const body = getRequestBody(req);
    const rawIdentifier = typeof body.identifier === "string"
      ? body.identifier
      : body.username;
    const identifier = typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";
    const { password } = body;

    if (!identifier || !isBoundedPasswordInput(password)) {
      return sendAuthError(res, 400, "INVALID_CREDENTIALS", "Invalid credentials");
    }

    const normalizedIdentifier = normalizeEmail(identifier);
    const user = await User.findOne(
      isValidEmail(normalizedIdentifier)
        ? { email: normalizedIdentifier }
        : { username: identifier }
    );
    if (!user || !user.password) {
      return sendAuthError(res, 401, "INVALID_CREDENTIALS", "Invalid credentials");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return sendAuthError(res, 401, "INVALID_CREDENTIALS", "Invalid credentials");

    user.lastLoginAt = new Date();
    addAuthProvider(user, "password");
    await user.save();

    return sendAuthResponse(res, 200, "Login successful", user);
  } catch (err) {
    console.error("Login error:", err.message || err);
    return sendAuthError(res, 500, "SERVER_ERROR", "Server error. Please try again later.");
  }
};

exports.googleAuth = async (req, res) => {
  const body = getRequestBody(req);
  const credential = typeof body.credential === "string" ? body.credential.trim() : "";
  const linkingPassword = isBoundedPasswordInput(body.password) ? body.password : "";

  if (!credential || credential.length > MAX_GOOGLE_CREDENTIAL_LENGTH) {
    return sendAuthError(res, 400, "INVALID_GOOGLE_CREDENTIAL", "Google credential is required");
  }

  let payload;
  try {
    payload = await verifyGoogleCredential(credential);
  } catch (err) {
    if (err.code === "GOOGLE_AUTH_NOT_CONFIGURED") {
      console.error(err.message);
      return sendAuthError(res, 503, err.code, "Google authentication is not configured");
    }

    console.error("Google credential verification failed:", err.message || err);
    return sendAuthError(res, 401, "INVALID_GOOGLE_CREDENTIAL", "Google authentication failed");
  }

  const googleSub = typeof payload?.sub === "string" ? payload.sub.trim() : "";
  const email = normalizeEmail(payload?.email);
  if (!googleSub || googleSub.length > 255 || !isValidEmail(email) || payload?.email_verified !== true) {
    return sendAuthError(res, 401, "INVALID_GOOGLE_ACCOUNT", "Google account information could not be verified");
  }

  try {
    requireJwtSecret();
    const googleProfile = { ...payload, sub: googleSub };
    let user = await User.findOne({ googleSub });

    if (user) {
      if (normalizeEmail(user.email) !== email) {
        const emailOwner = await User.findOne({ email });
        if (emailOwner && String(emailOwner._id) !== String(user._id)) {
          return sendAuthError(
            res,
            409,
            "GOOGLE_ACCOUNT_MISMATCH",
            "This Google account conflicts with an existing account"
          );
        }
        user.email = email;
      }

      applyGoogleProfile(user, googleProfile);
      await user.save();
      return sendAuthResponse(res, 200, "Google sign-in successful", user);
    }

    user = await User.findOne({ email });
    if (user) {
      if (user.googleSub && user.googleSub !== googleSub) {
        return sendAuthError(
          res,
          409,
          "GOOGLE_ACCOUNT_MISMATCH",
          "This email is already linked to a different Google account"
        );
      }

      if (!linkingPassword) {
        return sendAuthError(
          res,
          409,
          "ACCOUNT_LINK_REQUIRED",
          "Enter your existing account password to link Google",
          { email }
        );
      }

      if (!user.password || !(await bcrypt.compare(linkingPassword, user.password))) {
        return sendAuthError(res, 401, "INVALID_CREDENTIALS", "Invalid credentials");
      }

      const linkedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          $or: [
            { googleSub: { $exists: false } },
            { googleSub: null },
            { googleSub: "" },
          ],
        },
        buildGoogleLinkUpdate(googleProfile),
        { new: true, runValidators: true }
      );

      if (!linkedUser) {
        const currentUser = await User.findById(user._id);
        if (currentUser?.googleSub === googleSub) {
          return sendAuthResponse(res, 200, "Google sign-in successful", currentUser);
        }
        return sendAuthError(
          res,
          409,
          "GOOGLE_ACCOUNT_MISMATCH",
          "This email was linked to a different Google account"
        );
      }

      return sendAuthResponse(res, 200, "Google account linked successfully", linkedUser);
    }

    const displayName = normalizeDisplayName(payload.name);
    const username = await generateUniqueGoogleUsername({
      email,
      displayName,
      googleSub,
    });
    const now = new Date();
    user = new User({
      username,
      email,
      googleSub,
      displayName: displayName || username,
      avatarUrl: normalizeAvatarUrl(payload.picture) || undefined,
      emailVerified: true,
      authProviders: ["google"],
      googleLinkedAt: now,
      lastLoginAt: now,
    });
    await user.save();

    const safeUsername = escapeHtml(username);
    sendEmail({
      to: email,
      subject: "Welcome to AmiVerse! Your new writing adventure begins here.",
      html: `
        <h2>Welcome, ${safeUsername}!</h2>
        <p>Thank you for joining AmiVerse. Your account is ready, and we are excited to see what you create.</p>
        <p>Best regards,<br/><strong>The AmiVerse Team</strong></p>
      `,
    }).catch((err) => console.error("Google signup welcome email error:", err?.message || err));

    return sendAuthResponse(res, 201, "Google signup successful", user);
  } catch (err) {
    console.error("Google authentication error:", err.message || err);
    if (isDuplicateKeyError(err)) {
      try {
        const racedUser = await User.findOne({ googleSub });
        if (racedUser) {
          return sendAuthResponse(res, 200, "Google sign-in successful", racedUser);
        }
      } catch (lookupError) {
        console.error("Google account race recovery failed:", lookupError.message || lookupError);
      }
      return sendAuthError(res, 409, "ACCOUNT_CONFLICT", "An account with those details already exists");
    }
    if (err.code === "USERNAME_UNAVAILABLE") {
      return sendAuthError(res, 409, err.code, "Unable to allocate a username for this account");
    }
    return sendAuthError(res, 500, "SERVER_ERROR", "Server error. Please try again later.");
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const email = normalizeEmail(getRequestBody(req).email);
    if (!isValidEmail(email)) {
      return res.status(200).json({ message: GENERIC_RESET_MESSAGE });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({ message: GENERIC_RESET_MESSAGE });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = hashResetToken(token);
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

      return res.status(200).json({ message: GENERIC_RESET_MESSAGE });
    } catch (emailErr) {
      console.error("Failed to send password reset email:", emailErr?.message || emailErr);
      return res.status(200).json({ message: GENERIC_RESET_MESSAGE });
    }
  } catch (err) {
    console.error("requestPasswordReset error:", err.message || err);
    return sendAuthError(res, 500, "SERVER_ERROR", "Internal Server Error");
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = getRequestBody(req);

    if (typeof token !== "string" || !RESET_TOKEN_REGEX.test(token)) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const tokenDigest = hashResetToken(token);
    const resetFilter = {
      resetToken: tokenDigest,
      resetTokenExpiry: { $gt: Date.now() },
    };
    const resetCandidate = await User.findOne(resetFilter);

    if (!resetCandidate) return res.status(400).json({ message: "Invalid or expired token" });

    if (!validatePassword(newPassword)) {
      return res.status(400).json({ message: passwordMessage() });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const user = await User.findOneAndUpdate(
      { _id: resetCandidate._id, ...resetFilter },
      {
        $set: { password: hashedPassword },
        $unset: { resetToken: "", resetTokenExpiry: "" },
        $addToSet: { authProviders: "password" },
        $inc: { authVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    return res.json({ message: "Password reset successful" });
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
      resetToken: hashResetToken(token),
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

exports.verifyToken = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ valid: false, message: "Missing token" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, requireJwtSecret(), { algorithms: ["HS256"] });
  } catch (err) {
    if (err.message === "JWT_SECRET is not configured") {
      console.error(err.message);
      return res.status(500).json({ valid: false, error: "Server configuration error" });
    }
    return res.status(401).json({ valid: false, message: "Invalid or expired token" });
  }

  try {
    const currentUser = await User.findById(decoded.id).select("_id username authVersion").lean();
    if (
      !currentUser ||
      currentUser.username !== decoded.username ||
      normalizeAuthVersion(currentUser.authVersion) !== normalizeAuthVersion(decoded.authVersion)
    ) {
      return res.status(401).json({ valid: false, message: "Invalid or expired token" });
    }

    return res.status(200).json({
      valid: true,
      user: {
        ...decoded,
        id: String(currentUser._id),
        username: currentUser.username,
      },
    });
  } catch (err) {
    if (err?.name === "CastError") {
      return res.status(401).json({ valid: false, message: "Invalid or expired token" });
    }
    console.error("Token user lookup failed:", err.message || err);
    return res.status(500).json({ valid: false, error: "Unable to verify token" });
  }
};

exports.__test = {
  generateUniqueGoogleUsername,
  hashResetToken,
  isReservedAdminUsername,
  resetGoogleTokenVerifier() {
    googleTokenVerifier = undefined;
  },
  setGoogleTokenVerifier(verifier) {
    googleTokenVerifier = verifier;
  },
};
