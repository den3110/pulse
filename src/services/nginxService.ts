import sshService from "./sshService";

interface NginxConfig {
  name: string;
  enabled: boolean;
  size: string;
  modified: string;
}

class NginxService {
  private sitesAvailable = "/etc/nginx/sites-available";
  private sitesEnabled = "/etc/nginx/sites-enabled";

  // Cache: serverId -> { data: NginxConfig[], timestamp: number }
  private cache = new Map<string, { data: NginxConfig[]; timestamp: number }>();
  private CACHE_TTL = 30 * 1000; // 30 seconds

  private invalidateCache(serverId: string) {
    this.cache.delete(serverId);
  }

  /**
   * List all config files in sites-available with enabled status
   */
  async listConfigs(serverId: string): Promise<NginxConfig[]> {
    // Check cache
    const cached = this.cache.get(serverId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Combine commands: ls sites-available AND ls sites-enabled
    // Use a separator to distinguish the two outputs
    const cmd = `ls -la ${this.sitesAvailable}/ 2>/dev/null | tail -n +2 | grep -v '^d' | awk '{print $5, $6, $7, $8, $NF}' && echo "---SEPARATOR---" && ls ${this.sitesEnabled}/ 2>/dev/null`;

    const result = await sshService.exec(serverId, cmd);

    if (!result.stdout.trim()) return [];

    const parts = result.stdout.split("---SEPARATOR---");
    const availableOutput = parts[0] || "";
    const enabledOutput = parts[1] || "";

    const enabledFiles = new Set(
      enabledOutput
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );

    const configs = availableOutput
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const name = parts[parts.length - 1];
        const size = parts[0] || "0";
        const dateStr = parts.slice(1, parts.length - 1).join(" ");
        return {
          name,
          enabled: enabledFiles.has(name),
          size: this.formatSize(parseInt(size, 10)),
          modified: dateStr,
        };
      })
      .filter((c) => c.name !== "." && c.name !== "..");

    // Update cache
    this.cache.set(serverId, { data: configs, timestamp: Date.now() });

    return configs;
  }

  /**
   * Read a config file content
   */
  async getConfig(serverId: string, filename: string): Promise<string> {
    this.validateFilename(filename);
    const result = await sshService.exec(
      serverId,
      `export LC_ALL=C.UTF-8; cat ${this.sitesAvailable}/${filename}`,
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to read config file");
    }
    return result.stdout;
  }

  /**
   * Save/update a config file
   */
  async saveConfig(
    serverId: string,
    filename: string,
    content: string,
  ): Promise<void> {
    this.validateFilename(filename);
    // Escape content for heredoc
    const escapedContent = content.replace(/\\/g, "\\\\");
    const result = await sshService.exec(
      serverId,
      `cat > ${this.sitesAvailable}/${filename} << 'NGINX_EOF'\n${escapedContent}\nNGINX_EOF`,
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to save config file");
    }
    this.invalidateCache(serverId);
  }

  /**
   * Delete a config file (also disables it)
   */
  async deleteConfig(serverId: string, filename: string): Promise<void> {
    this.validateFilename(filename);
    if (filename === "default") {
      throw new Error("Cannot delete the default config");
    }
    // Remove from sites-enabled first, then delete
    await sshService.exec(
      serverId,
      `rm -f ${this.sitesEnabled}/${filename} && rm -f ${this.sitesAvailable}/${filename}`,
    );
    this.invalidateCache(serverId);
  }

  /**
   * Enable a config (create symlink in sites-enabled)
   */
  async enableConfig(serverId: string, filename: string): Promise<void> {
    this.validateFilename(filename);
    const result = await sshService.exec(
      serverId,
      `ln -sf ${this.sitesAvailable}/${filename} ${this.sitesEnabled}/${filename}`,
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to enable config");
    }
    this.invalidateCache(serverId);
  }

  /**
   * Disable a config (remove symlink from sites-enabled)
   */
  async disableConfig(serverId: string, filename: string): Promise<void> {
    this.validateFilename(filename);
    const result = await sshService.exec(
      serverId,
      `rm -f ${this.sitesEnabled}/${filename}`,
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to disable config");
    }
    this.invalidateCache(serverId);
  }

  /**
   * Test nginx configuration
   */
  async testConfig(
    serverId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(serverId, "nginx -t 2>&1");
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
    };
  }

  /**
   * Reload nginx
   */
  async reloadNginx(
    serverId: string,
  ): Promise<{ success: boolean; output: string }> {
    const result = await sshService.exec(
      serverId,
      "systemctl reload nginx 2>&1",
    );
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr || "Nginx reloaded successfully",
    };
  }

  /**
   * Save config and reload nginx in one operation
   */
  async saveAndReload(
    serverId: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; output: string }> {
    // Step 1: Save config
    await this.saveConfig(serverId, filename, content);

    // Step 2: Test config before reloading
    const testResult = await this.testConfig(serverId);
    if (!testResult.success) {
      return {
        success: false,
        output: `Config saved but test failed:\n${testResult.output}`,
      };
    }

    // Step 3: Reload nginx
    const reloadResult = await this.reloadNginx(serverId);
    return {
      success: reloadResult.success,
      output: reloadResult.success
        ? "Config saved, tested, and nginx reloaded successfully"
        : `Config saved but reload failed:\n${reloadResult.output}`,
    };
  }

  /**
   * Get nginx service status
   */
  async getNginxStatus(
    serverId: string,
  ): Promise<{ active: boolean; output: string }> {
    const result = await sshService.exec(
      serverId,
      "systemctl is-active nginx 2>&1",
    );
    return {
      active: result.stdout.trim() === "active",
      output: result.stdout.trim(),
    };
  }

  /**
   * Read last N lines of access/error log
   */
  async getLog(
    serverId: string,
    logType: "access" | "error",
    lines: number = 50,
  ): Promise<string> {
    const logPath =
      logType === "access"
        ? "/var/log/nginx/access.log"
        : "/var/log/nginx/error.log";
    const result = await sshService.exec(
      serverId,
      `tail -n ${lines} ${logPath} 2>&1`,
    );
    return result.stdout;
  }

  /**
   * Validate filename to prevent path traversal
   */
  private validateFilename(filename: string): void {
    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("..") ||
      filename.includes("\0")
    ) {
      throw new Error("Invalid filename");
    }
  }

  private formatSize(bytes: number): string {
    if (isNaN(bytes) || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

export default new NginxService();
