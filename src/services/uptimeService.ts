import axios from "axios";
import Project, { IProject } from "../models/Project";
import User from "../models/User";
import { logger } from "../utils/logger";
import { sendHealthAlert } from "./alertService";

class UptimeService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start monitoring for a specific project
   */
  public startMonitoring(project: IProject) {
    if (!project.healthCheck?.enabled || !project.healthCheck?.url) return;

    // Clear any existing interval for this project
    this.stopMonitoring(project._id.toString());

    // Schedule the recurring check
    const intervalMs = (project.healthCheck.interval || 60) * 1000;
    const intervalId = setInterval(
      () => this.checkUrl(project._id.toString()),
      intervalMs,
    );

    this.intervals.set(project._id.toString(), intervalId);
    logger.info(
      `[Uptime] Started monitoring ${project.name} (${project.healthCheck.url}) every ${intervalMs}ms`,
    );

    // Do an immediate check on startup
    this.checkUrl(project._id.toString());
  }

  /**
   * Stop monitoring a project
   */
  public stopMonitoring(projectId: string) {
    if (this.intervals.has(projectId)) {
      clearInterval(this.intervals.get(projectId)!);
      this.intervals.delete(projectId);
      logger.info(`[Uptime] Stopped monitoring project ${projectId}`);
    }
  }

  /**
   * Initialize monitoring for all eligible projects in the DB
   */
  public async initAllMonitors() {
    try {
      const projects = await Project.find({
        "healthCheck.enabled": true,
        "healthCheck.url": { $exists: true, $ne: "" },
      });

      logger.info(
        `[Uptime] Initializing ${projects.length} project monitors...`,
      );
      projects.forEach((project) => this.startMonitoring(project));
    } catch (error) {
      logger.error(`[Uptime] Failed to initialize monitors: ${error}`);
    }
  }

  /**
   * Perform the actual ping check
   */
  private async checkUrl(projectId: string) {
    try {
      const project = await Project.findById(projectId).populate("owner");
      if (!project || !project.healthCheck?.enabled) {
        this.stopMonitoring(projectId);
        return;
      }

      const { url, lastStatus } = project.healthCheck;
      let newStatus: "up" | "down" = "down";
      let errorMsg = "";

      try {
        // Send a HEAD request (or GET if HEAD is not allowed by some servers, but HEAD is lighter)
        const response = await axios.get(url, { timeout: 10000 });
        if (response.status >= 200 && response.status < 400) {
          newStatus = "up";
        } else {
          errorMsg = `HTTP ${response.status} ${response.statusText}`;
        }
      } catch (error: any) {
        newStatus = "down";
        errorMsg = error.message || "Connection refused";
      }

      // If status changed, update DB and trigger alert
      if (lastStatus !== newStatus) {
        logger.info(
          `[Uptime] Status changed for ${project.name}: ${lastStatus} -> ${newStatus}`,
        );

        project.healthCheck.lastStatus = newStatus;
        project.healthCheck.lastChecked = new Date();
        project.healthCheck.errorMessage = newStatus === "down" ? errorMsg : "";
        await project.save();

        this.triggerAlert(project as any, newStatus, errorMsg);
      } else {
        // Just update the lastChecked timestamp
        await Project.updateOne(
          { _id: project._id },
          {
            $set: {
              "healthCheck.lastChecked": new Date(),
              "healthCheck.errorMessage": newStatus === "down" ? errorMsg : "",
            },
          },
        );
      }
    } catch (error) {
      logger.error(`[Uptime] Error checking project ${projectId}: ${error}`);
    }
  }

  /**
   * Trigger notification alerts to Discord/Slack
   */
  private async triggerAlert(
    project: IProject,
    status: "up" | "down",
    errorMsg: string,
  ) {
    try {
      const owner = await User.findById(project.owner).select(
        "+alertPreferences",
      );
      if (!owner || !owner.alertPreferences) return;

      // We use the new dedicated sendHealthAlert method
      await sendHealthAlert(project, status, errorMsg, owner.alertPreferences);
    } catch (error) {
      logger.error(`[Uptime] Failed to send alert: ${error}`);
    }
  }
}

export const uptimeService = new UptimeService();
