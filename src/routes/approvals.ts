import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as approvalController from "../controllers/approvalController";

const router = Router();

router.use(protect);

// List approvals
router.get("/", approvalController.listApprovals);

// Pending count
router.get("/pending-count", approvalController.getPendingCount);

// Create approval request
router.post("/", approvalController.createApproval);

// Review (approve/reject)
router.post(
  "/:id/review",
  requireTeamRole(["admin"]),
  approvalController.reviewApproval,
);

// Delete
router.delete("/:id", approvalController.deleteApproval);

export default router;
