import Project from "../models/Project";
import SystemSetting from "../models/SystemSetting";
import sshService from "./sshService";
import deployService from "./deployService";

class GitPollingService {
  private intervalId: NodeJS.Timeout | null = null;
  private pollingIntervalMs = 60_000; // Default: check every 60 seconds
  private isChecking = false;

  start(intervalMs?: number) {
    if (intervalMs) this.pollingIntervalMs = intervalMs;
    console.log(
      `[GitPolling] Starting polling every ${this.pollingIntervalMs / 1000}s`,
    );
    this.intervalId = setInterval(
      () => this.checkAll(),
      this.pollingIntervalMs,
    );
    // Run once immediately
    this.checkAll();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[GitPolling] Stopped");
    }
  }

  private async checkAll() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      // Read dynamic polling interval from settings (for next cycle info)
      const interval = await (SystemSetting as any).getValue(
        "pollingInterval",
        "60",
      );
      this.pollingIntervalMs = parseInt(interval, 10) * 1000;

      // Skip projects that have a GitHub webhook registered — those get instant deploys
      const projects = await Project.find({
        autoDeploy: true,
        webhookRegistered: { $ne: true },
        status: {
          $nin: [
            "deploying",
            "building",
            "cloning",
            "installing",
            "starting",
            "stopped",
          ],
        },
      }).populate("server");

      for (const project of projects) {
        try {
          await this.checkProject(project);
        } catch (err: any) {
          console.error(
            `[GitPolling] Error checking project ${project.name}:`,
            err.message,
          );
        }
      }
    } catch (err: any) {
      console.error("[GitPolling] Error fetching projects:", err.message);
    } finally {
      this.isChecking = false;
    }
  }

  private async checkProject(project: any) {
    const serverId = project.server?._id?.toString();
    if (!serverId) return;

    const deployPath = project.deployPath;

    // ======== LOCAL FOLDER MONITORING ========
    if (project.sourceType === "local") {
      // Find the most recently modified file inside the deployPath
      // Excludes build output dirs to prevent deploy → new files → re-deploy infinite loop
      const excludeDirs = [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        ".nuxt",
        ".cache",
        ".turbo",
        "logs",
        "tmp",
        ".tmp",
        "coverage",
      ]
        .map((d) => `-not -path "*/${d}/*"`)
        .join(" -and ");
      const cmd = `find "${deployPath}" -type f \\( ${excludeDirs} \\) -printf "%T@\\n" 2>/dev/null | sort -nr | head -n 1`;

      const result = await sshService.exec(serverId, cmd);
      const latestTimestamp = result.stdout.trim();

      if (!latestTimestamp) {
        // Empty folder or error
        return;
      }

      const storedTimestamp = project.lastFolderTimestamp || "";

      if (storedTimestamp && storedTimestamp !== latestTimestamp) {
        console.log(
          `[Polling] Local folder change detected in "${project.name}" (Timestamp: ${latestTimestamp}). Triggering deploy...`,
        );
        project.lastFolderTimestamp = latestTimestamp;
        await project.save();
        await deployService.deploy(project._id.toString(), "webhook");

        // Re-check timestamp after deploy to capture any files modified by the build process
        // This prevents the next poll cycle from seeing build artifacts as "new changes"
        const postDeployResult = await sshService.exec(serverId, cmd);
        const postDeployTimestamp = postDeployResult.stdout.trim();
        if (postDeployTimestamp && postDeployTimestamp !== latestTimestamp) {
          project.lastFolderTimestamp = postDeployTimestamp;
          await project.save();
        }
      } else if (!storedTimestamp) {
        // Initial setup
        project.lastFolderTimestamp = latestTimestamp;
        await project.save();
      }
      return;
    }

    // ======== GIT REPO MONITORING ========
    const branch = project.branch;

    // Check if repo exists on server
    const checkGit = await sshService.exec(
      serverId,
      `if [ -d "${deployPath}/.git" ]; then echo "EXISTS"; else echo "NO_REPO"; fi`,
    );

    if (checkGit.stdout.includes("NO_REPO")) {
      // Repo not cloned yet — skip (user should do first deploy manually)
      return;
    }

    // Get local HEAD commit
    const localResult = await sshService.exec(
      serverId,
      `cd "${deployPath}" && git rev-parse HEAD`,
    );
    const localCommit = localResult.stdout.trim();

    // Fetch remote and get latest commit on the tracked branch
    await sshService.exec(
      serverId,
      `cd "${deployPath}" && git fetch origin ${branch} 2>/dev/null`,
    );

    const remoteResult = await sshService.exec(
      serverId,
      `cd "${deployPath}" && git rev-parse origin/${branch}`,
    );
    const remoteCommit = remoteResult.stdout.trim();

    // Compare: if different, there are new commits → auto-deploy
    if (localCommit && remoteCommit && localCommit !== remoteCommit) {
      console.log(
        `[Polling] New commits detected for "${project.name}" (${localCommit.slice(0, 7)} → ${remoteCommit.slice(0, 7)}). Triggering deploy...`,
      );
      await deployService.deploy(project._id.toString(), "webhook");
    }
  }
}

export default new GitPollingService();
