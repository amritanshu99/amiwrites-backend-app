const jwt = require("jsonwebtoken");
const User = require("../models/Users");
const { getBearerToken, normalizeAuthVersion, requireJwtSecret } = require("../utils/security");

const authMiddleware = async (req, res, next) => {
  const token = getBearerToken(req);

  if (!token) return res.status(401).json({ message: "Access denied" });

  let decoded;
  try {
    decoded = jwt.verify(token, requireJwtSecret(), { algorithms: ["HS256"] });
  } catch (err) {
    if (err.message === "JWT_SECRET is not configured") {
      console.error(err.message);
      return res.status(500).json({ message: "Authentication is not configured" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const currentUser = await User.findById(decoded.id).select("_id username authVersion").lean();
    if (
      !currentUser ||
      currentUser.username !== decoded.username ||
      normalizeAuthVersion(currentUser.authVersion) !== normalizeAuthVersion(decoded.authVersion)
    ) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.user = {
      ...decoded,
      id: String(currentUser._id),
      username: currentUser.username,
    };
    return next();
  } catch (err) {
    if (err?.name === "CastError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    console.error("Authenticated user lookup failed:", err.message || err);
    return res.status(500).json({ message: "Unable to verify authentication" });
  }
};

module.exports = authMiddleware;
