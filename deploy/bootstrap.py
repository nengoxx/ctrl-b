"""One-command self-deploy orchestrator — run FROM a checkout with `config.yaml` to deploy onto a Linux box over SSH.

Targets the D32 topology (amended 2026-07-09 — trunk-based, workspace/runtime split; see docs/DEPLOY_EMMA.md).
Works whether the target already has the repo or NOT (clean machine): all paths resolve against the TARGET
user's $HOME (any user, not just emma), and a missing tree is cloned from GitHub.
  PROD  code ~/apps/ctrl-b    (deployed RUNTIME: clean, sparse, tag-pinned) · data ~/.ctrl-b      · uvicorn :5433 + Serve HTTPS
  DEV   code ~/github/ctrl-b  (the WORKSPACE: full clone, `main` — the only branch) · data ~/.ctrl-b-dev · uvicorn :5434 + Vite :5173

Steps, each flag-gated so you can hand any of them to the owner:
  0. prereqs (sudo)  — apt install tmux+git+sqlite3 · enable-linger · `tailscale set --operator`       [--no-prereqs]
  1. secret          — SFTP the gitignored config.yaml -> ~/.ctrl-b/config.yaml (0600). SKIPPED if the
                       target already has one (the TARGET's copy is canonical after first deploy — the
                       app rewrites it live); force with --overwrite-config (backs the old one up first).
  2. prod tree       — ensure ~/apps/ctrl-b is the sparse, tag-pinned PROD clone (missing→clone; sparse→update)
  3. install (prod)  — deploy/linux/install.sh prod (prereq check + 3.14 venv + npm build + DB snapshot + units)
  4. https           — serve-https.sh (Tailscale Serve 443->5433; mic-ready)                            [--no-serve]
  5. dev (optional)  — ensure the ~/github/ctrl-b workspace + install.sh dev (isolated :5434 + Vite
                       :5173 + the ALWAYS-ON ctrl-b-agent service — tmux Claude agent, boots with the box) [--with-dev]
  6. claude-env      — migrate the Claude Code dev framework: project MEMORY → the target's
                       ~/.claude/projects/<slug>/memory (skip-if-exists) + merge missing keys into the
                       target's ~/.claude/settings.json (target's values always win)                    [--claude-env]

Auth + host come from config.yaml (the `emma` host's ssh_* fields). The password is read at
runtime, piped to `sudo -S`, and NEVER printed/logged. Reuses paramiko (a backend dependency).

Usage (Bash tool needs dangerouslyDisableSandbox for LAN):
    py -3 deploy/bootstrap.py --dry-run           # show the plan, do nothing (no connection)
    py -3 deploy/bootstrap.py                     # prod deploy: prereqs->secret->prod-tree->install->https
    py -3 deploy/bootstrap.py --with-dev          # also stand up the DEV instance + the agent service
    py -3 deploy/bootstrap.py --claude-env        # also migrate the Claude Code memory/settings
    py -3 deploy/bootstrap.py --no-prereqs        # skip sudo (you ran apt/linger/operator yourself; non-apt distro)
    py -3 deploy/bootstrap.py --overwrite-config  # force-replace the target's config.yaml (backup taken first)
This makes WRITES on the target — only run it to deploy (not for recon). Idempotent: safe to re-run; on any
failure it stops with an actionable message and where it stopped, so you can fix + re-run (or finish manually).
"""

from __future__ import annotations

import json
import os
import posixpath
import subprocess
import sys
import tempfile

import paramiko
import yaml

# Windows consoles default to cp1252 → the ✓/→/⚠ in our output (and the target's streamed echoes) crash on encode.
# Force UTF-8 on our streams (no-op where already UTF-8); errors="replace" so output can never crash the deploy.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# The LOCAL checkout root + its gitignored config.yaml (ssh creds + first-deploy secret) — resolved from
# this file's location, not hardcoded, so any clone location works. REPO_ROOT also keys the local Claude
# Code project slug for the --claude-env memory migration.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CONFIG = os.path.join(REPO_ROOT, "config.yaml")
# Path SUFFIXES — resolved against the target user's real $HOME after connect (works for any user/host).
# PROD is a deployed runtime (~/apps, the user-level /opt analogue); the workspace stays under ~/github.
PROD_SUB, WORK_SUB = "apps/ctrl-b", "github/ctrl-b"
HOME_SUB, DEV_HOME_SUB = ".ctrl-b", ".ctrl-b-dev"

