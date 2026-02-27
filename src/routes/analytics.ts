import { Router } from "express";
import { protect } from "../middleware/auth";
import * as analyticsController from "../controllers/analyticsController";

const router = Router();

router.use(protect);

// DORA metrics
router.get("/dora", analyticsController.getDoraMetrics);

// Deploy heatmap
router.get("/heatmap", analyticsController.getDeployHeatmap);

// Deploy trends
router.get("/trends", analyticsController.getDeployTrends);

// Per-project stats
router.get("/projects", analyticsController.getProjectStats);

// Global Bandwidth stats
router.get("/bandwidth", analyticsController.getGlobalBandwidth);

export default router;
