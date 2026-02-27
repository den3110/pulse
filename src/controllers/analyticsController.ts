import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Deployment from "../models/Deployment";
import Project from "../models/Project";
import Server from "../models/Server";
import ServerStats from "../models/ServerStats";
import sshService from "../services/sshService";

/**
 * GET /api/analytics/dora
 * DORA Metrics: Deployment Frequency, Lead Time, Change Failure Rate, MTTR
 */
export const getDoraMetrics = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const deployments = await Deployment.find({
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .lean();

    // 1. Deployment Frequency
    const totalDeploys = deployments.length;
    const deployFrequency = days > 0 ? (totalDeploys / days).toFixed(2) : "0";

    // 2. Lead Time for Changes (avg duration from start to finish)
    const completed = deployments.filter(
      (d: any) => d.startedAt && d.finishedAt,
    );
    const avgLeadTimeMs =
      completed.length > 0
        ? completed.reduce((sum: number, d: any) => {
            return (
              sum +
              (new Date(d.finishedAt).getTime() -
                new Date(d.startedAt).getTime())
            );
          }, 0) / completed.length
        : 0;
    const avgLeadTimeMinutes = Math.round(avgLeadTimeMs / 60000);

    // 3. Change Failure Rate
    const failed = deployments.filter((d: any) => d.status === "failed").length;
    const failureRate =
      totalDeploys > 0 ? ((failed / totalDeploys) * 100).toFixed(1) : "0";

    // 4. MTTR (Mean Time to Recovery)
    // Time between a failed deploy and next successful deploy on same project
    const recoveryTimes: number[] = [];
    const groupedByProject = new Map<string, any[]>();
    for (const d of deployments) {
      const key = (d as any).project?.toString() || "unknown";
      if (!groupedByProject.has(key)) groupedByProject.set(key, []);
      groupedByProject.get(key)!.push(d);
    }

    for (const [, projectDeploys] of groupedByProject) {
      const sorted = projectDeploys.sort(
        (a: any, b: any) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].status === "failed") {
          // Find next successful deploy
          for (let j = i + 1; j < sorted.length; j++) {
            if (
              sorted[j].status === "running" ||
              sorted[j].status === "success"
            ) {
              const recovery =
                new Date(sorted[j].createdAt).getTime() -
                new Date(sorted[i].createdAt).getTime();
              recoveryTimes.push(recovery);
              break;
            }
          }
        }
      }
    }

    const avgMttrMs =
      recoveryTimes.length > 0
        ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
        : 0;
    const avgMttrMinutes = Math.round(avgMttrMs / 60000);

    res.json({
      period: days,
      deployFrequency: parseFloat(deployFrequency),
      totalDeploys,
      avgLeadTimeMinutes,
      changeFailureRate: parseFloat(failureRate),
      failedDeploys: failed,
      mttrMinutes: avgMttrMinutes,
      recoveryCount: recoveryTimes.length,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/analytics/heatmap
 * Deploy activity heatmap: hour of day x day of week
 */
export const getDeployHeatmap = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 90;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const deployments = await Deployment.find({
      createdAt: { $gte: since },
    }).lean();

    // Build 7x24 matrix (day of week x hour)
    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0),
    );

    for (const d of deployments) {
      const date = new Date((d as any).createdAt);
      const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
      const hour = date.getHours();
      heatmap[dayOfWeek][hour]++;
    }

    res.json({ heatmap, period: days });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/analytics/trends
 * Deploy trends over time: daily counts
 */
