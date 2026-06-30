"""One-command self-deploy orchestrator — run FROM the Windows checkout to deploy onto a Linux box over SSH.

Targets the D32 two-tree topology (see docs/DEPLOY_EMMA.md). Works whether the target already has the repo or
NOT (clean machine): all paths resolve against the TARGET user's $HOME (any user, not just emma), and a missing
tree is cloned from GitHub.
  PROD  code ~/github/ctrl-b      (clean, sparse, tag-pinned) · data ~/.ctrl-b      · uvicorn :5433 + Serve HTTPS
  DEV   code ~/github/ctrl-b-dev  (full, `dev` branch)        · data ~/.ctrl-b-dev  · uvicorn :5434 + Vite :5173

Steps, each flag-gated so you can hand any of them to the owner:
  0. prereqs (sudo)  — apt install tmux+git · enable-linger · `tailscale set --operator`               [--no-prereqs]
  1. secret          — SFTP the gitignored config.yaml -> ~/.ctrl-b/config.yaml (0600)
  2. prod tree       — ensure ~/github/ctrl-b is the sparse, tag-pinned PROD clone (missing→clone; legacy full→
                       the coordinated migrate-layout.sh; sparse→update)
  3. install (prod)  — deploy/linux/install.sh prod (prereq check + 3.14 venv + npm build + render units)
  4. https           — serve-https.sh (Tailscale Serve 443->5433; mic-ready)                            [--no-serve]
  5. dev (optional)  — ensure ~/github/ctrl-b-dev + install.sh dev (isolated :5434 + Vite :5173)        [--with-dev]
  6. agent           — start-claude.sh (the Claude agent in tmux, IN THE DEV TREE)                      [--start-agent]

Auth + host come from config.yaml (the `emma` host's ssh_* fields). The password is read at
runtime, piped to `sudo -S`, and NEVER printed/logged. Reuses paramiko (a backend dependency).

Usage (Bash tool needs dangerouslyDisableSandbox for LAN):
    py -3 deploy/bootstrap.py --dry-run        # show the plan, do nothing (no connection)
    py -3 deploy/bootstrap.py                  # prod deploy: prereqs->secret->prod-tree->install->https
    py -3 deploy/bootstrap.py --with-dev       # also stand up the isolated DEV instance
    py -3 deploy/bootstrap.py --start-agent    # also start the Claude agent in tmux (dev tree)
    py -3 deploy/bootstrap.py --no-prereqs     # skip sudo (you ran apt/linger/operator yourself; non-apt distro)
This makes WRITES on the target — only run it to deploy (not for recon). Idempotent: safe to re-run; on any
failure it stops with an actionable message and where it stopped, so you can fix + re-run (or finish manually).
"""
from __future__ import annotations
import os, sys, posixpath, subprocess, yaml, paramiko

# Windows consoles default to cp1252 → the ✓/→/⚠ in our output (and the target's streamed echoes) crash on encode.
# Force UTF-8 on our streams (no-op where already UTF-8); errors="replace" so output can never crash the deploy.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

WIN_CONFIG = r"C:\Users\rovax\Documents\github\ctrl-b\config.yaml"  # source of truth + ssh creds
# Path SUFFIXES — resolved against the target user's real $HOME after connect (works for any user/host).
REPO_SUB, DEV_SUB = "github/ctrl-b", "github/ctrl-b-dev"
HOME_SUB, DEV_HOME_SUB = ".ctrl-b", ".ctrl-b-dev"

DRY = "--dry-run" in sys.argv
NO_PREREQS = "--no-prereqs" in sys.argv
NO_SERVE = "--no-serve" in sys.argv
WITH_DEV = "--with-dev" in sys.argv
START_AGENT = "--start-agent" in sys.argv


