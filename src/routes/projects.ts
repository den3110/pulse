import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as projectController from "../controllers/projectController";

const router = Router();

router.use(protect);

// Folder browsing
router.post("/browse-folders", projectController.browseFolders);

// Branch detection
router.post("/detect-branch", projectController.detectBranch);

// Server folder browsing (for local/non-git projects)
router.post("/browse-server", projectController.browseServerFolders);

// CRUD
router.get("/", projectController.listProjects);
router.put(
  "/reorder",
  requireTeamRole(["admin", "editor"]),
  projectController.reorderProjects,
);
router.get("/:id", projectController.getProject);
router.post("/", requireTeamRole(["admin"]), projectController.createProject);
router.put("/:id", requireTeamRole(["admin"]), projectController.updateProject);
router.delete(
  "/:id",
  requireTeamRole(["admin"]),
  projectController.deleteProject,
);

// Special operations
router.put(
  "/:id/save-restart",
  requireTeamRole(["admin", "editor"]),
  projectController.saveAndRestart,
);
router.delete(
  "/:id/output",
  requireTeamRole(["admin", "editor"]),
  projectController.deleteOutput,
);
router.get("/:id/webhook-url", projectController.getWebhookUrl);
router.put(
  "/:id/webhook-registered",
  requireTeamRole(["admin"]),
  projectController.setWebhookRegistered,
);
router.put(
  "/:id/health",
  requireTeamRole(["admin"]),
  projectController.updateHealthCheck,
);

export default router;
