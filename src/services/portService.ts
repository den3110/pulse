import sshService from "./sshService";

interface PortEntry {
  command: string;
  pid: string;
  user: string;
  fd: string;
  type: string;
  device: string;
  sizeOff: string;
  node: string;
  name: string;
}

class PortService {
  async listOpenPorts(serverId: string): Promise<PortEntry[]> {
    try {
      // Use lsof to list listening ports.
      // -i: select internet files
      // -P: no port names
      // -n: no host names
      // grep LISTEN: only show listening sockets
      const command = "lsof -i -P -n | grep LISTEN";

      // Fallback: netstat -tulpn | grep LISTEN could be another option if lsof is missing,
      // but lsof format is nicer to parse.
      // We will assume lsof is installed or try to install it?
      // For now, assume lsof.

      const result = await sshService.exec(serverId, command);
      const output = result.stdout;

      // Parse output
      // COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
      // node      845 root   20u  IPv6  19539      0t0  TCP *:3000 (LISTEN)

      const lines = output.split("\n").filter((line) => line.trim() !== "");
      const ports: PortEntry[] = [];

      lines.forEach((line) => {
        // Skip messy lines or errors
        if (!line.includes("LISTEN")) return;

        // Simple whitespace splitting might fail if fields have spaces,
        // but standard lsof output is usually well-behaved for these columns.
        const parts = line.split(/\s+/);

        if (parts.length >= 9) {
          ports.push({
            command: parts[0],
            pid: parts[1],
            user: parts[2],
            fd: parts[3],
            type: parts[4],
            device: parts[5],
            sizeOff: parts[6],
            node: parts[7],
            name: parts.slice(8).join(" "), // Join rest as name (e.g. *:3000 (LISTEN))
          });
        }
      });

      return ports;
    } catch (error: any) {
      // If lsof fails (e.g. command not found), we might try netstat or return error
      // For now, return empty or throw specific error
      console.error("Values to list ports:", error);
      // Return empty array to avoid crashing UI if just command missing
      if (error.message?.includes("command not found")) {
        throw new Error(
          "lsof command not found. Please install lsof on the server.",
        );
      }
      throw error;
    }
  }

  async killProcess(serverId: string, pid: string): Promise<void> {
    if (!pid || isNaN(Number(pid))) {
      throw new Error("Invalid PID");
    }
    // force kill
    await sshService.exec(serverId, `kill -9 ${pid}`);
  }

  async getProcessDetails(serverId: string, pid: string): Promise<any> {
    if (!pid) throw new Error("PID required");
    try {
      const command = `ps -p ${pid} -o %cpu,%mem,lstart,time,args`;
      const result = await sshService.exec(serverId, command);
      const lines = result.stdout.trim().split("\n");
      if (lines.length < 2) return null;

      const line = lines[1].trim();
      const parts = line.split(/\s+/);

      if (parts.length < 8) return { raw: line };

      return {
        cpu: parts[0],
        mem: parts[1],
        start: parts.slice(2, 7).join(" "),
        time: parts[7],
        cmd: parts.slice(8).join(" "),
      };
    } catch (e) {
      console.error("Failed to get process details", e);
      return null;
    }
  }

  async getFirewallStatus(serverId: string): Promise<any> {
    const checkCmd = `command -v ufw >/dev/null 2>&1 && ufw status numbered || echo "NOT_INSTALLED"`;
    const result = await sshService.exec(serverId, checkCmd);
    const stdout = result.stdout.trim();

    if (stdout === "NOT_INSTALLED" || result.stderr.includes("not found")) {
      return { installed: false, active: false, rules: [] };
    }

    const lines = stdout.split("\n").map((l) => l.trim());
    if (lines[0].includes("Status: inactive")) {
      return { installed: true, active: false, rules: [] };
    }

    const rules: any[] = [];
    // Skip headers: 'Status: active', '', 'To', '--'
    let parsingRules = false;
    for (const line of lines) {
      if (line.startsWith("--")) {
        parsingRules = true;
        continue;
      }
      if (parsingRules && line.startsWith("[")) {
        // e.g. "[ 1] 8317/tcp                   ALLOW IN    Anywhere"
        // Also might have (v6) at the end
        const match = line.match(
          /\[\s*(\d+)\]\s+(\S+)\s+(ALLOW OUT|ALLOW IN|DENY IN|DENY OUT|REJECT IN|REJECT OUT)\s+(.+)/,
        );
        if (match) {
          rules.push({
            id: match[1],
            to: match[2],
            action: match[3],
            from: match[4],
          });
        }
      }
    }

    return { installed: true, active: true, rules };
  }

  async manageFirewallRule(
    serverId: string,
    port: string | number,
    protocol: "tcp" | "udp",
    action: "allow" | "deny",
  ): Promise<void> {
    const cmd = `command -v ufw >/dev/null 2>&1 && ufw ${action} ${port}/${protocol} || echo "No UFW installed, cannot manage firewall"`;
    const result = await sshService.exec(serverId, cmd);
    if (
      result.stdout.includes("No UFW installed") ||
      result.stderr.includes("not found")
    ) {
      throw new Error(
        "UFW is not installed or enabled on this server. Firewall management failed.",
      );
    }
  }
}

export default new PortService();
