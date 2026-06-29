# REORG_PLAN — repo "face wash" to ship v1.0 (execute in a clean session)

> **Status: PLANNED · not yet executed.** This is the authoritative, self-contained spec for restructuring the
> whole repository so the v2 app **is** the repo (= the official **v1.0**) and everything legacy is archived.
> Do this in a dedicated clean session, as **one atomic, fully-verified commit**, BEFORE the emma deployment
> (so the deploy is written once against the final paths). Owner approved the structure 2026-06-29.
>
> **Coordination:** nobody else is working in this repo (no live tandem agent) — refactor freely. The owner's
> live daily driver is a *separate older local copy*, unaffected by anything here.

## 0. Version framing (the single source of truth for wording)
- **v0.1** = the earlier hand-built **Flask** dashboard (root `wol_server/` + its scripts). Never released, unpolished, **superseded + unmaintained** → archived under `archive/v0.1-flask/`.
- **v1.0** = the **new** React+TS+FastAPI app, developed under the working folder name `dashboard_v2/`. That name is **retired**; it ships as **ctrl-b v1.0**. It is a ground-up rewrite, NOT an evolution of v0.1.
- First release tag (at deploy): **`v1.0.0`**.
- Internal dev docs (HANDOFF, DECISIONS D1–D32, etc.) keep saying "v2" as **development history** — add a one-line clarifier at the top of HANDOFF + DECISIONS: *"'v2' is the development name for what ships as ctrl-b v1.0."* Do NOT mass-rewrite "v2"→"v1" in dev docs (lossy + confusing).

## 1. Git history — DECISION: **B (filter-repo purge), LOCKED 2026-06-29**
Drop `assets/demo.mp4` (142 MB) + the heaviest dead dirs (the archived prototypes/flask, `node_modules`/`dist`
if ever committed) from history → genuinely small clones, while KEEPING commit messages + the D1–D32 rationale.
Procedure:
1. Do the file MOVES + ref-sweep + doc rewrites as a **normal commit first**; run the §9 verification; push.
2. THEN, as a **separate, clearly-flagged step**: `pip install git-filter-repo`; purge the blobs/paths
   (e.g. `git filter-repo --invert-paths --path assets/demo.mp4 --path-glob '*/node_modules/*'`, plus the
   dead-dir paths under their OLD names since history is by old path); re-add the `origin` remote; **force-push**.
3. **⚠ Re-clone caveat (the cost of B):** the rewrite changes ALL commit hashes, so existing clones CANNOT
   cleanly `git pull` afterward (divergent histories). They must **re-clone** (or `git fetch && git reset --hard
   origin/main`, discarding local). This costs nothing here: emma is re-cloned at deploy anyway, and the owner's
   separate live local copy is never pulled. **Do NOT `git pull` any old clone post-rewrite — re-clone it.**
- **THIS active clone (the Windows workspace) is the EXCEPTION — do NOT re-clone it.** It is where `filter-repo`
  runs, so it BECOMES the rewritten source of truth. `filter-repo` rewrites only TRACKED history — untracked/
  gitignored files (`config.yaml` secrets, `.venv/`, etc.) are left untouched. `filter-repo` drops the `origin`
  remote as a safety measure → `git remote add origin <url>` then `git push --force`. After that this clone ≡ origin.
  Run with `--force` (filter-repo warns on a non-fresh clone). Safety nets: the pre-rewrite normal commit is already
  on origin until the force-push, and filter-repo keeps original refs under `.git/filter-repo/`. (Max-caution
  alternative: rewrite in a throwaway fresh clone, force-push from there, then `git fetch && git reset --hard
  origin/main` here — re-syncs without re-cloning, preserves untracked secrets.)
- (Rejected: A = keeps the 142 MB in every clone; C = squash loses the decision history.)

