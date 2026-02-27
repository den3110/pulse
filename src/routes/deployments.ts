import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as deploymentController from "../controllers/deploymentController";

const router = Router();

router.use(protect);

// Recent deployments (must be before :projectId routes)
router.get("/", deploymentController.listRecent);

// Deploy actions
router.post(
  "/:projectId/deploy",
  requireTeamRole(["admin", "editor"]),
  deploymentController.deploy,
);
router.post(
  "/:projectId/stop",
  requireTeamRole(["admin", "editor"]),
  deploymentController.stop,
);
router.post(
  "/:projectId/cancel",
  requireTeamRole(["admin", "editor"]),
  deploymentController.cancel,
);
router.post(
  "/:projectId/restart",
  requireTeamRole(["admin", "editor"]),
  deploymentController.restart,
);
router.post(
  "/:projectId/rollback",
  requireTeamRole(["admin", "editor"]),
  deploymentController.rollback,
);

// Scheduling
router.post(
  "/:projectId/schedule",
  requireTeamRole(["admin", "editor"]),
  deploymentController.schedule,
);
router.delete(
  "/:projectId/schedule",
  requireTeamRole(["admin", "editor"]),
  deploymentController.cancelSchedule,
);

// Info
router.get("/:projectId/diff", deploymentController.getDiff);
router.get("/:projectId/history", deploymentController.getHistory);
router.get("/:deploymentId/logs", deploymentController.getLogs);
router.get("/:id", deploymentController.getDeploymentById);

// SSE stream
router.get("/:projectId/stream", deploymentController.stream);

export default router;
