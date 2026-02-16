import { Router } from "express";
import * as databaseController from "../controllers/databaseController";
import { protect } from "../middleware/auth";

const router = Router();

router.get("/:serverId/containers", protect, databaseController.getContainers);
router.get("/:serverId/backups", protect, databaseController.getBackups);
router.post("/:serverId/backup", protect, databaseController.backupDatabase);
router.post("/:serverId/restore", protect, databaseController.restoreBackup);
router.delete(
  "/:serverId/backups/:filename",
  protect,
  databaseController.deleteBackup,
);
router.get(
  "/:serverId/backups/:filename",
  protect,
  databaseController.downloadBackup,
);

export default router;
