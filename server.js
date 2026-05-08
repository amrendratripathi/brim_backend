const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Auth security is handled by JWT — CORS origin restriction adds no extra
// security here and only blocks legitimate Vercel/Render preview URLs.
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, curl, Render health checks)
      if (!origin) return callback(null, true);
      // Allow any localhost port (local development)
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      // Allow all HTTPS origins (Vercel, Render, custom domains)
      if (origin.startsWith("https://")) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/orders", require("./src/routes/orders"));

// Health check
app.get("/", (req, res) => res.json({ message: "Brimstone API running ✅" }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, message: err.message || "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🌿 Brimstone server running on http://localhost:${PORT}`);
});
