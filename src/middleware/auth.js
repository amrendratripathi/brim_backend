const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");

// ─────────────────────────────────────────────────────────────
// Verify JWT from Authorization header
// Attaches req.user = { id, email, role } to the request
// ─────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Optionally verify user still exists in DB and get fresh role
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, app_role, name")
      .eq("id", decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: "User not found or token invalid" });
    }

    req.user = {
      id:    user.id,
      email: user.email,
      role:  user.app_role,
      name:  user.name,
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired, please log in again" });
    }
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};

// ─────────────────────────────────────────────────────────────
// Role guard factory — requireRole('admin') or requireRole('admin','worker')
// ─────────────────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${roles.join(" or ")}`,
    });
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// Rate limiter middleware (simple in-memory, per IP)
// For production use redis-based rate limiting
// ─────────────────────────────────────────────────────────────
const rateStore = new Map();

const rateLimiter = (maxRequests = 30, windowMs = 60 * 1000) => (req, res, next) => {
  const key = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateStore.get(key);

  if (!entry || now - entry.start > windowMs) {
    rateStore.set(key, { count: 1, start: now });
    return next();
  }

  if (entry.count >= maxRequests) {
    return res.status(429).json({
      success: false,
      message: "Too many requests, please try again later",
    });
  }

  entry.count += 1;
  next();
};

// Coupon validation is a sensitive endpoint — stricter limit
const couponRateLimiter = rateLimiter(10, 60 * 1000); // 10 per minute

module.exports = { authenticate, requireRole, rateLimiter, couponRateLimiter };
