import { Router } from "express";
import {
  killProcess,
  listPorts,
  getProcessDetails,
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

export default router;
