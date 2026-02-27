import { Router } from "express";
import * as databaseController from "../controllers/databaseController";
import * as backupScheduleController from "../controllers/backupScheduleController";
import { protect, requireTeamRole } from "../middleware/auth";

const router = Router();

router.get("/:serverId/containers", protect, databaseController.getContainers);
router.get("/:serverId/backups", protect, databaseController.getBackups);
router.post(
  "/:serverId/backup",
  protect,
  requireTeamRole(["admin", "editor"]),
  databaseController.backupDatabase,
);
router.post(
  "/:serverId/restore",
  protect,
  requireTeamRole(["admin"]),
  databaseController.restoreBackup,
);
router.delete(
  "/:serverId/backups/:filename",
  protect,
  requireTeamRole(["admin"]),
  databaseController.deleteBackup,
);
router.get(
  "/:serverId/backups/:filename",
  protect,
  databaseController.downloadBackup,
);
router.post("/:serverId/schema", protect, databaseController.getSchema);
router.post(
  "/:serverId/install",
  protect,
  requireTeamRole(["admin"]),
  databaseController.installService,
);

// Automated Backup Schedules
router.get(
  "/:serverId/schedules",
  protect,
  backupScheduleController.getSchedules,
);
router.post(
  "/:serverId/schedules",
  protect,
  requireTeamRole(["admin"]),
  backupScheduleController.createSchedule,
);
router.put(
  "/:serverId/schedules/:id",
  protect,
  requireTeamRole(["admin"]),
  backupScheduleController.updateSchedule,
);
router.delete(
  "/:serverId/schedules/:id",
  protect,
  requireTeamRole(["admin"]),
  backupScheduleController.deleteSchedule,
);

export default router;
