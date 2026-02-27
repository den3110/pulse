import cron from "node-cron";
import { BackupSchedule } from "../models/BackupSchedule";
import databaseService from "./databaseService";
import sftpService from "./sftpService";
import s3StorageService from "./s3StorageService";
import path from "path";

class BackupScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();

  /**
   * Initialize and load all active schedules from the DB.
   */
  async init() {
    console.log("[BackupScheduler] Initializing automated backups...");
    try {
      const schedules = await BackupSchedule.find({ status: "active" });
      for (const schedule of schedules) {
        this.scheduleJob(schedule);
      }
      console.log(
        `[BackupScheduler] Scheduled ${schedules.length} active backup tasks.`,
      );
    } catch (error) {
      console.error("[BackupScheduler] Failed to initialize schedules:", error);
    }
  }

  /**
   * Add or update a schedule.
   */
  scheduleJob(scheduleDoc: any) {
    const id = scheduleDoc._id.toString();

    // Clear existing job if it exists
    this.cancelJob(id);

    // Validate cron expression
    if (!cron.validate(scheduleDoc.schedule)) {
      console.error(
        `[BackupScheduler] Invalid cron expression for schedule ${id}: ${scheduleDoc.schedule}`,
      );
      return;
    }

    const task = cron.schedule(scheduleDoc.schedule, async () => {
      console.log(
        `[BackupScheduler] Triggering scheduled backup for ${id} (Container: ${scheduleDoc.containerId})`,
      );

      try {
        // Trigger the backup
        const result = await databaseService.backup(
          scheduleDoc.server.toString(),
          scheduleDoc.containerId,
          scheduleDoc.dbType,
          scheduleDoc.dbName || "",
          scheduleDoc.dbUser || "",
          scheduleDoc.dbPassword || "",
        );

        // Upload to S3 if configured
        if (result && result.filename) {
          try {
            const serverId = scheduleDoc.server.toString();
            // Download the backup from SFTP to local buffer first
            const remotePath = `/root/pulse_backups/${result.filename}`; // default path in databaseService
            const fileBuffer = await sftpService.downloadFile(
              serverId,
              remotePath,
            );

            const localTempPath = path.join("/tmp", result.filename);
            const fs = await import("fs");

            // Write buffer to temp file for AWS SDK
            fs.writeFileSync(localTempPath, fileBuffer);

            const s3Key = `backups/${serverId}/${scheduleDoc.containerId}/${result.filename}`;
            const s3Uploaded = await s3StorageService.uploadFile(
              localTempPath,
              s3Key,
            );

            if (s3Uploaded) {
              console.log(
                `[BackupScheduler] Successfully offloaded ${result.filename} to S3.`,
              );
            }
            // Clean up local temp file
            try {
              if (fs.existsSync(localTempPath)) {
                fs.unlinkSync(localTempPath);
              }
            } catch (e) {}
          } catch (s3Error) {
            console.error(
              `[BackupScheduler] S3 Upload or Download failed for ${result.filename}:`,
              s3Error,
            );
            // We don't fail the whole backup track if S3/download fails, but we log it.
          }
        }

        // Update successful status
        await BackupSchedule.findByIdAndUpdate(id, {
          lastRun: new Date(),
          lastStatus: "success",
          lastError: "",
        });

        // Enforce retention policy
        await this.enforceRetention(
          scheduleDoc.server.toString(),
          scheduleDoc.containerId,
          scheduleDoc.retentionDays,
        );
      } catch (error: any) {
        console.error(
          `[BackupScheduler] Backup failed for schedule ${id}:`,
          error,
        );
        await BackupSchedule.findByIdAndUpdate(id, {
          lastRun: new Date(),
          lastStatus: "failed",
          lastError: error.message || "Unknown error",
        });
      }
    });

    this.tasks.set(id, task);
  }

  /**
   * Cancel a running schedule job.
   */
  cancelJob(scheduleId: string) {
    const existingTask = this.tasks.get(scheduleId);
    if (existingTask) {
      existingTask.stop();
      this.tasks.delete(scheduleId);
    }
  }

  /**
   * Ensure that only `retentionDays` amount of backups remain for a given container.
   * This retrieves all backups from SFTP, sorts them by date, and deletes the oldest.
   */
  private async enforceRetention(
    serverId: string,
    containerId: string,
    retentionDays: number,
  ) {
    try {
      // Use existing method to list backups
      const backups = await databaseService.listBackups(serverId);

      // Ensure that only `retentionDays` amount of backups remain for a given container.
      // This retrieves all backups from SFTP, sorts them by date, and deletes the oldest.
      // E.g. backup filename format: db_backup_CONTAINERID_TIMESTAMP.something
      const containerBackups = backups.filter((b: any) =>
        b.filename.includes(containerId),
      );

      if (containerBackups.length <= retentionDays) {
        return; // Nothing to delete
      }

      // Sort by date descending (newest first)
      containerBackups.sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      // Backups to delete
      const toDelete = containerBackups.slice(retentionDays);

      for (const oldBackup of toDelete) {
        console.log(
          `[BackupScheduler] Deleting old backup due to retention policy: ${oldBackup.filename}`,
        );
        await databaseService.deleteBackup(serverId, oldBackup.filename);
      }
    } catch (error) {
      console.error(
        `[BackupScheduler] Error enforcing retention for server ${serverId}:`,
        error,
      );
    }
  }
}

export default new BackupScheduler();
