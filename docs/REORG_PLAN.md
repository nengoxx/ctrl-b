# REORG_PLAN — repo "face wash" to ship v1.0 (execute in a clean session)

> **Status: ✅ EXECUTED 2026-06-30 (landed as `7503fcf`; verified — see the HANDOFF top block). Kept as
> the spec + verification record.** Originally validated against pre-reorg HEAD `96d0e66`. Authoritative,
> self-contained spec for restructuring the whole repository so the v2 app **is** the repo (= the official
> **v1.0**) and everything legacy is archived. Do it in a dedicated clean session as **one atomic, fully-verified
> commit**, BEFORE the emma deployment (so the deploy is written once against the final paths). Owner approved the
> structure 2026-06-29; the **audit corrections below were approved 2026-06-30**.
>
> **Coordination:** nobody else is working in this repo (no live tandem agent) — refactor freely. The owner's
> live daily driver is a *separate older local copy*, unaffected by anything here.

> ## ⚑ Audit corrections folded in (2026-06-30) — what changed vs the original plan
> A systematic pre-flight audit (whole tree vs the plan) found one false premise, one load-bearing omission, and
> ~10 path/edge-case gaps. All are now baked into the sections below. Summary of the deltas:
> 1. **Filter-repo purge → DEFERRED** (§1). The 142 MB `demo.mp4` is **gitignored and was never committed**;
>    `.git` is only **44 MB**; `node_modules`/`dist` never committed. The purge's premise doesn't exist in
>    history → dropped from this task. Reorg ships as one normal, non-history-rewriting atomic commit.
> 2. **Move manifest expanded + confirmed load-bearing** (§2/§4). `home_path()` (`config.py:67`) reads
>    `config.yaml, ctrlb.db, memories/, skills/, agents/` from `_PROJECT_ROOT` when `CTRLB_HOME` is unset (=
>    corsair/Windows dev). So `agents/ skills/ config.example.yaml .env.example README.md` **must** `git mv` to
>    root, and `config.yaml ctrlb.db* memories/` **must** plain-`mv` to root, or the dev app breaks.
> 3. **Deploy-kit edits enumerated exactly** (§6) — incl. the hardcoded **`WIN_CONFIG`** in `bootstrap.py`, the
>    **sparse-checkout `set dashboard_v2` → `set backend frontend deploy`**, the 3 systemd units (5 spots), and
>    the cross-script refs created by moving `start-claude.sh`/`add-dev-worktree.sh` to `tools/`.
> 4. **Design dedup moves the FULL `prototypes/project/` tree** (§3), not just HTML — the surviving launcher
>    depends on `*.jsx` + image assets. Plus the vapor rename→launcher-reference fix.
> 5. **The §9 "grep → zero" gate was unachievable** and is rewritten with a whitelist (§9) — `external_audit/*`
>    and this plan are **frozen historical records**, never path-rewritten.
> 6. **Windows block stale** (§5): `deploy/windows/` now has 8 files (autostart added `f15feb6`); all move; the
>    launchers are verified reorg-proof (`$PSScriptRoot\..\..`). `git rm assets/demo.mp4` → plain `rm` (untracked).

## 0. Version framing (the single source of truth for wording)
- **v0.1** = the earlier hand-built **Flask** dashboard (root `wol_server/` + its scripts). Never released, unpolished, **superseded + unmaintained** → archived under `archive/v0.1-flask/`.
- **v1.0** = the **new** React+TS+FastAPI app, developed under the working folder name `dashboard_v2/`. That name is **retired**; it ships as **ctrl-b v1.0**. It is a ground-up rewrite, NOT an evolution of v0.1.
- First release tag (at deploy): **`v1.0.0`**.
- Internal dev docs (HANDOFF, DECISIONS D1–D32, etc.) keep saying "v2" as **development history** — add a one-line clarifier at the top of HANDOFF + DECISIONS: *"'v2' is the development name for what ships as ctrl-b v1.0."* Do NOT mass-rewrite "v2"→"v1" in dev docs (lossy + confusing).

