import Project, { IProject } from "../models/Project";
import Deployment from "../models/Deployment";
import Notification from "../models/Notification";
import User from "../models/User";
import SystemSetting from "../models/SystemSetting";
import sshService from "./sshService";
import {
  emitDeployLog,
  emitDeployStatus,
  emitNotification,
} from "./socketService";

class DeployService {
  private activeDeploys: Set<string> = new Set();
  private cancelledDeploys: Set<string> = new Set(); // Track cancelled deploys

  /**
   * Full deploy pipeline: clone/pull → install → build → start
   */
  async deploy(
    projectId: string,
    triggeredBy: "manual" | "webhook" | "schedule" = "manual",
    userId?: string,
  ): Promise<string> {
    // Check if a deployment is already in progress
    if (this.activeDeploys.has(projectId)) {
      console.log(
        `[Deploy] Active deployment found for ${projectId}. Cancelling...`,
      );

      // Cancel the current deployment
      try {
        await this.cancel(projectId);
      } catch (e) {
        console.warn(`[Deploy] Error cancelling previous deployment: ${e}`);
      }

      // Wait for the lock to be released (max 30s)
      let retries = 0;
      while (this.activeDeploys.has(projectId) && retries < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        retries++;
      }

      if (this.activeDeploys.has(projectId)) {
        throw new Error(
          "Previous deployment could not be cancelled in time. Please try again later.",
        );
      }

      console.log(`[Deploy] Previous deployment cancelled. Starting new one.`);
    }

    this.activeDeploys.add(projectId);

    const project = await Project.findById(projectId).populate("server");
    if (!project) {
      this.activeDeploys.delete(projectId);
      throw new Error("Project not found");
    }

    // Create deployment record
    const deployment = await Deployment.create({
      project: project._id,
      server: project.server,
      branch: project.branch,
      triggeredBy,
      triggeredByUser: userId,
      status: "pending",
      startedAt: new Date(),
    });

    const deploymentId = deployment._id.toString();
    const serverId = (project.server as any)._id.toString();

    // Run deploy pipeline asynchronously
    this.runPipeline(deploymentId, serverId, project).catch((err) => {
      console.error(`[Deploy] Pipeline failed for ${deploymentId}:`, err);
    });

    // Notify started
    this.sendNotification(project.name, "started", deploymentId).catch(
      console.error,
    );

    return deploymentId;
  }

  private async runPipeline(
    deploymentId: string,
    serverId: string,
    project: IProject,
  ): Promise<void> {
    const deployPath = project.deployPath;
    const repoUrl = project.repoUrl;
    const branch = project.branch;
    const pid = project._id.toString();
    // workDir: if repoFolder is set, commands run inside that subfolder
    const workDir = project.repoFolder
      ? `${deployPath}/${project.repoFolder}`
      : deployPath;

    try {
      // Pre-deploy hook
      if (project.preDeployCommand) {
        emitDeployLog(
          deploymentId,
          `🪝 Running pre-deploy hook...`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `cd ${workDir} 2>/dev/null && ${project.preDeployCommand} || ${project.preDeployCommand}`,
          pid,
        );
        emitDeployLog(
          deploymentId,
          "✅ Pre-deploy hook completed",
          "success",
          pid,
        );
      }

      // Step 1: Clone or Pull (auto-creates directories, handles broken state)
      await this.updateStatus(deploymentId, "cloning", pid);
      emitDeployLog(
        deploymentId,
        `📡 Checking repository at ${deployPath}...`,
        "info",
        pid,
      );

      // Single robust command: create parent dir, check .git, pull or clone
      const cloneOrPull = `mkdir -p "$(dirname "${deployPath}")" && if [ -d "${deployPath}/.git" ]; then echo "REPO_EXISTS"; else echo "REPO_NEW" && rm -rf "${deployPath}"; fi`;

      const dirCheck = await sshService.exec(serverId, cloneOrPull);

      if (dirCheck.stdout.includes("REPO_EXISTS")) {
        emitDeployLog(
          deploymentId,
          `📥 Repository found! Pulling latest changes from branch ${branch}...`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `cd ${deployPath} && git fetch origin && git checkout ${branch} && git pull origin ${branch}`,
          pid,
        );
      } else {
        emitDeployLog(
          deploymentId,
          `📥 Cloning repository to ${deployPath}...`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `rm -rf "${deployPath}" && git clone -b ${branch} ${repoUrl} ${deployPath}`,
          pid,
        );
      }

      // Get commit hash + message
      const commitResult = await sshService.exec(
        serverId,
        `cd ${deployPath} && git rev-parse --short HEAD`,
      );
      const commitMsg = await sshService.exec(
        serverId,
        `cd ${deployPath} && git log -1 --format='%s (%an)'`,
      );
      const hash = commitResult.stdout.trim();
      const message = commitMsg.stdout.trim();

      // Extract author if possible (format was '%s (%an)')
      const authorMatch = message.match(/\(([^)]+)\)$/);
      const author = authorMatch ? authorMatch[1] : "Unknown";
      const cleanMessage = message.replace(/\s\([^)]+\)$/, "");

