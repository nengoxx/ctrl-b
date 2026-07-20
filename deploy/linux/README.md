# emma deploy — runbook

Deploy the **ctrl-b dashboard** as **two isolated instances** + the **Claude Code remote agent** onto
**emma** (Ubuntu 26.04, tailnet `emma` / `100.109.206.88`). Topology + rationale: **DECISIONS.md D32
(amended 2026-07-09 — trunk-based, workspace/runtime split)** and `../../docs/DEPLOY_EMMA.md`.

## Topology (D32, amended) — two fully isolated instances, one repo, one branch

| | **PROD** (daily driver) | **DEV** (sandbox) |
|---|---|---|
| Code tree | `~/apps/ctrl-b` — the deployed **RUNTIME**: clean, **sparse**, **tag-pinned** clone (only `backend`+`frontend`+`deploy` + root files); pulls GitHub. **Never developed on.** | `~/github/ctrl-b` — the **WORKSPACE**: full clone pinned to **`main`** (the only branch); where **ALL development happens** |
| Data root | `~/.ctrl-b` (real config + db + memories/skills/agents) | `~/.ctrl-b-dev` (own copy; seeded from prod once) |
| Backend | `uvicorn :5433` serving built `dist` | `uvicorn :5434 --reload` |
| Frontend | built into `dist` (built aside, swapped at cutover) | Vite `:5173` HMR → `/api` → `:5434` |
| Ingress | **Tailscale Serve HTTPS :443** (mic works) **+ direct `http://emma:5433`** (LAN+tailnet — owner waiver 2026-07-10, SECURITY_MODEL §2.1; no mic over HTTP) | `http://emma:5173` (HTTP, no mic) |
| Units | `ctrl-b-dashboard.service` (boot) | `ctrl-b-dashboard-dev.service` + `ctrl-b-dashboard-dev-web.service` — **ON-DEMAND** (owner amendment 2026-07-10): `systemctl --user start` them when iterating, stop when done |

**Branch model (trunk-based):** ONE branch, **`main`** — always releasable (held by the git hooks + CI, which
run on every push). **Immutable annotated tags `vX.Y.Z`** mark releases; prod checks out a tag, never a branch.
There is **no `dev` branch** — "dev" names only the *instance* above.

**The workspace invariant: `~/github/ctrl-b` never leaves `main`.** The dev instance live-serves it, so a
checkout there flips the running app and tangles agent WIP. Every other checkout — a hotfix cut at a tag, a
prod-bug repro on release code, a second simultaneous writer — gets a **throwaway sibling worktree** via
`tools/add-dev-worktree.sh <name> [branch] [base]`, removed when done.

## Files (tidy layout)
```
deploy/
├── bootstrap.py              # local-checkout→emma orchestrator (the entry point you run)
├── README.md                 # "pick a target" overview (linux / windows / manual)
├── linux/                    # this Linux/systemd kit
│   ├── README.md             # this runbook
│   ├── install.sh            # [prod|dev] — build + enable ONE instance from the tree it's in
│   │                         #   prod also: DB snapshot pre-cutover + aside-built dist swap
│   ├── serve-https.sh        # Tailscale Serve HTTPS :443 → :5433 (prod)
│   ├── run.sh                # manual foreground runner (no systemd)
│   └── systemd/              # the user units (rendered to ~/.config/systemd/user/ by install.sh)
│       ├── ctrl-b-dashboard.service          # PROD backend (:5433, ~/.ctrl-b) — boot
│       ├── ctrl-b-dashboard-dev.service      # DEV backend (:5434 --reload, ~/.ctrl-b-dev) — on-demand
│       ├── ctrl-b-dashboard-dev-web.service  # DEV Vite (:5173 → :5434) — on-demand
│       └── ctrl-b-agent@.service             # TEMPLATE: the ALWAYS-ON Claude agents — instances
│                                             #   @fable → tmux ctrl-b-fable (claude-fable-5, high)
│                                             #   @opus  → tmux ctrl-b-opus  (claude-opus-4-8, high)
└── windows/                  # the double-click Windows kit (setup/start/autostart)

../tools/                     # dev launchers (NOT deploy): start-claude.sh (Linux), claude-{fable,opus}.{ps1,cmd} (Windows), add-dev-worktree.sh
```
`bootstrap.py` (orchestrator) is at `deploy/`; the Linux install/serve helpers + `systemd/` units are flat in
`deploy/linux/`. The Claude-agent launchers live in repo-root `tools/`. *(There is no layout migration script —
nothing on emma moves: the existing `~/github/ctrl-b` checkout IS the workspace; prod is a fresh clone at
`~/apps/ctrl-b`.)*

