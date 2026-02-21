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
        const imgLower = image.toLowerCase();
        const nameLower = name.toLowerCase();

        if (imgLower.includes("postgres") || nameLower.includes("postgres"))
          type = "postgres";
        else if (
          imgLower.includes("mysql") ||
          imgLower.includes("mariadb") ||
          nameLower.includes("mysql") ||
          nameLower.includes("mariadb")
        )
          type = "mysql";
        else if (imgLower.includes("mongo") || nameLower.includes("mongo"))
          type = "mongo";
        else if (imgLower.includes("redis") || nameLower.includes("redis"))
          type = "redis";

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

      // Check for native installations via systemctl (if available)
      try {
        const sysCmd = `systemctl list-units --type=service --state=running --no-pager --no-legend "mongod*" "mysql*" "mariadb*" "postgresql*" "redis*"`;
        const sysResult = await sshService.exec(serverId, sysCmd);

        if (sysResult.code === 0 && sysResult.stdout) {
          const sysLines = sysResult.stdout.trim().split("\n");
          for (const line of sysLines) {
            if (!line.trim()) continue;
            // systemctl output: mongod.service loaded active running MongoDB Database Server
            const match = line.match(/^(\S+)\.service\s+/);
            if (match) {
              const serviceName = match[1];
              let type: DockerContainer["type"] = "unknown";

              if (serviceName.includes("postgres")) type = "postgres";
              else if (
                serviceName.includes("mysql") ||
                serviceName.includes("mariadb")
              )
                type = "mysql";
              else if (serviceName.includes("mongo")) type = "mongo";
              else if (serviceName.includes("redis")) type = "redis";

              if (type !== "unknown") {
                containers.push({
                  id: "native-" + serviceName,
                  name: `[Native] ${serviceName}`,
                  image: "Host OS",
                  status: "running",
                  ports: "Native",
                  type,
                });
              }
            }
          }
        }
      } catch (sysErr) {
        console.log("Error checking native DB services:", sysErr);
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

    const isNative = containerId.startsWith("native-");
    const execPrefix = isNative ? "" : `docker exec ${containerId} `;

    switch (dbType) {
      case "postgres":
        filename = `backup-${dbName}-${timestamp}.sql`;
        if (dbPassword) {
          cmd = `${isNative ? `PGPASSWORD="${dbPassword}" ` : `docker exec -e PGPASSWORD="${dbPassword}" ${containerId} `}pg_dump -U "${dbUser}" "${dbName}" > "${this.backupDir}/${filename}"`;
        } else {
          cmd = `${execPrefix}pg_dump -U "${dbUser}" "${dbName}" > "${this.backupDir}/${filename}"`;
        }
        break;

      case "mysql":
        filename = `backup-${dbName}-${timestamp}.sql`;
        const passPart = dbPassword ? `-p"${dbPassword}"` : "";
        cmd = `${execPrefix}mysqldump -u "${dbUser}" ${passPart} "${dbName}" > "${this.backupDir}/${filename}"`;
        break;

      case "mongo":
        filename = `backup-${dbName}-${timestamp}.gz`;
        cmd = `${execPrefix}mongodump --username="${dbUser}" --password="${dbPassword}" --authenticationDatabase=admin --db="${dbName}" --archive --gzip > "${this.backupDir}/${filename}"`;
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

    const isNative = containerId.startsWith("native-");
    const execPrefix = isNative ? "" : `docker exec -i ${containerId} `;

    switch (dbType) {
      case "postgres":
        // psql -U username -d dbname < file
        // Postgres might require dropping existing connections/tables first, but let's try direct restore
        if (dbPassword) {
          cmd = `cat "${filePath}" | ${isNative ? `PGPASSWORD="${dbPassword}" ` : `docker exec -i -e PGPASSWORD="${dbPassword}" ${containerId} `}psql -U "${dbUser}" -d "${dbName}"`;
        } else {
          cmd = `cat "${filePath}" | ${execPrefix}psql -U "${dbUser}" -d "${dbName}"`;
        }
        break;

      case "mysql":
        // mysql -u username -p dbname < file
        const passPart = dbPassword ? `-p"${dbPassword}"` : "";
        cmd = `cat "${filePath}" | ${execPrefix}mysql -u "${dbUser}" ${passPart} "${dbName}"`;
        break;

      case "mongo":
        // mongorestore --archive=file --gzip --db dbname
        cmd = `cat "${filePath}" | ${execPrefix}mongorestore --username="${dbUser}" --password="${dbPassword}" --authenticationDatabase=admin --db="${dbName}" --archive --gzip`;
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
   * Get schema (tables / collections) and optionally columns
   */
  async getSchema(
    serverId: string,
    containerId: string,
    dbType: string,
    dbName: string,
    dbUser: string,
    dbPassword?: string,
    table?: string,
  ): Promise<any> {
    const isNative = containerId.startsWith("native-");
    const execPrefix = isNative ? "" : `docker exec -i ${containerId} `;

    let query = "";
    if (dbType === "postgres") {
      query = table
        ? `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${table}';`
        : `SELECT table_name FROM information_schema.tables WHERE table_schema='public';`;
    } else if (dbType === "mysql") {
      query = table
        ? `SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type FROM information_schema.columns WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${table}';`
        : `SHOW TABLES;`;
    } else if (dbType === "mongo") {
      query = table ? `[]` : `db.getCollectionNames()`; // For Mongo columns we'd have to sample docs, skipping for now
    } else {
      throw new Error(`Unsupported type for schema: ${dbType}`);
    }

    return this.executeQuery(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      query,
    );
  }

  /**
   * Execute raw query and return JSON array of results
   */
  async executeQuery(
    serverId: string,
    containerId: string,
    dbType: string,
    dbName: string,
    dbUser: string,
    dbPassword?: string,
    query?: string,
  ): Promise<any[]> {
    if (!query) return [];

    const isNative = containerId.startsWith("native-");
    const execPrefix = isNative ? "" : `docker exec -i ${containerId} `;
    let cmd = "";

    switch (dbType) {
      case "postgres":
        // Use json_agg to get output as clean JSON
        const safeQuery = query.replace(/"/g, '\\"');
        const pgQuery = `SELECT json_agg(t) FROM (${safeQuery}) t;`;
        if (dbPassword) {
          cmd = `${isNative ? `PGPASSWORD="${dbPassword}" ` : `docker exec -i -e PGPASSWORD="${dbPassword}" ${containerId} `}psql -q -t -A -U "${dbUser}" -d "${dbName}" -c "${pgQuery}"`;
        } else {
          cmd = `${execPrefix}psql -q -t -A -U "${dbUser}" -d "${dbName}" -c "${pgQuery}"`;
        }
        break;

      case "mysql":
        // Use batch mode to get TSV, parsing on JS side
        const passPart = dbPassword ? `-p"${dbPassword}"` : "";
        cmd = `${execPrefix}mysql -B -u "${dbUser}" ${passPart} "${dbName}" -e "${query.replace(/"/g, '\\"')}"`;
        break;

      case "mongo":
        // Expect user to write standard mongo shell code, e.g. db.users.find().toArray()
        // Or if just `show collections`, handled by caller.
        const mQuery =
          query === "db.getCollectionNames()"
            ? "EJSON.stringify(db.getCollectionNames())"
            : `EJSON.stringify(${query})`;
        cmd = `${execPrefix}mongosh --quiet --username="${dbUser}" --password="${dbPassword}" --authenticationDatabase=admin "${dbName}" --eval "console.log(${mQuery.replace(/"/g, '\\"')})"`;
        break;

      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }

    const result = await sshService.exec(serverId, cmd);

    // Ignore small warnings in stderr if code is 0
    if (result.code !== 0 && result.stderr.trim().length > 0) {
      // Sometimes MySQL outputs warnings on stderr but succeeds
      const lower = result.stderr.toLowerCase();
      if (!lower.includes("warning: using a password")) {
        throw new Error(result.stderr);
      }
    }

    const out = result.stdout.trim();
    if (!out) return [];

    try {
      if (dbType === "postgres" || dbType === "mongo") {
        let cleanOut = out.trim();
        // Extract JSON structure if there are warnings prepended/appended
        const arrayIdx = cleanOut.indexOf("[");
        const objIdx = cleanOut.indexOf("{");

        let startIdx = arrayIdx;
        if (arrayIdx === -1 || (objIdx !== -1 && objIdx < arrayIdx)) {
          startIdx = objIdx;
        }

        if (startIdx !== -1) {
          const endIdx = cleanOut.lastIndexOf(
            cleanOut[startIdx] === "[" ? "]" : "}",
          );
          if (endIdx !== -1) {
            cleanOut = cleanOut.substring(startIdx, endIdx + 1);
          }
        }

        if (cleanOut === "[]" || cleanOut === "") return [];

        const parsed = JSON.parse(cleanOut);
        // mongosh db.getCollectionNames() returns an array of strings. Convert to objects so DataGrid can display it
        if (
          dbType === "mongo" &&
          query === "db.getCollectionNames()" &&
          Array.isArray(parsed)
        ) {
          return parsed.map((collectionName: string) => ({
            name: collectionName,
          }));
        }
        return parsed;
      } else if (dbType === "mysql") {
        // Parse TSV
        const lines = out
          .split(/\r?\n/)
          .filter(
            (l) =>
              !l.toLowerCase().includes("using a password") && l.trim() !== "",
          );
        if (lines.length <= 1 && !lines[0]?.includes("\t")) {
          // It might be a single result string or empty like an UPDATE
          return lines[0] ? [{ result: lines[0] }] : [];
        }
        const headers = lines[0].split("\t");
        const data = [];
        for (let i = 1; i < lines.length; i++) {
          const rowLines = lines[i].split("\t");
          const rowObj: any = {};
          headers.forEach((h, idx) => {
            rowObj[h] = rowLines[idx];
          });
          data.push(rowObj);
        }
        return data;
      }
      return [];
    } catch (parseErr: any) {
      console.error("DB Parse error. Output was:", out);
      throw new Error("Failed to parse DB output.");
    }
  }

  /**
   * Execute a specific data action (insert, update, delete)
   */
  async executeAction(
    serverId: string,
    containerId: string,
    dbType: string,
    dbName: string,
    dbUser: string,
    dbPassword: string,
    table: string,
    action: "insert" | "update" | "delete",
    idField: string,
    idValue: string | number,
    data?: any, // For insert/update
  ): Promise<any> {
    let query = "";

    // Helper functions to escape values
    const escapeSql = (val: any) => {
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "number") return val;
      if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
      // Basic SQL string escaping (replace ' with '')
      return `'${String(val).replace(/'/g, "''")}'`;
    };

    if (dbType === "postgres" || dbType === "mysql") {
      switch (action) {
        case "insert": {
          if (!data || Object.keys(data).length === 0)
            throw new Error("No data provided for insert");
          // Remove auto-generated id fields if they are empty or new
          const insertData = { ...data };
          if (insertData.id === "") delete insertData.id;

          const columns = Object.keys(insertData)
            .map((k) => `"${k}"`)
            .join(", ");
          const values = Object.values(insertData).map(escapeSql).join(", ");

          query = `INSERT INTO "${table}" (${columns}) VALUES (${values})`;
          if (dbType === "postgres") query += ` RETURNING *`;
          query += ";";
          break;
        }
        case "update": {
          if (!data || Object.keys(data).length === 0)
            throw new Error("No data provided for update");
          const setClause = Object.entries(data)
            .filter(([k]) => k !== idField) // Don't update the primary key
            .map(([k, v]) => `"${k}" = ${escapeSql(v)}`)
            .join(", ");

          query = `UPDATE "${table}" SET ${setClause} WHERE "${idField}" = ${escapeSql(idValue)}`;
          if (dbType === "postgres") query += ` RETURNING *`;
          query += ";";
          break;
        }
        case "delete": {
          query = `DELETE FROM "${table}" WHERE "${idField}" = ${escapeSql(idValue)}`;
          if (dbType === "postgres") query += ` RETURNING *`;
          query += ";";
          break;
        }
        default:
          throw new Error(`Unsupported action: ${action}`);
      }

      // MySQL doesn't support RETURNING, so we might need to handle the response differently, but it usually returns empty on success.
      // For Postgres, it will return the JSON array since we use \x and json_agg logic in executeQuery.
      // Actually `executeQuery` wraps queries differently.
      // PostgreSQL wraps with json_agg. MySQL just executes it.
    } else if (dbType === "mongo") {
      // idValue might be an ObjectId string, if so we need to wrap it in ObjectId()
      const isObjectId =
        typeof idValue === "string" && /^[0-9a-fA-F]{24}$/.test(idValue);
      const mongoIdStr = isObjectId
        ? `ObjectId("${idValue}")`
        : typeof idValue === "string"
          ? `"${idValue}"`
          : idValue;

      switch (action) {
        case "insert": {
          if (!data) throw new Error("No data provided for insert");
          const insertData = { ...data };
          if (insertData._id === "") delete insertData._id;
          const jsonStr = JSON.stringify(insertData);
          query = `db.getCollection("${table}").insertOne(${jsonStr})`;
          break;
        }
        case "update": {
          if (!data) throw new Error("No data provided for update");
          const updateData = { ...data };
          delete updateData._id; // Never update _id
          const jsonStr = JSON.stringify(updateData);
          query = `db.getCollection("${table}").updateOne({ "${idField}": ${mongoIdStr} }, { $set: ${jsonStr} })`;
          break;
        }
        case "delete": {
          query = `db.getCollection("${table}").deleteOne({ "${idField}": ${mongoIdStr} })`;
          break;
        }
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } else {
      throw new Error(`Unsupported dbType: ${dbType}`);
    }

    // Call the existing executeQuery to handle the SSH and formatting
    return this.executeQuery(
      serverId,
      containerId,
      dbType,
      dbName,
      dbUser,
      dbPassword,
      query,
    );
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
