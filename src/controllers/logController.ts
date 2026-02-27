import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Server from "../models/Server";
import sshService from "../services/sshService";

/**
 * GET /api/logs/stream
 * Stream logs from a specific server and service
 * Query params: serverId, type (docker|pm2|nginx|syslog|auth), target (containerName/pm2Name/empty)
 */
export const streamLogs = async (req: AuthRequest, res: Response) => {
  const { serverId, type, target } = req.query;

  if (!serverId || !type) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  // Setup SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // flush the headers to establish SSE

  const sendLog = (line: string) => {
    res.write(`data: ${JSON.stringify({ content: line })}\n\n`);
  };

  const sendError = (err: string) => {
    res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
  };

  try {
    const server = await Server.findOne({
      _id: serverId,
      owner: req.user?._id,
    });
    if (!server) {
      sendError("Server not found");
      return res.end();
    }

    let command = "";
    if (type === "docker") {
      if (!target) {
        sendError("Target container name is required for docker logs");
        return res.end();
      }
      command = `docker logs -f --tail 100 ${target}`;
    } else if (type === "pm2") {
      if (!target) {
        sendError("Target process name is required for PM2 logs");
        return res.end();
      }
      command = `pm2 logs ${target} --raw --lines 100`;
    } else if (type === "nginx") {
      command = `tail -f -n 100 /var/log/nginx/error.log /var/log/nginx/access.log`;
    } else if (type === "syslog") {
      command = `tail -f -n 100 /var/log/syslog`;
    } else if (type === "auth") {
      command = `tail -f -n 100 /var/log/auth.log`;
    } else {
      sendError("Invalid log type");
      return res.end();
    }

    // Execute streaming command
    const killStream = await sshService.streamCommand(
      server.id,
      command,
      (data, streamType) => {
        const lines = data.split("\n");
        for (const line of lines) {
          if (line) {
            if (
              streamType === "stderr" &&
              !type.toString().includes("docker")
            ) {
              // Docker outputs normal logs to stderr sometimes, so we don't always label it error
              sendLog(`[ERROR] ${line}`);
            } else {
              sendLog(line);
            }
          }
        }
      },
      () => {
        // if command exits naturally
        res.write("event: close\ndata: stream ended\n\n");
        res.end();
      },
    );

    // Handle client disconnect to avoid zombie SSH connections
    req.on("close", () => {
      // Kill the ssh connection and tail process stream early
      killStream();
      res.end();
    });
  } catch (err: any) {
    sendError(`Connection failed: ${err.message}`);
    res.end();
  }
};
