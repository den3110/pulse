import { Router } from "express";
import { protect, adminOnly } from "../middleware/auth";
import * as adminController from "../controllers/adminController";

const router = Router();

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// Dashboard overview
router.get("/dashboard", adminController.getDashboard);

// All projects (cross-user)
router.get("/projects", adminController.getAllProjects);
router.delete("/projects/:id", adminController.adminDeleteProject);

// All deployments (cross-user)
router.get("/deployments", adminController.getAllDeployments);

// User management
router.get("/users", adminController.listUsers);
router.post("/users", adminController.createUser);
router.put("/users/:id", adminController.updateUser);
router.delete("/users/:id", adminController.deleteUser);
router.post("/users/:id/reset-password", adminController.resetPassword);
router.put("/users/:id/plan", adminController.updateUserPlan);
router.post("/users/:id/ban", adminController.toggleBanUser);

// System config
router.get("/system", adminController.getSystemConfig);
router.put("/system", adminController.updateSystemConfig);

export default router;
