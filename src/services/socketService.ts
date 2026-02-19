import { Server as IOServer } from "socket.io";
import jwt from "jsonwebtoken";
import config from "../config";
import Deployment from "../models/Deployment";
import sshService from "./sshService";
import { sendSSE } from "./sseService";

let io: IOServer;
const terminalStreams = new Map<string, any>();

export const initSocket = (server: any): IOServer => {
  io = new IOServer(server, {
    cors: {
      origin: [config.clientUrl, ...config.allowedOrigins],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error"));
    }
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { id: string };
      (socket as any).userId = decoded.id;
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on("join:deployment", (deploymentId: string) => {
      socket.join(`deployment:${deploymentId}`);
      console.log(`[Socket] ${socket.id} joined deployment:${deploymentId}`);
    });

    socket.on("leave:deployment", (deploymentId: string) => {
      socket.leave(`deployment:${deploymentId}`);
    });

    socket.on("join:project", (projectId: string) => {
      socket.join(`project:${projectId}`);
      console.log(`[Socket] ${socket.id} joined project:${projectId}`);
    });

    socket.on("leave:project", (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on("join:server", (serverId: string) => {
      socket.join(`server:${serverId}`);
      console.log(`[Socket] ${socket.id} joined server:${serverId}`);
    });

    socket.on("leave:server", (serverId: string) => {
      socket.leave(`server:${serverId}`);
    });

    socket.on("join:pm2", (serverId: string) => {
      socket.join(`pm2:${serverId}`);
      console.log(`[Socket] ${socket.id} joined pm2:${serverId}`);
    });

    socket.on("leave:pm2", (serverId: string) => {
      socket.leave(`pm2:${serverId}`);
    });

    // Join user-specific room for notifications
    if ((socket as any).userId) {
      const userId = (socket as any).userId;
      socket.join(`user:${userId}`);
      console.log(`[Socket] ${socket.id} joined user:${userId}`);
    }

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      // Clean up any active terminal sessions for this socket
      // Clean up any active terminal sessions for this socket
      if (terminalStreams.has(socket.id)) {
        const clientStreams = terminalStreams.get(socket.id);
        clientStreams.forEach((stream: any) => stream.end());
        clientStreams.clear();
        terminalStreams.delete(socket.id);
      }
    });

    // --- Terminal Events ---

    socket.on("terminal:start", async ({ serverId, termId, rows, cols }) => {
      try {
        // Initialize map for this socket if needed
        if (!terminalStreams.has(socket.id)) {
          terminalStreams.set(socket.id, new Map<number, any>());
        }
        const clientStreams = terminalStreams.get(socket.id);

        // Clean up existing session for this specific prompt IF it exists
        // (This handles refreshing the tab or re-mounting same termId)
        if (clientStreams.has(termId)) {
          const stream = clientStreams.get(termId);
          // IMPORTANT: Remove listeners to prevent "close" event from emitting "terminal:exit"
          // because we are intentionally replacing this session.
          stream.removeAllListeners("close");
          stream.end();
          clientStreams.delete(termId);
        }

        const stream = await sshService.createShell(serverId, { rows, cols });
        clientStreams.set(termId, stream);

        // Notify client that terminal is ready for input
        socket.emit("terminal:ready", { termId });

        stream.on("data", (data: Buffer) => {
          socket.emit("terminal:output", {
            termId,
            data: data.toString("utf-8"),
          });
        });

        stream.on(
          "exit",
          (code: any, signal: any, coreDump: any, desc: any) => {
            let msg = `\r\n\x1b[33m[Process completed`;
            if (code !== undefined) msg += ` with code ${code}`;
            if (signal) msg += ` (Signal: ${signal})`;
            if (desc) msg += ` - ${desc}`;
            msg += `]\x1b[0m\r\n`;

            socket.emit("terminal:output", {
              termId,
              data: msg,
            });
          },
        );

        stream.on("error", (err: any) => {
          socket.emit("terminal:output", {
            termId,
            data: `\r\n\x1b[31m[Error: ${err.message}]\x1b[0m\r\n`,
          });
        });

        stream.on("close", () => {
          socket.emit("terminal:exit", { termId });
          if (terminalStreams.has(socket.id)) {
            terminalStreams.get(socket.id).delete(termId);
          }
        });
      } catch (error: any) {
        socket.emit("terminal:output", {
          termId,
          data: `\r\nConnection failed: ${error.message}\r\n`,
        });
      }
    });

    socket.on("terminal:data", ({ termId, data }) => {
      if (terminalStreams.has(socket.id)) {
        const clientStreams = terminalStreams.get(socket.id);
        if (clientStreams.has(termId)) {
          clientStreams.get(termId).write(data);
        }
      }
    });

    socket.on("terminal:resize", ({ termId, rows, cols }) => {
      if (terminalStreams.has(socket.id)) {
        const clientStreams = terminalStreams.get(socket.id);
        if (clientStreams.has(termId)) {
          clientStreams.get(termId).setWindow(rows, cols, 0, 0);
        }
      }
    });

    socket.on("terminal:close", ({ termId }) => {
      if (terminalStreams.has(socket.id)) {
        const clientStreams = terminalStreams.get(socket.id);
        if (clientStreams.has(termId)) {
          const stream = clientStreams.get(termId);
          stream.removeAllListeners("close"); // No need to notify client of exit if client requested close
          stream.end();
          clientStreams.delete(termId);
        }
      }
    });
  });

  return io;
};

export const getIO = (): IOServer => {
  if (!io) {
    throw new Error("Socket.IO not initialized");
  }
  return io;
};

export const emitDeployLog = (
  deploymentId: string,
  log: string,
  type: "info" | "error" | "success" | "warning" = "info",
  projectId?: string,
) => {
  const timestamp = new Date().toISOString();
  const data = {
    deploymentId,
    log,
    type,
    projectId,
    timestamp,
  };

  // Emit via Socket.IO
  if (io) {
    io.to(`deployment:${deploymentId}`).emit("deployment:log", data);
    if (projectId) {
      io.to(`project:${projectId}`).emit("deployment:log", data);
    }
  }

  // Emit via SSE
  if (projectId) {
    sendSSE(projectId, "log", data);
  }

  // Persist to database (save as structured object with timestamp)
  Deployment.findByIdAndUpdate(deploymentId, {
    $push: { logs: { log, type, timestamp } },
  }).catch(() => {});
};

export const emitDeployStatus = (
  deploymentId: string,
  status: string,
  projectId?: string,
) => {
  const data = {
    deploymentId,
    status,
    projectId,
    timestamp: new Date().toISOString(),
  };

  // Emit via Socket.IO
  if (io) {
    io.to(`deployment:${deploymentId}`).emit("deployment:status", data);
    if (projectId) {
      io.to(`project:${projectId}`).emit("deployment:status", data);
    }
  }

  // Emit via SSE
  if (projectId) {
    sendSSE(projectId, "status", data);
  }
};

export const emitServerStats = (serverId: string, stats: any) => {
  if (io) {
    io.to(`server:${serverId}`).emit("server:stats", {
      serverId,
      stats,
      timestamp: new Date().toISOString(),
    });
  }
};

export const emitPM2Processes = (serverId: string, processes: any[]) => {
  if (io) {
    io.to(`pm2:${serverId}`).emit("pm2:processes", {
      serverId,
      processes,
      timestamp: new Date().toISOString(),
    });
  }
};

export const emitNotification = (userId: string, notification: any) => {
  if (io) {
    io.to(`user:${userId}`).emit("notification:new", notification);
  }
};
