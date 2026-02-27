import sshService from "./sshService";
import logger from "../utils/logger";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
  size: string;
  networks: string;
  command: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface ContainerStats {
  containerId: string;
  name: string;
  cpuPercent: string;
  memUsage: string;
  memPercent: string;
  netIO: string;
  blockIO: string;
  pids: string;
}

class DockerService {
  /**
   * List all containers (running + stopped)
   */
  async listContainers(serverId: string): Promise<DockerContainer[]> {
    const format =
      '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}","size":"{{.Size}}","networks":"{{.Networks}}","command":"{{.Command}}"}';
    const { stdout, stderr, code } = await sshService.exec(
      serverId,
      `docker ps -a --format '${format}' --no-trunc 2>/dev/null`,
    );

    if (code !== 0 && stderr.includes("command not found")) {
      throw new Error("Docker is not installed on this server");
    }

    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as DockerContainer[];
  }

  /**
   * List all images
   */
  async listImages(serverId: string): Promise<DockerImage[]> {
    const format =
      '{"id":"{{.ID}}","repository":"{{.Repository}}","tag":"{{.Tag}}","size":"{{.Size}}","created":"{{.CreatedAt}}"}';
    const { stdout } = await sshService.exec(
      serverId,
      `docker images --format '${format}' 2>/dev/null`,
    );

    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as DockerImage[];
  }

  /**
   * Perform action on a container: start, stop, restart, remove
   */
  async containerAction(
    serverId: string,
    containerId: string,
    action: "start" | "stop" | "restart" | "remove" | "pause" | "unpause",
  ): Promise<string> {
    const cmd =
      action === "remove"
        ? `docker rm -f ${containerId}`
        : `docker ${action} ${containerId}`;

    const { stdout, stderr, code } = await sshService.exec(serverId, cmd);

    if (code !== 0) {
      throw new Error(stderr || `Failed to ${action} container`);
    }

    return stdout.trim();
  }

  /**
   * Get container logs
   */
  async getContainerLogs(
    serverId: string,
    containerId: string,
    tail: number = 200,
  ): Promise<string> {
    const { stdout, stderr } = await sshService.exec(
      serverId,
      `docker logs --tail ${tail} --timestamps ${containerId} 2>&1`,
      30000,
    );

    return stdout || stderr || "No logs available";
  }

  /**
   * Get container resource stats (one-shot, no stream)
   */
  async getContainerStats(
    serverId: string,
    containerIds?: string[],
  ): Promise<ContainerStats[]> {
    const target = containerIds?.length ? containerIds.join(" ") : "";

    const format =
      '{"containerId":"{{.ID}}","name":"{{.Name}}","cpuPercent":"{{.CPUPerc}}","memUsage":"{{.MemUsage}}","memPercent":"{{.MemPerc}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}","pids":"{{.PIDs}}"}';

    const { stdout, code } = await sshService.exec(
      serverId,
      `docker stats --no-stream --format '${format}' ${target} 2>/dev/null`,
      15000,
    );

    if (code !== 0 || !stdout.trim()) return [];

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ContainerStats[];
  }

  /**
   * Inspect a container — returns full JSON
   */
  async inspectContainer(serverId: string, containerId: string): Promise<any> {
    const { stdout, code, stderr } = await sshService.exec(
      serverId,
      `docker inspect ${containerId} 2>/dev/null`,
    );

    if (code !== 0) {
      throw new Error(stderr || "Failed to inspect container");
    }

    try {
      const parsed = JSON.parse(stdout);
      return parsed[0] || parsed;
    } catch {
      return { raw: stdout };
    }
  }

  /**
   * Inspect an image — returns full JSON
   */
  async inspectImage(serverId: string, imageId: string): Promise<any> {
    const { stdout, code, stderr } = await sshService.exec(
      serverId,
      `docker image inspect ${imageId} 2>/dev/null`,
    );

    if (code !== 0) {
      throw new Error(stderr || "Failed to inspect image");
    }

    try {
      const parsed = JSON.parse(stdout);
      return parsed[0] || parsed;
    } catch {
      return { raw: stdout };
    }
  }

  /**
   * Pull an image (streamed)
   */
  async pullImage(
    serverId: string,
    image: string,
    onLine: (line: string) => void,
  ): Promise<void> {
    onLine(`Pulling ${image}...`);
    const { stdout, stderr, code } = await sshService.exec(
      serverId,
      `docker pull ${image} 2>&1`,
      120000,
    );

    // Send output lines
    const output = stdout || stderr || "";
    for (const line of output.split("\n").filter((l) => l.trim())) {
      onLine(line);
    }

    if (code !== 0) {
      throw new Error(`Pull failed with exit code ${code}`);
    }
  }

  /**
   * Remove an image
   */
  async removeImage(serverId: string, imageId: string): Promise<string> {
    const { stdout, stderr, code } = await sshService.exec(
      serverId,
      `docker rmi ${imageId} 2>&1`,
    );
    if (code !== 0) {
      throw new Error(stderr || stdout || "Failed to remove image");
    }
    return stdout.trim();
  }

  /**
   * Check if Docker is installed + version
   */
  async getDockerInfo(
    serverId: string,
  ): Promise<{ installed: boolean; version?: string; info?: string }> {
    try {
      const { stdout, code } = await sshService.exec(
        serverId,
        "docker version --format '{{.Server.Version}}' 2>/dev/null",
        10000,
      );
      if (code !== 0) return { installed: false };
      return { installed: true, version: stdout.trim() };
    } catch {
      return { installed: false };
    }
  }

  /**
   * Run a new container
   */
  async runContainer(
    serverId: string,
    config: {
      image: string;
      name?: string;
      ports?: { hostPort: string; containerPort: string }[];
      env?: { key: string; value: string }[];
      restartPolicy?: string;
    },
  ): Promise<string> {
    let cmd = `docker run -d`;

    if (config.name) {
      cmd += ` --name ${config.name}`;
    }

    if (config.restartPolicy && config.restartPolicy !== "no") {
      cmd += ` --restart ${config.restartPolicy}`;
    }

    if (config.ports && config.ports.length > 0) {
      config.ports.forEach((p) => {
        if (p.hostPort && p.containerPort) {
          cmd += ` -p ${p.hostPort}:${p.containerPort}`;
        }
      });
    }

    if (config.env && config.env.length > 0) {
      config.env.forEach((e) => {
        if (e.key && e.value) {
          // Escape single quotes in value to prevent command injection
          const safeValue = e.value.replace(/'/g, "'\\''");
          cmd += ` -e ${e.key}='${safeValue}'`;
        }
      });
    }

    cmd += ` ${config.image}`;

    const { stdout, stderr, code } = await sshService.exec(serverId, cmd);

    if (code !== 0) {
      throw new Error(stderr || stdout || "Failed to run container");
    }

    return stdout.trim();
  }
}

export default new DockerService();
