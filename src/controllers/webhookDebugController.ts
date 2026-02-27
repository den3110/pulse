import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import mongoose from "mongoose";

// In-memory webhook event log (recent 100 per project)
const webhookLogs = new Map<string, any[]>();

const MAX_LOGS = 100;

function addLog(projectId: string, event: any) {
  if (!webhookLogs.has(projectId)) webhookLogs.set(projectId, []);
  const logs = webhookLogs.get(projectId)!;
  logs.unshift({ ...event, timestamp: new Date().toISOString() });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

// Called from webhook handler to record incoming webhooks
export function recordWebhookEvent(
  projectId: string,
  headers: Record<string, any>,
  body: any,
  status: "success" | "failed" | "ignored",
  message: string,
) {
  addLog(projectId, {
    id: new mongoose.Types.ObjectId().toString(),
    headers: {
      "content-type": headers["content-type"],
      "x-github-event": headers["x-github-event"],
      "x-github-delivery": headers["x-github-delivery"],
      "x-hub-signature-256": headers["x-hub-signature-256"]
        ? "sha256=***"
        : undefined,
      "user-agent": headers["user-agent"],
    },
    body: {
      ref: body?.ref,
      after: body?.after?.slice(0, 8),
      repository: body?.repository?.full_name,
      sender: body?.sender?.login,
      commits: body?.commits?.length || 0,
    },
    status,
    message,
  });
}

// GET /api/webhook-debug/:projectId/logs
export const getWebhookLogs = async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const logs = webhookLogs.get(projectId) || [];
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/webhook-debug/:projectId/logs
export const clearWebhookLogs = async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    webhookLogs.delete(projectId);
    res.json({ message: "Logs cleared" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/webhook-debug/:projectId/test — simulate a webhook event
export const sendTestWebhook = async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    addLog(projectId, {
      id: new mongoose.Types.ObjectId().toString(),
      headers: { "x-github-event": "ping", "content-type": "application/json" },
      body: { zen: "Test webhook from Pulse debugger" },
      status: "success",
      message: "Test ping event",
    });
    res.json({ message: "Test webhook event recorded" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
