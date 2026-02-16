import { Router } from "express";
import { protect } from "../middleware/auth";
import * as settingsController from "../controllers/settingsController";

const router = Router();

router.use(protect);

router.get("/", settingsController.getSettings);
router.put("/", settingsController.updateSettings);
router.get("/system-info", settingsController.getSystemInfo);
router.delete("/clear-history", settingsController.clearHistory);

router.get("/notifications", settingsController.getNotificationSettings);
router.put("/notifications", settingsController.updateNotificationSettings);
router.post("/notifications/test", settingsController.sendTestNotification);

export default router;
