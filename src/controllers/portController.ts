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

export const getFirewallStatus = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const fwStatus = await portService.getFirewallStatus(serverId);
    res.json(fwStatus);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const manageFirewall = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { port, protocol, action } = req.body;

    if (!port || !protocol || !action) {
      return res
        .status(400)
        .json({ message: "Port, protocol, and action are required" });
    }

    if (action !== "allow" && action !== "deny") {
      return res
        .status(400)
        .json({ message: "Action must be 'allow' or 'deny'" });
    }

    if (protocol !== "tcp" && protocol !== "udp") {
      return res
        .status(400)
        .json({ message: "Protocol must be 'tcp' or 'udp'" });
    }

    await portService.manageFirewallRule(serverId, port, protocol, action);
    res.json({
      message: `Successfully executed ufw ${action} ${port}/${protocol}`,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
