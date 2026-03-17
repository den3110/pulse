import { Request, Response } from "express";
import Server from "../models/Server";
import mongoose from "mongoose";
import sshService from "../services/sshService";
import { AuthRequest } from "../middleware/auth";
import bcrypt from "bcryptjs";
import axios from "axios";

/* ───────── App definitions ───────── */

interface OneClickApp {
  id: string;
  name: string;
  icon: string;
  description: string;
  docs: string;
  defaultPort: number;
  providers?: { id: string; name: string; icon: string }[];
}

const APPS: OneClickApp[] = [
  {
    id: "cliproxyapi",
    name: "CLIProxyAPI",
    icon: "🔌",
    description:
      "OpenAI/Gemini/Claude compatible API proxy — access CLI AI models via standard API endpoints",
    docs: "https://help.router-for.me/",
    defaultPort: 8317,
    providers: [
      { id: "gemini", name: "Gemini", icon: "✨" },
      { id: "openai", name: "OpenAI", icon: "🤖" },
      { id: "claude", name: "Claude", icon: "🟠" },
      { id: "qwen", name: "Qwen", icon: "🌐" },
      { id: "iflow", name: "iFlow", icon: "🌊" },
      { id: "codex", name: "Codex", icon: "💻" },
    ],
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    icon: "🦞",
    description:
      "Personal AI assistant — autonomous agent for WhatsApp, Telegram, Slack, Discord & more",
    docs: "https://docs.openclaw.ai/",
    defaultPort: 18789,
  },
];

/* ───────── Helpers ───────── */

const sendSSE = (res: Response, event: string, data: any) => {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client disconnected */
  }
};

const sseHeaders = (res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
};

/** Run a command via SSH and return { code, output } */
const runStep = async (
  serverId: string,
  cmd: string,
  res: Response,
  abortRef: { aborted: boolean },
): Promise<{ code: number; output: string }> => {
  let output = "";
  let exitCode = 0;

  await sshService.execStream(
    serverId,
    cmd,
    (data: string, type: "stdout" | "stderr") => {
      output += data;
      if (!abortRef.aborted) sendSSE(res, "log", { text: data, type });
    },
    (code: number) => {
      exitCode = code;
    },
  );

  return { code: exitCode, output };
};

/* ───────── GET /apps ───────── */

export const getApps = async (
  _req: AuthRequest,
  res: Response,
): Promise<void> => {
  res.json(APPS);
};

/* ───────── POST /check ───────── */

export const checkApps = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const serverId = req.params.serverId as string;

    const combined = [
      'echo "###cliproxyapi###"; if docker inspect cliproxyapi >/dev/null 2>&1; then docker ps -a -f name=^/cliproxyapi$ --format "{{.Status}}"; else echo NOT_INSTALLED; fi; echo "###END_cliproxyapi###"',
      'echo "###openclaw###"; if docker inspect openclaw >/dev/null 2>&1; then docker ps -a -f name=^/openclaw$ --format "{{.Status}}"; else echo NOT_INSTALLED; fi; echo "###END_openclaw###"',
    ].join("; ");

    const { stdout } = await sshService.exec(serverId, combined, 30000);
    const output = stdout || "";

    const results: Record<
      string,
      { installed: boolean; version: string; containerStatus?: string }
    > = {};

    for (const appId of ["cliproxyapi", "openclaw"]) {
      const startTag = `###${appId}###`;
      const endTag = `###END_${appId}###`;
      const startIdx = output.indexOf(startTag);
      const endIdx = output.indexOf(endTag);

      if (startIdx === -1 || endIdx === -1) {
        results[appId] = { installed: false, version: "" };
        continue;
      }

      const section = output
        .substring(startIdx + startTag.length, endIdx)
        .trim();

      const isNotInstalled = section.includes("NOT_INSTALLED") || !section;
      const installed = !isNotInstalled;
      let version = "";
      let containerStatus = "";

      if (installed) {
        const lines = section
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean);
        containerStatus = lines[lines.length - 1] || "";
        // For version we can just say "Docker" or parse the image tag if we wanted. For now, we'll just indicate it's containerized.
        version = "Docker";
      }
      results[appId] = { installed, version, containerStatus };
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/* ───────── SSE Install: CLIProxyAPI ───────── */

