import Project from "../models/Project";
import { emitDeployLog } from "./socketService";

class HealthCheckService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Initialize health checks for all running projects
   */
  async init(): Promise<void> {
    const projects = await Project.find({
      status: "running",
      healthCheckUrl: { $ne: "" },
    });

    for (const project of projects) {
      this.startChecking(project._id.toString());
    }

    console.log(`[HealthCheck] Initialized for ${projects.length} projects`);
  }

  /**
   * Start periodic health checking for a project
   */
  async startChecking(projectId: string): Promise<void> {
    // Clear existing interval if any
    this.stopChecking(projectId);

    const project = await Project.findById(projectId);
    if (!project || !project.healthCheckUrl) return;

    const intervalMs = (project.healthCheckInterval || 60) * 1000;

    // Do an immediate check
    await this.check(projectId);

    // Set up periodic checks
    const interval = setInterval(() => {
      this.check(projectId);
    }, intervalMs);

    this.intervals.set(projectId, interval);
  }

  /**
   * Stop health checking for a project
   */
  stopChecking(projectId: string): void {
    const existing = this.intervals.get(projectId);
    if (existing) {
      clearInterval(existing);
      this.intervals.delete(projectId);
    }
  }

  /**
   * Perform a single health check
   */
  async check(projectId: string): Promise<void> {
    const project = await Project.findById(projectId);
    if (!project || !project.healthCheckUrl) return;

    const start = Date.now();
    let status: "healthy" | "unhealthy" = "unhealthy";
    let responseTime = 0;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(project.healthCheckUrl, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      responseTime = Date.now() - start;
      status = response.ok ? "healthy" : "unhealthy";
    } catch {
      responseTime = Date.now() - start;
      status = "unhealthy";
    }

    const prevStatus = project.lastHealthCheck?.status;

    await Project.findByIdAndUpdate(projectId, {
      lastHealthCheck: {
        status,
        checkedAt: new Date(),
        responseTime,
      },
    });

    // Notify if status changed
    if (prevStatus && prevStatus !== status) {
      const emoji = status === "healthy" ? "🟢" : "🔴";
      console.log(
        `[HealthCheck] ${emoji} ${project.name}: ${prevStatus} → ${status} (${responseTime}ms)`,
      );
    }
  }
}

export default new HealthCheckService();
