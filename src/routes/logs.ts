import { Router } from "express";
import { protect } from "../middleware/auth";
import * as logController from "../controllers/logController";

const router = Router();

router.use(protect);

// Stream server/app logs via SSE
router.get("/stream", logController.streamLogs);

export default router;