## Deploy — two paths

### A) Automated, one command from the local (Windows) checkout (recommended)
```bash
# from the repo root  (Bash tool needs dangerouslyDisableSandbox for LAN)
backend/.venv/Scripts/python.exe deploy/bootstrap.py --dry-run     # preview the plan
backend/.venv/Scripts/python.exe deploy/bootstrap.py               # prod: prereqs→config→prod-tree→install→https
backend/.venv/Scripts/python.exe deploy/bootstrap.py --with-dev    # + the DEV instance AND the agent service
backend/.venv/Scripts/python.exe deploy/bootstrap.py --claude-env  # + migrate the Claude Code memory/settings
#   --no-prereqs        skip sudo (you ran them)      --no-serve  skip Tailscale Serve
#   --overwrite-config  force-replace the target's config.yaml (timestamped backup taken first)
```
Reads SSH creds from `config.yaml`; never prints the password; idempotent; writes only without `--dry-run`.
**Config note:** after the first deploy the **target's** `~/.ctrl-b/config.yaml` is the canonical, living copy
(the app rewrites it; you edit it via the settings UI) — re-runs leave it alone unless you pass
`--overwrite-config`.

### B) Manual, on emma
```bash
sudo apt install -y tmux sqlite3 && sudo tailscale set --operator="$USER"   # prereqs
scp config.yaml emma:~/.ctrl-b/config.yaml                    # the secret (first deploy only)
git clone --filter=blob:none --sparse <origin-url> ~/apps/ctrl-b \
  && git -C ~/apps/ctrl-b sparse-checkout set backend frontend deploy       # prod tree (first deploy only)
cd ~/apps/ctrl-b   && CTRLB_HOME=~/.ctrl-b     bash deploy/linux/install.sh prod
bash deploy/linux/serve-https.sh                                    # HTTPS on the tailnet
cd ~/github/ctrl-b && CTRLB_HOME=~/.ctrl-b-dev bash deploy/linux/install.sh dev   # optional sandbox
```

## After install
```bash
systemctl --user status ctrl-b-dashboard          # prod: active (running)
curl -s localhost:5433/api/health                 # {"status":"ok",...}
systemctl --user status ctrl-b-agent@fable ctrl-b-agent@opus   # the two boot agents: active (exited)
tmux attach -t ctrl-b-fable                       # attach an agent (or ctrl-b-opus; Ctrl-b d detaches)
# dev instance — ON-DEMAND, start only when iterating:
systemctl --user start ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web
curl -s localhost:5434/api/health                 # dev backend; UI at http://emma:5173
systemctl --user stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web    # when done
```

## Inference tuning (owner `config.yaml` — D40/D42/D43)
These are optional per-endpoint knobs the owner sets on the local llama.cpp (and cloud) endpoint in
`~/.ctrl-b/config.yaml` (`inference.local` / `inference.cloud`, or a `fallbacks[]` row — same object).
They apply at the next turn (no restart; a settings PUT rebuilds the inference client). None are
required for a working install, but each fixes a real degradation on this box:
- **`max_concurrent_requests: 1`** (Slice 4/D40) — the owner's llama.cpp serves one model with 1–2
  NON-queuing slots, so overlapping turns/subagents/the summarizer would error at llama-server. Set it
  to the real slot count so ctrl-b queues app-side instead.
