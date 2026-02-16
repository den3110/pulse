import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import http from "http";
import config from "./config";
import { initSocket } from "./services/socketService";
import schedulerService from "./services/schedulerService";
import gitPollingService from "./services/gitPollingService";
import healthCheckService from "./services/healthCheckService";
import { protect } from "./middleware/auth";

// Routes
import authRoutes from "./routes/auth";
import serverRoutes from "./routes/servers";
import projectRoutes from "./routes/projects";
import deploymentRoutes from "./routes/deployments";
import webhookRoutes from "./routes/webhook";
import settingsRoutes from "./routes/settings";
import nginxRoutes from "./routes/nginx";
import pm2Routes from "./routes/pm2";
import notificationRoutes from "./routes/notifications";
import cronRoutes from "./routes/cron";
import activityRoutes from "./routes/activity";
import adminRoutes from "./routes/admin";
import ftpRoutes from "./routes/ftp";
import databaseRoutes from "./routes/database";

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
initSocket(server);

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      // Allow localhost and local network IPs
      if (
        origin.match(/^http:\/\/localhost/) ||
        origin.match(/^http:\/\/192\.168\./) ||
        origin.match(/^http:\/\/172\./) || // Docker/VPN
        origin === config.clientUrl
      ) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500000,
  message: "Too many requests, please try again later.",
  // Skip rate limiting for webhooks and health checks
  skip: (req) =>
    req.path.startsWith("/api/webhook") || req.path === "/api/health",
});
app.use("/api/", limiter);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/deployments", deploymentRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/nginx", nginxRoutes);
app.use("/api/pm2", pm2Routes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ftp", ftpRoutes);
app.use("/api/database", databaseRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Dashboard stats
app.get("/api/stats", protect, async (_req, res) => {
  try {
    const [serverCount, projectCount, deploymentCount, recentDeployments] =
      await Promise.all([
        mongoose.model("Server").countDocuments(),
        mongoose.model("Project").countDocuments(),
        mongoose.model("Deployment").countDocuments(),
        mongoose
          .model("Deployment")
          .find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("project", "name")
          .populate("server", "name"),
      ]);

    const runningProjects = await mongoose
      .model("Project")
      .countDocuments({ status: "running" });
    const onlineServers = await mongoose
      .model("Server")
      .countDocuments({ status: "online" });

    // F1: Last 7 days deployment chart data
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const chartAgg = await mongoose.model("Deployment").aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Build 7-day array
    const deployChart = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const day = d.toLocaleDateString("en-US", { weekday: "short" });
      const success = chartAgg
        .filter(
          (a: any) => a._id.date === dateStr && a._id.status === "running",
        )
        .reduce((s: number, a: any) => s + a.count, 0);
      const failed = chartAgg
        .filter((a: any) => a._id.date === dateStr && a._id.status === "failed")
        .reduce((s: number, a: any) => s + a.count, 0);
      const total = chartAgg
        .filter((a: any) => a._id.date === dateStr)
        .reduce((s: number, a: any) => s + a.count, 0);
      deployChart.push({ date: dateStr, day, success, failed, total });
    }

    res.json({
      servers: { total: serverCount, online: onlineServers },
      projects: { total: projectCount, running: runningProjects },
      deployments: { total: deploymentCount },
      recentDeployments,
      deployChart,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Error handling middleware
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[Error]", err);
    res.status(err.status || 500).json({
      message: err.message || "Internal Server Error",
    });
  },
);

// Connect to MongoDB and start server
const start = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log("[MongoDB] Connected successfully");

    // Initialize scheduler
    schedulerService.init();

    // Start git polling for auto-deploy (check every 60 seconds)
    gitPollingService.start(60_000);

    // Initialize health checks for running projects
    await healthCheckService.init();

    server.listen(config.port, () => {
      console.log(`[Server] Running on port ${config.port}`);
      console.log(`[Server] Client URL: ${config.clientUrl}`);
    });
  } catch (error) {
    console.error("[MongoDB] Connection failed:", error);
    process.exit(1);
  }
};

start();

export default app;

// Trigger restart for env update
