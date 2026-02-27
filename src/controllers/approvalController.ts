import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Approval from "../models/Approval";
import User from "../models/User";
import { emitNotification } from "../services/socketService";

// POST /api/approvals — create a new approval request
export const createApproval = async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, type, title, description, metadata, reviewerIds } =
      req.body;

    if (!projectId || !type || !title) {
      res
        .status(400)
        .json({ message: "projectId, type, and title are required" });
      return;
    }

    const approval = await Approval.create({
      project: projectId,
      requestedBy: req.user?._id,
      reviewers: reviewerIds || [],
      type,
      title,
      description,
      metadata,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    const populated = await approval.populate([
      { path: "requestedBy", select: "username email" },
      { path: "project", select: "name" },
    ]);

    // Notify reviewers via socket
    if (reviewerIds?.length) {
      for (const reviewerId of reviewerIds) {
        emitNotification(reviewerId, {
          type: "approval_request",
          title: `Approval Required: ${title}`,
          message: `${req.user?.username || "Someone"} requested approval for ${type}`,
        });
      }
    }

    res.status(201).json(populated);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/approvals — list approvals (pending for current user)
export const listApprovals = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const filter: any = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    const approvals = await Approval.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("requestedBy", "username email")
      .populate("reviewedBy", "username email")
      .populate("project", "name status")
      .populate("reviewers", "username email")
      .lean();

    res.json({ approvals });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/approvals/pending-count
export const getPendingCount = async (req: AuthRequest, res: Response) => {
  try {
    const count = await Approval.countDocuments({ status: "pending" });
    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/approvals/:id/review
export const reviewApproval = async (req: AuthRequest, res: Response) => {
  try {
    const { action, comment } = req.body; // action: "approve" | "reject"
    if (!["approve", "reject"].includes(action)) {
      res.status(400).json({ message: 'Action must be "approve" or "reject"' });
      return;
    }

    const approval = await Approval.findById(req.params.id);
    if (!approval) {
      res.status(404).json({ message: "Approval not found" });
      return;
    }

    if (approval.status !== "pending") {
      res.status(400).json({ message: `Already ${approval.status}` });
      return;
    }

    approval.status = action === "approve" ? "approved" : "rejected";
    approval.reviewedBy = req.user?._id;
    approval.reviewedAt = new Date();
    approval.reviewComment = comment || "";
    await approval.save();

    const populated = await approval.populate([
      { path: "requestedBy", select: "username email" },
      { path: "reviewedBy", select: "username email" },
      { path: "project", select: "name" },
    ]);

    // Notify requester
    emitNotification(approval.requestedBy.toString(), {
      type: action === "approve" ? "approval_approved" : "approval_rejected",
      title: `Request ${action === "approve" ? "Approved ✅" : "Rejected ❌"}`,
      message: `Your ${approval.type} request "${approval.title}" was ${action}ed by ${req.user?.username || "a reviewer"}`,
    });

    res.json(populated);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/approvals/:id
export const deleteApproval = async (req: AuthRequest, res: Response) => {
  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    // Only requester or admin can delete
    if (
      approval.requestedBy.toString() !== req.user?._id?.toString() &&
      req.user?.role !== "admin"
    ) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    await Approval.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
