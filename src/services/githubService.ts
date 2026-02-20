import axios from "axios";
import config from "../config";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string;
  default_branch: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  html_url: string;
  author: {
    login: string;
    avatar_url: string;
  };
}

export class GitHubService {
  private static instance: GitHubService;
  private readonly baseUrl = "https://api.github.com";

  private constructor() {}

  public static getInstance(): GitHubService {
    if (!GitHubService.instance) {
      GitHubService.instance = new GitHubService();
    }
    return GitHubService.instance;
  }

  /**
   * Exchange temporary code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
    try {
      const response = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          code,
        },
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      console.log("GitHub Token Response:", response.data);

      if (response.data.error) {
        throw new Error(response.data.error_description || response.data.error);
      }

      return response.data.access_token;
    } catch (error: any) {
      console.error(
        "GitHub Token Exchange Error:",
        error.response?.data || error.message,
      );
      throw new Error("Failed to exchange GitHub code for token");
    }
  }

  /**
   * Get authenticated user profile
   */
  async getUserProfile(token: string): Promise<any> {
    try {
      console.log(
        "Fetching user profile with token:",
        token ? "Token present" : "Token missing",
      );
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "PulseDeploy/1.0",
      };
      const response = await axios.get(`${this.baseUrl}/user`, {
        headers,
      });
      return response.data;
    } catch (error: any) {
      console.error("GitHub Get User Error:", error.message);
      if (error.response) {
        console.error(
          "GitHub User Response Error:",
          error.response.status,
          error.response.data,
        );
      }
      throw new Error("Failed to fetch GitHub user");
    }
  }

  /**
   * List user's repositories (including private ones if scope allows)
   */
  async listRepos(
    token: string,
    page = 1,
    perPage = 30,
    search = "",
  ): Promise<{ repos: GitHubRepo[]; total: number; hasMore: boolean }> {
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "PulseDeploy/1.0",
      };

      if (search && search.trim()) {
        // Use GitHub search API when query provided
        const response = await axios.get(
          `${this.baseUrl}/search/repositories`,
          {
            headers,
            params: {
              q: `${search.trim()} user:${await this._getUsername(token)}`,
              sort: "updated",
              order: "desc",
              per_page: perPage,
              page,
            },
          },
        );
        return {
          repos: response.data.items as GitHubRepo[],
          total: response.data.total_count,
          hasMore: response.data.total_count > page * perPage,
        };
      } else {
        // List all user repos with pagination
        const response = await axios.get(`${this.baseUrl}/user/repos`, {
          headers,
          params: {
            sort: "updated",
            per_page: perPage,
            page,
            affiliation: "owner,collaborator",
          },
        });
        // GitHub returns Link header for pagination; parse total from it
        const linkHeader: string = response.headers["link"] || "";
        const hasMore = linkHeader.includes('rel="next"');
        return {
          repos: response.data as GitHubRepo[],
          total: -1, // unknown total for list endpoint
          hasMore,
        };
      }
    } catch (error: any) {
      console.error("GitHub List Repos Error:", error.message);
      throw new Error("Failed to list repositories");
    }
  }

  /** Helper: get authenticated username for search scoping */
  private async _getUsername(token: string): Promise<string> {
    try {
      const r = await axios.get(`${this.baseUrl}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "PulseDeploy/1.0",
        },
      });
      return r.data.login;
    } catch {
      return "";
    }
  }

  /**
   * List recent commits for a repo
   */
  async listCommits(
    token: string,
    owner: string,
    repo: string,
    branch?: string,
    limit = 10,
  ): Promise<GitHubCommit[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/commits`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "PulseDeploy/1.0",
          },
          params: {
            sha: branch,
            per_page: limit,
          },
        },
      );
      return response.data;
    } catch (error: any) {
      console.error("GitHub List Commits Error:", error.message);
      throw new Error("Failed to list commits");
    }
  }

  /**
   * Detect framework by analyzing repo files
   */
  async detectFramework(
    token: string,
    owner: string,
    repo: string,
    branch?: string,
  ): Promise<{
    type: "create-react-app" | "next" | "node" | "static" | "unknown";
    buildCommand: string;
    startCommand: string;
    outputDir: string;
  }> {
    try {
      // Check for package.json
      const packageJsonContent = await this.getFileContent(
        token,
        owner,
        repo,
        "package.json",
        branch,
      );

      if (packageJsonContent) {
        const pkg = JSON.parse(packageJsonContent);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.next) {
          return {
            type: "next",
            buildCommand: "npm install && npm run build",
            startCommand: "npm start",
            outputDir: ".next",
          };
        }
        if (deps["react-scripts"]) {
          return {
            type: "create-react-app",
            buildCommand: "npm install && npm run build",
            startCommand: "serve -s build",
            outputDir: "build",
          };
        }
        // Default Node
        return {
          type: "node",
          buildCommand: "npm install",
          startCommand: "npm start",
          outputDir: "",
        };
      }

      return {
        type: "unknown",
        buildCommand: "",
        startCommand: "",
        outputDir: "",
      };
    } catch (error) {
      console.warn("Framework detection failed:", error);
      return {
        type: "unknown",
        buildCommand: "",
        startCommand: "",
        outputDir: "",
      };
    }
  }

  /**
   * Helper to get file content from GitHub
   */
  private async getFileContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    branch?: string,
  ): Promise<string | null> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3.raw", // Request raw content
            "User-Agent": "PulseDeploy/1.0",
          },
          params: {
            ref: branch,
          },
        },
      );
      return typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a webhook for the repository
   */
  async createWebhook(
    token: string,
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string,
  ): Promise<void> {
    try {
      // Check if webhook already exists to avoid duplicates
      const existingHooks = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/hooks`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "PulseDeploy/1.0",
          },
        },
      );

      const exists = existingHooks.data.find(
        (hook: any) => hook.config.url === webhookUrl,
      );
      if (exists) {
        console.log("Webhook already exists for", repo);
        return;
      }

      await axios.post(
        `${this.baseUrl}/repos/${owner}/${repo}/hooks`,
        {
          name: "web",
          active: true,
          events: ["push"],
          config: {
            url: webhookUrl,
            content_type: "json",
            secret: secret,
            insecure_ssl: "0",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "PulseDeploy/1.0",
          },
        },
      );
    } catch (error: any) {
      console.error(
        "GitHub Create Webhook Error:",
        error.response?.data || error.message,
      );
      throw new Error(
        error.response?.data?.message ||
          error.response?.data?.errors?.[0]?.message ||
          "Failed to create webhook",
      );
    }
  }

  /**
   * Update commit status (pending/success/failure)
   */
  async updateCommitStatus(
    token: string,
    owner: string,
    repo: string,
    sha: string,
    state: "pending" | "success" | "failure" | "error",
    description: string,
    targetUrl: string,
  ): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/repos/${owner}/${repo}/statuses/${sha}`,
        {
          state,
          description,
          target_url: targetUrl,
          context: "Pulse",
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "PulseDeploy/1.0",
          },
        },
      );
    } catch (error: any) {
      // Don't throw, just log. We don't want deployment to fail just because status update failed.
      console.warn("GitHub Update Commit Status Error:", error.message);
    }
  }
}

export default GitHubService.getInstance();
