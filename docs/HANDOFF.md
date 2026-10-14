# Handoff — start here for a fresh session

> ## ▲▲ READ FIRST — WHO YOU ARE (owner, 2026-07-28)
> **The MAIN model is FABLE on high (`claude-fable-5-1` since 2026-09-23).** It supervises: designs
> the work and the project itself, rules, and audits. **Opus (`claude-opus-5-5`, high) subagents
> carry all the heavy token work** (versions = explicit owner-tested pins, CLAUDE.md) — implementation from
> pinned briefs, research, mechanical + operational tasks including runbook releases. **The Hermes
> Sol lane (`gpt-6.1-sol` high, no profile; the default since 2026-10-09 — the `second-opinion` skill's model table; the Codex CLI `gpt-5.6-sol` when warranted)** remains the standing co-reviewer, launched whenever review is warranted.
> *(This inverts the 2026-07-24 arrangement. The METHOD is unchanged — judgement in the main seat,
> execution in subagents — only the occupants swapped. Mechanics:
> [`second-opinion`](../.claude/skills/second-opinion/SKILL.md); rationale + the build-brief bar: the
> `orchestrate-with-opus-subagents` memory. Match the model to your tmux session at session start:
> `tmux display-message -p '#S'`, and CHECK THE EFFORT — a supervising seat at low effort is the
> failure mode.)*

## Where we are (2026-10-14, session 78 — verified against git, the configs and the running units)

- **Prod** (`~/apps/ctrl-b`, `ctrl-b-dashboard` :5433, https://emma.lobster-vector.ts.net): **`v1.7.11` on `bad0c99`, live since 2026-10-07** — health 1.7.11, DB schema 7, config shape 5. Rollback = `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.10` (safe by tag; `deploy/linux/README.md` §Rollback). Speaches is prod's ear; TTS = `emma-pockettts`. Verify, don't assume: `git -C ~/apps/ctrl-b describe --tags --exact-match` + `curl -s localhost:5433/api/health`.
- **Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173; units up — the owner: keep them up): runs the build of `a304c533`; DB schema 8 (Phase 27's migration 8); `voice.live.debug` ON. The clip door runs on parakeet (`parakeet-live` :9010 · `parakeet-clip` :9011, user units); the live leg stays on Speaches until S7b. Serve `:8443` fronts the dev backend (built dist).
- **`main`** = `origin/main` = `9f405de2` at session 78's start (ALL PUSHED; `git log --oneline v1.7.11..main` = 118 commits, none on prod yet) + session 78's docs commits. The branches `phase27` · `iss-batch-A/B/C` · `s11-c-device` · `alt-fleet` are all ancestors of `main`; no worktrees remain.
- **Phase 27 — conversations per agent** (D84, [`CONVERSATIONS_PLAN.md`](./CONVERSATIONS_PLAN.md)): the code is COMPLETE — S0–S10 + S10-C01 built on `phase27`, the single merge `cecc66f5`, S11 (the owner's device round) done, its (c) micro-wave `a304c533`. **S12, the docs close-out, = session 78.** S13 = the release (v1.7.12).
- **Phase 26 — the ASR track** (D82, [`ASR_PLAN.md`](./ASR_PLAN.md)): session A shipped in v1.7.11; session B so far = S6-i `1c63ce72` · S6-ii `64021d8f` · S9 `76f5db5e` (+ the bake-off's no-owner-audio rows `9a04b175`) · S7a `f44025f1`, and a 21-clip corpus. NEXT = TUNE (LEFT §2 below). v1.7.12 = after the ASR session B (TUNE → the S9 gate's owner-audio rows → S7b → S8 → S8b → S10); J3/J4 — like every J session — are their own sessions, not a gate (owner, 2026-10-09 `af198bc9`). D85 = designed, nothing built (v1.7.13).
- **The chat chain** (dev + prod config, verified 2026-10-14): primary `strata` (corsair :18081), named `qwen3.8-flash-next-iq3_s` · fallback #1 `corsair` / `qwen3.6`. corsair :18081 actually serves `qwen3.8-flash-next-bartowski-iq4_xs` — a deliberate name drift while the owner tests models (LEFT §7).
- **The owner's standing rulings:** strata stays the main backend · never use `gpt-6-astra` (expensive, not good; session 77) · the weekly usage reset is TUESDAY — read both caps at session start · stay on 1.7.x; 1.8 is reserved for the final ROADMAP + ISSUES cleanup wave (2026-08-24) · Phase 19 goes LAST (2026-08-29).
- **This file:** the state above → session 78 → **What is DONE / what is LEFT** (the one list) → the session-history pointers → the standing notes. Every older session block is verbatim in [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) ("the Nth session" resolves there).

## Session 78 (2026-10-14) — the documentation reconciliation

**Pass 1 — the status reconciliation (the owner's checklist from session 77's close):** four Opus lanes on disjoint files (HANDOFF + archive · the Phase 27 S12 close-out in CONVERSATIONS_PLAN/DECISIONS/ROADMAP/TODO · every other stamp + the QUALITY counts re-measured · ISSUES row by row + its new index), every claim verified against git/code; the main seat ruled 23 flagged items (`~/.cache/tmp/ctrlb-session78/RULINGS.md`); one blind Opus consistency read → SHIP WITH FIXES, applied. Notable rulings: **v1.7.12 is NOT gated by J3/J4** (`af198bc9`, 2026-10-09 — the later "waits for J3 + J4" lines were carry-over) · ISS-49/51/52 were fixed in sessions 57/63 (Phase 27 superseded/moved parts; ISS-50 is the one Phase 27 fixed) · ISS-18/31/32 = shipped, closing round never recorded (owner confirm owed) · the standing co-reviewer is the Hermes Sol lane `gpt-6.1-sol` (the Codex CLI `gpt-5.6-sol` when warranted) · the `phase27` worktree removed. **Pass 2 — the functional documentation audit** (the owner, mid-session: "the parts that describe the functionality and use of the project — no nuances or edge cases left out"): four READ-ONLY Opus audit lanes inventoried **643 items FROM THE CODE** (F1 fleet/actions/privilege 92 · F2 the agent chat 151 · F3 voice 101 · F4 config/media/themes/ops 299) and graded each against the docs: **238 documented · 254 partial · 80 missing · 70 wrong** (`~/.cache/tmp/ctrlb-session78/audit-F1..F4-report.md` — the inventory tables + ranked gaps with paste-ready drafts). Research **R104** (peer projects' user-guide conventions) → the ruling **D86: the user guide lives apart, `docs/user-guide/` one page per surface, README = the front door** (RULINGS.md "PASS 2"). Six write lanes (W1–W6, disjoint files) then wrote the guide (13 pages), the hand-written configuration reference + the `config.example.yaml` corrections, the README/AGENTS/CLAUDE rewrites, D86, **ISS-87…97** (eleven CODE/SECURITY defects the audit found — see the ISSUES index), and the design/ops docs' wrong claims fixed in place. **Committed as WRITTEN, NOT YET VERIFIED** (14 guide pages + the reference ≈ the largest docs delta of the project; the usage cap — 76% when the cut was planned — leaves the verification round to the next session; see ▶▶▶ above). Mechanical checks done at the close: every link + anchor across the 14 pages, README, AGENTS and CLAUDE resolves; no file carries the audit's disproven claims; `config.example.yaml` + `.env.example` validate against the model in a scratch home.

## ▶▶▶ NEXT SESSION — FIRST: verify pass 2's user guide, then the owner's decisions (2026-10-14, session 78's cut at the usage cap)

**State:** `main` = pass 1 `14a6ce8d` (the reconciliation, blind-read SHIP WITH FIXES applied) + the pass-2 commit (the guide + fixes, **UNVERIFIED** — written by six Opus lanes from the code, each lane's `lane-W<n>-report.md` lists what it could NOT verify and left out). Session dir `~/.cache/tmp/ctrlb-session78/`: `SESSION_PLAN.md` (the lane tables) · `RULINGS.md` (every ruling, both passes) · `COMMON*.md` + `brief-*.md` · `audit-F1..F4-report.md` (THE CHECKLIST: the 643-row inventories) · `lane-W1..W6-report.md` · `review-final-opus.md` (pass 1's read) · `docs/research/R104`.
1. **The verification round** (not done): for each subsystem, a fresh Opus lane (or the F-lane's inventory re-read) checks `docs/user-guide/<pages>` + the README against `audit-F<n>-report.md`'s inventory table — every row DOCUMENTED now? every statement true of the code? — then fix waves to the W lanes' files, then ONE blind consistency read of README + the guide index + the reference (links resolve, anchors exist, the page template held, no plan jargon), then a `check-all` (prettier touches markdown? — it did not in pass 1; the pre-commit gate ran green).
2. **Owner decisions owed:** (a) the config **drift test** (a pytest walking `Config`'s fields vs `config.example.yaml` + the reference — R104's peer practice; yes/no); (b) **ISS-87** `run_shell` at FULL privilege ignores `shell.agent_exec_enabled` — make the toggle a hard gate (recommended) or keep + document; (c) **ISS-88** the generic action API ignores `ui_exposed` — honour it or accept; (d) **ISS-90** `update.sh`'s wrong rollback advice after a config migration — a release-path bug, fix before v1.7.12; (e) ISS-91…97 (inert `server.host/port` · restart-only knobs without a marker · the backup prune deleting manual snapshots · bootstrap re-run skipping checks · inert `autostart`/`tags` · the unused embeddings client · stale code comments) — each its own small slice, the owner orders them; (f) ISS-18/31/32 — shipped, the closing round never recorded: confirm or reopen; (g) the ops notes outside the repo: `~/.config/systemd/user/claude-workspace.service` pins `claude-opus-5-5` for the workspace seat (intended?); the dev units are boot-enabled on emma against `install.sh`'s on-demand intent (`systemctl --user disable ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web` if not intended).
3. **The write lanes' recorded leftovers (each in its `lane-W<n>-report.md` UNRESOLVED; nothing silently dropped):** statements left OUT of the pages because the lane could not prove them in the code — W1: the DST rule for a skipped slot · two call-screen notes that may exist only with the new ear · one wake/monitor detail; W2: the phone's Enter-key behaviour · the retry confirm's full scope; W3: five voice claims (listed); W4: parakeet ignoring `stt.language` · the Conf group names · the clip-retry status codes · two inferred "next chat turn" rows; W6: PocketTTS's bind address · a device-behaviours section. Sections the audits graded MISSING that no lane wrote (design docs, not the guide): DESIGN §9.2's settings-API contract · a scripts reference · a logs section · THEME_ENGINE's theme catalog. The **254 PARTIAL rows** were addressed only where a top gap or a page covered them — the verify round walks them row by row. Outside every lane: `.claude/settings.json`'s deploy hook text ("code default loopback" — the bind is the uvicorn CLI, ISS-91; Playwright needs Firefox too, not only Chromium). Audit rows proven WRONG by the write lanes (do not re-apply them): F2's `reconcile_interval_s` "restart" (it is live, `main.py:151-163`) · F2 gap 15 "open-terminal asks under readonly" (blocked: `terminal.py:224,269`) · F3's "trails hold no transcript" (true only for clip uploads, `call_trail.py:217`) · the example's "under BOTH floors" (either floor).
4. Then the LEFT list below resumes at §1/§2 (the owner's device checks · the ASR track = TUNE).

## What is DONE / what is LEFT (the ONE authoritative list — verified 2026-10-14 against `git log v1.7.11..main` and the code)

### DONE since v1.7.11 — on `main`, not yet on prod (it ships as v1.7.12)
- **Phase 27, conversations per agent (D84) — code complete.** S0 `7a94d05c` (docs) · S1 `dd716796` (migration 8, `threads.seen_at`) · S2a `5bb07e1e` · S2b `315687ad` · S3 `7ef86905` (the `thread` frame) · S4 `3926c3e2` (ISS-50, the `Name:` fold) · S5 `d7f9370d` (`auto_rotate` retired) · S6 `edd88661` (the swap kernel) · S7a `881ae7d1` · S7b `b426f147` · S8 `1428e682` · S9a `b8a92e55` · S9b `7d547d1c` · S10 `696811ba` · S10-C01 `2501d941` → the single merge `cecc66f5` → S11, the owner's device round (dev, 2026-10-10 → 10-14) → (c) `a304c533` (a reply carries the device that asked for it). Detail: CONVERSATIONS_PLAN §10 + §13.
- **The ISS batches** (each ISSUES row carries its as-built): ISS-28's macro hint `48c7d1e0` · ISS-69 `c759011c` (`turn_hold_ms` 2500) · ISS-70 `7f70e929` · ISS-83 `93e09876` · ISS-84 `8f4893d2` · ISS-73 ① `072b6145` · ISS-74 `91819ea8` · ISS-76 `7dbffddb` · ISS-80 `7a93d54a` — merged as `d2ca8e94` + `e6277dbf` · ISS-75/77/78/79 (merged `89965c45`) · ISS-79 re-built `43abc473` · ISS-81 `9014173a` · ISS-71 `618dcb7a`. Owner-verified on dev: ISS-74…81 + ISS-83; ISS-73 ① (short hides) + ③ PASS, ② kept as is.
- **Phase 26 session B pieces:** S6-i `1c63ce72` (the VAD engine behind one model boundary) · S6-ii `64021d8f` (receipt stamping, raw capture, the replay + corpus tools) · S9 `76f5db5e` (the clip door on parakeet; the engines runbook `5ce05360`) · the S9 bake-off's no-owner-audio rows `9a04b175` (ASR_PLAN §6.4.1) · S7a `f44025f1` (the client half of the new wire, inert until the flip) · the corpus = the 2026-10-09 baseline + 20 clips promoted 2026-10-14 = 21 in `~/.ctrl-b-dev/asr-corpus/raw/`.
- **Chain / config / deps ops** (config, not code — the docs commits record them): the Qwen alias `qwen3.6-max` → `qwen3.6` on dev + prod (session 75, `94590b31`) · the chat chain flipped to strata-primary on dev + prod (session 76, `6b5d10ea`), strata's model renamed to `iq3_s` (`d007e18e`) · the Dependabot sweep `69c707df` · `7c5ba5e3` · `e92da698`.
- **Worktrees:** `ctrlb-wt-{A,B,C}` removed in session 77; `ctrlb-wt27` removed in session 78 (every tip an ancestor of `main`; the branches stay).

### LEFT — in the owner's order
1. **The owner's owed checks (phone / dev, as they use it):** ISS-71 — fling up, tap ↓ while the chat coasts → the first tap jumps · S11-(c) — two phones on one conversation, B LOCKED, send from A, unlock B while the reply streams → B shows it SILENT; your own turn after closing + reopening the app → still spoken (CONVERSATIONS_PLAN §13, S10's (c) paragraph) · ISS-73 ① — a LOCKED hide and one past ~60 s · a long locked call · ISS-84 — airplane mode mid-"sending" (past ~90 s → Retry/Discard; a reload while parked) · ISS-50 — switch agents mid-conversation · the closing rounds never recorded: ISS-18 · ISS-31 · ISS-32 (shipped; the owner's confirm owed — their ISSUES rows).
2. **The ASR track** (Phase 26 session B, ASR_PLAN §7.2): TUNE (the owner's captures + the 21-clip corpus) → the S9 gate's owner-audio rows (§6.4) → **S7b, THE FLIP** (the live leg leaves Speaches) → S8 → S8b → S10 → **v1.7.12** (session B + Phase 27; `deploy/linux/README.md` §Release + ASR_PLAN §8.2). **Not gated by J3/J4** (owner, 2026-10-09 `af198bc9`; the later handoffs' "waits for J3 + J4 per the owner" was carry-over — main seat, session 78).
3. **The design sessions — stubs, nothing designed, each its OWN session, none gates a release** (ROADMAP §J): J1 the galleries' UX ([`GALLERY_UX_PLAN.md`](./GALLERY_UX_PLAN.md); H4 rides it) · J2 config de-bloat ([`CONFIG_DEBLOAT_PLAN.md`](./CONFIG_DEBLOAT_PLAN.md)) · J3 prompt order ([`PROMPT_ORDER_PLAN.md`](./PROMPT_ORDER_PLAN.md)) · J4 lorebook probability + cadence ([`LOREBOOK_PROBABILITY_PLAN.md`](./LOREBOOK_PROBABILITY_PLAN.md); ISS-45/46) · J5 the call screen's UI (after the ASR session) · J6 the defaults revision · J7 the prompt inspector.
4. **The refinement batch + the open re-rulings:** ISS-72 (the conversations sheet's look) · ISS-82 (the conversations button scrolls away) · ISS-85 (the agents tab's button hierarchy) · ISS-86 (Conf fonts: capitals + numerals too tall) · ISS-50's later think (should an agent know a switch happened?) · ISS-73 ② (a background dictation — a possible future refinement only) · the ⑤ responder-inheritance split (CONVERSATIONS_PLAN §12.2 ⑤) + the six ⚑ defaults (§12.3) — open to re-rule after S11 · the session-52 markdown residual: the renderer's per-line `em` rule (`frontend/src/lib/markdown.tsx:23`) has no boundary guard, so a glued `Hello*She walks*` italicizes on screen but is spoken (fix: pass the previous character to the rule; fold into the next markdown touch).
5. **D85, the owner-voice discriminator** (ASR_PLAN §3.12 + §7.3) — ruled + council-closed 2026-10-06, nothing built; after session B → v1.7.13.
6. **Phase 19, the hardening pass — LAST** ([`HARDENING_PLAN.md`](./HARDENING_PLAN.md); rides the 1.8 endgame; never lead a menu with its §10 owner court; the F13 eslint backlog + CM-1 fold into it).
7. **Loose ends:** the strata model-name drift (config `qwen3.8-flash-next-iq3_s`, corsair serves `qwen3.8-flash-next-bartowski-iq4_xs`; deliberate while the owner tests models; rename with `~/.cache/tmp/ctrlb-session76/rename_strata.py` once they settle) · the dev `/api/health` version string (`1.7.12.dev14+g53172b547.d20261008`, stale package metadata; cosmetic) · dev's `/api/health` reports `server.port` 5433 (the config default; the unit binds :5434 — cosmetic).
8. **Riding regular use, or unscheduled (no session owed):** the standing ledger's owner-court items ① ② ④ ⑥ (below; ask, don't assume) · every other open [`ISSUES.md`](./ISSUES.md) row (the ledger; each RECORDED / WATCH / DORMANT row names its reopen condition) · Phase 23 S7's remainder (TODO) · Core Memory's live drive (CORE_MEMORY_PLAN §14b; ships OFF) · Phase 18: the owner has not yet edited a prompt for real in Conf · the unscheduled features with seams = [`ROADMAP.md`](./ROADMAP.md) (A1 · A4 · A5 · A12 · A13 · B1 · C1 · C2 · D2/D3 · F1 · E1/E2 · G); §P = owner-ruled-out ideas, never re-propose. Anything new: HANDOFF → ROADMAP → DECISIONS → DESIGN/ARCHITECTURE → TODO (CLAUDE.md's flow), a D-entry before code.

## Session history (archived — verbatim in [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md), swept 2026-10-14)
- Session 77 (2026-10-14) — session 76's audit closed · ISS-79 re-built `43abc473` · ISS-81 `9014173a` · ISS-74…81 owner-verified · the owner's device round (ISS-73 ① ③ PASS, ② kept as is) · 20 ASR clips promoted · ISS-71 `618dcb7a` · S11-(c) `a304c533` · ISS-85/86 logged; pushed `9f405de2` → HANDOFF_ARCHIVE.md (with the 2026-10-14 "Where we are" head + the reconciliation checklist)
- Session 76 (2026-10-12 evening) — ISS-73 ① `072b6145` · ISS-74…80 fixed + merged (`d2ca8e94` · `e6277dbf` · `89965c45`) · the chat chain flipped to strata on dev + prod · the corsair/strata campaign → the vault → HANDOFF_ARCHIVE.md
- Session 75 (2026-10-12) — the Qwen alias rename on dev + prod · the owner's clip trails read · ISS-82 · ISS-83 `93e09876` + ISS-84 `8f4893d2` built → HANDOFF_ARCHIVE.md
- Session 74 (2026-10-10) — no block of its own: the docs-only intake of ISS-74…81 + ROADMAP J7 (`06c02e36`)
- Session 73 (2026-10-10) — Phase 27 S10-C01 `2501d941` closed · the single merge `cecc66f5` · NEXT = S11 → HANDOFF_ARCHIVE.md
- Session 72 (2026-10-10) — Phase 27 S9a `b8a92e55` · S9b `7d547d1c` · S10 `696811ba` on `phase27` · S10-C01 recorded → HANDOFF_ARCHIVE.md
- Session 71 (2026-10-09 → 10) — Phase 27 S7a `881ae7d1` · S7b `b426f147` · S8 `1428e682` on `phase27` → HANDOFF_ARCHIVE.md
- Session 70 (2026-10-09 evening) — Phase 27 S2b `315687ad` · S3 `7ef86905` · S4 `3926c3e2` · S5 `d7f9370d` · S6 `edd88661` · the six ⚑ + ⑤ ruled → HANDOFF_ARCHIVE.md
- Session 69 (2026-10-09) — Phase 27's build started: the completeness pass → plan v2.8 · S0 `7a94d05c` · S1 `dd716796` · S2a `5bb07e1e` → HANDOFF_ARCHIVE.md
- Session 68 (2026-10-09) — the 11-min home call = the corpus baseline · ISS-70 `7f70e929` · ISS-69 `c759011c` · the Phase 27 pre-build audit · J3 + J4 re-ruled (`af198bc9`) → HANDOFF_ARCHIVE.md
- Session 67 (2026-10-08/09) — read-only: the first captures read (the clip door on parakeet PASSED) · ISS-69 design-ruled · J5 recorded → HANDOFF_ARCHIVE.md
- Session 66 (2026-10-08) — the three calls ruled · the Dependabot sweep (`69c707df` · `7c5ba5e3` · `e92da698`) · all pushed → HANDOFF_ARCHIVE.md
- Session 65 (2026-10-07 night) — the S9 bake-off rows `9a04b175` · S7a `f44025f1` built + merged → HANDOFF_ARCHIVE.md
- Session 64 (2026-10-07) — session B: S6-i `1c63ce72` · S6-ii `64021d8f` · S9 `76f5db5e` + the parakeet engines merged; cut by the usage limit → HANDOFF_ARCHIVE.md
- Session 63 (2026-10-07 midday) — the dictation check PASSED · ISS-68 the gallery flash `7b13b85a` + the consistency slice `187f56ae` · ROADMAP H4 + J1/J2 · NEXT = v1.7.11 (`bad0c99`) → HANDOFF_ARCHIVE.md
- Session 62 (2026-10-06 evening, the parallel non-ASR session) — ISS-37 · ISS-12 · ISS-67 · ISS-47 · ISS-53 · ISS-28 built (merges `a3143eef` · `16072eed`) → HANDOFF_ARCHIVE.md
- Session 61 (2026-10-06 evening) — F2/ON4 ruled `d776e11a` · R101 `51c458fd` + R102 `1a45f223` · ISS-66 `a22ba68c` · D85 designed + council-closed → HANDOFF_ARCHIVE.md
- Session 60 (2026-10-06) — the owner's three calls read (ISS-58…63) · D8 `dab7e30d` · ISS-61 `634debc2` · D5 `8764c727` (session A's code complete) · D84 / Phase 27 designed `b5ed9f20` → HANDOFF_ARCHIVE.md
- Session 59 (2026-10-05) — no block of its own: D83 fail-fast `890d0419` + `8f4c638e`
- Session 58 (2026-10-02/03) — the card read · R99 · ISS-54 `403c1026` · D9 `91c56692` · ISS-55 `a0ba1d0c` → HANDOFF_ARCHIVE.md
- Session 57 (2026-10-01) — no block of its own: the ISS-49 re-seat `0a19c136`
- Session 56 (2026-10-01) — Phase 26 K6 `96fdc4e4` → HANDOFF_ARCHIVE.md
- Session 55 (2026-10-01) — Phase 26 S2 `ad94796c` · S3 ruled absorbed `db742d6d` · SP `cd2cb02d` → HANDOFF_ARCHIVE.md
- Session 54 (2026-10-01) — R98 `66ead3ad` · the VAD-model boundary (ASR_PLAN §3.4.1) · Phase 26 S1 `6e87f308` → HANDOFF_ARCHIVE.md
- Session 53 (2026-09-30) — polish #6 `e249f128` · ASR_PLAN designed + council-closed `13353b75` · the design agenda walked → HANDOFF_ARCHIVE.md
- Session 52 (2026-09-30) — the five polish items `53f8010f` · `7522040b` · `c09d47bc` · `31953a94` · `23fd88af` + the R94/R95 docs `c1c8badd` → HANDOFF_ARCHIVE.md
- Session 51 (2026-09-29) — no block of its own: the read-only owner polish audit (built by session 52)
- The R94 block (2026-09-28, Opus 5.5 seat) — the R94 live-voice verification (committed `c1c8badd`) → HANDOFF_ARCHIVE.md
- Session 50 (2026-09-27) — the vault backlog `b4eb0356` · `f739c3a6` · `a2f8cc5d` · D81 `a0d8e8c5` → v1.7.10 @ `9c5a6c6f` → HANDOFF_ARCHIVE.md
- The standing "▶▶ NEXT SESSIONS — the roadmap" section (v1.7.10-era; superseded by the DONE / LEFT list above) and the "▶ Phase 27 DESIGNED" pointer → HANDOFF_ARCHIVE.md
- Sessions ≤ 49 (2026-05-28 → 2026-09-27) → HANDOFF_ARCHIVE.md

## Standing operating notes (durable gotchas — verified across sessions 30–50)
- **Method:** Fable main seat designs/rules/audits; pinned-Opus lanes build from written briefs (ONE
  lane, fix waves by `SendMessage` to the SAME lane, context intact; or two lanes on DISJOINT files
  with the API contract written into both briefs); lanes must NOT `git stash` on the shared tree.
  Every build gets a blind code round; every fix wave its own confirm. **Critical parts get BOTH
  reviewers in parallel on the SAME diff (owner, 2026-09-26): a blind Opus 5.5 subagent as the
  independent reviewer AND Maya/Emma as the non-Claude fresh lens — never partitioned; the S9 round
  proved it (Opus's MED was a design gap Maya ×3 missed).** The non-Claude lens is the Hermes lane
  run with NO profile (`-m <model> --ignore-rules -t file,terminal -z …`, self-contained; `-z` keeps no
  session so `--resume` is dead): **Sol `gpt-6.1-sol` high** for a critical review, **Luna `gpt-6-luna`
  max** for a general audit, the older 5.6 models only when warranted (owner, 2026-10-09 — the
  `second-opinion` skill's "THE HERMES REVIEW MODELS", `0fd35027`); the local Qwen on `strata` is the
  optional third lane (`b8bcbf90`, `bad1ad8f`). When killing a hermes run, filter on `venv/bin/python` — a bare
  `pkill -f hermes` hits your own wrapper shell; a `-z` monitor loop MUST have a timeout. **Killing a
  hermes python from the Bash tool has propagated exit 144 to the tool shell (twice, session 50)** — kill
  in a separate command with nothing after it, or leave the run and discard its output.
- **Freezing a diff for review: build the file list EXPLICITLY and `wc -l` it before launching the
  reviewers** — an empty `$(cat list)` makes `git diff --` dump the WHOLE tree (burned on B-FE, session
  50; a bad path map burned V1). Append new files with `git diff --no-index /dev/null <file>`; the
  building lane's report lists EVERY changed file and the freeze is taken from that list.
- **Gates:** `backend/.venv/bin/python tools/check.py` (`--fast` = pre-commit; full = pre-push, ~4–6
  min; `--e2e` adds Playwright, ~3 min). Run the local gate, a main push and a tag push SERIALLY —
  the 6-parallel legs flake under contention. `/tmp` is RAM: heavy runs with
  `TMPDIR=/home/emma/.cache/tmp/<fresh>`; check `ls -f ~/.cache/tmp | wc -l` is small (pytest fails
  to create its numbered dirs past a few hundred k entries). Local pre-push runs NO e2e — only CI
  does; before a tag, run `--e2e` locally (Playwright `name:` is a SUBSTRING match — sweep labels).
- **Release:** `deploy/linux/README.md` §Release end-to-end (CI green on the tip → annotated tag →
  the CI release gate → `update.sh vX.Y.Z` → `describe --exact-match` + health + the PNG check).
  **Config backup FIRST whenever the release carries a migration** (`app/config_migration/VERSION`);
  dry-run on a copy with `CTRLB_HOME=<copy> python -m app.config_migration --check`. `gh run watch
  <id> --exit-status --interval 30` in a background task is the clean wait. Tags are immutable.
- **Dev:** `systemctl --user start/stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web` around
  iteration — never spawn duplicate servers. Serve `:8443` → the dev backend `:5434` (built dist);
  Vite `:5173` is the HMR alternative. Settings PUT is a deep-merge (partial), except the
  router-owned maps (`providers` replaced whole; `roleplay.personas` refused 422).
- **Voice-path rules (LIVE_VOICE_PLAN):** measure first (the D77 trail), never guess a feel verdict;
  the state-ownership + audio-thread-ordering rules and the tail-wait theorem are in the plan's §7
  blocks and the `live-voice-design-2026-09-11` memory.
- **Owner cadence:** afternoons = live iteration at the computer; mornings = autonomous work. A long
  build/review stretch ENDS with the handoff + an owner test card + a CLOSED session; the owner tests
  and reports in a CLEAN session.

## Standing ledger (verified 2026-09-26; ask, don't assume)

**Owner-court items:**
- **Session 50's open questions (2026-09-27):** ① **Live dictation is ON in prod**
  (`voice.live.dictation: true`, your own flip — you believed it off): intended? Default = leave it ON
  (Conf › Voice · STT › "Live dictation"); prod still reads `dictation: true` (verified 2026-10-14).
  ② **The A/B/C car-dictation arms** — run them ONLY if the 50th session's prod card item 1 still clips
  (the card is in HANDOFF_ARCHIVE.md). ③ *(resolved: dev's `voice.live.debug` reads ON in
  `~/.ctrl-b-dev/config.yaml`, verified 2026-10-14)* ④ **Per-agent voices** — nothing
  picked from the PocketTTS library yet (`ganyu` = the interim default everywhere; the cloned voices live
  in `~/.local/share/tts/voices/pocket`). ⑤ *(ruled + FIXED: ISS-37 `badc9d9d`, session 62 — a
  specialist with no greeting has none)* ⑥ the ⚖ veto window (a)–(f) in the 50th session's block (HANDOFF_ARCHIVE.md).
- The ~80 MB untracked `design/prototypes/gacha/` originals (its four art/sheet dirs, gitignored since
  2026-08-06 — so `git status` never shows them) — standing "leave untracked for now";
  eventual call = leave / move out / delete.
- D2-A monitor: the owner DAILY-USE round on prod (its memory; per-host switches OFF until then).
- Cosmos "Alive/uptime" stat shows "—" (backend has no boot time; additive later — its memory).
- The vault/wiki spec stays PARKED (owner designing elsewhere; the binding requirement =
  whole-functionality enable/disable toggles).
- Notifications: channel 1 fully closed (delivery + tap routing + the `host_up_down` toggle, all
  built); web-push stays PARKED on its merits (closed-app delivery only).

**Standing KIT items (homes verified 2026-08-06):**
- `getJSON` has NO global timeout (the 5s bounded media-invalidation await works around it —
  GACHA_PLAN §7.6) · kit sr-only sheet-close duplicates the ×'s accessible name (GACHA_PLAN :964)
  · the a11y e2e sweeps TABS only — no arm opens a bottom sheet/dossier (e2e/a11y.spec.ts) ·
  `skipActiveViewTransition` is global, not per-layer (G2 standing note) · the eslint-warn backlog =
  the F13 React-Compiler-prep backlog (UI_AUDIT; deliberately deferred; the count lives ONLY in
  QUALITY.md) · SYS-16's ASYNC240 lexical blind-spot list (SYSTEM_AUDIT addendum).

**Recorded LOWs / deliberate non-fixes (all in D54 or the as-builts):**
- Conf gallery THUMBNAILS use bare URLs — stale after an in-place overwrite (surfaces use
  `?rev=`) · the scroll listener's commit→passive-flush window (worst case = one lost position =
  the old behavior) · `isolation` on `.kit` exists only while `.kit-bg` mounts · `appbarMode`
  change does NOT clear scroll positions (recorded non-decision, `fa74a8a`) · under jade,
  `--accent` and ok-green are both greens on KIT surfaces · the pre-existing `--gc-tag-ink` 4.27
  on arcade's brand fill (§7.7 records it; a G7+/owner call) · D75 ④–⑥ (the `/new`-within-one-RTT
  promotion loss · two PWA tabs don't share the sticky pick · the roster query split = ISS-20).

**Future-feature seams (ROADMAP/plan-recorded, no action owed):**
- The D54 sixth-theme adopter contract (a future theme must swap `background` shorthand →
  `background-color` on banner rows; MEDIA_PLAN §12) · a future `hosts`-style derived key source
  is one `SOURCES` row (mediaKeySources.ts) · the kit background's off|faded|full enum widening
  (additive, only if asked) · `media/kit/hosts/` adoption by more themes = per-theme fidelity
  slices · amber-gold unit palette re-adds on owner overrule only (GACHA_PLAN §7.7 G6.1 addendum
  holds its measured panel) · ROADMAP §P holds the owner-ruled-OUT ideas (QR-to-phone, picker
  disclosure) — never re-propose; sweeps skip §P.

## Read order (5 min)

0. This file: **Where we are** → **What is DONE / what is LEFT** (the one list) → the standing notes below.
1. `DECISIONS.md` — every locked choice + reasoning, the open items, and the future-additions list.
2. `ARCHITECTURE.md` — deployment profiles, `$CTRLB_HOME`, the OS-branch allowlist (layers/data/API
   live in DESIGN/SPEC).
3. `DESIGN.md` — **concrete code design**: data structures, the unified capability/registry model,
   the agent loop state machine, concurrency, persistence, the SSE wire protocol, end-to-end
   flows, edge cases, and the extension cookbook. Build against this.
4. `TODO.md` — the phased build plan (phases 0–27; check the unchecked boxes).
5. `RESEARCH.md` — library/version pins + sources · `docs/research/` — the field-research dossiers
   (buy a finding once; read before re-commissioning a pass).
6. `ROADMAP.md` — post-v1 features + the v1 seams; §P = owner-ruled-out ideas, never re-propose.
7. `SPEC.md` — the visual one-stop system spec. The audit ledgers: `UI_AUDIT.md` (F#) ·
   `SYSTEM_AUDIT.md` (SYS-#) · `AGENT_CHAT_AUDIT.md` (ACA-#) · `PROMPTS_AUDIT.md` (PR-#) ·
   `QH_AUDIT.md` (QH-#).

Net-new UI follows `VAPOR_PATTERNS.md` (design language) + `THEME_ENGINE.md` (D31 Swappable
Surfaces routing; per-theme fidelity D7; vapor byte-frozen per D51; cosmos = the default theme).

## ▶ Phase 27 BUILT (code complete; S12 = session 78, 2026-10-14) — POINTER ONLY

**Conversations per agent (the Telegram model) + past conversations = ROADMAP A15 → [`D84`](./DECISIONS.md) → Phase 27.
The design of record and the as-built records are [`docs/CONVERSATIONS_PLAN.md`](./CONVERSATIONS_PLAN.md)** (§10 = the
S0–S13 ladder · §12 = the open rows · §13 = the council + as-built record); evidence = [R100](./research/R100-per-agent-conversations.md).
Built: S0–S10 + S10-C01 on `phase27` (sessions 69–73), the single merge `cecc66f5`, S11 = the owner's device round, (c)
`a304c533`; S12 = session 78's docs close-out; S13 = the release, with v1.7.12. What remains: LEFT §1 (the S11-(c) and
ISS-50 checks) and §4 (⑤ + the six ⚑ defaults, ISS-72 · ISS-82). The designed-era pointer is in
[`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md).
