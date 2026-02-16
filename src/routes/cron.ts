import express from "express";
import { protect as authMiddleware } from "../middleware/auth";
import sshService from "../services/sshService";

const router = express.Router();

// Get cron jobs
router.get("/:serverId", authMiddleware, async (req, res) => {
  try {
    const { serverId } = req.params;
    // crontab -l returns exit code 1 if no crontab for user, so we handle that
    try {
      const result = await sshService.exec(serverId as string, "crontab -l");
      res.json({ jobs: result.stdout });
    } catch (error: any) {
      if (error.message.includes("no crontab for")) {
        res.json({ jobs: "" });
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Save cron jobs
router.post("/:serverId", authMiddleware, async (req, res) => {
  try {
    const { serverId } = req.params;
    const { jobs } = req.body; // Expecting a single string with newlines

    if (typeof jobs !== "string") {
      return res.status(400).json({ message: "Invalid jobs format" });
    }

    // Escape single quotes to prevent breaking the echo command
    // We wrap the echo content in single quotes, so we need to escape existing single quotes
    const escapedJobs = jobs.replace(/'/g, "'\\''");

    const command = `echo '${escapedJobs}' | crontab -`;
    await sshService.exec(serverId as string, command);

    res.json({ message: "Cron jobs updated successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