## 2. Target structure
```
ctrl-b/                              # the repo IS v1.0
├── README.md  LICENSE  AGENTS.md  CLAUDE.md       # rewritten for the new layout (§7)
├── .gitignore  .gitattributes                     # paths updated (§6)
├── .agents/  .claude/                             # Claude tooling/skills — STAY (dotfolders, no clutter)
├── backend/                ← dashboard_v2/backend
├── frontend/               ← dashboard_v2/frontend
├── docs/                   ← dashboard_v2/docs   (this file moves with it → docs/REORG_PLAN.md)
├── config.yaml             ← dashboard_v2/config.yaml   (gitignored; see §4 collision)
├── deploy/                 ← dashboard_v2/deploy, GENERALIZED (§5)
├── design/
│   ├── README.md           (new — explains these are the source design prototypes / visual specs)
│   └── prototypes/         (consolidated + de-duped — §3)
├── tools/                  ← agent/dev launchers (§5): start_claude_remote.{ps1,cmd}, start-claude.sh, add-dev-worktree.sh
└── archive/
    ├── v0.1-flask/         ← wol_server/ + root: install.{bat,sh}, start_wol_server.{bat,sh,_headless.sh},
    │                          requirements.txt, config_sample.yaml, prompt_sample.txt, clients_sample,
    │                          ctrl+discord.py, ctrl+telegram.py  + the GITIGNORED v1 files (§4)
    ├── v0.1-inference/     ← inference_server/  (dead WOL-LAN GPU/host scripts — owner confirmed dead)
    └── ui-prototypes/      ← ws_claude/, ws_claude_2/, ws_codex/, ws_codex_2/, start_ws_claude_2.cmd
```

