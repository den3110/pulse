import { Response } from "express";

/**
 * SSE (Server-Sent Events) Service
 * Manages active SSE connections per project for real-time log streaming.
 */

// Map: projectId -> Set of active Response objects
const clients = new Map<string, Set<Response>>();

/**
 * Add a client SSE connection for a project
 */
export const addSSEClient = (projectId: string, res: Response) => {
  if (!clients.has(projectId)) {
    clients.set(projectId, new Set());
  }
  clients.get(projectId)!.add(res);

  // Cleanup on disconnect
  res.on("close", () => {
    const set = clients.get(projectId);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(projectId);
    }
  });
};

/**
 * Send an SSE event to all clients watching a project
 */
export const sendSSE = (
  projectId: string,
  event: string,
  data: Record<string, any>,
) => {
  const set = clients.get(projectId);
  if (!set || set.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
};

/**
 * Get active SSE client count for a project (for debugging)
 */
export const getSSEClientCount = (projectId: string): number => {
  return clients.get(projectId)?.size || 0;
};
