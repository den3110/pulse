# FTP / File Manager

While automated Git Deployments are the primary and recommended way to push code, sometimes you just need to edit a single config file quickly.

## Interactive Web Explorer

Pulse maps the filesystem of your remote server directly into the UI.

1. Navigate to the **FTP / Files** tab of the server.
2. Select a working directory.

## Features

- **Visual Directory Tree:** Double click folders to navigate inwards. Click the breadcrumbs to navigate backwards.
- **In-Browser IDE:** A Monaco Editor (VSCode clone) is built into Pulse. Click on any `.env`, `.js`, or `.conf` file to edit it live right from the browser. Hit "Save" to push the edit to the server instantly.
- **File Uploads:** Drag and drop `.zip` blobs, static assets, or images specifically.
- **Secure File Transfers:** File transfers securely tunnel through the existing encrypted SSH connection. No need to open insecure Port 21 (FTP).
