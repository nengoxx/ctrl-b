"""One-shot bootstrap orchestrator — run FROM the Windows checkout to deploy onto emma over SSH.

It automates the only steps that need a machine with BOTH the Windows secrets AND emma access:
  1. SFTP the gitignored `config.yaml` (Windows dashboard_v2/config.yaml) → emma `~/.ctrl-b/config.yaml`.
  2. `git pull` emma's checkout (to get committed deploy artifacts — does NOT commit anything there).
  3. Run `deploy/emma/install.sh` on emma (venv + build + systemd units).
After this, the dashboard is up; bring up HTTPS + the agent with serve-https.sh / start-claude.sh on emma.

Auth + host come from dashboard_v2/config.yaml (the `emma` host's ssh_* fields) — the same creds the backend
uses. The password is read at runtime and NEVER printed/logged. Reuses paramiko (backend dep).

Usage (from a machine that can reach emma; Bash tool needs dangerouslyDisableSandbox for LAN):
    backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py            # full bootstrap
    backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --dry-run  # show plan, do nothing
This script makes WRITES on emma — only run it when you intend to deploy (not for recon).
"""
from __future__ import annotations
import sys, posixpath, yaml, paramiko

WIN_CONFIG = r"C:\Users\rovax\Documents\github\ctrl-b\dashboard_v2\config.yaml"  # source of truth + ssh creds
EMMA_REPO = "/home/emma/github/ctrl-b"
EMMA_HOME = "/home/emma/.ctrl-b"
DRY = "--dry-run" in sys.argv


def find_emma(o):
    if isinstance(o, dict):
        if "ip" in o and o.get("os_type") == "linux":
            return o
        for v in o.values():
            r = find_emma(v)
            if r:
                return r
    elif isinstance(o, list):
        for it in o:
            r = find_emma(it)
            if r:
                return r
    return None


def run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str, str]:
    _, so, se = client.exec_command(cmd, timeout=600)
    out, err = so.read().decode(errors="replace"), se.read().decode(errors="replace")
    return so.channel.recv_exit_status(), out, err


def main() -> int:
    cfg = yaml.safe_load(open(WIN_CONFIG, encoding="utf-8"))
    e = cfg.get("computers", {}).get("emma") or find_emma(cfg)
    if not e:
        print("ERROR: emma host not found in config.yaml")
        return 1
    host, port = str(e["ip"]), int(e.get("ssh_port", 22))
    user, pw = str(e["ssh_username"]), str(e["ssh_password"])  # never printed
    print(f"Bootstrap target: {user}@{host}:{port}  (repo={EMMA_REPO}, CTRLB_HOME={EMMA_HOME})")
    print(f"Steps: sftp config.yaml → git pull → install.sh   {'[DRY RUN]' if DRY else ''}\n")
    if DRY:
        return 0

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, port=port, username=user, password=pw, timeout=15,
              allow_agent=False, look_for_keys=False)
    try:
        # 1) SFTP the secret (mkdir -p ~/.ctrl-b first).
        run(c, f"mkdir -p {EMMA_HOME}")
        sftp = c.open_sftp()
        dest = posixpath.join(EMMA_HOME, "config.yaml")
        print(f"→ SFTP config.yaml → {dest}")
        sftp.put(WIN_CONFIG, dest)
        sftp.chmod(dest, 0o600)
        sftp.close()

        # 2) git pull (fast-forward only; do not clobber the tandem agent's work).
        print("→ git pull (ff-only) on emma")
        rc, out, err = run(c, f"git -C {EMMA_REPO} pull --ff-only")
        print(out or err)

        # 3) install.sh
        print("→ running install.sh on emma (this builds + enables the prod service)\n")
        rc, out, err = run(c, f"cd {EMMA_REPO}/dashboard_v2 && CTRLB_HOME={EMMA_HOME} bash deploy/emma/install.sh")
        print(out)
        if err.strip():
            print("--- stderr ---\n" + err)
        print(f"\ninstall.sh exit code: {rc}")
        if rc == 0:
            print("✓ Dashboard deployed. On emma, finish with: serve-https.sh (HTTPS) + start-claude.sh (agent).")
        return rc
    finally:
        c.close()


if __name__ == "__main__":
    raise SystemExit(main())
