import { Response } from "express";
import ActivityLog from "../models/ActivityLog";
import { AuthRequest } from "../middleware/auth";

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const action = req.query.action as string;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (action && action !== "all") {
      filter.action = action;
    }

    // Isolate by Team vs Personal
    if (req.user?.currentTeam) {
      filter.team = req.user.currentTeam;
    } else if (req.user) {
      filter.userId = req.user._id;
      filter.team = { $exists: false }; // Ensure it's not a team log
    }

    const [activities, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({
      activities,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
