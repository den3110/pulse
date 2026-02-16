import cron from "node-cron";
import Project from "../models/Project";
import sshService from "./sshService";
import Server from "../models/Server";
import ServerStats from "../models/ServerStats";
import { emitServerStats } from "./socketService";

class SchedulerService {
  /**
   * Initialize all scheduled tasks
   */
  init(): void {
    // Health check every 5 minutes
    cron.schedule("*/5 * * * *", () => {
      this.healthCheckAllServers();
    });

    // Clean old deployment logs every day at midnight
    cron.schedule("0 0 * * *", () => {
      this.cleanOldLogs();
    });

    // Check scheduled deploys every minute
    cron.schedule("* * * * *", () => {
      this.checkScheduledDeploys();
    });

    // Realtime stats every 10 seconds
    setInterval(() => {
      this.collectRealtimeStats();
    }, 10000);

    console.log("[Scheduler] Scheduled tasks initialized");
  }

  /**
   * Collect realtime stats for online servers
   */
  async collectRealtimeStats(): Promise<void> {
    try {
      const servers = await Server.find({ status: "online" });
      for (const server of servers) {
        // Run in background, don't await loop
        sshService
          .getSystemStats(server._id.toString())
          .then(async (stats) => {
            emitServerStats(server._id.toString(), stats);

            // Persist stats
            try {
              await ServerStats.create({
                server: server._id,
                cpu: stats.cpuUsage || 0,
                memory: stats.memoryUsage || 0,
                disk: stats.diskUsage || 0,
                timestamp: new Date(),
              });
            } catch (err) {
              console.error("[Scheduler] Failed to save stats:", err);
            }
          })
          .catch(() => {
            // Ignore errors for stats
          });
      }
    } catch (error) {
      console.error("[Scheduler] Realtime stats failed:", error);
    }
  }

  /**
   * Check health of all servers
   */
  async healthCheckAllServers(): Promise<void> {
    try {
      const servers = await Server.find();
      for (const server of servers) {
        try {
          const result = await sshService.testConnection(server._id.toString());
          const status = result.success ? "online" : "offline";
          await this.handleServerStatusChange(server, status);

          if (result.success) {
            try {
              const stats = await sshService.getSystemStats(
                server._id.toString(),
              );
              emitServerStats(server._id.toString(), stats);
            } catch (e) {
              // Stats collection failed, but server is still online
            }
          }
        } catch (e) {
          await this.handleServerStatusChange(server, "offline");
        }
      }
    } catch (error) {
      console.error("[Scheduler] Health check failed:", error);
    }
  }

  private async handleServerStatusChange(
    server: any,
    status: "online" | "offline",
  ) {
    // Only notify if status changed
    if (server.status === status) return;

    // Save new status
    await Server.findByIdAndUpdate(server._id, {
      status,
      lastCheckedAt: new Date(),
    });

    // Notify
    const notificationService = (await import("./notificationService")).default;
    await notificationService.send(
      status === "online" ? "server_online" : "server_offline",
      {
        title:
          status === "online"
            ? `✅ Server Online: ${server.name}`
            : `🚨 Server Offline: ${server.name}`,
        message:
          status === "online"
            ? `Server ${server.name} (${server.host}) is back online.`
            : `Server ${server.name} (${server.host}) is unreachable.`,
        type: status === "online" ? "success" : "error",
        fields: [
          { name: "Server", value: server.name, inline: true },
          { name: "Host", value: server.host, inline: true },
        ],
      },
    );
  }

  /**
   * Clean deployment logs older than 30 days
   */
  async cleanOldLogs(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { deletedCount } = await (
        await import("../models/Deployment")
      ).default.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        status: { $in: ["failed", "stopped"] },
      });

      console.log(`[Scheduler] Cleaned ${deletedCount} old deployment logs`);
    } catch (error) {
      console.error("[Scheduler] Log cleanup failed:", error);
    }
  }

  /**
   * Check for and trigger scheduled deploys
   */
  async checkScheduledDeploys(): Promise<void> {
    try {
      const now = new Date();
      const projects = await Project.find({
        scheduledDeployAt: { $lte: now, $ne: null },
      });

      for (const project of projects) {
        try {
          console.log(
            `[Scheduler] Triggering scheduled deploy for ${project.name}`,
          );

          // Clear scheduled time first to prevent re-triggering
          await Project.findByIdAndUpdate(project._id, {
            scheduledDeployAt: null,
          });

          // Trigger deploy
          const deployService = (await import("./deployService")).default;
          await deployService.deploy(
            project._id.toString(),
            "schedule",
            project.owner.toString(),
          );
        } catch (err: any) {
          console.error(
            `[Scheduler] Scheduled deploy failed for ${project.name}:`,
            err.message,
          );
        }
      }
    } catch (error) {
      console.error("[Scheduler] Scheduled deploy check failed:", error);
    }
  }
}

export default new SchedulerService();