export const installCLIProxyAPI = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const serverId = req.params.serverId as string;
  const providerParam = (req.query.provider as string) || "gemini";
  const providers = providerParam
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const port = parseInt((req.query.port as string) || "8317", 10);
  const adminPassword = (req.query.adminPassword as string) || "";
  let keys: Record<string, string> = {};
  try {
    if (req.query.keys) keys = JSON.parse(req.query.keys as string);
  } catch (e) {}

  sseHeaders(res);

  const abortRef = { aborted: false };
  req.on("close", () => {
    abortRef.aborted = true;
  });

  try {
    const steps = [
      {
        label: "Cleaning up legacy installations (if any)...",
        cmd: "systemctl stop cliproxyapi 2>/dev/null; systemctl disable cliproxyapi 2>/dev/null; rm -f /etc/systemd/system/cliproxyapi.service 2>/dev/null; systemctl daemon-reload 2>/dev/null; pkill cli-proxy-api 2>/dev/null || true",
      },
      {
        label: "Preparing deployment directory...",
        cmd: "mkdir -p /root/cliproxyapi",
      },
      {
        label: `Generating config for provider: ${providers.join(", ")}...`,
        cmd: (() => {
          const configContent = buildConfigYaml(
            providers,
            port,
            keys,
            adminPassword,
          );
          const encodedConfig = Buffer.from(configContent).toString("base64");
          return `echo "${encodedConfig}" | base64 -d > /root/cliproxyapi/config.yaml`;
        })(),
      },
      {
        label: "Generating Dockerfile & docker-compose.yml...",
        cmd: (() => {
          const dockerfile = `
FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y curl tar bash jq ca-certificates && rm -rf /var/lib/apt/lists/*
RUN ARCH=$(uname -m) && case "$ARCH" in x86_64) ARCH="amd64";; aarch64) ARCH="arm64";; esac && \\
    LATEST=$(curl -fsSL https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest | jq -r .tag_name) && \\
    VERSION=$(echo $LATEST | sed "s/^v//") && \\
    DL_URL="https://github.com/router-for-me/CLIProxyAPI/releases/download/\${LATEST}/CLIProxyAPI_\${VERSION}_linux_\${ARCH}.tar.gz" && \\
    curl -fsSL -L -o archive.tar.gz "$DL_URL" && \\
    tar -xzf archive.tar.gz && \\
    if [ -f cli-proxy-api ]; then mv cli-proxy-api /usr/local/bin/cli-proxy-api; \\
    elif [ -f CLIProxyAPI ]; then mv CLIProxyAPI /usr/local/bin/cli-proxy-api; \\
    else echo "ERROR: Binary not found in archive" && exit 1; fi && \\
    chmod +x /usr/local/bin/cli-proxy-api && \\
    rm archive.tar.gz
WORKDIR /root/.cli-proxy-api
ENV HOME=/root
ENTRYPOINT env && /usr/local/bin/cli-proxy-api $0 $@
`;
          const composeYaml = `
services:
  cliproxyapi:
    build: .
    container_name: cliproxyapi
    restart: always
    network_mode: host
    environment:
      - HOME=/root
    volumes:
      - ./config.yaml:/root/.cli-proxy-api/config.yaml
      - ./.cli-proxy-api/auth:/root/.cli-proxy-api/auth
    command: ["-config", "/root/.cli-proxy-api/config.yaml"]
`;
          const escapedCompose = composeYaml.trim().replace(/'/g, "'\\''");
          const escapedDockerfile = dockerfile.trim().replace(/'/g, "'\\''");
          const escapedPassword = (adminPassword || "localadmin123").replace(
            /'/g,
            "'\\''",
          );
          return `mkdir -p /root/cliproxyapi/.cli-proxy-api/auth && printf '%s\\n' '${escapedCompose}' > /root/cliproxyapi/docker-compose.yml && printf '%s\\n' '${escapedDockerfile}' > /root/cliproxyapi/Dockerfile && printf '%s' '${escapedPassword}' > /root/cliproxyapi/admin_password`;
        })(),
      },
      {
        label: "Configuring Firewall...",
        cmd: `command -v ufw >/dev/null 2>&1 && ufw allow ${port}/tcp || echo "UFW not found, skipping firewall configuration"`,
      },
      {
        label: "Building & Starting Docker container...",
        cmd: "cd /root/cliproxyapi && (docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null || true); if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then apt-get update && apt-get install -y docker-compose-plugin; fi; (docker compose up -d --build || docker-compose up -d --build) && sleep 5",
      },
      {
        label: "Verifying installation...",
        cmd: `docker ps -f name=^/cliproxyapi$ | grep cliproxyapi && echo "CLIProxyAPI installed and running on port ${port}"`,
      },
    ];

    for (let i = 0; i < steps.length; i++) {
      if (abortRef.aborted) return;

      sendSSE(res, "step", {
        step: i + 1,
        total: steps.length,
        label: steps[i].label,
      });

      const { code } = await runStep(serverId, steps[i].cmd, res, abortRef);

      if (code !== 0) {
        sendSSE(res, "log", {
          text: `\n❌ Step ${i + 1} failed (exit code ${code})\n`,
          type: "stderr",
        });
        sendSSE(res, "done", {
          success: false,
          error: `Step ${i + 1} failed: ${steps[i].label}`,
        });
        return;
      }
    }

    if (abortRef.aborted) return;
    sendSSE(res, "done", { success: true, port });
  } catch (error: any) {
    sendSSE(res, "error", { message: error.message });
  } finally {
    if (!abortRef.aborted) res.end();
  }
};

/* ───────── SSE Install: OpenClaw ───────── */

export const installOpenClaw = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const serverId = req.params.serverId as string;

  sseHeaders(res);

  const abortRef = { aborted: false };
  req.on("close", () => {
    abortRef.aborted = true;
  });

  try {
    const steps = [
      {
        label: "Preparing deployment directory...",
        cmd: "mkdir -p /root/openclaw",
      },
      {
        label: "Generating docker-compose.yml...",
        cmd: (() => {
          // Initial minimal config that won't fail strict validation
          const initialConfig = JSON.stringify(
            {
              gateway: {
                bind: "lan",
              },
            },
            null,
            2,
          );
          const composeYaml = `
services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw
    restart: always
    user: root
    network_mode: host
    environment:
      - HOME=/root
      - OPENCLAW_CONFIG_PATH=/root/.openclaw/openclaw.json
    volumes:
      - /root/openclaw/data:/root/.openclaw
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        (which chromium || which chromium-browser) 2>/dev/null || (apk add --no-cache chromium 2>/dev/null || (apt-get update -qq && apt-get install -y -qq chromium) 2>/dev/null) || true
        exec openclaw gateway --port 18789 --verbose --allow-unconfigured
`;
          const escapedCompose = composeYaml.trim().replace(/'/g, "'\\''");
          const safeInitConfig = Buffer.from(initialConfig).toString("base64");
          return `mkdir -p /root/openclaw/data/workspace && (test -s /root/openclaw/data/openclaw.json || echo "${safeInitConfig}" | base64 -d > /root/openclaw/data/openclaw.json) && printf '%s\\n' '${escapedCompose}' > /root/openclaw/docker-compose.yml`;
        })(),
      },
      {
        label: "Configuring Firewall...",
        cmd: `command -v ufw >/dev/null 2>&1 && ufw allow 18789/tcp || echo "UFW not found, skipping firewall configuration"`,
      },
      {
        label: "Starting Docker container...",
        cmd: "cd /root/openclaw && (docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null || true); if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then apt-get update && apt-get install -y docker-compose-plugin; fi; (docker compose up -d || docker-compose up -d) && sleep 5",
      },
      {
        label: "Verifying OpenClaw installation...",
        cmd: 'docker ps -f name=^/openclaw$ | grep openclaw && echo "OpenClaw installed and running"',
      },
    ];

    for (let i = 0; i < steps.length; i++) {
      if (abortRef.aborted) return;

      sendSSE(res, "step", {
        step: i + 1,
        total: steps.length,
        label: steps[i].label,
      });

      const { code } = await runStep(serverId, steps[i].cmd, res, abortRef);

      // Step 3 (onboard) is allowed to fail
      if (code !== 0 && i !== 2) {
        sendSSE(res, "log", {
          text: `\n❌ Step ${i + 1} failed (exit code ${code})\n`,
          type: "stderr",
        });
        sendSSE(res, "done", {
          success: false,
          error: `Step ${i + 1} failed: ${steps[i].label}`,
        });
        return;
      }
    }

    if (abortRef.aborted) return;
    sendSSE(res, "done", { success: true });
  } catch (error: any) {
    sendSSE(res, "error", { message: error.message });
  } finally {
    if (!abortRef.aborted) res.end();
  }
};

/* ───────── SSE Uninstall ───────── */

export const uninstallApp = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const serverId = req.params.serverId as string;
  const appId = req.params.appId as string;

  const uninstallCmds: Record<string, string> = {
    cliproxyapi: [
      "cd /root/cliproxyapi 2>/dev/null && (docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null || true)",
      "docker rm -f cliproxyapi 2>/dev/null || true",
      "rm -rf /root/cliproxyapi",
      'echo "CLIProxyAPI removed"',
    ].join(" && "),
    openclaw: [
      "cd /root/openclaw 2>/dev/null && (docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null || true)",
      "docker rm -f openclaw 2>/dev/null || true",
      "rm -rf /root/openclaw",
      'echo "OpenClaw removed"',
    ].join(" && "),
  };

  const cmd = uninstallCmds[appId];
  if (!cmd) {
    res.status(404).json({ message: "App not found" });
    return;
  }

  sseHeaders(res);

  const abortRef = { aborted: false };
  req.on("close", () => {
    abortRef.aborted = true;
  });

  try {
    const { code } = await runStep(serverId, cmd, res, abortRef);

    if (abortRef.aborted) return;
    sendSSE(res, "done", { success: code === 0 });
  } catch (error: any) {
    sendSSE(res, "error", { message: error.message });
  } finally {
    if (!abortRef.aborted) res.end();
  }
};

