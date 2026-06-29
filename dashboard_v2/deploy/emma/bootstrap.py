"""One-command self-deploy orchestrator — run FROM the Windows checkout to deploy onto emma over SSH.

Designed so the Claude Code agent can deploy END-TO-END by itself (sudo works on emma via the SSH password,
the same mechanism the backend uses). Steps, each gated by a flag so you can hand any of them to the owner:

  0. prereqs (sudo)  — apt install tmux + `tailscale set --operator` (so Serve runs without sudo)   [--no-prereqs]
  1. secret          — SFTP the gitignored dashboard_v2/config.yaml -> emma ~/.ctrl-b/config.yaml (0600)
  2. sync            — git pull --ff-only emma's checkout (gets pushed code; never commits there)
  3. install         — deploy/emma/install.sh (native-3.14 venv + pip install -e . + npm build + enable service)
  4. https           — serve-https.sh (Tailscale Serve 443->5433; mic-ready)                          [--no-serve]
  5. agent           — start-claude.sh (the Claude agent in tmux)                                     [--start-agent]

Auth + host come from dashboard_v2/config.yaml (the `emma` host's ssh_* fields). The password is read at
runtime, piped to `sudo -S`, and NEVER printed/logged. Reuses paramiko (a backend dependency).

Usage (Bash tool needs dangerouslyDisableSandbox for LAN):
    py -3 deploy/emma/bootstrap.py --dry-run        # show the plan, do nothing
    py -3 deploy/emma/bootstrap.py                  # full deploy: prereqs->secret->sync->install->https
    py -3 deploy/emma/bootstrap.py --start-agent    # also start the Claude agent in tmux
    py -3 deploy/emma/bootstrap.py --no-prereqs     # owner already ran the two sudo commands
This makes WRITES on emma — only run it to deploy (not for recon). Idempotent: safe to re-run.
"""
from __future__ import annotations
import sys, posixpath, yaml, paramiko

WIN_CONFIG = r"C:\Users\rovax\Documents\github\ctrl-b\dashboard_v2\config.yaml"  # source of truth + ssh creds
EMMA_REPO = "/home/emma/github/ctrl-b"
EMMA_HOME = "/home/emma/.ctrl-b"

DRY = "--dry-run" in sys.argv
NO_PREREQS = "--no-prereqs" in sys.argv
NO_SERVE = "--no-serve" in sys.argv
START_AGENT = "--start-agent" in sys.argv


def find_emma(o):
    if isinstance(o, dict):
        if o.get("os_type") == "linux" and "ip" in o:
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


class Emma:
    def __init__(self, host, port, user, pw):
        self.user, self.pw = user, pw
        self.c = paramiko.SSHClient()
        self.c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.c.connect(host, port=port, username=user, password=pw, timeout=20,
                       allow_agent=False, look_for_keys=False)

    def run(self, cmd: str, *, sudo: bool = False, timeout: int = 900) -> int:
        """Run a command (optionally via `sudo -S`, password piped in). Streams output; returns exit code."""
        full = f"sudo -S -p '' bash -lc {_q(cmd)}" if sudo else f"bash -lc {_q(cmd)}"
        si, so, se = self.c.exec_command(full, timeout=timeout, get_pty=False)
        if sudo:
            si.write(self.pw + "\n"); si.flush()
            try: si.channel.shutdown_write()
            except OSError: pass
        out = so.read().decode(errors="replace")
        err = se.read().decode(errors="replace")
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print("  [stderr] " + err.rstrip().replace("\n", "\n  [stderr] "))
        return so.channel.recv_exit_status()

    def put(self, local: str, remote: str):
        sftp = self.c.open_sftp()
        sftp.put(local, remote)
        sftp.chmod(remote, 0o600)
        sftp.close()

    def close(self):
        self.c.close()


def _q(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


def step(n, title):
    print(f"\n=== [{n}] {title} ===")


def main() -> int:
    cfg = yaml.safe_load(open(WIN_CONFIG, encoding="utf-8"))
    e = cfg.get("computers", {}).get("emma") or find_emma(cfg)
    if not e:
        print("ERROR: emma host not found in config.yaml"); return 1
    host, port = str(e["ip"]), int(e.get("ssh_port", 22))
    user, pw = str(e["ssh_username"]), str(e["ssh_password"])  # never printed

    plan = ["prereqs (sudo: tmux + tailscale operator)"] if not NO_PREREQS else []
    plan += ["sftp config.yaml", "git pull --ff-only", "install.sh (3.14 venv + service)"]
    plan += [] if NO_SERVE else ["serve-https (Tailscale HTTPS)"]
    plan += ["start-claude (tmux agent)"] if START_AGENT else []
    print(f"Deploy target: {user}@{host}:{port}   repo={EMMA_REPO}   CTRLB_HOME={EMMA_HOME}")
    print("Plan: " + " -> ".join(plan) + ("   [DRY RUN]" if DRY else ""))
    if DRY:
        return 0

    m = Emma(host, port, user, pw)
    try:
        if not NO_PREREQS:
            step(0, "prereqs (sudo)")
            m.run("command -v tmux >/dev/null || (apt-get update -qq && apt-get install -y tmux)", sudo=True)
            m.run(f"tailscale set --operator={user}", sudo=True)
            print("  tmux + tailscale operator ensured.")

        step(1, "SFTP config.yaml -> emma ~/.ctrl-b/")
        m.run(f"mkdir -p {EMMA_HOME}")
        dest = posixpath.join(EMMA_HOME, "config.yaml")
        m.put(WIN_CONFIG, dest)
        print(f"  -> {dest} (0600)")

        step(2, "git pull --ff-only (get pushed code)")
        if m.run(f"git -C {EMMA_REPO} pull --ff-only"):
            print("ERROR: git pull failed (emma's checkout not clean/ff-able?) — resolve before retrying."); return 1
        m.run(f"git -C {EMMA_REPO} log --oneline -1")

        step(3, "install.sh (native-3.14 venv + build + enable prod service)")
        rc = m.run(f"cd {EMMA_REPO}/dashboard_v2 && CTRLB_HOME={EMMA_HOME} bash deploy/emma/install.sh")
        if rc:
            print(f"ERROR: install.sh exited {rc}."); return rc
        m.run("systemctl --user status ctrl-b-dashboard --no-pager | head -4 || true")
        m.run("curl -s -m5 localhost:5433/api/health || echo '(health check failed — see service logs)'")

        if not NO_SERVE:
            step(4, "Tailscale Serve (HTTPS 443 -> 5433)")
            m.run(f"cd {EMMA_REPO}/dashboard_v2 && bash deploy/emma/serve-https.sh")

        if START_AGENT:
            step(5, "start the Claude agent (tmux)")
            m.run(f"cd {EMMA_REPO}/dashboard_v2 && bash deploy/emma/start-claude.sh")

        print("\nDEPLOY COMPLETE. Dashboard: https://emma.<tailnet>.ts.net (see `tailscale serve status`).")
        if not START_AGENT:
            print("  Start the agent when ready:  ssh emma -t 'cd ~/github/ctrl-b/dashboard_v2 && bash deploy/emma/start-claude.sh'")
        return 0
    finally:
        m.close()


if __name__ == "__main__":
    raise SystemExit(main())
