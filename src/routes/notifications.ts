import { Router } from "express";
import { protect } from "../middleware/auth";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
} from "../controllers/notificationController";

const router = Router();

router.use(protect);

router.get("/", getNotifications);
router.put("/read-all", markAllAsRead);
router.put("/:id/read", markAsRead);
router.delete("/", clearAll);

export default router;
