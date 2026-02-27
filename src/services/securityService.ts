import Server from "../models/Server";
import SecurityScan from "../models/SecurityScan";
import sshService from "./sshService";

export interface CheckResult {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  severity: "high" | "medium" | "low" | "info";
  description: string;
  recommendation: string;
  details?: string;
  fixable?: boolean;
  fixCommand?: string;
}

const checks: Array<{
  id: string;
  label: string;
  run: (exec: (cmd: string) => Promise<string>) => Promise<CheckResult>;
}> = [
  // ── 1 ─ SSH Root Login ──
  {
    id: "ssh_root_login",
    label: "SSH Root Login",
    run: async (exec) => {
      const out = await exec(
        `grep -iE "^\\s*PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null || echo "__NOTFOUND__"`,
      );
      if (out.includes("__NOTFOUND__"))
        return {
          id: "ssh_root_login",
          label: "SSH Root Login",
          status: "skip",
          severity: "info",
          description: "Could not read sshd_config.",
          recommendation: "",
          details: out.trim(),
        };
      if (/yes/i.test(out))
        return {
          id: "ssh_root_login",
          label: "SSH Root Login",
          status: "fail",
          severity: "high",
          description:
            "Root login is ENABLED via SSH — attackers can brute-force the root account directly.",
          recommendation:
            "Disable PermitRootLogin and use a regular user + sudo instead.",
          details: out.trim(),
          fixable: true,
          fixCommand: 'Set PermitRootLogin to "no" and restart SSH',
        };
      return {
        id: "ssh_root_login",
        label: "SSH Root Login",
        status: "pass",
        severity: "info",
        description: "Root SSH login is disabled — great!",
        recommendation: "",
        details: out.trim(),
      };
    },
  },

  // ── 2 ─ SSH Password Auth ──
  {
    id: "ssh_password_auth",
    label: "SSH Password Auth",
    run: async (exec) => {
      const out = await exec(
        `grep -iE "^\\s*PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null || echo "__NOTFOUND__"`,
      );
      if (out.includes("__NOTFOUND__"))
        return {
          id: "ssh_password_auth",
          label: "SSH Password Auth",
          status: "skip",
          severity: "info",
          description: "Could not read sshd_config.",
          recommendation: "",
          details: out.trim(),
        };
      if (/yes/i.test(out))
        return {
          id: "ssh_password_auth",
          label: "SSH Password Auth",
          status: "fail",
          severity: "high",
          description:
            "Password authentication is ENABLED — vulnerable to brute-force attacks.",
          recommendation:
            "Disable PasswordAuthentication and use SSH key-based auth exclusively.",
          details: out.trim(),
          fixable: true,
          fixCommand: 'Set PasswordAuthentication to "no" and restart SSH',
        };
      return {
        id: "ssh_password_auth",
        label: "SSH Password Auth",
        status: "pass",
        severity: "info",
        description: "Password authentication is disabled — keys only.",
        recommendation: "",
        details: out.trim(),
      };
    },
  },

  // ── 3 ─ SSH Port ──
  {
    id: "ssh_port",
    label: "SSH Port",
    run: async (exec) => {
      const out = await exec(
        `grep -iE "^\\s*Port " /etc/ssh/sshd_config 2>/dev/null || echo "Port 22"`,
      );
      const m = out.match(/Port\s+(\d+)/i);
      const port = m ? parseInt(m[1]) : 22;
      if (port === 22)
        return {
          id: "ssh_port",
          label: "SSH Port",
          status: "warn",
          severity: "low",
          description:
            "SSH is running on the default port 22 — easily targeted by bots.",
          recommendation:
            "Consider changing to a non-standard port (e.g. 2222, 22222) to reduce automated scan noise.",
          details: `Current port: ${port}`,
        };
      return {
        id: "ssh_port",
        label: "SSH Port",
        status: "pass",
        severity: "info",
        description: `SSH is on non-default port ${port} — less visible to bots.`,
        recommendation: "",
        details: `Current port: ${port}`,
      };
    },
  },

  // ── 4 ─ Firewall ──
  {
    id: "firewall",
    label: "Firewall Status",
    run: async (exec) => {
      const ufw = await exec(`sudo ufw status 2>/dev/null`);
      const fwd = await exec(`sudo firewall-cmd --state 2>/dev/null`);
      const ipt = await exec(
        `sudo iptables -L -n 2>/dev/null | grep -cP "^(ACCEPT|DROP|REJECT)" || echo "0"`,
      );
      if (ufw.includes("Status: active"))
        return {
          id: "firewall",
          label: "Firewall Status",
          status: "pass",
          severity: "info",
          description: "UFW firewall is active and protecting your server.",
          recommendation: "",
          details: ufw.split("\n").slice(0, 8).join("\n"),
        };
      if (fwd.includes("running"))
        return {
          id: "firewall",
          label: "Firewall Status",
          status: "pass",
          severity: "info",
          description: "Firewalld is active and protecting your server.",
          recommendation: "",
          details: "firewalld: running",
        };
      const rules = parseInt(ipt.trim());
      if (!isNaN(rules) && rules > 2)
        return {
          id: "firewall",
          label: "Firewall Status",
          status: "pass",
          severity: "info",
          description: `iptables has ${rules} active rules — custom firewall configuration detected.`,
          recommendation: "",
          details: `${rules} iptables rules`,
        };
      return {
        id: "firewall",
        label: "Firewall Status",
        status: "fail",
        severity: "high",
        description:
          "No active firewall detected — your server is fully exposed to the internet.",
        recommendation:
          "Enable UFW immediately and only allow necessary ports (22, 80, 443).",
        details: "ufw: inactive, firewalld: not found, iptables: no rules",
        fixable: true,
        fixCommand:
          "Enable UFW with default deny policy and allow SSH/HTTP/HTTPS",
      };
    },
  },

  // ── 5 ─ Open Ports ──
  {
    id: "open_ports",
    label: "Exposed Ports Audit",
    run: async (exec) => {
      const out = await exec(`ss -tuln 2>/dev/null`);
      const allowed = new Set([
        22, 80, 443, 27017, 3306, 5432, 6379, 21, 20, 8080, 8443, 3000, 5000,
      ]);
      const unusual: { port: number; proto: string }[] = [];
      for (const line of out.split("\n")) {
        if (!line.includes("LISTEN")) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const addr = parts[4];
        const pm = addr.match(/:(\d+)$/);
        if (!pm) continue;
        const port = parseInt(pm[1]);
        const proto = parts[0];
        if (
          !allowed.has(port) &&
          !addr.startsWith("127.0.0.1") &&
          !addr.startsWith("::1")
        )
          unusual.push({ port, proto });
      }
      const unique = [...new Map(unusual.map((u) => [u.port, u])).values()];
      if (unique.length > 0)
        return {
          id: "open_ports",
          label: "Exposed Ports Audit",
          status: "fail",
          severity: "medium",
          description: `${unique.length} unusual port(s) exposed publicly: ${unique.map((u) => `${u.port}/${u.proto}`).join(", ")}`,
          recommendation:
            "Close or restrict these ports with a firewall if not needed externally.",
          details: unique.map((u) => `${u.port}/${u.proto}`).join(", "),
        };
      return {
        id: "open_ports",
        label: "Exposed Ports Audit",
        status: "pass",
        severity: "info",
        description:
          "Only standard ports are exposed — attack surface is minimized.",
        recommendation: "",
        details: "All listening ports are in the expected allow-list.",
      };
    },
  },

  // ── 6 ─ Outdated Packages ──
  {
    id: "outdated_packages",
    label: "Outdated Packages",
    run: async (exec) => {
      const out = await exec(
        `apt list --upgradable 2>/dev/null | grep -v "Listing" | wc -l`,
      );
      const count = parseInt(out.trim());
      if (isNaN(count))
        return {
          id: "outdated_packages",
          label: "Outdated Packages",
          status: "skip",
          severity: "info",
          description: "Not a Debian/Ubuntu system or apt unavailable.",
          recommendation: "",
          details: out.trim(),
        };
      if (count > 20)
        return {
          id: "outdated_packages",
          label: "Outdated Packages",
          status: "fail",
          severity: "high",
          description: `${count} packages can be upgraded — many may contain critical security patches!`,
          recommendation: "Update packages immediately.",
          details: `${count} upgradable packages`,
          fixable: true,
          fixCommand: "Run apt update && apt upgrade -y",
        };
      if (count > 0)
        return {
          id: "outdated_packages",
          label: "Outdated Packages",
          status: "warn",
          severity: "medium",
          description: `${count} package(s) can be upgraded.`,
          recommendation: "Apply security patches when convenient.",
          details: `${count} upgradable packages`,
          fixable: true,
          fixCommand: "Run apt update && apt upgrade -y",
        };
      return {
        id: "outdated_packages",
        label: "Outdated Packages",
        status: "pass",
        severity: "info",
        description: "All packages are up to date — no known vulnerabilities.",
        recommendation: "",
        details: "0 upgradable packages",
      };
    },
  },

  // ── 7 ─ Fail2Ban ──
  {
    id: "fail2ban",
    label: "Brute-force Protection (Fail2Ban)",
    run: async (exec) => {
      const active = await exec(
        `systemctl is-active fail2ban 2>/dev/null || echo "inactive"`,
      );
      if (active.trim() === "active") {
        const jails = await exec(
          `sudo fail2ban-client status 2>/dev/null | grep "Jail list" || echo ""`,
        );
        return {
          id: "fail2ban",
          label: "Brute-force Protection (Fail2Ban)",
          status: "pass",
          severity: "info",
          description:
            "Fail2Ban is active — brute-force attacks are being blocked automatically.",
          recommendation: "",
          details: jails.trim() || "fail2ban: active",
        };
      }
      return {
        id: "fail2ban",
        label: "Brute-force Protection (Fail2Ban)",
        status: "fail",
        severity: "medium",
        description:
          "Fail2Ban is NOT installed or not running — your SSH is unprotected against brute-force.",
        recommendation:
          "Install and enable fail2ban to auto-block repeated failed login attempts.",
        details: "fail2ban: inactive",
        fixable: true,
        fixCommand: "Install fail2ban with sshd jail enabled",
      };
    },
  },

  // ── 8 ─ Unattended Upgrades ──
  {
    id: "unattended_upgrades",
    label: "Automatic Security Updates",
    run: async (exec) => {
      const out = await exec(
        `dpkg -l unattended-upgrades 2>/dev/null | grep -c "^ii" || echo "0"`,
      );
      if (out.trim() === "1")
        return {
          id: "unattended_upgrades",
          label: "Automatic Security Updates",
          status: "pass",
          severity: "info",
          description:
            "Unattended-upgrades is installed — critical patches are applied automatically.",
          recommendation: "",
          details: "unattended-upgrades: installed",
        };
      return {
        id: "unattended_upgrades",
        label: "Automatic Security Updates",
        status: "warn",
        severity: "medium",
        description:
          "Unattended-upgrades is not installed — you must manually update the system.",
        recommendation:
          "Install to automatically apply critical security patches overnight.",
        details: "unattended-upgrades: not installed",
        fixable: true,
        fixCommand: "Install and configure unattended-upgrades",
      };
    },
  },

  // ── 9 ─ Disk Usage ──
  {
    id: "disk_usage",
    label: "Disk Usage",
    run: async (exec) => {
      const out = await exec(`df -h / | awk 'NR==2{print $5, $3, $2}'`);
      const parts = out.trim().split(/\s+/);
      const pct = parseInt((parts[0] || "").replace("%", ""));
      const used = parts[1] || "?";
      const total = parts[2] || "?";
      if (isNaN(pct))
        return {
          id: "disk_usage",
          label: "Disk Usage",
          status: "skip",
          severity: "info",
          description: "Could not read disk usage.",
          recommendation: "",
          details: out.trim(),
        };
      if (pct >= 90)
        return {
          id: "disk_usage",
          label: "Disk Usage",
          status: "fail",
          severity: "high",
          description: `Root partition is ${pct}% full (${used}/${total}) — critically low space! Services may crash.`,
          recommendation:
            "Free up disk space or expand the volume immediately.",
          details: `${pct}% used (${used} of ${total})`,
        };
      if (pct >= 75)
        return {
          id: "disk_usage",
          label: "Disk Usage",
          status: "warn",
          severity: "medium",
          description: `Root partition is ${pct}% full (${used}/${total}) — getting tight.`,
          recommendation: "Monitor usage and plan to free space or expand.",
          details: `${pct}% used (${used} of ${total})`,
        };
      return {
        id: "disk_usage",
        label: "Disk Usage",
        status: "pass",
        severity: "info",
        description: `Root partition is ${pct}% full (${used}/${total}) — plenty of space.`,
        recommendation: "",
        details: `${pct}% used (${used} of ${total})`,
      };
    },
  },

  // ── 10 ─ World-Writable Files ──
  {
    id: "world_writable",
    label: "World-Writable Files",
    run: async (exec) => {
      const out = await exec(
        `find /etc /var -maxdepth 3 -type f -perm -0002 2>/dev/null | head -5`,
      );
      const files = out.trim().split("\n").filter(Boolean);
      if (files.length > 0)
        return {
          id: "world_writable",
          label: "World-Writable Files",
          status: "warn",
          severity: "medium",
          description: `Found ${files.length}+ world-writable file(s) in critical directories — any user can modify them.`,
          recommendation: "Review permissions: chmod o-w <file>",
          details: files.join("\n"),
        };
      return {
        id: "world_writable",
        label: "World-Writable Files",
        status: "pass",
        severity: "info",
        description: "No world-writable files found in /etc or /var.",
        recommendation: "",
        details: "Clean",
      };
    },
  },

  // ── 11 ─ Root Processes ──
  {
    id: "root_processes",
    label: "Non-essential Root Processes",
    run: async (exec) => {
      const out = await exec(
        `ps -eo user,comm --no-header | awk '$1=="root"' | awk '{print $2}' | sort | uniq -c | sort -rn | head -10`,
      );
      const lines = out.trim().split("\n").filter(Boolean);
      const count = lines.length;
      return {
        id: "root_processes",
        label: "Non-essential Root Processes",
        status: count > 30 ? "warn" : "pass",
        severity: count > 30 ? "low" : "info",
        description:
          count > 30
            ? `${count} unique processes running as root — consider moving some to dedicated users.`
            : `${count} unique root processes — within normal range.`,
        recommendation:
          count > 30
            ? "Review and move non-essential services to dedicated users."
            : "",
        details: lines.slice(0, 8).join("\n"),
      };
    },
  },

  // ── 12 ─ Pending Reboot ──
  {
    id: "reboot_required",
    label: "Pending Reboot",
    run: async (exec) => {
      const out = await exec(
        `[ -f /var/run/reboot-required ] && cat /var/run/reboot-required || echo "OK"`,
      );
      if (out.includes("*** System restart required ***"))
        return {
          id: "reboot_required",
          label: "Pending Reboot",
          status: "warn",
          severity: "medium",
          description:
            "A system reboot is required to apply kernel or system updates.",
          recommendation:
            "Schedule a reboot during your next maintenance window.",
          details: out.trim(),
        };
      return {
        id: "reboot_required",
        label: "Pending Reboot",
        status: "pass",
        severity: "info",
        description: "No pending reboot — kernel is up to date.",
        recommendation: "",
        details: "OK",
      };
    },
  },

  // ── 13 ─ Empty Password Accounts ──
  {
    id: "empty_password",
    label: "Empty Password Accounts",
    run: async (exec) => {
      const out = await exec(
        `sudo awk -F: '($2 == "" || $2 == "!") && $1 != "root" {print $1}' /etc/shadow 2>/dev/null`,
      );
      const users = out.trim().split("\n").filter(Boolean);
      if (users.length > 0)
        return {
          id: "empty_password",
          label: "Empty Password Accounts",
          status: "fail",
          severity: "high",
          description: `${users.length} user(s) have NO password set — anyone can login as them!`,
          recommendation:
            "Set strong passwords or lock these accounts with: passwd -l <user>",
          details: users.join(", "),
        };
      return {
        id: "empty_password",
        label: "Empty Password Accounts",
        status: "pass",
        severity: "info",
        description: "All accounts have passwords set or are properly locked.",
        recommendation: "",
        details: "No empty password accounts found",
      };
    },
  },

  // ── 14 ─ SUID Binaries Audit ──
  {
    id: "suid_binaries",
    label: "SUID Binaries Audit",
    run: async (exec) => {
      const known = new Set([
        "sudo",
        "su",
        "mount",
        "umount",
        "passwd",
        "ping",
        "chsh",
        "chfn",
        "newgrp",
        "gpasswd",
        "fusermount",
        "fusermount3",
        "pkexec",
        "crontab",
        "at",
        "ssh-keysign",
      ]);
      const out = await exec(
        `find /usr -perm -4000 -type f 2>/dev/null | head -30`,
      );
      const files = out.trim().split("\n").filter(Boolean);
      const suspicious = files.filter(
        (f) => !known.has(f.split("/").pop() || ""),
      );
      if (suspicious.length > 0)
        return {
          id: "suid_binaries",
          label: "SUID Binaries Audit",
          status: "warn",
          severity: "medium",
          description: `${suspicious.length} unusual SUID binary(ies) found — could allow privilege escalation.`,
          recommendation:
            "Review these binaries: remove SUID bit if not needed (chmod u-s <file>).",
          details: suspicious.join("\n"),
        };
      return {
        id: "suid_binaries",
        label: "SUID Binaries Audit",
        status: "pass",
        severity: "info",
        description: `${files.length} SUID binaries found — all are standard system utilities.`,
        recommendation: "",
        details: files.slice(0, 10).join("\n"),
      };
    },
  },

  // ── 15 ─ Sudo NOPASSWD ──
  {
    id: "sudo_nopasswd",
    label: "Sudo NOPASSWD Check",
    run: async (exec) => {
      const out = await exec(
        `sudo grep -rn "NOPASSWD" /etc/sudoers /etc/sudoers.d/ 2>/dev/null | grep -v "^#" || echo "__CLEAN__"`,
      );
      if (out.includes("__CLEAN__"))
        return {
          id: "sudo_nopasswd",
          label: "Sudo NOPASSWD Check",
          status: "pass",
          severity: "info",
          description:
            "No NOPASSWD sudo entries — all sudo requires password authentication.",
          recommendation: "",
          details: "Clean sudoers configuration",
        };
      const lines = out.trim().split("\n").filter(Boolean);
      return {
        id: "sudo_nopasswd",
        label: "Sudo NOPASSWD Check",
        status: "warn",
        severity: "medium",
        description: `${lines.length} NOPASSWD sudo rule(s) found — users can run commands as root without a password.`,
        recommendation:
          "Review and remove NOPASSWD entries unless absolutely necessary.",
        details: lines.join("\n"),
      };
    },
  },

  // ── 16 ─ Users with UID 0 ──
  {
    id: "uid_zero",
    label: "Users with UID 0 (Root-level)",
    run: async (exec) => {
      const out = await exec(`awk -F: '$3 == 0 {print $1}' /etc/passwd`);
      const users = out.trim().split("\n").filter(Boolean);
      if (users.length > 1) {
        const extra = users.filter((u) => u !== "root");
        return {
          id: "uid_zero",
          label: "Users with UID 0 (Root-level)",
          status: "fail",
          severity: "high",
          description: `${extra.length} extra user(s) have UID 0 (root-level privileges): ${extra.join(", ")}`,
          recommendation:
            "Only 'root' should have UID 0. Remove or reassign these users immediately.",
          details: users.join("\n"),
        };
      }
      return {
        id: "uid_zero",
        label: "Users with UID 0 (Root-level)",
        status: "pass",
        severity: "info",
        description: "Only 'root' has UID 0 — no unauthorized superusers.",
        recommendation: "",
        details: "root",
      };
    },
  },

  // ── 17 ─ SSH Authorized Keys Audit ──
  {
    id: "ssh_keys_audit",
    label: "SSH Authorized Keys Audit",
    run: async (exec) => {
      const out = await exec(
        `for u in $(awk -F: '$3>=1000{print $1":"$6}' /etc/passwd); do user=$(echo $u|cut -d: -f1); home=$(echo $u|cut -d: -f2); f="$home/.ssh/authorized_keys"; if [ -f "$f" ]; then c=$(wc -l < "$f" 2>/dev/null); echo "$user:$c"; fi; done`,
      );
      const lines = out.trim().split("\n").filter(Boolean);
      if (lines.length === 0)
        return {
          id: "ssh_keys_audit",
          label: "SSH Authorized Keys Audit",
          status: "pass",
          severity: "info",
          description: "No SSH authorized_keys files found for regular users.",
          recommendation: "",
          details: "Clean",
        };
      let totalKeys = 0;
      const breakdown: string[] = [];
      for (const line of lines) {
        const [user, count] = line.split(":");
        const n = parseInt(count);
        if (!isNaN(n)) totalKeys += n;
        breakdown.push(`${user}: ${count} key(s)`);
      }
      if (totalKeys > 10)
        return {
          id: "ssh_keys_audit",
          label: "SSH Authorized Keys Audit",
          status: "warn",
          severity: "medium",
          description: `${totalKeys} SSH keys across ${lines.length} user(s) — hard to track who has access.`,
          recommendation:
            "Regularly audit and rotate SSH keys. Remove unused keys.",
          details: breakdown.join("\n"),
        };
      return {
        id: "ssh_keys_audit",
        label: "SSH Authorized Keys Audit",
        status: "pass",
        severity: "info",
        description: `${totalKeys} SSH key(s) across ${lines.length} user(s) — manageable.`,
        recommendation: "",
        details: breakdown.join("\n"),
      };
    },
  },

  // ── 18 ─ Suspicious Cron Jobs ──
  {
    id: "cron_audit",
    label: "Suspicious Cron Jobs",
    run: async (exec) => {
      const out = await exec(
        `for u in $(cut -f1 -d: /etc/passwd); do crontab -l -u "$u" 2>/dev/null; done | grep -v "^#" | grep -v "^$" | grep -iE "(curl|wget|nc |ncat|python|perl|bash -i|/dev/tcp|base64)" || echo "__CLEAN__"`,
      );
      if (out.includes("__CLEAN__"))
        return {
          id: "cron_audit",
          label: "Suspicious Cron Jobs",
          status: "pass",
          severity: "info",
          description:
            "No suspicious cron jobs detected (no curl/wget/nc/reverse-shell patterns).",
          recommendation: "",
          details: "Clean",
        };
      const lines = out.trim().split("\n").filter(Boolean);
      return {
        id: "cron_audit",
        label: "Suspicious Cron Jobs",
        status: "fail",
        severity: "high",
        description: `${lines.length} suspicious cron job(s) found — could indicate a backdoor or crypto-miner.`,
        recommendation:
          "Review these entries immediately and remove if not legitimate.",
        details: lines.join("\n"),
      };
    },
  },

  // ── 19 ─ Kernel Security (sysctl) ──
  {
    id: "kernel_hardening",
    label: "Kernel Security (sysctl)",
    run: async (exec) => {
      const params: { param: string; expected: string; label: string }[] = [
        {
          param: "net.ipv4.ip_forward",
          expected: "0",
          label: "IP Forwarding disabled",
        },
        {
          param: "net.ipv4.tcp_syncookies",
          expected: "1",
          label: "SYN cookies enabled",
        },
        {
          param: "net.ipv4.conf.all.accept_redirects",
          expected: "0",
          label: "ICMP redirects rejected",
        },
        {
          param: "net.ipv4.conf.all.send_redirects",
          expected: "0",
          label: "Send redirects disabled",
        },
        {
          param: "net.ipv4.conf.all.rp_filter",
          expected: "1",
          label: "Reverse path filtering",
        },
      ];
      const failed: string[] = [];
      const passed: string[] = [];
      for (const c of params) {
        const val = await exec(
          `sysctl -n ${c.param} 2>/dev/null || echo "N/A"`,
        );
        if (val.trim() === c.expected)
          passed.push(`✓ ${c.label} (${c.param} = ${val.trim()})`);
        else
          failed.push(
            `✗ ${c.label} (${c.param} = ${val.trim()}, expected ${c.expected})`,
          );
      }
      if (failed.length === 0)
        return {
          id: "kernel_hardening",
          label: "Kernel Security (sysctl)",
          status: "pass",
          severity: "info",
          description: `All ${params.length} kernel security parameters are properly configured.`,
          recommendation: "",
          details: passed.join("\n"),
        };
      return {
        id: "kernel_hardening",
        label: "Kernel Security (sysctl)",
        status: failed.length >= 3 ? "fail" : "warn",
        severity: failed.length >= 3 ? "high" : "medium",
        description: `${failed.length}/${params.length} kernel security parameter(s) are misconfigured.`,
        recommendation:
          "Apply sysctl hardening to /etc/sysctl.conf and reload with: sysctl -p",
        details: [...failed, ...passed].join("\n"),
        fixable: true,
        fixCommand:
          "Apply recommended kernel hardening parameters via sysctl.conf",
      };
    },
  },

  // ── 20 ─ SSL Certificate Expiry ──
  {
    id: "ssl_expiry",
    label: "SSL Certificate Expiry",
    run: async (exec) => {
      const out = await exec(
        `for f in /etc/letsencrypt/live/*/cert.pem /etc/ssl/certs/local/*.pem /etc/nginx/ssl/*.crt 2>/dev/null; do [ -f "$f" ] && echo "$f|$(openssl x509 -enddate -noout -in "$f" 2>/dev/null)"; done || echo "__NONE__"`,
      );
      if (out.includes("__NONE__") || !out.trim())
        return {
          id: "ssl_expiry",
          label: "SSL Certificate Expiry",
          status: "skip",
          severity: "info",
          description: "No SSL certificates found in standard locations.",
          recommendation: "",
          details: "No certificates detected",
        };
      const lines = out.trim().split("\n").filter(Boolean);
      const expiring: string[] = [];
      const ok: string[] = [];
      const now = Date.now();
      for (const line of lines) {
        const [file, dateStr] = line.split("|");
        if (!dateStr) continue;
        const m = dateStr.match(/notAfter=(.+)/);
        if (!m) continue;
        const expDate = new Date(m[1]).getTime();
        const daysLeft = Math.floor((expDate - now) / (24 * 60 * 60 * 1000));
        const name = file.split("/").slice(-2).join("/");
        if (daysLeft < 0)
          expiring.push(`EXPIRED ${Math.abs(daysLeft)} days ago: ${name}`);
        else if (daysLeft < 30)
          expiring.push(`Expires in ${daysLeft} days: ${name}`);
        else ok.push(`${daysLeft} days remaining: ${name}`);
      }
      if (expiring.length > 0)
        return {
          id: "ssl_expiry",
          label: "SSL Certificate Expiry",
          status: "fail",
          severity: "high",
          description: `${expiring.length} certificate(s) expired or expiring within 30 days!`,
          recommendation: "Renew certificates immediately: sudo certbot renew",
          details: [...expiring, ...ok].join("\n"),
        };
      return {
        id: "ssl_expiry",
        label: "SSL Certificate Expiry",
        status: "pass",
        severity: "info",
        description: `${ok.length} certificate(s) checked — all have 30+ days remaining.`,
        recommendation: "",
        details: ok.join("\n"),
      };
    },
  },
];

