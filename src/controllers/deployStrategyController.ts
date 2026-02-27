import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Project from "../models/Project";
import Deployment from "../models/Deployment";
import deployService from "../services/deployService";

/**
 * POST /api/deploy-strategy/:projectId/blue-green
 * Simulates blue-green deployment: deploy to staging, then swap
 */
export const blueGreenDeploy = async (req: AuthRequest, res: Response) => {
  try {
    const project = await Project.findById(req.params.projectId).lean();
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    // Start deployment with blue-green metadata
    const deploymentId = await deployService.deploy(
      req.params.projectId as string,
      "manual",
      req.user?._id?.toString(),
    );

    res.json({
      message: "Blue-green deployment started",
      deploymentId,
      strategy: "blue-green",
      steps: [
        { step: 1, label: "Deploy to staging slot", status: "in-progress" },
        { step: 2, label: "Health check on staging", status: "pending" },
        { step: 3, label: "Swap traffic to new version", status: "pending" },
        { step: 4, label: "Keep old version as fallback", status: "pending" },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/deploy-strategy/:projectId/canary
 * Simulates canary deployment with traffic percentage
 */
export const canaryDeploy = async (req: AuthRequest, res: Response) => {
  try {
    const { percentage = 10 } = req.body;
    const project = await Project.findById(req.params.projectId).lean();
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    const deploymentId = await deployService.deploy(
      req.params.projectId as string,
      "manual",
      req.user?._id?.toString(),
    );

    res.json({
      message: `Canary deployment started (${percentage}% traffic)`,
      deploymentId,
      strategy: "canary",
      trafficPercentage: percentage,
      steps: [
        {
          step: 1,
          label: `Deploy canary (${percentage}% traffic)`,
          status: "in-progress",
        },
        { step: 2, label: "Monitor error rate", status: "pending" },
        { step: 3, label: "Gradually increase traffic", status: "pending" },
        { step: 4, label: "Full rollout or rollback", status: "pending" },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/deploy-strategy/:projectId/status
 * Get recent deployment strategy status
 */
export const getDeployStatus = async (req: AuthRequest, res: Response) => {
  try {
    const recentDeploys = await Deployment.find({
      project: req.params.projectId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({ deployments: recentDeploys });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