- **`context_window: <tokens>`** (Slice 6/D42) — the size of the model's usable context, driving the
  fraction-of-window compaction trigger. **For local llama.cpp you can usually leave it blank** — the
  window is auto-probed from `GET /props` (`default_generation_settings.n_ctx`). Set it explicitly to
  override the probe (config wins; upward overrides allowed), and **cloud endpoints MUST set it
  manually** (OpenAI-style APIs expose no window field, so there is nothing to probe). With neither, the
  trigger falls back to the absolute `agent.compaction.threshold_tokens`.
- **Context anchoring needs telemetry flags** (Slice 6/D42) — the anchored context estimator prices
  compaction off the backend's real total-prompt count. It only sees that count when the endpoint
  reports it: `extra_body: { return_progress: true }` on a local llama.cpp (streaming `prompt_progress`;
  already in `config.example.yaml`) / `extra_body: { stream_options: { include_usage: true } }` on
  cloud. Without them the estimator silently falls back to the char/4 heuristic — the server logs a
  one-time `context anchoring inactive …` INFO naming the exact remedy.
- **`reasoning_dialect: <openai|llamacpp|openrouter|none>`** (D45) — which reasoning-control wire shape
  each `inference.*` endpoint speaks. **This is opt-in on an existing install and that is the one thing
  to remember here: `config.example.yaml` is the EXAMPLE, `config.yaml` is the LIVE file** — it is
  gitignored, an upgrade never rewrites it, so an endpoint you configured before D45 keeps the
  back-compat default `openai`. On a llama.cpp endpoint that default makes every agent's
  `reasoning_effort` / `reasoning_tokens` a silent **no-op** (llama-server never reads `reasoning_effort`),
  so add `reasoning_dialect: llamacpp` to your `inference.local` block by hand. The server logs a startup
  **WARNING** naming the endpoint and the exact key to set whenever it sees a default-dialect endpoint
  with a loopback/private/LAN/non-web-port `base_url`. Related: on the `openai` dialect, effort `off` is
  sent as OpenAI's `none` and no longer carries llama.cpp's `chat_template_kwargs`, so an `off` agent on a
  still-default llama.cpp endpoint loses the template lever until you set the dialect.
- **`inference.retry_attempts: <n>`** (Slice 7/D43) — the CHAT-STREAM same-endpoint retry budget for
  genuinely-**transient** failures only (429 / 503 / `Retry-After` / a busy llama.cpp slot). Default **2**:
  a busy-but-alive server is retried in place (a visible `// retrying…` note, backoff 2s×2ⁿ capped 30s, a
  larger `Retry-After` wins) BEFORE hopping to a fallback, keeping the conversation on the same model. A
  dead endpoint (connection-refused/timeout) never matches → straight next-hop as before. Set **`0`** to
  disable retries globally, or override per endpoint with a `retry_attempts:` on that `inference.local` /
  `inference.cloud` / `fallbacks[]` row (unset = inherit, `0` = disable for that endpoint). `complete()`
  (summarizer) and voice keep straight next-hop.
- **Failure-fallback model routing** (Slice 7/D43) — an optional `agent.defaults.routing` block escalates
  to a designated smarter `lead` model after the worker model hard-fails `failure_threshold` turns in a
  row, for `fallback_turns` turns, then returns to the worker (a visible `// lead model…` / `// back to
  the worker model` note each way). Structural triggers only (crash/stall/exhaustion — never wrong
  answers); YAML-only, off by default. See `config.example.yaml` `agent.defaults.routing`. The D18/D40
  endpoint failover chain runs unchanged underneath — routing only picks who is asked FIRST.
