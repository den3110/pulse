import { Request, Response } from "express";
import sshService from "../services/sshService";
import { AuthRequest } from "../middleware/auth";

interface ToolDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  checkCmd: string;
  installCmd: string;
  uninstallCmd: string;
  category: "runtime" | "webserver" | "devtools" | "container" | "database";
  docs?: string;
  notes?: string;
}

const TOOLS: ToolDef[] = [
  // ── Runtimes ──
  {
    id: "node",
    name: "Node.js (via NVM)",
    icon: "⬢",
    description:
      "JavaScript runtime — installed via NVM for version management",
    checkCmd:
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; node -v 2>/dev/null || echo NOT_INSTALLED',
    installCmd:
      'curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm install --lts && nvm use --lts && node -v',
    uninstallCmd:
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm deactivate && nvm unload; rm -rf "$HOME/.nvm" && sed -i "/NVM_DIR/d" ~/.bashrc ~/.profile ~/.bash_profile 2>/dev/null; echo "Node.js & NVM removed"',
    category: "runtime",
    docs: "https://nodejs.org/en/docs",
    notes:
      "Installs via NVM (Node Version Manager) for easy version switching. Use 'nvm install <version>' to install additional versions. LTS version is installed by default.",
  },
  {
    id: "python3",
    name: "Python 3",
    icon: "🐍",
    description: "Python programming language & pip package manager",
    checkCmd: "python3 --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y python3 python3-pip python3-venv && python3 --version",
    uninstallCmd:
      "apt-get purge -y python3 python3-pip python3-venv && apt-get autoremove -y && echo 'Python 3 removed'",
    category: "runtime",
    docs: "https://docs.python.org/3/",
    notes:
      "Includes pip (package manager) and venv (virtual environments). Use 'pip3 install <package>' to install Python packages.",
  },
  {
    id: "bun",
    name: "Bun",
    icon: "🥟",
    description: "Ultra-fast JavaScript runtime, bundler & package manager",
    checkCmd: "bun --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "curl -fsSL https://bun.sh/install | bash && source ~/.bashrc && bun --version",
    uninstallCmd:
      "rm -rf ~/.bun && sed -i '/\.bun/d' ~/.bashrc ~/.profile 2>/dev/null && echo 'Bun removed'",
    category: "runtime",
    docs: "https://bun.sh/docs",
    notes:
      "All-in-one toolkit: runtime, bundler, test runner, and package manager. Drop-in replacement for Node.js in many cases.",
  },
  // ── Web Servers ──
  {
    id: "nginx",
    name: "Nginx",
    icon: "🌐",
    description: "High performance web server & reverse proxy",
    checkCmd: "nginx -v 2>&1 || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y nginx && systemctl enable nginx && systemctl start nginx && nginx -v 2>&1",
    uninstallCmd:
      "systemctl stop nginx 2>/dev/null; systemctl disable nginx 2>/dev/null; apt-get purge -y nginx nginx-common nginx-full && apt-get autoremove -y && rm -rf /etc/nginx && echo 'Nginx removed'",
    category: "webserver",
    docs: "https://nginx.org/en/docs/",
    notes:
      "Auto-enabled and started after install. Config files at /etc/nginx/. Use 'nginx -t' to test config, 'systemctl reload nginx' to apply changes.",
  },
  {
    id: "certbot",
    name: "Certbot (SSL)",
    icon: "🔒",
    description: "Free SSL certificates from Let's Encrypt",
    checkCmd: "certbot --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y certbot python3-certbot-nginx && certbot --version",
    uninstallCmd:
      "apt-get purge -y certbot python3-certbot-nginx && apt-get autoremove -y && rm -rf /etc/letsencrypt && echo 'Certbot removed'",
    category: "webserver",
    docs: "https://certbot.eff.org/",
    notes:
      "Includes Nginx plugin. Usage: 'certbot --nginx -d example.com' to auto-configure SSL. Certificates auto-renew via systemd timer.",
  },
  // ── Containers ──
  {
    id: "docker",
    name: "Docker",
    icon: "🐳",
    description: "Container runtime for building & running applications",
    checkCmd: "docker --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker && docker --version",
    uninstallCmd:
      "systemctl stop docker 2>/dev/null; systemctl disable docker 2>/dev/null; apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && apt-get autoremove -y && rm -rf /var/lib/docker /var/lib/containerd /etc/docker && echo 'Docker removed'",
    category: "container",
    docs: "https://docs.docker.com/",
    notes:
      "Installed via official Docker script. Auto-enabled on boot. Use 'docker ps' to list containers, 'docker logs <name>' to view logs.",
  },
  {
    id: "docker-compose",
    name: "Docker Compose",
    icon: "🐙",
    description: "Multi-container application orchestration",
    checkCmd:
      "docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y docker-compose-plugin && docker compose version",
    uninstallCmd:
      "apt-get purge -y docker-compose-plugin && apt-get autoremove -y && echo 'Docker Compose removed'",
    category: "container",
    docs: "https://docs.docker.com/compose/",
    notes:
      "Plugin for Docker. Use 'docker compose up -d' to start, 'docker compose down' to stop. Config via docker-compose.yml.",
  },
  // ── Dev Tools ──
  {
    id: "git",
    name: "Git",
    icon: "📦",
    description: "Version control system",
    checkCmd: "git --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd: "apt-get update -y && apt-get install -y git && git --version",
    uninstallCmd:
      "apt-get purge -y git && apt-get autoremove -y && echo 'Git removed'",
    category: "devtools",
    docs: "https://git-scm.com/doc",
    notes: "Essential for cloning repos and deploying code from GitHub/GitLab.",
  },
  {
    id: "pm2",
    name: "PM2",
    icon: "⚡",
    description: "Production process manager for Node.js applications",
    checkCmd:
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; pm2 --version 2>/dev/null || echo NOT_INSTALLED',
    installCmd:
      'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && npm install -g pm2 && pm2 --version',
    uninstallCmd:
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; pm2 kill 2>/dev/null; npm uninstall -g pm2 && echo "PM2 removed"',
    category: "devtools",
    docs: "https://pm2.keymetrics.io/docs/usage/quick-start/",
    notes:
      "Requires Node.js. Use 'pm2 start app.js', 'pm2 list' to manage processes. Run 'pm2 startup' to auto-start on boot.",
  },
  {
    id: "unzip",
    name: "Unzip",
    icon: "📂",
    description: "Extract ZIP archives — required for file uploads",
    checkCmd: "unzip -v 2>/dev/null | head -1 || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y unzip && unzip -v | head -1",
    uninstallCmd:
      "apt-get purge -y unzip && apt-get autoremove -y && echo 'Unzip removed'",
    category: "devtools",
  },
  {
    id: "yarn",
    name: "Yarn",
    icon: "🧶",
    description: "Fast, reliable package manager for Node.js",
    checkCmd:
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; yarn --version 2>/dev/null || echo NOT_INSTALLED',
    installCmd:
      'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && npm install -g yarn && yarn --version',
    uninstallCmd:
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; npm uninstall -g yarn && echo "Yarn removed"',
    category: "devtools",
    docs: "https://yarnpkg.com/getting-started",
    notes: "Requires Node.js. Alternative to npm with faster installs.",
  },
  {
    id: "htop",
    name: "htop",
    icon: "📊",
    description: "Interactive process viewer & system monitor",
    checkCmd: "htop --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y htop && htop --version",
    uninstallCmd:
      "apt-get purge -y htop && apt-get autoremove -y && echo 'htop removed'",
    category: "devtools",
  },
  // ── Databases ──
  {
    id: "mysql",
    name: "MySQL",
    icon: "🗄️",
    description: "Popular relational database server",
    checkCmd: "mysql --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y mysql-server && systemctl enable mysql && systemctl start mysql && mysql --version",
    uninstallCmd:
      "systemctl stop mysql 2>/dev/null; systemctl disable mysql 2>/dev/null; apt-get purge -y mysql-server mysql-client mysql-common && apt-get autoremove -y && rm -rf /var/lib/mysql /etc/mysql && echo 'MySQL removed'",
    category: "database",
    docs: "https://dev.mysql.com/doc/",
    notes:
      "Auto-started after install. Run 'mysql_secure_installation' to set root password. Connect with 'mysql -u root -p'.",
  },
  {
    id: "redis",
    name: "Redis",
    icon: "🔴",
    description: "In-memory data store for caching & messaging",
    checkCmd: "redis-server --version 2>/dev/null || echo NOT_INSTALLED",
    installCmd:
      "apt-get update -y && apt-get install -y redis-server && systemctl enable redis-server && systemctl start redis-server && redis-server --version",
    uninstallCmd:
      "systemctl stop redis-server 2>/dev/null; systemctl disable redis-server 2>/dev/null; apt-get purge -y redis-server && apt-get autoremove -y && rm -rf /var/lib/redis /etc/redis && echo 'Redis removed'",
    category: "database",
    docs: "https://redis.io/docs/",
    notes:
      "Listens on port 6379 by default. Config: /etc/redis/redis.conf. Use 'redis-cli' to interact. Consider setting 'requirepass' for security.",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    icon: "🍃",
    description: "NoSQL document database",
    checkCmd: "mongod --version 2>/dev/null | head -1 || echo NOT_INSTALLED",
    installCmd:
      'apt-get update -y && apt-get install -y gnupg curl && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list && apt-get update -y && apt-get install -y mongodb-org && systemctl enable mongod && systemctl start mongod && mongod --version | head -1',
    uninstallCmd:
      "systemctl stop mongod 2>/dev/null; systemctl disable mongod 2>/dev/null; apt-get purge -y mongodb-org* && apt-get autoremove -y && rm -rf /var/lib/mongodb /var/log/mongodb /etc/mongod.conf /etc/apt/sources.list.d/mongodb-org-7.0.list /usr/share/keyrings/mongodb-server-7.0.gpg && echo 'MongoDB removed'",
    category: "database",
    docs: "https://www.mongodb.com/docs/",
    notes:
      "Installs MongoDB 7.0 from official repo. Listens on port 27017. Use 'mongosh' to connect. Config: /etc/mongod.conf.",
  },
];

