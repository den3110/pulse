import { Request, Response } from "express";
import portService from "../services/portService";

export const listPorts = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const ports = await portService.listOpenPorts(serverId);
    res.json(ports);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const killProcess = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const pid = req.params.pid as string;
    await portService.killProcess(serverId, pid);
    res.json({ message: `Process ${pid} killed successfully` });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getProcessDetails = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const pid = req.params.pid as string;
    const details = await portService.getProcessDetails(serverId, pid);
    if (!details) {
      return res.status(404).json({ message: "Process not found" });
    }
    res.json(details);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
