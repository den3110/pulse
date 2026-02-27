import { Response } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import config from "../config";
import { AuthRequest } from "../middleware/auth";
import { generateTokens } from "../utils/jwt";
import { logActivity } from "../services/activityLogger";
import { authenticator } from "otplib";
import QRCode from "qrcode";

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
        planType: user.planType,
        subscriptionStatus: user.subscriptionStatus,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
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

    if (user.isTwoFactorEnabled) {
      const tempToken = jwt.sign(
        { id: user._id.toString(), temp: true },
        config.jwtSecret,
        { expiresIn: "5m" },
      );

      res.json({ requires2FA: true, tempToken });
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
        planType: user.planType,
        subscriptionStatus: user.subscriptionStatus,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        currentTeam: user.currentTeam,
        githubUsername: user.githubUsername,
        githubAvatarUrl: user.githubAvatarUrl,
        activeServer: user.activeServer,
      },
      accessToken,
      refreshToken,
    });

    // F2: Activity log
    logActivity({
      action: "login",
      userId: user._id.toString(),
      team: user.currentTeam?.toString(),
      username: user.username,
      details: `User ${user.username} logged in`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const verifyLogin2FA = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      res.status(400).json({ message: "Missing token or code" });
      return;
    }

    const decoded = jwt.verify(tempToken, config.jwtSecret) as {
      id: string;
      temp?: boolean;
    };

    if (!decoded.temp) {
      res.status(401).json({ message: "Invalid temporary token" });
      return;
    }

    const user = await User.findById(decoded.id).select("+twoFactorSecret");
    if (!user || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
      res.status(400).json({ message: "2FA is not enabled for this user" });
      return;
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });
    if (!isValid) {
      res.status(401).json({ message: "Invalid 2FA code" });
      return;
    }

    const { accessToken, refreshToken } = generateTokens(
      user._id.toString(),
      user.role,
    );

    user.refreshTokens = [...(user.refreshTokens || []), refreshToken];
    if (user.refreshTokens.length > 5) {
      user.refreshTokens.shift();
    }
    await user.save();

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        planType: user.planType,
        subscriptionStatus: user.subscriptionStatus,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        currentTeam: user.currentTeam,
        githubUsername: user.githubUsername,
        githubAvatarUrl: user.githubAvatarUrl,
        activeServer: user.activeServer,
      },
      accessToken,
      refreshToken,
    });

    logActivity({
      action: "login.2fa",
      userId: user._id.toString(),
      team: user.currentTeam?.toString(),
      username: user.username,
      details: `User ${user.username} logged in with 2FA`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

export const generate2FA = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const user = await User.findById(req.user?._id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(
      user.email,
      "Pulse Deploy Manager",
      secret,
    );

    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Save secret temporarily without enabling 2FA yet
    user.twoFactorSecret = secret;
    await user.save();

    res.json({ secret, qrCodeUrl });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const verifyAndEnable2FA = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { code } = req.body;
    const user = await User.findById(req.user?._id).select("+twoFactorSecret");

    if (!user || !user.twoFactorSecret) {
      res.status(400).json({ message: "No 2FA setup in progress" });
      return;
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });
    if (!isValid) {
      res.status(401).json({ message: "Invalid 2FA code" });
      return;
    }

    user.isTwoFactorEnabled = true;
    await user.save();

    res.json({ message: "2FA has been successfully enabled" });

    logActivity({
      action: "2fa.enabled",
      userId: user._id.toString(),
      team: user.currentTeam?.toString(),
      username: user.username,
      details: `User ${user.username} enabled 2FA`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const disable2FA = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user?._id).select(
      "+password +twoFactorSecret",
    );

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ message: "Invalid password" });
      return;
    }

    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save();

    res.json({ message: "2FA has been successfully disabled" });

    logActivity({
      action: "2fa.disabled",
      userId: user._id.toString(),
      team: user.currentTeam?.toString(),
      username: user.username,
      details: `User ${user.username} disabled 2FA`,
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
      planType: user.planType,
      subscriptionStatus: user.subscriptionStatus,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      activeServer: user.activeServer,
      currentTeam: user.currentTeam,
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
      team: user.currentTeam?.toString(),
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

export const updateAlertPreferences = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { slackWebhookUrl, discordWebhookUrl } = req.body;
    const user = await User.findById(req.user?._id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    user.alertPreferences = {
      slackWebhookUrl: slackWebhookUrl || "",
      discordWebhookUrl: discordWebhookUrl || "",
    };

    await user.save();

    res.json({
      message: "Alert preferences updated successfully",
      alertPreferences: user.alertPreferences,
    });

    logActivity({
      action: "alerts.update",
      userId: user._id.toString(),
      team: user.currentTeam?.toString(),
      username: user.username,
      details: `User ${user.username} updated multi-channel alert settings`,
      ip: req.ip,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteAccount = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // You could optionally verify the password here depending on requirements
    // For now, we assume if they hit this, they securely deleted.

    // Log the deletion (note: log might be orphaned if it relies on userId)
    logActivity({
      action: "user.delete",
      userId: user._id.toString(),
      team: undefined,
      username: user.username,
      details: `User ${user.username} deleted their account`,
      ip: req.ip,
    });

    await User.findByIdAndDelete(user._id);

    res.json({ message: "Account deleted successfully." });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: error.message || "Failed to delete account" });
  }
};
