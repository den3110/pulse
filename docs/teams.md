# Team Collaboration

DevOps shouldn't be executed in silos. Pulse strongly supports collaboration.

## Inviting Members

As an Owner of an Organization Team, you can navigate to **Settings** > **Team Members**.
Enter their email address to send them a magic invite link.

## Roles and Permissions

Not everyone should be able to accidentally delete a production server.

- **Owner**: Full access. Can view billing, delete the team, delete servers.
- **Admin**: Can add/remove servers, configure deployments, manage database passwords.
- **Developer/Observer**: Can view logs, restart deployments, view the Map, and review analytics, but _cannot_ provision or remove resources or view `.env` secret variables plainly.

## Activity Audit Log

Pulse maintains a strict audit trail of every action. When someone triggers an auto-deploy webhook, manually reboots a PM2 process, or edits an NGINX config, the action is logged permanently with a timestamp and user ID in the **Activity Log** tab.
