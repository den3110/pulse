import { Router } from "express";
import { protect } from "../middleware/auth";
import * as projectController from "../controllers/projectController";

const router = Router();

router.use(protect);

// Folder browsing
router.post("/browse-folders", projectController.browseFolders);

// Branch detection
router.post("/detect-branch", projectController.detectBranch);

// CRUD
router.get("/", projectController.listProjects);
router.get("/:id", projectController.getProject);
router.post("/", projectController.createProject);
router.put("/:id", projectController.updateProject);
router.delete("/:id", projectController.deleteProject);

// Special operations
router.put("/:id/save-restart", projectController.saveAndRestart);
router.delete("/:id/output", projectController.deleteOutput);
router.get("/:id/webhook-url", projectController.getWebhookUrl);

export default router;
