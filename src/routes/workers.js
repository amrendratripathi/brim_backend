const router = require("express").Router();
const {
  createWorker,
  getAllWorkers,
  getWorker,
  updateWorker,
  deleteWorker,
  getWorkerAnalytics,
  getMyWorkerProfile,
} = require("../controllers/workerController");
const { authenticate, requireRole } = require("../middleware/auth");

// Worker: get their own profile
router.get("/me",              authenticate, requireRole("worker", "admin"), getMyWorkerProfile);

// Admin: list all workers
router.get("/",                authenticate, requireRole("admin"),           getAllWorkers);

// Admin: create worker
router.post("/",               authenticate, requireRole("admin"),           createWorker);

// Admin or own worker: read a specific worker
router.get("/:id",             authenticate, requireRole("admin", "worker"), getWorker);

// Admin only: update worker settings
router.patch("/:id",           authenticate, requireRole("admin"),           updateWorker);

// Admin only: soft-delete (suspend) worker
router.delete("/:id",          authenticate, requireRole("admin"),           deleteWorker);

// Admin or own worker: analytics
router.get("/:id/analytics",   authenticate, requireRole("admin", "worker"), getWorkerAnalytics);

module.exports = router;