/* ───────── Config builder ───────── */

function buildConfigYaml(
  providers: string[],
  port: number,
  keys: Record<string, string>,
  adminPassword?: string,
): string {
  const providerBlock = providers
    .map((p) => {
      let block = `  ${p}:\n    enabled: true`;
      if (keys[p]) {
        block += `\n    api_key: "${keys[p]}"`;
      }
      return block;
    })
    .join("\n");

  // Default pasword is localadmin123 if not provided
  // It requires bcrypt format starting with $2a$08$ for CLIProxyAPI
  let hashedSecret =
    "$2a$08$XwLio.T5.xQf/Z3Tqj/T/O8m4g6L1R/sT9F5H/f7xXjT2/v92Zg/O"; // localadmin123

  if (adminPassword) {
    // Create a bcrypt hash with cost factor 8 (required by cliproxyapi parsing)
    hashedSecret = bcrypt.hashSync(adminPassword, 8);
  }

  return `# CLIProxyAPI Configuration — auto-generated
# Providers: ${providers.join(", ")} | Port: ${port}

port: ${port}
host: "0.0.0.0"

auth-dir: "/root/.cli-proxy-api/auth"

remote-management:
  secret-key: "${hashedSecret}"
  allow-remote: true

providers:
${providerBlock}
logging:
  level: "info"
`;
}

