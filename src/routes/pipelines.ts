import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as deployStrategyController from "../controllers/deployStrategyController";
import * as pipelineController from "../controllers/pipelineController";

const router = Router();

router.use(protect);

// Deploy strategies
router.post(
  "/strategy/:projectId/blue-green",
  requireTeamRole(["admin", "editor"]),
  deployStrategyController.blueGreenDeploy,
);
router.post(
  "/strategy/:projectId/canary",
  requireTeamRole(["admin", "editor"]),
  deployStrategyController.canaryDeploy,
);
router.get(
  "/strategy/:projectId/status",
  deployStrategyController.getDeployStatus,
);

// Pipelines CRUD
router.get("/", pipelineController.listPipelines);
router.post(
  "/",
  requireTeamRole(["admin", "editor"]),
  pipelineController.createPipeline,
);
router.get("/:id", pipelineController.getPipeline);
router.put(
  "/:id",
  requireTeamRole(["admin", "editor"]),
  pipelineController.updatePipeline,
);
router.delete(
  "/:id",
  requireTeamRole(["admin"]),
  pipelineController.deletePipeline,
);
router.post(
  "/:id/run",
  requireTeamRole(["admin", "editor"]),
  pipelineController.runPipeline,
);

export default router;
