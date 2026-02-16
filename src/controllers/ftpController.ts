import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import sftpService from "../services/sftpService";
import path from "path";

export const listDirectory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const dirPath = (req.query.path as string) || "/";
    const showHidden = req.query.showHidden === "true";
    const type = req.query.type as "directory" | "file" | undefined;
    let entries = await sftpService.listDirectory(
      req.params.serverId as string,
      dirPath,
      type,
    );
    if (!showHidden) {
      entries = entries.filter((e) => !e.isHidden);
    }
    res.json({ path: dirPath, entries });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const readFile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }
    const content = await sftpService.readFile(
      req.params.serverId as string,
      filePath,
    );
    res.json({ path: filePath, content });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const writeFile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }
    await sftpService.writeFile(
      req.params.serverId as string,
      filePath,
      content || "",
    );
    res.json({ message: "File saved" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const uploadFile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const targetDir = req.body.path || "/tmp";
    const file = (req as any).file;
    if (!file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }
    const targetPath = `${targetDir}/${file.originalname}`.replace(/\/+/g, "/");
    await sftpService.uploadFile(
      req.params.serverId as string,
      targetPath,
      file.buffer,
    );
    res.json({ message: "File uploaded", path: targetPath });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const downloadFile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }
    const buffer = await sftpService.downloadFile(
      req.params.serverId as string,
      filePath,
    );
    const filename = path.basename(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteItem = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { path: itemPath, type: itemType, paths } = req.body; // Support both query (legacy) and body (bulk)

    // Bulk delete
    if (paths && Array.isArray(paths)) {
      await sftpService.deleteItems(req.params.serverId as string, paths);
      res.json({ message: "Deleted" });
      return;
    }

    // Single delete (fallback)
    const qPath = (req.query.path as string) || itemPath;
    const qType = (req.query.type as string) || itemType;

    if (!qPath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }

    if (qType === "directory") {
      await sftpService.deleteDirectory(req.params.serverId as string, qPath);
    } else {
      await sftpService.deleteFile(req.params.serverId as string, qPath);
    }
    res.json({ message: "Deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createDirectory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }
    await sftpService.createDirectory(req.params.serverId as string, dirPath);
    res.json({ message: "Directory created" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const renameItem = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      res.status(400).json({ message: "oldPath and newPath are required" });
      return;
    }
    await sftpService.rename(req.params.serverId as string, oldPath, newPath);
    res.json({ message: "Renamed" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getStats = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }
    const stats = await sftpService.getStats(
      req.params.serverId as string,
      filePath,
    );
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const chmod = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { path: filePath, mode } = req.body;
    if (!filePath || !mode) {
      res.status(400).json({ message: "path and mode are required" });
      return;
    }
    await sftpService.chmod(req.params.serverId as string, filePath, mode);
    res.json({ message: "Permissions updated" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const copyItem = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { sourcePath, destPath } = req.body;
    if (!sourcePath || !destPath) {
      res.status(400).json({ message: "sourcePath and destPath are required" });
      return;
    }
    await sftpService.copyItem(
      req.params.serverId as string,
      sourcePath,
      destPath,
    );
    res.json({ message: "Copied" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const zipItems = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { archiveName, items, basePath } = req.body;
    if (!archiveName || !items || !basePath) {
      res
        .status(400)
        .json({ message: "archiveName, items, and basePath are required" });
      return;
    }
    const archivePath = `${basePath}/${archiveName}`.replace(/\/+/g, "/");
    await sftpService.zipItems(
      req.params.serverId as string,
      archivePath,
      items,
      basePath,
    );
    res.json({ message: "Archive created", path: archivePath });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const unzipArchive = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { archivePath, destPath } = req.body;
    if (!archivePath || !destPath) {
      res
        .status(400)
        .json({ message: "archivePath and destPath are required" });
      return;
    }
    await sftpService.unzipArchive(
      req.params.serverId as string,
      archivePath,
      destPath,
    );
    res.json({ message: "Extracted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getDiskUsage = async (
  req: AuthRequest,
  res: Response,
  next: Function,
): Promise<void> => {
  try {
    const dirPath = (req.query.path as string) || "/";
    const usage = await sftpService.getDiskUsage(
      req.params.serverId as string,
      dirPath,
    );
    res.json(usage);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getDirSize = async (
  req: AuthRequest,
  res: Response,
  next: Function,
): Promise<void> => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }
    const size = await sftpService.getDirSize(
      req.params.serverId as string,
      dirPath,
    );
    res.json({ size });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getDirSizes = async (
  req: AuthRequest,
  res: Response,
  next: Function,
): Promise<void> => {
  try {
    const dirPath =
      (req.query.path as string) || (req.body.path as string) || "/";
    const items = req.body.items as string[] | undefined;

    const sizes = await sftpService.getDirSizes(
      req.params.serverId as string,
      dirPath,
      items,
    );
    res.json(sizes);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteMultiple = async (
  req: AuthRequest,
  res: Response,
  next: Function,
): Promise<void> => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ message: "Paths array is required" });
      return;
    }
    await sftpService.deleteMultiple(req.params.serverId as string, paths);
    res.json({ message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const previewFile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ message: "Path is required" });
      return;
    }

    const stream = await sftpService.createReadStream(
      req.params.serverId as string,
      filePath,
    );

    // Guess simple mime types
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    // Cache for 1 hour to improve repeated viewing
    res.setHeader("Cache-Control", "public, max-age=3600");

    stream.pipe(res);
    stream.on("error", (err: any) => {
      // If headers already sent, we can't do much but log
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      }
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
