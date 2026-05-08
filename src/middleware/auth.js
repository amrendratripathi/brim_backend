const jwt = require("jsonwebtoken");

/**
 * protect — verifies JWT, attaches req.user = { userId, role }
 * Reads token from: Authorization: Bearer <token>
 */
const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: decoded.userId, role: decoded.role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Unauthorized. Invalid or expired token." });
  }
};

/**
 * adminOnly — checks req.user.role === "admin"
 * Must be used AFTER protect middleware.
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }
  next();
};

module.exports = { protect, adminOnly };
