import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import nginxService from "../services/nginxService";
import { logActivity } from "../services/activityLogger";

export const listConfigs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const configs = await nginxService.listConfigs(
      req.params.serverId as string,
    );
    res.json(configs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const content = await nginxService.getConfig(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const saveConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    await nginxService.saveConfig(
      req.params.serverId as string,
      req.params.name as string,
      req.body.content,
    );
    res.json({ message: "Config saved" });

    logActivity({
      action: "nginx.update",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Saved Nginx config ${req.params.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    await nginxService.deleteConfig(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json({ message: "Config deleted" });

    logActivity({
      action: "nginx.update",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Deleted Nginx config ${req.params.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const enableConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    await nginxService.enableConfig(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json({ message: "Config enabled" });

    logActivity({
      action: "nginx.update",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Enabled Nginx config ${req.params.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const disableConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    await nginxService.disableConfig(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json({ message: "Config disabled" });

    logActivity({
      action: "nginx.update",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Disabled Nginx config ${req.params.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const testConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await nginxService.testConfig(req.params.serverId as string);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const reloadNginx = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await nginxService.reloadNginx(
      req.params.serverId as string,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getNginxStatus = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await nginxService.getNginxStatus(
      req.params.serverId as string,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const logType = req.params.type as "access" | "error";
    if (logType !== "access" && logType !== "error") {
      res.status(400).json({ message: "Invalid log type" });
      return;
    }
    const lines = parseInt(req.query.lines as string) || 50;
    const content = await nginxService.getLog(
      req.params.serverId as string,
      logType,
      Math.min(lines, 500),
    );
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const saveAndReload = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await nginxService.saveAndReload(
      req.params.serverId as string,
      req.params.name as string,
      req.body.content,
    );
    res.json(result);

    logActivity({
      action: "nginx.update",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Saved and reloaded Nginx config ${req.params.name}`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};


export const provisionSsl = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { domain, email } = req.body;
    if (!domain || !email) {
      res.status(400).json({ message: 'Domain and email are required' });
      return;
    }

    const { default: sslService } = await import('../services/sslService');
    const result = await sslService.provisionSsl(
      req.params.serverId as string,
      domain,
      email,
      req.user!._id.toString(),
      req.user!.currentTeam?.toString(),
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const listCertificates = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { default: sslService } = await import('../services/sslService');
    const result = await sslService.listCertificates(
      req.params.serverId as string,
    );
    res.json({ output: result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

