import { Response } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import config from "../config";
import { AuthRequest } from "../middleware/auth";
import { logActivity } from "../services/activityLogger";

const generateTokens = (userId: string, role: string) => {
  const accessToken = jwt.sign({ id: userId, role }, config.jwtSecret, {
    expiresIn: config.jwtExpire as any,
  });
  const refreshToken = jwt.sign({ id: userId }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpire as any,
  });
  return { accessToken, refreshToken };
};

export const register = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });
    if (existingUser) {
      res.status(400).json({ message: "User already exists" });
      return;
    }

    const user = await User.create({ username, email, password });
    const { accessToken, refreshToken } = generateTokens(
      user._id.toString(),
      user.role,
    );

    user.refreshTokens = [refreshToken];
    await user.save();

    res.status(201).json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Support login by username or email
    const query = email.includes("@") ? { email } : { username: email };

    const user = await User.findOne(query)
      .select("+password")
      .select("+refreshTokens");
    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const { accessToken, refreshToken } = generateTokens(
      user._id.toString(),
      user.role,
    );

    // Push new refresh token
    user.refreshTokens = [...(user.refreshTokens || []), refreshToken];

    // Optional: Limit number of active sessions (e.g., max 5)
    if (user.refreshTokens.length > 5) {
      user.refreshTokens.shift(); // Remove oldest
    }

    await user.save();

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });

    // F2: Activity log
    logActivity({
      action: "login",
      userId: user._id.toString(),
      username: user.username,
      details: `User ${user.username} logged in`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const refresh = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(401).json({ message: "Refresh token required" });
      return;
    }

    const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as {
      id: string;
    };
    const user = await User.findById(decoded.id).select("+refreshTokens");

    if (
      !user ||
      !user.refreshTokens ||
      !user.refreshTokens.includes(refreshToken)
    ) {
      res.status(401).json({ message: "Invalid refresh token" });
      return;
    }

    const tokens = generateTokens(user._id.toString(), user.role);

    // Rotate tokens: remove old one, add new one
    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    user.refreshTokens.push(tokens.refreshToken);

    await user.save();

    res.json(tokens);
  } catch (error: any) {
    res.status(401).json({ message: "Invalid refresh token" });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?._id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      activeServer: user.activeServer,
      githubUsername: user.githubUsername,
      githubAvatarUrl: user.githubAvatarUrl,
      createdAt: user.createdAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user?._id).select("+password");
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      res.status(400).json({ message: "Current password is incorrect" });
      return;
    }

    user.password = newPassword;
    await user.save();

    // F2: Activity log
    logActivity({
      action: "password.change",
      userId: user._id.toString(),
      username: user.username,
      details: `User ${user.username} changed password`,
      ip: req.ip,
    });

    res.json({ message: "Password updated successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const logout = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(200).json({ message: "Logged out" });
      return;
    }

    const decoded = jwt.decode(refreshToken) as { id: string } | null;
    if (decoded?.id) {
      const user = await User.findById(decoded.id).select("+refreshTokens");
      if (user && user.refreshTokens) {
        user.refreshTokens = user.refreshTokens.filter(
          (t) => t !== refreshToken,
        );
        await user.save();
      }
    }

    res.json({ message: "Logged out successfully" });
  } catch (error: any) {
    // Ignore errors during logout
    res.json({ message: "Logged out" });
  }
};

export const updateActiveServer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId } = req.body;
    const user = await User.findById(req.user?._id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    user.activeServer = serverId;
    await user.save();

    res.json({ message: "Active server updated", activeServer: serverId });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
