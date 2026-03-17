import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Server from "../models/Server";
import Project from "../models/Project";
import { analyzeRepo, DetectedProject } from "../services/projectDetector";
import deployService from "../services/deployService";
import sshService from "../services/sshService";
import crypto from "crypto";
import User from "../models/User";
import { logActivity } from "../services/activityLogger";

/**
 * POST /api/smart-deploy/analyze
 * Analyze a Git repository and return detected project config
 */
export const analyze = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { repoUrl, branch, serverId, customToken } = req.body;

    if (!repoUrl) {
      res.status(400).json({ message: "Repository URL is required" });
      return;
    }

    if (!serverId) {
      res.status(400).json({ message: "Server ID is required for analysis" });
      return;
    }

    // Verify server access
    const server = await Server.findById(serverId);
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    // Attempt to inject GitHub token for private repositories
    // Priority: customToken (from frontend input) > user's stored githubAccessToken
    let resolvedUrl = repoUrl;
    const user = await User.findById(req.user?._id).select(
      "+githubAccessToken",
    );
    const token = customToken || user?.githubAccessToken;
    if (token && repoUrl.includes("github.com")) {
      resolvedUrl = repoUrl.replace(/https?:\/\/[^@]*@/, "https://");
      resolvedUrl = resolvedUrl.replace(
        "https://github.com",
        `https://${token}@github.com`,
      );
    }

    // Setup SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const result = await analyzeRepo(
      serverId,
      resolvedUrl,
      branch || "main",
      (message) => {
        res.write(`data: ${JSON.stringify({ type: "progress", message })}\n\n`);
      },
    );

    res.write(
      `data: ${JSON.stringify({
        type: "success",
        detection: result,
        repoUrl, // Return the clean URL back to the frontend
        branch: branch || "main",
      })}\n\n`,
    );
    res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: error.message || "Failed to analyze repository",
        })}\n\n`,
      );
      res.end();
    }
  }
};

/**
 * POST /api/smart-deploy/check-server
 * Check if a server has the required tools installed
 */
export const checkServer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, requiredTools } = req.body;

    if (!serverId || !requiredTools) {
      res
        .status(400)
        .json({ message: "serverId and requiredTools are required" });
      return;
    }

    const server = await Server.findById(serverId);
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    // Check each required tool
    const toolChecks: Record<string, { installed: boolean; version?: string }> =
      {};
    const checkCommands: Record<string, string> = {
      node: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null; node -v 2>/dev/null || echo \'NOT_FOUND\'',
      pm2: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null; pm2 -v 2>/dev/null || echo \'NOT_FOUND\'',
      nginx: "nginx -v 2>&1 || echo 'NOT_FOUND'",
      docker: "docker --version 2>/dev/null || echo 'NOT_FOUND'",
      python3: "python3 --version 2>/dev/null || echo 'NOT_FOUND'",
      git: "git --version 2>/dev/null || echo 'NOT_FOUND'",
    };

    for (const tool of requiredTools) {
      const cmd =
        checkCommands[tool] || `which ${tool} 2>/dev/null || echo 'NOT_FOUND'`;
      try {
        const result = await sshService.exec(serverId, cmd);
        const output = result.stdout;
        const installed = !output.includes("NOT_FOUND");
        toolChecks[tool] = {
          installed,
          version: installed ? output.trim().split("\n")[0] : undefined,
        };
      } catch {
        toolChecks[tool] = { installed: false };
      }
    }

    // Always check git
    if (!toolChecks.git) {
      try {
        const gitResult = await sshService.exec(
          serverId,
          "git --version 2>/dev/null || echo 'NOT_FOUND'",
        );
        const gitOut = gitResult.stdout;
        toolChecks.git = {
          installed: !gitOut.includes("NOT_FOUND"),
          version: !gitOut.includes("NOT_FOUND") ? gitOut.trim() : undefined,
        };
      } catch {
        toolChecks.git = { installed: false };
      }
    }

    res.json({
      success: true,
      serverId,
      serverName: server.name,
      tools: toolChecks,
      allInstalled: Object.values(toolChecks).every((t) => t.installed),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/smart-deploy/install-tools
 * Auto-install missing tools on a server (SSE stream)
 */
export const installTools = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, tools } = req.body;

    if (!serverId || !tools || !Array.isArray(tools) || tools.length === 0) {
      res
        .status(400)
        .json({ message: "serverId and tools array are required" });
      return;
    }

    const server = await Server.findById(serverId);
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const installCommands: Record<string, string[]> = {
      node: [
        "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash",
        'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts',
      ],
      pm2: [
        'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && npm install -g pm2',
      ],
      nginx: ["apt-get update -y && apt-get install -y nginx"],
      git: ["apt-get update -y && apt-get install -y git"],
      docker: ["curl -fsSL https://get.docker.com | sh"],
      python3: ["apt-get update -y && apt-get install -y python3 python3-pip"],
    };

    const results: Record<string, boolean> = {};

    for (const tool of tools) {
      const cmds = installCommands[tool];
      if (!cmds) {
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            tool,
            message: `No install script available for "${tool}"`,
            status: "skipped",
          })}\n\n`,
        );
        results[tool] = false;
        continue;
      }

      res.write(
        `data: ${JSON.stringify({
          type: "progress",
          tool,
          message: `Installing ${tool}...`,
          status: "installing",
        })}\n\n`,
      );

      let success = true;
      for (const cmd of cmds) {
        try {
          await sshService.exec(serverId, cmd);
        } catch (err: any) {
          console.error(`[installTools] Failed to run: ${cmd}`, err.message);
          success = false;
          break;
        }
      }

      results[tool] = success;
      res.write(
        `data: ${JSON.stringify({
          type: "progress",
          tool,
          message: success
            ? `${tool} installed successfully`
            : `Failed to install ${tool}`,
          status: success ? "done" : "failed",
        })}\n\n`,
      );
    }

    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        results,
      })}\n\n`,
    );
    res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else {
      res.write(
        `data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`,
      );
      res.end();
    }
  }
};

/**
 * POST /api/smart-deploy/execute
 * Create project + trigger deployment in one step
 */
export const execute = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      repoUrl,
      branch,
      serverId,
      projectName,
      // From detection (user can override)
      installCommand,
      buildCommand,
      startCommand,
      stopCommand,
      buildOutputDir,
      deployPath,
      environment,
      envVars,
      autoDeploy,
    } = req.body;

    if (!repoUrl || !serverId || !projectName) {
      res
        .status(400)
        .json({ message: "repoUrl, serverId, and projectName are required" });
      return;
    }

    // Verify server
    const server = await Server.findById(serverId);
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    // Create the project
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const project = await Project.create({
      name: projectName,
      sourceType: "git",
      repoUrl,
      branch: branch || "main",
      server: serverId,
      deployPath: deployPath || `/var/www/${projectName}`,
      buildOutputDir: buildOutputDir || "",
      buildCommand: buildCommand || "",
      installCommand: installCommand || "npm install",
      startCommand: startCommand || "npm start",
      stopCommand: stopCommand || "",
      envVars: envVars || {},
      autoDeploy: autoDeploy !== undefined ? autoDeploy : true,
      environment: environment || "node",
      webhookSecret,
      owner: req.user?._id,
    });

    // Trigger deployment immediately
    const deploymentId = await deployService.deploy(
      project._id.toString(),
      "manual",
      req.user?._id?.toString(),
    );

    const populated = await project.populate("server", "name host status");

    logActivity({
      action: "project.smartDeploy",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Smart deployed ${projectName} from ${repoUrl}`,
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      project: populated,
      deploymentId,
      message: "Project created and deployment started!",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
