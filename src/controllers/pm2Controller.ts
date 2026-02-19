import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import pm2Service from "../services/pm2Service";
import { emitPM2Processes } from "../services/socketService";

// Helper: fetch fresh process list and emit via socket
const emitRefresh = async (serverId: string) => {
  try {
    const processes = await pm2Service.list(serverId);
    emitPM2Processes(serverId, processes);
  } catch {}
};

export const listProcesses = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const processes = await pm2Service.list(req.params.serverId as string);
    res.json(processes);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const startProcess = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      script,
      name,
      interpreter,
      instances,
      cwd,
      args,
      envVars,
      maxMemory,
      cron,
      watch,
    } = req.body;
    if (!script) {
      res.status(400).json({ message: "Script is required" });
      return;
    }
    const result = await pm2Service.start(
      req.params.serverId as string,
      script,
      name,
      { interpreter, instances, cwd, args, envVars, maxMemory, cron, watch },
    );
    res.json(result);
    // Emit updated list to all connected clients
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const stopProcess = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.stop(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json(result);
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const restartProcess = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.restart(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json(result);
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const reloadProcess = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.reload(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json(result);
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteProcess = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.deleteProcess(
      req.params.serverId as string,
      req.params.name as string,
    );
    res.json(result);
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const lines = parseInt(req.query.lines as string) || 50;
    const result = await pm2Service.logs(
      req.params.serverId as string,
      req.params.name as string,
      Math.min(lines, 500),
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const flushLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.flush(
      req.params.serverId as string,
      req.params.name ? (req.params.name as string) : undefined,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const save = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pm2Service.save(req.params.serverId as string);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const startup = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.startup(req.params.serverId as string);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const restartAll = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.restartAll(req.params.serverId as string);
    res.json(result);
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const stopAll = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await pm2Service.stopAll(req.params.serverId as string);
    res.json(result);
    emitRefresh(req.params.serverId as string);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const streamLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { serverId, name } = req.params;

  // SSE Headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const stream = await pm2Service.streamLogs(
      serverId as string,
      name as string,
    );

    // Forward logs to client
    stream.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      lines.forEach((line) => {
        if (line.trim()) {
          res.write(`data: ${JSON.stringify({ log: line })}\n\n`);
        }
      });
    });

    stream.on("error", (err: any) => {
      res.write(
        `data: ${JSON.stringify({ log: `Error: ${err.message}`, type: "error" })}\n\n`,
      );
      res.end();
    });

    stream.on("close", () => {
      res.end();
    });

    // Cleanup on client disconnect
    req.on("close", () => {
      stream.end(); // Close SSH connection
    });
  } catch (error: any) {
    res.write(
      `data: ${JSON.stringify({ log: `Failed to start stream: ${error.message}`, type: "error" })}\n\n`,
    );
    res.end();
  }
};
