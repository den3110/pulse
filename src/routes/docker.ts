import { Router, Response } from "express";
import { protect, AuthRequest, requireTeamRole } from "../middleware/auth";
import Server from "../models/Server";
import * as dockerController from "../controllers/dockerController";

const router = Router();

// All routes require auth
router.use(protect);

// Global docker search
router.get("/search", dockerController.searchImages);

// Middleware: verify server ownership
const verifyServer = async (
  req: AuthRequest,
  res: Response,
  next: Function,
) => {
  try {
    const server = await Server.findOne({
      _id: req.params.serverId as string,
      owner: req.user?._id,
    });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }
    next();
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

router.use("/:serverId/*", verifyServer as any);
router.use("/:serverId", verifyServer as any);

// Docker info
router.get("/:serverId/info", dockerController.getDockerInfo);

// List containers
router.get("/:serverId/containers", dockerController.listContainers);

// List images
router.get("/:serverId/images", dockerController.listImages);

// All container stats
router.get("/:serverId/stats", dockerController.getAllContainerStats);

// Run a new container
router.post(
  "/:serverId/containers/run",
  requireTeamRole(["admin", "editor"]),
  dockerController.runContainer,
);

// Container actions (start, stop, restart, remove, pause, unpause)
router.post(
  "/:serverId/containers/:containerId/:action",
  requireTeamRole(["admin", "editor"]),
  dockerController.containerAction,
);

// Container logs
router.get(
  "/:serverId/containers/:containerId/logs",
  dockerController.getContainerLogs,
);

// Container stats
router.get(
  "/:serverId/containers/:containerId/stats",
  dockerController.getContainerStatsEndpoint,
);

// Container inspect
router.get(
  "/:serverId/containers/:containerId/inspect",
  dockerController.inspectContainer,
);

// Image inspect
router.get("/:serverId/images/:imageId/inspect", dockerController.inspectImage);

// Pull image (SSE stream)
router.post(
  "/:serverId/pull",
  requireTeamRole(["admin", "editor"]),
  dockerController.pullImage,
);

// Docker Compose Up (SSE stream)
router.post(
  "/:serverId/compose-up",
  requireTeamRole(["admin", "editor"]),
  dockerController.dockerComposeUp,
);

// Remove image
router.delete(
  "/:serverId/images/:imageId",
  requireTeamRole(["admin"]),
  dockerController.removeImage,
);

export default router;
