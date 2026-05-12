const router = require("express").Router();
const { register, login, getMe, assignRole } = require("../controllers/authController");
const { authenticate, requireRole } = require("../middleware/auth");

// Public
router.post("/register", register);
router.post("/signup",   register);   // alias — frontend calls /signup

router.post("/login",    login);

// Authenticated
router.get("/me",      authenticate, getMe);
router.get("/profile", authenticate, getMe);   // alias — frontend calls /profile

// Admin only — assign roles to users (worker, admin, customer)
router.patch("/role", authenticate, requireRole("admin"), assignRole);

module.exports = router;