/* ───────── OAuth Flow ───────── */

export const getOAuthUrl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const serverId = req.params.serverId;
    const provider = req.query.provider as string;

    if (!provider) {
      res.status(400).json({ message: "Provider is required" });
      return;
    }

    // Run the cli-proxy-api login command in the background, redirecting output to a file
    // e.g. `cli-proxy-api -gemini-login`
    // The command usually blocks until callback or timeout, so we run it in background
    // and continuously grep the output file for the auth URL.
    const providerToEndpoint: Record<string, string> = {
      gemini: "gemini-cli-auth-url",
      claude: "anthropic-auth-url",
      qwen: "qwen-auth-url",
      iflow: "iflow-auth-url",
      openai: "openai-auth-url",
      codex: "codex-auth-url",
    };

    const endpoint = providerToEndpoint[provider];
    if (!endpoint) {
      res.status(400).json({
        message: `Provider ${provider} does not support OAuth configuration.`,
      });
      return;
    }

    // 1. Ensure config has a management key (for older installs). If not, add one and restart.
    const ensureKeyCmd = `
      AUTH_PASS=$(cat /root/cliproxyapi/admin_password 2>/dev/null || echo "localadmin123")
      sed -i '/allow-remote-management: false/d' /root/cliproxyapi/config.yaml 2>/dev/null || true
      if [ -f /root/cliproxyapi/config.yaml ] && ! grep -q "remote-management:" /root/cliproxyapi/config.yaml; then
        printf "\\nremote-management:\\n  secret-key: \\"$AUTH_PASS\\"\\n\\n" >> /root/cliproxyapi/config.yaml
      fi
      
      docker restart cliproxyapi || true
      sleep 3
    `;
    await sshService.exec(serverId as string, ensureKeyCmd);

    // 2. Fetch the URL via the Management API
    const portCmd = `grep "port:" /root/cliproxyapi/config.yaml | head -1 | awk '{print $2}'`;
    let portOutput = (
      await sshService.exec(serverId as string, portCmd)
    ).stdout.trim();
    if (!portOutput) portOutput = "8317";

    const fetchUrlCmd = `
      AUTH_PASS=$(cat /root/cliproxyapi/admin_password 2>/dev/null || echo "localadmin123"); curl -sS -H "Authorization: Bearer $AUTH_PASS" "http://localhost:${portOutput}/v0/management/${endpoint}?is_webui=true"
    `;

    const { stdout, stderr } = await sshService.exec(
      serverId as string,
      fetchUrlCmd,
    );

    try {
      if (!stdout.trim() && stderr) {
        throw new Error(stderr);
      }
      const response = JSON.parse(stdout);
      if (response.status !== "ok" || !response.url) {
        throw new Error(
          response.error || "Invalid response from Management API",
        );
      }
      res.json({ url: response.url });
    } catch (e: any) {
      // If we failed, let's also fetch the service status to debug
      const { stdout: statusInfo } = await sshService.exec(
        serverId as string,
        "docker logs --tail 20 cliproxyapi 2>&1",
      );
      res.status(500).json({
        message:
          "Failed to generate OAuth URL. Make sure CLIProxyAPI is running.",
        details: `CURL Output: ${stdout}\\nError: ${e.message}\\n\\nService Status:\\n${statusInfo}`,
      });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const submitOAuthCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const serverId = req.params.serverId;
    const { callbackUrl } = req.body;

    if (!callbackUrl) {
      res.status(400).json({ message: "Callback URL is required" });
      return;
    }

    // Ensure it's a localhost URL
    if (
      !callbackUrl.includes("127.0.0.1") &&
      !callbackUrl.includes("localhost")
    ) {
      res.status(400).json({
        message:
          "Invalid callback URL format. Must be the localhost redirect URL.",
      });
      return;
    }

    // Execute the callback URL directly on the VPS
    // We use curl to hit the localhost endpoint that the background cli-proxy-api process is listening on
    // Escape single quotes just in case. Use -L to follow redirects since OAuth callbacks often 302 to a success page.
    const safeUrl = callbackUrl.replace(/'/g, "'\\''");
    const curlCmd = `curl -sS -L -o /dev/null -w "%{http_code}" '${safeUrl}'`;

    const { stdout: statusCode, stderr } = await sshService.exec(
      serverId as string,
      curlCmd,
    );

    const code = statusCode.trim();
    if (code !== "200" && code !== "302") {
      res.status(400).json({
        message: `Authentication failed (HTTP ${code}). Details: ${stderr}`,
      });
      return;
    }

    res.json({ success: true, message: "Authentication successful!" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
/* ───────── App Detail & Management ───────── */

export const getAppDetail = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, appId } = req.params;
    const app = APPS.find((a) => a.id === appId);
    if (!app) {
      res.status(404).json({ message: "App not found" });
      return;
    }

    // Fetch server for IP address
    const Server = mongoose.model("Server");
    const serverParams = await Server.findById(serverId);
    const hostIp = serverParams ? serverParams.host : "";

    const { stdout } = await sshService.exec(
      serverId as string,
      `docker ps -a -f name=^/${appId}$ --format '{{json .}}'`,
    );

    if (!stdout.trim()) {
      res.json({ ...app, installed: false });
      return;
    }

    const containerInfo = JSON.parse(stdout);
    res.json({
      ...app,
      installed: true,
      containerStatus: containerInfo.Status,
      state: containerInfo.State,
      created: containerInfo.CreatedAt,
      hostIp,
      port: app.id === "cliproxyapi" ? 8317 : app.defaultPort,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getAppLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, appId } = req.params;
    const lines = parseInt((req.query.lines as string) || "100", 10);

    // Using 2>&1 to capture both stdout and stderr from docker logs
    const { stdout, stderr } = await sshService.exec(
      serverId as string,
      `docker logs --tail ${lines} ${appId} 2>&1`,
    );

    res.json({ logs: stdout || stderr });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getAppConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, appId } = req.params;

    let path = `/root/${appId}/config.yaml`;
    if (appId === "openclaw") {
      // OpenClaw uses openclaw.json (JSON format) mounted at /root/openclaw/data/
      path = `/root/openclaw/data/openclaw.json`;
    }

    let { stdout, stderr, code } = await sshService.exec(
      serverId as string,
      `cat ${path}`,
    );

    if (code !== 0) {
      if (appId === "openclaw") {
        // Return empty config for OpenClaw if the file doesn't exist yet
        res.json({ content: "" });
        return;
      }
      res
        .status(404)
        .json({ message: `Configuration file not found: ${stderr}` });
      return;
    }

    // Workaround for CLIProxyAPI bug: it rewrites "secret-key:" as "secret key:"
    // after hashing the password, which breaks yaml parsing on the next restart.
    if (appId === "cliproxyapi") {
      stdout = stdout.replace(/secret key:/g, "secret-key:");
    }

    res.json({ content: stdout });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const saveAppConfig = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, appId } = req.params;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ message: "Content is required" });
      return;
    }

    let path = `/root/${appId}/config.yaml`;
    if (appId === "openclaw") {
      path = `/root/${appId}/docker-compose.yml`;
    }

    let processedContent = content;
    // Workaround for CLIProxyAPI bug and user typo (allow-remote-management)
    if (appId === "cliproxyapi") {
      processedContent = processedContent.replace(
        /secret key:/g,
        "secret-key:",
      );
      processedContent = processedContent.replace(
        /allow-remote-management:/g,
        "allow-remote:",
      );
    }

    const escapedContent = processedContent.replace(/'/g, "'\\''");
    const cmd = `printf '%s\\n' '${escapedContent}' > ${path} && docker restart -t 2 ${appId}`;

    const { stderr, code } = await sshService.exec(serverId as string, cmd);

    if (code !== 0) {
      throw new Error(`Failed to save config: ${stderr}`);
    }

    res.json({ success: true, message: "Configuration saved successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateAppPassword = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, appId } = req.params;
    const { password } = req.body;

    if (appId !== "cliproxyapi") {
      res
        .status(400)
        .json({ message: "Password update only supported for CLIProxyAPI" });
      return;
    }

    if (!password) {
      res.status(400).json({ message: "Password is required" });
      return;
    }

    // Hash the password
    const hashedSecret = bcrypt.hashSync(password, 8);
    const path = `/root/${appId}/config.yaml`;

    // 1. Read existing config
    let { stdout, code, stderr } = await sshService.exec(
      serverId as string,
      `cat ${path}`,
    );
    if (code !== 0) {
      res
        .status(404)
        .json({ message: `Configuration file not found: ${stderr}` });
      return;
    }

    // 2. Overwrite the secret key
    // Handle both formats due to the bug mentioned in saveAppConfig
    let newContent = stdout.replace(
      /secret-key:\s*".*"/g,
      `secret-key: "${hashedSecret}"`,
    );
    newContent = newContent.replace(
      /secret key:\s*".*"/g,
      `secret-key: "${hashedSecret}"`,
    );

    // 3. Save back and restart
    const escapedContent = newContent.replace(/'/g, "'\\''");
    const escapedPassword = password.replace(/'/g, "'\\''");
    const cmd = `printf '%s\\n' '${escapedContent}' > ${path} && printf '%s' '${escapedPassword}' > /root/${appId}/admin_password && docker restart -t 2 ${appId}`;

    const execRes = await sshService.exec(serverId as string, cmd);

    if (execRes.code !== 0) {
      throw new Error(`Failed to save new password config: ${execRes.stderr}`);
    }

    res.json({ success: true, message: "Password updated successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const manageAppAction = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { serverId, appId } = req.params;
  const action = req.query.action as string; // 'start', 'stop', 'restart'

  if (!["start", "stop", "restart"].includes(action)) {
    res.status(400).json({ message: "Invalid action" });
    return;
  }

  sseHeaders(res);
  const abortRef = { aborted: false };
  req.on("close", () => {
    abortRef.aborted = true;
  });

  try {
    sendSSE(res, "step", {
      step: 1,
      total: 1,
      label: `${action === "stop" ? "Stopping" : action === "start" ? "Starting" : "Restarting"} container ${appId}...`,
    });

    const { code } = await runStep(
      serverId as string,
      `docker ${action} ${appId}`,
      res,
      abortRef,
    );

    if (code !== 0) {
      sendSSE(res, "done", {
        success: false,
        error: `Failed to ${action} ${appId}`,
      });
      return;
    }

    if (abortRef.aborted) return;
    sendSSE(res, "done", { success: true });
  } catch (error: any) {
    sendSSE(res, "error", { message: error.message });
  } finally {
    if (!abortRef.aborted) res.end();
  }
};

export const proxyAppAPI = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serverId, appId } = req.params;
    const proxyPath = req.params[0]; // The wildcard match

    if (appId !== "cliproxyapi") {
      res.status(400).json({ message: "Proxy not supported for this app" });
      return;
    }

    const method = req.method;
    const bodyStr =
      req.body && Object.keys(req.body).length > 0
        ? JSON.stringify(req.body)
        : "";
    const escapedBody = bodyStr.replace(/'/g, "'\\''");

    let curlCmd = `AUTH_PASS=$(cat /root/cliproxyapi/admin_password 2>/dev/null || echo "localadmin123"); curl -s -X ${method} -H "Authorization: Bearer $AUTH_PASS"`;
    if (bodyStr) {
      curlCmd += ` -H "Content-Type: application/json" -d '${escapedBody}'`;
    }

    // append query string
    const urlParts = req.url.split("?");
    const queryString = urlParts.length > 1 ? `?${urlParts[1]}` : "";

    curlCmd += ` 'http://127.0.0.1:8317/v0/management/${proxyPath}${queryString}'`;

    console.log("proxyAppAPI executing command: ", curlCmd);

    const { stdout, stderr, code } = await sshService.exec(
      serverId as string,
      curlCmd,
    );

    if (code !== 0) {
      res.status(500).json({ message: "Proxy command failed", error: stderr });
      return;
    }

    try {
      res.json(JSON.parse(stdout));
    } catch {
      res.send(stdout);
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/* ───────── OpenClaw Custom Endpoints ───────── */

export const getOpenClawParsedLogs = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const { serverId } = req.params;
    const server = await Server.findById(serverId);
    if (!server || server.owner.toString() !== req.user?._id.toString()) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const { stdout, stderr, code } = await sshService.exec(
      server._id.toString(),
      "docker logs --tail 200 openclaw || true",
    );

    if (code !== 0 && code !== null) {
      res
        .status(500)
        .json({ message: "Failed to fetch logs", details: stderr });
      return;
    }

    const logLines = stdout.split("\n").concat(stderr.split("\n"));

    // Parse logs for autonomous actions
    // Searching for keywords like "Tool Executed", "Thinking", "Action" etc.
    const actions: Array<{
      timestamp: string;
      content: string;
      type: "tool" | "thought" | "action" | "error" | "info";
    }> = [];

    const timeRegex =
      /^\[?(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z|(?:\d{2}:\d{2}:\d{2}))\]?\s*/;

    for (const line of logLines) {
      if (!line.trim()) continue;

      let timestamp = new Date().toISOString();
      let content = line;
      let type: "tool" | "thought" | "action" | "error" | "info" = "info";

      const timeMatch = line.match(timeRegex);
      if (timeMatch) {
        timestamp = timeMatch[1];
        content = line.replace(timeRegex, "").trim();
      }

      if (
        content.toLowerCase().includes("error") ||
        content.toLowerCase().includes("failed") ||
        content.toLowerCase().includes("exception")
      ) {
        type = "error";
      } else if (
        content.includes("Tool Executed:") ||
        content.includes("Function Call:") ||
        content.includes("Calling tool:")
      ) {
        type = "tool";
      } else if (
        content.includes("Thinking:") ||
        content.includes("Thought:") ||
        content.includes("Observation:")
      ) {
        type = "thought";
      } else if (
        content.includes("Action:") ||
        content.includes("Executing:")
      ) {
        type = "action";
      } else if (
        content.includes("User message:") ||
        content.includes("Received:")
      ) {
        type = "info";
      } else {
        // Skip uninteresting system logs
        continue;
      }

      // Clean up common ANSI escape codes
      content = content.replace(/\x1B\[[0-9;]*m/g, "");

      actions.push({ timestamp, content, type });
    }

    // Save parsed logs to DB (dedup via unique index)
    if (actions.length > 0) {
      const OpenClawLog = require("../models/OpenClawLog").default;
      const docs = actions.map((a) => ({
        serverId: server._id,
        timestamp: new Date(a.timestamp),
        content: a.content,
        type: a.type,
      }));
      try {
        await OpenClawLog.insertMany(docs, { ordered: false });
      } catch (bulkErr: any) {
        // Ignore duplicate key errors (code 11000)
        if (bulkErr.code !== 11000 && !bulkErr.writeErrors) {
          console.error("Bulk insert OpenClawLog error:", bulkErr.message);
        }
      }
    }

    // Return the last 50 parsed actions, newest first
    res.json({ actions: actions.reverse().slice(0, 50) });
  } catch (error: any) {
    console.error("Get OpenClaw Logs failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Paginated stored logs from DB
export const getOpenClawStoredLogs = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const { serverId } = req.params;
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const type = req.query.type as string | undefined;

    const server = await Server.findById(serverId);
    if (!server || server.owner.toString() !== req.user?._id.toString()) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const OpenClawLog = require("../models/OpenClawLog").default;

    const filter: any = { serverId: server._id };
    if (type && type !== "all") {
      filter.type = type;
    }

    const [logs, total] = await Promise.all([
      OpenClawLog.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      OpenClawLog.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Get stored OpenClaw logs failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const saveOpenClawConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { serverId } = req.params;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ message: "Config content is required" });
      return;
    }

    const server = await Server.findById(serverId);
    if (!server || server.owner.toString() !== req.user?._id.toString()) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    // Clean up invalid keys before writing
    let cleanedContent = content;
    let authProfiles: Record<string, any> = {};
    try {
      const parsed = JSON.parse(content);
      // Remove invalid models.providers (needs baseUrl+models for custom providers)
      if (parsed?.models?.providers) {
        delete parsed.models.providers;
        if (parsed.models && Object.keys(parsed.models).length === 0) {
          delete parsed.models;
        }
      }
      // Remove legacy llm.* keys
      if (parsed?.llm) {
        delete parsed.llm;
      }
      // Remove invalid systemPrompt key (system prompt uses AGENTS.md file instead)
      if (parsed?.agents?.defaults?.systemPrompt) {
        delete parsed.agents.defaults.systemPrompt;
      }
      // Extract API keys for auth-profiles.json
      const envVarToProvider: Record<string, string> = {
        OPENAI_API_KEY: "openai",
        ANTHROPIC_API_KEY: "anthropic",
        GOOGLE_API_KEY: "google",
        OPENROUTER_API_KEY: "openrouter",
      };
      if (parsed?.env) {
        for (const [envVar, provider] of Object.entries(envVarToProvider)) {
          if (parsed.env[envVar]) {
            authProfiles[provider] = {
              mode: "api_key",
              apiKey: parsed.env[envVar],
            };
          }
        }
      }

      cleanedContent = JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If content isn't valid JSON, write as-is
    }

    const safeContent = Buffer.from(cleanedContent).toString("base64");

    const writeResult = await sshService.exec(
      server._id.toString(),
      `mkdir -p /root/openclaw/data/workspace /root/openclaw/data/agents/main/agent && echo "${safeContent}" | base64 -d > /root/openclaw/data/openclaw.json`,
    );

    // Write auth-profiles.json to both root and agent directories
    if (Object.keys(authProfiles).length > 0) {
      const profilesWithProvider = Object.fromEntries(
        Object.entries(authProfiles).map(([provider, profile]) => [
          provider,
          { provider, ...profile },
        ]),
      );
      const authJson = JSON.stringify(
        { version: 1, profiles: profilesWithProvider },
        null,
        2,
      );
      const safeAuth = Buffer.from(authJson).toString("base64");
      await sshService.exec(
        server._id.toString(),
        `echo "${safeAuth}" | base64 -d | tee /root/openclaw/data/auth-profiles.json > /root/openclaw/data/agents/main/agent/auth-profiles.json`,
      );
    }

    if (writeResult.code !== 0) {
      res.status(500).json({
        message: "Failed to write openclaw.json",
        details: writeResult.stderr,
      });
      return;
    }

    // Restart container to pick up new config + auth
    const restartResult = await sshService.exec(
      server._id.toString(),
      `docker restart -t 3 openclaw`,
    );

    if (restartResult.code !== 0 && restartResult.code !== null) {
      res.status(500).json({
        message: "Config saved, but failed to restart container",
        details: restartResult.stderr,
      });
      return;
    }

    res.json({
      message: "Configuration saved and container restarted successfully",
    });
  } catch (error: any) {
    console.error("Save OpenClaw Config failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Read AGENTS.md (system prompt for the agent)
export const getOpenClawAgentsMd = async (req: AuthRequest, res: Response) => {
  try {
    const { serverId } = req.params;
    const server = await Server.findById(serverId);
    if (!server || server.owner.toString() !== req.user?._id.toString()) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const { stdout, code } = await sshService.exec(
      server._id.toString(),
      "cat /root/openclaw/data/agents/main/agent/AGENTS.md 2>/dev/null || echo ''",
    );

    res.json({ content: code === 0 ? stdout.trim() : "" });
  } catch (error: any) {
    console.error("Get AGENTS.md failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Write AGENTS.md (system prompt for the agent)
export const saveOpenClawAgentsMd = async (req: AuthRequest, res: Response) => {
  try {
    const { serverId } = req.params;
    const { content } = req.body;

    const server = await Server.findById(serverId);
    if (!server || server.owner.toString() !== req.user?._id.toString()) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const safeContent = Buffer.from(content || "").toString("base64");
    await sshService.exec(
      server._id.toString(),
      `mkdir -p /root/openclaw/data/agents/main/agent && echo "${safeContent}" | base64 -d > /root/openclaw/data/agents/main/agent/AGENTS.md`,
    );

    res.json({ message: "AGENTS.md saved successfully" });
  } catch (error: any) {
    console.error("Save AGENTS.md failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getOpenClawModels = async (req: AuthRequest, res: Response) => {
  try {
    const { provider, apiKey, serverId } = req.query;

    if (!provider) {
      res.status(400).json({ message: "Provider is required" });
      return;
    }

    let models: string[] = [];

    switch (provider) {
      case "openai":
        if (!apiKey) {
          res.status(400).json({ message: "API Key required for OpenAI" });
          return;
        }
        const openaiRes = await axios.get("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        });
        models = openaiRes.data.data
          .filter((m: any) => m.id.includes("gpt") || m.id.includes("o1"))
          .map((m: any) => m.id);
        break;

      case "anthropic":
        if (!apiKey) {
          res.status(400).json({ message: "API Key required for Anthropic" });
          return;
        }
        const anthropicRes = await axios.get(
          "https://api.anthropic.com/v1/models",
          {
            headers: {
              "x-api-key": apiKey as string,
              "anthropic-version": "2023-06-01",
            },
            timeout: 10000,
          },
        );
        models = anthropicRes.data.data
          .filter((m: any) => m.type === "model")
          .map((m: any) => m.id);
        break;

      case "google":
        if (!apiKey) {
          res.status(400).json({ message: "API Key required for Google" });
          return;
        }
        const googleRes = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
          {
            timeout: 10000,
          },
        );
        models = googleRes.data.models
          .filter((m: any) => m.name.includes("gemini"))
          .map((m: any) => m.name.replace("models/", ""));
        break;

      case "ollama":
        if (!serverId) {
          res.status(400).json({
            message: "Server ID required for Ollama to fetch local models",
          });
          return;
        }
        const server = await Server.findById(serverId);
        if (!server || server.owner.toString() !== req.user?._id.toString()) {
          res.status(404).json({ message: "Server not found" });
          return;
        }

        // Fetch from ollama container on the VPS
        const ollamaCmd = `curl -s http://localhost:11434/api/tags || echo '{"models": []}'`;
        const { stdout, code } = await sshService.exec(
          server._id.toString(),
          ollamaCmd,
        );

        if (code === 0 && stdout) {
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.models) {
              models = parsed.models.map((m: any) => m.name);
            }
          } catch (e) {
            console.error("Failed to parse Ollama models:", e);
          }
        }
        break;

      default:
        res.status(400).json({ message: "Unsupported provider" });
        return;
    }

    res.json({ models });
  } catch (error: any) {
    console.error(
      "Fetch models failed:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      message: "Failed to fetch models",
      error: error.response?.data?.error?.message || error.message,
    });
  }
};

export const approveOpenClawPairing = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const { serverId } = req.params;
    const { platform, code } = req.body;

    if (!platform || !code) {
      res.status(400).json({ message: "Platform and code are required" });
      return;
    }

    const server = await Server.findById(serverId);
    if (!server || server.owner.toString() !== req.user?._id.toString()) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    // Run the pairing approve command inside the openclaw container
    // Syntax: openclaw pairing approve <platform_name> <pairing_code>
    const cmd = `docker exec openclaw bash -c "openclaw pairing approve ${platform.toLowerCase()} ${code}"`;

    const result = await sshService.exec(server._id.toString(), cmd);

    if (result.code !== 0) {
      res.status(500).json({
        message: "Failed to approve pairing code",
        details: result.stderr || result.stdout,
      });
      return;
    }

    res.json({
      message: `Pairing code approved successfully for ${platform}. Output: ${result.stdout}`,
    });
  } catch (error: any) {
    console.error("Pairing approval failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
