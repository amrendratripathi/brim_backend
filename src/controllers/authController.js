const { supabaseAdmin } = require("../config/supabase");
const bcrypt           = require("bcryptjs");
const jwt              = require("jsonwebtoken");

const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.app_role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

// ─────────────────────────────────────────────────────────────
// POST /api/auth/register
// Public — creates a customer account
// ─────────────────────────────────────────────────────────────
const register = async (req, res) => {
  const { name, email, password, mobileno, dob, gender } = req.body;
  if (!name || !email || !password || !mobileno) {
    return res.status(400).json({ success: false, message: "name, email, password, mobileno are required" });
  }

  const hashed = await bcrypt.hash(password, 12);

  const { data, error } = await supabaseAdmin
    .from("users")
    .insert([{ name, email, password: hashed, mobileno, dob, gender, app_role: "customer" }])
    .select("id, name, email, app_role, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }

  const token = signToken(data);
  res.status(201).json({ success: true, token, user: data });
};

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login
// Public — works for all roles
// ─────────────────────────────────────────────────────────────
const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "email and password are required" });
  }

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error || !user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const token = signToken(user);
  const { password: _pw, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser });
};

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me  (authenticated)
// ─────────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, mobileno, dob, gender, app_role, created_at")
    .eq("id", req.user.id)
    .single();

  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, user: data });
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/auth/role  (admin only)
// Body: { userId, role: 'admin'|'worker'|'customer' }
// ─────────────────────────────────────────────────────────────
const assignRole = async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return res.status(400).json({ success: false, message: "userId and role are required" });
  }
  if (!["admin", "worker", "customer"].includes(role)) {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ app_role: role })
    .eq("id", userId)
    .select("id, name, email, app_role")
    .single();

  if (error) return res.status(500).json({ success: false, message: error.message });

  // Audit log
  await supabaseAdmin.from("audit_logs").insert([{
    actor_id:    req.user.id,
    action:      "role_assigned",
    target_type: "users",
    target_id:   userId,
    new_data:    { role },
  }]);

  res.json({ success: true, message: `Role updated to '${role}'`, user: data });
};

module.exports = { register, login, getMe, assignRole };
