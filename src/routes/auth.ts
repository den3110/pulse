import { Router } from "express";
import { protect } from "../middleware/auth";
import * as authController from "../controllers/authController";

import * as githubController from "../controllers/githubController";

const router = Router();

// Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);

// Protected routes
router.get("/me", protect, authController.getMe);
router.put("/password", protect, authController.changePassword);
router.put("/active-server", protect, authController.updateActiveServer);

// GitHub Integration
router.get("/github/auth-url", protect, githubController.getAuthUrl);
router.post("/github", protect, githubController.connectGitHub);
router.delete("/github", protect, githubController.disconnectGitHub);
router.get("/github/repos", protect, githubController.listRepos);
router.get(
  "/github/commits/:owner/:repo",
  protect,
  githubController.listCommits,
);
router.post(
  "/github/detect-framework",
  protect,
  githubController.detectFramework,
);
router.post("/github/webhook", protect, githubController.setupWebhook);

export default router;
