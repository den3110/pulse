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
   * Test a specific nginx config file by creating a temp wrapper
   */
  async testConfigFile(
    serverId: string,
    filename: string,
  ): Promise<{ success: boolean; output: string }> {
    // Create a temporary wrapper config that includes only the target file
    const sitesAvailable = `/etc/nginx/sites-available/${filename}`;
    const sitesEnabled = `/etc/nginx/sites-enabled/${filename}`;

    // Check which path the file is in
    const checkCmd = `test -f ${sitesEnabled} && echo "enabled" || (test -f ${sitesAvailable} && echo "available" || echo "missing")`;
    const checkResult = await sshService.exec(serverId, checkCmd);
    const fileLocation = (checkResult.stdout || "").trim();

    if (fileLocation === "missing") {
      return {
        success: false,
        output: `Config file "${filename}" not found in sites-available or sites-enabled`,
      };
    }

    const filePath = fileLocation === "enabled" ? sitesEnabled : sitesAvailable;

    // Create a minimal wrapper config that includes nginx core directives + the target file
    const wrapperContent = `
pid /tmp/nginx_test_${Date.now()}.pid;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    include ${filePath};
}`;
    const tmpWrapper = `/tmp/nginx_test_wrapper_${Date.now()}.conf`;

    try {
      // Write temp wrapper and test it
      await sshService.exec(
        serverId,
        `cat > ${tmpWrapper} << 'NGINX_TEST_EOF'\n${wrapperContent}\nNGINX_TEST_EOF`,
      );
      const result = await sshService.exec(
        serverId,
        `nginx -t -c ${tmpWrapper} 2>&1`,
      );
      return {
        success: result.code === 0,
        output: result.stdout || result.stderr,
      };
    } finally {
      // Cleanup temp file
      await sshService.exec(serverId, `rm -f ${tmpWrapper}`).catch(() => {});
    }
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
   * Save config, auto-enable, test, and reload nginx
   */
  async saveAndReload(
    serverId: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; output: string }> {
    // Step 1: Save config
    await this.saveConfig(serverId, filename, content);

    // Step 2: Auto-enable (create symlink if not already enabled)
    try {
      await this.enableConfig(serverId, filename);
    } catch {
      // Already enabled or symlink exists, ignore
    }

    // Step 3: Test config before reloading
    const testResult = await this.testConfig(serverId);
    if (!testResult.success) {
      return {
        success: false,
        output: `Config saved but test failed:\n${testResult.output}`,
      };
    }

    // Step 4: Reload nginx
    const reloadResult = await this.reloadNginx(serverId);
    return {
      success: reloadResult.success,
      output: reloadResult.success
        ? "Config saved, enabled, tested, and nginx reloaded successfully"
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

  /**
   * Check if nginx is installed on the server
   */
  async checkNginxInstalled(
    serverId: string,
  ): Promise<{ installed: boolean; version?: string }> {
    try {
      const result = await sshService.exec(
        serverId,
        "which nginx && nginx -v 2>&1",
      );
      if (result.code === 0 && result.stdout.trim()) {
        const versionMatch = (result.stdout + result.stderr).match(
          /nginx\/[\d.]+/,
        );
        return {
          installed: true,
          version: versionMatch ? versionMatch[0] : undefined,
        };
      }
      return { installed: false };
    } catch {
      return { installed: false };
    }
  }

  /**
   * Install nginx on the server (streamed via onLine callback)
   */
  async installNginx(
    serverId: string,
    onLine: (line: string) => void,
  ): Promise<void> {
    onLine("🔍 Detecting package manager...");

    // Detect distro
    const distroCheck = await sshService.exec(
      serverId,
      "cat /etc/os-release 2>/dev/null | head -5",
    );
    onLine(distroCheck.stdout.trim() || "Unknown distribution");

    // Check if apt or yum/dnf
    const hasApt = await sshService.exec(serverId, "which apt-get 2>/dev/null");
    const hasYum = await sshService.exec(serverId, "which yum 2>/dev/null");
    const hasDnf = await sshService.exec(serverId, "which dnf 2>/dev/null");

    let installCmd: string;
    if (hasApt.code === 0) {
      onLine("📦 Using apt package manager");
      installCmd =
        "export DEBIAN_FRONTEND=noninteractive && apt-get update 2>&1 && apt-get install -y nginx 2>&1";
    } else if (hasDnf.code === 0) {
      onLine("📦 Using dnf package manager");
      installCmd = "dnf install -y nginx 2>&1";
    } else if (hasYum.code === 0) {
      onLine("📦 Using yum package manager");
      installCmd = "yum install -y nginx 2>&1";
    } else {
      throw new Error(
        "Unsupported package manager. Only apt, yum, and dnf are supported.",
      );
    }

    onLine("⬇️ Installing nginx...");
    onLine("───────────────────────────────────");

    const installResult = await sshService.exec(
      serverId,
      installCmd,
      300000, // 5 minutes timeout
    );

    // Stream output lines
    const output = installResult.stdout || installResult.stderr || "";
    for (const line of output.split("\n").filter((l) => l.trim())) {
      onLine(line);
    }

    if (installResult.code !== 0) {
      throw new Error(
        `Installation failed with exit code ${installResult.code}`,
      );
    }

    onLine("───────────────────────────────────");
    onLine("✅ Nginx installed successfully!");

    // Enable and start nginx
    onLine("🚀 Enabling and starting nginx...");
    const enableResult = await sshService.exec(
      serverId,
      "systemctl enable nginx 2>&1 && systemctl start nginx 2>&1",
      30000,
    );
    const enableOutput = enableResult.stdout || enableResult.stderr || "";
    for (const line of enableOutput.split("\n").filter((l) => l.trim())) {
      onLine(line);
    }

    if (enableResult.code !== 0) {
      onLine("⚠️ Nginx installed but failed to start automatically");
    } else {
      onLine("✅ Nginx is running!");
    }

    // Verify
    const verifyResult = await sshService.exec(serverId, "nginx -v 2>&1");
    const version = (verifyResult.stdout + verifyResult.stderr).trim();
    if (version) {
      onLine(`📋 Version: ${version}`);
    }
  }

  /**
   * Generate a full Nginx configuration string
   */
  generateConfig(options: {
    domains: string[];
    type: "proxy" | "static";
    proxyPass?: string;
    websockets?: boolean;
    rootPath?: string;
    indexFiles?: string;
    cors?: boolean;
    maxBodySize?: string;
    ssl?: boolean;
    gzip?: boolean;
    securityHeaders?: boolean;
    proxyConnectTimeout?: string;
    proxyReadTimeout?: string;
    proxySendTimeout?: string;
  }): string {
    const {
      domains,
      type,
      proxyPass,
      websockets,
      rootPath,
      indexFiles,
      cors,
      maxBodySize,
      ssl,
      gzip,
      securityHeaders,
      proxyConnectTimeout,
      proxyReadTimeout,
      proxySendTimeout,
    } = options;
    const domainString = domains.join(" ");
    const lines: string[] = [];

    // ─── HTTP→HTTPS redirect block ───
    if (ssl) {
      lines.push(`server {
    listen 80;
    server_name ${domainString};
    return 301 https://$host$request_uri;
}
`);
    }

    // ─── Main server block ───
    lines.push(`server {`);
    if (ssl) {
      lines.push(`    listen 443 ssl http2;`);
      lines.push(`    server_name ${domainString};`);
      lines.push(``);
      lines.push(
        `    # SSL — managed by Certbot (update paths after provisioning)`,
      );
      lines.push(
        `    ssl_certificate /etc/letsencrypt/live/${domains[0]}/fullchain.pem;`,
      );
      lines.push(
        `    ssl_certificate_key /etc/letsencrypt/live/${domains[0]}/privkey.pem;`,
      );
      lines.push(`    ssl_protocols TLSv1.2 TLSv1.3;`);
      lines.push(`    ssl_prefer_server_ciphers on;`);
    } else {
      lines.push(`    listen 80;`);
      lines.push(`    server_name ${domainString};`);
    }

    // client_max_body_size
    if (maxBodySize) {
      lines.push(``);
      lines.push(`    client_max_body_size ${maxBodySize};`);
    }

    // ─── Gzip ───
    if (gzip) {
      lines.push(``);
      lines.push(`    # Gzip Compression`);
      lines.push(`    gzip on;`);
      lines.push(`    gzip_vary on;`);
      lines.push(`    gzip_proxied any;`);
      lines.push(`    gzip_comp_level 6;`);
      lines.push(`    gzip_min_length 256;`);
      lines.push(
        `    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/vnd.ms-fontobject application/x-font-ttf font/opentype image/svg+xml image/x-icon;`,
      );
    }

    // ─── Security Headers ───
    if (securityHeaders) {
      lines.push(``);
      lines.push(`    # Security Headers`);
      lines.push(`    add_header X-Frame-Options "SAMEORIGIN" always;`);
      lines.push(`    add_header X-Content-Type-Options "nosniff" always;`);
      lines.push(`    add_header X-XSS-Protection "1; mode=block" always;`);
      lines.push(
        `    add_header Referrer-Policy "strict-origin-when-cross-origin" always;`,
      );
      if (ssl) {
        lines.push(
          `    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`,
        );
      }
    }

    // ─── CORS ───
    if (cors) {
      lines.push(``);
      lines.push(`    # CORS Headers`);
      lines.push(`    add_header 'Access-Control-Allow-Origin' '*' always;`);
      lines.push(
        `    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE' always;`,
      );
      lines.push(
        `    add_header 'Access-Control-Allow-Headers' 'DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization' always;`,
      );
    }

    // ─── Location block ───
    lines.push(``);
    if (type === "proxy" && proxyPass) {
      const cleanProxyPass = proxyPass.endsWith("/")
        ? proxyPass.slice(0, -1)
        : proxyPass;
      lines.push(`    location / {`);
      lines.push(`        proxy_pass ${cleanProxyPass};`);
      lines.push(`        proxy_http_version 1.1;`);
      if (websockets) {
        lines.push(`        proxy_set_header Upgrade $http_upgrade;`);
        lines.push(`        proxy_set_header Connection "upgrade";`);
      }
      lines.push(`        proxy_set_header Host $host;`);
      lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
      lines.push(
        `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      );
      lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
      // Proxy timeouts
      if (proxyConnectTimeout) {
        lines.push(`        proxy_connect_timeout ${proxyConnectTimeout};`);
      }
      if (proxyReadTimeout) {
        lines.push(`        proxy_read_timeout ${proxyReadTimeout};`);
      }
      if (proxySendTimeout) {
        lines.push(`        proxy_send_timeout ${proxySendTimeout};`);
      }
      lines.push(`    }`);
    } else if (type === "static" && rootPath) {
      lines.push(`    root ${rootPath};`);
      lines.push(`    index ${indexFiles || "index.html index.htm"};`);
      lines.push(``);
      lines.push(`    location / {`);
      lines.push(`        try_files $uri $uri/ /index.html;`);
      lines.push(`    }`);
    }

    lines.push(`}`);
    return lines.join("\n");
  }

  /**
   * Generate multi-block config (multiple server blocks in one file)
   */
  generateMultiConfig(
    blocks: Array<{
      domains: string[];
      type: "proxy" | "static";
      proxyPass?: string;
      websockets?: boolean;
      rootPath?: string;
      indexFiles?: string;
      cors?: boolean;
      maxBodySize?: string;
      ssl?: boolean;
      gzip?: boolean;
      securityHeaders?: boolean;
      proxyConnectTimeout?: string;
      proxyReadTimeout?: string;
      proxySendTimeout?: string;
    }>,
  ): string {
    return blocks.map((block) => this.generateConfig(block)).join("\n\n");
  }
}

export default new NginxService();