export const getDeployTrends = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const agg = await Deployment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            status: "$status",
          },
          count: { $sum: 1 },
          avgDuration: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$startedAt", false] },
                    { $ifNull: ["$finishedAt", false] },
                  ],
                },
                { $subtract: ["$finishedAt", "$startedAt"] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    // Build daily array
    const trends: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const day = d.toLocaleDateString("en-US", { weekday: "short" });
      const dayData = agg.filter((a: any) => a._id.date === dateStr);
      const success = dayData
        .filter(
          (a: any) => a._id.status === "running" || a._id.status === "success",
        )
        .reduce((s: number, a: any) => s + a.count, 0);
      const failed = dayData
        .filter((a: any) => a._id.status === "failed")
        .reduce((s: number, a: any) => s + a.count, 0);
      const total = dayData.reduce((s: number, a: any) => s + a.count, 0);
      const avgDuration = dayData
        .filter((a: any) => a.avgDuration != null)
        .reduce(
          (s: number, a: any) => s + Math.round((a.avgDuration || 0) / 1000),
          0,
        );

      trends.push({
        date: dateStr,
        day,
        success,
        failed,
        total,
        avgDurationSeconds: total > 0 ? Math.round(avgDuration / total) : 0,
      });
    }

    res.json({ trends, period: days });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/analytics/projects
 * Per-project deployment stats
 */
export const getProjectStats = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const agg = await Deployment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          success: {
            $sum: {
              $cond: [
                {
                  $in: ["$status", ["running", "success"]],
                },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ["$status", "failed"] }, 1, 0],
            },
          },
          avgDuration: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$startedAt", false] },
                    { $ifNull: ["$finishedAt", false] },
                  ],
                },
                { $subtract: ["$finishedAt", "$startedAt"] },
                null,
              ],
            },
          },
          lastDeploy: { $max: "$createdAt" },
        },
      },
    ]);

    // Populate project names
    const projectIds = agg.map((a: any) => a._id).filter(Boolean);
    const projects = await Project.find({ _id: { $in: projectIds } })
      .select("name status")
      .lean();
    const projectMap = new Map(projects.map((p: any) => [p._id.toString(), p]));

    const stats = agg
      .filter((a: any) => a._id && projectMap.has(a._id.toString()))
      .map((a: any) => {
        const project = projectMap.get(a._id.toString());
        return {
          projectId: a._id,
          name: (project as any)?.name || "Unknown",
          status: (project as any)?.status || "unknown",
          total: a.total,
          success: a.success,
          failed: a.failed,
          successRate:
            a.total > 0
              ? parseFloat(((a.success / a.total) * 100).toFixed(1))
              : 0,
          avgDurationSeconds: a.avgDuration
            ? Math.round(a.avgDuration / 1000)
            : 0,
          lastDeploy: a.lastDeploy,
        };
      })
      .sort((a: any, b: any) => b.total - a.total);

    res.json({ stats, period: days });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/analytics/bandwidth
 * Global network statistics across all servers
 */
export const getGlobalBandwidth = async (req: AuthRequest, res: Response) => {
  try {
    const servers = await Server.find({ owner: req.user?._id })
      .select("_id name host status")
      .lean();

    // Get stats from the last 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const stats = await ServerStats.find({
      server: { $in: servers.map((s) => s._id) },
      timestamp: { $gte: oneHourAgo },
    })
      .sort({ timestamp: 1 })
      .lean();

    const result = servers.map((server) => {
      const serverStats = stats.filter(
        (s) => s.server.toString() === server._id.toString(),
      );

      const history = [];
      let currentRx = 0;
      let currentTx = 0;

      for (let i = 1; i < serverStats.length; i++) {
        const prev: any = serverStats[i - 1];
        const curr: any = serverStats[i];

        // Skip if reboot detected (bytes restarted from 0)
        if (curr.rxBytes < prev.rxBytes || curr.txBytes < prev.txBytes) {
          continue;
        }

        const timeDiffSec =
          (new Date(curr.timestamp).getTime() -
            new Date(prev.timestamp).getTime()) /
          1000;

        let rxRate = 0;
        let txRate = 0;
        if (timeDiffSec > 0 && timeDiffSec < 300) {
          // filter out huge gaps
          rxRate = Math.max(0, (curr.rxBytes - prev.rxBytes) / timeDiffSec);
          txRate = Math.max(0, (curr.txBytes - prev.txBytes) / timeDiffSec);
        }

        history.push({
          timestamp: curr.timestamp,
          rxRate,
          txRate,
        });

        currentRx = curr.rxBytes;
        currentTx = curr.txBytes;
      }

      return {
        serverId: server._id,
        name: server.name,
        host: server.host,
        status: server.status,
        currentRx,
        currentTx,
        history,
      };
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
