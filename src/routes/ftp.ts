import { Router, Response } from "express";
import { protect, AuthRequest } from "../middleware/auth";
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
router.post("/:serverId/write", ftpController.writeFile);
router.post(
  "/:serverId/upload",
  upload.single("file"),
  ftpController.uploadFile,
);
router.get("/:serverId/download", ftpController.downloadFile);
router.get("/:serverId/preview", ftpController.previewFile);

// File operations
router.delete("/:serverId/file", ftpController.deleteItem);
router.post("/:serverId/mkdir", ftpController.createDirectory);
router.post("/:serverId/rename", ftpController.renameItem);
router.get("/:serverId/stats", ftpController.getStats);
router.post("/:serverId/chmod", ftpController.chmod);
router.post("/:serverId/copy", ftpController.copyItem);
router.post("/:serverId/zip", ftpController.zipItems);
router.post("/:serverId/unzip", ftpController.unzipArchive);
router.get("/:serverId/disk", ftpController.getDiskUsage);
router.get("/:serverId/dir-size", ftpController.getDirSize);
router.get("/:serverId/dir-sizes", ftpController.getDirSizes);
router.post("/:serverId/dir-sizes", ftpController.getDirSizes);
router.post("/:serverId/delete-multiple", ftpController.deleteMultiple);

export default router;