/** GET /servers/:serverId/setup/tools — return all tool definitions */
export const getTools = async (
  _req: AuthRequest,
  res: Response,
): Promise<void> => {
  res.json(TOOLS);
};

/** POST /servers/:serverId/setup/check — check all tools status (single SSH call) */
export const checkTools = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const serverId = req.params.serverId as string;

    // Build ONE combined command with delimiters
    const combined = TOOLS.map(
      (tool) =>
        `echo "###${tool.id}###"; ${tool.checkCmd}; echo "###END_${tool.id}###"`,
    ).join("; ");

    const { stdout } = await sshService.exec(serverId, combined, 30000);
    const output = stdout || "";

    // Parse results
    const results: Record<string, { installed: boolean; version: string }> = {};
    for (const tool of TOOLS) {
      const startTag = `###${tool.id}###`;
      const endTag = `###END_${tool.id}###`;
      const startIdx = output.indexOf(startTag);
      const endIdx = output.indexOf(endTag);

      if (startIdx === -1 || endIdx === -1) {
        results[tool.id] = { installed: false, version: "" };
        continue;
      }

      const section = output
        .substring(startIdx + startTag.length, endIdx)
        .trim();
      const isNotInstalled = section.includes("NOT_INSTALLED") || !section;
      const installed = !isNotInstalled;
      let version = "";
      if (installed) {
        const lines = section
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean);
        version = lines[lines.length - 1] || "";
      }
      results[tool.id] = { installed, version };
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/** POST /servers/:serverId/setup/check/:toolId — check single tool */
export const checkSingleTool = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const serverId = req.params.serverId as string;
    const toolId = req.params.toolId as string;
    const tool = TOOLS.find((t) => t.id === toolId);
    if (!tool) {
      res.status(404).json({ message: "Tool not found" });
      return;
    }

    const { stdout, code } = await sshService.exec(
      serverId,
      tool.checkCmd,
      10000,
    );
    const output = (stdout || "").trim();
    const isNotInstalled = output.includes("NOT_INSTALLED") || !output;
    const installed = !isNotInstalled && code === 0;
    let version = "";
    if (installed) {
      const lines = output
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean);
      version = lines[lines.length - 1] || "";
    }

    res.json({ installed, version });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/** GET /servers/:serverId/setup/install/:toolId — install a tool (SSE stream) */
