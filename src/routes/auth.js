const express = require("express");
const router = express.Router();
const { signup, login, getProfile } = require("../controllers/authController");
const { protect } = require("../middleware/auth");

// POST /api/auth/signup
router.post("/signup", signup);

// POST /api/auth/login
router.post("/login", login);

// GET /api/auth/profile  (protected)
router.get("/profile", protect, getProfile);

module.exports = router;
