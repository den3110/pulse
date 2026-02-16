import { Request, Response } from "express";
import Notification from "../models/Notification";

import fs from "fs";
import path from "path";

/** GET /notifications — list user's notifications */
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("projectId", "name")
      .lean(); // Use lean to get plain objects

    const unreadCount = await Notification.countDocuments({
      userId,
      read: false,
    });

    // Explicitly send JSON string to avoid any express magic failing
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(JSON.stringify({ notifications, unreadCount }));
  } catch (error: any) {
    console.error("[NotificationController] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/** PUT /notifications/:id/read — mark single notification as read */
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { read: true },
    );
    res.json({ message: "Marked as read" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/** PUT /notifications/read-all — mark all as read */
export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    await Notification.updateMany({ userId, read: false }, { read: true });
    res.json({ message: "All marked as read" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/** DELETE /notifications — clear all notifications */
export const clearAll = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    await Notification.deleteMany({ userId });
    res.json({ message: "All notifications cleared" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
