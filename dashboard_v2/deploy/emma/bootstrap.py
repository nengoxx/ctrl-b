"""One-command self-deploy orchestrator — run FROM the Windows checkout to deploy onto emma over SSH.

Targets the D32 two-tree topology (see docs/DEPLOY_EMMA.md):
  PROD  code ~/github/ctrl-b      (clean, sparse, tag-pinned) · data ~/.ctrl-b      · uvicorn :5433 + Serve HTTPS
  DEV   code ~/github/ctrl-b-dev  (full, `dev` branch)        · data ~/.ctrl-b-dev  · uvicorn :5434 + Vite :5173

Designed so the Claude Code agent can deploy END-TO-END by itself (sudo works on emma via the SSH password).
Steps, each flag-gated so you can hand any of them to the owner:

  0. prereqs (sudo)  — apt install tmux + `tailscale set --operator` (so Serve runs without sudo)   [--no-prereqs]
  1. secret          — SFTP the gitignored dashboard_v2/config.yaml -> emma ~/.ctrl-b/config.yaml (0600)
  2. prod tree       — ensure ~/github/ctrl-b is the sparse, tag-pinned PROD clone (detect + update; the
                       ONE-TIME migration off the legacy full checkout is the coordinated migrate-layout.sh)
  3. install (prod)  — deploy/emma/install.sh prod (native-3.14 venv + pip install -e . + npm build + service)
  4. https           — serve-https.sh (Tailscale Serve 443->5433; mic-ready)                          [--no-serve]
  5. dev (optional)  — install.sh dev on ~/github/ctrl-b-dev (isolated :5434 + Vite :5173)            [--with-dev]
  6. agent           — start-claude.sh (the Claude agent in tmux, IN THE DEV TREE)                    [--start-agent]

Auth + host come from dashboard_v2/config.yaml (the `emma` host's ssh_* fields). The password is read at
runtime, piped to `sudo -S`, and NEVER printed/logged. Reuses paramiko (a backend dependency).

Usage (Bash tool needs dangerouslyDisableSandbox for LAN):
    py -3 deploy/emma/bootstrap.py --dry-run        # show the plan, do nothing
    py -3 deploy/emma/bootstrap.py                  # prod deploy: prereqs->secret->prod-tree->install->https
    py -3 deploy/emma/bootstrap.py --with-dev       # also stand up the isolated DEV instance
    py -3 deploy/emma/bootstrap.py --start-agent    # also start the Claude agent in tmux (dev tree)
    py -3 deploy/emma/bootstrap.py --no-prereqs     # owner already ran the two sudo commands
This makes WRITES on emma — only run it to deploy (not for recon). Idempotent: safe to re-run.
"""
from __future__ import annotations
import sys, posixpath, yaml, paramiko

WIN_CONFIG = r"C:\Users\rovax\Documents\github\ctrl-b\dashboard_v2\config.yaml"  # source of truth + ssh creds
PROD_REPO = "/home/emma/github/ctrl-b"          # clean, sparse, tag-pinned
DEV_REPO = "/home/emma/github/ctrl-b-dev"       # full, `dev` branch
PROD_HOME = "/home/emma/.ctrl-b"                # prod data root
DEV_HOME = "/home/emma/.ctrl-b-dev"             # dev data root

DRY = "--dry-run" in sys.argv
NO_PREREQS = "--no-prereqs" in sys.argv
NO_SERVE = "--no-serve" in sys.argv
WITH_DEV = "--with-dev" in sys.argv
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

    def capture(self, cmd: str, *, timeout: int = 60) -> tuple[int, str]:
        """Run a command and return (exit_code, stdout) without streaming — for state probes."""
        _, so, _ = self.c.exec_command(f"bash -lc {_q(cmd)}", timeout=timeout, get_pty=False)
        out = so.read().decode(errors="replace")
        return so.channel.recv_exit_status(), out.strip()

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


def ensure_prod_tree(m: "Emma") -> int:
    """Make sure ~/github/ctrl-b is the sparse, tag-pinned PROD clone. Returns 0 on success, non-zero to abort.
    The one-time conversion off the legacy FULL checkout is the coordinated `migrate-layout.sh` (it moves the
    agent's tree) — we DETECT + INSTRUCT here rather than mutate the agent's working tree from a remote script."""
    _, state = m.capture(
        f'if [ ! -d {PROD_REPO}/.git ]; then echo missing; '
        f'elif [ "$(git -C {PROD_REPO} config --get core.sparseCheckout 2>/dev/null)" = true ]; then echo sparse; '
        f'else echo full; fi'
    )
    if state == "sparse":
        m.run(f"git -C {PROD_REPO} fetch --tags --quiet origin || true")
        _, tag = m.capture(f"git -C {PROD_REPO} describe --tags --abbrev=0 2>/dev/null || true")
        if tag:
            m.run(f"git -C {PROD_REPO} checkout --quiet {tag} && echo '  PROD pinned to tag {tag}'")
        else:
            m.run(f"git -C {PROD_REPO} checkout --quiet main && git -C {PROD_REPO} pull --ff-only --quiet && "
                  f"echo '  PROD on main (no tags yet — cut one from dev to pin a release)'")
        return 0
    if state == "full":
        print("  ⚠ ~/github/ctrl-b is still the LEGACY full checkout (the tandem agent's).")
        print("    The D32 layout needs a ONE-TIME, agent-coordinated migration (stop the agent, then):")
        print(f"      ssh emma -t 'bash {DEV_REPO}/dashboard_v2/deploy/emma/migrate-layout.sh'  # if dev tree exists")
        print(f"      ssh emma -t 'bash {PROD_REPO}/dashboard_v2/deploy/emma/migrate-layout.sh'  # otherwise")
        print("    It moves the checkout → ~/github/ctrl-b-dev (branch dev) and re-creates ~/github/ctrl-b")
        print("    as a clean sparse clone. Re-run bootstrap.py afterward. (Not auto-run — it touches the agent.)")
        return 2
    # missing — fresh box: clone sparse from whatever origin the dev tree (or a passed GH=) knows.
    _, gh = m.capture(f"git -C {DEV_REPO} remote get-url origin 2>/dev/null || true")
    if not gh:
        print("  ERROR: no PROD tree and no DEV tree to learn the GitHub URL from. Clone one first, or run "
              "migrate-layout.sh on the existing checkout.")
        return 1
    m.run(f"git clone --filter=blob:none --sparse {gh} {PROD_REPO} && "
          f"git -C {PROD_REPO} sparse-checkout set dashboard_v2 && "  # cone mode: + top-level files; prototype dirs drop
          f'TAG=$(git -C {PROD_REPO} describe --tags --abbrev=0 2>/dev/null || true); '
          f'[ -n "$TAG" ] && git -C {PROD_REPO} checkout --quiet "$TAG" || git -C {PROD_REPO} checkout --quiet main')
    return 0


