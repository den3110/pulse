import { Router } from "express";
import { protect } from "../middleware/auth";
import * as deploymentController from "../controllers/deploymentController";

const router = Router();

router.use(protect);

// Recent deployments (must be before :projectId routes)
router.get("/", deploymentController.listRecent);

// Deploy actions
router.post("/:projectId/deploy", deploymentController.deploy);
router.post("/:projectId/stop", deploymentController.stop);
router.post("/:projectId/cancel", deploymentController.cancel);
router.post("/:projectId/restart", deploymentController.restart);
router.post("/:projectId/rollback", deploymentController.rollback);

// Scheduling
router.post("/:projectId/schedule", deploymentController.schedule);
router.delete("/:projectId/schedule", deploymentController.cancelSchedule);

// Info
router.get("/:projectId/diff", deploymentController.getDiff);
router.get("/:projectId/history", deploymentController.getHistory);
router.get("/:deploymentId/logs", deploymentController.getLogs);
router.get("/:id", deploymentController.getDeploymentById);

// SSE stream
router.get("/:projectId/stream", deploymentController.stream);

export default router;