## 3. design/prototypes consolidation (dedup — md5-verified 2026-06-29)
- `prototypes/project/` is the canonical Claude-Design export. `ctrl-b (Vapor)/` adds ONLY the unique evolved vapor.
- **Confirmed byte-identical** (drop the dupes): `ctrl-b (Vapor)/variations/{phosphor,observatory}.html` == `prototypes/.../{phosphor,observatory}.html`; and `ctrl-b (Vapor)/variations/vapor-v1.html` == `prototypes/.../vapor.html` (the 42 KB v1).
- The **evolved `vapor.html` (112 KB)** in `ctrl-b (Vapor)/variations/` is UNIQUE — it is the **D7 visual spec**.
- **Result** → `design/prototypes/`:
  - `index.html`, `Nebula.html` (from `prototypes/project/`)
  - `variations/`: `cosmos.html`, `frontier.html`, `minimal.html`, `observatory.html`, `phosphor.html` (from prototypes), **`vapor.html` = the 112 KB evolved one** (the spec), and keep the 42 KB as **`vapor-v1.html`** (history).
  - Discard the identical dupes from `ctrl-b (Vapor)/`. Keep `ctrl-b (Vapor)/index.html` only if it differs meaningfully (it's 2.3 KB — likely a launcher; check, else drop).
- **Update the 5 doc refs** that point at `ctrl-b (Vapor)/...vapor.html` → `design/prototypes/variations/vapor.html` (grep: `ctrl-b (Vapor)`). Files include `docs/VAPOR_PATTERNS.md`, `docs/HANDOFF.md`, D7 in `docs/DECISIONS.md`, and 2 more.

## 4. Gitignored files (NOT git mv — physical move + .gitignore fix). ⚠ Secrets — never commit.
At repo root these are gitignored and belong to **v0.1** → physically `mv` into `archive/v0.1-flask/`:
`config.yaml`, `clients`, `command_prompt.txt`, `command_post_prompt.txt`, `system_prompt.txt`, and delete `.venv/` (regenerable).
**config.yaml COLLISION (critical ordering):** v2 reads its config at `_PROJECT_ROOT/config.yaml`; after promotion `_PROJECT_ROOT` = repo root. So:
1. FIRST move v0.1's root `config.yaml` → `archive/v0.1-flask/config.yaml`.
2. THEN move v2's `dashboard_v2/config.yaml` → repo-root `config.yaml`.
(Both gitignored; the move is on-disk only. Same for `dashboard_v2/.env` if present → root `.env`.)
Verify `.gitignore` still ignores them at the new paths (§6).

## 5. deploy/ — GENERAL, multi-target (owner: "not just emma; Windows too; manual startup scripts as well")
Rename the emma-specific folder to OS-based, keep the (already-portable) Linux scripts, add Windows + manual runners.
```
deploy/
├── README.md                       # "pick your target: linux (systemd) | windows | manual"
├── bootstrap.py                    # remote orchestrator (SSH → a Linux target; reads host from config.yaml)
├── linux/
│   ├── install.sh                  # [prod|dev] systemd install (unchanged logic; paths drop dashboard_v2/)
│   ├── run.sh                      # NEW manual runner [prod|dev], NO systemd (foreground; for quick local runs)
│   ├── serve-https.sh              # Tailscale Serve 443→5433
│   ├── migrate-layout.sh           # one-time two-tree setup (Linux)
│   └── systemd/                    # 3 unit TEMPLATES (__REPO__/__CTRLB_HOME__/__NPM__)
└── windows/                       # ✅ BUILT EARLY 2026-06-29 (owner wanted to daily-drive v2 on Windows now).
    ├── README.md                  #    Lives at dashboard_v2/deploy/windows/ now → moves to deploy/windows/ in reorg.
    ├── setup.{ps1,cmd}            #    one-time: backend venv (3.14) + pip install -e + npm ci + npm run build
    └── start.{ps1,cmd}            #    double-click = PROD :5433; flags: -Dev (vite :5173) / -Tailscale / -Build
    #    Paths are $PSScriptRoot\..\.. relative → reorg-proof (app root has backend/+frontend/ before AND after).
    #    NB: these intentionally never use uvicorn --reload (Windows fleet-ping gotcha).
```
Windows launcher spec (Decision 2):
- **Double-click = `.cmd`** wrappers that call the matching `.ps1` with `-ExecutionPolicy Bypass` (so .ps1 runs on double-click).
- `run-dev` = quick dev: starts backend (`uvicorn app.main:app --host 127.0.0.1 --port 5433`, **no --reload on Windows** — documented gotcha) + Vite (`npm run dev`, proxy → 5433). HTTP; for local iteration.
- `run-prod` = `npm run build` then uvicorn serving `dist` on :5433, then `tailscale serve --bg --https=443 5433` (mic works). The "use it" path on Windows.
- All resolve the repo root from the script's own location (`$PSScriptRoot\..\..`), set `CTRLB_HOME` to the repo root (Windows default) or a chosen dir — keep parity with Linux: no hardcoded user paths.
- **Linux `run.sh`** mirrors this: `run.sh prod` builds + runs uvicorn(+serve), `run.sh dev` runs uvicorn + vite — for users who don't want systemd.
**tools/** (repo root) = **DEVELOPMENT tooling, NOT deployment.** The owner primarily drives coding via **Claude
Code**, so the Claude Code launchers are first-class here, for **BOTH** systems, harmonized:
- **`start-claude.ps1` + `start-claude.cmd`** (Windows, double-click) — launch Claude Code on this repo. Rename
  from the existing root `start_claude_remote.ps1`/`.cmd`. Double-click `.cmd` calls the `.ps1` with `-ExecutionPolicy Bypass`.
- **`start-claude.sh`** (Linux) — launch Claude Code in tmux remote-control (the existing `deploy/emma/scripts/start-claude.sh`).
- **`add-dev-worktree.sh`** (Linux) — the parallel-agent dev worktree helper.
Harmonize all three: same defaults (model `claude-opus-4-8`, effort `high`, `bypassPermissions`), overridable via
args/env, resolve the repo root from the script's own location (no hardcoded user/paths), and a header stating
"start a Claude Code coding session on this repo (development, not deployment)." These are general dev launchers
the owner uses to work on the app on either OS — independent of the emma deploy. NOTE the one cross-link: the
deploy's `bootstrap.py --start-agent` invokes the Linux `tools/start-claude.sh` (it doubles as the on-emma dev
agent) — update that path ref (`deploy/emma/scripts/start-claude.sh` → `tools/start-claude.sh`) in §6.

## 6. Path-reference sweep (systematic — leave ZERO stale refs)
Run after the moves; grep the whole tree and fix each:
- `grep -rn "dashboard_v2/"` → docs (7 files), deploy scripts, `.gitattributes` (`dashboard_v2/deploy/emma/**` → `deploy/**`), bootstrap.py (`WIN_CONFIG` → repo-root `config.yaml`; the on-target `{repo}/dashboard_v2/...` → `{repo}/...`).
- `grep -rn "ctrl-b (Vapor)"` → 5 files → `design/prototypes/variations/vapor.html`.
- `grep -rn "deploy/emma"` → README/DEPLOY_EMMA/HANDOFF/DECISIONS/scripts → `deploy/linux` (+ `deploy/` for bootstrap).
- **Deploy scripts specifics:**
  - sparse-checkout: `git sparse-checkout set dashboard_v2` → **`set backend frontend deploy`** (cone mode; excludes archive/design/infra/docs from prod). Update in `migrate-layout.sh` + `bootstrap.py`.
  - unit templates: `__REPO__/dashboard_v2/backend` → `__REPO__/backend`; `__REPO__/dashboard_v2/frontend` → `__REPO__/frontend`.
  - `install.sh`: `V2="$REPO/dashboard_v2"` → use `$REPO` directly (rename var to `APP`/`ROOT`); `DEPLOY="$REPO/deploy"`, units at `$DEPLOY/linux/systemd`.
  - `bootstrap.py`: `REPO_SUB="github/ctrl-b"` unchanged; but on-target app path `{prod_repo}/dashboard_v2` → `{prod_repo}`; `deploy/emma/scripts/install.sh` → `deploy/linux/install.sh`; etc. `WIN_CONFIG` → `...\ctrl-b\config.yaml`.
- **Code spots (verify, don't assume):**
  - `backend/app/config.py`: `_PROJECT_ROOT = Path(__file__).resolve().parents[2]`. After move `backend/app/config.py` → `parents[2]` = **repo root** (was `dashboard_v2`). This is CORRECT (config.yaml/db now default to repo root, where we put v2's config). Confirm no other `parents[N]` elsewhere assumes the old depth.
  - `backend/app/main.py`: `_FRONTEND_DIST = parents[2]/frontend/dist` → repo-root/frontend/dist = correct after frontend moves to root. Verify.
  - Grep `backend/` + `backend/tests/` for literal `"dashboard_v2"` — fix any (tests mostly use temp `CTRLB_CONFIG`, but confirm).
  - `frontend/`: grep for `dashboard_v2` (unlikely; vite paths are relative). `package.json` name field is cosmetic.
  - `pyproject.toml` (`packages = ["app"]` is relative — fine); `.github/` if any CI.

## 7. README / AGENTS / CLAUDE rewrite
- **Root `README.md`** (currently v0.1's) → rewrite as the **ctrl-b v1.0** README: the §0 version framing, a quickstart (run.sh / run-*.cmd / deploy), the structure map, the `demo.gif` (NOT mp4). Merge anything still-useful from `dashboard_v2/README.md`, then that file becomes the app's own README or folds in.
- **AGENTS.md** — rewrite the repo map + run/build commands for the new root (`backend/`, `frontend/`, `deploy/`); point at `docs/HANDOFF.md`. Drop the "active rebuild is dashboard_v2/" framing — v2 IS the repo now. Keep the security model.
- **CLAUDE.md** — update the TL;DR + doc-map paths (no more `dashboard_v2/` prefix); keep the hard rules.
- Add the one-line "v2 = dev name for v1.0" clarifier atop `docs/HANDOFF.md` and `docs/DECISIONS.md`.

## 8. Execution order (safe sequencing)
1. Branch check: on `main`, clean tree. (If doing filter-repo later, that's a separate post-step.)
2. Create dirs: `design/`, `tools/`, `archive/{v0.1-flask,v0.1-inference,ui-prototypes}/`, `infra/` is NOT used (inference is dead → archive).
3. `git mv` tracked moves (backend, frontend, docs, deploy; vapor+prototypes→design; ws_*→archive; wol_server + root v0.1 scripts→archive/v0.1-flask; inference_server→archive/v0.1-inference; start_claude_remote.*→tools; assets→docs/assets).
4. Handle gitignored files (§4) — physical mv, config.yaml collision order.
5. `git rm assets/demo.mp4` (drop the 142 MB; keep demo.gif). [history purge = separate §1-B step]
6. design dedup (§3): drop identical dupes, place the 112 KB vapor as canonical.
7. Path sweep (§6) — every ref.
8. Rewrite docs (§7); update `.gitignore`/`.gitattributes` (§6).
9. Verify (§9). 10. One atomic commit + push. (Then, if §1-B: filter-repo + force-push.)

## 9. Verification checklist (must pass before commit)
- [ ] `cd backend && .venv/Scripts/python -m pytest -q` → **229 passed** (rebuild venv if needed; the move shouldn't break tests — they use temp configs).
- [ ] `python deploy/bootstrap.py --dry-run` → exit 0, plan + paths show `backend/frontend` (no `dashboard_v2`).
- [ ] `cd frontend && npm run build` → dist builds (proves vite config + paths fine).
- [ ] `grep -rn "dashboard_v2" --include='*.md' --include='*.py' --include='*.sh' --include='*.ts' .` → **only** historical-prose hits in dev docs (no path refs), ideally zero.
- [ ] `grep -rn "ctrl-b (Vapor)"` → zero (all → design/).
- [ ] `grep -rn "deploy/emma"` → zero.
- [ ] App boots: `uvicorn app.main:app` from `backend/` finds config at repo-root `config.yaml`, serves `frontend/dist`.
- [ ] Secrets still gitignored at new paths: `git status` shows NO `config.yaml`/`clients`/`*_prompt.txt`.

## 10. Edge cases & gotchas
- **Spaces in `ctrl-b (Vapor)/`** — quote paths in any shell move.
- **`config.yaml` collision** (§4) — wrong order overwrites v2's config with v0.1's. Move v0.1 out first.
- **Gitignored ≠ git mv** — `git mv` fails on untracked/ignored files; use plain `mv` and they stay untracked at the new path (confirm `.gitignore` covers the archive path, or they'd suddenly be trackable).
- **`_PROJECT_ROOT` depth** — only correct because backend stays 2 levels deep (`backend/app/config.py`). If backend layout changes, re-check `parents[2]`.
- **filter-repo is destructive** — only after the normal commit is pushed + verified; force-push; the emma checkout must be re-cloned (fine — deploy clones fresh anyway).
- **demo.mp4 in history** — `git rm` alone does NOT shrink existing clones; only §1-B does.
- **Deploy session comes AFTER this** — DEPLOY_EMMA/D32/README deploy paths are updated HERE; the deploy session then runs migrate-layout + bootstrap against the new paths. Update the deploy docs' `dashboard_v2/`→root + `deploy/emma`→`deploy/linux` as part of §6.

## 11. After the reorg → the deployment session
Once merged + pushed (and history-handled), start the **deployment session** (handoff already in `docs/DEPLOY_EMMA.md` + `deploy/README.md`): one-time `migrate-layout.sh` on emma, then `bootstrap.py`, tag `v1.0.0`. All deploy paths will already be correct from §6.
