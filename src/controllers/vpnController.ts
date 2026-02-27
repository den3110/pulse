import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import sshService from "../services/sshService";
import Server from "../models/Server";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// Helper to run wg-easy API commands via curl locally on the server
async function wgApi(
  serverId: string,
  method: string,
  path: string,
  payload?: any,
) {
  const payloadStr = payload
    ? JSON.stringify(payload).replace(/'/g, "'\\''")
    : "";

  const script = `
    PASS=$(cat ~/.pulse-vpn/.apipass 2>/dev/null)
    if [ -z "$PASS" ]; then echo '{"error": "VPN not configured"}'; exit 1; fi
    curl -s -c /tmp/wgcookie -X POST -H 'Content-Type: application/json' -d "{\\"password\\":\\"$PASS\\"}" http://127.0.0.1:51821/api/session > /dev/null
    
    ${
      payload
        ? `curl -s -b /tmp/wgcookie -X ${method} -H 'Content-Type: application/json' -d '${payloadStr}' http://127.0.0.1:51821${path}`
        : `curl -s -b /tmp/wgcookie -X ${method} http://127.0.0.1:51821${path}`
    }
  `;

  const { stdout, code, stderr } = await sshService.exec(serverId, script);
  if (code !== 0) {
    if (stdout.includes("error")) {
      try {
        const err = JSON.parse(stdout);
        throw new Error(err.error || "API Request Failed");
      } catch {
        throw new Error(stderr || stdout || "API Request Failed");
      }
    }
    throw new Error(stderr || "API Request Failed");
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

export const getStatus = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;

    // Check if installed
    const { stdout, code } = await sshService.exec(
      serverId,
      "docker inspect pulse-wg-easy --format '{{.State.Status}}' 2>/dev/null",
    );

    if (code !== 0) {
      return res.json({ installed: false });
    }

    const state = stdout.trim();
    if (state !== "running") {
      return res.json({ installed: true, status: state, clients: [] });
    }

    // Get clients
    const clients = await wgApi(serverId, "GET", "/api/wireguard/client");
    res.json({
      installed: true,
      status: state,
      clients: Array.isArray(clients) ? clients : [],
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// SSE-based install
export const installVpn = async (req: AuthRequest, res: Response) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const serverId = req.params.serverId as string;
    const server = await Server.findById(serverId);
    if (!server) {
      send("error", { message: "Server not found" });
      return res.end();
    }

    // Config from body (with defaults)
    const {
      wgHost = server.host,
      wgPort = 51820,
      apiPort = 51821,
      wgDefaultAddress = "10.8.0.x",
      wgAllowedIps = "0.0.0.0/0, ::/0",
    } = req.body || {};

    // Step 1
    send("progress", { step: 1, message: "Generating secure credentials..." });
    const pass = crypto.randomBytes(12).toString("hex");
    const hash = bcrypt.hashSync(pass, 10);
    const safeHash = hash.replace(/'/g, "'\\''");

    // Step 2
    send("progress", { step: 2, message: "Creating VPN data directory..." });
    await sshService.exec(serverId, "mkdir -p ~/.pulse-vpn");
    await sshService.exec(serverId, `echo "${pass}" > ~/.pulse-vpn/.apipass`);

    // Step 3
    send("progress", {
      step: 3,
      message: "Removing old VPN container (if any)...",
    });
    await sshService.exec(
      serverId,
      "docker rm -f pulse-wg-easy 2>/dev/null || true",
    );

    // Step 4
    send("progress", { step: 4, message: "Pulling wg-easy Docker image..." });
    const pullResult = await sshService.exec(
      serverId,
      "docker pull ghcr.io/wg-easy/wg-easy",
      180000,
    );
    if (pullResult.code !== 0) {
      send("error", {
        message: "Failed to pull Docker image: " + (pullResult.stderr || ""),
      });
      return res.end();
    }

    // Step 5
    send("progress", {
      step: 5,
      message: `Starting WireGuard container (port ${wgPort}/udp)...`,
    });
    const runScript = `docker run -d \\
      --name pulse-wg-easy \\
      --restart unless-stopped \\
      -e LANG=en \\
      -e WG_HOST='${wgHost}' \\
      -e PASSWORD_HASH='${safeHash}' \\
      -e PORT=${apiPort} \\
      -e WG_PORT=${wgPort} \\
      -e WG_DEFAULT_ADDRESS='${wgDefaultAddress}' \\
      -e WG_ALLOWED_IPS='${wgAllowedIps}' \\
      -v ~/.pulse-vpn:/etc/wireguard \\
      -p ${wgPort}:${wgPort}/udp \\
      -p 127.0.0.1:${apiPort}:${apiPort}/tcp \\
      --cap-add=NET_ADMIN \\
      --cap-add=SYS_MODULE \\
      --sysctl="net.ipv4.conf.all.src_valid_mark=1" \\
      --sysctl="net.ipv4.ip_forward=1" \\
      ghcr.io/wg-easy/wg-easy`;

    const { code, stderr } = await sshService.exec(serverId, runScript, 120000);
    if (code !== 0) {
      send("error", {
        message: "Failed to start container: " + (stderr || ""),
      });
      return res.end();
    }

    // Step 6
    send("progress", { step: 6, message: "Verifying container is running..." });
    await new Promise((r) => setTimeout(r, 4000));
    const verify = await sshService.exec(
      serverId,
      "docker inspect pulse-wg-easy --format '{{.State.Status}}' 2>/dev/null",
    );
    const running = verify.stdout?.trim() === "running";

    if (!running) {
      send("error", {
        message: "Container started but is not running. Check server logs.",
      });
      return res.end();
    }

    send("complete", {
      success: true,
      message: "VPN Server installed and running!",
    });
    res.end();
  } catch (error: any) {
    send("error", { message: error.message || "Internal server error" });
    res.end();
  }
};

export const containerAction = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { action } = req.body; // start, stop, restart, remove

    if (action === "remove") {
      await sshService.exec(
        serverId,
        "docker rm -f pulse-wg-easy && rm -rf ~/.pulse-vpn",
      );
    } else if (["start", "stop", "restart"].includes(action)) {
      await sshService.exec(serverId, `docker ${action} pulse-wg-easy`);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createClient = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const { name } = req.body;
    const result = await wgApi(serverId, "POST", "/api/wireguard/client", {
      name,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteClient = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const clientId = req.params.clientId as string;
    await wgApi(serverId, "DELETE", `/api/wireguard/client/${clientId}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const toggleClient = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const clientId = req.params.clientId as string;
    const action = req.params.action as string; // action = enable/disable
    await wgApi(serverId, "PUT", `/api/wireguard/client/${clientId}/${action}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getClientConfig = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const clientId = req.params.clientId as string;
    const config = await wgApi(
      serverId,
      "GET",
      `/api/wireguard/client/${clientId}/configuration`,
    );
    res.json({ config });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getClientQrCode = async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const clientId = req.params.clientId as string;
    const svg = await wgApi(
      serverId,
      "GET",
      `/api/wireguard/client/${clientId}/qrcode.svg`,
    );
    res.json({ svg });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
