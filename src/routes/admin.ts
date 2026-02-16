import { Router } from "express";
import { protect, adminOnly } from "../middleware/auth";
import * as adminController from "../controllers/adminController";

const router = Router();

// All admin routes require auth + admin role
router.use(protect, adminOnly);

router.get("/users", adminController.listUsers);
router.post("/users", adminController.createUser);
router.put("/users/:id", adminController.updateUser);
router.delete("/users/:id", adminController.deleteUser);
router.post("/users/:id/reset-password", adminController.resetPassword);

export default router;
