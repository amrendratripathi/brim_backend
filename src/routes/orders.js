const express = require("express");
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
} = require("../controllers/orderController");
const { protect, adminOnly } = require("../middleware/auth");

// POST /api/orders  — place a new order (authenticated users)
router.post("/", protect, createOrder);

// GET /api/orders/user/my-orders  — get logged-in user's orders
router.get("/user/my-orders", protect, getMyOrders);

// GET /api/orders/admin/all-orders  — get all orders (admin only)
router.get("/admin/all-orders", protect, adminOnly, getAllOrders);

// PUT /api/orders/:orderId/status  — update order status (admin only)
router.put("/:orderId/status", protect, adminOnly, updateOrderStatus);

module.exports = router;
