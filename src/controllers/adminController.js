const { supabaseAdmin } = require("../config/supabase");

// ─────────────────────────────────────────────────────────────
// GET /api/admin/dashboard  (admin only)
// Calls get_admin_dashboard() DB function
// ─────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("get_admin_dashboard");
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, dashboard: data });
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/analytics  (admin only)
// Advanced analytics — revenue trends, top performers, etc.
// ─────────────────────────────────────────────────────────────
const getAnalytics = async (req, res) => {
  const { from: fromDate, to: toDate, period = "month" } = req.query;

  // Revenue by period
  let periodTrunc = "month";
  if (["day", "week", "month", "year"].includes(period)) periodTrunc = period;

  const baseFilter = (q) => {
    if (fromDate) q = q.gte("created_at", fromDate);
    if (toDate)   q = q.lte("created_at", toDate);
    return q;
  };

  // Top workers
  const { data: topWorkers } = await supabaseAdmin
    .from("workers")
    .select(`
      id, coupon_code, total_sales, total_orders,
      total_earnings, coupon_used_count, status,
      users!inner(name, email)
    `)
    .order("total_sales", { ascending: false })
    .limit(10);

  // Payout pipeline
  const { data: payoutPipeline } = await supabaseAdmin
    .from("payouts")
    .select("status, amount");

  const payoutStats = (payoutPipeline || []).reduce((acc, p) => {
    if (!acc[p.status]) acc[p.status] = { count: 0, total: 0 };
    acc[p.status].count += 1;
    acc[p.status].total += parseFloat(p.amount);
    return acc;
  }, {});

  // Commission breakdown
  const { data: commissionStats } = await supabaseAdmin
    .from("commissions")
    .select("status, commission_amount");

  const commSummary = (commissionStats || []).reduce((acc, c) => {
    if (!acc[c.status]) acc[c.status] = { count: 0, total: 0 };
    acc[c.status].count += 1;
    acc[c.status].total += parseFloat(c.commission_amount);
    return acc;
  }, {});

  // Recent orders
  const { data: recentOrders } = await supabaseAdmin
    .from("coupon_orders")
    .select(`
      id, order_amount, discount_amount, final_amount, coupon_code,
      order_status, created_at,
      customer:users!coupon_orders_customer_id_fkey(name, email),
      workers!inner(coupon_code, users(name))
    `)
    .order("created_at", { ascending: false })
    .limit(20);

  // Coupon usage stats
  const { data: couponUsage } = await supabaseAdmin
    .from("workers")
    .select("coupon_code, coupon_used_count, coupon_max_uses, status")
    .order("coupon_used_count", { ascending: false })
    .limit(20);

  res.json({
    success: true,
    analytics: {
      top_workers:      topWorkers,
      payout_pipeline:  payoutStats,
      commission_summary: commSummary,
      recent_orders:    recentOrders,
      coupon_usage:     couponUsage,
    },
  });
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/users  (admin only)
// List all users with role filtering
// ─────────────────────────────────────────────────────────────
const getUsers = async (req, res) => {
  const { role, page = 1, limit = 20, search } = req.query;

  let query = supabaseAdmin
    .from("users")
    .select("id, name, email, mobileno, app_role, created_at", { count: "exact" });

  if (role) query = query.eq("app_role", role);
  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  query = query.order("created_at", { ascending: false });
  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    users: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/commissions  (admin only)
// List all commissions with filters
// ─────────────────────────────────────────────────────────────
const getCommissions = async (req, res) => {
  const { status, workerId, page = 1, limit = 20 } = req.query;

  let query = supabaseAdmin
    .from("commissions")
    .select(`
      id, commission_amount, rate_snapshot, status,
      confirmed_at, paid_at, created_at,
      workers!inner(id, coupon_code, users(name, email)),
      coupon_orders!inner(order_amount, final_amount, coupon_code)
    `, { count: "exact" });

  if (status)   query = query.eq("status", status);
  if (workerId) query = query.eq("worker_id", workerId);

  query = query.order("created_at", { ascending: false });
  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    commissions: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/audit-logs  (admin only)
// ─────────────────────────────────────────────────────────────
const getAuditLogs = async (req, res) => {
  const { action, actorId, page = 1, limit = 50 } = req.query;

  let query = supabaseAdmin
    .from("audit_logs")
    .select(`
      id, action, target_type, target_id, old_data, new_data,
      ip_address, created_at,
      actor:users!audit_logs_actor_id_fkey(id, name, email)
    `, { count: "exact" });

  if (action)  query = query.eq("action", action);
  if (actorId) query = query.eq("actor_id", actorId);

  query = query.order("created_at", { ascending: false });
  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    logs: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

module.exports = { getDashboard, getAnalytics, getUsers, getCommissions, getAuditLogs };
