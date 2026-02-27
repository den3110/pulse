# Pre-Deploy Test Runner

Pulse includes a built-in **Test Runner** to ensure your codebase is stable before it ever reaches the production environment.

## How it works

Normally, if a deployment fails midway, you might experience downtime while rolling back. The Test Runner acts as a safety barrier:

1. **Workspace Cloning:** Pulse clones the latest commit from your GitHub/GitLab origin into a temporary, isolated `.pulse_tmp` workspace.
2. **Dependency Installation:** Pulse runs your defined package manager (e.g. `npm install` or `pip install -r requirements.txt`).
3. **Test Execution:** Pulse executes your testing script (e.g. `npm test` or `pytest`).
4. **Validation:**
   - If the tests **Pass** (Exit Code 0), the deployment proceeds to the actual production workspace.
   - If the tests **Fail** (Exit Code > 0), the deployment is **Aborted** immediately. The error logs are preserved for you to see exactly which test threw an assertion failure.

## Setting Up

Go to **Server List** > **Select Server** > **Deployments List** > **Select Deployment** > **Pre-deploy Tests** tab.
Toggle the **Enable Pre-deploy testing** switch and specify the command (e.g., `npm run test`).
