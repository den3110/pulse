import { Router } from "express";
import {
  killProcess,
  listPorts,
  getProcessDetails,
  manageFirewall,
  getFirewallStatus,
} from "../controllers/portController";
import {
  protect as authenticateToken,
  requireTeamRole,
} from "../middleware/auth";

const router = Router();

router.get("/:serverId", authenticateToken, listPorts);
router.get("/:serverId/process/:pid", authenticateToken, getProcessDetails);
router.delete(
  "/:serverId/kill/:pid",
  authenticateToken,
  requireTeamRole(["admin", "editor"]),
  killProcess,
);
router.post(
  "/:serverId/fw",
  authenticateToken,
  requireTeamRole(["admin", "editor"]),
  manageFirewall,
);
router.get("/:serverId/fw", authenticateToken, getFirewallStatus);

export default router;
