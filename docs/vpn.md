# Mesh VPN (WireGuard)

Pulse includes a powerful, zero-configuration **Mesh VPN** manager powered by WireGuard.

## Why a VPN?

When you have multiple VPS instances scattered across different providers (AWS, DigitalOcean, Hetzner, etc.), securely communicating between them can be painful. The Mesh VPN feature allows you to:

- Link database servers to backend servers securely.
- Only expose your VPN port (`51820` UDP) to the internet, keeping your actual database ports (like `3306` or `5432`) completely hidden.
- Remotely connect your local machine securely into your production network.

## Automatic Installation

Pulse handles the complicated parts of setting up a WireGuard server for you.

1. Navigate to the **VPN Server** tab.
2. Select a blank VPS.
3. Click **Install VPN Server**.
4. Pulse will install `wireguard`, `wg-easy`, and configure the firewall routing rules automatically using Docker.

## Client Management

Once installed, you can generate client configuration files (`.conf`) or QR codes.

- **Download `.conf`**: For desktops using the WireGuard application.
- **Scan QR Code**: For iOS/Android phones using the WireGuard app.

### Security Note

If a team member leaves, you can immediately **Revoke** their VPN client from the dashboard to cut off their access forever.