- **Disable llama.cpp context-shift so overflow surfaces** (Slice 6/D42 residual) — the reactive
  overflow backstop (force-compact + re-stream on a prompt-too-long error) only fires if llama-server
  actually *returns* the overflow error. With context-shift enabled, llama-server silently truncates the
  oldest tokens instead of erroring, muting the backstop. Recent llama.cpp builds disable context-shift
  by DEFAULT (overflow errors surface — good); on a build/config where it is on, pass
  **`--no-context-shift`** to `llama-server` (older flag name; newer builds use `--context-shift` to
  *enable* it — verify against your build's `llama-server --help`).

## The Claude agent services (development continues ON the box)
The agents are first-class always-on services (owner decisions 2026-07-09 + 2026-07-10): the TEMPLATE
unit **`ctrl-b-agent@.service`** is enabled by `install.sh dev` as **two boot instances** —
`ctrl-b-agent@fable` (tmux **`ctrl-b-fable`**, `claude-fable-5`, effort high) and `ctrl-b-agent@opus`
(tmux **`ctrl-b-opus`**, `claude-opus-4-8`, effort high). Each ensures its tmux session exists, running
`claude --remote-control` in the **workspace** — attach over SSH or drive from claude.ai/code. On boot
the launcher **waits (≤60s) for network connectivity before starting claude** — the remote-control
channel registers at claude startup and does NOT retry, so an early start would come up invisible to
the claude app (post-reboot finding 2026-07-10). Skipped gracefully if the `claude` CLI isn't installed yet.
- **One writer at a time.** Both sessions share the one workspace tree — use one agent per task; a
  genuinely SIMULTANEOUS second writer takes its own worktree (`tools/add-dev-worktree.sh`), same as before.
- **Effort/permission overrides (no edits to tracked files; the model is fixed per instance):**
  `~/.config/ctrl-b/agent.env` (shared, e.g. `EFFORT=medium`) or `agent-fable.env`/`agent-opus.env`
  (per-instance, wins) — then `systemctl --user restart ctrl-b-agent@<i>`.
- Manual/extra sessions: `tools/start-claude.sh [session] [dir] [fable|opus|<model-id>]`.
- Crash-recovery of `claude` is the `while true` loop inside tmux; `systemctl --user restart
  ctrl-b-agent@<i>` recreates that instance's session from scratch (the other instance is untouched —
  KillMode=process + a targeted per-session ExecStop).
- Full names attach directly (`tmux attach -t ctrl-b-fable`); only a *shortened* `-t ctrl-b` is ambiguous
  (prefix of both) — scripts use exact-match `=` for safety.
- **First boot on a fresh workspace clone** (seen on the v1.0.0 deploy): the claude CLI stops at its
  one-time interactive *"Is this a project you trust?"* prompt inside each tmux session — attach and
  confirm once per project; trust persists, so the units/loops never ask again.

## Framework migration (`--claude-env`) — the dev environment, not just the app
Most of the Claude Code dev framework **travels in the repo** (`.agents/skills/`, the `.claude/settings.json`
hooks, `.githooks/`, `CLAUDE.md`/`AGENTS.md`/`docs/`) — it's on the box the moment the workspace clones. The
per-machine remainder is what `bootstrap.py --claude-env` moves:
- **Project memory** → the target's `~/.claude/projects/<slug>/memory` (slug = the workspace path,
  separators → dashes). **Skip-if-present** — after the first migration the target's memory is canonical.
- **User-global `settings.json`** — missing keys are added from the local one (model/effort/permission
  defaults); keys the target already has are never overwritten.
- **NOT copied, by design:** auth/credentials (log `claude` in on the box once — already done on emma),
  session transcripts (memory is their distillate; `docs/HANDOFF.md` re-orients a fresh session), and
  `.claude/settings.local.json` (machine-local permission grants re-accrue naturally).

## Release (promote to production) — the standing END-TO-END procedure
Trunk-based release-by-tag: prod only ever moves by checking out a **new immutable tag** — never by
editing `~/apps/ctrl-b` in place, never from a branch. Every step below is explicit so an agent can
run it cold:

