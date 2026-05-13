const express = require("express");
const cors    = require("cors");
require("dotenv").config();

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      if (origin.startsWith("https://")) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",    require("./src/routes/auth"));
app.use("/api/orders",  require("./src/routes/orders"));      // existing e-commerce orders
app.use("/api/workers", require("./src/routes/workers"));     // worker management
app.use("/api/coupons", require("./src/routes/coupons"));     // coupon validation & orders
app.use("/api/payouts", require("./src/routes/payouts"));     // payout requests & approvals
app.use("/api/admin",   require("./src/routes/admin"));       // admin dashboard & analytics

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.json({
    message: "🌿 Brimstone API running",
    version: "2.0.0",
    env: {
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
      jwt_secret: !!process.env.JWT_SECRET
    },
    modules: ["auth", "orders", "workers", "coupons", "payouts", "admin"],
  })
);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, message: err.message || "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🌿 Brimstone server running on http://localhost:${PORT}`);
  console.log(`   Modules: auth | orders | workers | coupons | payouts | admin`);
});
