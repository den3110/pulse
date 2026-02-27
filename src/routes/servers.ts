import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as serverController from "../controllers/serverController";
import * as securityController from "../controllers/securityController";

const router = Router();

// The `protect` middleware is now applied directly to each route as per the instruction's implied change.
// router.use(protect);

// CRUD
router.get("/", protect, serverController.listServers);
router.put(
  "/reorder",
  protect,
  requireTeamRole(["admin", "editor"]),
  serverController.reorderServers,
);
router.get("/:id", protect, serverController.getServer);
router.post(
  "/",
  protect,
  requireTeamRole(["admin"]),
  serverController.createServer,
);
router.put(
  "/:id",
  protect,
  requireTeamRole(["admin"]),
  serverController.updateServer,
);
router.delete(
  "/:id",
  protect,
  requireTeamRole(["admin"]),
  serverController.deleteServer,
);

// Server operations
router.post("/:id/test", protect, serverController.testConnection);
router.get("/:id/projects", protect, serverController.getProjects);
router.get("/:id/stats", protect, serverController.getStats);
router.get("/:id/stats/history", protect, serverController.getStatsHistory);
router.post(
  "/:id/exec",
  protect,
  requireTeamRole(["admin"]),
  serverController.execCommand,
);
router.get("/:id/snapshots", protect, serverController.getSnapshots);
router.get(
  "/:id/snapshots/latest",
  protect,
  serverController.getLatestSnapshot,
);

// Security Scans
router.get("/:id/scan", protect, securityController.triggerScan);
router.get("/:id/security-scans", protect, securityController.getSecurityScans);
router.get(
  "/:id/security-scans/:scanId/pdf",
  protect,
  securityController.downloadPdfReport,
);
router.get(
  "/:id/remediate/:checkId",
  protect,
  securityController.remediateCheck,
);

export default router;
