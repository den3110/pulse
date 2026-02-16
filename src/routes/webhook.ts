import { Router } from "express";
import * as webhookController from "../controllers/webhookController";

const router = Router();

// POST /api/webhook/:projectId — GitHub/GitLab webhook endpoint
router.post("/:projectId", webhookController.handleWebhook);

export default router;
