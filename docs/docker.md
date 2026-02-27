# Docker Engine Management

Pulse offers a first-class integration with Docker allowing you to visualize and control containers without touching the CLI.

## Prerequisites

If Docker is not installed on your VPS, Pulse will prompt you with a one-click **Install Docker** button. This runs the official docker install shell script on your machine locally over SSH.

## Container List

In the **Docker Engine** tab for a server, you can see all running, stopped, and exited containers.

### Actions

- **Start / Stop / Restart**: Basic lifecycle controls handled via API.
- **Inspect**: View the raw JSON data of a container (IP address, mounts, environment variables).
- **Logs**: Opens the central Log Studio for `docker logs -f`.
- **Delete**: Permanently removes the container and its anonymous volumes.

## Docker Compose Support

Deployments that rely on `docker-compose.yaml` are fully supported. Pulse automatically handles the `docker-compose down && docker-compose build && docker-compose up -d` lifecycle during deployment phases.
