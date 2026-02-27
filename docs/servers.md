# Server Management

Pulse allows you to connect and manage an unlimited number of Linux VPS servers via SSH.

## Adding a Server

1. Navigate to the **Servers** page.
2. Click **Add Server**.
3. Enter your server's public IP address, SSH Port (default is 22), and SSH Username (usually `root` or `ubuntu`).
4. **Authentication:**
   - **Password**: Type in the raw SSH password.
   - **SSH Key** (Recommended): Paste in your private Ed25519 or RSA key.
5. Click **Connect**.

Pulse will attempt to SSH into the machine. If successful, it automatically installs required base packages if they are missing (`curl`, `git`, `docker`, `docker-compose`, `ufw`, `npm`, `pm2`).

## Server Dashboard

Once added, the server will appear on your dashboard.
You can monitor:

- CPU Usage (%)
- RAM Consumption
- Disk Space
- Uptime

## Health Checks

Pulse continuously pings your servers behind the scenes. If a server goes offline or becomes unreachable via SSH, it will be highlighted in **Red** on the dashboard, and a notification will be pushed to the UI.
