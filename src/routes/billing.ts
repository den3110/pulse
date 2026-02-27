import express from "express";
import { getPlans } from "../controllers/billingController";

const router = express.Router();

// Public route to fetch pricing plans
router.get("/plans", getPlans);

export default router;