## 1. Git history — DECISION: **DEFERRED (filter-repo dropped from this task), 2026-06-30**
The original plan locked "B (filter-repo) to purge the 142 MB `demo.mp4`." **Audit invalidated the premise:**
- `assets/demo.mp4` is **gitignored and was never committed** (`git log --all -- assets/demo.mp4` → empty). It is NOT in history.
- `node_modules`/`dist` were **never committed**. `.git` is **44 MB total**. The largest historical blobs are ~2 MB PNGs (`wol_server/static/*`, prototype heroes) — ~12 MB combined — and those files survive the reorg (they just move to `archive/`/`design/`), so purging only their *historical* copies saves a sliver.
- filter-repo is the single riskiest step (rewrites every commit hash → all clones must re-clone; force-push; the "this workspace IS the rewrite source, don't re-clone it" tightrope). For a 44 MB repo it buys almost nothing.

**→ Decision: DO NOT run filter-repo as part of v1.0.** The reorg is **one normal atomic commit + push** (no history rewrite, no re-clone caveat, no force-push). Existing clones (emma at deploy, the owner's local copy) keep working with a plain `git pull`. *(Optional, much later, never blocking: if the ~10 MB of historical PNGs ever matter, a standalone filter-repo micro-task can purge them — but it is explicitly out of scope for v1.0.)*

**Also deferred here (owner ruling 2026-07-07):** pruning the archived prototypes (`archive/ui-prototypes/*` lockfiles) to permanently clear the 2 dismissed dev-only Dependabot alerts (vite/esbuild in dead prototype lockfiles — dismissed as not-used 2026-07-01). Same bucket as the filter-repo note above: optional housekeeping, never deploy-blocking; pick it up together if/when the archive is ever pruned.

## 2. Target structure
```
ctrl-b/                              # the repo IS v1.0
├── README.md  LICENSE  AGENTS.md  CLAUDE.md       # rewritten for the new layout (§7)
├── .gitignore  .gitattributes                     # merged/updated (§6, §K)
├── .agents/  .claude/                             # Claude tooling/skills — STAY (dotfolders, no clutter)
├── backend/                ← dashboard_v2/backend
├── frontend/               ← dashboard_v2/frontend
├── docs/                   ← dashboard_v2/docs   (this file moves with it → docs/REORG_PLAN.md)
├── agents/                 ← dashboard_v2/agents        (tracked; read from _PROJECT_ROOT on dev)
├── skills/                 ← dashboard_v2/skills        (tracked; ditto)
├── config.example.yaml     ← dashboard_v2/config.example.yaml   (tracked)
├── .env.example            ← dashboard_v2/.env.example          (tracked)
├── config.yaml             ← dashboard_v2/config.yaml   (gitignored — plain mv; see §4 collision)
├── ctrlb.db  ctrlb.db-shm  ctrlb.db-wal           ← dashboard_v2/ctrlb.db*   (gitignored — plain mv; live dev data)
├── memories/               ← dashboard_v2/memories      (gitignored — plain mv; personal data)
├── deploy/                 ← dashboard_v2/deploy, GENERALIZED (§5)
├── design/
│   ├── README.md           (new — explains these are the source design prototypes / visual specs)
│   └── prototypes/         (the FULL prototypes/project tree + the 112 KB vapor — §3)
├── tools/                  ← dev/agent launchers (§5): start-claude.{ps1,cmd,sh}, add-dev-worktree.sh
└── archive/
    ├── v0.1-flask/         ← wol_server/ + root: install.{bat,sh}, start_wol_server.{bat,sh,_headless.sh},
    │                          requirements.txt, config_sample.yaml, prompt_sample.txt, clients_sample,
    │                          ctrl+discord.py, ctrl+telegram.py  + the GITIGNORED v1 files (§4)
    ├── v0.1-inference/     ← inference_server/  (dead WOL-LAN GPU/host scripts — owner confirmed dead)
    └── ui-prototypes/      ← ws_claude/, ws_claude_2/, ws_codex/, ws_codex_2/, start_ws_claude_2.cmd
```
- **`dashboard_v2/README.md`** does NOT survive as-is: its user-facing parts fold into the new root README, its deep agent-subsystem detail stays with the app/docs (§7). **`dashboard_v2/.gitignore`** is merged into the root `.gitignore` then removed (§6/§K).
- **`dashboard_v2/.env`** does **not exist** (only `.env.example`) — §4's ".env if present" is a no-op.
- All legacy dirs are **tracked** (`prototypes/` 51 files, `ctrl-b (Vapor)/` 58, `wol_server/` 19, `inference_server/` 17, `ws_*` 26/31/23/14) → `git mv` works for every one.

## 3. design/prototypes consolidation (dedup — md5-verified 2026-06-29, re-verified 2026-06-30)
- `prototypes/project/` is the canonical Claude-Design export. `ctrl-b (Vapor)/` adds ONLY the unique evolved vapor.
- **Confirmed byte-identical (md5, drop the dupes):** `ctrl-b (Vapor)/variations/{phosphor,observatory}.html` == `prototypes/project/variations/{phosphor,observatory}.html`; and `ctrl-b (Vapor)/variations/vapor-v1.html` == `prototypes/project/variations/vapor.html` (the 42 237 B v1).
- The **evolved `vapor.html` (112 784 B)** in `ctrl-b (Vapor)/variations/` is UNIQUE — it is the **D7 visual spec**.
- **⚠ §3 originally listed only HTML — that orphans real dependencies.** The surviving launcher `prototypes/project/index.html` `src`-references **`android-frame.jsx` + `design-canvas.jsx`** and the `assets/`/`scraps/`/`uploads/` image sets. **So move the WHOLE tree, don't cherry-pick HTML:**
  - **`git mv prototypes/project design/prototypes`** — move the WHOLE dir (NOT `project/*` — a bash glob skips dotfiles and would orphan `.design-canvas.state.json` + `.thumbnail`). This carries `index.html`, `Nebula.html`, `variations/{cosmos,frontier,minimal,observatory,phosphor,vapor}.html`, the two `*.jsx`, `assets/ scraps/ uploads/`, AND the two dotfiles — launcher fully functional. (`prototypes/README.md` → fold into `design/README.md`, then `git rm prototypes/README.md`; the now-empty `prototypes/` disappears.)
  - **Vapor swap (collision-safe ordering):** (1) `git mv design/prototypes/variations/vapor.html design/prototypes/variations/vapor-v1.html` (the 42 KB → history slot); (2) `git mv "ctrl-b (Vapor)/variations/vapor.html" design/prototypes/variations/vapor.html` (the unique **112 KB** D7 spec into the vacated slot — no overwrite). Then `git mv "ctrl-b (Vapor)/chats" design/prototypes/vapor-chats` (design rationale, referenced by `VAPOR_PATTERNS.md`) and `git mv "ctrl-b (Vapor)/index.html" design/prototypes/vapor-preview.html` (the 2 341 B phone-frame preview; repoint its iframe to `variations/vapor.html` = the 112 KB spec).
  - **Launcher-reference fix:** `design/prototypes/index.html` links `variations/vapor.html`, which now resolves to the 112 KB evolved page (it was authored against the 42 KB one). Repoint **that one link** to `variations/vapor-v1.html` so the grid launcher shows the page it was built for. (The 112 KB spec is opened directly / via the preview.)
  - **Then `git rm -r "ctrl-b (Vapor)"`** — drops everything not extracted above: the byte-identical `variations/{phosphor,observatory}.html` dupes, the duplicate `{android-frame.jsx,design-canvas.jsx}` (identical to the prototypes ones already moved), the triplicate `favicon.ico`/`logo.png`, `uploads/`, `.design-canvas.state.json`, `.thumbnail`, and `README.md` (fold a one-paragraph note into `design/README.md` first).
- **Update the doc refs** that point at `ctrl-b (Vapor)/...vapor.html` → `design/prototypes/variations/vapor.html` — see §6 (forward-looking docs only; frozen records left as-is).

## 4. Gitignored files (NOT git mv — physical move + .gitignore fix). ⚠ Secrets — never commit.
At repo root these are gitignored and belong to **v0.1** → physically `mv` into `archive/v0.1-flask/`:
`config.yaml`, `clients`, `command_prompt.txt`, `command_post_prompt.txt`, `system_prompt.txt`, and **delete the root `.venv/`** (v0.1 Flask venv, regenerable — don't archive it).
**⚠ The backend venv is NON-RELOCATABLE** (`dashboard_v2/backend/.venv` bakes absolute paths into `_editable_impl_*.pth`, `pyvenv.cfg`, `activate*`). After `backend/` moves, the editable `import app` breaks. So: **`rm -rf dashboard_v2/backend/.venv` BEFORE the move** (don't drag a broken venv along), then **rebuild it at `backend/.venv` after** (`py -m venv` + `pip install -e .`) — see §8/§9. (`node_modules` rides along and is usually fine — vite resolves relatively — but if `npm run build` fails post-move, `npm ci`.)
**v2's gitignored runtime → physically `mv` to repo root** (so the dev app, which reads `_PROJECT_ROOT` when `CTRLB_HOME` is unset, keeps working): `dashboard_v2/config.yaml`, `dashboard_v2/ctrlb.db` + `ctrlb.db-shm` + `ctrlb.db-wal`, `dashboard_v2/memories/`.
**config.yaml COLLISION (critical ordering):** v2 reads its config at `_PROJECT_ROOT/config.yaml`; after promotion `_PROJECT_ROOT` = repo root. So:
1. FIRST move v0.1's root `config.yaml` → `archive/v0.1-flask/config.yaml`.
2. THEN move v2's `dashboard_v2/config.yaml` → repo-root `config.yaml`.
(Both gitignored; the move is on-disk only.)
Verify the merged root `.gitignore` still ignores all of these at the new paths (§6/§K) — esp. `*.db*`, `memories/`, `config.yaml`. (There is no `dashboard_v2/.env`.)

## 5. deploy/ — GENERAL, multi-target (owner: "not just emma; Windows too; manual startup scripts as well")
Rename the emma-specific folder to OS-based, keep the (already-portable) Linux scripts, add Windows + manual runners.
The orchestrator `bootstrap.py` sits at the `deploy/` root (cross-OS entry); per-OS kits live under `linux/` and `windows/`.
```
deploy/
├── README.md                       # NEW — "pick your target: linux (systemd) | windows | manual"
├── bootstrap.py                    ← dashboard_v2/deploy/emma/bootstrap.py  (remote orchestrator; SSH → Linux target)
├── linux/                          ← dashboard_v2/deploy/emma/  (minus bootstrap.py + the two launchers → tools/)
│   ├── README.md                   ← dashboard_v2/deploy/emma/README.md  (the emma runbook, path-rebased)
│   ├── install.sh                  # [prod|dev] systemd install (paths drop dashboard_v2/)
│   ├── run.sh                      # NEW manual runner [prod|dev], NO systemd (foreground; quick local runs)
│   ├── serve-https.sh              # Tailscale Serve 443→5433  (no path edits needed)
│   ├── migrate-layout.sh           # one-time two-tree setup (Linux)
│   └── systemd/                    # 3 unit TEMPLATES (__REPO__/__CTRLB_HOME__/__NPM__)
└── windows/                       ← dashboard_v2/deploy/windows/  (ALL 8 files — verified reorg-proof)
    ├── README.md
    ├── setup.{ps1,cmd}            #    one-time: backend venv (3.14) + pip install -e + npm ci + npm run build
    ├── start.{ps1,cmd}            #    double-click = PROD :5433; flags: -Dev / -Tailscale / -Build
    └── autostart-{enable,disable}.{ps1,cmd}   #    logon Scheduled Task (added f15feb6) — moves too
    #    Paths are $PSScriptRoot\..\.. relative → reorg-proof (app root has backend/+frontend/ before AND after;
    #    verified in setup.ps1:4-5 + start.ps1:11). autostart-enable.ps1 calls start.ps1 relatively — fine.
    #    NB: these intentionally never use uvicorn --reload (Windows fleet-ping gotcha).
```
Windows launcher spec (already built; no path edits, just moved):
- **Double-click = `.cmd`** wrappers calling the matching `.ps1` with `-ExecutionPolicy Bypass`.
- `start.cmd` (PROD) builds dist if missing then uvicorn `:5433`; `-Dev` adds Vite `:5173`; `-Tailscale` adds Serve.
- All resolve the app root from `$PSScriptRoot\..\..` (= repo root post-reorg), no hardcoded user paths.
**Linux `run.sh`** (NEW) mirrors this for non-systemd users: `run.sh prod` builds + runs uvicorn(+serve); `run.sh dev` runs uvicorn + vite.
**tools/** (repo root) = **DEVELOPMENT tooling, NOT deployment.** The owner drives coding via **Claude Code**, so the launchers are first-class here, for **BOTH** systems, harmonized:
- **`tools/start-claude.ps1` + `tools/start-claude.cmd`** (Windows) ← rename root `start_claude_remote.ps1`/`.cmd`.
- **`tools/start-claude.sh`** (Linux) ← `dashboard_v2/deploy/emma/scripts/start-claude.sh`.
- **`tools/add-dev-worktree.sh`** (Linux) ← `dashboard_v2/deploy/emma/scripts/add-dev-worktree.sh`.
Harmonize all: same defaults (model `claude-opus-4-8`, effort `high`, `bypassPermissions`), overridable via args/env, resolve repo root from the script's own location, header "start a Claude Code coding session on this repo (development, not deployment)."
**Cross-link to update (§6):** `bootstrap.py --start-agent`, `migrate-layout.sh`, `add-dev-worktree.sh`, and `install.sh` all reference `start-claude.sh` at its OLD path — repoint each to `tools/start-claude.sh`.

## 6. Path-reference sweep (systematic — fix every FORWARD-LOOKING ref; leave frozen records)
Run after the moves. **Two classes (see §9 for the gate):** rewrite *live, forward-looking* docs/scripts; **never** rewrite `docs/external_audit/*`, this `REORG_PLAN.md`, or the HANDOFF/DECISIONS/TODO **session-history** blocks (they are records of what was true then).

**6a. Deploy kit — exact edits (highest risk; verified line-by-line at HEAD):**
- **`deploy/bootstrap.py`** (was `deploy/emma/bootstrap.py`):
  - **L42 `WIN_CONFIG = r"...\dashboard_v2\config.yaml"`** → `r"C:\Users\rovax\Documents\github\ctrl-b\config.yaml"` (the source-of-truth + SSH creds — wrong = deploy reads nothing).
  - **L169 `sparse-checkout set dashboard_v2`** → `sparse-checkout set backend frontend deploy`.
  - **Run-strings:** L253/L262 `cd {prod_repo}/dashboard_v2 && bash deploy/emma/scripts/{install.sh,serve-https.sh}` → `cd {prod_repo} && bash deploy/linux/...`; L269 (dev install) → `cd {dev_repo} && bash deploy/linux/install.sh dev`; **L277/L282 `... bash deploy/emma/scripts/start-claude.sh`** → `cd {dev_repo} && bash tools/start-claude.sh`.
  - **Migrate hints L155/L156** `{repo}/dashboard_v2/deploy/emma/scripts/migrate-layout.sh` → `{repo}/deploy/linux/migrate-layout.sh`.
  - Header/usage comments L11/L14/L19/L23-27 (`deploy/emma/bootstrap.py` → `deploy/bootstrap.py`; `dashboard_v2/config.yaml` → `config.yaml`).
- **`deploy/linux/install.sh`** (was `.../emma/scripts/install.sh`): **L24 `V2="$REPO/dashboard_v2"`** → `APP="$REPO"` (and the `$V2` uses on L35/52/65/70/73 → `$APP`); **L25 `DEPLOY="$V2/deploy/emma"`** → `"$REPO/deploy/linux"`; **L26 `UNIT_DIR="$DEPLOY/systemd"`** → unchanged (systemd subdir kept under linux/); **L27 `SCRIPTS="$DEPLOY/scripts"`** → `SCRIPTS="$DEPLOY"` (flattened — the `.sh` ARE in `linux/`); **L112 `$SCRIPTS/serve-https.sh`** → unchanged (now `$DEPLOY/serve-https.sh` ✓); **L116 `$SCRIPTS/start-claude.sh`** → `$REPO/tools/start-claude.sh` (start-claude moved to `tools/`); usage L7; echo hints L85/L86 (`deploy/emma/bootstrap.py`→`deploy/bootstrap.py`, `scp dashboard_v2/config.yaml`→`scp config.yaml`), L113 (`deploy/emma/scripts/install.sh dev`→`deploy/linux/install.sh dev`).
- **`deploy/linux/migrate-layout.sh`**: **L15 `SPARSE=(dashboard_v2)`** → `SPARSE=(backend frontend deploy)`; comments L5/L6/L13-14; echoes L73/L74 (`deploy/emma/scripts/install.sh`→`deploy/linux/install.sh`), **L75 `$DEV/dashboard_v2/deploy/emma/scripts/start-claude.sh`** → `$DEV/tools/start-claude.sh`.
- **`deploy/linux/systemd/*` (3 units, 5 spots):** every `__REPO__/dashboard_v2/backend` → `__REPO__/backend` and `__REPO__/dashboard_v2/frontend` → `__REPO__/frontend` (prod: WorkingDirectory + ExecStart; dev: WorkingDirectory + ExecStart; dev-web: WorkingDirectory). Tidy header comments ("only dashboard_v2 + root docs" → "backend/frontend/deploy + root files").
- **`tools/add-dev-worktree.sh`** (was `.../emma/scripts/`): **L33 `$TREE/dashboard_v2/deploy/emma/scripts/start-claude.sh`** → `$TREE/tools/start-claude.sh`.
- **`deploy/linux/serve-https.sh`, `tools/start-claude.sh`** — no path edits (use `$HOME`/localhost); `start-claude.sh` gets the harmonized header (§5).

**6b. `.gitattributes`:** `dashboard_v2/deploy/emma/** text eol=lf` → two lines:
```
deploy/linux/** text eol=lf
tools/*.sh    text eol=lf
```
The `tools/*.sh` line is **required**: `tools/start-claude.sh` + `tools/add-dev-worktree.sh` are bash run on emma but now live OUTSIDE `deploy/linux/`, so a CRLF working tree would break their shebang without it. (`bootstrap.py` at `deploy/` is Windows-run Python that pipes bash as *strings* over SSH — its own line endings never reach the target as scripts, so it needs no eol rule. The `tools/start-claude.{ps1,cmd}` + `deploy/windows/*` stay CRLF — default.)

**6c. Live docs (forward-looking → fix):**
- `CLAUDE.md` — TL;DR + the whole doc-map table + Environment + improve-the-dashboard section: every `dashboard_v2/docs/…`/`dashboard_v2/backend…` → root-relative; legacy `wol_server`/`install.bat`/`5432` refs reframed as archived. **Keep the Hard-rules block + commit footer.**
- `AGENTS.md` — §2 repo map, §3 run/build, §7 target-arch, §8 gotchas: rebase paths (`backend/ frontend/ docs/ deploy/ design/prototypes/ archive/…`). **Keep §6 security + §9 working-agreement** verbatim (path crumbs only).
- `README.md` (root) — full rewrite (§7).
- `.agents/skills/coding-discipline/SKILL.md:156` (`dashboard_v2/backend/tests/`) → `backend/tests/`.
- Deploy docs `docs/DEPLOY_EMMA.md` + `docs/DECISIONS.md` **D32 block** + `deploy/linux/README.md`: `dashboard_v2/`→root, `deploy/emma`→`deploy/linux` (bootstrap → `deploy/`), `sparse set dashboard_v2`→`set backend frontend deploy`. (Only the **D32 / deploy** parts of DECISIONS — leave the D1–D31 history.)
- `docs/VAPOR_PATTERNS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, the **standing-mandate** block at HANDOFF top: the `ctrl-b (Vapor)/variations/vapor.html` refs → `design/prototypes/variations/vapor.html`. (Leave HANDOFF/DECISIONS session-history mentions.)

**6d. Code spots (verified, don't assume):**
- `backend/app/config.py:42` `_PROJECT_ROOT = parents[2]` — after move = **repo root** (correct: config.yaml/db/skills/agents/memories default there). Only the **comment** on L41 (`-> dashboard_v2/`) to tidy. No other `parents[N]` in `backend/app/`.
- `backend/app/main.py:77` `_FRONTEND_DIST = parents[2]/frontend/dist` → repo-root/frontend/dist = correct. Tidy comment L76.
- `backend/` + `backend/tests/` literal `"dashboard_v2"`: only `__pycache__` binaries (regenerated) + the 2 comments above — nothing functional.
- `frontend/`: vite paths relative; `package.json` name cosmetic. `pyproject.toml` `packages=["app"]` relative — fine.

## 7. README / AGENTS / CLAUDE rewrite
- **Root `README.md`** (currently 100% v0.1 Flask) → rebuild as the **ctrl-b v1.0** README: §0 version framing, the tagline + `![Demo](./assets/demo.gif)`, "what it is" (from `dashboard_v2/README.md` §"What v2 is"), a quickstart (`deploy/windows/start.cmd` · `deploy/linux/run.sh` · `deploy/bootstrap.py`), the structure map, a short security blurb → AGENTS §6. Drop all legacy install.bat/5432/`command_prompt.txt` content.
- **AGENTS.md** — rewrite repo map + run/build for the new root (`backend/`, `frontend/`, `deploy/`, port 5433, uvicorn `app.main:app`); point at `docs/HANDOFF.md`; drop the "active rebuild is dashboard_v2/" framing (v2 IS the repo). **Keep the security model (§6) + working agreement (§9).**
- **CLAUDE.md** — rebase the TL;DR + doc-map table paths (no `dashboard_v2/` prefix); reframe the legacy-server/cutover lines; **keep the Hard rules + footer.**
- **`dashboard_v2/README.md`** — its user-facing intro/run sections fold into the root README (path-rebased); its deep **Agent-subsystem** dive + layout tables move to `docs/` (or an app-level readme), not the user root README.
- Add the one-line "v2 = dev name for v1.0" clarifier atop `docs/HANDOFF.md` and `docs/DECISIONS.md`.

## 8. Execution order (safe sequencing)
1. Branch check: on `main`, clean tree. (No filter-repo step — §1.)
2. Create dirs: `design/`, `tools/`, `archive/{v0.1-flask,v0.1-inference,ui-prototypes}/`. **Delete both venvs NOW** (before any move): `rm -rf .venv dashboard_v2/backend/.venv` — root is v0.1 (dead); backend's is non-relocatable (§4) and is rebuilt in §9.
3. **`git mv` tracked moves** (move whole DIRS, not `dir/*` globs — globs skip dotfiles): from `dashboard_v2/`: `backend frontend docs agents skills deploy` (dirs) + `config.example.yaml .env.example` (files) → root (`dashboard_v2/README.md`/`.gitignore` handled in §7/§8); `prototypes/project` → `design/prototypes` (§3); the Vapor extraction (vapor.html/chats/index.html) per §3; `ws_claude ws_claude_2 ws_codex ws_codex_2 start_ws_claude_2.cmd` → `archive/ui-prototypes/`; `wol_server/` + the 14 root v0.1 files (`install.{bat,sh}`, `start_wol_server.{bat,sh}`, `start_wol_server_headless.sh`, `requirements.txt`, `config_sample.yaml`, `prompt_sample.txt`, `clients_sample`, `ctrl+discord.py`, `ctrl+telegram.py`) → `archive/v0.1-flask/`; `inference_server/` → `archive/v0.1-inference/`; `start_claude_remote.{ps1,cmd}` → `tools/`; `assets/` stays at root (demo.gif). Inside `deploy/`: `git mv emma/bootstrap.py → ../bootstrap.py`, `git mv emma → linux`, then `git mv linux/scripts/{start-claude.sh,add-dev-worktree.sh} ../../tools/` and flatten `linux/scripts/*` → `linux/` + keep `linux/README.md` + `linux/systemd/`.
4. **Gitignored files (§4):** plain `mv` — config.yaml collision order; `ctrlb.db*`, `memories/` → root; v0.1 secrets → archive. (Venvs already deleted in step 2.)
5. `rm assets/demo.mp4` (plain `rm` — it's **untracked**; NOT `git rm`). Keep `demo.gif`.
6. Vapor swap + launcher-reference fix + **`git rm -r "ctrl-b (Vapor)"`** (the teardown — all per §3); write the new `design/README.md`.
7. Path sweep (§6) — deploy kit first (riskiest), then live docs.
8. Rewrite docs (§7); **merge** `dashboard_v2/.gitignore` into root `.gitignore` + repoint `screenshot/` (§K); update `.gitattributes` (§6b). Delete the now-empty `dashboard_v2/`.
9. Verify (§9). 10. One atomic commit + push.

## 9. Verification checklist (must pass before commit)
- [ ] **Rebuild the backend venv first (mandatory — the old one was deleted in §8.2):** `cd backend && py -m venv .venv && .venv/Scripts/python -m pip install -e . --quiet`. Then `.venv/Scripts/python -m pytest -q` → **229 passed** (tests use temp configs).
- [ ] `backend/.venv/Scripts/python.exe deploy/bootstrap.py --dry-run` → exit 0; plan shows `~/github/ctrl-b → ~/.ctrl-b`, **no `dashboard_v2`** in any printed path.
- [ ] `cd frontend && npm run build` → dist builds (proves vite config + paths fine).
- [ ] **Whitelisted** stale-path grep (the old "→ zero everywhere" was impossible — `external_audit/*` + this plan are frozen records). **Exclude deps** (`.venv`/`node_modules` contain unrelated `*.py`/`*.ts`):
      `grep -rn "dashboard_v2" --include='*.md' --include='*.py' --include='*.sh' --include='*.ts' --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=.git . | grep -v 'docs/external_audit/' | grep -v 'docs/REORG_PLAN.md'`
      → the only allowed remaining hits are **dev-doc session-history prose** (HANDOFF/DECISIONS/TODO `[x]`/COSMOS_HANDOFF, and "— dashboard_v2" H1 titles). **Zero** in: `CLAUDE.md`, `AGENTS.md`, `README.md`, **`docs/DEPLOY_EMMA.md`** (forward-looking runbook), `.gitattributes`, `deploy/**`, `tools/**`, `backend/app/**` (except the tidied comments), `.agents/**`, and the D32/standing-mandate spots in DECISIONS/HANDOFF.
- [ ] `grep -rn "ctrl-b (Vapor)"` (excluding `external_audit/` + this plan) → zero in live docs (all → `design/prototypes/…`).
- [ ] `grep -rn "deploy/emma"` (excluding `external_audit/` + this plan) → zero (all → `deploy/linux` / `deploy/`).
- [ ] App boots: from `backend/`, `.venv/Scripts/python -m uvicorn app.main:app` (no `CTRLB_HOME`) finds `config.yaml` + `ctrlb.db` + `skills/` + `agents/` at repo root and serves `frontend/dist`.
- [ ] Secrets still gitignored at new paths: `git status` shows NO `config.yaml`/`clients`/`*_prompt.txt`/`ctrlb.db*`/`memories/`.

## 10. Edge cases & gotchas
- **Spaces in `ctrl-b (Vapor)/`** — quote paths in any shell move.
- **`config.yaml` collision** (§4) — wrong order overwrites v2's config with v0.1's. Move v0.1 out first.
- **Gitignored ≠ git mv** — `config.yaml`, `ctrlb.db*`, `memories/` are untracked; use plain `mv` (they stay untracked at the new path — confirm the merged root `.gitignore` covers them or they'd suddenly be trackable). All *legacy dirs* ARE tracked → `git mv`.
- **`demo.mp4` is untracked** — `git rm` fails; use plain `rm` (it was never committed → not in history; §1).
- **`WIN_CONFIG` is hardcoded** to the absolute Windows path (`bootstrap.py:42`) — must be repointed to the new root `config.yaml`, not just suffix-swept.
- **Launcher ↔ vapor rename** — after promoting the 112 KB vapor into `variations/vapor.html`, repoint the prototypes launcher link to `vapor-v1.html` (§3) so it shows the page it was authored against.
- **Two-class doc policy** — `external_audit/*` carry verbatim absolute `/home/emma/.../dashboard_v2/...` paths from the audit runs; rewriting them falsifies the record. Same for this plan + session-history. The §9 grep MUST whitelist them.
- **Non-relocatable backend venv** — `backend/.venv` hardcodes absolute paths (editable `.pth`, `pyvenv.cfg`, `activate*`); after the move the editable `import app` breaks. Delete it before the move (§8.2) + rebuild after (§9) — DON'T just drag it along. (`node_modules` is soft — rebuild only if `npm run build` fails.)
- **`_PROJECT_ROOT` depth** — correct only because backend stays 2 levels deep (`backend/app/config.py`). If backend layout changes, re-check `parents[2]`.
- **Skills/agents seeding on prod (observation, not a reorg blocker)** — on emma `CTRLB_HOME=~/.ctrl-b`, so the repo's `skills/`/`agents/` are NOT read (and are sparse-excluded, correctly); install.sh doesn't seed them into the data root. Handle in the deploy session if defaults are wanted there — out of scope for the reorg.
- **Deploy session comes AFTER this** — DEPLOY_EMMA/D32/README deploy paths are updated HERE; the deploy session runs migrate-layout + bootstrap against the new paths.

## 11. After the reorg → the deployment session
Once merged + pushed, start the **deployment session** (handoff in `docs/DEPLOY_EMMA.md` + `deploy/README.md`): one-time `migrate-layout.sh` on emma, then `bootstrap.py`, tag `v1.0.0`. All deploy paths are already correct from §6. (No history rewrite → emma can be a plain clone/pull; no re-clone caveat.)
