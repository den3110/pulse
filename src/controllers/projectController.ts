import { Response } from "express";
import Project from "../models/Project";
import { AuthRequest } from "../middleware/auth";
import crypto from "crypto";
import sshService from "../services/sshService";
import User from "../models/User";
import { logActivity } from "../services/activityLogger";

export const detectBranch = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { repoUrl, serverId } = req.body;
    if (!repoUrl || !serverId) {
      res.status(400).json({ message: "repoUrl and serverId are required" });
      return;
    }

    const result = await sshService.exec(
      serverId,
      `git ls-remote --symref ${repoUrl} HEAD 2>&1 | head -1`,
    );

    // Parse output like: ref: refs/heads/master  HEAD
    const match = result.stdout.match(/ref: refs\/heads\/(\S+)/);
    if (match) {
      res.json({ branch: match[1] });
    } else {
      // Fallback: try to get any branch
      const fallback = await sshService.exec(
        serverId,
        `git ls-remote --heads ${repoUrl} 2>&1 | head -5`,
      );
      const branches = fallback.stdout
        .split("\n")
        .map((line) => {
          const m = line.match(/refs\/heads\/(\S+)/);
          return m ? m[1] : null;
        })
        .filter(Boolean);

      if (branches.length > 0) {
        res.json({ branch: branches[0], allBranches: branches });
      } else {
        res.status(400).json({
          message:
            "Could not detect branch. Check repo URL and server git access.",
          detail: result.stdout || result.stderr,
        });
      }
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const listProjects = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const projects = await Project.find({ owner: req.user?._id })
      .populate("server", "name host status")
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getProject = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    }).populate("server", "name host status");
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    res.json(project);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createProject = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      name,
      repoUrl,
      branch,
      server,
      deployPath,
      outputPath,
      buildCommand,
      installCommand,
      startCommand,
      stopCommand,
      preDeployCommand,
      postDeployCommand,
      envVars,
      autoDeploy,
      healthCheckUrl,
      healthCheckInterval,
      repoFolder,
      buildOutputDir,
    } = req.body;

    const webhookSecret = crypto.randomBytes(32).toString("hex");

    const project = await Project.create({
      name,
      repoUrl,
      branch: branch || "main",
      server,
      deployPath,
      outputPath: outputPath || "",
      buildOutputDir: buildOutputDir || "",
      buildCommand,
      installCommand,
      startCommand,
      stopCommand: stopCommand || "",
      preDeployCommand: preDeployCommand || "",
      postDeployCommand: postDeployCommand || "",
      envVars: envVars || {},
      autoDeploy: autoDeploy || false,
      healthCheckUrl: healthCheckUrl || "",
      healthCheckInterval: healthCheckInterval || 60,
      webhookSecret,
      repoFolder: repoFolder || "",
      owner: req.user?._id,
    });

    const populated = await project.populate("server", "name host status");

    res.status(201).json(populated);
    logActivity({
      action: "project.create",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Created project ${name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProject = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      name,
      repoUrl,
      branch,
      server,
      deployPath,
      outputPath,
      buildOutputDir,
      buildCommand,
      installCommand,
      startCommand,
      stopCommand,
      preDeployCommand,
      postDeployCommand,
      envVars,
      autoDeploy,
      healthCheckUrl,
      healthCheckInterval,
      repoFolder,
    } = req.body;

    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, owner: req.user?._id },
      {
        name,
        repoUrl,
        branch,
        server,
        deployPath,
        outputPath,
        buildOutputDir,
        buildCommand,
        installCommand,
        startCommand,
        stopCommand,
        preDeployCommand,
        postDeployCommand,
        envVars,
        autoDeploy,
        healthCheckUrl,
        healthCheckInterval,
        repoFolder,
      },
      { new: true, runValidators: true },
    ).populate("server", "name host status");

    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    res.json(project);
    logActivity({
      action: "project.update",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Updated project ${project.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const saveAndRestart = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, owner: req.user?._id },
      req.body,
      { new: true, runValidators: true },
    ).populate("server", "name host status");

    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    const deployService = (await import("../services/deployService")).default;
    const deploymentId = await deployService.restart(
      project._id.toString(),
      req.user?._id.toString(),
    );

    res.json({
      project,
      deploymentId,
      message: "Saved and restart initiated",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteOutput = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    if (
      !project.outputPath ||
      !project.outputPath.startsWith("/") ||
      project.outputPath.length <= 1
    ) {
      res.status(400).json({
        message: "No valid output path configured for this project",
      });
      return;
    }
    const serverId = project.server.toString();
    await sshService.exec(serverId, `rm -rf "${project.outputPath}"`);
    res.json({
      message: `Output path ${project.outputPath} deleted successfully`,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteProject = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    // Verify password first
    const { password } = req.body;
    if (!password) {
      res
        .status(400)
        .json({ message: "Password is required to delete a project" });
      return;
    }

    const user = await User.findById(req.user?._id).select("+password");
    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    const isMatch = await (user as any).comparePassword(password);
    if (!isMatch) {
      res.status(403).json({ message: "Incorrect password" });
      return;
    }

    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    }).populate("server");

    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    const serverId = (project.server as any)?._id?.toString();
    const errors: string[] = [];

    if (serverId) {
      // 1. Stop running process if stopCommand exists
      if (project.stopCommand) {
        try {
          await sshService.exec(
            serverId,
            `cd ${project.deployPath} && ${project.stopCommand}`,
          );
        } catch {
          // Ignore — process might not be running
        }
      }

      // 2. Remove deploy path on remote server
      if (
        project.deployPath &&
        project.deployPath.startsWith("/") &&
        project.deployPath.length > 1
      ) {
        try {
          await sshService.exec(serverId, `rm -rf "${project.deployPath}"`);
        } catch (e: any) {
          errors.push(`Failed to remove deploy path: ${e.message}`);
        }
      }

      // 3. Remove output path on remote server (if set and different from deploy path)
      if (
        project.outputPath &&
        project.outputPath.startsWith("/") &&
        project.outputPath.length > 1 &&
        project.outputPath !== project.deployPath
      ) {
        try {
          await sshService.exec(serverId, `rm -rf "${project.outputPath}"`);
        } catch (e: any) {
          errors.push(`Failed to remove output path: ${e.message}`);
        }
      }
    }

    // 4. Delete all deployment records for this project
    const Deployment = (await import("../models/Deployment")).default;
    await Deployment.deleteMany({ project: project._id });

    // 5. Delete project from DB
    await Project.findByIdAndDelete(project._id);

    res.json({
      message: "Project deleted successfully",
      cleanupErrors: errors.length > 0 ? errors : undefined,
    });
    logActivity({
      action: "project.delete",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Deleted project ${project.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getWebhookUrl = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    }).select("+webhookSecret");
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    const webhookUrl = `/api/webhook/${project._id}`;
    res.json({
      webhookUrl,
      webhookSecret: project.webhookSecret,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const browseFolders = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, repoUrl, branch, deployPath, subPath } = req.body;
    if (!serverId || !repoUrl) {
      res.status(400).json({ message: "serverId and repoUrl are required" });
      return;
    }

    const branchName = branch || "main";
    const lsTreePath = subPath ? `${subPath}/` : "";

    // Check if repo is already cloned at deployPath AND matches the same repo URL
    let gitDir = "";
    let needsCleanup = false;

    if (deployPath) {
      const check = await sshService.exec(
        serverId,
        `test -d "${deployPath}/.git" && cd "${deployPath}" && git remote get-url origin 2>/dev/null || echo "NO"`,
      );
      const remoteUrl = check.stdout.trim();
      // Only use existing clone if remote URL matches
      if (remoteUrl && remoteUrl !== "NO" && remoteUrl === repoUrl) {
        gitDir = deployPath;
      }
    }

    // If not cloned, do a lightweight temp clone (no file content)
    if (!gitDir) {
      const tmpDir = `/tmp/repo-browse-${Date.now()}`;
      const cloneResult = await sshService.exec(
        serverId,
        `git clone --depth 1 --filter=blob:none --no-checkout "${repoUrl}" -b "${branchName}" "${tmpDir}" 2>&1`,
      );
      if (cloneResult.code !== 0) {
        res.status(400).json({
          message:
            "Failed to access repository. Check the URL and server git access.",
          detail: cloneResult.stdout || cloneResult.stderr,
        });
        return;
      }
      gitDir = tmpDir;
      needsCleanup = true;
    }

    // Use git ls-tree to list directories
    const result = await sshService.exec(
      serverId,
      `cd "${gitDir}" && git ls-tree -d --name-only HEAD ${lsTreePath ? `"${lsTreePath}"` : ""} 2>&1`,
    );

    // Parse folder names
    const folders = result.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((entry) => {
        // git ls-tree with subPath returns "subPath/folderName", strip the prefix
        if (subPath && entry.startsWith(subPath + "/")) {
          return entry.slice(subPath.length + 1);
        }
        return entry;
      })
      .filter((name) => name && !name.includes("/"));

    // Cleanup temp dir if we created one
    if (needsCleanup) {
      sshService.exec(serverId, `rm -rf "${gitDir}"`).catch(() => {});
    }

    res.json({
      folders,
      currentPath: subPath || "",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
