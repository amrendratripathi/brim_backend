const { supabaseAdmin } = require("../config/supabase");

// ─────────────────────────────────────────────────────────────
// POST /api/coupons/validate  (public — no auth required)
// Body: { couponCode, orderAmount, customerId? }
// Used by frontend before checkout to show discount preview
// ─────────────────────────────────────────────────────────────
const validateCoupon = async (req, res) => {
  const { couponCode, orderAmount, customerId } = req.body;

  if (!couponCode || !orderAmount) {
    return res.status(400).json({ success: false, message: "couponCode and orderAmount are required" });
  }

  if (isNaN(orderAmount) || orderAmount <= 0) {
    return res.status(400).json({ success: false, message: "orderAmount must be a positive number" });
  }

  // Use authenticated customer id if available, else a placeholder UUID for preview-only checks
  const custId = customerId || req.user?.id || "00000000-0000-0000-0000-000000000000";

  const { data, error } = await supabaseAdmin.rpc("validate_coupon", {
    p_coupon_code:  couponCode,
    p_customer_id:  custId,
    p_order_amount: parseFloat(orderAmount),
  });

  if (error) return res.status(500).json({ success: false, message: error.message });

  if (!data.valid) {
    return res.status(422).json({ success: false, message: data.reason, valid: false });
  }

  res.json({ success: true, valid: true, ...data });
};

// ─────────────────────────────────────────────────────────────
// POST /api/coupons/apply  (authenticated — customer/worker)
// Atomically creates order, commission, usage log in one DB call
// Body: { couponCode, orderAmount, metadata }
// ─────────────────────────────────────────────────────────────
const applyCoupon = async (req, res) => {
  const { couponCode, orderAmount, metadata = {} } = req.body;

  if (!couponCode || !orderAmount) {
    return res.status(400).json({ success: false, message: "couponCode and orderAmount are required" });
  }

  if (isNaN(orderAmount) || orderAmount <= 0) {
    return res.status(400).json({ success: false, message: "orderAmount must be a positive number" });
  }

  const { data, error } = await supabaseAdmin.rpc("apply_coupon_and_create_order", {
    p_coupon_code:  couponCode,
    p_customer_id:  req.user.id,
    p_order_amount: parseFloat(orderAmount),
    p_metadata:     metadata,
  });

  if (error) return res.status(500).json({ success: false, message: error.message });

  if (!data.success) {
    return res.status(422).json({ success: false, message: data.reason });
  }

  res.status(201).json({ success: true, order: data });
};

// ─────────────────────────────────────────────────────────────
// GET /api/coupons/orders  (admin or worker)
// Admin: all orders; Worker: own orders only
// ─────────────────────────────────────────────────────────────
const getCouponOrders = async (req, res) => {
  const {
    status,
    workerId,
    page  = 1,
    limit = 20,
  } = req.query;

  let query = supabaseAdmin
    .from("coupon_orders")
    .select(`
      id, order_amount, discount_amount, final_amount, coupon_code,
      order_status, metadata, created_at,
      workers!inner(id, coupon_code, users(name, email)),
      customer:users!coupon_orders_customer_id_fkey(id, name, email)
    `, { count: "exact" });

  // Workers see only their own orders
  if (req.user.role === "worker") {
    const { data: w } = await supabaseAdmin
      .from("workers").select("id").eq("user_id", req.user.id).single();
    if (!w) return res.status(404).json({ success: false, message: "Worker profile not found" });
    query = query.eq("worker_id", w.id);
  } else if (workerId) {
    query = query.eq("worker_id", workerId);
  }

  if (status) query = query.eq("order_status", status);

  query = query.order("created_at", { ascending: false });
  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    orders: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/coupons/orders/:id/status  (admin only)
// Update order status (confirmed, shipped, delivered, cancelled, refunded)
// ─────────────────────────────────────────────────────────────
const updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled", "refunded"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `status must be one of: ${validStatuses.join(", ")}`,
    });
  }

  const { data, error } = await supabaseAdmin.rpc("confirm_coupon_order", {
    p_order_id:   id,
    p_new_status: status,
    p_actor_id:   req.user.id,
  });

  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data.success) return res.status(422).json({ success: false, message: data.reason });

  res.json({ success: true, ...data });
};

// ─────────────────────────────────────────────────────────────
// GET /api/coupons/orders/mine  (customer only)
// Customer sees their own coupon orders
// ─────────────────────────────────────────────────────────────
const getMyOrders = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const from = (page - 1) * limit;

  const { data, error, count } = await supabaseAdmin
    .from("coupon_orders")
    .select(`
      id, order_amount, discount_amount, final_amount, coupon_code,
      order_status, metadata, created_at,
      workers!inner(id, coupon_code)
    `, { count: "exact" })
    .eq("customer_id", req.user.id)
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    orders: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

module.exports = { validateCoupon, applyCoupon, getCouponOrders, updateOrderStatus, getMyOrders };