```bash
cd ~/github/ctrl-b                          # 0) always from the workspace (main) — never the prod tree
# 1) PICK the sha — the latest main commit that is VERIFIED: gate green (the pre-push hook ran the
#    full gate; CI is green on that sha) AND eyeballed on the dev instance (start the on-demand pair
#    while testing, stop after). A sha you checked — not "whatever HEAD is now".
git log --oneline -5
gh run list --branch main --limit 1         # CI conclusion for HEAD must be success
# 2) VERSION by semver: incompatible/breaking → vX+1.0.0 · new feature → vX.Y+1.0 · fix-only → vX.Y.Z+1
# 3) TAG + PUSH — the tag push triggers the CI RELEASE GATE (full gate + Playwright e2e on Linux):
git tag -a vX.Y.Z <sha> -m "one-line release notes"
git push origin vX.Y.Z
# 4) WAIT for the release gate — NEVER re-pin on red or pending:
gh run watch $(gh run list --limit 5 --json databaseId,headBranch \
  --jq '[.[]|select(.headBranch=="vX.Y.Z")][0].databaseId') --exit-status
# 5) RE-PIN prod (install.sh = deps → dist built aside → DB snapshot → sub-second stop/swap/start;
#    any pre-cutover failure leaves the running service untouched):
cd ~/apps/ctrl-b && git fetch --tags --quiet && git checkout vX.Y.Z && bash deploy/linux/install.sh prod
# 6) VERIFY — prod is on the tag and healthy:
git -C ~/apps/ctrl-b describe --tags --exact-match    # must print vX.Y.Z
curl -s -m5 localhost:5433/api/health                 # {"status":"ok",...} — its "version" is derived from
                                                      # the git tag at install time (hatch-vcs), so on prod it
                                                      # must equal X.Y.Z; the describe line cross-checks the tree
# then spot-check https://emma.<tailnet>.ts.net on a device. Anything wrong → Rollback (below).
```
**Tags are immutable** — never re-point one; a bad release gets `vX.Y.Z+1` (or roll back). The
workspace is untouched throughout (no checkout, no merge — promotion is a push of a tag).

## Hotfix — worktree at the tag, never a checkout in the workspace
```bash
bash ~/github/ctrl-b/tools/add-dev-worktree.sh hotfix fix/vX.Y.Z+1 vX.Y.Z   # throwaway tree AT the release tag
cd ~/github/ctrl-b-hotfix        # fix → commit → verify (hooks run the gate)
git tag -a vX.Y.Z+1 -m "hotfix: ..." && git push origin fix/vX.Y.Z+1 vX.Y.Z+1   # branch push = CI; tag = release gate
#   → WAIT for the tag's release-gate run to go green (Release step 4) before re-pinning
cd ~/apps/ctrl-b && git fetch --tags && git checkout vX.Y.Z+1 && bash deploy/linux/install.sh prod
# NON-OPTIONAL last step — land the fix on main and PROVE it, then clean up:
cd ~/github/ctrl-b && git cherry-pick <fix-sha> && git push   # (or merge the branch)
git merge-base --is-ancestor <fix-sha-on-main> main && echo "fix is on main ✓"
git worktree remove ~/github/ctrl-b-hotfix && git push origin --delete fix/vX.Y.Z+1
```

## Rollback
```bash
# CODE: pin prod back to the previous tag (rebuilds — needs npm/pip reachable):
cd ~/apps/ctrl-b && git checkout v(prev) && bash deploy/linux/install.sh prod
# DATA (only if the bad release's migrations mangled the DB) — restore the pre-cutover snapshot:
systemctl --user stop ctrl-b-dashboard
rm -f ~/.ctrl-b/ctrlb.db-wal ~/.ctrl-b/ctrlb.db-shm        # stale sidecars MUST go (WAL mismatch = corruption)
gunzip -c ~/.ctrl-b/backups/ctrlb-<ts>.db.gz > ~/.ctrl-b/ctrlb.db
sqlite3 ~/.ctrl-b/ctrlb.db 'PRAGMA integrity_check;'        # must print: ok
systemctl --user start ctrl-b-dashboard
```
Schema compatibility across a rollback is guaranteed by the **expand/contract policy** (D32 amendment):
destructive migrations land at the earliest one release after the code stopped using the old shape.
**First release (v1.0.0) has no previous tag** — rollback there is simply
`systemctl --user disable --now ctrl-b-dashboard` (or fix forward with v1.0.1).

