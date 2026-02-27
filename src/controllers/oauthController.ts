import { Request, Response } from "express";
import User from "../models/User";
import githubService from "../services/githubService";
import googleService from "../services/googleService";
import { generateTokens } from "../utils/jwt";
import config from "../config";

const getFrontendUrl = (req: Request) => {
  return (
    config.clientUrl ||
    config.publicUrl ||
    `${req.protocol}://${req.get("host")}`
  );
};

/**
 * =======================
 * GITHUB OAUTH LOGIN
 * =======================
 */
export const getGithubAuthUrl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = `${getFrontendUrl(req)}/settings`;
  const rootUrl = "https://github.com/login/oauth/authorize";
  const options = {
    client_id: clientId as string,
    redirect_uri: redirectUri,
    scope: "user:email", // We only need email and basic profile for login
  };

  const qs = new URLSearchParams(options).toString();
  res.json({ url: `${rootUrl}?${qs}` });
};

export const githubCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      res.status(400).json({ message: "Authorization code is required" });
      return;
    }

    // 1. Exchange code for access token
    const accessToken = await githubService.exchangeCodeForToken(
      code,
      redirectUri,
    );

    // 2. Fetch user profile and emails
    const profile = await githubService.getUserProfile(accessToken);

    let email = profile.email;
    if (!email) {
      email = `${profile.login}@github.com`;
    }

    // 3. Find or create user
    let user = await User.findOne({
      $or: [
        { githubId: profile.id.toString() },
        { email: email.toLowerCase() },
      ],
    });

    if (!user) {
      // Ensure unique username
      let username = profile.login;
      let counter = 1;
      while (await User.findOne({ username })) {
        username = `${profile.login}${counter}`;
        counter++;
      }

      // Create new user
      user = await User.create({
        username: username,
        email: email.toLowerCase(),
        password: Math.random().toString(36).slice(-10), // Random password
        githubId: profile.id.toString(),
        githubUsername: profile.login,
        githubAvatarUrl: profile.avatar_url,
        role: "admin", // Default role
      });
    } else {
      // Update existing user with github ID if not set
      if (!user.githubId) {
        user.githubId = profile.id.toString();
        user.githubUsername = profile.login;
        user.githubAvatarUrl = profile.avatar_url;
        await user.save();
      }
    }

    // 4. Issue JWT Tokens
    const { accessToken: jwtAccess, refreshToken: jwtRefresh } = generateTokens(
      user._id.toString(),
      user.role,
    );

    // Push refresh token
    user.refreshTokens = [...(user.refreshTokens || []), jwtRefresh];
    if (user.refreshTokens.length > 5) user.refreshTokens.shift();
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
        githubUsername: user.githubUsername,
        githubAvatarUrl: user.githubAvatarUrl,
      },
      accessToken: jwtAccess,
      refreshToken: jwtRefresh,
    });
  } catch (error: any) {
    console.error("GitHub Login Error:", error.message, error.stack);
    res.status(500).json({
      message: error.message || "Failed to authenticate with GitHub",
    });
  }
};

/**
 * =======================
 * GOOGLE OAUTH LOGIN
 * =======================
 */
export const getGoogleAuthUrl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_CALLBACK_URL || `${getFrontendUrl(req)}/oauth/callback`;
  const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";

  const options = {
    client_id: clientId as string,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
  };

  const qs = new URLSearchParams(options).toString();
  res.json({ url: `${rootUrl}?${qs}` });
};

export const googleCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      res.status(400).json({ message: "Authorization code is required" });
      return;
    }

    const uri =
      redirectUri ||
      process.env.GOOGLE_CALLBACK_URL ||
      `${getFrontendUrl(req)}/oauth/callback`;

    // 1. Exchange code
    const accessToken = await googleService.exchangeCodeForToken(code, uri);

    // 2. Fetch profile
    const profile = await googleService.getUserProfile(accessToken);

    if (!profile.email) {
      res
        .status(400)
        .json({ message: "No email address returned from Google" });
      return;
    }

    // 3. Find or create user
    let user = await User.findOne({
      $or: [{ googleId: profile.id }, { email: profile.email.toLowerCase() }],
    });

    if (!user) {
      // Extract a base username from email
      let baseUsername = profile.email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9]/g, "");

      // Ensure unique username
      let username = baseUsername;
      let counter = 1;
      while (await User.findOne({ username })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      user = await User.create({
        username,
        email: profile.email.toLowerCase(),
        password: Math.random().toString(36).slice(-10), // Random password
        googleId: profile.id,
        googleAvatarUrl: profile.picture,
        role: "admin", // Default
      });
    } else {
      if (!user.googleId) {
        user.googleId = profile.id;
        user.googleAvatarUrl = profile.picture;
        await user.save();
      }
    }

    // 4. Issue JWT
    const { accessToken: jwtAccess, refreshToken: jwtRefresh } = generateTokens(
      user._id.toString(),
      user.role,
    );

    user.refreshTokens = [...(user.refreshTokens || []), jwtRefresh];
    if (user.refreshTokens.length > 5) user.refreshTokens.shift();
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
        googleAvatarUrl: user.googleAvatarUrl,
      },
      accessToken: jwtAccess,
      refreshToken: jwtRefresh,
    });
  } catch (error: any) {
    console.error("Google Login Error:", error.message, error.stack);
    res.status(500).json({
      message: error.message || "Failed to authenticate with Google",
    });
  }
};
