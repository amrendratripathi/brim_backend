const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const supabase = require("../config/supabase");

/**
 * Generate a signed JWT for a user
 */
const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

/**
 * Format a user row for API responses (never exposes password)
 */
const formatUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  mobileno: user.mobileno,
  dob: user.dob,
  gender: user.gender,
  role: user.role,
});

// ─── POST /api/auth/signup ──────────────────────────────────────────────────

const signup = async (req, res) => {
  try {
    const { name, email, password, mobileno, dob, gender } = req.body;

    // 1. Validate required fields
    if (!name || !email || !password || !mobileno) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and mobile number are required.",
      });
    }

    // 2. Check email not already registered
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email.toLowerCase())
      .single();

    if (existing) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Insert user into Supabase
    const { data: user, error } = await supabase
      .from("users")
      .insert([
        {
          name,
          email: email.toLowerCase(),
          password: hashedPassword,
          mobileno,
          dob: dob || null,
          gender: gender || null,
          role: "user",
        },
      ])
      .select("id, name, email, mobileno, dob, gender, role")
      .single();

    if (error) {
      console.error("Supabase insert error:", JSON.stringify(error, null, 2));
      return res.status(500).json({ success: false, message: "Failed to create account." });
    }

    // 5. Generate JWT
    const token = generateToken(user.id, user.role);

    // 6. Return success
    return res.status(200).json({
      success: true,
      message: "Account created successfully!",
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

// ─── POST /api/auth/login ───────────────────────────────────────────────────

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    // 1. Find user by email (include password column for comparison)
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, password, mobileno, dob, gender, role")
      .eq("email", email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // 2. Compare password with bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // 3. Generate JWT
    const token = generateToken(user.id, user.role);

    // 4. Return user (no password)
    return res.status(200).json({
      success: true,
      message: "Login successful!",
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

// ─── GET /api/auth/profile ──────────────────────────────────────────────────

const getProfile = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, mobileno, dob, gender, role")
      .eq("id", req.user.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    return res.status(200).json({ success: true, user: formatUser(user) });
  } catch (err) {
    console.error("Profile error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

module.exports = { signup, login, getProfile };
