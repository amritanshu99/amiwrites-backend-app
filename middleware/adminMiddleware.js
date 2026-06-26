const ADMIN_USERNAME = process.env.AMIBOT_ADMIN_USERNAME || "amritanshu99";

function isAdminUser(user) {
  return user?.username === ADMIN_USERNAME;
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: "Only admin can access this resource" });
  }

  return next();
}

module.exports = {
  ADMIN_USERNAME,
  isAdminUser,
  requireAdmin,
};
