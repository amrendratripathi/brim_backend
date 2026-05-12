const router = require("express").Router();
const {
  requestPayout,
  getPayouts,
  getPayout,
  processPayout,
  getPayoutSummary,
} = require("../controllers/payoutController");
const { authenticate, requireRole } = require("../middleware/auth");

// Worker: request a payout
router.post("/request", authenticate, requireRole("worker", "admin"), requestPayout);

// Worker: earnings/balance summary
router.get("/summary", authenticate, requireRole("worker", "admin"), getPayoutSummary);

// Admin or Worker: list payouts
router.get("/", authenticate, requireRole("admin", "worker"), getPayouts);

// Admin or Worker: get single payout
router.get("/:id", authenticate, requireRole("admin", "worker"), getPayout);

// Admin only: approve or reject a payout
router.patch("/:id/process", authenticate, requireRole("admin"), processPayout);

module.exports = router;