      await Deployment.findByIdAndUpdate(deploymentId, {
        commitHash: hash,
        commitMessage: cleanMessage,
        commitAuthor: author,
      });
      emitDeployLog(
        deploymentId,
        `✅ Code ready at commit: ${hash} — ${message}`,
        "success",
        pid,
      );

      // Step 2: Set environment variables
      const envMap: Record<string, string> =
        project.envVars instanceof Map
          ? Object.fromEntries(project.envVars)
          : { ...((project.envVars as any) || {}) };
      const envKeys = Object.keys(envMap);
      if (envKeys.length > 0) {
        emitDeployLog(
          deploymentId,
          "🔧 Setting environment variables...",
          "info",
          pid,
        );
        const envContent = envKeys
          .map((key) => `${key}=${envMap[key]}`)
          .join("\n");
        // Use heredoc to avoid shell quoting issues
        await sshService.exec(
          serverId,
          `cd ${workDir} && cat > .env << 'ENVEOF'\n${envContent}\nENVEOF`,
        );
        emitDeployLog(
          deploymentId,
          `✅ Environment variables set`,
          "success",
          pid,
        );
      }

      // Step 3: Install dependencies
      if (project.installCommand) {
        await this.updateStatus(deploymentId, "installing", pid);
        emitDeployLog(
          deploymentId,
          `📦 Installing dependencies: ${project.installCommand}`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `cd ${workDir} && ${project.installCommand}`,
          pid,
        );
        emitDeployLog(
          deploymentId,
          "✅ Dependencies installed",
          "success",
          pid,
        );
      }

      // Step 4: Build
      if (project.buildCommand) {
        await this.updateStatus(deploymentId, "building", pid);
        emitDeployLog(
          deploymentId,
          `🔨 Building: ${project.buildCommand}`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `cd ${workDir} && ${project.buildCommand}`,
          pid,
        );
        emitDeployLog(deploymentId, "✅ Build completed", "success", pid);
      }

      // Step 4.5: Copy to output path if configured
      if (project.outputPath) {
        emitDeployLog(
          deploymentId,
          `📂 Copying build output to ${project.outputPath}...`,
          "info",
          pid,
        );
        const srcPath = project.buildOutputDir
          ? `${workDir}/${project.buildOutputDir}`
          : workDir;
        await this.execWithLogs(
          serverId,
          deploymentId,
          `mkdir -p "${project.outputPath}" && rsync -a --delete "${srcPath}/" "${project.outputPath}/"`,
          pid,
        );
        emitDeployLog(
          deploymentId,
          "✅ Output copied to target path",
          "success",
          pid,
        );
      }

      // Step 5: Stop existing process if running
      emitDeployLog(
        deploymentId,
        `⏹️ Stopping existing process...`,
        "info",
        pid,
      );
      try {
        if (project.stopCommand) {
          await sshService.exec(
            serverId,
            `cd ${deployPath} && ${project.stopCommand}`,
          );
        }
        // Also kill by PID file (fallback)
        await sshService.exec(
          serverId,
          `if [ -f "${workDir}/.deploy.pid" ]; then kill $(cat "${workDir}/.deploy.pid") 2>/dev/null; rm -f "${workDir}/.deploy.pid"; fi`,
        );
      } catch (e) {
        // Ignore stop errors (process might not be running)
      }

