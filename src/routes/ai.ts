import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as aiController from "../controllers/aiController";

const router = Router();

router.use(protect);

// Chat with AI assistant
router.post("/chat", aiController.chat);

// Execute an AI-suggested action
router.post(
  "/execute",
  requireTeamRole(["admin", "editor"]),
  aiController.executeAction,
);

export default router;
