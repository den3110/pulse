import { Router } from "express";
import { protect } from "../middleware/auth";
import * as oneClickController from "../controllers/oneClickController";

const router = Router();

// List all 1-click apps
router.get("/:serverId/one-click/apps", protect, oneClickController.getApps);

router.get("/debug/:serverId", async (req, res) => {
  try {
    const Server = require("../models/Server").Server;
    const sshService = require("../services/sshService").default;
    const server = await Server.findById(req.params.serverId);
    const { stdout, stderr } = await sshService.exec(
      server._id.toString(),
      "docker logs --tail 200 openclaw && echo '\\n--CONFIG--\\n' && cat /root/openclaw/data/openclaw.json",
    );
    res.send(stdout + "\n" + stderr);
  } catch (e: any) {
    res.send(e.message);
  }
});

// Check install status of all apps
router.post(
  "/:serverId/one-click/check",
  protect,
  oneClickController.checkApps,
);

// Install CLIProxyAPI (SSE streaming)  — query params: provider, port
router.get(
  "/:serverId/one-click/install/cliproxyapi",
  protect,
  oneClickController.installCLIProxyAPI,
);

// Install OpenClaw (SSE streaming)
router.get(
  "/:serverId/one-click/install/openclaw",
  protect,
  oneClickController.installOpenClaw,
);

// Uninstall an app (SSE streaming)
router.get(
  "/:serverId/one-click/uninstall/:appId",
  protect,
  oneClickController.uninstallApp,
);

// Get OAuth URL for a specific provider
router.get(
  "/:serverId/one-click/cliproxyapi/oauth/url",
  protect,
  oneClickController.getOAuthUrl,
);

// Submit OAuth callback code
router.post(
  "/:serverId/one-click/cliproxyapi/oauth/callback",
  protect,
  oneClickController.submitOAuthCallback,
);

// App Detail & Management
router.get(
  "/:serverId/one-click/:appId/detail",
  protect,
  oneClickController.getAppDetail,
);
router.get(
  "/:serverId/one-click/:appId/logs",
  protect,
  oneClickController.getAppLogs,
);
router.get(
  "/:serverId/one-click/:appId/config",
  protect,
  oneClickController.getAppConfig,
);

router.get(
  "/:serverId/one-click/openclaw/parsed-logs",
  protect,
  oneClickController.getOpenClawParsedLogs,
);

router.get(
  "/:serverId/one-click/openclaw/stored-logs",
  protect,
  oneClickController.getOpenClawStoredLogs,
);

router.get(
  "/:serverId/one-click/openclaw/models",
  protect,
  oneClickController.getOpenClawModels,
);

router.post(
  "/:serverId/one-click/openclaw/config",
  protect,
  oneClickController.saveOpenClawConfig,
);

router.get(
  "/:serverId/one-click/openclaw/agents-md",
  protect,
  oneClickController.getOpenClawAgentsMd,
);

router.post(
  "/:serverId/one-click/openclaw/agents-md",
  protect,
  oneClickController.saveOpenClawAgentsMd,
);

router.post(
  "/:serverId/one-click/openclaw/pairing",
  protect,
  oneClickController.approveOpenClawPairing,
);

router.post(
  "/:serverId/one-click/:appId/config",
  protect,
  oneClickController.saveAppConfig,
);
router.post(
  "/:serverId/one-click/:appId/password",
  protect,
  oneClickController.updateAppPassword,
);
router.get(
  "/:serverId/one-click/:appId/action",
  protect,
  oneClickController.manageAppAction,
);
router.all(
  "/:serverId/one-click/:appId/proxy/*",
  protect,
  oneClickController.proxyAppAPI,
);

export default router;
