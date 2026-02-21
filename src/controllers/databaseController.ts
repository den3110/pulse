import { Request, Response } from "express";
import databaseService from "../services/databaseService";

export const getContainers = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const containers = await databaseService.listContainers(serverId);
    res.json(containers);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const backupDatabase = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { containerId, dbType, dbName, dbUser, dbPassword } = req.body;

    const result = await databaseService.backup(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
    );
    res.json({ message: "Backup created successfully", ...result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getBackups = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const backups = await databaseService.listBackups(serverId);
    res.json(backups);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteBackup = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const filename = req.params.filename as string;
    await databaseService.deleteBackup(serverId, filename);
    res.json({ message: "Backup deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const restoreBackup = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { containerId, dbType, dbName, dbUser, dbPassword, filename } =
      req.body;

    await databaseService.restore(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      filename,
    );
    res.json({ message: "Restore completed successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const downloadBackup = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const filename = req.params.filename as string;
    const stream = await databaseService.getBackupStream(serverId, filename);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");

    stream.pipe(res);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const executeQuery = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { containerId, dbType, dbName, dbUser, dbPassword, query } = req.body;

    const result = await databaseService.executeQuery(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      query,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const executeAction = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const {
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      table,
      action,
      idField,
      idValue,
      data,
    } = req.body;

    const result = await databaseService.executeAction(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      table,
      action,
      idField,
      idValue,
      data,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSchema = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { containerId, dbType, dbName, dbUser, dbPassword, table } = req.body;

    const result = await databaseService.getSchema(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      table,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
