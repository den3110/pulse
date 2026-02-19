import { Response } from "express";
import Server from "../models/Server";
import ServerStat from "../models/ServerStat";
import Project from "../models/Project";
import sshService from "../services/sshService";
import { AuthRequest } from "../middleware/auth";
import { logActivity } from "../services/activityLogger";

export const listServers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const servers = await Server.find({ owner: req.user?._id }).sort({
      createdAt: -1,
    });
    res.json(servers);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getServer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }
    res.json(server);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createServer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      name,
      host,
      port,
      username,
      authType,
      password,
      privateKey,
      passphrase,
    } = req.body;

    const server = await Server.create({
      name,
      host,
      port: port || 22,
      username,
      authType: authType || "password",
      password,
      privateKey,
      passphrase,
      owner: req.user?._id,
    });

    res.status(201).json(server);
    logActivity({
      action: "server.create",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Created server ${name} (${host})`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateServer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      name,
      host,
      port,
      username,
      authType,
      password,
      privateKey,
      passphrase,
    } = req.body;
    const server = await Server.findOneAndUpdate(
      { _id: req.params.id, owner: req.user?._id },
      {
        name,
        host,
        port,
        username,
        authType,
        password,
        privateKey,
        passphrase,
      },
      { new: true, runValidators: true },
    );

    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    res.json(server);
    logActivity({
      action: "server.update",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Updated server ${server.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteServer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const server = await Server.findOneAndDelete({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }
    res.json({ message: "Server deleted successfully" });
    logActivity({
      action: "server.delete",
      userId: req.user?._id.toString(),
      username: req.user?.username,
      details: `Deleted server ${server.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const testConnection = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const result = await sshService.testConnection(req.params.id as string);

    // Update server status
    await Server.findByIdAndUpdate(req.params.id as string, {
      status: result.success ? "online" : "offline",
      lastCheckedAt: new Date(),
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getProjects = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const projects = await Project.find({
      server: req.params.id,
      owner: req.user?._id,
    }).select("name repoUrl branch deployPath status");
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getStats = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const stats = await sshService.getSystemStats(req.params.id as string);

    // Persist stats asynchronously (fire and forget)
    ServerStat.create({
      server: server._id,
      cpuUsage: stats.cpuUsage,
      memoryUsage: stats.memoryUsage,
      diskUsage: stats.diskUsage,
    }).catch((err) => console.error("Failed to save server stats:", err));

    // Fetch history (last 20 points)
    const history = await ServerStat.find({ server: server._id })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    // Determine latest stat for "current" values if SSH failed?
    // Actually getSystemStats throws if it fails, so we have live data.

    res.json({
      stats,
      history: history.reverse(), // Send chronological order
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const execCommand = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const { command, timeout } = req.body;
    if (!command) {
      res.status(400).json({ message: "Command is required" });
      return;
    }

    const result = await sshService.exec(
      req.params.id as string,
      command,
      timeout,
      { pty: true },
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getStatsHistory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const serverId = req.params.id;
    // Verify ownership
    const server = await Server.findOne({
      _id: serverId,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const history = await ServerStat.find({ server: serverId })
      .sort({ timestamp: -1 })
      .limit(30);

    console.log(
      `[getStatsHistory] Found ${history.length} records for server ${serverId}`,
    );

    // Return in ascending order for charts
    res.json(history.reverse());
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
