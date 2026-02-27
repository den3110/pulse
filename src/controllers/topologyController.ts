import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Server from "../models/Server";
import Project from "../models/Project";

interface TopologyNode {
  id: string;
  type: "server" | "project";
  label: string;
  status: string;
  meta: Record<string, any>;
}

interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
}

/**
 * GET /api/topology
 * Returns all servers and projects as graph nodes + edges
 */
export const getTopology = async (req: AuthRequest, res: Response) => {
  try {
    const [servers, projects] = await Promise.all([
      Server.find({ owner: req.user?._id }).lean(),
      Project.find({ owner: req.user?._id })
        .populate("server", "name host status")
        .lean(),
    ]);

    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];

    // Add server nodes
    for (const server of servers) {
      nodes.push({
        id: `server-${server._id}`,
        type: "server",
        label: server.name,
        status: (server as any).status || "unknown",
        meta: {
          host: server.host,
          port: server.port,
          _id: server._id,
        },
      });
    }

    // Add project nodes and edges to their servers
    for (const project of projects) {
      const p = project as any;
      nodes.push({
        id: `project-${p._id}`,
        type: "project",
        label: p.name,
        status: p.status || "idle",
        meta: {
          repoUrl: p.repoUrl,
          branch: p.branch,
          deployPath: p.deployPath,
          autoDeploy: p.autoDeploy,
          _id: p._id,
        },
      });

      // Edge: project → server
      if (p.server?._id) {
        edges.push({
          source: `project-${p._id}`,
          target: `server-${p.server._id}`,
          label: "deployed on",
        });
      }
    }

    res.json({ nodes, edges });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
