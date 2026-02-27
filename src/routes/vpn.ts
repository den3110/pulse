import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as vpnController from "../controllers/vpnController";

const router = Router();

// All VPN actions require admin or editor roles
router.use(protect);
router.use(requireTeamRole(["admin", "editor"]));

router.get("/:serverId/status", vpnController.getStatus);
router.post("/:serverId/install", vpnController.installVpn);
router.post("/:serverId/action", vpnController.containerAction);

// Client management
router.post("/:serverId/clients", vpnController.createClient);
router.delete("/:serverId/clients/:clientId", vpnController.deleteClient);
router.put("/:serverId/clients/:clientId/:action", vpnController.toggleClient); // action = enable/disable
router.get(
  "/:serverId/clients/:clientId/config",
  vpnController.getClientConfig,
);
router.get(
  "/:serverId/clients/:clientId/qrcode",
  vpnController.getClientQrCode,
);

export default router;
