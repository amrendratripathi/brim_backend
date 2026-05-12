const router = require("express").Router();
const {
  getDashboard,
  getAnalytics,
  getUsers,
  getCommissions,
  getAuditLogs,
} = require("../controllers/adminController");
const { authenticate, requireRole } = require("../middleware/auth");

// All admin routes require authentication + admin role
router.use(authenticate, requireRole("admin"));

router.get("/dashboard",    getDashboard);
router.get("/analytics",    getAnalytics);
router.get("/users",        getUsers);
router.get("/commissions",  getCommissions);
router.get("/audit-logs",   getAuditLogs);

module.exports = router;