def main() -> int:
    cfg = yaml.safe_load(open(WIN_CONFIG, encoding="utf-8"))
    e = cfg.get("computers", {}).get("emma") or find_emma(cfg)
    if not e:
        print("ERROR: emma host not found in config.yaml"); return 1
    host, port = str(e["ip"]), int(e.get("ssh_port", 22))
    user, pw = str(e["ssh_username"]), str(e["ssh_password"])  # never printed

    plan = ["prereqs (sudo: tmux + tailscale operator)"] if not NO_PREREQS else []
    plan += ["sftp config.yaml → ~/.ctrl-b", "ensure PROD tree (sparse/tag)", "install.sh prod (3.14 venv + dist + service)"]
    plan += [] if NO_SERVE else ["serve-https (Tailscale HTTPS 443→5433)"]
    plan += ["install.sh dev (isolated :5434 + Vite :5173)"] if WITH_DEV else []
    plan += ["start-claude (tmux agent, dev tree)"] if START_AGENT else []
    print(f"Deploy target: {user}@{host}:{port}")
    print(f"  PROD: {PROD_REPO} → {PROD_HOME} (:5433, Serve HTTPS)")
    print(f"  DEV : {DEV_REPO} → {DEV_HOME} (:5434 + Vite :5173)" + ("" if WITH_DEV else "   [skipped — pass --with-dev]"))
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
        m.run(f"mkdir -p {PROD_HOME}")
        dest = posixpath.join(PROD_HOME, "config.yaml")
        m.put(WIN_CONFIG, dest)
        print(f"  -> {dest} (0600)")

        step(2, "ensure PROD tree (clean sparse, tag-pinned)")
        rc = ensure_prod_tree(m)
        if rc:
            print("  → resolve the PROD tree (see above) and re-run."); return rc
        m.run(f"git -C {PROD_REPO} log --oneline -1")

        step(3, "install.sh prod (native-3.14 venv + dist + enable prod service)")
        rc = m.run(f"cd {PROD_REPO}/dashboard_v2 && CTRLB_HOME={PROD_HOME} bash deploy/emma/install.sh prod")
        if rc:
            print(f"ERROR: install.sh prod exited {rc}."); return rc
        m.run("systemctl --user status ctrl-b-dashboard --no-pager | head -4 || true")
        m.run("curl -s -m5 localhost:5433/api/health || echo '(prod health check failed — see service logs)'")

        if not NO_SERVE:
            step(4, "Tailscale Serve (HTTPS 443 -> 5433)")
            m.run(f"cd {PROD_REPO}/dashboard_v2 && bash deploy/emma/serve-https.sh")

        if WITH_DEV:
            step(5, "install.sh dev (isolated DEV instance)")
            _, has_dev = m.capture(f"[ -d {DEV_REPO}/.git ] && echo yes || echo no")
            if has_dev != "yes":
                print(f"  ⚠ no DEV tree at {DEV_REPO} — run migrate-layout.sh first (it creates it). Skipping dev.")
            else:
                rc = m.run(f"cd {DEV_REPO}/dashboard_v2 && CTRLB_HOME={DEV_HOME} bash deploy/emma/install.sh dev")
                if rc:
                    print(f"  ⚠ install.sh dev exited {rc} (prod is unaffected).")
                else:
                    m.run("curl -s -m5 localhost:5434/api/health || echo '(dev health check failed — see logs)'")

        if START_AGENT:
            step(6, "start the Claude agent (tmux, dev tree)")
            m.run(f"cd {DEV_REPO}/dashboard_v2 && bash deploy/emma/start-claude.sh || "
                  f"echo '(start-claude needs the dev tree — run migrate-layout.sh first)'")

        print("\nDEPLOY COMPLETE. Dashboard: https://emma.<tailnet>.ts.net (see `tailscale serve status`).")
        if not START_AGENT:
            print(f"  Start the agent when ready:  ssh emma -t 'cd {DEV_REPO}/dashboard_v2 && bash deploy/emma/start-claude.sh'")
        return 0
    finally:
        m.close()


if __name__ == "__main__":
    raise SystemExit(main())
