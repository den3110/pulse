import { Request, Response } from "express";
import SystemSetting from "../models/SystemSetting";
import Settings from "../models/Settings";
import mongoose from "mongoose";
import os from "os";

// Default settings keys and their default values
const DEFAULTS: Record<string, string> = {
  pollingInterval: "60",
  defaultInstallCmd: "npm install",
  defaultBuildCmd: "npm run build",
  defaultStartCmd: "npm start",
  discordWebhook: "",
  notifyOnSuccess: "true",
  notifyOnFailure: "true",
};

export const getSettings = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const settings = await SystemSetting.find();
    const result: Record<string, string> = { ...DEFAULTS };

    settings.forEach((s) => {
      result[s.key] = s.value;
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateSettings = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const updates = req.body;

    const ops = Object.entries(updates).map(([key, value]) => ({
      updateOne: {
        filter: { key },
        update: { key, value: String(value) },
        upsert: true,
      },
    }));

    await SystemSetting.bulkWrite(ops);
    res.json({ message: "Settings updated" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSystemInfo = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [serverCount, projectCount, deploymentCount, autoDeployCount] =
      await Promise.all([
        mongoose.model("Server").countDocuments(),
        mongoose.model("Project").countDocuments(),
        mongoose.model("Deployment").countDocuments(),
        mongoose.model("Project").countDocuments({ autoDeploy: true }),
      ]);

    res.json({
      version: "1.0.0",
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      platform: os.platform(),
      hostname: os.hostname(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      },
      stats: {
        servers: serverCount,
        projects: projectCount,
        deployments: deploymentCount,
        autoDeployProjects: autoDeployCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const clearHistory = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const daysOld = parseInt(req.query.days as string) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await mongoose.model("Deployment").deleteMany({
      createdAt: { $lt: cutoff },
      status: { $in: ["success", "failed", "stopped"] },
    });

    res.json({
      message: `Deleted ${result.deletedCount} deployments older than ${daysOld} days`,
      deletedCount: result.deletedCount,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getNotificationSettings = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json(settings.notifications);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateNotificationSettings = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    // Merge updates
    const updates = req.body;
    if (updates.discord)
      settings.notifications.discord = {
        ...settings.notifications.discord,
        ...updates.discord,
      };
    if (updates.slack)
      settings.notifications.slack = {
        ...settings.notifications.slack,
        ...updates.slack,
      };
    if (updates.telegram)
      settings.notifications.telegram = {
        ...settings.notifications.telegram,
        ...updates.telegram,
      };
    if (updates.events)
      settings.notifications.events = {
        ...settings.notifications.events,
        ...updates.events,
      };

    await settings.save();
    res.json(settings.notifications);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const sendTestNotification = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { type } = req.body; // 'discord' | 'slack' | 'telegram'
    // We could use type to filter, but current service logic sends to all enabled.
    // For now, let's just trigger a generic test event.

    // We can temporarily force enable specific service if needed, but better to rely on saved settings
    // so user knows if their CONFIG is correct.

    await import("../services/notificationService").then((m) =>
      m.default.send("test_notification", {
        title: "Test Notification",
        message:
          "This is a test notification from Deploy Manager to verify your settings.",
        type: "info",
        project: "System Test",
      }),
    );

    res.json({ message: "Test notification sent" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
