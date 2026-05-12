const { supabaseAdmin } = require("../config/supabase");

// ─────────────────────────────────────────────────────────────
// POST /api/payouts/request  (worker only)
// Body: { amount, paymentMethod, paymentDetails }
// ─────────────────────────────────────────────────────────────
const requestPayout = async (req, res) => {
  const { amount, paymentMethod = "bank_transfer", paymentDetails = {} } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: "amount must be a positive number" });
  }

  // Get worker record
  const { data: worker, error: wErr } = await supabaseAdmin
    .from("workers")
    .select("id, available_balance, status")
    .eq("user_id", req.user.id)
    .single();

  if (wErr || !worker) {
    return res.status(404).json({ success: false, message: "Worker profile not found" });
  }

  const { data, error } = await supabaseAdmin.rpc("request_payout", {
    p_worker_id:       worker.id,
    p_amount:          parseFloat(amount),
    p_payment_method:  paymentMethod,
    p_payment_details: paymentDetails,
  });

  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data.success) return res.status(422).json({ success: false, message: data.reason });

  res.status(201).json({ success: true, payout: data });
};

// ─────────────────────────────────────────────────────────────
// GET /api/payouts  (admin: all | worker: own)
// ─────────────────────────────────────────────────────────────
const getPayouts = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  let query = supabaseAdmin
    .from("payouts")
    .select(`
      id, amount, status, payment_method, admin_notes,
      requested_at, reviewed_at, completed_at, created_at,
      workers!inner(id, coupon_code, users(id, name, email))
    `, { count: "exact" });

  if (req.user.role === "worker") {
    const { data: w } = await supabaseAdmin
      .from("workers").select("id").eq("user_id", req.user.id).single();
    if (!w) return res.status(404).json({ success: false, message: "Worker profile not found" });
    query = query.eq("worker_id", w.id);
  }

  if (status) query = query.eq("status", status);
  query = query.order("created_at", { ascending: false });

  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({
    success: true,
    payouts: data,
    pagination: { page: +page, limit: +limit, total: count, pages: Math.ceil(count / limit) },
  });
};

// ─────────────────────────────────────────────────────────────
// GET /api/payouts/:id  (admin or own worker)
// ─────────────────────────────────────────────────────────────
const getPayout = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from("payouts")
    .select(`
      id, amount, status, payment_method, payment_details, admin_notes,
      requested_at, reviewed_at, completed_at,
      workers!inner(id, coupon_code, user_id, users(id, name, email))
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).json({ success: false, message: "Payout not found" });
  }

  // Workers can only see their own payouts
  if (req.user.role === "worker" && data.workers.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  res.json({ success: true, payout: data });
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/payouts/:id/process  (admin only)
// Body: { action: 'approve'|'reject', adminNotes }
// ─────────────────────────────────────────────────────────────
const processPayout = async (req, res) => {
  const { id } = req.params;
  const { action, adminNotes } = req.body;

  if (!action || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });
  }

  const { data, error } = await supabaseAdmin.rpc("process_payout", {
    p_payout_id:   id,
    p_action:      action,
    p_admin_id:    req.user.id,
    p_admin_notes: adminNotes || null,
  });

  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data.success) return res.status(422).json({ success: false, message: data.reason });

  res.json({ success: true, ...data });
};

// ─────────────────────────────────────────────────────────────
// GET /api/payouts/summary  (worker: own summary)
// Returns balance overview for the authenticated worker
// ─────────────────────────────────────────────────────────────
const getPayoutSummary = async (req, res) => {
  const { data: worker, error } = await supabaseAdmin
    .from("workers")
    .select("id, total_earnings, available_balance")
    .eq("user_id", req.user.id)
    .single();

  if (error || !worker) {
    return res.status(404).json({ success: false, message: "Worker profile not found" });
  }

  const { data: payoutStats } = await supabaseAdmin
    .from("payouts")
    .select("status, amount")
    .eq("worker_id", worker.id);

  const summary = (payoutStats || []).reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + parseFloat(p.amount);
      return acc;
    },
    {}
  );

  res.json({
    success: true,
    summary: {
      total_earnings:     worker.total_earnings,
      available_balance:  worker.available_balance,
      pending_payout:     summary.pending    || 0,
      completed_payout:   summary.completed  || 0,
      rejected_payout:    summary.rejected   || 0,
    },
  });
};

module.exports = { requestPayout, getPayouts, getPayout, processPayout, getPayoutSummary };
