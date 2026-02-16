import { Client, SFTPWrapper } from "ssh2";
import Server from "../models/Server";
import sshService from "./sshService";

export interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number;
  permissions: string; // e.g. "rwxr-xr-x"
  permissionsOctal: string; // e.g. "755"
  owner: number;
  group: number;
  modified: string; // ISO date
  isHidden: boolean;
}

interface CachedSFTP {
  sftp: SFTPWrapper;
  conn: Client;
  timer: ReturnType<typeof setTimeout>;
}

const SFTP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes idle timeout

class SFTPService {
  private cache = new Map<string, CachedSFTP>();

  /**
   * Get an SFTP session — reuses cached connection if available
   */
  private async getSFTP(serverId: string): Promise<{
    sftp: SFTPWrapper;
    conn: Client;
  }> {
    // Return cached connection if alive
    const cached = this.cache.get(serverId);
    if (cached) {
      // Reset idle timer
      clearTimeout(cached.timer);
      cached.timer = setTimeout(
        () => this.closeConnection(serverId),
        SFTP_CACHE_TTL,
      );
      return { sftp: cached.sftp, conn: cached.conn };
    }

    const server = await Server.findById(serverId).select(
      "+password +privateKey +passphrase",
    );
    if (!server) throw new Error("Server not found");

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const connectConfig: any = {
        host: server.host,
        port: server.port || 22,
        username: server.username,
        readyTimeout: 10000,
      };

      if (server.authType === "key" && (server as any).privateKey) {
        connectConfig.privateKey = (server as any).privateKey;
        if ((server as any).passphrase) {
          connectConfig.passphrase = (server as any).passphrase;
        }
      } else if ((server as any).password) {
        connectConfig.password = (server as any).password;
      }

      conn.on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          // Cache this connection
          const timer = setTimeout(
            () => this.closeConnection(serverId),
            SFTP_CACHE_TTL,
          );
          this.cache.set(serverId, { sftp, conn, timer });

          // Clean up on unexpected close
          conn.on("close", () => {
            this.cache.delete(serverId);
          });
          conn.on("error", () => {
            this.cache.delete(serverId);
          });

          resolve({ sftp, conn });
        });
      });

      conn.on("error", (err) => {
        console.error(
          `[SFTP] Connection error for ${server.host}: ${err.message}`,
        );
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.connect(connectConfig);
    });
  }

  /**
   * Close and remove a cached connection
   */
  private closeConnection(serverId: string): void {
    const cached = this.cache.get(serverId);
    if (cached) {
      clearTimeout(cached.timer);
      try {
        cached.conn.end();
      } catch {}
      this.cache.delete(serverId);
    }
  }

  /**
   * Convert file mode to permission string
   */
  private modeToPermissions(mode: number): string {
    const perms = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
    const owner = (mode >> 6) & 7;
    const group = (mode >> 3) & 7;
    const other = mode & 7;
    return perms[owner] + perms[group] + perms[other];
  }

  private modeToOctal(mode: number): string {
    const owner = (mode >> 6) & 7;
    const group = (mode >> 3) & 7;
    const other = mode & 7;
    return `${owner}${group}${other}`;
  }

  /* ── Short-lived directory listing cache (3 s) ── */
  private dirCache = new Map<string, { entries: FileEntry[]; ts: number }>();
  private readonly DIR_CACHE_TTL = 3000;

  /**
   * List directory contents — uses fast SSH `ls` instead of slow SFTP readdir
   */
  async listDirectory(
    serverId: string,
    dirPath: string,
    type?: "directory" | "file",
  ): Promise<FileEntry[]> {
    const cacheKey = `${serverId}:${dirPath}:${type || "all"}`;
    const cached = this.dirCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.DIR_CACHE_TTL) {
      return cached.entries;
    }

    let command = `ls -la --time-style=full-iso '${dirPath.replace(
      /'/g,
      "'\\''",
    )}' 2>/dev/null`;

    // Optimize: Filter on server side if only directories needed
    if (type === "directory") {
      command += ` | grep "^d"`;
    } else if (type === "file") {
      command += ` | grep -v "^d"`;
    }

    const result = await sshService.exec(serverId, command);

    const lines = result.stdout
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("total"));
    const entries: FileEntry[] = [];

    for (const line of lines) {
      // ls -la output: permissions links owner group size date time tz name
      // Example: drwxr-xr-x 2 root root 4096 2024-01-15 10:30:00.000000000 +0700 mydir
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const perms = parts[0];
      const owner = parseInt(parts[2]) || 0;
      const group = parseInt(parts[3]) || 0;
      const size = parseInt(parts[4]) || 0;
      const dateStr = parts[5];
      const timeStr = parts[6];
      const tz = parts[7];
      const name = parts
        .slice(8)
        .join(" ")
        .replace(/ -> .*$/, ""); // remove symlink target

      if (name === "." || name === "..") continue;

      const isDir = perms.startsWith("d");
      const isSymlink = perms.startsWith("l");

      // Parse octal from permission string
      const permStr = perms.substring(1);
      const octal = this.permStringToOctal(permStr);

      entries.push({
        name,
        type: isSymlink ? "symlink" : isDir ? "directory" : "file",
        size,
        permissions: permStr,
        permissionsOctal: octal,
        owner,
        group,
        modified: new Date(`${dateStr}T${timeStr}${tz}`).toISOString(),
        isHidden: name.startsWith("."),
      });
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });

    this.dirCache.set(cacheKey, { entries, ts: Date.now() });
    return entries;
  }

  /** Convert rwxrwxrwx string to octal like "755" */
  private permStringToOctal(perm: string): string {
    const charVal = (r: string, w: string, x: string) =>
      (r !== "-" ? 4 : 0) +
      (w !== "-" ? 2 : 0) +
      (x !== "-" && x !== "t" && x !== "T" && x !== "s" && x !== "S" ? 1 : 0);
    const u = charVal(perm[0], perm[1], perm[2]);
    const g = charVal(perm[3], perm[4], perm[5]);
    const o = charVal(perm[6], perm[7], perm[8]);
    return `${u}${g}${o}`;
  }

  /**
   * Read file content (text files, max 2MB) — uses fast SSH cat
   */
  async readFile(serverId: string, filePath: string): Promise<string> {
    const escaped = filePath.replace(/'/g, "'\\''");
    // Quick size check via SSH
    const sizeResult = await sshService.exec(serverId, `wc -c < '${escaped}'`);
    const size = parseInt(sizeResult.stdout.trim()) || 0;
    if (size > 2 * 1024 * 1024) {
      throw new Error("File too large to read (max 2MB)");
    }
    // Read via SSH cat (much faster than SFTP stream)
    const result = await sshService.exec(serverId, `cat '${escaped}'`);
    return result.stdout;
  }

  /**
   * Write content to a file
   */
  async writeFile(
    serverId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const { sftp } = await this.getSFTP(serverId);

    return new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(filePath);
      stream.on("close", () => resolve());
      stream.on("error", reject);
      stream.end(Buffer.from(content, "utf-8"));
    });
  }

  /**
   * Upload a file from buffer
   */
  async uploadFile(
    serverId: string,
    filePath: string,
    buffer: Buffer,
  ): Promise<void> {
    const { sftp } = await this.getSFTP(serverId);

    return new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(filePath);
      stream.on("close", () => resolve());
      stream.on("error", reject);
      stream.end(buffer);
    });
  }

  /**
   * Download file as buffer
   */
  async downloadFile(serverId: string, filePath: string): Promise<Buffer> {
    const { sftp } = await this.getSFTP(serverId);

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(filePath);

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  /**
   * Get a readable stream for a file (for preview/streaming)
   */
  async createReadStream(serverId: string, filePath: string): Promise<any> {
    const { sftp } = await this.getSFTP(serverId);
    return sftp.createReadStream(filePath);
  }

  /**
   * Delete a file
   */
  async deleteFile(serverId: string, filePath: string): Promise<void> {
    const { sftp } = await this.getSFTP(serverId);

    return new Promise<void>((resolve, reject) => {
      sftp.unlink(filePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Delete a directory (uses rm -rf via SSH for recursive delete)
   */
  async deleteDirectory(serverId: string, dirPath: string): Promise<void> {
    const escaped = dirPath.replace(/'/g, "'\\''");
    await sshService.exec(serverId, `rm -rf '${escaped}'`);
  }

  /**
   * Delete multiple items
   */
  async deleteItems(serverId: string, paths: string[]): Promise<void> {
    const args = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ");
    await sshService.exec(serverId, `rm -rf ${args}`);
  }

  /**
   * Create a directory
   */
  async createDirectory(serverId: string, dirPath: string): Promise<void> {
    const { sftp } = await this.getSFTP(serverId);

    return new Promise<void>((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Rename / move a file or directory
   */
  async rename(
    serverId: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const { sftp } = await this.getSFTP(serverId);

    return new Promise<void>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Get file/directory stats
   */
  async getStats(serverId: string, filePath: string): Promise<FileEntry> {
    const { sftp } = await this.getSFTP(serverId);

    const stats = await new Promise<any>((resolve, reject) => {
      sftp.stat(filePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });

    const isDir = (stats.mode & 0o40000) !== 0;
    const isSymlink = (stats.mode & 0o120000) === 0o120000;
    const name = filePath.split("/").pop() || filePath;

    return {
      name,
      type: isSymlink ? "symlink" : isDir ? "directory" : "file",
      size: stats.size || 0,
      permissions: this.modeToPermissions(stats.mode & 0o777),
      permissionsOctal: this.modeToOctal(stats.mode & 0o777),
      owner: stats.uid || 0,
      group: stats.gid || 0,
      modified: new Date((stats.mtime || 0) * 1000).toISOString(),
      isHidden: name.startsWith("."),
    };
  }

  /**
   * Change file permissions
   */
  async chmod(serverId: string, filePath: string, mode: string): Promise<void> {
    const numericMode = parseInt(mode, 8);
    if (isNaN(numericMode)) throw new Error("Invalid permission mode");

    const { sftp } = await this.getSFTP(serverId);

    return new Promise<void>((resolve, reject) => {
      sftp.chmod(filePath, numericMode, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  /**
   * Copy file or directory
   */
  async copyItem(
    serverId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<void> {
    const src = sourcePath.replace(/'/g, "'\\''");
    const dst = destPath.replace(/'/g, "'\\''");
    await sshService.exec(serverId, `cp -r '${src}' '${dst}'`);
  }

  /**
   * Create a tar.gz archive from files/directories
   */
  async zipItems(
    serverId: string,
    archivePath: string,
    items: string[],
    basePath: string,
  ): Promise<void> {
    const names = items.map((i) => `'${i.replace(/'/g, "'\\''")}'`).join(" ");
    const base = basePath.replace(/'/g, "'\\''");
    const arc = archivePath.replace(/'/g, "'\\''");
    await sshService.exec(
      serverId,
      `cd '${base}' && tar -czf '${arc}' ${names}`,
    );
  }

  /**
   * Extract an archive
   */
  async unzipArchive(
    serverId: string,
    archivePath: string,
    destPath: string,
  ): Promise<void> {
    // Detect format by extension
    const arc = archivePath.replace(/'/g, "'\\''");
    const dst = destPath.replace(/'/g, "'\\''");

    if (archivePath.endsWith(".zip")) {
      await sshService.exec(serverId, `unzip -o '${arc}' -d '${dst}'`);
    } else {
      // tar.gz, .tgz, .tar.bz2 etc.
      await sshService.exec(serverId, `tar -xf '${arc}' -C '${dst}'`);
    }
  }

  /**
   * Get disk usage info
   */
  async getDiskUsage(
    serverId: string,
    dirPath: string,
  ): Promise<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usePercent: string;
    mountedOn: string;
  }> {
    const escaped = dirPath.replace(/'/g, "'\\''");
    const result = await sshService.exec(
      serverId,
      `df -h '${escaped}' | tail -1`,
    );
    const parts = result.stdout.trim().split(/\s+/);
    return {
      filesystem: parts[0] || "",
      size: parts[1] || "",
      used: parts[2] || "",
      available: parts[3] || "",
      usePercent: parts[4] || "",
      mountedOn: parts[5] || "",
    };
  }

  /**
   * Get size of a directory (du -sh)
   */
  async getDirSize(serverId: string, dirPath: string): Promise<string> {
    const escaped = dirPath.replace(/'/g, "'\\''");
    // du -sh outputs: "4.0K    /path/to/dir"
    const result = await sshService.exec(
      serverId,
      `du -sh '${escaped}' | cut -f1`,
    );
    return result.stdout.trim();
  }

  /**
   * Get sizes of all items in a directory (batch)
   */
  async getDirSizes(
    serverId: string,
    dirPath: string,
    items?: string[],
  ): Promise<Record<string, string>> {
    try {
      const safePath = `'${dirPath.replace(/'/g, "'\\''")}'`;
      let command;

      if (items && items.length > 0) {
        const safeItems = items
          .map((i) => `'${i.replace(/'/g, "'\\''")}'`)
          .join(" ");
        command = `cd ${safePath} && du -shL -- ${safeItems} 2>/dev/null`;
      } else {
        command = `cd ${safePath} && du -shL * 2>/dev/null`;
      }

      const result = await sshService.exec(serverId, command);

      const sizes: Record<string, string> = {};
      const lines = result.stdout.split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const size = parts[0];
          // name might contain spaces, so join the rest
          const name = parts.slice(1).join(" ");
          sizes[name] = size;
        }
      }
      return sizes;
    } catch (error) {
      // Likely empty directory or permission error
      return {};
    }
  }

  async deleteMultiple(serverId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    // Chunk paths to avoid command line length limits
    const chunkSize = 50;
    for (let i = 0; i < paths.length; i += chunkSize) {
      const chunk = paths.slice(i, i + chunkSize);
      const command = `rm -rf ${chunk
        .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
        .join(" ")}`;
      await sshService.exec(serverId, command);
    }
  }
}

export default new SFTPService();
