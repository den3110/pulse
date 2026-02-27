# Security Scanner

Keeping your VPS secure is an ongoing battle. The **Security Scanner** acts as your onboard defensive analyst.

## How It Works

When you trigger a scan, Pulse executes a series of bash scripts locally on the server to check for common vulnerabilities.

It checks:

- **SSH Configuration**: Are password logins enabled? Are root logins enabled? (Both are red flags).
- **Firewall Status**: Is `UFW` (Uncomplicated Firewall) active? Are there wide-open ports like `0.0.0.0:3306`?
- **Package Updates**: Are there critical `apt-get / yum` security packages requiring installation?
- **Rootkits**: Triggers basic `chkrootkit` and `rkhunter` heuristics.

## Auto-Remediation

Pulse attempts to be proactive. If it finds security issues, in many cases, it provides a big **Auto Fix** button.
Clicking Auto Fix will instruct Pulse to automatically lock down SSH parameters, toggle on UFW, and close dangerous exposed ports on your behalf.

> **Warning:** You should always ensure that port 22 (SSH) and 80/443 (HTTP/s) remain open after enabling UFW or checking auto-fixes so that Pulse and your users can still connect to the server.