DRY = "--dry-run" in sys.argv
NO_PREREQS = "--no-prereqs" in sys.argv
NO_SERVE = "--no-serve" in sys.argv
WITH_DEV = "--with-dev" in sys.argv
CLAUDE_ENV = "--claude-env" in sys.argv
OVERWRITE_CONFIG = "--overwrite-config" in sys.argv


def _local_origin() -> str | None:
    """The GitHub URL of THIS (Windows) checkout — the canonical clone source, so we can set up a machine that
    has NOTHING checked out yet (no dependency on the target already having a repo)."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        out = subprocess.check_output(
            ["git", "-C", here, "remote", "get-url", "origin"], text=True, stderr=subprocess.DEVNULL
        ).strip()
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
        self.c.connect(
            host, port=port, username=user, password=pw, timeout=20, allow_agent=False, look_for_keys=False
        )

    def run(self, cmd: str, *, sudo: bool = False, timeout: int = 900) -> int:
        """Run a command (optionally via `sudo -S`, password piped in). Streams output; returns exit code."""
        full = f"sudo -S -p '' bash -lc {_q(cmd)}" if sudo else f"bash -lc {_q(cmd)}"
        si, so, se = self.c.exec_command(full, timeout=timeout, get_pty=False)
        if sudo:
            si.write(self.pw + "\n")
            si.flush()
            try:
                si.channel.shutdown_write()
            except OSError:
                pass
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


def project_slug(path: str) -> str:
    """Claude Code's project-directory slug: every path separator and drive colon becomes '-'.
    Verified against real dirs on both OSes: C:\\Users\\rovax\\...\\ctrl-b → C--Users-rovax-...-ctrl-b;
    /home/emma/github/ctrl-b → -home-emma-github-ctrl-b (leading dash from the leading slash).
    (Claude's real rule dashes EVERY non-alphanumeric char — identical for these paths; if a workspace
    path ever gains a dot/space, extend this to match.)"""
    return path.replace("\\", "-").replace("/", "-").replace(":", "-")


def migrate_claude_env(m: "Emma", home: str, work_repo: str) -> None:
    """Move the per-machine half of the Claude Code dev framework (the rest travels in the repo:
    .agents/skills, .claude/settings.json hooks, CLAUDE.md/AGENTS.md/docs). Two pieces:
    (1) project MEMORY → the target's ~/.claude/projects/<target-slug>/memory — skip-if-present
        (the target's memory is canonical after the first migration, same rule as config.yaml);
    (2) user-global settings.json — ADD keys missing on the target (model/effort/permissions...),
        NEVER overwrite what the target already set (its theme etc. win). Auth is deliberately NOT
        copied — `claude` login state is per-machine."""
    src_mem = os.path.join(os.path.expanduser("~"), ".claude", "projects", project_slug(REPO_ROOT), "memory")
    dst_proj = f"{home}/.claude/projects/{project_slug(work_repo)}"
    _, has_mem = m.capture(f'[ -n "$(ls -A {dst_proj}/memory 2>/dev/null)" ] && echo yes || echo no')
    if has_mem == "yes":
        print(f"  ✓ {dst_proj}/memory already populated — left untouched (target memory is canonical).")
    elif not os.path.isdir(src_mem):
        print(f"  ⚠ no local memory at {src_mem} — skipping the memory copy.")
    else:
        m.run(f"mkdir -p {dst_proj}/memory")
        n = 0
        for root, _dirs, files in os.walk(src_mem):
            rel = os.path.relpath(root, src_mem).replace("\\", "/")
            rdir = f"{dst_proj}/memory" + ("" if rel == "." else f"/{rel}")
            if rel != ".":
                m.run(f"mkdir -p {rdir}")
            for fn in files:
                m.put(os.path.join(root, fn), f"{rdir}/{fn}")
                n += 1
        print(f"  -> {n} memory files → {dst_proj}/memory")

    local_settings = os.path.join(os.path.expanduser("~"), ".claude", "settings.json")
    if not os.path.isfile(local_settings):
        print("  ⚠ no local ~/.claude/settings.json — skipping the settings merge.")
        return
    want = json.load(open(local_settings, encoding="utf-8"))
    rc, cur = m.capture("cat ~/.claude/settings.json 2>/dev/null")
    have = json.loads(cur) if (rc == 0 and cur.strip()) else {}
    merged = {**want, **have}  # shallow on purpose: any key the target has stays exactly as-is
    if merged == have:
        print("  ✓ target ~/.claude/settings.json already has every key — untouched.")
        return
    m.run(f"mkdir -p {home}/.claude")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
        json.dump(merged, tf, indent=2)
        tf.write("\n")
        tmp = tf.name
    try:
        m.put(tmp, f"{home}/.claude/settings.json")
    finally:
        os.unlink(tmp)
    added = sorted(set(merged) - set(have))
    print(f"  -> settings merged (added: {', '.join(added)}; existing target values preserved)")


def ensure_prod_tree(m: "Emma", prod_repo: str, work_repo: str, gh: str | None) -> int:
    """Make sure `prod_repo` is the sparse, tag-pinned PROD runtime clone — missing → clone; sparse →
    fetch + re-pin to the latest release tag. Returns 0 on success, non-zero to abort. The prod path is a
    dedicated runtime dir (~/apps) — anything else found there is unexpected and we refuse to touch it."""
    _, state = m.capture(
        f"if [ ! -e {prod_repo} ]; then echo missing; "
        f'elif [ "$(git -C {prod_repo} config --get core.sparseCheckout 2>/dev/null)" = true ]; then echo sparse; '
        f"else echo unexpected; fi"
    )
    if state == "sparse":
        m.run(f"git -C {prod_repo} fetch --tags --quiet origin || true")
        _, tag = m.capture(f"git -C {prod_repo} describe --tags --abbrev=0 2>/dev/null || true")
        if tag:
            m.run(f"git -C {prod_repo} checkout --quiet {tag} && echo '  PROD pinned to tag {tag}'")
        else:
            m.run(
                f"git -C {prod_repo} checkout --quiet main && git -C {prod_repo} pull --ff-only --quiet && "
                f"echo '  PROD on main (no tags yet — tag the first release to pin it)'"
            )
        return 0
    if state == "unexpected":
        print(f"  ✗ {prod_repo} exists but is not the sparse PROD clone — refusing to touch it.")
        print("    Move it aside (or pick another prod path via the PROD_SUB constant) and re-run.")
        return 2
    # missing — clone sparse from the workspace's origin, else this checkout's GitHub URL.
    _, workgh = m.capture(f"git -C {work_repo} remote get-url origin 2>/dev/null || true")
    src = workgh or gh
    if not src:
        print(
            "  ✗ PROD tree missing and no GitHub URL known (no local origin, no workspace). Clone it manually "
            "first, or run from a checkout with an `origin` remote."
        )
        return 1
    print(f"  PROD tree missing → fresh sparse clone from {src}")
    rc = m.run(
        f"mkdir -p $(dirname {prod_repo}) && "
        f"git clone --filter=blob:none --sparse {src} {prod_repo} && "
        f"git -C {prod_repo} sparse-checkout set backend frontend deploy && "  # cone mode: + top-level files; prototype dirs drop
        f"TAG=$(git -C {prod_repo} describe --tags --abbrev=0 2>/dev/null || true); "
        f'[ -n "$TAG" ] && git -C {prod_repo} checkout --quiet "$TAG" || git -C {prod_repo} checkout --quiet main'
    )
    if rc:
        print(
            "  ✗ clone failed — the target needs `git` + network/credentials for the repo (private repo → a "
            "configured git credential helper or a token in the URL)."
        )
    return rc


def ensure_workspace(m: "Emma", prod_repo: str, work_repo: str, gh: str | None) -> int:
    """Make sure the WORKSPACE exists (full clone on `main` — the only branch; the dev instance serves it
    and all agents work here). Existing tree: fetch, fast-forward if clean, and WARN if it has drifted off
    main (the D32-amended invariant: the workspace never leaves main; other checkouts use worktrees).
    Returns 0 on success, non-zero on failure (dev is optional → caller skips dev)."""
    _, has = m.capture(f"[ -d {work_repo}/.git ] && echo yes || echo no")
    if has == "yes":
        m.run(f"git -C {work_repo} fetch origin --quiet || true")
        _, branch = m.capture(f"git -C {work_repo} branch --show-current 2>/dev/null || true")
        if branch != "main":
            print(f"  ⚠ workspace is on '{branch or '(detached)'}' — the invariant is: it never leaves main.")
            print("    Not touching it (it may be an agent's live state) — check it out to main when safe.")
            return 0
        _, dirty = m.capture(f"git -C {work_repo} status --porcelain | head -1")
        if dirty:
            print("  ⚠ workspace has uncommitted changes — skipping the fast-forward (agent WIP is sacred).")
        else:
            m.run(
                f"git -C {work_repo} pull --ff-only --quiet || echo '  ⚠ ff-pull failed — update it manually'"
            )
        return 0
    _, prodgh = m.capture(f"git -C {prod_repo} remote get-url origin 2>/dev/null || true")
    src = prodgh or gh
    if not src:
        print("  ⚠ workspace missing and no GitHub URL known — skipping dev.")
        return 1
    print(f"  workspace missing → fresh clone from {src} (main)")
    return m.run(f"git clone {src} {work_repo}")


def main() -> int:
    cfg = yaml.safe_load(open(SRC_CONFIG, encoding="utf-8"))
    e = cfg.get("computers", {}).get("emma") or find_emma(cfg)
    if not e:
        print(
            "ERROR: target Linux host not found in config.yaml (need a host with os_type: linux + ip/ssh_*)."
        )
        return 1
    host, port = str(e["ip"]), int(e.get("ssh_port", 22))
    user, pw = str(e["ssh_username"]), str(e["ssh_password"])  # never printed

    plan = ["prereqs (sudo: tmux+git+sqlite3, linger, tailscale operator)"] if not NO_PREREQS else []
    plan += [
        "sftp config.yaml → ~/.ctrl-b (first deploy only — skipped if the target has one)",
        "ensure PROD tree (clone/update, tag-pinned)",
        "install.sh prod (prereqs + 3.14 venv + dist + DB snapshot + service)",
    ]
    plan += [] if NO_SERVE else ["serve-https (Tailscale HTTPS 443→5433)"]
    plan += ["ensure workspace + install.sh dev (:5434 + Vite :5173 + agent service)"] if WITH_DEV else []
    plan += ["claude-env (memory + settings → target ~/.claude)"] if CLAUDE_ENV else []
    print(f"Deploy target: {user}@{host}:{port}   (paths resolve against the target's $HOME)")
    print("  PROD: ~/apps/ctrl-b → ~/.ctrl-b (:5433, Serve HTTPS)")
    print(
        "  DEV : ~/github/ctrl-b (workspace, main) → ~/.ctrl-b-dev (:5434 + Vite :5173)"
        + ("" if WITH_DEV else "   [skipped — pass --with-dev]")
    )
    print(
        f"  GitHub source for clean-machine clone: {GH_URL or '(unknown — only works if the target already has a checkout)'}"
    )
    print("Plan: " + " -> ".join(plan) + ("   [DRY RUN]" if DRY else ""))
    if DRY:
        return 0

    try:
        m = Emma(host, port, user, pw)
    except Exception as ex:
        print(f"ERROR: SSH connect to {user}@{host}:{port} failed: {ex}")
        print(
            "  Check: host reachable (tailnet/LAN up?), ssh creds in config.yaml correct, sshd running on the target."
        )
        return 1
    try:
        # Resolve the target's real $HOME → absolute paths that work for SFTP (no shell expansion) and any user.
        _, home = m.capture("echo $HOME")
        home = home or f"/home/{user}"
        prod_repo, work_repo = f"{home}/{PROD_SUB}", f"{home}/{WORK_SUB}"
        prod_home, dev_home = f"{home}/{HOME_SUB}", f"{home}/{DEV_HOME_SUB}"

        if not NO_PREREQS:
            step(0, "prereqs (sudo)")
            # apt-based (Ubuntu/Debian). On a non-apt distro use --no-prereqs and install these yourself.
            # sqlite3 = the CLI install.sh uses for the pre-cutover DB snapshot (Online Backup API).
            # python3-venv = Debian/Ubuntu ships base python3 WITHOUT ensurepip — `python3 -m venv` fails
            # without this package even though `import venv` works (the classic trap).
            if m.run("apt-get update -qq && apt-get install -y tmux git sqlite3 python3-venv", sudo=True):
                print(
                    "  ⚠ apt prereqs failed (non-apt distro?). Install git+tmux+sqlite3+python-venv manually, or use --no-prereqs."
                )
            m.run(f"loginctl enable-linger {user}", sudo=True)  # user services survive logout/reboot
            m.run(f"tailscale set --operator={user}", sudo=True)  # `tailscale serve` without sudo
            print("  tmux+git+sqlite3, linger, tailscale operator ensured.")

        step(1, f"config.yaml -> {prod_home}/")
        m.run(f"mkdir -p {prod_home}")
        dest = posixpath.join(prod_home, "config.yaml")
        # After the first deploy the TARGET's config is the canonical, living copy (the app rewrites it;
        # the owner edits it via the settings UI) — a re-run must never clobber it with this checkout's
        # stale snapshot. Skip when present; --overwrite-config forces it (with a timestamped backup).
        _, existing = m.capture(f"[ -f {dest} ] && echo yes || echo no")
        if existing == "yes" and not OVERWRITE_CONFIG:
            print(f"  ✓ {dest} already exists — left untouched (the target's copy is canonical).")
            print("    Force-replace with --overwrite-config (a timestamped backup is taken first).")
        else:
            if existing == "yes":
                m.run(f"cp -p {dest} {dest}.bak-$(date +%Y%m%d-%H%M%S) && echo '  (backed up the old one)'")
            m.put(SRC_CONFIG, dest)
            print(f"  -> {dest} (0600)")

        step(2, "ensure PROD tree (clean sparse, tag-pinned)")
        rc = ensure_prod_tree(m, prod_repo, work_repo, GH_URL)
        if rc:
            print("  → resolve the PROD tree (see above) and re-run (bootstrap is idempotent).")
            return rc
        m.run(f"git -C {prod_repo} log --oneline -1")

        step(3, "install.sh prod (prereq check + native-3.14 venv + dist + enable prod service)")
        rc = m.run(f"cd {prod_repo} && CTRLB_HOME={prod_home} bash deploy/linux/install.sh prod")
        if rc:
            print(
                f"ERROR: install.sh prod exited {rc}. Inspect on the box:  systemctl --user status ctrl-b-dashboard"
                f"  /  journalctl --user -u ctrl-b-dashboard -n50. Fix + re-run (idempotent)."
            )
            return rc
        m.run("systemctl --user status ctrl-b-dashboard --no-pager | head -4 || true")
        m.run("curl -s -m5 localhost:5433/api/health || echo '(prod health check failed — see service logs)'")

        if not NO_SERVE:
            step(4, "Tailscale Serve (HTTPS 443 -> 5433)")
            m.run(f"cd {prod_repo} && bash deploy/linux/serve-https.sh")

        if WITH_DEV:
            step(5, "DEV instance (isolated): ensure workspace + install.sh dev")
            if ensure_workspace(m, prod_repo, work_repo, GH_URL):
                print("  ⚠ could not ensure the workspace — skipping dev (prod is unaffected).")
            else:
                rc = m.run(f"cd {work_repo} && CTRLB_HOME={dev_home} bash deploy/linux/install.sh dev")
                if rc:
                    print(
                        f"  ⚠ install.sh dev exited {rc} (prod is unaffected). Inspect: systemctl --user status ctrl-b-dashboard-dev"
                    )
                else:
                    m.run(
                        "curl -s -m5 localhost:5434/api/health || echo '(dev health check failed — see logs)'"
                    )

        if CLAUDE_ENV:
            step(6, "Claude Code framework: memory + settings → target ~/.claude")
            migrate_claude_env(m, home, work_repo)

        print("\nDEPLOY COMPLETE. Dashboard: https://<host>.<tailnet>.ts.net (see `tailscale serve status`).")
        if WITH_DEV:
            print(
                f"  Agent service is up with the dev instance — attach:  ssh {host} -t 'tmux attach -t ctrl-b'"
            )
        return 0
    finally:
        m.close()


if __name__ == "__main__":
    raise SystemExit(main())
