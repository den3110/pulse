import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import dockerService from "../services/dockerService";

// GET /:serverId/containers
export const listContainers = async (req: AuthRequest, res: Response) => {
  try {
    const containers = await dockerService.listContainers(
      req.params.serverId as string,
    );
    res.json({ containers });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/images
export const listImages = async (req: AuthRequest, res: Response) => {
  try {
    const images = await dockerService.listImages(
      req.params.serverId as string,
    );
    res.json({ images });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /:serverId/containers/:containerId/:action
export const containerAction = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const containerId = req.params.containerId as string;
    const action = req.params.action as string;
    const validActions = [
      "start",
      "stop",
      "restart",
      "remove",
      "pause",
      "unpause",
    ];
    if (!validActions.includes(action)) {
      res.status(400).json({ message: `Invalid action: ${action}` });
      return;
    }
    const result = await dockerService.containerAction(
      serverId,
      containerId,
      action as any,
    );
    res.json({ message: `Container ${action} successful`, result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/containers/:containerId/logs
export const getContainerLogs = async (req: AuthRequest, res: Response) => {
  try {
    const tail = parseInt(req.query.tail as string) || 200;
    const logs = await dockerService.getContainerLogs(
      req.params.serverId as string,
      req.params.containerId as string,
      tail,
    );
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/containers/:containerId/stats
export const getContainerStatsEndpoint = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const stats = await dockerService.getContainerStats(
      req.params.serverId as string,
      [req.params.containerId as string],
    );
    res.json({ stats: stats[0] || null });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/stats — all container stats
export const getAllContainerStats = async (req: AuthRequest, res: Response) => {
  try {
    const stats = await dockerService.getContainerStats(
      req.params.serverId as string,
    );
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/containers/:containerId/inspect
export const inspectContainer = async (req: AuthRequest, res: Response) => {
  try {
    const data = await dockerService.inspectContainer(
      req.params.serverId as string,
      req.params.containerId as string,
    );
    res.json({ data });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/images/:imageId/inspect
export const inspectImage = async (req: AuthRequest, res: Response) => {
  try {
    const data = await dockerService.inspectImage(
      req.params.serverId as string,
      req.params.imageId as string,
    );
    res.json({ data });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /:serverId/pull — pull an image (SSE stream)
export const pullImage = async (req: AuthRequest, res: Response) => {
  const { image } = req.body;
  if (!image) {
    res.status(400).json({ message: "Image name is required" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await dockerService.pullImage(
      req.params.serverId as string,
      image,
      (line: string) => {
        res.write(`data: ${JSON.stringify({ line })}\n\n`);
      },
    );
    res.write(
      `event: complete\ndata: ${JSON.stringify({ message: "Pull complete" })}\n\n`,
    );
  } catch (error: any) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
    );
  } finally {
    res.end();
  }
};

// DELETE /:serverId/images/:imageId
export const removeImage = async (req: AuthRequest, res: Response) => {
  try {
    const result = await dockerService.removeImage(
      req.params.serverId as string,
      req.params.imageId as string,
    );
    res.json({ message: "Image removed", result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /:serverId/info — Docker info
export const getDockerInfo = async (req: AuthRequest, res: Response) => {
  try {
    const info = await dockerService.getDockerInfo(
      req.params.serverId as string,
    );
    res.json(info);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /search (Global search, no serverId required)
export const searchImages = async (req: Request, res: Response) => {
  try {
    const query = req.query.query as string;
    if (!query) {
      res.json({ results: [] });
      return;
    }
    const limit = req.query.limit || 5;

    const response = await fetch(
      `https://hub.docker.com/v2/search/repositories/?query=${query}&page_size=${limit}`,
    );
    if (!response.ok) {
      throw new Error("Failed to search Docker Hub");
    }
    const data: any = await response.json();
    res.json({ results: data.results || [] });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /:serverId/containers/run
export const runContainer = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const config = req.body;
    if (!config || !config.image) {
      res.status(400).json({ message: "Image is required" });
      return;
    }
    const result = await dockerService.runContainer(serverId, config);
    res.json({ message: "Container started successfully", result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /:serverId/compose-up — run docker compose up (SSE stream)
export const dockerComposeUp = async (req: AuthRequest, res: Response) => {
  const { composePath, projectName } = req.body;
  if (!composePath) {
    res.status(400).json({ message: "composePath is required" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const result = await dockerService.dockerComposeUp(
      req.params.serverId as string,
      composePath,
      (line: string) => {
        res.write(`data: ${JSON.stringify({ line })}\n\n`);
      },
      projectName || undefined,
    );
    res.write(
      `event: complete\ndata: ${JSON.stringify({ message: "Docker Compose up complete", containers: result.containers })}\n\n`,
    );
  } catch (error: any) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
    );
  } finally {
    res.end();
  }
};
