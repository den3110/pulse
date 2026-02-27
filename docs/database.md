# Database Studio

Managing databases via the command line can be risky. The **Database Studio** integrates visual management for MySQL, PostgreSQL, Redis, and MongoDB directly into Pulse.

## Provisioning a Database

1. Navigate to the **Database Studio** tab on your chosen server.
2. Select the Engine (e.g., MySQL 8.0, PostgreSQL 15).
3. Provide a root password and a database name.
4. Pulse will automatically spin up the official Docker container for that database and bind it to a local port.

## Visual Interface

Once running, Pulse connects to the database engine and provides a GUI:

- **Tables**: View all tables/collections.
- **Data Viewer**: A spreadsheet-like view of your active records.
- **Query Editor**: Execute raw SQL queries directly from your browser.
- **Backups**: Click "Backup Now" to dump the database to a `.sql` file securely stored on the server.

## Security

By default, Database Studio spins up containers on `127.0.0.1`. They are strictly internal to the server. You can access them physically via the UI or by connecting your Backend Deployment internally. They are never exposed to the public internet unless you explicitly configure an NGINX proxy port.
