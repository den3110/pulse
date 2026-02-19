import sshService from "./sshService";

interface PM2Process {
  pm_id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  mode: string;
  pid: number;
  interpreter: string;
  script: string;
  cwd: string;
  watching: boolean;
  instances: number;
}

class PM2Service {
  // Cache: serverId -> { data: PM2Process[], timestamp: number }
  private cache = new Map<string, { data: PM2Process[]; timestamp: number }>();
  private CACHE_TTL = 3 * 1000; // 3 seconds (retained for fallback)

  // Polling intervals: serverId -> NodeJS.Timeout
  private pollingIntervals = new Map<string, NodeJS.Timeout>();
  private POLLING_INTERVAL = 5000; // Poll every 5 seconds

  private invalidateCache(serverId: string) {
    this.cache.delete(serverId);
    // Force immediate refresh
    this.refreshCache(serverId);
  }

  /**
   * Start polling for a server if not already running
   */
  private startPolling(serverId: string) {
    if (this.pollingIntervals.has(serverId)) return;

    // Initial fetch (don't await)
    this.refreshCache(serverId);

    const interval = setInterval(() => {
      this.refreshCache(serverId);
    }, this.POLLING_INTERVAL);

    this.pollingIntervals.set(serverId, interval);
  }

  /**
   * Stop polling for a server
   */
  private stopPolling(serverId: string) {
    const interval = this.pollingIntervals.get(serverId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(serverId);
    }
  }

  /**
   * Fetch data from remote server and update cache
   */
  private async refreshCache(serverId: string) {
    try {
      const result = await sshService.exec(serverId, "pm2 jlist 2>/dev/null");
      if (result.code !== 0 || !result.stdout.trim()) {
        return;
      }

      const raw = JSON.parse(result.stdout);
      const processes = raw.map((p: any) => ({
        pm_id: p.pm_id,
        name: p.name,
        status: p.pm2_env?.status || "unknown",
        cpu: p.monit?.cpu || 0,
        memory: p.monit?.memory || 0,
        uptime: p.pm2_env?.pm_uptime || 0,
        restarts: p.pm2_env?.restart_time || 0,
        mode: p.pm2_env?.exec_mode === "cluster_mode" ? "cluster" : "fork",
        pid: p.pid || 0,
        interpreter: p.pm2_env?.exec_interpreter || "node",
        script: p.pm2_env?.pm_exec_path || "",
        cwd: p.pm2_env?.pm_cwd || "",
        watching: p.pm2_env?.watch || false,
        instances: p.pm2_env?.instances || 1,
      }));

      // Update cache
      this.cache.set(serverId, { data: processes, timestamp: Date.now() });
    } catch (error) {
      // console.error(`Failed to refresh PM2 cache for ${serverId}:`, error);
    }
  }

  /**
   * List all PM2 processes
   */
  async list(serverId: string): Promise<PM2Process[]> {
    // Ensure polling is active
    this.startPolling(serverId);

    // Check cache
    const cached = this.cache.get(serverId);
    // Return cached data immediately if available (even if "stale" by a few seconds, it's better than waiting)
    if (cached) {
      return cached.data;
    }

    // If no cache (first run), wait for one fetch
    await this.refreshCache(serverId);
    const newCached = this.cache.get(serverId);
    return newCached?.data || [];
  }

  /**
   * Start a new PM2 process
   */
  async start(
    serverId: string,
    script: string,
    name?: string,
    options?: {
      interpreter?: string;
      instances?: number;
      cwd?: string;
      args?: string;
      envVars?: Record<string, string>;
      maxMemory?: string;
      cron?: string;
      watch?: boolean;
    },
  ): Promise<{ success: boolean; output: string }> {
    let cmd = `pm2 start "${script}"`;
    if (name) cmd += ` --name "${name}"`;
    if (options?.interpreter) cmd += ` --interpreter ${options.interpreter}`;
    if (options?.instances) cmd += ` -i ${options.instances}`;
    if (options?.cwd) cmd += ` --cwd "${options.cwd}"`;
    if (options?.args) cmd += ` -- ${options.args}`;
    if (options?.maxMemory) cmd += ` --max-memory-restart ${options.maxMemory}`;
    if (options?.cron) cmd += ` --cron-restart "${options.cron}"`;
    if (options?.watch) cmd += ` --watch`;

    // Build env vars inline
    if (options?.envVars && Object.keys(options.envVars).length > 0) {
      const envPrefix = Object.entries(options.envVars)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      cmd = `${envPrefix} ${cmd}`;
    }

    const result = await sshService.exec(serverId, cmd);
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Stop a PM2 process
   */
  async stop(
    serverId: string,
    nameOrId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(
      serverId,
      `pm2 stop "${nameOrId}" 2>&1`,
    );
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Restart a PM2 process
   */
  async restart(
    serverId: string,
    nameOrId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(
      serverId,
      `pm2 restart "${nameOrId}" 2>&1`,
    );
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Graceful reload a PM2 process
   */
  async reload(
    serverId: string,
    nameOrId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(
      serverId,
      `pm2 reload "${nameOrId}" 2>&1`,
    );
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Delete a PM2 process
   */
  async deleteProcess(
    serverId: string,
    nameOrId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(
      serverId,
      `pm2 delete "${nameOrId}" 2>&1`,
    );
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Get logs for a process
   */
  async logs(
    serverId: string,
    nameOrId: string,
    lines: number = 50,
  ): Promise<{ out: string; err: string }> {
    const result = await sshService.exec(
      serverId,
      `pm2 logs "${nameOrId}" --nostream --lines ${lines} --raw 2>&1`,
    );
    return {
      out: result.stdout || "",
      err: result.stderr || "",
    };
  }

  /**
   * Flush logs for a specific process or all
   */
  async flush(
    serverId: string,
    nameOrId?: string,
  ): Promise<{ success: boolean; output: string }> {
    const cmd = nameOrId ? `pm2 flush "${nameOrId}" 2>&1` : "pm2 flush 2>&1";
    const result = await sshService.exec(serverId, cmd);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Save current PM2 process list (pm2 save)
   */
  async save(serverId: string): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(serverId, "pm2 save 2>&1");
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Generate startup script
   */
  async startup(
    serverId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(serverId, "pm2 startup 2>&1");
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Restart all processes
   */
  async restartAll(
    serverId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(serverId, "pm2 restart all 2>&1");
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Stop all processes
   */
  async stopAll(
    serverId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(serverId, "pm2 stop all 2>&1");
    this.invalidateCache(serverId);
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Get detailed info for a specific process
   */
  async describe(serverId: string, nameOrId: string): Promise<any> {
    const result = await sshService.exec(
      serverId,
      `pm2 describe "${nameOrId}" 2>/dev/null | head -100`,
    );
    return result.stdout || "";
  }

  /**
   * Stream logs for a process (Real-time)
   * Returns the SSH stream object which effectively is the connection.
   */
  async streamLogs(serverId: string, nameOrId: string): Promise<any> {
    const stream = await sshService.createShell(serverId, {
      term: "xterm-color",
    });

    // Command to start logging
    stream.write(`pm2 logs "${nameOrId}" --lines 20 --raw\n`);

    return stream;
  }
}

export default new PM2Service();
