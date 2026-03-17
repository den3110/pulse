import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as smartDeployController from "../controllers/smartDeployController";

const router = Router();

router.use(protect);

// Analyze a Git repository to detect project type
router.post(
  "/analyze",
  requireTeamRole(["admin", "editor"]),
  smartDeployController.analyze,
);

// Check if server has required tools
router.post(
  "/check-server",
  requireTeamRole(["admin", "editor"]),
  smartDeployController.checkServer,
);

// Auto-install missing tools on a server
router.post(
  "/install-tools",
  requireTeamRole(["admin"]),
  smartDeployController.installTools,
);

// Create project + deploy in one step
router.post(
  "/execute",
  requireTeamRole(["admin", "editor"]),
  smartDeployController.execute,
);

export default router;
