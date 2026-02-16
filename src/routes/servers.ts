import { Router } from "express";
import { protect } from "../middleware/auth";
import * as serverController from "../controllers/serverController";

const router = Router();

router.use(protect);

// CRUD
router.get("/", serverController.listServers);
router.get("/:id", serverController.getServer);
router.post("/", serverController.createServer);
router.put("/:id", serverController.updateServer);
router.delete("/:id", serverController.deleteServer);

// Server operations
router.post("/:id/test", serverController.testConnection);
router.get("/:id/projects", serverController.getProjects);
router.get("/:id/stats", serverController.getStats);
router.get("/:id/stats/history", serverController.getStatsHistory);
router.post("/:id/exec", serverController.execCommand);

export default router;
