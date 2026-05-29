const jwt = require("jsonwebtoken");
const { getBearerToken, requireJwtSecret } = require("../utils/security");

const authMiddleware = (req, res, next) => {
  const token = getBearerToken(req);

  if (!token) return res.status(401).json({ message: "Access denied" });

  try {
    const decoded = jwt.verify(token, requireJwtSecret(), { algorithms: ["HS256"] });
    req.user = decoded; // attach user info
    next();
  } catch (err) {
    if (err.message === "JWT_SECRET is not configured") {
      console.error(err.message);
      return res.status(500).json({ message: "Authentication is not configured" });
    }
    res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;