def _local_origin() -> str | None:
    """The GitHub URL of THIS (Windows) checkout — the canonical clone source, so we can set up a machine that
    has NOTHING checked out yet (no dependency on the target already having a repo)."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        out = subprocess.check_output(["git", "-C", here, "remote", "get-url", "origin"],
                                      text=True, stderr=subprocess.DEVNULL).strip()
        return out or None
    except Exception:
        return None


GH_URL = _local_origin()


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


def ensure_prod_tree(m: "Emma", prod_repo: str, dev_repo: str, gh: str | None) -> int:
    """Make sure `prod_repo` is the sparse, tag-pinned PROD clone — whether it's missing, the legacy full
    checkout, or already sparse. Returns 0 on success, non-zero to abort. The one-time conversion off the
    legacy FULL checkout is the coordinated `migrate-layout.sh` (it moves the agent's tree) — we DETECT +
    INSTRUCT here rather than mutate the agent's working tree from a remote script."""
    _, state = m.capture(
        f'if [ ! -d {prod_repo}/.git ]; then echo missing; '
        f'elif [ "$(git -C {prod_repo} config --get core.sparseCheckout 2>/dev/null)" = true ]; then echo sparse; '
        f'else echo full; fi'
    )
    if state == "sparse":
        m.run(f"git -C {prod_repo} fetch --tags --quiet origin || true")
        _, tag = m.capture(f"git -C {prod_repo} describe --tags --abbrev=0 2>/dev/null || true")
        if tag:
            m.run(f"git -C {prod_repo} checkout --quiet {tag} && echo '  PROD pinned to tag {tag}'")
        else:
            m.run(f"git -C {prod_repo} checkout --quiet main && git -C {prod_repo} pull --ff-only --quiet && "
                  f"echo '  PROD on main (no tags yet — cut one from dev to pin a release)'")
        return 0
    if state == "full":
        print("  ⚠ this is still the LEGACY full checkout (the tandem agent's tree).")
        print("    The D32 layout needs a ONE-TIME, agent-coordinated migration (stop the agent, then on the box):")
        print(f"      bash {dev_repo}/deploy/linux/migrate-layout.sh   # if a dev tree exists")
        print(f"      bash {prod_repo}/deploy/linux/migrate-layout.sh  # otherwise")
        print("    It moves the checkout → the dev tree (branch dev) and re-creates the prod tree as a clean")
        print("    sparse clone. Re-run bootstrap.py afterward. (Not auto-run — it touches the agent.)")
        return 2
    # missing — clean machine: clone sparse from the dev tree's origin, else this checkout's GitHub URL.
    _, devgh = m.capture(f"git -C {dev_repo} remote get-url origin 2>/dev/null || true")
    src = devgh or gh
    if not src:
        print("  ✗ PROD tree missing and no GitHub URL known (no local origin, no dev tree). Clone it manually "
              "first, or run from a checkout with an `origin` remote."); return 1
    print(f"  PROD tree missing → fresh sparse clone from {src}")
    rc = m.run(
        f"git clone --filter=blob:none --sparse {src} {prod_repo} && "
        f"git -C {prod_repo} sparse-checkout set backend frontend deploy && "      # cone mode: + top-level files; prototype dirs drop
        f'TAG=$(git -C {prod_repo} describe --tags --abbrev=0 2>/dev/null || true); '
        f'[ -n "$TAG" ] && git -C {prod_repo} checkout --quiet "$TAG" || git -C {prod_repo} checkout --quiet main'
    )
    if rc:
        print("  ✗ clone failed — the target needs `git` + network/credentials for the repo (private repo → a "
              "configured git credential helper or a token in the URL).")
    return rc


def ensure_dev_tree(m: "Emma", prod_repo: str, dev_repo: str, gh: str | None) -> int:
    """Make sure the DEV tree exists (full clone on `dev`). On emma it comes from migrate-layout; on a clean
    machine we clone it here. Returns 0 on success, non-zero on failure (dev is optional → caller skips dev)."""
    _, has = m.capture(f"[ -d {dev_repo}/.git ] && echo yes || echo no")
    if has == "yes":
        m.run(f"git -C {dev_repo} fetch origin --quiet || true")
        return 0
    _, prodgh = m.capture(f"git -C {prod_repo} remote get-url origin 2>/dev/null || true")
    src = prodgh or gh
    if not src:
        print("  ⚠ DEV tree missing and no GitHub URL known — skipping dev."); return 1
    print(f"  DEV tree missing → fresh clone from {src} (branch dev)")
    return m.run(f"git clone {src} {dev_repo} && "
                 f"(git -C {dev_repo} checkout dev 2>/dev/null || git -C {dev_repo} checkout -b dev)")


def main() -> int:
    cfg = yaml.safe_load(open(WIN_CONFIG, encoding="utf-8"))
    e = cfg.get("computers", {}).get("emma") or find_emma(cfg)
    if not e:
        print("ERROR: target Linux host not found in config.yaml (need a host with os_type: linux + ip/ssh_*)."); return 1
    host, port = str(e["ip"]), int(e.get("ssh_port", 22))
    user, pw = str(e["ssh_username"]), str(e["ssh_password"])  # never printed

    plan = ["prereqs (sudo: tmux+git, linger, tailscale operator)"] if not NO_PREREQS else []
    plan += ["sftp config.yaml → ~/.ctrl-b", "ensure PROD tree (clone/migrate/update)",
             "install.sh prod (prereqs + 3.14 venv + dist + service)"]
    plan += [] if NO_SERVE else ["serve-https (Tailscale HTTPS 443→5433)"]
    plan += ["ensure DEV tree + install.sh dev (:5434 + Vite :5173)"] if WITH_DEV else []
    plan += ["start-claude (tmux agent, dev tree)"] if START_AGENT else []
    print(f"Deploy target: {user}@{host}:{port}   (paths resolve against the target's $HOME)")
    print("  PROD: ~/github/ctrl-b → ~/.ctrl-b (:5433, Serve HTTPS)")
    print("  DEV : ~/github/ctrl-b-dev → ~/.ctrl-b-dev (:5434 + Vite :5173)"
          + ("" if WITH_DEV else "   [skipped — pass --with-dev]"))
    print(f"  GitHub source for clean-machine clone: {GH_URL or '(unknown — only works if the target already has a checkout)'}")
    print("Plan: " + " -> ".join(plan) + ("   [DRY RUN]" if DRY else ""))
    if DRY:
        return 0

    try:
        m = Emma(host, port, user, pw)
    except Exception as ex:
        print(f"ERROR: SSH connect to {user}@{host}:{port} failed: {ex}")
        print("  Check: host reachable (tailnet/LAN up?), ssh creds in config.yaml correct, sshd running on the target.")
        return 1
    try:
        # Resolve the target's real $HOME → absolute paths that work for SFTP (no shell expansion) and any user.
        _, home = m.capture("echo $HOME")
        home = home or f"/home/{user}"
        prod_repo, dev_repo = f"{home}/{REPO_SUB}", f"{home}/{DEV_SUB}"
        prod_home, dev_home = f"{home}/{HOME_SUB}", f"{home}/{DEV_HOME_SUB}"

        if not NO_PREREQS:
            step(0, "prereqs (sudo)")
            # apt-based (Ubuntu/Debian). On a non-apt distro use --no-prereqs and install git/tmux yourself.
            if m.run("apt-get update -qq && apt-get install -y tmux git", sudo=True):
                print("  ⚠ apt prereqs failed (non-apt distro?). Install git + tmux manually, or use --no-prereqs.")
            m.run(f"loginctl enable-linger {user}", sudo=True)          # user services survive logout/reboot
            m.run(f"tailscale set --operator={user}", sudo=True)        # `tailscale serve` without sudo
            print("  tmux+git, linger, tailscale operator ensured.")

        step(1, f"SFTP config.yaml -> {prod_home}/")
        m.run(f"mkdir -p {prod_home}")
        dest = posixpath.join(prod_home, "config.yaml")
        m.put(WIN_CONFIG, dest)
        print(f"  -> {dest} (0600)")

        step(2, "ensure PROD tree (clean sparse, tag-pinned)")
        rc = ensure_prod_tree(m, prod_repo, dev_repo, GH_URL)
        if rc:
            print("  → resolve the PROD tree (see above) and re-run (bootstrap is idempotent)."); return rc
        m.run(f"git -C {prod_repo} log --oneline -1")

        step(3, "install.sh prod (prereq check + native-3.14 venv + dist + enable prod service)")
        rc = m.run(f"cd {prod_repo} && CTRLB_HOME={prod_home} bash deploy/linux/install.sh prod")
        if rc:
            print(f"ERROR: install.sh prod exited {rc}. Inspect on the box:  systemctl --user status ctrl-b-dashboard"
                  f"  /  journalctl --user -u ctrl-b-dashboard -n50. Fix + re-run (idempotent)."); return rc
        m.run("systemctl --user status ctrl-b-dashboard --no-pager | head -4 || true")
        m.run("curl -s -m5 localhost:5433/api/health || echo '(prod health check failed — see service logs)'")

        if not NO_SERVE:
            step(4, "Tailscale Serve (HTTPS 443 -> 5433)")
            m.run(f"cd {prod_repo} && bash deploy/linux/serve-https.sh")

        if WITH_DEV:
            step(5, "DEV instance (isolated): ensure tree + install.sh dev")
            if ensure_dev_tree(m, prod_repo, dev_repo, GH_URL):
                print("  ⚠ could not ensure the DEV tree — skipping dev (prod is unaffected).")
            else:
                rc = m.run(f"cd {dev_repo} && CTRLB_HOME={dev_home} bash deploy/linux/install.sh dev")
                if rc:
                    print(f"  ⚠ install.sh dev exited {rc} (prod is unaffected). Inspect: systemctl --user status ctrl-b-dashboard-dev")
                else:
                    m.run("curl -s -m5 localhost:5434/api/health || echo '(dev health check failed — see logs)'")

        if START_AGENT:
            step(6, "start the Claude agent (tmux, dev tree)")
            m.run(f"cd {dev_repo} && bash tools/start-claude.sh || "
                  f"echo '(start-claude needs the dev tree — run migrate-layout.sh / --with-dev first)'")

        print("\nDEPLOY COMPLETE. Dashboard: https://<host>.<tailnet>.ts.net (see `tailscale serve status`).")
        if not START_AGENT:
            print(f"  Start the agent when ready:  ssh {host} -t 'cd {dev_repo} && bash tools/start-claude.sh'")
        return 0
    finally:
        m.close()


if __name__ == "__main__":
    raise SystemExit(main())
