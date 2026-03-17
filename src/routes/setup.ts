import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as setupController from "../controllers/setupController";

const router = Router();

// List all available tools
router.get("/:serverId/setup/tools", protect, setupController.getTools);

// Check all tools status on server
router.post("/:serverId/setup/check", protect, setupController.checkTools);

// Check single tool
router.post(
  "/:serverId/setup/check/:toolId",
  protect,
  setupController.checkSingleTool,
);

// Install a tool (SSE streaming)
router.get(
  "/:serverId/setup/install/:toolId",
  protect,
  setupController.installToolSSE,
);

// Uninstall a tool (SSE streaming)
router.get(
  "/:serverId/setup/uninstall/:toolId",
  protect,
  setupController.uninstallToolSSE,
);

export default router;
