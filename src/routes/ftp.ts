import { Router, Response } from "express";
import { protect, AuthRequest, requireTeamRole } from "../middleware/auth";
import Server from "../models/Server";
import multer from "multer";
import * as ftpController from "../controllers/ftpController";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
}); // 100MB max

// All routes require auth
router.use(protect);

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

// File browser
router.get("/:serverId/list", ftpController.listDirectory);
router.get("/:serverId/read", ftpController.readFile);
router.post(
  "/:serverId/write",
  requireTeamRole(["admin", "editor"]),
  ftpController.writeFile,
);
router.post(
  "/:serverId/upload",
  requireTeamRole(["admin", "editor"]),
  upload.single("file"),
  ftpController.uploadFile,
);
const uploadArchive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
}); // 500MB max for archives
router.post(
  "/:serverId/upload-archive",
  requireTeamRole(["admin", "editor"]),
  uploadArchive.single("file"),
  ftpController.uploadArchive,
);
router.get("/:serverId/download", ftpController.downloadFile);
router.get("/:serverId/preview", ftpController.previewFile);

// File operations
router.delete(
  "/:serverId/file",
  requireTeamRole(["admin", "editor"]),
  ftpController.deleteItem,
);
router.post(
  "/:serverId/mkdir",
  requireTeamRole(["admin", "editor"]),
  ftpController.createDirectory,
);
router.post(
  "/:serverId/batch-mkdir",
  requireTeamRole(["admin", "editor"]),
  ftpController.batchMkdir,
);
router.post(
  "/:serverId/rename",
  requireTeamRole(["admin", "editor"]),
  ftpController.renameItem,
);
router.get("/:serverId/stats", ftpController.getStats);
router.post(
  "/:serverId/chmod",
  requireTeamRole(["admin", "editor"]),
  ftpController.chmod,
);
router.post(
  "/:serverId/copy",
  requireTeamRole(["admin", "editor"]),
  ftpController.copyItem,
);
router.post(
  "/:serverId/zip",
  requireTeamRole(["admin", "editor"]),
  ftpController.zipItems,
);
router.post(
  "/:serverId/unzip",
  requireTeamRole(["admin", "editor"]),
  ftpController.unzipArchive,
);
router.get("/:serverId/disk", ftpController.getDiskUsage);
router.get("/:serverId/dir-size", ftpController.getDirSize);
router.get("/:serverId/dir-sizes", ftpController.getDirSizes);
router.post("/:serverId/dir-sizes", ftpController.getDirSizes);
router.post(
  "/:serverId/delete-multiple",
  requireTeamRole(["admin", "editor"]),
  ftpController.deleteMultiple,
);

export default router;