**GitHub down at promote time?** Prod can fetch the tag straight from the workspace over the filesystem:
`git -C ~/apps/ctrl-b fetch ~/github/ctrl-b 'refs/tags/*:refs/tags/*'` — same commit, LAN-only.

## Fresh machine vs. emma (the installer handles both)
The scripts are **portable** — every path resolves against the target user's `$HOME` and the systemd units are
**templates** (`__REPO__`/`__CTRLB_HOME__`/`__NPM__`) that `install.sh` renders to real paths, so this works for
any user/host, not just `emma`.
- **emma (workspace already exists):** just run `bootstrap.py` — the existing `~/github/ctrl-b` stays put
  (fetched + fast-forwarded when clean); prod is cloned fresh at `~/apps/ctrl-b`.
- **clean Linux box (nothing checked out):** just run `bootstrap.py` — it learns the GitHub URL from the local
  checkout and **clones** the prod tree (and the workspace with `--with-dev`).
- **Prereqs on a fresh box:** `bootstrap.py` step 0 installs `git`+`tmux`+`sqlite3`, enables linger, sets the
  tailscale operator (apt/Ubuntu). It does **not** install Python/Node (versions matter) — `install.sh` checks
  for `git` / `python3` ≥3.14 / `node` / `npm` (+ `sqlite3` when there's a DB to snapshot) and **fails loudly
  with the exact install hint** if any is missing. On a non-apt distro, install git+tmux+sqlite3 yourself and
  pass `--no-prereqs`.

## If something fails (debug / finish manually)
Every step is **idempotent** — fix the cause and re-run `bootstrap.py`; completed steps no-op. On failure it
prints where it stopped + an actionable hint. Any pre-cutover failure in `install.sh prod` (build, DB snapshot,
integrity check) leaves the running service **untouched**. To finish by hand on the box:
```bash
systemctl --user status ctrl-b-dashboard                 # is the prod service up?
journalctl --user -u ctrl-b-dashboard -n 50 --no-pager   # why did it fail to start?
curl -s localhost:5433/api/health                        # backend reachable?
cd ~/apps/ctrl-b && CTRLB_HOME=~/.ctrl-b bash deploy/linux/install.sh prod   # re-run install
ls ~/.config/systemd/user/ctrl-b-dashboard.service       # was the unit rendered? (no __REPO__ placeholders)
```
Common causes: missing prereq (install.sh names it), `~/.ctrl-b/config.yaml` absent (SFTP/scp it), user-linger
off (`sudo loginctl enable-linger $USER`), or `tailscale serve` needing the operator
(`sudo tailscale set --operator=$USER`).

## ⚠️ Cautions
- Both instances can **shut down / reboot fleet hosts** (DEV seeds prod's fleet config). Do NOT trigger
  shutdown/reboot actions while testing — DEV is isolated for *data*, not for the real machines it controls.
- Don't modify emma's system/MCP config beyond the prereqs. The DEV backend binds **127.0.0.1**; PROD
  binds **0.0.0.0** (owner waiver 2026-07-10 — direct `http://emma:5433`; SECURITY_MODEL §2.1).
- **Known waiver:** the DEV Vite server listens on **0.0.0.0:5173** (plain HTTP) so the phone can reach it
  over the tailnet — that also makes it LAN-visible. Deliberate for a trusted home LAN; the backends stay
  loopback-only and prod's sole ingress remains Tailscale Serve.
- `~/github/ctrl-b` is the **workspace** — where the agent(s) develop; it stays on `main` (the invariant).
  **PROD (`~/apps/ctrl-b`) is never developed on** — no agent, no commits; it only ever checks out released
  tags. One canonical GitHub `main`.
- `config.yaml` holds SSH/API secrets — 0600, never commit it, never echo it. The target's copy is canonical
  after first deploy (see the `--overwrite-config` note).

## Stop / remove
```bash
systemctl --user disable --now ctrl-b-dashboard ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web \
  ctrl-b-agent@fable ctrl-b-agent@opus
tailscale serve --https=443 off                  # remove the HTTPS proxy
tmux kill-session -t '=ctrl-b-fable'             # stop a session by hand (the units' ExecStop does this too)
```
