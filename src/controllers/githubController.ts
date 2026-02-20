import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import User from "../models/User";
import Project from "../models/Project";
import githubService from "../services/githubService";
import config from "../config";

/**
 * Exchange GitHub code for access token and link to user
 */
export const connectGitHub = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { code } = req.body;
    const userId = req.user?._id;

    if (!code) {
      res.status(400).json({ message: "Authorization code is required" });
      return;
    }

    // Exchange code for token
    const accessToken = await githubService.exchangeCodeForToken(code);

    // Get GitHub profile
    const githubProfile = await githubService.getUserProfile(accessToken);

    // Update user with GitHub info
    const user = await User.findByIdAndUpdate(
      userId,
      {
        githubId: githubProfile.id.toString(),
        githubUsername: githubProfile.login,
        githubAccessToken: accessToken,
        githubAvatarUrl: githubProfile.avatar_url,
      },
      { new: true },
    );

    res.json({
      message: "GitHub account connected successfully",
      user: {
        githubUsername: user?.githubUsername,
        githubAvatarUrl: user?.githubAvatarUrl,
      },
    });
  } catch (error: any) {
    console.error("Connect GitHub Error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Disconnect GitHub account
 */
export const disconnectGitHub = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;

    await User.findByIdAndUpdate(userId, {
      $unset: {
        githubId: "",
        githubUsername: "",
        githubAccessToken: "",
        githubAvatarUrl: "",
      },
    });

    res.json({ message: "GitHub account disconnected successfully" });
  } catch (error: any) {
    console.error("Disconnect GitHub Error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get GitHub OAuth URL
 */
export const getAuthUrl = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = process.env.GITHUB_CALLBACK_URL; // Optional, if you use it

    // Construct URL
    const rootUrl = "https://github.com/login/oauth/authorize";
    const options = {
      client_id: clientId as string,
      scope: "repo,user",
    };

    const qs = new URLSearchParams(options).toString();
    res.json({ url: `${rootUrl}?${qs}` });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * List repositories for the authenticated user
 */
export const listRepos = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const user = await User.findById(req.user?._id).select(
      "+githubAccessToken",
    );

    if (!user?.githubAccessToken) {
      res.status(400).json({ message: "GitHub not connected" });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 30;
    const search = (req.query.search as string) || "";

    const { repos, total, hasMore } = await githubService.listRepos(
      user.githubAccessToken,
      page,
      perPage,
      search,
    );

    res.json({
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        // Keep both conventions for compatibility
        fullName: repo.full_name,
        full_name: repo.full_name,
        private: repo.private,
        // snake_case so frontend can use repo.html_url and repo.default_branch directly
        html_url: repo.html_url,
        htmlUrl: repo.html_url,
        default_branch: repo.default_branch,
        defaultBranch: repo.default_branch,
        description: repo.description,
        // owner as object so frontend can use repo.owner.login
        owner: {
          login:
            typeof repo.owner === "string"
              ? repo.owner
              : (repo.owner as any)?.login,
        },
      })),
      total,
      hasMore,
      page,
    });
  } catch (error: any) {
    console.error("List Repos Error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * List commits for a specific repo
 */
export const listCommits = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { owner, repo } = req.params;
    const user = await User.findById(req.user?._id).select(
      "+githubAccessToken",
    );

    if (!user?.githubAccessToken) {
      res.status(400).json({ message: "GitHub not connected" });
      return;
    }

    const commits = await githubService.listCommits(
      user.githubAccessToken,
      owner as string,
      repo as string,
    );
    res.json(commits);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Detect framework and suggest settings
 */
export const detectFramework = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { owner, repo, branch } = req.body;
    const user = await User.findById(req.user?._id).select(
      "+githubAccessToken",
    );

    if (!user?.githubAccessToken) {
      res.status(400).json({ message: "GitHub not connected" });
      return;
    }

    const settings = await githubService.detectFramework(
      user.githubAccessToken,
      owner,
      repo,
      branch,
    );

    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Setup webhook for a repo
 */
export const setupWebhook = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { owner, repo, projectId } = req.body;
    const user = await User.findById(req.user?._id).select(
      "+githubAccessToken",
    );

    if (!user?.githubAccessToken) {
      res.status(400).json({ message: "GitHub not connected" });
      return;
    }

    // Use the configured PUBLIC_URL if set, otherwise fall back to request host
    const baseUrl = config.publicUrl || `${req.protocol}://${req.get("host")}`;
    const webhookUrl = `${baseUrl}/api/webhook/${projectId}`;
    console.log("[Webhook] Creating webhook URL:", webhookUrl);

    // Use a simple secret or the project ID for now
    await githubService.createWebhook(
      user.githubAccessToken,
      owner,
      repo,
      webhookUrl,
      projectId, // simple secret
    );

    // Auto-mark webhook as registered to disable polling
    await Project.findByIdAndUpdate(projectId, { webhookRegistered: true });

    res.json({ message: "Webhook created successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
