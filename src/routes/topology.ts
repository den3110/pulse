import { Router } from "express";
import { protect } from "../middleware/auth";
import * as topologyController from "../controllers/topologyController";

const router = Router();

router.use(protect);

// Get full infrastructure topology
router.get("/", topologyController.getTopology);

export default router;
