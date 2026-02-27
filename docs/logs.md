# Log Studio (Centralized Log Viewer)

The **Log Studio** provides a single, unified interface to stream real-time logs from _any_ service on _any_ connected server.

## Supported Log Types

Rather than SSH-ing into your machines sequentially, Log Studio fetches these directly via WebSocket/SSE streams in a fully responsive `xterm.js` terminal window:

1. **Docker Containers**: Fetches `docker logs -f <container_name>`. Ideal for checking microservices or databases.
2. **PM2 Processes**: Streams Node.js/Python process logs via `pm2 logs <id>`.
3. **NGINX**: Tails access and error logs (e.g., `tail -f /var/log/nginx/error.log`). Great for spotting HTTP 500 errors in real-time.
4. **Syslog**: Tails the system-wide `/var/log/syslog` for OS-level debugging.
5. **Auth Logs**: Watches `/var/log/auth.log` to track failed local SSH login attempts.

## Features

- **Auto-scroll**: Keeps you at the latest log output line.
- **Colorization**: Important error strings like `ERROR` or `FATAL` are color-coded in red, while `WARN` is yellow.
- **Auto-Disconnection**: To save server CPU/RAM cycles, the moment you navigate away from Log Studio, the backend gracefully kills the `tail -f` command via SSH.
