import { Router } from "express";
import { protect } from "../middleware/auth";
import * as authController from "../controllers/authController";

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

export default router;
