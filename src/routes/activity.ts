import { Router } from "express";
import { protect } from "../middleware/auth";
import * as activityController from "../controllers/activityController";

const router = Router();

router.get("/", protect, activityController.list);

export default router;
