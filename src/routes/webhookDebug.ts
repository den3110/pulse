import { Router } from "express";
import { protect } from "../middleware/auth";
import * as webhookDebugController from "../controllers/webhookDebugController";

const router = Router();

router.use(protect);

// Get webhook event logs for a project
router.get("/:projectId/logs", webhookDebugController.getWebhookLogs);

// Clear logs
router.delete("/:projectId/logs", webhookDebugController.clearWebhookLogs);

// Send test webhook
router.post("/:projectId/test", webhookDebugController.sendTestWebhook);

export default router;
