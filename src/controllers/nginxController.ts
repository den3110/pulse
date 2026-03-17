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

export const testConfigFile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await nginxService.testConfigFile(
      req.params.serverId as string,
      req.params.name as string,
    );
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

export const generateAndSaveConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { blocks, ...singleBlock } = req.body;

    // Support both single block (legacy) and multi-block array
    const configBlocks =
      blocks && Array.isArray(blocks) && blocks.length > 0
        ? blocks
        : [singleBlock];

    // Validate each block
    for (const block of configBlocks) {
      const { domains, type = "proxy", proxyPass, rootPath } = block;
      if (!domains || !domains.length) {
        res
          .status(400)
          .json({ message: "At least one domain is required per block" });
        return;
      }
      if (type === "proxy" && !proxyPass) {
        res.status(400).json({
          message: `Proxy Pass URL is required for "${domains.join(", ")}"`,
        });
        return;
      }
      if (type === "static" && !rootPath) {
        res.status(400).json({
          message: `Root Path is required for "${domains.join(", ")}"`,
        });
        return;
      }
    }

    const configContent = nginxService.generateMultiConfig(configBlocks);

    // Use the first domain of the first block as the config filename
    const firstDomains = configBlocks[0].domains;
    const filename = firstDomains[0].replace(/[^a-zA-Z0-9.-]/g, "");

    const result = await nginxService.saveAndReload(
      req.params.serverId as string,
      filename,
      configContent,
    );
    res.json(result);

    logActivity({
      action: "nginx.generate",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Generated Nginx config (${configBlocks.length} block${configBlocks.length > 1 ? "s" : ""}) for ${firstDomains.join(", ")}`,
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
      res.status(400).json({ message: "Domain and email are required" });
      return;
    }

    const { default: sslService } = await import("../services/sslService");
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
    const { default: sslService } = await import("../services/sslService");
    const result = await sslService.listCertificates(
      req.params.serverId as string,
    );
    res.json({ output: result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const checkNginxInstalled = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await nginxService.checkNginxInstalled(
      req.params.serverId as string,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const installNginx = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await nginxService.installNginx(
      req.params.serverId as string,
      (line: string) => {
        res.write(`data: ${JSON.stringify({ line })}\n\n`);
      },
    );
    res.write(
      `event: complete\ndata: ${JSON.stringify({ message: "Nginx installed successfully" })}\n\n`,
    );

    logActivity({
      action: "nginx.install",
      userId: req.user?._id.toString(),
      team: req.user?.currentTeam?.toString(),
      username: req.user?.username,
      details: `Installed Nginx on server`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
    );
  } finally {
    res.end();
  }
};
