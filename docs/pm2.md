# PM2 & Node.JS

For applications that are not containerized, Pulse integrates deeply with **PM2**, the production process manager for Node.js (and other script-based languages like Python or Go).

## Auto-Installation

Pulse will detect if `pm2` is installed. If not, clicking the install button will run `npm install -g pm2` securely.

## Deploying via PM2

When creating a Deployment, select **Node.js (PM2)** as the environment.
Pulse asks you for:

- **Build Command**: e.g., `npm run build`
- **Start Command**: e.g., `npm run start:prod` (or point directly to an entry file like `ecosystem.config.js`).

## Managing Processes

In the **PM2 Manager** tab, you have full control over the process daemon:

- Visualize memory (RAM) and CPU usage _per process_.
- View the number of Restarts (helpful for detecting crash loops).
- Reload the process without downtime.
- Stop or Delete processes that are no longer needed.
