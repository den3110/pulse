import { Router } from "express";
import { protect } from "../middleware/auth";
import * as serverController from "../controllers/serverController";

const router = Router();

// The `protect` middleware is now applied directly to each route as per the instruction's implied change.
// router.use(protect);

// CRUD
router.get("/", protect, serverController.listServers);
router.put("/reorder", protect, serverController.reorderServers);
router.get("/:id", protect, serverController.getServer);
router.post("/", protect, serverController.createServer);
router.put("/:id", protect, serverController.updateServer);
router.delete("/:id", protect, serverController.deleteServer);

// Server operations
router.post("/:id/test", protect, serverController.testConnection);
router.get("/:id/projects", protect, serverController.getProjects);
router.get("/:id/stats", protect, serverController.getStats);
router.get("/:id/stats/history", protect, serverController.getStatsHistory);
router.post("/:id/exec", protect, serverController.execCommand);

export default router;
