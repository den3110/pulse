# Deployments

A **Deployment** in Pulse links a Git Repository to a Server, automating the build and execution process.

## Creating a Deployment

1. Go to your Server > **Deployments**.
2. Click **New Deployment**.
3. Enter your Git URL (e.g. `https://github.com/user/project.git`).
4. Select the Branch (e.g. `main`).
5. Choose the **Deployment Type**:
   - **Docker**: Runs `docker-compose up -d --build`.
   - **Node.js**: Runs `npm install`, `npm run build`, and starts via `pm2 start`.
   - **Static HTML**: Clones the repo and serves it directly via NGINX.

## Auto-Deploy (Webhooks)

You can configure Pulse to automatically trigger a new deployment immediately when you push code to GitHub/GitLab.

1. Go to the Deployment Details page.
2. Open the **Auto Deploy (Webhooks)** tab.
3. Pulse generates a unique Webhook URL and Secret.
4. Copy these into your GitHub Repository > Settings > Webhooks.
5. Set Content-Type to `application/json` and trigger on `Commit Push`.

Now, every `git push origin main` will trigger Pulse to clone the latest code and restart the container seamlessly.

## Environment Variables (.env)

Securely inject environment variables into your deployment without committing them to source control:

1. Navigate to the **Environment** tab on the deployment.
2. Add your secrets (e.g., `DATABASE_URL`, `API_KEY`).
3. Click Save. Pulse writes these to a `.env` file directly on the VPS before building the project.
