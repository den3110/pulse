import { Response } from "express";
import Deployment from "../models/Deployment";
import Project from "../models/Project";
import deployService from "../services/deployService";
import { AuthRequest } from "../middleware/auth";
import { addSSEClient } from "../services/sseService";
import { logActivity } from "../services/activityLogger";

/**
 * Verify that the authenticated user owns the project.
 * Returns the project if found, or sends a 404 response and returns null.
 */
const verifyProjectOwnership = async (
  req: AuthRequest,
  res: Response,
  projectId: string,
) => {
  const project = await Project.findOne({
    _id: projectId,
    owner: req.user?._id,
  });
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return null;
  }
  return project;
};

export const deploy = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    const deploymentId = await deployService.deploy(
      project._id.toString(),
      "manual",
      req.user?._id.toString(),
    );
    res.status(201).json({ deploymentId, message: "Deployment started" });
    logActivity({
      action: "deploy",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Deployed project ${project.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const stop = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    await deployService.stop(project._id.toString());
    res.json({ message: "Service stopped" });
    logActivity({
      action: "stop",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Stopped project ${project.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const cancel = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    await deployService.cancel(project._id.toString());
    res.json({ message: "Deployment cancelled" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const restart = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    const deploymentId = await deployService.restart(
      project._id.toString(),
      req.user?._id.toString(),
    );
    res.json({ deploymentId, message: "Restart initiated" });
    logActivity({
      action: "restart",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Restarted project ${project.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const rollback = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { commitHash } = req.body;
    if (!commitHash) {
      res.status(400).json({ message: "commitHash is required" });
      return;
    }

    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    const deploymentId = await deployService.rollback(
      project._id.toString(),
      commitHash,
      req.user?._id.toString(),
    );
    res.status(201).json({ deploymentId, message: "Rollback started" });
    logActivity({
      action: "rollback",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Rollback project ${project.name} to ${commitHash}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const schedule = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { scheduledAt } = req.body;
    if (!scheduledAt) {
      res.status(400).json({ message: "scheduledAt is required" });
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      res.status(400).json({ message: "Scheduled time must be in the future" });
      return;
    }

    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    await Project.findByIdAndUpdate(project._id, {
      scheduledDeployAt: scheduledDate,
    });

    res.json({
      message: "Deploy scheduled",
      scheduledAt: scheduledDate,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const cancelSchedule = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    await Project.findByIdAndUpdate(project._id, {
      scheduledDeployAt: null,
    });
    res.json({ message: "Scheduled deploy cancelled" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getDiff = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      res
        .status(400)
        .json({ message: "from and to commit hashes are required" });
      return;
    }

    const project = await Project.findOne({
      _id: req.params.projectId,
      owner: req.user?._id,
    }).populate("server");
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    const serverId = (project.server as any)._id.toString();
    const sshService = (await import("../services/sshService")).default;

    const diff = await sshService.exec(
      serverId,
      `cd ${project.deployPath} && git diff ${from}..${to} --stat && echo "---DIFF_SEPARATOR---" && git diff ${from}..${to}`,
    );

    res.json({ diff: diff || "No changes found" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getHistory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await verifyProjectOwnership(
      req,
      res,
      req.params.projectId as string,
    );
    if (!project) return;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const deployments = await Deployment.find({
      project: project._id,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("triggeredByUser", "username")
      .select(
        "status commitHash branch triggeredBy triggeredByUser startedAt finishedAt errorMessage",
      );

    const total = await Deployment.countDocuments({
      project: project._id,
    });

    res.json({
      deployments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getDeploymentById = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const deployment = await Deployment.findById(req.params.id)
      .populate("project")
      .populate("server")
      .populate("triggeredByUser", "username");

    if (!deployment) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }

    // Verify ownership
    if (
      (deployment.project as any).owner.toString() !== req.user?._id.toString()
    ) {
      res.status(403).json({ message: "Not authorized" });
      return;
    }

    res.json(deployment);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const deployment = await Deployment.findById(
      req.params.deploymentId as string,
    );
    if (!deployment) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }

    // Verify the deployment belongs to a project owned by this user
    const project = await Project.findOne({
      _id: deployment.project,
      owner: req.user?._id,
    });
    if (!project) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }

    res.json({
      logs: deployment.logs,
      status: deployment.status,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const listRecent = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    // Only show deployments for projects owned by the current user
    const userProjects = await Project.find({ owner: req.user?._id }).select(
      "_id",
    );
    const projectIds = userProjects.map((p) => p._id);

    const deployments = await Deployment.find({ project: { $in: projectIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("project", "name")
      .populate("server", "name host")
      .populate("triggeredByUser", "username");

    res.json(deployments);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const stream = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const projectId = req.params.projectId as string;

  // Verify ownership before establishing SSE connection
  const project = await Project.findOne({
    _id: projectId,
    owner: req.user?._id,
  });
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // Send initial connected event
  res.write(
    `event: connected\ndata: ${JSON.stringify({ projectId, timestamp: new Date().toISOString() })}\n\n`,
  );

  // Register this connection for SSE broadcasts
  addSSEClient(projectId, res);

  // Heartbeat to keep connection alive (every 30s)
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
  });
};