      // Step 6: Start
      if (project.startCommand) {
        await this.updateStatus(deploymentId, "starting", pid);
        emitDeployLog(
          deploymentId,
          `🚀 Starting: ${project.startCommand}`,
          "info",
          pid,
        );

        if (project.processManager === "pm2") {
          // PM2 Logic
          const pm2Name = project.name;
          emitDeployLog(
            deploymentId,
            `⚡ Using PM2 to manage process: ${pm2Name}`,
            "info",
            pid,
          );

          // 1. Delete existing process if any
          try {
            await sshService.exec(serverId, `pm2 delete "${pm2Name}"`);
          } catch {}

          // 2. Start new process
          // pm2 start "npm start" --name "my-project" --cwd "/path/to/repo"
          await sshService.exec(
            serverId,
            `pm2 start "${project.startCommand}" --name "${pm2Name}" --cwd "${workDir}"`,
          );

          // 3. Save PM2 list
          await sshService.exec(serverId, "pm2 save");

          // 4. Verify PM2 process
          try {
            await sshService.exec(serverId, `pm2 show "${pm2Name}"`);
          } catch (e) {
            throw new Error("Service failed to start (PM2 process not found)");
          }

          emitDeployLog(
            deploymentId,
            "✅ Service started with PM2!",
            "success",
            pid,
          );
        } else {
          // Default nohup Logic
          const logFile = `/tmp/deploy-${deploymentId}.log`;
          // Use nohup to keep process running after SSH disconnect, save PID
          // Use < /dev/null and ( ... ) & to ensure efficient detachment
          await sshService.exec(
            serverId,
            `cd ${workDir} && (nohup ${project.startCommand} > ${logFile} 2>&1 < /dev/null & echo $! > "${workDir}/.deploy.pid")`,
          );

          // Stream logs for 10 seconds to show startup progress
          emitDeployLog(
            deploymentId,
            "📋 Tailing logs for 10s...",
            "info",
            pid,
          );
          try {
            // tail -n +1 -f: Start from line 1 and follow. Ensures we don't miss initial output.
            await sshService.execStreamLine(
              serverId,
              `timeout 10s tail -n +1 -f ${logFile} || true`,
              (line) => {
                if (line.trim()) emitDeployLog(deploymentId, line, "info", pid);
              },
            );
          } catch (e) {
            // Ignore tail errors (e.g. timeout kills it)
          }

          // 3. Verify process is still alive
          try {
            const pidCheck = await sshService.exec(
              serverId,
              `if [ -f "${workDir}/.deploy.pid" ] && kill -0 $(cat "${workDir}/.deploy.pid") 2>/dev/null; then echo "ALIVE"; else echo "DEAD"; fi`,
            );

            if (pidCheck.stdout.trim() !== "ALIVE") {
              throw new Error(
                "Service failed to start (process died immediately)",
              );
            }
          } catch (e: any) {
            throw new Error(`Service failed to start: ${e.message}`);
          }

          emitDeployLog(deploymentId, "✅ Service started!", "success", pid);
        }
      }

      // Post-deploy hook
      if (project.postDeployCommand) {
        emitDeployLog(
          deploymentId,
          `🪝 Running post-deploy hook...`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `cd ${workDir} && ${project.postDeployCommand}`,
          pid,
        );
        emitDeployLog(
          deploymentId,
          "✅ Post-deploy hook completed",
          "success",
          pid,
        );
      }

      // Mark as running
      await this.updateStatus(deploymentId, "running", pid);
      await Project.findByIdAndUpdate(project._id, {
        lastDeployedAt: new Date(),
      });

      emitDeployLog(
        deploymentId,
        "🎉 Deployment completed successfully!",
        "success",
        pid,
      );
      await Deployment.findByIdAndUpdate(deploymentId, {
        finishedAt: new Date(),
      });

      // Send Notification on success
      await this.sendNotification(project.name, "success", deploymentId);

      // Create in-app notification for all users
      await this.createNotification(
        project,
        "deploy_success",
        `✅ ${project.name} deployed`,
        `Deployment completed successfully`,
        `/projects/${project._id}/deploy`,
      );

