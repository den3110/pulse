import sshService from "./sshService";
import ServerSnapshot from "../models/ServerSnapshot";
import logger from "../utils/logger";

class SnapshotService {
  /**
   * Captures a full state snapshot of a server and saves it to the database.
   */
  async captureSnapshot(serverId: string): Promise<void> {
    try {
      // 1. Get basic stats instantly using the existing quick method
      const basicStats = await sshService.getSystemStats(serverId);

      const commands = [
        // Top 10 processes by CPU/Memory. We use ps aux, sort by cpu (-pcpu), output specific columns.
        // Columns: PID, USER, %CPU, %MEM, COMMAND
        "ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 11",

        // Network stats using ss -tuna (TCP/UDP, unresloved ports, listening & non-listening).
        // We'll count ESTAB, TIME-WAIT, and TOTAL.
        // awk script counts occurrences of states.
        "ss -tunpa | awk '{print $1}' | sort | uniq -c",

        // Recent 50 lines of syslog or messages
        "(tail -n 50 /var/log/syslog || tail -n 50 /var/log/messages || echo 'Log not found or permission denied')",
      ];

      const separator = "---SNAP_SEP---";
      const fullCommand = commands.join(` && echo "${separator}" && `);

      const result = await sshService.exec(serverId, fullCommand);
      const parts = result.stdout.split(separator).map((s) => s.trim());

      // Parse processes
      const processesRaw = parts[0] || "";
      const topProcesses = processesRaw
        .split("\n")
        .slice(1) // Skip header
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          // Parse awk/ps columns
          const tokens = line.trim().split(/\s+/);
          return {
            pid: parseInt(tokens[0] || "0", 10),
            user: tokens[1] || "unknown",
            cpu: parseFloat(tokens[2] || "0"),
            memory: parseFloat(tokens[3] || "0"),
            command: tokens.slice(4).join(" "),
          };
        });

      // Parse network stats
      const networkRaw = parts[1] || "";
      let established = 0;
      let timeWait = 0;
      let totalConnections = 0;

      networkRaw.split("\n").forEach((line) => {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length >= 2) {
          const count = parseInt(tokens[0], 10);
          const state = tokens[1];
          totalConnections += count;
          if (state === "ESTAB") established += count;
          if (state === "TIME-WAIT") timeWait += count;
        }
      });

      // Parse logs
      const logsRaw = parts[2] || "";
      const recentLogs = logsRaw
        .split("\n")
        .filter((line) => line.trim().length > 0);

      const snapshot = new ServerSnapshot({
        server: serverId,
        timestamp: new Date(),
        cpuUsage: basicStats.cpuUsage,
        memoryUsage: basicStats.memoryUsage,
        diskUsage: basicStats.diskUsage,
        topProcesses,
        networkStats: {
          totalConnections,
          established,
          timeWait,
        },
        recentLogs,
      });

      await snapshot.save();
      logger.info(
        `[Snapshot] Successfully captured and saved snapshot for server ${serverId}`,
      );
    } catch (error: any) {
      logger.error(
        `[Snapshot] Failed to capture snapshot for server ${serverId}: ${error.message}`,
      );
    }
  }
}

export default new SnapshotService();
