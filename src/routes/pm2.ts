import { Router, Response } from "express";
import { protect, AuthRequest, requireTeamRole } from "../middleware/auth";
import Server from "../models/Server";
import * as pm2Controller from "../controllers/pm2Controller";

const router = Router();

// All routes require auth
router.use(protect);

// Middleware: verify server ownership
const verifyServer = async (
  req: AuthRequest,
  res: Response,
  next: Function,
) => {
  try {
    const server = await Server.findOne({
      _id: req.params.serverId as string,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }
    next();
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

router.use("/:serverId/*", verifyServer as any);
router.use("/:serverId", verifyServer as any);

// Check PM2 installation
router.get("/:serverId/check", pm2Controller.checkInstalled);

// Install PM2 (Stream)
router.get(
  "/:serverId/install/stream",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.installPm2Stream,
);

// Uninstall PM2
router.post(
  "/:serverId/uninstall",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.uninstallPm2,
);

// List all PM2 processes
router.get("/:serverId/processes", pm2Controller.listProcesses);

// Start a new process
router.post(
  "/:serverId/start",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.startProcess,
);

// Bulk operations
router.post(
  "/:serverId/restart-all",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.restartAll,
);
router.post(
  "/:serverId/stop-all",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.stopAll,
);
router.post(
  "/:serverId/save",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.save,
);
router.post(
  "/:serverId/startup",
  requireTeamRole(["admin"]),
  pm2Controller.startup,
);
router.post(
  "/:serverId/flush",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.flushLogs,
);

// Per-process operations
router.post(
  "/:serverId/:name/stop",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.stopProcess,
);
router.post(
  "/:serverId/:name/restart",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.restartProcess,
);
router.post(
  "/:serverId/:name/reload",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.reloadProcess,
);
router.post(
  "/:serverId/:name/delete",
  requireTeamRole(["admin"]),
  pm2Controller.deleteProcess,
);
router.get("/:serverId/:name/logs", pm2Controller.getLogs);
router.get("/:serverId/:name/logs/stream", pm2Controller.streamLogs);
router.post(
  "/:serverId/:name/flush",
  requireTeamRole(["admin", "editor"]),
  pm2Controller.flushLogs,
);

export default router;
