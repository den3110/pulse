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

      // Find all projects that have autoDeploy enabled and are not currently deploying
      const projects = await Project.find({
        autoDeploy: true,
        status: {
          $nin: ["deploying", "building", "cloning", "installing", "starting"],
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
        `[GitPolling] New commits detected for "${project.name}" (${localCommit.slice(0, 7)} → ${remoteCommit.slice(0, 7)}). Triggering deploy...`,
      );
      await deployService.deploy(project._id.toString(), "webhook");
    }
  }
}

export default new GitPollingService();
