# NGINX Configuration

Pulse uses **NGINX** as the primary reverse proxy to route internet traffic (domains) to your internal Deployments.

## Adding a Domain

1. First, point your Domain's DNS `A Record` to your Server's Public IP.
2. Go to Pulse > **NGINX**.
3. Create a **New Config**.
4. Enter your Domain name (`example.com`).
5. Set the **Target Port** (e.g., `3000` for a Node app, `8080` for a Docker container).

Pulse automatically generates the `/etc/nginx/sites-available/` config block, creates the symlink, tests the config, and seamlessly reloads the NGINX daemon.

## SSL Certificates (HTTPS)

Securing your site is a one-click process. Once your domain is routed:

1. Click the **Enable SSL** toggle on the config block.
2. Pulse executes `certbot` under the hood.
3. It provisions a free **Let's Encrypt** SSL certificate.
4. It rewrites your NGINX config to force HTTP -> HTTPS redirects.
5. It configures a cron job to automatically renew the certificate before it expires.

## Advanced Routing

If you need specific custom configurations (like websocket upgrades, proxy buffering, or custom upload size limits), you can edit the raw NGINX configuration file directly from the built-in IDE editor inside the Pulse UI.
