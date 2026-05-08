const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allow Vite dev server (port 8080) and any production domain you deploy to.
const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:3000",
  // Add your production domain here, e.g. "https://brimstone.vercel.app"
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
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
