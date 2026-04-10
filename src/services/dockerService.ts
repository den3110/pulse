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
  composeProject: string;
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
    const sep = "|||";
    const fields = [
      "{{.ID}}",
      "{{.Names}}",
      "{{.Image}}",
      "{{.Status}}",
      "{{.State}}",
      "{{.Ports}}",
      "{{.CreatedAt}}",
      "{{.Size}}",
      "{{.Networks}}",
      '{{.Label "com.docker.compose.project"}}',
      "{{.Command}}",
    ];
    const format = fields.join(sep);
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
        const parts = line.split(sep);
        if (parts.length < 11) return null;
        return {
          id: parts[0],
          name: parts[1],
          image: parts[2],
          status: parts[3],
          state: parts[4],
          ports: parts[5],
          created: parts[6],
          size: parts[7],
          networks: parts[8],
          composeProject: parts[9] || "",
          command: parts.slice(10).join(sep),
        } as DockerContainer;
      })
      .filter(Boolean) as DockerContainer[];
  }

  /**
   * List all images
   */
  async listImages(serverId: string): Promise<DockerImage[]> {
    const sep = "|||";
    const fields = [
      "{{.ID}}",
      "{{.Repository}}",
      "{{.Tag}}",
      "{{.Size}}",
      "{{.CreatedAt}}",
    ];
    const format = fields.join(sep);
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
        const parts = line.split(sep);
        if (parts.length < 5) return null;
        return {
          id: parts[0],
          repository: parts[1],
          tag: parts[2],
          size: parts[3],
          created: parts[4],
        } as DockerImage;
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

  /**
   * Run docker compose up in a directory (streamed output)
   */
  async dockerComposeUp(
    serverId: string,
    composePath: string,
    onLine: (line: string) => void,
    projectName?: string,
  ): Promise<{ containers: string[] }> {
    const pFlag = projectName ? `-p ${projectName} ` : "";
    onLine(`Running docker compose ${pFlag}up in ${composePath}...`);

    // Run docker compose up -d --build
    const { stdout, stderr, code } = await sshService.exec(
      serverId,
      `cd ${composePath} && docker compose ${pFlag}up -d --build 2>&1`,
      300000, // 5 min timeout for builds
    );

    // Stream output lines
    const output = stdout || stderr || "";
    for (const line of output.split("\n").filter((l) => l.trim())) {
      onLine(line);
    }

    if (code !== 0) {
      throw new Error(`docker compose up failed with exit code ${code}`);
    }

    // Get container names from the compose project
    const psResult = await sshService.exec(
      serverId,
      `cd ${composePath} && docker compose ${pFlag}ps --format '{{.Name}}' 2>/dev/null`,
      10000,
    );

    const containers = psResult.stdout
      .trim()
      .split("\n")
      .filter((l) => l.trim());

    return { containers };
  }

  /**
   * Install Docker on the server with streaming output
   */
  async installStream(
    serverId: string,
    onData: (data: string, type: "stdout" | "stderr") => void,
    onClose?: (code: number) => void,
  ): Promise<void> {
    const installScript = `
export DEBIAN_FRONTEND=noninteractive

echo "Checking if Docker is already installed..."
if command -v docker &> /dev/null; then
    echo "Docker is already installed."
    docker -v
    exit 0
fi

echo "Updating apt package index..."
sudo apt-get update -y

echo "Installing curl..."
sudo apt-get install -y curl

echo "Downloading official Docker installation script..."
curl -fsSL https://get.docker.com -o get-docker.sh

echo "Running Docker installation script..."
sudo sh get-docker.sh

echo "Starting Docker service..."
sudo systemctl start docker || true

echo "Enabling Docker service to start on boot..."
sudo systemctl enable docker || true

echo "Configuring current user for docker..."
sudo usermod -aG docker \\$USER || true

echo "Docker installation completed!"
docker -v
`;

    const scriptPath = `/tmp/install_docker_${Date.now()}.sh`;
    const execCmd = `cat << 'EOF' > ${scriptPath}
${installScript}
EOF
chmod +x ${scriptPath}
bash ${scriptPath}
rm ${scriptPath}
`;

    return sshService.execStreamLine(serverId, execCmd, onData, onClose);
  }
}


export default new DockerService();
