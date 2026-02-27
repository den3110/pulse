import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Server from "../models/Server";
import Project from "../models/Project";
import Deployment from "../models/Deployment";
import sshService from "../services/sshService";
import deployService from "../services/deployService";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * POST /api/ai/chat
 * Local AI assistant — no external API needed.
 * Uses pattern matching + data lookup to answer questions and execute commands.
 */
export const chat = async (req: AuthRequest, res: Response) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      res.status(400).json({ message: "Message is required" });
      return;
    }

    const userId = req.user?._id;
    const msg = message.toLowerCase().trim();
    let response = "";
    let action: any = null;

    // --- Server queries ---
    if (
      msg.includes("server") &&
      (msg.includes("list") ||
        msg.includes("show") ||
        msg.includes("danh sách") ||
        msg.includes("liệt kê"))
    ) {
      const servers = await Server.find({ owner: userId })
        .select("name host status")
        .lean();
      if (servers.length === 0) {
        response =
          "You don't have any servers yet. Add one from the Servers page.";
      } else {
        const list = servers
          .map(
            (s: any) =>
              `• **${s.name}** (${s.host}) — ${s.status === "online" ? "🟢 Online" : "🔴 Offline"}`,
          )
          .join("\n");
        response = `You have **${servers.length}** servers:\n\n${list}`;
      }
    }

    // --- CPU/RAM queries ---
    else if (
      msg.includes("cpu") ||
      msg.includes("ram") ||
      msg.includes("memory") ||
      msg.includes("tài nguyên")
    ) {
      const servers = await Server.find({ owner: userId }).lean();
      const serverName = context?.serverName;
      let targetServer: any = null;

      if (serverName) {
        targetServer = servers.find((s: any) =>
          s.name.toLowerCase().includes(serverName.toLowerCase()),
        );
      } else if (servers.length === 1) {
        targetServer = servers[0];
      }

      if (targetServer) {
        try {
          const stats = await sshService.getSystemStats(
            targetServer._id.toString(),
          );
          response = `📊 **${targetServer.name}** stats:\n\n• CPU: **${stats.cpuUsage}%**\n• RAM: **${stats.memory.used}** / ${stats.memory.total} (**${stats.memory.percent}**)\n• Disk: **${stats.disk.used}** / ${stats.disk.total} (**${stats.disk.percent}**)\n• Uptime: ${stats.uptime}\n• Load: ${stats.loadAvg}`;
        } catch {
          response = `Could not fetch stats for **${targetServer.name}**. The server might be offline.`;
        }
      } else if (servers.length > 1) {
        response = `You have ${servers.length} servers. Which one do you want to check? Mention the server name in your message.`;
      } else {
        response = "No servers found.";
      }
    }

    // --- Project queries ---
    else if (
      msg.includes("project") ||
      msg.includes("dự án") ||
      (msg.includes("list") && msg.includes("project"))
    ) {
      const projects = await Project.find({ owner: userId })
        .select("name status branch server")
        .populate("server", "name")
        .lean();
      if (projects.length === 0) {
        response = "No projects found. Create one from the Projects page.";
      } else {
        const statusEmoji: Record<string, string> = {
          running: "🟢",
          stopped: "🔴",
          failed: "❌",
          deploying: "🟡",
          idle: "⚪",
        };
        const list = projects
          .map(
            (p: any) =>
              `• ${statusEmoji[p.status] || "⚪"} **${p.name}** → ${(p.server as any)?.name || "no server"} (${p.status})`,
          )
          .join("\n");
        response = `You have **${projects.length}** projects:\n\n${list}`;
      }
    }

    // --- Deploy command ---
    else if (msg.includes("deploy") || msg.includes("triển khai")) {
      const projects = await Project.find({ owner: userId })
        .select("name")
        .lean();
      // Try to find project name in message
      const targetProject = projects.find((p: any) =>
        msg.includes(p.name.toLowerCase()),
      );

      if (targetProject) {
        response = `🚀 Do you want me to deploy **${(targetProject as any).name}**? Click the confirm button below.`;
        action = {
          type: "deploy",
          projectId: (targetProject as any)._id,
          projectName: (targetProject as any).name,
        };
      } else {
        const list = projects.map((p: any) => `• ${p.name}`).join("\n");
        response = `Which project do you want to deploy? Available:\n\n${list}\n\nSay "deploy <project name>" to start.`;
      }
    }

    // --- Recent deployments ---
    else if (
      msg.includes("recent") ||
      msg.includes("gần đây") ||
      msg.includes("history") ||
      msg.includes("lịch sử")
    ) {
      const deployments = await Deployment.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("project", "name")
        .lean();

      if (deployments.length === 0) {
        response = "No recent deployments.";
      } else {
        const list = deployments
          .map((d: any) => {
            const status =
              d.status === "running" || d.status === "success"
                ? "✅"
                : d.status === "failed"
                  ? "❌"
                  : "🟡";
            return `• ${status} **${d.project?.name || "?"}** — ${d.status} (${new Date(d.createdAt).toLocaleString()})`;
          })
          .join("\n");
        response = `📋 **Recent deployments:**\n\n${list}`;
      }
    }

    // --- Failed deployments ---
    else if (
      msg.includes("fail") ||
      msg.includes("error") ||
      msg.includes("lỗi") ||
      msg.includes("thất bại")
    ) {
      const failed = await Deployment.find({ status: "failed" })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("project", "name")
        .lean();

      if (failed.length === 0) {
        response = "🎉 No failed deployments found!";
      } else {
        const list = failed
          .map(
            (d: any) =>
              `• ❌ **${d.project?.name || "?"}** — ${new Date(d.createdAt).toLocaleString()}`,
          )
          .join("\n");
        response = `⚠️ **Recent failures:**\n\n${list}\n\nCheck the deployment detail page for logs.`;
      }
    }

    // --- Help ---
    else if (
      msg.includes("help") ||
      msg.includes("giúp") ||
      msg === "?" ||
      msg.includes("what can you do")
    ) {
      response = `🤖 **I can help you with:**

• "List servers" — Show all your servers
• "Show CPU / RAM" — Check server resources
• "List projects" — Show all projects
• "Deploy <project name>" — Trigger a deployment
• "Recent deployments" — Last 5 deploys
• "Show failures" — Recent failed deploys
• "Status of <project>" — Project status

Just ask in English or Vietnamese!`;
    }

    // --- Status query ---
    else if (msg.includes("status") || msg.includes("trạng thái")) {
      const projects = await Project.find({ owner: userId })
        .select("name status")
        .lean();
      const targetProject = projects.find((p: any) =>
        msg.includes(p.name.toLowerCase()),
      );

      if (targetProject) {
        const statusEmoji: Record<string, string> = {
          running: "🟢 Running",
          stopped: "🔴 Stopped",
          failed: "❌ Failed",
          deploying: "🟡 Deploying",
          idle: "⚪ Idle",
        };
        response = `Project **${(targetProject as any).name}** is ${statusEmoji[(targetProject as any).status] || (targetProject as any).status}.`;
      } else {
        response = 'Specify a project name. Try "status of <project name>".';
      }
    }

    // --- Default / small talk ---
    else {
      response = `I'm your Pulse AI assistant! 🤖

I can answer questions about your servers, projects, and deployments. Try:
• "List my servers"
• "Show CPU usage"
• "Deploy my-project"
• "Recent deployments"
• "help" for more options`;
    }

    res.json({ response, action });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/ai/execute
 * Execute an AI-suggested action (e.g., deploy)
 */
export const executeAction = async (req: AuthRequest, res: Response) => {
  try {
    const { type, projectId } = req.body;

    if (type === "deploy" && projectId) {
      const deploymentId = await deployService.deploy(
        projectId,
        "manual",
        req.user?._id?.toString(),
      );
      res.json({
        message: "Deployment started!",
        deploymentId,
      });
    } else {
      res.status(400).json({ message: "Unknown action" });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
