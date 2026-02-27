# CI/CD Pipelines

Pulse goes beyond simple push-to-deploy by allowing you to construct **Pipeline Workflows**.

## What is a Pipeline?

A Pipeline is a sequence of stages that a new code push must traverse before it officially replaces the current production build.

The standard layout is:

1. **Trigger Phase**: (E.g. Code pushed to `main`).
2. **Pre-Deploy Tests**: (E.g. Docker build & Run unit tests).
3. **Staging Approval**: Waits for an Administrator to click "Approve".
4. **Deploy Phase**: (E.g. Blue/Green Rollout or standard PM2 reload).
5. **Post-Deploy**: (E.g. Check endpoints, notify Team on Telegram/Slack).

## Blue-Green / Canary Rollouts

If you are using Docker, Pulse supports Blue-Green deployments:

- **Green** (New): Pulse spins up the new container version on a random port.
- **Health Check**: Pulse pings the new container. If it fails, the deployment is aborted.
- **Traffic Switch**: NGINX is automatically reloaded to point to the new Green container.
- **Blue** (Old): The old container is stopped and removed.

_Result_: Absolute **Zero-Downtime** deployments.