export const installToolSSE = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const serverId = req.params.serverId as string;
  const toolId = req.params.toolId as string;
  const tool = TOOLS.find((t) => t.id === toolId);

  if (!tool) {
    res.status(404).json({ message: "Tool not found" });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client disconnected */
    }
  };

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    // Stream install output
    let exitCode = 0;
    await sshService.execStream(
      serverId,
      tool.installCmd,
      (data: string, type: "stdout" | "stderr") => {
        if (!aborted) {
          sendEvent("log", { text: data, type });
        }
      },
      (code: number) => {
        exitCode = code;
      },
    );

    if (aborted) return;

    // Re-check to get version
    if (exitCode === 0) {
      const check = await sshService.exec(serverId, tool.checkCmd, 10000);
      const checkOutput = (check.stdout || "").trim();
      const lines = checkOutput
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean);
      const version = lines[lines.length - 1] || "";

      sendEvent("done", {
        success: true,
        version: version.includes("NOT_INSTALLED") ? "" : version,
      });
    } else {
      sendEvent("done", {
        success: false,
        exitCode,
      });
    }
  } catch (error: any) {
    sendEvent("error", { message: error.message });
  } finally {
    if (!aborted) {
      res.end();
    }
  }
};

/** GET /servers/:serverId/setup/uninstall/:toolId — uninstall a tool (SSE stream) */
export const uninstallToolSSE = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const serverId = req.params.serverId as string;
  const toolId = req.params.toolId as string;
  const tool = TOOLS.find((t) => t.id === toolId);

  if (!tool) {
    res.status(404).json({ message: "Tool not found" });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client disconnected */
    }
  };

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    let exitCode = 0;
    await sshService.execStream(
      serverId,
      tool.uninstallCmd,
      (data: string, type: "stdout" | "stderr") => {
        if (!aborted) {
          sendEvent("log", { text: data, type });
        }
      },
      (code: number) => {
        exitCode = code;
      },
    );

    if (aborted) return;

    // Re-check to confirm removal
    const check = await sshService.exec(serverId, tool.checkCmd, 10000);
    const checkOutput = (check.stdout || "").trim();
    const stillInstalled =
      !!checkOutput && !checkOutput.includes("NOT_INSTALLED");

    sendEvent("done", {
      success: exitCode === 0 && !stillInstalled,
      removed: !stillInstalled,
    });
  } catch (error: any) {
    sendEvent("error", { message: error.message });
  } finally {
    if (!aborted) {
      res.end();
    }
  }
};