// ----------- Streaming runner (yields results one by one) -----------

export async function* runSecurityScanStream(serverId: string) {
  const server = await Server.findById(serverId);
  if (!server) throw new Error("Server not found");

  const exec = async (cmd: string) => {
    try {
      const output = await sshService.exec(serverId, cmd);
      return output.stdout;
    } catch {
      return "";
    }
  };

  const results: CheckResult[] = [];

  for (const check of checks) {
    try {
      const result = await check.run(exec);
      results.push(result);
      yield result;
    } catch {
      const skipResult: CheckResult = {
        id: check.id,
        label: check.label,
        status: "skip",
        severity: "info",
        description: "Check failed to execute.",
        recommendation: "",
      };
      results.push(skipResult);
      yield skipResult;
    }
  }

  // Calculate score
  let score = 100;
  const issues: any[] = [];
  const passedChecks: string[] = [];

  for (const r of results) {
    if (r.status === "fail") {
      if (r.severity === "high") score -= 12;
      else if (r.severity === "medium") score -= 6;
      else score -= 3;
      issues.push({
        severity: r.severity,
        description: r.description,
        recommendation: r.recommendation,
      });
    } else if (r.status === "warn") {
      if (r.severity === "medium") score -= 4;
      else score -= 2;
      issues.push({
        severity: r.severity,
        description: r.description,
        recommendation: r.recommendation,
      });
    } else if (r.status === "pass") {
      passedChecks.push(r.description);
    }
  }
  if (score < 0) score = 0;

  const scan = new SecurityScan({
    server: server._id,
    score,
    issues,
    passedChecks,
    checks: results,
  });
  await scan.save();

  yield { type: "complete", scan } as any;
}

