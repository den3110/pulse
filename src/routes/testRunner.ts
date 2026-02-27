import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as testRunnerController from "../controllers/testRunnerController";

const router = Router();

router.use(protect);

// Run pre-deploy tests
router.post(
  "/:projectId/run",
  requireTeamRole(["admin", "editor"]),
  testRunnerController.runTests,
);

// Get history of tests
router.get(
  "/:projectId/history",
  requireTeamRole(["admin", "editor", "viewer"]),
  testRunnerController.getHistory,
);

export default router;
