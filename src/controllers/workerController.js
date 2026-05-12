const { supabaseAdmin } = require("../config/supabase");

// ─────────────────────────────────────────────────────────────
// POST /api/workers  (admin only)
// Create a new worker profile for an existing user
// Body: { userId, discountPercentage, commissionPercentage, couponMaxUses,
//         couponExpiresAt, couponMinOrder, notes }
// ─────────────────────────────────────────────────────────────
const createWorker = async (req, res) => {
  const {
    userId,
    discountPercentage  = 10,
    commissionPercentage = 5,
    couponMaxUses,
    couponExpiresAt,
    couponMinOrder = 0,
    notes,
    customCouponCode,   // admin can force a specific code, otherwise auto-generated
  } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: "userId is required" });
  }

  // Verify user exists
  const { data: user, error: userErr } = await supabaseAdmin
    .from("users")
    .select("id, name, app_role")
    .eq("id", userId)
    .single();

  if (userErr || !user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // Ensure user not already a worker
  const { data: existing } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (existing) {
    return res.status(409).json({ success: false, message: "User already has a worker profile" });
  }

  // Generate or use custom coupon code
  let couponCode;
  if (customCouponCode) {
    couponCode = customCouponCode.toUpperCase().trim();
    const { data: taken } = await supabaseAdmin
      .from("workers")
      .select("id")
      .eq("coupon_code", couponCode)
      .single();
    if (taken) {
      return res.status(409).json({ success: false, message: "Coupon code already in use" });
    }
  } else {
    // Use DB function to generate unique code
    const { data, error } = await supabaseAdmin.rpc("generate_unique_coupon", {
      base_name: user.name,
    });
    if (error) {
      return res.status(500).json({ success: false, message: "Failed to generate coupon code" });
    }
    couponCode = data;
  }

  // Create worker
  const { data: worker, error: workerErr } = await supabaseAdmin
    .from("workers")
    .insert([{
      user_id:               userId,
      coupon_code:           couponCode,
      discount_percentage:   discountPercentage,
      commission_percentage: commissionPercentage,
      coupon_max_uses:       couponMaxUses || null,
      coupon_expires_at:     couponExpiresAt || null,
      coupon_min_order:      couponMinOrder,
      notes,
      status: "active",
    }])
    .select("*, users(id, name, email)")
    .single();

  if (workerErr) {
    return res.status(500).json({ success: false, message: workerErr.message });
  }

  // Promote user role to 'worker'
  await supabaseAdmin.from("users").update({ app_role: "worker" }).eq("id", userId);

  // Audit
  await supabaseAdmin.from("audit_logs").insert([{
    actor_id:    req.user.id,
    action:      "worker_created",
    target_type: "workers",
    target_id:   worker.id,
    new_data:    { coupon_code: couponCode, userId },
  }]);

  res.status(201).json({ success: true, worker });
};

