import { Response } from "express";
import User from "../models/User";
import { AuthRequest } from "../middleware/auth";
import { logActivity } from "../services/activityLogger";

// List all users (admin only)
export const listUsers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.user?.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    const users = await User.find()
      .select("-password -refreshToken")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Create user (admin only)
export const createUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.user?.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    const { username, email, password, role } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      res.status(400).json({ message: "User already exists" });
      return;
    }
    const user = await User.create({
      username,
      email,
      password,
      role: role || "viewer",
    });
    await logActivity({
      action: "user.create",
      userId: req.user._id.toString(),
      username: req.user.username,
      details: `Created user ${username}`,
      ip: req.ip,
    });
    res.status(201).json({
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Update user (admin only)
export const updateUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.user?.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    const { username, email, role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { username, email, role },
      { new: true },
    ).select("-password -refreshToken");
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    await logActivity({
      action: "user.update",
      userId: req.user._id.toString(),
      username: req.user.username,
      details: `Updated user ${user.username}`,
      ip: req.ip,
    });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Delete user (admin only)
export const deleteUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.user?.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    // Prevent self-deletion
    if (req.params.id === req.user._id.toString()) {
      res.status(400).json({ message: "Cannot delete yourself" });
      return;
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    await logActivity({
      action: "user.delete",
      userId: req.user._id.toString(),
      username: req.user.username,
      details: `Deleted user ${user.username}`,
      ip: req.ip,
    });
    res.json({ message: "User deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Reset user password (admin only)
export const resetPassword = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (req.user?.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
      return;
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    user.password = newPassword;
    await user.save();
    await logActivity({
      action: "password.change",
      userId: req.user._id.toString(),
      username: req.user.username,
      details: `Reset password for ${user.username}`,
      ip: req.ip,
    });
    res.json({ message: "Password reset successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
