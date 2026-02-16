import sftpService from "./sftpService";
import sshService from "./sshService";

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  type: "postgres" | "mysql" | "mongo" | "redis" | "unknown";
}

class DatabaseService {
  /**
   * List all running docker containers that look like databases
   */
  async listContainers(serverId: string): Promise<DockerContainer[]> {
    try {
      // Format: ID|Names|Image|Status|Ports
      const cmd = `docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"`;
      const result = await sshService.exec(serverId, cmd);

      if (result.code !== 0) {
        throw new Error(result.stderr || "Failed to list docker containers");
      }

      const lines = result.stdout.trim().split("\n");
      const containers: DockerContainer[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        const [id, name, image, status, ports] = line.split("|");

        // Simple heuristic to detect DB type
        let type: DockerContainer["type"] = "unknown";
        if (image.includes("postgres")) type = "postgres";
        else if (image.includes("mysql") || image.includes("mariadb"))
          type = "mysql";
        else if (image.includes("mongo")) type = "mongo";
        else if (image.includes("redis")) type = "redis";

        // Filter to only show likely DBs (optional, maybe show all?)
        // Let's show all but highlight DBs, or just show detected DBs.
        // For a "Database Manager", showing only DBs makes sense.
        if (type !== "unknown") {
          containers.push({
            id,
            name,
            image,
            status,
            ports,
            type,
          });
        }
      }

      return containers;
    } catch (error: any) {
      // If docker is not found, return empty or throw specific error
      if (error.message?.includes("command not found")) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Perform a backup dump
   */
  private backupDir = "~/database-backups";

  private async ensureBackupDir(serverId: string) {
    await sshService.exec(serverId, `mkdir -p ${this.backupDir}`);
  }

  /**
   * List available backup files
   */
  async listBackups(serverId: string): Promise<any[]> {
    await this.ensureBackupDir(serverId);
    const result = await sshService.exec(
      serverId,
      `ls -lh --time-style=long-iso ${this.backupDir} | awk '{print $5, $6, $7, $8}'`,
    );
    // output: Size Date Time Filename
    // e.g. 2.4K 2023-10-27 10:00 backup.sql

    if (result.code !== 0) return [];

    return result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("total"))
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 4) return null;
        const size = parts[0];
        const date = parts[1];
        const time = parts[2];
        const filename = parts.slice(3).join(" ");
        return { filename, size, date: `${date} ${time}` };
      })
      .filter(Boolean);
  }

  /**
   * Delete a backup file
   */
  async deleteBackup(serverId: string, filename: string): Promise<void> {
    // Basic sanitization
    if (filename.includes("/") || filename.includes("..")) {
      throw new Error("Invalid filename");
    }
    await sshService.exec(serverId, `rm -f "${this.backupDir}/${filename}"`);
  }

  /**
   * Perform a backup dump
   */
  async backup(
    serverId: string,
    containerId: string,
    dbType: string,
    dbName: string,
    dbUser: string,
    dbPassword?: string,
  ): Promise<{ filename: string; path: string }> {
    await this.ensureBackupDir(serverId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let filename = "";
    let cmd = "";

    switch (dbType) {
      case "postgres":
        filename = `backup-${dbName}-${timestamp}.sql`;
        if (dbPassword) {
          cmd = `docker exec -e PGPASSWORD="${dbPassword}" ${containerId} pg_dump -U "${dbUser}" "${dbName}" > "${this.backupDir}/${filename}"`;
        } else {
          cmd = `docker exec ${containerId} pg_dump -U "${dbUser}" "${dbName}" > "${this.backupDir}/${filename}"`;
        }
        break;

      case "mysql":
        filename = `backup-${dbName}-${timestamp}.sql`;
        const passPart = dbPassword ? `-p"${dbPassword}"` : "";
        cmd = `docker exec ${containerId} mysqldump -u "${dbUser}" ${passPart} "${dbName}" > "${this.backupDir}/${filename}"`;
        break;

      case "mongo":
        filename = `backup-${dbName}-${timestamp}.gz`;
        cmd = `docker exec ${containerId} mongodump --username="${dbUser}" --password="${dbPassword}" --authenticationDatabase=admin --db="${dbName}" --archive > "${this.backupDir}/${filename}"`;
        break;

      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }

    await sshService.exec(serverId, cmd);
    return { filename, path: `${this.backupDir}/${filename}` };
  }

  /**
   * Restore a database from backup
   */
  async restore(
    serverId: string,
    containerId: string,
    dbType: string,
    dbName: string,
    dbUser: string,
    dbPassword?: string,
    filename?: string,
  ): Promise<void> {
    if (!filename) throw new Error("Filename is required");
    // Basic sanitization
    if (filename.includes("/") || filename.includes("..")) {
      throw new Error("Invalid filename");
    }

    const filePath = `${this.backupDir}/${filename}`;
    let cmd = "";

    switch (dbType) {
      case "postgres":
        // psql -U username -d dbname < file
        // Postgres might require dropping existing connections/tables first, but let's try direct restore
        if (dbPassword) {
          cmd = `cat "${filePath}" | docker exec -i -e PGPASSWORD="${dbPassword}" ${containerId} psql -U "${dbUser}" -d "${dbName}"`;
        } else {
          cmd = `cat "${filePath}" | docker exec -i ${containerId} psql -U "${dbUser}" -d "${dbName}"`;
        }
        break;

      case "mysql":
        // mysql -u username -p dbname < file
        const passPart = dbPassword ? `-p"${dbPassword}"` : "";
        cmd = `cat "${filePath}" | docker exec -i ${containerId} mysql -u "${dbUser}" ${passPart} "${dbName}"`;
        break;

      case "mongo":
        // mongorestore --archive=file --gzip --db dbname
        cmd = `cat "${filePath}" | docker exec -i ${containerId} mongorestore --username="${dbUser}" --password="${dbPassword}" --authenticationDatabase=admin --db="${dbName}" --archive --gzip`;
        break;

      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }

    const result = await sshService.exec(serverId, cmd);
    if (result.code !== 0) {
      throw new Error(`Restore failed: ${result.stderr}`);
    }
  }

  /**
   * Get a readable stream for a backup file
   */
  async getBackupStream(serverId: string, filename: string): Promise<any> {
    // Basic sanitization
    if (filename.includes("/") || filename.includes("..")) {
      throw new Error("Invalid filename");
    }
    return sftpService.createReadStream(serverId, filename);
    // sftpService is imported as 'sshService' in line 1? No.
    // Line 1: import sshService from "./sshService";
    // I need to import sftpService.

    // Actually, I can just use the path and let controller handle sftpService?
    // No, better to encapsulate.
    // But I need sftpService instance.
    // Let me check imports in databaseService.ts
    // It only imports sshService.
    // I need to import sftpService.
    return null;
  }
}

export default new DatabaseService();
