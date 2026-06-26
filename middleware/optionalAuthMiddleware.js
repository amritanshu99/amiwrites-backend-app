const jwt = require("jsonwebtoken");
const { getBearerToken, requireJwtSecret } = require("../utils/security");

const optionalAuthMiddleware = (req, res, next) => {
  const token = getBearerToken(req);

  if (!token) return next();

  try {
    req.user = jwt.verify(token, requireJwtSecret(), { algorithms: ["HS256"] });
    return next();
  } catch (err) {
    if (err.message === "JWT_SECRET is not configured") {
      console.error(err.message);
      return res.status(500).json({ message: "Authentication is not configured" });
    }

    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = optionalAuthMiddleware;
