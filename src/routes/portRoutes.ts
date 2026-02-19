import { Router } from "express";
import {
  killProcess,
  listPorts,
  getProcessDetails,
} from "../controllers/portController";
import { protect as authenticateToken } from "../middleware/auth";

const router = Router();

router.get("/:serverId", authenticateToken, listPorts);
router.get("/:serverId/process/:pid", authenticateToken, getProcessDetails);
router.delete("/:serverId/kill/:pid", authenticateToken, killProcess);

export default router;
