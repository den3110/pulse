import { Client, ConnectConfig } from "ssh2";
import { IServer } from "../models/Server";
import Server from "../models/Server";

export interface SSHExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

class SSHService {
  // Connection pool: serverId -> { conn, timer }
  private pool = new Map<
    string,
    { conn: Client; timer: ReturnType<typeof setTimeout> }
  >();
  private POOL_TTL = 5 * 60 * 1000; // 5 minutes idle timeout

  /**
   * Get or create a pooled SSH connection
   */
  private async getOrCreateConnection(serverId: string): Promise<Client> {
    const existing = this.pool.get(serverId);
    if (existing) {
      // Reset idle timer
      clearTimeout(existing.timer);
      existing.timer = setTimeout(
        () => this.closeConnection(serverId),
        this.POOL_TTL,
      );
      return existing.conn;
    }

    const server = await Server.findById(serverId).select(
      "+password +privateKey +passphrase",
    );
    if (!server) throw new Error("Server not found");

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const connectConfig = this.getConnectConfig(server);

      conn.on("ready", () => {
        const timer = setTimeout(
          () => this.closeConnection(serverId),
          this.POOL_TTL,
        );
        this.pool.set(serverId, { conn, timer });
        resolve(conn);
      });

      conn.on("error", (err) => {
        console.error(
          `[SSH] Connection error for ${server.host}: ${err.message}`,
        );
        this.pool.delete(serverId);
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.on("close", () => {
        const entry = this.pool.get(serverId);
        if (entry?.conn === conn) {
          clearTimeout(entry.timer);
          this.pool.delete(serverId);
        }
      });

      conn.connect(connectConfig);
    });
  }

  /**
   * Close a pooled connection
   */
  private closeConnection(serverId: string): void {
    const entry = this.pool.get(serverId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.conn.end();
      this.pool.delete(serverId);
    }
  }
  /**
   * Create SSH connection config from server document
   */
  private getConnectConfig(
    server: IServer & {
      password?: string;
      privateKey?: string;
      passphrase?: string;
    },
  ): ConnectConfig {
    const connectConfig: ConnectConfig = {
      host: server.host,
      port: server.port || 22,
      username: server.username,
      readyTimeout: 10000,
      keepaliveInterval: 10000, // Send keepalive every 10s to detect dead connections
      keepaliveCountMax: 3, // Disconnect after 3 failed keepalives
    };

    if (server.authType === "key" && server.privateKey) {
      connectConfig.privateKey = server.privateKey;
      if (server.passphrase) {
        connectConfig.passphrase = server.passphrase;
      }
    } else if (server.password) {
      connectConfig.password = server.password;
    }

    return connectConfig;
  }

  /**
   * Execute a command on remote server and return result
   */
  async exec(
    serverId: string,
    command: string,
    timeout = 15000,
    options: { pty?: boolean } = {},
  ): Promise<SSHExecResult> {
    try {
      const conn = await this.getOrCreateConnection(serverId);
      return await this.execOnConnection(conn, command, timeout, options);
    } catch (error: any) {
      console.error(
        `[SSH] Exec failed for server ${serverId}: ${error.message}`,
      );

      // Don't retry if it was a command execution timeout
      if (error.message === "Command execution timed out") {
        throw error;
      }

      console.log(`[SSH] Retrying connection for server ${serverId}...`);
      // If pooled connection failed (e.g. broken pipe), retry with fresh connection
      this.closeConnection(serverId);
      try {
        const conn = await this.getOrCreateConnection(serverId);
        return await this.execOnConnection(conn, command, timeout, options);
      } catch (retryError: any) {
        console.error(
          `[SSH] Retry failed for server ${serverId}: ${retryError.message}`,
        );
        throw retryError;
      }
    }
  }

