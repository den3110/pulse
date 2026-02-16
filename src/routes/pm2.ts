import { Router, Response } from "express";
import { protect, AuthRequest } from "../middleware/auth";
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

// List all PM2 processes
router.get("/:serverId/processes", pm2Controller.listProcesses);

// Start a new process
router.post("/:serverId/start", pm2Controller.startProcess);

// Bulk operations
router.post("/:serverId/restart-all", pm2Controller.restartAll);
router.post("/:serverId/stop-all", pm2Controller.stopAll);
router.post("/:serverId/save", pm2Controller.save);
router.post("/:serverId/startup", pm2Controller.startup);
router.post("/:serverId/flush", pm2Controller.flushLogs);

// Per-process operations
router.post("/:serverId/:name/stop", pm2Controller.stopProcess);
router.post("/:serverId/:name/restart", pm2Controller.restartProcess);
router.post("/:serverId/:name/reload", pm2Controller.reloadProcess);
router.post("/:serverId/:name/delete", pm2Controller.deleteProcess);
router.get("/:serverId/:name/logs", pm2Controller.getLogs);
router.post("/:serverId/:name/flush", pm2Controller.flushLogs);

export default router;