// ----------- Remediation commands -----------

const remediationMap: Record<string, string[]> = {
  ssh_root_login: [
    `sudo sed -i 's/^\\s*PermitRootLogin\\s\\+yes/PermitRootLogin no/' /etc/ssh/sshd_config`,
    `sudo systemctl restart sshd`,
  ],
  ssh_password_auth: [
    `sudo sed -i 's/^\\s*PasswordAuthentication\\s\\+yes/PasswordAuthentication no/' /etc/ssh/sshd_config`,
    `sudo systemctl restart sshd`,
  ],
  firewall: [
    `sudo apt-get install -y ufw 2>/dev/null || true`,
    `sudo ufw default deny incoming`,
    `sudo ufw default allow outgoing`,
    `sudo ufw allow 22/tcp`,
    `sudo ufw allow 80/tcp`,
    `sudo ufw allow 443/tcp`,
    `echo "y" | sudo ufw enable`,
  ],
  outdated_packages: [
    `sudo apt-get update -y`,
    `sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y`,
  ],
  fail2ban: [
    `sudo apt-get install -y fail2ban`,
    `sudo systemctl enable fail2ban`,
    `sudo systemctl start fail2ban`,
  ],
  unattended_upgrades: [
    `sudo apt-get install -y unattended-upgrades`,
    `sudo dpkg-reconfigure -plow unattended-upgrades`,
  ],
  kernel_hardening: [
    `echo "net.ipv4.ip_forward = 0" | sudo tee -a /etc/sysctl.conf`,
    `echo "net.ipv4.tcp_syncookies = 1" | sudo tee -a /etc/sysctl.conf`,
    `echo "net.ipv4.conf.all.accept_redirects = 0" | sudo tee -a /etc/sysctl.conf`,
    `echo "net.ipv4.conf.all.send_redirects = 0" | sudo tee -a /etc/sysctl.conf`,
    `echo "net.ipv4.conf.all.rp_filter = 1" | sudo tee -a /etc/sysctl.conf`,
    `sudo sysctl -p`,
  ],
};

export async function* runRemediation(serverId: string, checkId: string) {
  const server = await Server.findById(serverId);
  if (!server) throw new Error("Server not found");

  const commands = remediationMap[checkId];
  if (!commands)
    throw new Error(`No remediation available for check: ${checkId}`);

  for (const cmd of commands) {
    yield { step: "running", command: cmd };
    try {
      const result = await sshService.exec(serverId, cmd, 120000);
      yield {
        step: "done",
        command: cmd,
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    } catch (err: any) {
      yield { step: "error", command: cmd, error: err.message };
      return;
    }
  }

  yield { step: "complete" };
}
