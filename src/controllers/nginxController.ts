import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import nginxService from "../services/nginxService";

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
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