// ─────────────────────────────────────────────────────────────
// GET /api/workers  (admin only)
// List all workers with user info and stats
// ─────────────────────────────────────────────────────────────
const getAllWorkers = async (req, res) => {
  const {
    status,
    page  = 1,
    limit = 20,
    sort  = "total_sales",
    order = "desc",
  } = req.query;

  let query = supabaseAdmin
    .from("workers")
    .select(`
      id, coupon_code, discount_percentage, commission_percentage,
      total_sales, total_orders, total_earnings, available_balance,
      coupon_used_count, coupon_max_uses, coupon_expires_at, coupon_min_order,
      status, notes, created_at,
      users!inner(id, name, email, mobileno)
    `, { count: "exact" });

  if (status) query = query.eq("status", status);

  const allowedSort = ["total_sales", "total_orders", "total_earnings", "created_at", "coupon_used_count"];
  const sortField   = allowedSort.includes(sort) ? sort : "total_sales";
  query = query.order(sortField, { ascending: order === "asc" });

  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    workers: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

// ─────────────────────────────────────────────────────────────
// GET /api/workers/:id  (admin or own worker)
// ─────────────────────────────────────────────────────────────
const getWorker = async (req, res) => {
  const { id } = req.params;

  // Workers can only see themselves
  if (req.user.role === "worker") {
    const { data: self } = await supabaseAdmin
      .from("workers")
      .select("id")
      .eq("user_id", req.user.id)
      .single();
    if (!self || self.id !== id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("*, users(id, name, email, mobileno, created_at)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).json({ success: false, message: "Worker not found" });
  }

  res.json({ success: true, worker: data });
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/workers/:id  (admin only)
// Update worker settings
// ─────────────────────────────────────────────────────────────
const updateWorker = async (req, res) => {
  const { id } = req.params;
  const {
    discountPercentage,
    commissionPercentage,
    couponMaxUses,
    couponExpiresAt,
    couponMinOrder,
    status,
    notes,
  } = req.body;

  const updates = {};
  if (discountPercentage   !== undefined) updates.discount_percentage   = discountPercentage;
  if (commissionPercentage !== undefined) updates.commission_percentage = commissionPercentage;
  if (couponMaxUses        !== undefined) updates.coupon_max_uses        = couponMaxUses;
  if (couponExpiresAt      !== undefined) updates.coupon_expires_at      = couponExpiresAt;
  if (couponMinOrder       !== undefined) updates.coupon_min_order       = couponMinOrder;
  if (status               !== undefined) updates.status                 = status;
  if (notes                !== undefined) updates.notes                  = notes;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: "No valid fields to update" });
  }

  // Snapshot old data for audit
  const { data: old } = await supabaseAdmin.from("workers").select("*").eq("id", id).single();

  const { data, error } = await supabaseAdmin
    .from("workers")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return res.status(500).json({ success: false, message: error.message });

  // If worker is suspended/inactive, reflect on user role
  if (status === "suspended" || status === "inactive") {
    await supabaseAdmin.from("users").update({ app_role: "customer" }).eq("id", data.user_id);
  } else if (status === "active") {
    await supabaseAdmin.from("users").update({ app_role: "worker" }).eq("id", data.user_id);
  }

  await supabaseAdmin.from("audit_logs").insert([{
    actor_id:    req.user.id,
    action:      "worker_updated",
    target_type: "workers",
    target_id:   id,
    old_data:    old,
    new_data:    updates,
  }]);

  res.json({ success: true, worker: data });
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/workers/:id  (admin only)
// Soft-delete by setting status to 'suspended'
// ─────────────────────────────────────────────────────────────
const deleteWorker = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from("workers")
    .update({ status: "suspended" })
    .eq("id", id)
    .select("user_id")
    .single();

  if (error || !data) {
    return res.status(404).json({ success: false, message: "Worker not found" });
  }

  await supabaseAdmin.from("users").update({ app_role: "customer" }).eq("id", data.user_id);

  await supabaseAdmin.from("audit_logs").insert([{
    actor_id:    req.user.id,
    action:      "worker_suspended",
    target_type: "workers",
    target_id:   id,
    new_data:    { status: "suspended" },
  }]);

  res.json({ success: true, message: "Worker suspended successfully" });
};

// ─────────────────────────────────────────────────────────────
// GET /api/workers/:id/analytics  (admin or own worker)
// Calls the DB function get_worker_analytics
// ─────────────────────────────────────────────────────────────
const getWorkerAnalytics = async (req, res) => {
  const { id } = req.params;

  // Workers can only see their own analytics
  if (req.user.role === "worker") {
    const { data: self } = await supabaseAdmin
      .from("workers")
      .select("id")
      .eq("user_id", req.user.id)
      .single();
    if (!self || self.id !== id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
  }

  const { data, error } = await supabaseAdmin.rpc("get_worker_analytics", {
    p_worker_id: id,
  });

  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, analytics: data });
};

// ─────────────────────────────────────────────────────────────
// GET /api/workers/me  (worker only)
// Returns the authenticated worker's own profile
// ─────────────────────────────────────────────────────────────
const getMyWorkerProfile = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("*, users(id, name, email, mobileno)")
    .eq("user_id", req.user.id)
    .single();

  if (error || !data) {
    return res.status(404).json({ success: false, message: "No worker profile found for your account" });
  }

  res.json({ success: true, worker: data });
};

module.exports = {
  createWorker,
  getAllWorkers,
  getWorker,
  updateWorker,
  deleteWorker,
  getWorkerAnalytics,
  getMyWorkerProfile,
};
