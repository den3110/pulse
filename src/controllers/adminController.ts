import { Response } from "express";
import User from "../models/User";
import Project from "../models/Project";
import Deployment from "../models/Deployment";
import Server from "../models/Server";
import SystemSetting from "../models/SystemSetting";
import { AuthRequest } from "../middleware/auth";
import { logActivity } from "../services/activityLogger";

// ============================================================
// Dashboard Overview
// ============================================================

export const getDashboard = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const [
      totalUsers,
      totalProjects,
      totalDeployments,
      totalServers,
      usersByPlan,
      projectsByStatus,
      recentDeployments,
      deploymentsByDay,
      topUsers,
      bannedUsers,
    ] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Deployment.countDocuments(),
      Server.countDocuments(),

      // Users grouped by plan
      User.aggregate([{ $group: { _id: "$planType", count: { $sum: 1 } } }]),

      // Projects grouped by status
      Project.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),

      // Recent 10 deployments
      Deployment.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("project", "name")
        .populate("server", "name host")
        .populate("triggeredByUser", "username")
        .lean(),

      // Deployments per day (last 14 days)
      Deployment.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              status: "$status",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]),

      // Top 10 users by project count
      Project.aggregate([
        { $group: { _id: "$owner", projectCount: { $sum: 1 } } },
        { $sort: { projectCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $project: {
            _id: "$user._id",
            username: "$user.username",
            email: "$user.email",
            planType: "$user.planType",
            projectCount: 1,
          },
        },
      ]),

      // Banned user count
      User.countDocuments({ isBanned: true }),
    ]);

    // Calculate success rate
    const successCount = await Deployment.countDocuments({ status: "running" });
    const failedCount = await Deployment.countDocuments({ status: "failed" });
    const successRate =
      totalDeployments > 0
        ? Math.round((successCount / totalDeployments) * 100)
        : 0;

    // Online servers
    const onlineServers = await Server.countDocuments({ status: "online" });

    res.json({
      stats: {
        totalUsers,
        totalProjects,
        totalDeployments,
        totalServers,
        onlineServers,
        successRate,
        failedCount,
        bannedUsers,
      },
      usersByPlan,
      projectsByStatus,
      recentDeployments,
      deploymentsByDay,
      topUsers,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// All Projects (cross-user)
// ============================================================

export const getAllProjects = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "20",
      status,
      owner,
      server,
      search,
      sort = "-updatedAt",
    } = req.query;

    const filter: any = {};
    if (status) filter.status = status;
    if (owner) filter.owner = owner;
    if (server) filter.server = server;
    if (search) filter.name = { $regex: search, $options: "i" };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .sort(sort as string)
        .skip(skip)
        .limit(parseInt(limit as string))
        .populate("owner", "username email planType")
        .populate("server", "name host status")
        .lean(),
      Project.countDocuments(filter),
    ]);

    res.json({
      projects,
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// All Deployments (cross-user)
// ============================================================

export const getAllDeployments = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "20",
      status,
      project,
      sort = "-createdAt",
    } = req.query;

    const filter: any = {};
    if (status) filter.status = status;
    if (project) filter.project = project;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [deployments, total] = await Promise.all([
      Deployment.find(filter)
        .sort(sort as string)
        .skip(skip)
        .limit(parseInt(limit as string))
        .populate("project", "name")
        .populate("server", "name host")
        .populate("triggeredByUser", "username")
        .lean(),
      Deployment.countDocuments(filter),
    ]);

    res.json({
      deployments,
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// User Management (enhanced)
// ============================================================

export const listUsers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { search, role, plan, banned, page = "1", limit = "50" } = req.query;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (role) filter.role = role;
    if (plan) filter.planType = plan;
    if (banned === "true") filter.isBanned = true;
    if (banned === "false") filter.isBanned = { $ne: true };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    // Get users with project count
    const users = await User.find(filter)
      .select("-password -refreshTokens -twoFactorSecret")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit as string))
      .lean();

    // Get project count per user
    const userIds = users.map((u: any) => u._id);
    const projectCounts = await Project.aggregate([
      { $match: { owner: { $in: userIds } } },
      { $group: { _id: "$owner", count: { $sum: 1 } } },
    ]);
    const countMap: Record<string, number> = {};
    projectCounts.forEach((p: any) => {
      countMap[p._id.toString()] = p.count;
    });

    const total = await User.countDocuments(filter);

    const usersWithCounts = users.map((u: any) => ({
      ...u,
      projectsCount: countMap[u._id.toString()] || 0,
    }));

    res.json({
      users: usersWithCounts,
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { username, email, password, role, planType } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      res.status(400).json({ message: "User already exists" });
      return;
    }
    const user = await User.create({
      username,
      email,
      password,
      role: role || "viewer",
      planType: planType || "free",
    });
    await logActivity({
      action: "user.create",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Created user ${username} (${role || "viewer"}, ${planType || "free"})`,
      ip: req.ip,
    });
    res.status(201).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      planType: user.planType,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { username, email, role, planType } = req.body;
    const update: any = {};
    if (username !== undefined) update.username = username;
    if (email !== undefined) update.email = email;
    if (role !== undefined) update.role = role;
    if (planType !== undefined) update.planType = planType;

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    }).select("-password -refreshTokens");
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    await logActivity({
      action: "user.update",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Updated user ${user.username}`,
      ip: req.ip,
    });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.params.id === req.user!._id.toString()) {
      res.status(400).json({ message: "Cannot delete yourself" });
      return;
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Also delete user's projects & deployments
    const userProjects = await Project.find({ owner: req.params.id });
    const projectIds = userProjects.map((p) => p._id);
    await Deployment.deleteMany({ project: { $in: projectIds } });
    await Project.deleteMany({ owner: req.params.id });

    await logActivity({
      action: "user.delete",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Deleted user ${user.username} and ${projectIds.length} projects`,
      ip: req.ip,
    });
    res.json({ message: "User and associated data deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const resetPassword = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
      return;
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    user.password = newPassword;
    await user.save();
    await logActivity({
      action: "password.change",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Reset password for ${user.username}`,
      ip: req.ip,
    });
    res.json({ message: "Password reset successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// User Plan Management
// ============================================================

export const updateUserPlan = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { planType, subscriptionStatus } = req.body;
    const update: any = {};
    if (planType) update.planType = planType;
    if (subscriptionStatus) update.subscriptionStatus = subscriptionStatus;

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    }).select("-password -refreshTokens");
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    await logActivity({
      action: "user.plan.change",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Changed plan for ${user.username} to ${planType || user.planType}`,
      ip: req.ip,
    });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// Ban / Unban User
// ============================================================

export const toggleBanUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.params.id === req.user!._id.toString()) {
      res.status(400).json({ message: "Cannot ban yourself" });
      return;
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    user.isBanned = !user.isBanned;
    await user.save();

    await logActivity({
      action: user.isBanned ? "user.ban" : "user.unban",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `${user.isBanned ? "Banned" : "Unbanned"} user ${user.username}`,
      ip: req.ip,
    });
    res.json({
      isBanned: user.isBanned,
      message: user.isBanned ? "User banned" : "User unbanned",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// System Config
// ============================================================

const SYSTEM_CONFIG_KEYS = [
  "admin.maxProjectsFree",
  "admin.maxProjectsPro",
  "admin.maxProjectsEnterprise",
  "admin.maxServersFree",
  "admin.maxServersPro",
  "admin.maxServersEnterprise",
  "admin.maxBuildTime",
  "admin.autoDeployDefault",
  "admin.registrationOpen",
  "admin.maintenanceMode",
];

const SYSTEM_CONFIG_DEFAULTS: Record<string, string> = {
  "admin.maxProjectsFree": "3",
  "admin.maxProjectsPro": "20",
  "admin.maxProjectsEnterprise": "999",
  "admin.maxServersFree": "1",
  "admin.maxServersPro": "5",
  "admin.maxServersEnterprise": "999",
  "admin.maxBuildTime": "600",
  "admin.autoDeployDefault": "true",
  "admin.registrationOpen": "true",
  "admin.maintenanceMode": "false",
};

export const getSystemConfig = async (
  _req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const settings = await SystemSetting.find({
      key: { $in: SYSTEM_CONFIG_KEYS },
    }).lean();

    const config: Record<string, string> = { ...SYSTEM_CONFIG_DEFAULTS };
    settings.forEach((s: any) => {
      config[s.key] = s.value;
    });

    res.json(config);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateSystemConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const updates = req.body; // Record<string, string>

    const ops = Object.entries(updates)
      .filter(([key]) => SYSTEM_CONFIG_KEYS.includes(key))
      .map(([key, value]) => ({
        updateOne: {
          filter: { key },
          update: { $set: { key, value: String(value) } },
          upsert: true,
        },
      }));

    if (ops.length > 0) {
      await SystemSetting.bulkWrite(ops as any);
    }

    await logActivity({
      action: "system.config.update",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Updated system config: ${Object.keys(updates).join(", ")}`,
      ip: req.ip,
    });

    res.json({ message: "System config updated" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
// Admin: Force actions on projects
// ============================================================

export const adminDeleteProject = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await Project.findById(req.params.id).populate(
      "owner",
      "username",
    );
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    await Deployment.deleteMany({ project: project._id });
    await Project.findByIdAndDelete(project._id);

    await logActivity({
      action: "admin.project.delete",
      userId: req.user!._id.toString(),
      team: req.user!.currentTeam?.toString(),
      username: req.user!.username,
      details: `Admin deleted project "${project.name}" owned by ${(project.owner as any)?.username}`,
      ip: req.ip,
    });
    res.json({ message: "Project and deployments deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