      // Release deploy lock
      this.activeDeploys.delete(pid);
      this.cancelledDeploys.delete(pid);
    } catch (error: any) {
      const isCancelled = this.cancelledDeploys.has(pid);
      if (isCancelled) {
        emitDeployLog(
          deploymentId,
          `⛔ Deployment cancelled by user`,
          "warning",
          pid,
        );
      } else {
        emitDeployLog(
          deploymentId,
          `❌ Deployment failed: ${error.message}`,
          "error",
          pid,
        );
      }
      await this.updateStatus(
        deploymentId,
        isCancelled ? "cancelled" : "failed",
        pid,
      );
      await Deployment.findByIdAndUpdate(deploymentId, {
        errorMessage: isCancelled ? "Cancelled by user" : error.message,
        finishedAt: new Date(),
      });

      // Release deploy lock
      this.activeDeploys.delete(pid);
      this.cancelledDeploys.delete(pid);

      // Send Notification on failure
      await this.sendNotification(
        project.name,
        "failed",
        deploymentId,
        error.message,
      );

      // Create in-app notification for all users
      if (!isCancelled) {
        await this.createNotification(
          project,
          "deploy_failed",
          `❌ ${project.name} failed`,
          error.message?.slice(0, 200) || "Deployment failed",
          `/projects/${project._id}/deploy`,
        );
      }
    }
  }

  /**
   * Create in-app notification for all users
   */
  private async createNotification(
    project: IProject,
    type: "deploy_success" | "deploy_failed" | "health_alert",
    title: string,
    message: string,
    link?: string,
  ): Promise<void> {
    try {
      const users = await User.find({}, "_id");
      const notifications = users.map((u) => ({
        userId: u._id,
        projectId: project._id,
        type,
        title,
        message,
        link,
      }));
      const created = await Notification.insertMany(notifications);

      // Emit real-time event to each user
      created.forEach((notif) => {
        emitNotification(notif.userId.toString(), notif);
      });
    } catch (err) {
      console.error("[Notification] Failed to create notification:", err);
    }
  }

  /**
   * Execute command with streaming logs
   */
  private async execWithLogs(
    serverId: string,
    deploymentId: string,
    command: string,
    projectId?: string,
  ): Promise<void> {
    // Check if deploy was cancelled before starting
    if (projectId && this.cancelledDeploys.has(projectId)) {
      throw new Error("Deployment cancelled by user");
    }

    let exitCode = 0;

    // Get deploy path from project to write running PID
    const project = projectId ? await Project.findById(projectId) : null;
    const deployPath = project?.deployPath;

    // Wrap command to write its PID so we can kill it
    // Only write PID if deploy directory already exists (skip on first clone)
    const wrappedCommand = deployPath
      ? `bash -c 'if [ -d "${deployPath}" ]; then echo $$ > "${deployPath}/.deploy.running.pid"; fi && ${command.replace(/'/g, "'\\''")}'`
      : command;

    await sshService.execStreamLine(
      serverId,
      wrappedCommand,
      (line, type) => {
        const logType = type === "stderr" ? "warning" : "info";
        emitDeployLog(deploymentId, line, logType as any, projectId);
      },
      (code) => {
        exitCode = code;
        if (
          code !== 0 &&
          !(projectId && this.cancelledDeploys.has(projectId))
        ) {
          emitDeployLog(
            deploymentId,
            `Process exited with code ${code}`,
            "error",
            projectId,
          );
        }
      },
    );

    // Clean up running PID file
    if (deployPath) {
      try {
        await sshService.exec(
          serverId,
          `rm -f "${deployPath}/.deploy.running.pid"`,
        );
      } catch (e) {
        /* ignore */
      }
    }

    // Check cancellation again after command completes
    if (projectId && this.cancelledDeploys.has(projectId)) {
      throw new Error("Deployment cancelled by user");
    }

    if (exitCode !== 0) {
      throw new Error(`Command failed with exit code ${exitCode}: ${command}`);
    }
  }

  /**
   * Cancel a running deployment
   */
  async cancel(projectId: string): Promise<void> {
    const project = await Project.findById(projectId);
    if (!project) throw new Error("Project not found");

    if (!this.activeDeploys.has(projectId)) {
      throw new Error("No active deployment for this project");
    }

    // Mark as cancelled
    this.cancelledDeploys.add(projectId);

    const serverId = project.server.toString();

    // Kill running deploy process on VPS
    try {
      await sshService.exec(
        serverId,
        `if [ -f "${project.deployPath}/.deploy.running.pid" ]; then kill -TERM -- -$(cat "${project.deployPath}/.deploy.running.pid") 2>/dev/null; kill $(cat "${project.deployPath}/.deploy.running.pid") 2>/dev/null; rm -f "${project.deployPath}/.deploy.running.pid"; fi`,
      );
    } catch (e) {
      // Process might have already exited
    }

    emitDeployLog(
      projectId,
      "⛔ Deployment cancelled by user",
      "warning",
      projectId,
    );
  }

  private async updateStatus(
    deploymentId: string,
    status: string,
    projectId?: string,
  ): Promise<void> {
    await Deployment.findByIdAndUpdate(deploymentId, { status });
    emitDeployStatus(deploymentId, status, projectId);
    // Also sync the project status so polling gets the correct value
    if (projectId) {
      await Project.findByIdAndUpdate(projectId, { status });
    }
  }

  /**
   * Stop a running service
   */
  async stop(projectId: string): Promise<void> {
    const project = await Project.findById(projectId);
    if (!project) throw new Error("Project not found");

    const serverId = project.server.toString();
    const workDir = project.repoFolder
      ? `${project.deployPath}/${project.repoFolder}`
      : project.deployPath;

    try {
      // Run user's stop command if configured
      if (project.stopCommand) {
        await sshService.exec(
          serverId,
          `cd ${workDir} && ${project.stopCommand}`,
        );
      }

      if (project.processManager === "pm2") {
        // PM2 Stop
        await sshService.exec(serverId, `pm2 delete "${project.name}"`);
        await sshService.exec(serverId, "pm2 save");
      } else {
        // Kill by PID file (always try as fallback)
        await sshService.exec(
          serverId,
          `if [ -f "${workDir}/.deploy.pid" ]; then kill $(cat "${workDir}/.deploy.pid") 2>/dev/null; rm -f "${workDir}/.deploy.pid"; fi`,
        );
      }
    } catch (e) {
      // Ignore errors — process might not be running
    }

    await Project.findByIdAndUpdate(projectId, { status: "stopped" });
  }

  /**
   * Restart a service (stop + full deploy)
   */
  async restart(projectId: string, userId?: string): Promise<string> {
    await this.stop(projectId);
    return this.deploy(projectId, "manual", userId);
  }

  /**
   * Rollback to a specific commit hash
   */
  async rollback(
    projectId: string,
    commitHash: string,
    userId?: string,
  ): Promise<string> {
    // Deployment lock
    if (this.activeDeploys.has(projectId)) {
      throw new Error("A deployment is already in progress for this project");
    }
    this.activeDeploys.add(projectId);

    const project = await Project.findById(projectId).populate("server");
    if (!project) {
      this.activeDeploys.delete(projectId);
      throw new Error("Project not found");
    }

    const serverId = project.server._id
      ? project.server._id.toString()
      : project.server.toString();
    const pid = project._id.toString();
    const deployPath = project.deployPath;
    const workDir = project.repoFolder
      ? `${deployPath}/${project.repoFolder}`
      : deployPath;

    // Create a new deployment record for the rollback
    const deployment = await Deployment.create({
      project: project._id,
      server: serverId,
      branch: project.branch,
      commitHash,
      status: "cloning",
      triggeredBy: "manual",
      triggeredByUser: userId,
    });

    const deploymentId = deployment._id.toString();

    // Run rollback pipeline in background
    (async () => {
      try {
        emitDeployLog(
          deploymentId,
          `⏪ Rolling back to commit: ${commitHash}`,
          "warning",
          pid,
        );

        // Step 1: Checkout the target commit
        await this.updateStatus(deploymentId, "cloning", pid);
        emitDeployLog(
          deploymentId,
          `📥 Checking out commit ${commitHash}...`,
          "info",
          pid,
        );
        await this.execWithLogs(
          serverId,
          deploymentId,
          `cd ${deployPath} && git fetch origin && git checkout ${commitHash}`,
          pid,
        );

        // Get commit message for this hash
        const commitMsg = await sshService.exec(
          serverId,
          `cd ${deployPath} && git log -1 --format='%s (%an)' ${commitHash}`,
        );
        emitDeployLog(
          deploymentId,
          `✅ Checked out: ${commitHash} — ${commitMsg.stdout.trim()}`,
          "success",
          pid,
        );

        // Step 2: Install
        if (project.installCommand) {
          await this.updateStatus(deploymentId, "installing", pid);
          emitDeployLog(
            deploymentId,
            `📦 Installing dependencies...`,
            "info",
            pid,
          );
          await this.execWithLogs(
            serverId,
            deploymentId,
            `cd ${workDir} && ${project.installCommand}`,
            pid,
          );
          emitDeployLog(
            deploymentId,
            "✅ Dependencies installed",
            "success",
            pid,
          );
        }

        // Step 3: Build
        if (project.buildCommand) {
          await this.updateStatus(deploymentId, "building", pid);
          emitDeployLog(deploymentId, `🔨 Building...`, "info", pid);
          await this.execWithLogs(
            serverId,
            deploymentId,
            `cd ${workDir} && ${project.buildCommand}`,
            pid,
          );
          emitDeployLog(deploymentId, "✅ Build completed", "success", pid);
        }

        // Step 4: Copy output if configured
        if (project.outputPath) {
          emitDeployLog(
            deploymentId,
            `📂 Copying to ${project.outputPath}...`,
            "info",
            pid,
          );
          const srcPath = project.buildOutputDir
            ? `${workDir}/${project.buildOutputDir}`
            : workDir;
          await this.execWithLogs(
            serverId,
            deploymentId,
            `mkdir -p "${project.outputPath}" && rsync -a --delete "${srcPath}/" "${project.outputPath}/"`,
            pid,
          );
          emitDeployLog(deploymentId, "✅ Output copied", "success", pid);
        }

        // Step 5: Stop existing process
        if (project.stopCommand) {
          emitDeployLog(
            deploymentId,
            `⏹️ Stopping existing process...`,
            "info",
            pid,
          );
          try {
            await sshService.exec(
              serverId,
              `cd ${workDir} && ${project.stopCommand}`,
            );
          } catch {
            /* ignore */
          }
        }

        // Step 6: Start
        if (project.startCommand) {
          await this.updateStatus(deploymentId, "starting", pid);
          emitDeployLog(
            deploymentId,
            `🚀 Starting: ${project.startCommand}`,
            "info",
            pid,
          );

          if (project.processManager === "pm2") {
            // PM2 Logic
            const pm2Name = project.name;
            emitDeployLog(
              deploymentId,
              `⚡ Using PM2 to manage process: ${pm2Name}`,
              "info",
              pid,
            );

            try {
              await sshService.exec(serverId, `pm2 delete "${pm2Name}"`);
            } catch {}

            await sshService.exec(
              serverId,
              `pm2 start "${project.startCommand}" --name "${pm2Name}" --cwd "${workDir}"`,
            );
            await sshService.exec(serverId, "pm2 save");

            // 4. Verify PM2 process
            try {
              await sshService.exec(serverId, `pm2 show "${pm2Name}"`);
            } catch (e) {
              throw new Error(
                "Service failed to start (PM2 process not found)",
              );
            }

            emitDeployLog(
              deploymentId,
              "✅ Service started (background)!",
              "success",
              pid,
            );
          } else {
            // Nohup Logic
            const logFile = `/tmp/deploy-${deploymentId}.log`;
            // 1. Start process in background
            // Use < /dev/null to ensure ssh channel closes
            // Use ( ... ) & to ensure shell detachment
            await sshService.exec(
              serverId,
              `cd ${workDir} && (nohup ${project.startCommand} > ${logFile} 2>&1 < /dev/null & echo $! > "${workDir}/.deploy.pid")`,
            );

            // 2. Stream logs for 10 seconds to show startup progress
            emitDeployLog(
              deploymentId,
              "📋 Tailing logs for 10s...",
              "info",
              pid,
            );
            try {
              await sshService.execStreamLine(
                serverId,
                `timeout 10s tail -n +1 -f ${logFile} || true`,
                (line) => {
                  if (line.trim())
                    emitDeployLog(deploymentId, line, "info", pid);
                },
              );
            } catch (e) {
              // Ignore tail errors (e.g. timeout kills it)
            }

            // 3. Verify process is still alive
            try {
              const pidCheck = await sshService.exec(
                serverId,
                `if [ -f "${workDir}/.deploy.pid" ] && kill -0 $(cat "${workDir}/.deploy.pid") 2>/dev/null; then echo "ALIVE"; else echo "DEAD"; fi`,
              );

              if (pidCheck.stdout.trim() !== "ALIVE") {
                throw new Error(
                  "Service failed to start (process died immediately)",
                );
              }
            } catch (e: any) {
              throw new Error(`Service failed to start: ${e.message}`);
            }

            emitDeployLog(
              deploymentId,
              "✅ Service started (background)!",
              "success",
              pid,
            );
          }
        }

        await this.updateStatus(deploymentId, "running", pid);
        await Project.findByIdAndUpdate(project._id, {
          lastDeployedAt: new Date(),
        });
        emitDeployLog(
          deploymentId,
          `🎉 Rollback to ${commitHash} completed!`,
          "success",
          pid,
        );
        await Deployment.findByIdAndUpdate(deploymentId, {
          finishedAt: new Date(),
        });

        await this.sendNotification(project.name, "success", deploymentId);

        // Release deploy lock
        this.activeDeploys.delete(pid);
      } catch (error: any) {
        emitDeployLog(
          deploymentId,
          `❌ Rollback failed: ${error.message}`,
          "error",
          pid,
        );
        await this.updateStatus(deploymentId, "failed", pid);
        await Deployment.findByIdAndUpdate(deploymentId, {
          errorMessage: error.message,
          finishedAt: new Date(),
        });
        await this.sendNotification(
          project.name,
          "failed",
          deploymentId,
          error.message,
        );

        // Release deploy lock
        this.activeDeploys.delete(pid);
      }
    })();

    return deploymentId;
  }

  /**
   * Send notification via NotificationService
   */
  private async sendNotification(
    projectName: string,
    status: "success" | "failed" | "started",
    deploymentId: string,
    errorMsg?: string,
  ): Promise<void> {
    const deployment = await Deployment.findById(deploymentId);
    if (!deployment) return;

    const duration = deployment.finishedAt
      ? `${((deployment.finishedAt.getTime() - deployment.startedAt.getTime()) / 1000).toFixed(1)}s`
      : "—";

    // Get Commit Info
    let commitInfo = {
      hash: deployment.commitHash || "HEAD",
      message: "No commit message",
      author: "Unknown",
      url: "",
    };

    try {
      const project = await Project.findById(deployment.project);
      if (project) {
        const serverId = project.server.toString();
        // Get detailed commit info if hash exists
        if (deployment.commitHash) {
          const log = await sshService.exec(
            serverId,
            `cd ${project.deployPath} && git log -1 --format='%an|%s' ${deployment.commitHash}`,
          );
          const [author, message] = log.stdout.trim().split("|");
          if (author) commitInfo.author = author;
          if (message) commitInfo.message = message;

          // Construct Commit URL (Github/Gitlab)
          if (project.repoUrl.includes("github.com")) {
            commitInfo.url = `${project.repoUrl.replace(/\.git$/, "")}/commit/${deployment.commitHash}`;
          } else if (project.repoUrl.includes("gitlab.com")) {
            commitInfo.url = `${project.repoUrl.replace(/\.git$/, "")}/-/commit/${deployment.commitHash}`;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch commit details for notification", e);
    }

    const title =
      status === "success"
        ? `✅ Deployment Successful: ${projectName}`
        : `❌ Deployment Failed: ${projectName}`;

    const message =
      status === "success"
        ? `Successfully deployed revision ${deployment.commitHash?.substring(0, 7) || "HEAD"}`
        : `Failed to deploy: ${errorMsg}`;

    const notificationService = (await import("./notificationService")).default;
    await notificationService.send(
      status === "success" ? "deployment_success" : "deployment_failed",
      {
        title,
        message,
        type: status === "success" ? "success" : "error",
        fields: [
          { name: "Project", value: projectName, inline: true },
          { name: "Branch", value: deployment.branch, inline: true },
          { name: "Duration", value: duration, inline: true },
          { name: "Triggered By", value: deployment.triggeredBy, inline: true },
        ],
        url: `${process.env.APP_URL || "http://localhost:3000"}/projects/${deployment.project}/deploy`,
        commit: commitInfo,
        buildTime: duration,
        project: projectName,
      },
    );
  }
}

export default new DeployService();
