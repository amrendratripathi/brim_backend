const router = require("express").Router();
const {
  validateCoupon,
  applyCoupon,
  getCouponOrders,
  updateOrderStatus,
  getMyOrders,
} = require("../controllers/couponController");
const { authenticate, requireRole, couponRateLimiter } = require("../middleware/auth");

// Public (with optional auth + rate-limit): preview discount before checkout
router.post("/validate", couponRateLimiter, validateCoupon);

// Authenticated customer/worker: apply coupon and create order atomically
router.post("/apply", authenticate, applyCoupon);

// Customer: view own orders
router.get("/orders/mine", authenticate, getMyOrders);

// Admin or Worker: list coupon orders
router.get("/orders", authenticate, requireRole("admin", "worker"), getCouponOrders);

// Admin only: update order status (confirmed → delivered → cancelled etc.)
router.patch("/orders/:id/status", authenticate, requireRole("admin"), updateOrderStatus);

module.exports = router;