  /**
   * Execute command on an existing connection
   */
  private execOnConnection(
    conn: Client,
    command: string,
    timeout = 15000,
    options: { pty?: boolean } = {},
  ): Promise<SSHExecResult> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      conn.exec(command, { pty: options.pty }, (err, stream) => {
        if (err) return reject(err);

        timeoutId = setTimeout(() => {
          stream.close();
          const err = new Error("Command execution timed out");
          reject(err);
        }, timeout);

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("close", (code: number) => {
          clearTimeout(timeoutId);
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            code: code || 0,
          });
        });
      });
    });
  }

  /**
   * Execute a command and stream output via callback
   */
  async execStream(
    serverId: string,
    command: string,
    onData: (data: string, type: "stdout" | "stderr") => void,
    onClose?: (code: number) => void,
  ): Promise<void> {
    const server = await Server.findById(serverId).select(
      "+password +privateKey +passphrase",
    );
    if (!server) throw new Error("Server not found");

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const connectConfig = this.getConnectConfig(server);

      conn.on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          stream.on("data", (data: Buffer) => {
            onData(data.toString(), "stdout");
          });

          stream.stderr.on("data", (data: Buffer) => {
            onData(data.toString(), "stderr");
          });

          stream.on("close", (code: number) => {
            conn.end();
            if (onClose) onClose(code || 0);
            resolve();
          });
        });
      });

      conn.on("error", (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.connect(connectConfig);
    });
  }

  /**
   * Execute a command and stream output line-by-line
   */
  async execStreamLine(
    serverId: string,
    command: string,
    onLine: (line: string, type: "stdout" | "stderr") => void,
    onClose?: (code: number) => void,
  ): Promise<void> {
    let stdoutBuffer = "";
    let stderrBuffer = "";

    return this.execStream(
      serverId,
      command,
      (data, type) => {
        if (type === "stdout") {
          stdoutBuffer += data;
          const lines = stdoutBuffer.split("\n");
          // Keep the last partial line in buffer
          stdoutBuffer = lines.pop() || "";
          lines.forEach((line) => {
            if (line.trim()) onLine(line, "stdout");
          });
        } else {
          stderrBuffer += data;
          const lines = stderrBuffer.split("\n");
          stderrBuffer = lines.pop() || "";
          lines.forEach((line) => {
            if (line.trim()) onLine(line, "stderr");
          });
        }
      },
      (code) => {
        // Flush remaining buffers
        if (stdoutBuffer.trim()) onLine(stdoutBuffer, "stdout");
        if (stderrBuffer.trim()) onLine(stderrBuffer, "stderr");
        if (onClose) onClose(code);
      },
    );
  }

  /**
   * Create an interactive shell session (Dedicated Connection)
   */
  async createShell(
    serverId: string,
    options: {
      rows?: number;
      cols?: number;
      term?: string;
    } = {},
  ): Promise<any> {
    const server = await Server.findById(serverId).select(
      "+password +privateKey +passphrase",
    );
    if (!server) throw new Error("Server not found");

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const connectConfig = this.getConnectConfig(server);

      conn.on("ready", () => {
        conn.shell(
          {
            term: options.term || "xterm-color",
            rows: options.rows || 24,
            cols: options.cols || 80,
          },
          (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            // Should close connection when stream closes
            stream.on("close", () => {
              conn.end();
            });

            resolve(stream);
          },
        );
      });

      conn.on("error", (err) => {
        console.error(`[SSH] Dedicated shell connection error: ${err.message}`);
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.on("end", () => {
        // Connection ended
      });

      conn.connect(connectConfig);
    });
  }

  /**
   * Test SSH connection to a server
   */
  async testConnection(
    serverId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.exec(
        serverId,
        'echo "Connection successful" && uname -a',
      );
      return {
        success: true,
        message: result.stdout,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Get system stats from remote server
   */
  async getSystemStats(serverId: string): Promise<{
    cpu: string;
    cpuUsage: number;
    memory: { total: string; used: string; free: string; percent: string };
    memoryUsage: number;
    disk: { total: string; used: string; free: string; percent: string };
    diskUsage: number;
    uptime: string;
    loadAvg: string;
  }> {
    // We use ; to separate commands so they run independently.
    // If one fails, it prints a default value so the parsing logic doesn't break.
    const commands = [
      // 1. CPU Usage: vmstat 1 2 (take 2nd line of output for accurate reading)
      // Tail -1 to get the last line (the actual reading), awk to get idle (US+SY+ID+WA+ST are usually last columns, we want ID which is usually 15th col in standard vmstat, but let's be careful.
      // Standard vmstat output: r b swpd free buff cache si so bi bo in cs us sy id wa st
      // id is column 15.
      // We'll trust "us + sy" or "100 - id".
      // Let's try: vmstat 1 2 | tail -1 | awk '{print $15}' (idle)
      // Note: vmstat output varies by version.
      // Safer: top -bn1 | grep "Cpu(s)" ... but top failed before.
      // Let's stick to vmstat but be flexible.
      // Actually, let's use a combination if possible or just vmstat.
      // "vmstat 1 2" output last line.
      "(vmstat 1 2 | tail -1 | awk '{print 100 - $15}' || echo '0')",

      // 2. Memory: free -m (megabytes)
      "(free -m | awk 'NR==2{printf \"%s|%s|%s|%.1f%%\", $2,$3,$4,$3/$2*100}' || echo '0|0|0|0%')",

      // 3. Disk: df -P / (POSIX standard, usually 1024-blocks)
      // Output: Filesystem 1024-blocks Used Available Capacity Mounted on
      // We want $2 (Total), $3 (Used), $4 (Avail), $5 (Capacity used%)
      "(df -P / | awk 'NR==2{printf \"%s|%s|%s|%s\", $2,$3,$4,$5}' || echo '0|0|0|0%')",

      // 4. Uptime
      "(uptime -p || uptime || echo 'unknown')",

      // 5. Load Avg
      "(cat /proc/loadavg | awk '{print $1, $2, $3}' || echo '0 0 0')",
    ];

    try {
      // Use a distinct separator that is unlikely to appear in normal output
      const separator = "---SEP---";
      const fullCommand = commands.join(` && echo "${separator}" && `);

      const result = await this.exec(serverId, fullCommand);

      // console.log("--- RAW SSH STATS OUTPUT ---");
      // console.log(result.stdout);

      const parts = result.stdout.split(separator).map((s) => s.trim());

      // Parse CPU
      // vmstat idle is usually the 15th column. If we successfully did 100 - idle, we have the usage.
      let cpuRaw = parts[0] || "0";
      // Clean up in case of garbage
      cpuRaw = cpuRaw.split("\n")[0].trim();
      let cpuUsage = parseFloat(cpuRaw);
      if (isNaN(cpuUsage)) cpuUsage = 0;

      // Parse Memory
      const memParts = (parts[1] || "0|0|0|0%").split("|");

      // Parse Disk
      const diskParts = (parts[2] || "0|0|0|0%").split("|");

      const uptimeRaw = parts[3] || "unknown";
      const loadAvgRaw = parts[4] || "0 0 0";

      // Convert disk blocks to GB string loosely if needed, but for now raw is fine or we format it.
      // actually, free -m returns MB. df -P returns Kb (usually).
      // Let's format them nicely:
      const formatMem = (mb: string) =>
        Math.round((parseFloat(mb) / 1024) * 10) / 10 + "G"; // Convert to GB
      const formatDisk = (kb: string) =>
        Math.round((parseFloat(kb) / 1024 / 1024) * 10) / 10 + "G"; // Convert to GB

      const memoryTotal = formatMem(memParts[0] || "0");
      const memoryUsed = formatMem(memParts[1] || "0");
      const memoryFree = formatMem(memParts[2] || "0");
      const memoryPercent = memParts[3] || "0%";
      const memoryUsage = parseFloat(memoryPercent.replace("%", "")) || 0;

      const diskTotal = formatDisk(diskParts[0] || "0");
      const diskUsed = formatDisk(diskParts[1] || "0");
      const diskFree = formatDisk(diskParts[2] || "0");
      const diskPercent = diskParts[3] || "0%";
      const diskUsage = parseFloat(diskPercent.replace("%", "")) || 0;

      return {
        cpu: cpuUsage.toFixed(1) + "%",
        cpuUsage,
        memory: {
          total: memoryTotal,
          used: memoryUsed,
          free: memoryFree,
          percent: memoryPercent,
        },
        memoryUsage,
        disk: {
          total: diskTotal,
          used: diskUsed,
          free: diskFree,
          percent: diskPercent,
        },
        diskUsage,
        uptime: uptimeRaw,
        loadAvg: loadAvgRaw,
      };
    } catch (error: any) {
      console.error("Failed to get system stats:", error.message);
      // Return default values instead of throwing
      return {
        cpu: "0%",
        cpuUsage: 0,
        memory: { total: "0", used: "0", free: "0", percent: "0%" },
        memoryUsage: 0,
        disk: { total: "0", used: "0", free: "0", percent: "0%" },
        diskUsage: 0,
        uptime: "error",
        loadAvg: "0 0 0",
      };
    }
  }
  /**
   * Request an SFTP channel on the existing connection
   */
  async requestSFTP(serverId: string): Promise<any> {
    const conn = await this.getOrCreateConnection(serverId);
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
    });
  }
}

export default new SSHService();
