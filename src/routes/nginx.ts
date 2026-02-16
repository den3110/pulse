import { Router, Response } from "express";
import { protect, AuthRequest } from "../middleware/auth";
import Server from "../models/Server";
import * as nginxController from "../controllers/nginxController";

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

// Config CRUD
router.get("/:serverId/configs", nginxController.listConfigs);
router.get("/:serverId/configs/:name", nginxController.getConfig);
router.post("/:serverId/configs/:name", nginxController.saveConfig);
router.post(
  "/:serverId/configs/:name/save-reload",
  nginxController.saveAndReload,
);
router.delete("/:serverId/configs/:name", nginxController.deleteConfig);

// Enable / Disable
router.post("/:serverId/configs/:name/enable", nginxController.enableConfig);
router.post("/:serverId/configs/:name/disable", nginxController.disableConfig);

// Nginx operations
router.post("/:serverId/test", nginxController.testConfig);
router.post("/:serverId/reload", nginxController.reloadNginx);
router.get("/:serverId/status", nginxController.getNginxStatus);

// Logs
router.get("/:serverId/logs/:type", nginxController.getLogs);

export default router;
