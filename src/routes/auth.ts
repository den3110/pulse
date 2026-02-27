import { Router } from "express";
import { protect } from "../middleware/auth";
import * as authController from "../controllers/authController";

import * as githubController from "../controllers/githubController";
import * as oauthController from "../controllers/oauthController";

const router = Router();

// Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/login/2fa", authController.verifyLogin2FA);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);

// OAuth Routes
router.get("/github/login", oauthController.getGithubAuthUrl);
router.post("/github/callback", oauthController.githubCallback);
router.get("/google/login", oauthController.getGoogleAuthUrl);
router.post("/google/callback", oauthController.googleCallback);

// 2FA Routes
router.post("/2fa/generate", protect, authController.generate2FA);
router.post("/2fa/verify", protect, authController.verifyAndEnable2FA);
router.post("/2fa/disable", protect, authController.disable2FA);

// Protected routes
router.get("/me", protect, authController.getMe);
router.delete("/me", protect, authController.deleteAccount);
router.put("/password", protect, authController.changePassword);
router.put("/active-server", protect, authController.updateActiveServer);
router.put("/alerts", protect, authController.updateAlertPreferences);

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
