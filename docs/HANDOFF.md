# Handoff — start here for a fresh session

> ## ▲▲ READ FIRST — WHO YOU ARE (owner, 2026-07-28)
> **The MAIN model is now FABLE 5 on high.** It supervises: designs the work and the project itself,
> rules, and audits. **Opus 5 (high) subagents carry all the heavy token work** — implementation from
> pinned briefs, research, mechanical + operational tasks including runbook releases. **Codex
> `gpt-5.6-sol` high** remains the standing co-reviewer, launched whenever review is warranted.
> *(This inverts the 2026-07-24 arrangement. The METHOD is unchanged — judgement in the main seat,
> execution in subagents — only the occupants swapped. Mechanics:
> [`second-opinion`](../.claude/skills/second-opinion/SKILL.md); rationale + the build-brief bar: the
> `orchestrate-with-opus-subagents` memory. Match the model to your tmux session at session start:
> `tmux display-message -p '#S'`, and CHECK THE EFFORT — a supervising seat at low effort is the
> failure mode.)*
>
> ## ✅✅ 2026-08-11 EVENING (Fable) — **E4 CROSS-LAYOUT HARDENING SHIPPED + REVIEW-CLOSED (Codex confirm: five CLOSED + one one-liner → SHIP)** on `alt-fleet`; NEXT = **E5, the §14.11 DEVICE ROUND (Fennec + Chrome) = the REAL acceptance** — owner-driven, on glass, list in GACHA_PLAN §12.6
>
> **E4 closed in one session on the two-lane pattern** (docs = main seat · pins = Opus from the
> pinned brief · one Codex round + fix wave + scoped confirm). 6 commits `8b98e58..3d9b0cd`:
> the docs sweep (D31 FLEET-GRADUATED record · D52 ledger ADDENDUM 2 `showWhen` · §14.14
> as-built graduation + the conditional-setting contract · §12.6 banner-default supersession +
> the E3 fold · the FE-count chain corrected — TRUE chain E1 →1882 · E2 →1999 · E3 →2041 ·
> E4 →2052) + the pins (⑭ engine-generic per-layout Fleet a11y, host-NAMED control + a
> `normalizeIds` strip over the double-mount inequality · ⑮ reel gates per layout PLUS
> real-GachaRoot mounts · ⑯ the real capsule→poster→cover no-remount walk · ⑲⑳ verified
> already-landed · ㉑ poster AND cover axe arms · ㉒ select-then-wake with request-waiter
> discipline + the no-confirm negative · ㉓ verified: NO contrast-matrix rows owed). **Codex
> round 1 = SHIP WITH FIXES: 4 MED test-strength gaps + 1 doc LOW, ZERO runtime defects** →
> fix wave `bac8c13`+`76088fe` (both ⑭ fixes falsified in both directions) → **confirm: all
> five CLOSED + ONE new MED one-liner** (the final wake-total read could race the route
> callback — `expect.poll`, applied + re-run green) → **SHIP, E4 CLOSED**. Full gate 6/6 ·
> FE 2052 · local Playwright 64/64. **The complete disposition record = GACHA_PLAN §12.6's E4
> bullet — read it before E5.** Durable (also §12.6): a per-layout a11y gate must name the HOST
> or a labelled banner control satisfies it silently · React `useId` differs per ROOT — any
> double-mount markup compare must normalize id tokens · a component-level test cannot pin what
> the ROOT mounts · Playwright's `waitForRequest` resolves on the request EVENT, before the
> route callback's side effects. Branch still LOCAL-ONLY, zero pushed; prod untouched at
> v1.5.1; dev units STARTED at close (owner poke).
>
> **⏸ the INSTALLED-ICON white-box thread — RESEARCHED, PROPOSED, then PARKED (owner ruling,
> same session: "a later improvement" — a deferral, NOT a §P rejection).** The complete banked
> state: a transparent installed icon is SPEC-IMPOSSIBLE (W3C MUST-composite; the white box =
> Chrome's WebAPK shell hard-coding `#FFFFFF` behind our fully-transparent maskable — pixel-
> diagnosed; Fennec fills `background_color` so the owner's install was provably Chrome).
> **The R28 dossier (`docs/research/R28-pwa-installed-icon-backdrop.md`, indexed) §9 carries
> the READY-TO-BUILD ruled shape:** a `bg` arg in `gen-pwa-icons.mjs` + the maskable 512
> regenerated full-bleed `#0a0a0d` @ art 0.62 (`any`/bookmark icons stay transparent; optional
> apple-touch pair; hair-lighter `#14141a` = the edge-separation alternative; reinstall =
> uninstall→reload→reinstall, a minted WebAPK re-checks ≤1×/day + identity dialog). When the
> owner picks it back up, that section IS the build brief — buy nothing twice.
>
> ## ✅✅ 2026-08-11 (Fable) — **v1.5.1 RELEASED + LIVE ON PROD: the D55/SYS-19 serving fix shipped ALONE, FIRST** (owner ruling with the Fable second opinion — the `sw.js` rollback-floor argument). **Prod = v1.5.1 @ `98e24c4`; rollback target = v1.5.0 ONLY, and NEVER below the v1.5.1 floor** (a pre-D55 tag re-serves `sw.js` as `text/html` and strands the now-registered worker per-device — runbook §Rollback carries the note).
>
> **The release record.** The Opus-built fix + records (4 commits) + the two runbook lines (content-type
> verify · rollback floor) + a pre-tag Codex confirm ran as a 7-commit serving set, cherry-picked onto
> `main` in a RELEASE WORKTREE — the walked `alt-fleet` tree never touched; picks verified
> sequential-clean and byte-identical. **Codex on the cherry-picked base: SHIP WITH FIXES, zero code
> defects** — two doc LOWs (ARCHITECTURE's route-order sentence omitted the media mounts; SYS-19's row
> cited alt-fleet-local SHAs), both folded. Full gate **7/7 in the worktree incl. a local e2e run**
> (the v1.4.5 lesson), CI + tag release gate green, `update.sh` plain form clean, verify = describe +
> health + the NEW content-type probes on BOTH origins — HEAD and GET agree (`app.frontend()` answers
> HEAD correctly; the runbook's `curl -sI` line stands). **Owner confirmed on the phone same evening:
> the PWA now INSTALLS AS AN APP** — the manifest parsed for the first time in the app's life; the
> service worker is registered, and `SwUpdatePrompt` gets its first real exercise at the NEXT release.
> **⚠ NOTIFICATIONS LEAD (owner hunch, likely right):** the parked Web Push work (F1 ch.2, the
> `web-push-researched-parked` memory) failed at `showNotification()` — which REQUIRES a service
> worker registration, and SYS-19 means NO worker had ever registered when that test ran. **RETEST
> notifications on the device BEFORE re-commissioning any research** — the parked premise may have
> been this bug all along.
>
> **THE RELEASE ITSELF FOUND A NEW DEFECT CLASS — SYS-20.** The pre-push gate run from the worktree
> failed 6 memory-backup tests and committed junk INTO the release repo: git exports `GIT_DIR` to
> hooks, an environmental `GIT_DIR` OVERRIDES `git -C`, and from a linked worktree the exported path
> is ABSOLUTE (from the workspace the relative `.git` re-resolves per-cwd harmlessly — why every prior
> release pushed clean and why runbook step 0 was silently load-bearing). Gate half **FIXED**
> (`_gate.sh` unsets `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` — worktree releases are now safe, the
> D32-deviation question is moot for releases); product half (env sanitization at
> `GitMemoryBackup._run`, `memory_backup.py:126-149`) = **SYS-20, deferred to its own slice**.
>
> **Topology after:** origin/main = local `main` = `98e24c4` (the 4 old docs commits rode up too);
> `alt-fleet` = the SUPERSET — gacha E0–E3 + the 7 serving-stream commits (they DEDUPE at the gacha
> rebase) + the prompts audit. Cutover note for future log-readers: one `ASGI callable returned
> without completing response` ERROR from the OLD pid is EXPECTED at every cutover with an open SSE
> client — not a defect of the new build.
>
> ### ✅ 2026-08-11 (Opus) — **THE DEFAULT-PROMPTS AUDIT IS DONE + RESEARCHED.** Two new docs, docs-only, nothing to build yet. **THE THREE OPEN QUESTIONS ARE PARKED FOR THE FABLE PLANNING SESSION at the owner's word — do NOT rule them in an Opus seat.**
>
> **Delivered:** [`docs/PROMPTS_AUDIT.md`](./PROMPTS_AUDIT.md) (findings **PR-1…PR-6**, classes A–E,
> priority map, §5 shape proposal marked UNRULED) + the peer dossier
> [`docs/research/R27-peer-prompt-configurability.md`](./research/R27-peer-prompt-configurability.md).
> Indexed in the research README, the CLAUDE.md doc map and the AGENTS.md audits line. **No code.**
>
> **Method note worth keeping:** grep is the wrong tool here — searching the obvious phrasings
> (`You are` / `You must` / `Your task`) returns **ONE hit in the whole backend**. The sweep was an AST
> pass over `backend/app` for every string ≥80 chars **plus reconstructed f-strings** (`ast.JoinedStr`
> — assembled prompts are invisible to a `Constant`-only sweep), minus docstrings, then read
> module-by-module. 118 literals triaged.
>
> **The answer to the owner's hunch: RIGHT, and bigger than it looked.** Exactly ONE prompt is fully
> handled (the main system prompt — 3-level chain + append axis + Conf editor + the `default-prompt`
> endpoint). Against it: **~12 hardcoded model-facing prompts with no config, no UI, and no way to even
> SEE them** — the summarizer contract, 8 mid-turn steering nudges, and 4 pieces of injected context
> framing (memory intro, consolidation nudge, roster preamble, skills note). Verified prompt-FREE (so
> nobody re-sweeps them): `routing.py`, `selector.py`, the entire voice/STT path, and automations (an
> automation's `prompt` is owner-authored DATA, not a default).
>
> **The two findings that should drive the plan:**
> * **PR-2 — the summarizer is the sharpest inconsistency we own.** `CompactionCfg.summarizer` is a full
>   `ModelRef` (D11): the owner can point compaction at a *different, smaller, local* model — and cannot
>   touch the five-section prompt it runs. `/compact <instructions>` appends per-invocation on the MANUAL
>   path only; automatic compaction has no lever at all. **LibreChat ships exactly this
>   (`summarization.prompt` + `updatePrompt`); goose ships `compaction.md`.** The one gap where the peer
>   field is unambiguously ahead of us.
> * **PR-1 — tool PARAMETER descriptions are unreachable, and they are the LARGER half.** `tool_overrides
>   .{tool}.description` covers the blurb; `core/tool.py:271` ships `model_json_schema()` untouched by
>   `apply_tool_overrides`. 5,420 ch across 48 `Field(description=…)` vs 4,834 ch of editable tool
>   descriptions — and it is the load-bearing half (cron syntax, store semantics, the `question` ladder).
>
> **R27's four load-bearing peer findings** (full sourcing in the dossier): ① **nobody exposes one prompt
> and stops** — goose overrides **10** templates by file-drop, open-webui exposes 7 task prompts; our
> shape is the one both moved away from. ② **replacement FREEZES you** at the version you copied (goose
> documents it) ⇒ keep an append axis beside any replace axis. ③ **"show me the default" is the field's
> UNSOLVED problem** (open-webui #7024 + #14173 both unresolved; the workaround is "go read config.py") —
> **and our `GET /api/agent/default-prompt` already does it**, so generalizing that one endpoint is the
> cheapest high-value move. ④ **⚠ NEGATIVE, and it constrains PR-1: no in-class peer overrides parameter
> descriptions.** The MCP-proxy tooling that claims to documents no addressing scheme. Building it means
> INVENTING, not following — allowed, but it cannot be argued as "peers do this".
> ⑤ **aider REFUSES prompt overrides across four issues** and points users at an append-only conventions
> file — the coupling argument, which maps onto our guard-coupled steering nudges and is why PR-3 is
> written as *visible first, editable only on a later ruling*.
>
> **▶ THE THREE QUESTIONS FOR THE FABLE PLANNING SESSION (owner parked them 2026-08-11 — unanswered by
> design, PROMPTS_AUDIT §5 carries them verbatim):**
> 1. **Mechanism — Option A or B?** A = a `prompts: {<id>: {override?, append?}}` config map (Opus
>    recommends it: rides the existing `Settings` → `PUT /api/settings` → `reconfigure` chokepoint that
>    already gives validation/atomic-write/cross-device-sync/live-reload, and satisfies
>    extend-don't-migrate as ONE per-item object). B = a `$CTRLB_HOME/prompts/<id>.md` drop-in directory
>    (goose's pattern; genuine in-repo precedent via SOUL.md + skills, but needs a NEW discovery+reload
>    story SOUL.md only escapes by being re-read per turn).
> 2. **Are the 8 steering nudges read-only, or editable?** They are coupled to `_LoopGuard` state, the
>    confirm/resume machinery and the `question_policy` ladder — a bad edit degrades the GUARD, not the
>    tone (R27 ⑤).
> 3. **Is PR-1 worth inventing** given no peer does it — or is folding the load-bearing parameter text
>    into the (already editable) tool description the cheaper answer? If built: an additive
>    `params: {field: text}` on the EXISTING `ToolOverride` object, applied in `to_openai_tools` after
>    `model_json_schema()` — never a sibling map.
>
> **PR-6 is a CONSTRAINT that gates any build, not a defect:** prompts that INTERPOLATE (the reflection
> nudge bakes in `reflection_interval` + gates a clause on `state_enabled`; the per-tool-cap nudge takes
> the tool name and count) cannot be exposed as plain strings without silently dropping the values.
> Settle a placeholder syntax first — goose uses Jinja2, open-webui ships `{{MESSAGES:END:N}}` selectors.
>
> ## ✅✅ 2026-08-09 (Fable) — **E3 THE BANNER TRI-STATE SHIPPED + REVIEW-CLOSED (Codex confirm SHIP) + OWNER-WALKED LIVE** on `alt-fleet`; ~~NEXT SESSION = the E4 go-word (cross-layout hardening + docs, §12.6)~~ *(E4 SHIPPED — see the block above)*
>
> **E3 (banner tri-state) built by Opus from the pinned brief; 6 commits `06523ce..70cf9b2`
> (= HEAD), full gate 6/6 at both waves, FE tests 2036, capsule fence byte-identical.** What
> shipped: the `banner` seg (on·minimal·off, default on *(superseded SAME SESSION — the owner
> ruling further down flipped the shipping default to `minimal`; §12.6's table + the E4 docs fold
> carry it)*, theme-wide, NO showWhen; desc rides 開催
> so zero new glyphs) · read ONCE in GachaFleet, `off` = slot-null UNMOUNT · the SEVENTH body
> stamp `data-gc-banner` · off top-space null via `.tab > .gc-track-head` (seat-scoped, beats
> poster's head pad on specificity) · `minimal` = the re-authored strip (tag 7/display 16/pills/
> 14×5 pips, caption dropped; dot hit-box −9/−5 for an 18px target), height token
> **`--gc-bn-h-min: 88px` → E5's seeded-numbers list** · the scroll-reset effect **BUILT WHOLE**
> (the brief's "extend the layout half" was wrong — none existed): one layout+banner geomKey,
> LATCHES until the fleet tab is showing, fires in `queueMicrotask` to beat DefaultRoot's
> child-first restore. **Main-seat RULING folded (`70cf9b2`): the cover RE-FLOWS under `off`** —
> the lab's walked 126/116 ported as `--cv-side-floor: strap+24` / `--cv-herocopy: strap+14`
> (the pair INVERTS vs on-state 100/110 — pinned both ways); the tri-state scoping enumeration
> consciously amended via an exact two-way `COVER_REFLOW` exception list. **Baseline correction:
> pre-E3 FE count was 1999, not the E2 block's 2027 — fix at the E4 docs step.** Eyeball-banked
> (on glass): the wallpaper shadow SKIRT under minimal (88px strip wearing the 232px band's
> shadow — accepted-or-overridden, a test pins wallpaper rules blind to the banner axis) · the
> lab strip scrim non-port · the pre-existing `.gc-banner-nav` overlap.
> **OWNER RULING (live, 2026-08-09): `banner` DEFAULT = `minimal` ("looks better than the full
> banner") — §12.6 table's `on (default)` superseded; GACHA_PLAN fold at the E4 docs step.**
> **THE CLOSE: Codex round 1 =
> SHIP WITH FIXES** (MED: the scroll ordering had NO real-shell pin — the new tests mounted a
> synthetic scroller so DefaultRoot's restore never ran; fixed mirroring `sectionScroll.test.tsx`
> (StrictMode + the REAL DefaultRoot), and the microtask→direct-call mutation now FAILS showing
> the shell's stale `[0,240]` restore · LOW, a real defect: the latch fired on net-zero hidden
> round trips — `shownGeomRef` now compares against the geometry LAST SHOWN, more faithful to
> ruling 6 than the dirty flag) → the fix pair `80fa8da`+`f6ba4ed`, both mutation-proven → the
> **scoped confirm: SHIP, close E3**, + 1 doc-only LOW folded as the close commit (`on` = the
> BASE form / `minimal` = the shipping default — comments follow the ruling). **The owner walked
> it LIVE on the dev units mid-session ("seems to work fine") and ruled the default flip from
> that walk — the formal render-audit pass is absorbed by it; deep visual acceptance = E5's
> device round as designed** (its E3 adds: the minimal SKIRT call · `--gc-bn-h-min` retune ·
> strip scrim). Series = 10 commits `06523ce..6f24293`, FE 2041, full gate 6/6 at every wave. **E4's
> docs step also owes: the 1999 pre-E3 baseline correction (the E2 record's 2027 was wrong) ·
> the §12.6 banner-default supersession · this block's own earlier "default on" narrative.**
> Nothing pushed; prod untouched at v1.5.0; **dev units RUNNING at close (owner ask, :5434 + :5173).**
>
> ## ✅✅ 2026-08-08 LATE NIGHT (Fable) — **E2 THE COVER SHIPPED + REVIEW-CLOSED (final Codex verdict SHIP) + owner-eyeball-folded** on `alt-fleet`; ~~NEXT SESSION = the E3 go-word (banner tri-state, §12.6)~~ *(E3 BUILT — see the block above)*
>
> **E2 closed in one session, owner live for the eyeball wave.** The full record — build (Opus,
> pinned brief), the two defects only the MAIN-SEAT RENDER AUDIT caught (composer painted over ·
> footer buried: `isolation: isolate` + the `--gc-composer-b` anchor-token seed), the owner's
> three live rulings (unit-hue names both seats · top scrim 0.82→0.45 · masthead seats swapped),
> the Codex arc (1 HIGH: the beat-170 re-route → the `onCommitSelect` select-only commit seam ·
> 3 MED · 5 LOW → confirm reopened F3/F4 + NEW M1 plausible-not-reproduced-fixed-defensively →
> final scoped confirm **SHIP, zero new defects**), the durable gotchas, and **THE WALK LIST**
> (AWAKE wording · hero-name-in-hue · paper contrast · N=4 clip · edge scrims · the UNRENDERED
> develop ceremony — sleep a machine to see it) — **all live in GACHA_PLAN §12.6's E2 bullet.
> READ IT before E3.** Also this session: pegasus/`3` framed at face height (per-entry roster
> `focus`, `f400d1c`) + **ROADMAP H2** banks the owner's visual art manager (upload + visual
> crop for every selectable image — "specify for later", owner). State: `alt-fleet` local-only
> (~50 commits, ZERO pushed; prod untouched at v1.5.0) · FE 2027 *(E4 correction: the true
> post-E2 count was 1999 — GACHA_PLAN's E2 bullet carries the fix)* / full gate 6/6 · dev units
> STOPPED at close · fresh-session Codex runs = setsid-detach + Monitor, never plain
> background-Bash (it killed a full run again).
>
> ## ✅✅ 2026-08-08 NIGHT (Fable) — E0 + E1 SHIPPED **+ THE FOUR-WALK OWNER EYEBALL SERIES FOLDED + SESSION-CLOSE CODEX CLEAN** on `alt-fleet`; ~~NEXT SESSION = the E2 go-word (cover, §12.6)~~ *(E2 SHIPPED — see the block above)*
>
> **E1 closed OWNER-WALKED, not just reviewed.** After the E1 build + two Codex rounds (record
> below), the owner ran FOUR live walks on the dev units; ~20 ruling commits folded same-session.
> **The complete walked record + all supersessions = GACHA_PLAN §12.6's E1 bullet** (read it before
> E2 — several signed §12.6 lines were re-ruled on renders: tap table narrowed to one-tap-open /
> two-step-only-for-sleepers · lab's five hue literals per-unit, rarity→hue DEAD · banner/ground
> reverts · keyline always-on off the outlines axis · kanji corner tag in · ribbon out of poster ·
> 編成 accent drop · the R26 morph NAMING fix — the cutout itself flies, both engines, owner-
> accepted). **R26 dossier banked** (`docs/research/R26-clipped-source-vt-morph.md` + index row):
> an element's OWN clip-path bakes into its VT snapshot — the unfold choreography stays probed-
> ready there if ever wanted. Session-close Codex over the whole series: **ZERO runtime defects**,
> 2 LOWs closed in the close pair. **Banked (owner): the ROOT-cross-fade "screenshot flicker"
> refinement (eyeball, don't remove blind) · the color-theory unit-palette research session · the
> head side-padding vs poster lead alignment.** Dev units STOPPED at close; branch local-only,
> zero pushed.
>
> The multi-session design conversation CONVERGED in one live session (owner present throughout,
> ~12 ruling waves, 4 lab build rounds by Opus subagents). **The record: GACHA_PLAN §12.5's
> rulings log (five dated blocks, 2026-08-08) + §12.6 THE TRANSLATION PLAN (FULLY SIGNED — design
> closed, only three device-round numbers remain) + the [R25 seam map](./research/R25-alt-fleet-port-seams.md)
> (code-verified, file:line).** The essentials:
> - **Ship A THE POSTER + B THE COVER only; C THE CLUB PAGE is PARKED** (§P discipline — never
>   re-propose). The lab (`design/prototypes/gacha/alt-fleet-finalists/`, UNTRACKED like all
>   gacha prototype dirs — never `git add -A`) holds the walked final state; a
>   `python3 -m http.server 8914` may still be running there (owner-walkable at
>   `http://emma:8914/`; kill or keep freely).
> - **Settings (gacha ThemeDef, §12.6 table):** `fleetLayout` capsule(default)/poster/cover ·
>   `posterName` plate/**blade(default)** shown only under poster via the NEW `showWhen` field
>   (the port's ONLY engine change, ~10 lines) · `banner` **on(default)**/minimal/off — cover's
>   strapline seat IS the strip, so "minimal for cover" is structural. The POSTER **keyline**
>   binds to the EXISTING `outlines` axis (gacha defaults false ⇒ off by default, zero new
>   settings). Select-then-act (tap=select, tap again=dossier/WAKE) = component state in
>   GachaFleet + a pure tap-router in `themes/gacha/fleet.ts`; wake is NOT confirm-gated
>   (registry decides, D8) and ceremonies are POLL-TRUTHFUL (WAKING rides busy; only the poll
>   flips ONLINE). **⚖ COUNCIL REVERSAL: Fleet GRADUATES to a user-selectable Surface at E0**
>   (D31's own trigger text — createSurface extracted by factoring composer; gacha registers its
>   three variants theme-owned; every other theme untouched; frontier later = register + skin).
>   Two recorded dossier edits: the `.gc-host-hit` outside-click exemption class + the morph
>   stays CAPSULE-ONLY (poster/cover open plain, as walked). The FULL walked anatomy (blade =
>   plate style+size · no-interlock 22px gutters · unpinned data block · chip/sleeping/stars
>   laws · veil+inset-ring · mode-relative rarity ladder · cover fixed-frame + column scroll +
>   derived hero shift · JP per-host tag DROPPED · motion via UIState.motion · copy.ts+font
>   pipeline) is now pinned in §12.6 rulings 8–10; §12.2 carries a partial-supersession banner;
>   R25 §Q2d carries its correction. Slices REORDERED: no setting ships before its
>   implementation; E0 = showWhen + createSurface + GachaTrack behind a concretely-defined
>   equality fence.
> - **E0 ✅ SHIPPED (2026-08-08, same day — owner gave the go-word live): branch `alt-fleet`,
>   5 commits `c287d99..98f879a`** — fence-first (frozen capsule DOM/a11y snapshots + 390px
>   sha256-identical screenshot, all held through the refactor) · `showWhen` + `settingRowVisible`
>   + the contract checker proven on broken fixtures · `createSurface` extracted, composer
>   re-pointed zero-churn · `GachaTrack` + gacha-owned `fleetSurface` (`fleetLayout` stays
>   UNDECLARED until E1) · full gate 6/6, FE 1800 tests. Codex round: 1 HIGH (module-init TDZ
>   crash entering the cycle at `variants.ts` — reproduced, fixed as a render-time read, pinned
>   by `importOrder.test.ts`) + 5 LOWs → fix wave `98f879a` → confirm round all CLOSED, verdict
>   **SHIP**. E1 owes: the ConfTab showWhen integration test · `GachaTrackProps` widening ·
>   picker copy (§12.3⑤).
> - **E1 ✅ SHIPPED (2026-08-08 evening, same session — the owner's "lets continue" was the
>   go-word): `49de4b1..` on `alt-fleet`** — the POSTER complete WITH its settings (Opus build
>   from the pinned brief · Codex round 2 MED + 5 LOW all closed · confirm round 7/7 CLOSED +
>   1 new LOW fixed by the main seat, both-directions test) · full gate 6/6 · FE 1828→1882.
>   **The record + the E1-brief rulings (picker copy, ribbon-off, banner-slot→E2, font mapping)
>   + durable gotchas live in GACHA_PLAN §12.6's E1 bullet** — the MEDs were the skip-tap
>   two-event double-route and the missing black field (now `body[data-gc-fleet="poster"]`-
>   scoped on `.kit-main`, the wallpaper's own shape).
> - **NEXT: the E2 go-word → §12.6's E2 cover** (→ E3 banner → E4 hardening incl. the R25 Q7
>   pin list → E5 the Fennec+Chrome device round = real acceptance). The owner pause happened
>   LIVE this session (the four-walk eyeball series above — every standing E1-brief ruling is
>   settled and recorded in §12.6's E1 bullet). Opus subagents from pinned briefs, Codex per
>   slice, owner pause between slices.
> - Still owed from before: the owner's phone spot-check of prod v1.5.0 · R20's four + R21's four
>   LOWs + the leftover ledger (`9afe78c`) · the HANDOFF archive sweep (~650KB — **owner
>   2026-08-08: a STANDALONE session of its own**, not a side-task: the superseded blocks likely
>   hide unfinished threads from past features, so the sweep is an audit-then-archive, done with
>   fresh context) · picker copy (§12.3⑤) rides the E1 brief (owner, same day).
>
> ## ✅✅✅ v1.5.0 RELEASED — LIVE ON PROD (2026-08-08, Fable — the release record; every block below is history)
>
> **The release executed CLEAN, end-to-end, by the ordered shape** (Opus ops subagent ran the
> runbook; the main seat verified every transition independently): push `ed45651..b499662` → push CI
> success (run 31180641344) → tag `v1.5.0` @ `b4996622` → RELEASE GATE success incl. e2e (run
> 31181141687) → `update.sh v1.5.0` plain form (DB snapshot `ctrlb-20260807-151413.db.gz`; config
> migration **no-op as designed** — config_version 1, schema 5) → verified: `describe --exact-match`
> = v1.5.0 · health `{"status":"ok","version":"1.5.0","schema_version":5}` · prod unit active.
> **Prod = v1.5.0 · rollback = `update.sh v1.4.6` exactly** (v1.4.5/v1.3.1 stay burned, never
> targets). Dev units STOPPED. Zero unpushed commits.
>
> **The same-day pre-release wave (owner-ordered, shipped IN v1.5.0):** the capsule card's INNER
> FRAME — flush 5px white band on the full silhouette, notch leg included — walked over 4 live
> rounds (`5bc763e` + `db593d6`; durable gotcha: the `background` shorthand RESETS
> `background-origin`, and backgrounds measure from the PADDING-box while masks measure from the
> BORDER-box — the notch leg floated ~7px inside the cut until the origin was pinned) · R18
> ensemble-collage research + GACHA_PLAN **§12** banked (`8de613e`, `ca05991`).
>
> **Still outstanding:** the owner's phone spot-check of prod (gacha is PICKED in Conf, not the
> default; a stale PWA shell wants one reload for the new SW).
>
> **NEXT SESSION, in the owner's order:**
> ① **The alt-fleet design DISCUSSION** — the owner's word: "we will be discussing the ideas and
>   design." GACHA_PLAN **§12 is the PRIMER** (references analysis · R18-verified technique stack ·
>   composition geometry/shape/position · §12.3 open questions), NOT a locked spec; prose
>   back-and-forth per the converse-on-design rule. Nothing builds before that session rules.
>   **UPDATE 2026-08-07 evening (Fable): the discussion now starts from GACHA_PLAN §12.5** — the
>   deep-research pass is BANKED (R22 select-screen grammar · R23 gacha roster/banner grammar ·
>   R24 game-feel→web mechanisms incl. the adoptable motion-grammar spec), the 10-concept catalogue
>   is pinned there, and **lab v2** (`design/prototypes/gacha/alt-fleet-showcase-v2/` — full-bleed
>   immersive concept screens, owner-walkable on the phone) is the discussion vehicle. §12.5 also
>   holds the multi-session protocol (kill/keep/harvest rulings → its dated rulings log) — it is
>   THE comeback point; the owner asked for exactly this durability ("multisession talk… have both
>   the research and the plan available, clearly specified, easy to come back to").
> ② The post-1.5.0 backlog: R20's four owner-deferred refinements + R21's four deferred LOWs + the
>   LEFTOVER LEDGER (`9afe78c`).
> ③ HANDOFF hygiene (R21 deferral ④): this file is ~650 KB — archive the superseded ▶/⚑ blocks.
>
> ## ▶▶ THE EXECUTED RELEASE BRIEF (2026-08-08 — ✅ DONE, kept as the procedure record; SUPERSEDED by the block above)
>
> ### What you are releasing
> **v1.5.0** = Phase 17 gacha "Capsule Arcade" (G0–G6 + the R-rounds, D52) + the Kit Art System (D54)
> + media v2 (M1a–M3, D53) + the pre-release audit's fix wave (R21) **+ the 2026-08-08 pre-push wave
> (owner-ordered, 4 live rounds): the capsule card's INNER FRAME — a flush 5px white band on the FULL
> silhouette, notch leg included (`5bc763e` + the `background-origin: border-box` seat fix `db593d6`;
> pinned in gachaChrome incl. the `--gc-notch` drift fence) — plus the ensemble-fleet R18 dossier +
> GACHA_PLAN §12 plan, docs-only (`8de613e` + the shape/position notes commit). Gate `--e2e` 7/7
> re-run 2026-08-08 at `db593d6`; only docs commits follow it.** Prod runs **v1.4.6**; **schema
> UNTOUCHED at 5** → rollback = **v1.4.6 exactly** (v1.4.5 and v1.3.1 are burned tags — NEVER rollback
> targets). **No config migration in this release**: the only config additions are two nullable
> appearance fields + the `media:` map, which is ABSENT from prod's `config.yaml` (audit-verified
> against the real file — the unknown-role raise cannot fire); first boot creates `$CTRLB_HOME/media/*`
> itself, and a bad media layout DISABLES that namespace, never bricks boot (audit-verified).
>
> ### The state — verify, don't trust
> `git status` clean (except the owner-ruled untracked `design/prototypes/gacha/` art dirs — **NEVER
> `git add -A`**) · unpushed count: `git rev-list --count origin/main..main` · prod:
> `git -C ~/apps/ctrl-b describe --tags` = v1.4.6 · dev units RUNNING (:5434/:5173).
> **Gates at handoff (2026-08-08, at HEAD): `check.py --e2e` ALL 7 PASSED** (ruff lint+format ·
> pyright · backend pytest full · FE check-all · prettier · the FULL Playwright e2e suite) — the
> audit's own precondition, run after the last code commit. The complete audit record =
> **GACHA_PLAN §7.7 R19 / R20 / R21** (R21 = the two-lane pre-release audit: Codex SHIP + Opus
> RELEASE, 2 MEDs fixed, both confirm rounds closed clean).
>
> ### THE PROCEDURE (the owner's 2026-08-08 order authorizes this release; still get the explicit
> ### go-word at session start before pushing — pushing is by owner word, always)
> ① **PUSH `main`** — the pre-push hook reruns the full gate locally (minutes); then WAIT for push CI
> green (`gh run list --branch main --limit 1` → success). Push CI **SKIPS e2e** — green here does
> not prove the arms; the tag gate does.
> ② **`deploy/linux/README.md` §Release END-TO-END**: tag `v1.5.0` on the pushed, CI-green sha
> (semver: feature release) → push the tag → `gh run watch … --exit-status` the **RELEASE GATE**
> (full gate + Playwright e2e on ubuntu-latest). NEVER re-pin on red or pending; NEVER re-point a
> tag. If the tag gate fails, the number burns (v1.4.5 precedent) — fix forward on main, tag v1.5.1.
> ③ Steps 5–6 via the **proven plain form**: `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.5.0`
> (tag checks + CI-gate check + compatibility precheck + install + its own health verify; clean runs
> since v1.4.0). Never edit the prod tree in place.
> ④ **VERIFY**: `git -C ~/apps/ctrl-b describe --tags --exact-match` prints v1.5.0 ·
> `curl -s -m5 localhost:5433/api/health` reports version 1.5.0 (hatch-vcs derives it from the tag
> at install) · spot-check `https://emma.lobster-vector.ts.net` on the phone — gacha is picked in
> Conf (not the default; cosmos is), and a stale PWA shell wants one reload for the new SW.
> ⑤ **AFTER**: stop the dev units (`systemctl --user stop ctrl-b-dashboard-dev
> ctrl-b-dashboard-dev-web`) · record the release (HANDOFF + memory: prod=v1.5.0, rollback stays
> v1.4.6) · the post-1.5.0 backlog = R20's four owner-deferred refinements + R21's four deferred
> LOWs + the LEFTOVER LEDGER (`9afe78c`).
> Execution shape per the methodology: an **Opus ops subagent runs ①–④ from this brief** (runbook
> releases are workforce work — v1.1.1+ precedent); the main seat verifies each gate transition.
>
> ### Edge cases already closed — do not re-derive
> · The new e2e arms are CI-safe on a cold runner: the populated-media arms route-mock everything,
>   the 320px pill arm carries its own fixture (verified by reading; the tag gate is the execution
>   proof). · Schema 5 ⇒ update.sh's migration step is a NO-OP — expected, not an error. · The new
>   fonts (Bungee/Maru + regenerated JP subsets) are committed, content-hashed by Vite, SW-cached by
>   pattern — nothing manual. · `~/.ctrl-b-dev` carries a forward-compatible `media:` block —
>   dev-only, irrelevant to prod. · The carve's variant-C rollback now lives IN-REPO
>   (`GachaStar.tsx` comment — it is geometry+**mask**, and its dark-mix paint is NOT
>   `--gc-star-carve-ink`).
>
> ### Small notes carried forward
> · The research-sheet server (:8901) is STOPPED; sheets on disk, gitignored. · The gachaFonts
>   import-order trap stays documented in-code (registry getters = a someday item). · HANDOFF is
>   ~650 KB — post-release, archive the superseded ▶/⚑ blocks (R21 deferral ④).
>
> ## ▶▶ THE STATE (2026-08-07 EVENING, Fable — SUPERSEDED ABOVE. The OWNER DAY ROUND IS DONE and audited; v1.5.0 is RELEASE-READY — what remains is the owner's LAST eyeball list, then the push word, then §Release.)
>
> ### The tree
> **LOCAL commits on `main`, UNPUSHED** — count them, don't trust a digit: `git rev-list --count
> origin/main..main` (this line went stale twice in one day as a number; owner pushes by word; prod =
> **v1.4.6 untouched**; schema untouched at 5, rollback v1.4.6). Today's live wave (each commit its own ruling, owner on device all
> day): the dossier CLOSE CORNER finished (disc 78→55% of the badge — "opaque foreign blue" fixed; drawn
> × 12→14px, even-child exactness kept) · the card stars walked outline-only → **CARVED** (R19: the
> owner picked the blurred-inner-shadow variant E off the commissioned candidate sheet — a **§14.11
> SVG-filter WAIVER, owner-granted**, recorded in THEME_ENGINE's new closed list; geometry fallback =
> sheet variant C, banked; def presence + flood token + rule-reaches-star all test-pinned) · FULL-WIDTH
> shapes (feat/wide) re-bind stars to 16px (ratio 1.30 holds on all three rows) · the **`cardNameFont`
> AXIS landed** (Opus subagent, pinned brief, main-seat reviewed: "Card face" picker, default bungee,
> the plate's interim pin dissolved; `nameFont` steers the dossier alone; zero backend change — the
> theme_settings map is pass-through) · 2026-08-06's TEST DEBT reconciled (three stale pins caught
> before the tag gate could trip on them).
>
> ### Gates + audit — ALL green at close (2026-08-07)
> `tools/check.py` **6/6** (ruff · pyright · backend pytest full · FE check-all) · FE vitest **1757** ·
> **FULL local Playwright 254** incl. the contrast gate 74/74 and a NEW R19 carve e2e guard (remember:
> push CI SKIPS e2e — but the full suite ran LOCALLY today, post-wave) · **Codex round on the whole
> wave: verdict SHIP**, 0 HIGH/MED, 3 LOW test-hardening findings all folded (`2a9f405`). The complete
> record: **GACHA_PLAN §7.7 R19 addendum** + THEME_ENGINE §14.11 (the waiver entry).
>
> ### THE REMAINING PATH TO v1.5.0 — the eyeball list is CLOSED (owner, 2026-08-07)
> ~~① the owner's LAST eyeball list~~ **ALL CLOSED**: star legibility over white highlights closed on
> device ("the stars look good for now"); the other four (composer's quieter drop · 4-line-name/tab
> touch · scan-mask 7s pulse · white-bar discriminator) **owner-ruled NOTED FOR POST-1.5.0 refinement —
> none blocks the release; the full details are pinned in GACHA_PLAN §7.7 R20 addendum.**
> ~~①b the owner-ordered PRE-RELEASE AUDIT~~ **DONE (the R21 addendum is the record): two lanes
> (Codex adversarial correctness · Opus release-integrity) over the whole unpushed stack → both
> verdicts RELEASE/SHIP; 2 confirmed MEDs fixed (a non-UTF-8 filename 500'd a media namespace — the
> `is_served_file` chokepoint now rejects it; the 5★ pair-card pill painted over stars ≤364px — it
> drops to the ribbon's 32px rung below 380px, measured), owner-ruled literals test-pinned (55% disc ·
> even ×), the carve's variant-C rollback banked IN-REPO (GachaStar.tsx comment), 4 LOWs deferred
> post-1.5.0 (R21 lists them); both confirm rounds closed clean; full gate + FULL local Playwright
> re-run green at the audited HEAD.**
> ② On the owner's word: PUSH, then `deploy/linux/README.md` **§Release END-TO-END** (tag v1.5.0 →
> tag gate runs e2e → re-pin → install → verify). ③ After: stop the dev units.
>
> ### Small notes for the next session
> · The gacha research-sheet server (:8901) is STOPPED; sheets live in
>   `design/prototypes/gacha/research-sheets/` (`star-carved-candidates.html` = the R19 pick record).
> · A latent trap documented in-code (gachaFonts.test.ts): a TEST importing a theme index before its
>   fonts module evaluates the registry mid-cycle → every setting silently `undefined`. Worth a
>   main-seat look someday: registry getters instead of captured values.
> · Carve fallback if a device round ever finds fleet-scroll jank: sheet variant C (same carve, pure
>   geometry) — swap the card-row rule, delete the def, strike the §14.11 entry.
> · The dossier `--gc-star-drop`/`--gc-star-edge`/drop-polygon machinery is DELETED (git holds it).
>
> ## ▶ THE STATE THIS SESSION HANDS YOU (2026-08-06 END OF DAY, Fable — written for a COLD session; SUPERSEDED ABOVE. v1.5.0 IS CODE-COMPLETE — the next session's job is the OWNER DEVICE ROUND, any fidelity fixes it produces, then PUSH + RELEASE.)
>
> ### The tree (verify first: `git log --oneline -6`, `git status`)
> **FIVE commits sit LOCAL on `main`, UNPUSHED** (the owner pushes by word — standing rule):
> `ffeda6b` G6 (two pickers · wordmark コントロール・ビー · NEW-ribbon demo) → `7dfddab` G6.1
> (+cyber-teal/forest-green dossiers; shipped colors verified vs the example) → `97b731e` the
> KIT ART SYSTEM (D54) → `fa74a8a` G6.2 jade + per-tab scroll restoration → `3f093b7` docs.
> Working tree clean except the two long-standing untracked `design/prototypes/gacha/` dirs
> (~80 MB originals — owner-ruled: stay untracked, never commit). Gates at close, ALL
> main-seat re-run: **FE 1665 vitest · 253 Playwright (FULL local — remember push CI SKIPS
> e2e; only the tag gate runs it) · backend full 6/6.** Prod = **v1.4.6 untouched**; dev units
> RUNNING (:5434 + Vite :5173, `CTRLB_HOME=~/.ctrl-b-dev`) — the owner is poking them; STOP
> them only when iteration truly ends.
>
> ### The records (read these, not the session): every build is fully documented in-repo
> · Gacha G6/G6.1/G6.2: **GACHA_PLAN §7.7 + its two addenda** (as-builts, every measured
> number) + §4.4 AS AMENDED (8 accents · 7 dossier options · THE SHARPENED CARVE-OUT RULE:
> object-identity between status and brand lozenges decides, NOT hue clearance — jade cleared
> the numbers and fired anyway).
> · The Kit Art System: **DECISIONS D54 + MEDIA_PLAN §12** (rulings, the A1–A7 council
> amendments, as-built deltas, the owner manual). Owner-droppable: `media/kit/{services,
> service-banners,hosts,background}/`; cosmos = first adopter (deal-then-override banners +
> faded PC image); the "Shared background" switch = a synced appearance field.
> · Scroll restoration: the `fa74a8a` DefaultRoot comments ARE the design record (per-section
> position map at the old reset chokepoint; three skips preserved; map clears on RESOLVED
> layout change; appbarMode deliberately does NOT clear — recorded non-decision).
> All session-scratchpad artifacts (briefs, Codex reviews, render shots) are TMPFS-DEAD for
> you — the docs above are the complete record; nothing load-bearing lives outside the repo.
>
> ### ⚑⚑⚑ THE CLEAN-SESSION STACK LANDED (2026-08-07 ~00:30 — SUPERSEDES both blocks below;
> ### commit `7810bcc`, the 7th LOCAL/UNPUSHED commit; prod still v1.4.6; DO-NOT-RELEASE is LIFTED)
>
> **Everything the ⚑⚑ block below ordered is DONE, plus a live owner-ruling session on top** (the
> owner was on device all evening — most eyeball items closed same-night). Three audited waves in
> ONE commit; the joint Codex round's 6 findings all folded (its one blocker — the watermark
> value-row false-pass — falsified and fixed); FULL gates green at commit (FE 1750 · Playwright 253
> · tools/check.py). The complete measured record: **GACHA_PLAN §7.7 G6.5–G6.7 addenda** + the R15
> §7.1 device-probe results block. What shipped: the contrast-gate truth model (texture/hover/
> per-row watermark) · the tab flight re-composed to ONE root group, opacity-only (glass fixed,
> 1px seam dead, Gecko engine branch RETIRED — device-probe-verified, owner-confirmed "really
> good") · the `nameFont` picker (mincho default/bungee/maru; the synthetic-italic bug killed;
> sha256-pinned atomic font pipeline; owner runs maru) · GachaStar SVG stars (dossier straddle-tab
> no-shadow; cards accent-edge+drop; 1.30 ratio both surfaces) · the unified accent-drop signature
> (--gc-lift-color = var(--accent) solid: cards 4px/portrait 5px/stars; slot-wrapper paint, button
> owns the full slot) · C6 gradient-clipped card names (all accents ≥4.5 on the visible window) ·
> the oracle bottom dissolve (scan always; art only when data-gc-ghosting ≥0.95/<0.88) · the
> BottomSheet ×-close page jump FIXED kit-wide (focus({preventScroll:true}), trace-diagnosed) ·
> balanced grid swatches · peek +10px · wave-1's badge/pity/frontier fixes.
>
> **THE REMAINING PATH TO v1.5.0** (owner closed most eyeballs live: glass/flight/shadows/stars/
> oracle/LEDs/font-picker all ✓): ① the owner's SHORT final pass — star legibility over WHITE art
> highlights (gold 1.41 there; the dark contour was 19.9 — a whisper of dark edge is the fallback)
> · the composer's drop is now lighter+thinner (60% α, 3px) than every gacha drop beside it
> (coherence call; kit-skin ruling 2026-08-03 owns it) · the card-plate synthetic ITALIC (owner:
> "keep for now") · the wave-2 4-line-name/tab-overlap note · the scan-mask 7s phase pulse (fix =
> one wrapper node if it bothers) · the "white bar atop the appbar" is probably browser chrome —
> discriminator: check another theme. ② push on the owner's word → `deploy/linux/README.md`
> §Release END-TO-END (tag gate runs e2e; re-pin; install; verify). **Rollback v1.4.6; schema
> UNTOUCHED at 5.**
>
> **Deferred by the owner (budget), with assets banked:** the PER-SURFACE NAME-FONT — the owner
> wants the CARDS in Bungee while the dossier follows the picker (currently maru): the card face
> is PINNED to Bungee upright as an owner-ruled interim (`gacha.css` `.plate b`, prewarmed
> unconditionally in `fonts.ts` — both comments point here); the clean shape next session = a
> second selector (a card-name axis beside `nameFont`), at which point the pin dissolves back into
> tokens and the warm line returns to the per-setting map. Also deferred: the NAME-EFFECTS design session — the
> rendered sheet EXISTS and is COMPLETE (`design/prototypes/gacha/research-sheets/
> name-effect-candidates.html`, gitignored dir; C6 = shipped, C1 accent-initial = the owner's
> maybe-next); its dossier (R18) was cut mid-write — re-commission the write-up only if the sheet
> proves durable. Small code notes: `--gc-name-fill-window`'s 29.17/70.83 stops are hand-derived
> from `--gc-fill-spread` (flagged in both files) · `--gc-plate-shadow` has no consumer (annotated).
> **Housekeeping:** a throwaway `python3 -m http.server 8901` serves `design/prototypes/gacha/`
> (the probe + sheets) — STOP it when rounds end; dev units RUNNING. R15/R16/R17 landed + indexed
> (R13/R14 numbers were taken — the old ⚑⚑ block's "R12/R13/R14" naming is superseded).
>
> ### ⚑⚑ THE G6.3/G6.4 WAVE (2026-08-06 LATE — SUPERSEDES the block below where they conflict; the
> ### owner ended the session on a LOW-USAGE handoff order: EVERYTHING open is captured here)
>
> **WHAT LANDED (all committed on `main`, LOCAL/UNPUSHED like the five commits before it; prod = v1.4.6
> untouched; dev units RUNNING with it all live):** the owner's first device round produced a large
> fidelity + feature wave, built by four Opus agents + main-seat slices, each part audited:
> · **Dossier fidelity re-sample** (all 6 darks): 3-stop from/mid/to sheets (top band re-sampled — the
>   "too blue" fix), violet 1px rim (`--gc-dossier-outline{,-top}`), translucent card/line lifts, serif
>   italic per-palette-tinted names, muted kickers, violet LEDs; sunset-orange keeps gated-floor
>   normalizations (recorded). Method + full measured tables: **GACHA_PLAN §7.7 G6.3 + G6.4 addenda**.
> · **Dossier enrichment**: service rows are real LINKS (rebaseServiceUrl, the sibling-dossier pattern);
>   cosmos-style dot TEXTURE (handle-aligned, dark sheets only); the unit-art WATERMARK (owner-tuned
>   opacity 0.16, subject at 67%, left-fade at the name's middle; role-line halo carries the recorded
>   legibility trade); drawn pixel-centered × (38px disc, translucent 70%, forced-color-adjust guarded).
> · **VT work**: same-tab nav guard (useSections); content-scoped scale (dark-rims fix) + `gacha-reel`
>   + Blink-only `gacha-appbar`/`gacha-tabbar` stationary groups (chrome-pop fix) + no entry delay +
>   root canvas painted (white-seam class); Gecko keeps a lean 3-group flight (engine-branch, §14.11).
>   A flight-fill for Blink's blur dropout was tried and OWNER-REVERTED ("better before").
> · **Kit/app-bar**: brandMeta = synced OFF-default "Bar subtitle" switch (full appearance-sync mirror,
>   backend field incl.); brand row icon+title sized up; owner-droppable **`media/kit/brand/`** icon slot
>   (masked through `--accent-fill` + gacha's calm-spread; candidates in `design/prototypes/gacha/
>   brand-icons/`, owner shortlist №5/6/9/12, four PNGs already in the dev folder); oval swatches
>   (gradient + flat-accent band) with the inset-hairline fix (the border-tiling chromatic fringe,
>   kit-wide); squared 9px icon buttons in all bar modes; gacha wallpaper POOL folder REMOVED (pin +
>   shared `media/kit/background/` + bundled = the 3-rung ladder, D54 AMENDED); banner hairlines
>   removed; bar/scrim alphas thinned (glass shows color); pity pill = LIVE online-services count.
>
> ### ▶▶ THE CLEAN-SESSION AGENDA (in order; the wave is DO-NOT-RELEASE until ① lands)
> ① **Codex-B HIGH — the contrast gate models an incomplete stack** (false greens): card pairs must
>   composite the dot TEXTURE layer; the `--gc-dossier-row-hover` pairs are ungated; the watermark
>   reaches the metric grid contra comments (separate from the accepted role-line trade). Fix the
>   `Pair.over` stacks, re-measure, re-normalize the failing inks/dim-LEDs (numbers in the review).
> ② **Codex MEDs**: dossier-swap badge resurrect (reopen-during-exit names the OLD badge — suppress
>   like the avatar prep does) · pity lifecycle (`useFleet` services readiness + sum via current host
>   ids — brief in review-A MED-2) · frontier's null subtitle leaves an empty `.meta` span (resolve
>   data in FrontierRoot, pass a real node-or-null). Then LOWs: stale +100ms comments, the close-token
>   85%-vs-78% comment drift. Reviews live at **`design/prototypes/gacha/research-sheets/
>   codex-review-{A,B}.md`** (+ the VT audit + both prompts; scratchpad is tmpfs-dead).
> ③ **The THREE open VT problems (owner-experienced, research commissioned → `docs/research/R12`)**:
>   Blink glass dropout during flight (flight-fill reverted; find the real technique) · Gecko flight
>   still "clunky/glitchy" on Fennec even at 3 groups (options incl. reverting Gecko to the original
>   single-root composition — rims never afflicted it) · **TAP-TO-START LATENCY (owner, last report of
>   the session): a tab tap takes ~0.5–1 s to even START the transition sometimes — profile what runs
>   between the tap and the first VT frame (startViewTransition capture cost, the update callback's
>   synchronous work, the reel mount, scroll restore) — likely a large piece of the perceived clunk.**
>   R12 may still be DRAFTING — verify it exists and index it in docs/research/README.md first.
> ④ **Owner visual re-round on the dev units**, then the remaining release path: full gates
>   (`python tools/check.py` + FE check-all + FULL local Playwright), push on the owner's word, then
>   §Release. **Rollback = v1.4.6; schema untouched at 5.**
> ⑤ **The STARS redesign** (fleet: small; dossier: plain/small/off-center pill — pill much quieter,
>   stars bigger, outlined style) and **the PC-NAME FONT + owner-droppable FONT SYSTEM design session**
>   — research commissioned: **R13 (star styles + rendered candidate sheets)**, **R14 (name-font
>   specimens + font-system seam survey)**, sheets in `design/prototypes/gacha/research-sheets/`.
>   All three research agents may still be WRITING at session end — check docs/research/ + the sheets
>   folder first; re-commission from the prompts in the dossiers only if a draft is missing.
> · Also parked from the wave: mock tiles lift 2–4× harder than rows (one shared card token — split
>   needs a 2nd token); mock inks captions/ports greyer than the role line (one-token follow-up);
>   sunset/rose rim under-fit (glow the sampler can't separate). All recorded in the G6.3/G6.4 addenda.
>
> ### NEXT ① — the OWNER DEVICE ROUND (the v1.5.0 gate; eyeball-heavy, budget rounds)
> On the dev units, owner's phone (Fennec + Chrome):
> · **Accents ×8** — jade (the owner's own ask — green trio/green-navy ramp; its tri-strip is
>   the TIGHTEST walk, 55.9°, glacier's ~2.5-colors caution applies MOST) · ember's
>   green→violet ONLINE ribbon · glacier tri-strip · eridu's blue→cyan→green walk · under
>   jade, `--accent` and ok-green are BOTH greens on kit surfaces (outside the carve-out —
>   eyeball item).
> · **Dossiers ×7** — Teal/Forest (new); slip's lighter-means-dim dots; already ✓ by owner:
>   wordmark, NEW ribbon, dark top strips ("alright for now"). amber-gold was PASSED OVER
>   (accent ΔE 9.5 from star gold — the carve-out collision class); ONE tokens block + option
>   row adds it if the owner overrules (§7.7 G6.1 addendum has its measured panel).
> · **Kit art with REAL files** — drop into `~/.ctrl-b-dev/media/kit/`: banners (cosmos rows +
>   kit rows), a PC image named after a machine, a background (+ the Appearance switch).
>   Cosmos tone values are DELIBERATELY conservative and tunable per adopter
>   (`--kit-host-strength: 0.11` · banner veil 42%/68%): eyeball items. The owner-caught
>   banner-border regression is FIXED (pixel-proven; D54 records it).
> · **Scroll feel** — scroll Conf, switch away, return.
>
> ### NEXT ② — release v1.5.0 (after the round + any fixes, on the owner's word)
> Push (owner's word) → `deploy/linux/README.md` §Release END-TO-END: verified sha → semver
> tag + push → **WAIT for the tag-gate CI GREEN (that is where e2e actually runs)** → re-pin
> `~/apps/ctrl-b` → `install.sh prod` → verify `git describe` + health. An Opus operational
> agent has run this runbook before (v1.1.1 precedent — delegate it). **Rollback = v1.4.6;
> schema UNTOUCHED at 5 — no migration risk.** A fidelity fix wave before the tag is NEW code:
> its own review round (the standing rule).
>
> ### THE LEFTOVER LEDGER — every open/deferred/parked item, project-wide (each with its home; verify in the home before acting)
> **Gates on v1.5.0 (this arc):**
> · The owner DEVICE ROUND (NEXT ① above) — including the deferred eyeball rounds that
>   COLLAPSE into it: M2 frontier art on device + M3 icons on ≥2 themes + most of G5. One G5
>   piece does NOT collapse: **REAL-TOUCH gallery reorder on the phone** (verified only at
>   layout level — GACHA_PLAN §7.6). The final frontier hero art (long-reserved) is now just
>   a file drop into `media/frontier/hero/` — part of the same round if the owner has art.
> · amber-gold dossier: PASSED OVER (star-gold collision); ONE tokens block + option row
>   re-adds it on owner overrule (§7.7 G6.1 addendum holds its measured panel).
>
> **Recorded LOWs / deliberate non-fixes (all in D54 or the as-builts):**
> · Conf gallery THUMBNAILS use bare URLs — stale after an in-place overwrite (surfaces use
>   `?rev=`) · the scroll listener's commit→passive-flush window (worst case = one lost
>   position = the old behavior) · `isolation` on `.kit` exists only while `.kit-bg` mounts —
>   a future PARTICIPATING theme with a Root-sibling overlay stacks it above the shell ·
>   `appbarMode` change does NOT clear scroll positions (recorded non-decision, fa74a8a) ·
>   under jade, `--accent` and ok-green are both greens on KIT surfaces (outside the
>   carve-out — device-round eyeball) · the pre-existing `--gc-tag-ink` 4.27 on arcade's
>   brand fill (shipped since G1; §7.7 records it; a G7+/owner call).
>
> **Standing KIT items (older, still live — homes verified today):**
> · `getJSON` has NO global timeout (the 5s bounded media-invalidation await works around it
>   — GACHA_PLAN §7.6/:1136) · kit sr-only sheet-close duplicates the ×'s accessible name
>   (kit-level; GACHA_PLAN :964) · the a11y e2e sweeps TABS only — no arm opens a bottom
>   sheet/dossier (e2e/a11y.spec.ts) · `skipActiveViewTransition` is global, not per-layer
>   (G2 standing note) · kit-wide `appbarMode: minimal` pinned-plan header × mini-player
>   OVERLAP (VAPOR_ASSIMILATION_PLAN §7.1/:343, pre-existing) · the 42 eslint warnings = the
>   F13 React-Compiler-prep backlog (UI_AUDIT; deliberately deferred) · SYS-16's ASYNC240
>   lexical blind-spot list (SYSTEM_AUDIT addendum).
>
> **Owner-court items (ask, don't assume):**
> · **F1 notifications device-round result — owner tested ~2026-07-30 PM, NEVER reported;
>   STILL UNASKED** · web-push PARKED pending the two Fennec/Firefox checks (its memory:
>   which build + the "Site notifications" channel) · the ~80 MB untracked
>   `design/prototypes/gacha/` originals — standing "leave untracked for now"; eventual call
>   = leave/move out/delete · D2-A monitor: the owner DAILY-USE round on prod (its memory;
>   per-host switches OFF until then) · cosmos "Alive/uptime" stat shows "—" (backend has no
>   boot time; additive later — its memory) · the vault/wiki spec stays PARKED (owner
>   designing elsewhere; the binding requirement = whole-functionality enable/disable
>   toggles) · stop the dev units when iteration truly ends.
>
> **Future-feature seams (ROADMAP/plan-recorded, no action owed):**
> · The D54 sixth-theme adopter contract (a future theme must swap `background` shorthand →
>   `background-color` on banner rows; MEDIA_PLAN §12) · a future `hosts`-style derived key
>   source is one `SOURCES` row (mediaKeySources.ts) · the kit background's off|faded|full
>   enum widening (additive, only if asked) · `media/kit/hosts/` adoption by more themes =
>   per-theme fidelity slices · ROADMAP §P holds the owner-ruled-OUT ideas (QR-to-phone,
>   picker disclosure) — never re-propose; sweeps skip §P.
>
> ### Traps this day bought (do not re-pay; the durable ones are also in the memory)
> · **A kit `:root` var() FORMULA freezes under `@scope`** (`--accent-ink: var(--bg)`
>   substituted once at the scope root) — any token a variant must re-derive belongs on
>   `body`; the contrast gate MEASURES THE STALE PAIR AND PASSES (§14.6 class).
> · **Lifting a CSS shorthand into longhands changes per-layer defaults** — the banner-border
>   regression: the old shorthand's per-layer `repeat` let scrim/veil tile into the border
>   box; the lifted blanket `no-repeat` exposed raw art there. PIXEL-PROVE paint identity
>   when lifting any background recipe.
> · **An advisory that can throw IS a gate** — non-throwing by contract, annotate
>   "unresolved". · **Prefix-shaped property allowlists admit the wrong member**
>   (`background…` matched `background-color`, the precise property a gradient dies on) —
>   EXACT lists for property gates.
> · **e2e settings seeds: assert SURVIVAL after the probes** — no observable sentinel exists
>   when LOCAL wins the LWW reconcile; `waitForResponse` does not order against the store
>   write. · **setState updaters must be pure** — draw randomness outside, hold the pick in a
>   ref (StrictMode replays updaters).
> · **Test geometry must derive the real values live** — the chevron e2e hardcoded the kit's
>   16px strip; cosmos overrides it to 38px, making the precondition depend on the fix under
>   test. `getComputedStyle(el, "::after")` and compute the true intersection; FALSIFY the
>   test (remove the fix, expect the diagnostic failure, restore).
> · **Two writing agents in one tree collide** — serial waves, or worktree isolation.
> · Render-lab notes: gacha's sheet opens at the `[data-bs-peek]` detent (drag through the
>   real snap before capturing) · wait on `.gc-svc` count, not `.gc-dossier` · abort + COUNT
>   non-GET `/api/**` (the counter must read 0) · stub `/api/appearance` unseeded or the LWW
>   reconcile silently re-themes the probe.
>
> ## ▶ PREVIOUS (2026-08-06 night block — mid-flight; historical since the block above)
>
> ### Where the release train stands (v1.5.0 = gacha + the Kit Art System, owner-ruled)
> **① SHIPPED ON MAIN (all local — push on the owner's word):** G6 `ffeda6b` (two pickers ·
> wordmark · NEW-ribbon demo; as-built GACHA_PLAN §7.7) · G6.1 `7dfddab` (+cyber-teal &
> forest-green dossiers; shipped-four verified CLEAN vs the example; §7.7 addendum) · **the KIT
> ART SYSTEM (D54; MEDIA_PLAN §12 = the record)** — three owner-droppable kit roles
> (service-banners · hosts "PC images" · background + synced visibility), kit primitives on the
> ServiceIcon model, cosmos first adopter (deal-then-override banners + faded host art),
> everything dormant-by-absence. Its arc: Codex pre-build design round (A1–A7 adopted) → Opus
> build → main-seat audit → Codex SHIP-WITH-FIXES → 5-item fix wave (incl. the owner-caught
> banner-border REGRESSION, pixel-proven: blanket no-repeat exposed raw art in the border strip;
> fixed `background-clip: padding-box` at the kit class) → Codex fix-set verify → main-seat
> chevron-test geometry fix (the strip is 38px under cosmos, not the kit's 16 — derived live
> now) + falsification re-run. Gates at every step re-run by the main seat.
> **② THE FINAL WAVE IS DONE (`fa74a8a`) — NEXT = the owner DEVICE ROUND, then v1.5.0:**
> (a) G6.2 "jade" shipped — the eighth accent (green trio + deep green-navy ramp; the carve-out
> fired on the SHARPENED object-identity mechanism now recorded in §4.4 — hue clearance alone
> would have cleared it); (b) per-tab SCROLL RESTORATION shipped (DefaultRoot's reset-to-top →
> a per-section position map at the same chokepoint, all three skips preserved, mutation-checked
> tests). Then the round: 15 gacha combos (esp. ember ribbon · glacier
> tri-strip · eridu walk · slip's lighter-means-dim dots · the two new dossiers) + kit art on
> device (drop real files; cosmos tone values are eyeball items) + the border fix + release per
> `deploy/linux/README.md` §Release (rollback v1.4.6; schema untouched at 5).
> **③ Standing cross-project items:** F1 notifications device-round result STILL unasked ·
> web-push PARKED · the ~80 MB untracked gacha originals stay untracked · stop the dev units
> when iteration ends · the gallery-thumbnail bare-URL staleness = a recorded standing LOW.
>
> ## ▶ PREVIOUS (2026-08-06 evening — G6 only; historical since the block above)
>
> ### What this session did (the G6 BUILD session)
> **① G6 is BUILT + REVIEW-COMPLETE — the as-built is GACHA_PLAN §7.7 (read it; it is the
> record).** The full cadence ran: Opus build from the pinned brief → main-seat audit (all 30
> reported deviations ruled; gates re-run by the main seat) → Codex R1 SHIP-WITH-FIXES (2 MED /
> 3 LOW, all accepted — two with leaner main-seat fixes) → Opus fix wave (7 items) → Codex
> fix-set R2 → main-seat wave 2 (3 surgical edits) → full gate + FULL local Playwright green
> (FE 1594 / e2e 231 / gate 6/6). Committed on main (see git log for the sha). Prod stays
> **v1.4.6**; dev units RUNNING (:5434/:5173).
> **② NEXT = the OWNER DEVICE ROUND, then v1.5.0.** The checklist lives at the end of §7.7
> (ember's ONLINE ribbon · the top strip on the darks — the strip is an ADVISORY channel, slip
> 1.19/sunset 1.79 are where to look · NEW-ribbon verdict · glacier tri-strip · wordmark ·
> slip's lighter-means-dim dots). Release per `deploy/linux/README.md` §Release; rollback =
> v1.4.6; schema untouched at 5.
> **③ A NEW design conversation is OPEN: the KIT ART SYSTEM** (owner, this session — the M3
> icons were only HALF the want; the owner wants the FULL owner-droppable art system, "no
> seams", part of the kit). Draft plan in the session scratchpad (`m4-service-banners-plan.md`
> — narrower M4 SUPERSEDED by the full-system framing). Four roles in `media/kit/`: services
> (icons, shipped) · service-banners (identity-keyed; cosmos deal-then-override over its
> bundled pool) · hosts ("PC images", keyed by host name, ships WITH its kit renderer in the
> expanded kit Fleet row) · background (pool + gallery pick). One precedence rule: owner kit
> file → theme's own art → nothing; empty folders ⇒ byte-identical. **THREE owner rulings were
> ASKED AND ARE UNANSWERED:** (1) background semantics — kit background only where a theme has
> no backdrop of its own (minimal/vapor), or under every theme? (2) do kit-surface themes
> (minimal) paint banners natively day one, or literally cosmos-only? (3) does cosmos's host
> sheet adopt PC images in the first slice, or kit-only first? Build window: after v1.5.0.
> **④ Cross-project unchanged:** the deferred eyeball rounds stay deferred (G5 file-drop ·
> M2 frontier art · M3 icons) · the ~80 MB untracked gacha originals stay untracked · the F1
> notifications device-round result is STILL unasked · web-push PARKED · stop the dev units
> when iteration ends.
>
> ## ▶ PREVIOUS (2026-08-06 morning — the G6 decision session; historical since the block above)
>
> ### What this session did (the G6 decision session — every open call RULED)
> **① The stack is PUSHED** — origin/main carries the whole M-ladder + a `THEME_ENGINE.md`
> doc-sync (`5821753`) + this session's G6 plan amendment (the tip of this block's commit).
> Push CI green. Prod stays **v1.4.6**; dev units RUNNING (:5434/:5173).
> **② The G6 palette decisions are ALL RULED (owner, 2026-08-06, from LIVE RENDERS)** — an
> Opus agent rendered all four shifter candidates + both wordmark strings on the real running
> theme (phone viewport, token injection at production cascade position, zero config writes;
> re-runnable lab in the 08-05 session scratchpad `shifter-previews/`, method recorded in §4.4).
> The owner picked from screenshots. **The spec of record = GACHA_PLAN §4.4 AS AMENDED
> 2026-08-06 + the G6 slice-table row.** Read those two IN FULL before briefing; the ruling set:
> · **TWO independent pickers.** Accent picker: SEVEN variants (arcade default · midnight ·
>   indigo · ember · glacier · nebula · eridu). Dossier picker (new, gacha settings row
>   `dossierPalette` → `body[data-gc-dossier]`, THE PICKER CONTRACT block in §4.4): slip +
>   neon-purple (DEFAULT) · sunset-orange · rose-pink · aurora-violet.
> · **eridu is KEPT but its trio is RE-DERIVED** green/blue-ward (pink end dropped, "less
>   convoluted"); midnight/indigo also build-derived (never had hexes); sRGB pinned as the
>   derivation space; the §4.4 variant-block RECIPE (verified against tokens.css) lists every
>   derived token an accent block must re-compute.
> · **The dark dossier is SIGNED OFF as a PICKER** (not a flip — slip survives, G2's identity
>   objection dissolved). Slip keeps its sticker action button; the four darks take the flat
>   button whose SINGLE AUTHORITY is a build-time re-measurement of the NEON-PURPLE example
>   panel (highlight INCLUDED — the old "not the design language" note is explicitly inverted).
> · **Dossier service dots go VAPOR-STYLE** (bright accent up / dim down, `.svc-row .led`
>   precedent) — BOTH states ≥3:1 on all five palettes (the dot is the only visible status cue
>   on port-bearing rows). New per-palette tokens incl. minted `--gc-dossier-kicker` (kills the
>   `--gc-unit-no` cross-write) + the close-disc pair (kills the white-blob inversion).
> · **Wordmark → コントロール・ビー** (§4.3 re-ruled; G6 swaps the shipped string) · **NEW
>   ribbon = DEMO on one random card** (mount-sticky, no semantics — owner decides at the
>   device round) · **carousel-dots-close = KEEP** (ruled, off the open list) · **top strip
>   KEPT on all five** (owner skeptical — judge on device) · **star badge/colors held
>   constant** (§6.2 corrected to as-built `#ff8fa8`).
> **③ The plan went through a FULL Codex council round:** R1 = NOT READY (4 HIGH / 5 MED /
> 2 LOW — disjointness claim, dim-dot a11y, button-authority ambiguity, gate-matrix
> expressiveness, + spec gaps) → every finding accepted (some with leaner fixes, e.g. dim =
> glow-kill not sub-floor) and folded → R2 verification: **all 11 RESOLVED; its two mechanical
> residuals (a stale §8.10 ref + the palette table's `90deg` vs the button authority) fixed
> per its own prescription — main-seat ruling: READY TO BRIEF.** The e2e gate work G6
> carries: contrast-matrix rows gain an optional
> `settings` seed; THEME_PAIRS gains the dossier pairs + a label-band sample mode ("Gate
> coverage" block, §4.4).
>
> ### NEXT = the G6 BUILD (this is where the cold session starts)
> Cadence per the standing method: **Opus build from a pinned brief → main-seat audit → Codex
> round → owner device round** (G6 is eyeball-heavy BY NATURE — budget several rounds, the G0
> lesson). Brief from GACHA_PLAN §4.4 + the G6 row ONLY (they are now self-contained; the
> picker contract, variant recipe, gate coverage, and button authority are all pinned there).
> Owner checks at the device round beyond the palettes themselves: ember's green→violet ONLINE
> ribbon · the top strip on the darks (owner suspects it won't look good) · the NEW-ribbon
> demo verdict · glacier's tri-strip at small size · the wordmark swap. **Then release v1.5.0**
> per `deploy/linux/README.md` §Release (Opus operational agent precedent; rollback = v1.4.6;
> schema untouched at 5).
>
> ### Still open across the project (unchanged by this session)
> The deferred eyeball rounds STAY DEFERRED by standing ruling (G5 file-drop/gallery ·
> M2 frontier art · M3 icons) — owner ruled they don't gate v1.5.0 unless re-raised · the ~80 MB
> untracked `design/prototypes/gacha/` originals stay UNTRACKED ("for now") · the F1
> notifications device-round result (owner tested ~2026-07-30 PM, never reported — STILL unasked)
> · web-push PARKED (its memory) · stop the dev units when iteration ends · release timing =
> after G6, owner's word.
>
> ## ▶ PREVIOUS (2026-08-05 end of day, Fable — the M-ladder close; historical since the 08-06 block above)
>
> ### Where the project stands
> **Phase 17 gacha (G0–G5) ✅ CLOSED. D53 media-v2 (M1a–M3) ✅ FEATURE-COMPLETE — built in one
> day, every slice through the full cadence (Opus build → main-seat audit → Codex round → fix
> wave where findings → confirm/close).** Custom owner art is fully wired and DORMANT until
> files are dropped: gacha's five roles, frontier's rigs/hero/stack (+ the
> `appearance.frontier.image` retirement), and per-service icons on all five themes' service
> rows. Empty folders ⇒ byte-identical rendering to before the feature existed.
> **Tree:** `main` @ `3107256`, clean; **18 LOCAL commits past origin `693a06a`** (the morning
> push). **FE 1549 vitest / BE 1306 pytest / 211 Playwright / full gate — ALL GREEN** (the e2e
> number is a FULL local Playwright run, not CI's subset). Prod = **v1.4.6** untouched; dev
> units RUNNING (:5434 + Vite :5173, `CTRLB_HOME=~/.ctrl-b-dev`). As-builts: GACHA_PLAN
> §7.1–§7.6 + the D53 M1a/M1b/M2/M3 addenda in DECISIONS. Also shipped today, owner-ruled: the
> "on" appbar slimmed to the clear mode's 8/6 pads, kit-wide + gacha (`693a06a`; ~50px bar;
> supersedes gacha's round-3 `14px 16px` prototype literal — layout e2e re-pinned `be4f4a2`).
>
> ### ⚑ THE DECISION LIST — every open owner call, with its options (ask; do not assume)
> **① PUSH the 18-commit stack.** All gated, all reviewed; the owner pushes by word (standing
> rule). Options: push now · hold until G6 rides along · hold until release. No technical
> blocker either way; the longer it sits the bigger the eventual delta.
> **② G6 accent-shifter picks (the build's main open input).** GACHA_PLAN §4.4: the base-ramp
> trio (arcade standing + midnight + indigo) is RULED; the owner picks **TWO accent-SHIFTING
> variants** from the researched candidates **ember / glacier / nebula / eridu** (contrast
> ratios main-seat re-verified at lock). This is an at-a-screen eyeball conversation.
> **③ The DARK-DOSSIER TRIAL — needs an EXPLICIT sign-off, not a default.** §4.4 "Family 3":
> four owner-shortlisted dark dossier palettes (neon-purple · sunset-orange · rose-pink ·
> aurora-violet, all gate-normalised) + the measured flat action button. Shipping it REVERSES
> G2's one-light-surface identity. §4.4 also records what is UNFINISHED on dark (top brand
> strip · star badge · disabled/focus state sheet) and the two rules no token edit covers
> (`--gc-unit-no` at 2.94 · the close disc inverting to a white blob). Options: sign off the
> trial as a selectable variant · keep the light dossier only · defer the trial past v1.5.0.
> **④ The deferred EYEBALL rounds (standing ruling: no drops for now, deferred-until-use).**
> Three are owed: the G5 file-drop + phone-gallery round (REAL-TOUCH reorder is the one thing
> verified only at layout level) · M2 frontier art on device · M3 icons on ≥2 themes. Decide:
> does v1.5.0 SHIP with them still deferred (the feature is probe-verified + fully
> automated), or does any become a release gate? Recommendation: ship; they are use-time
> checks by nature.
> **⑤ Wordmark string** — カプセルアーケード is the standing pick; confirm or change at G6.
> **⑥ The NEW ribbon** — still has NO semantics and NO data seam; wanted for v1.5.0, later,
> or dropped?
> **⑦ Carousel dots close the dossier** — owner-flagged during G2, never vetoed; keep or
> change at G6's device round.
> **⑧ The ~80 MB untracked originals** (`design/prototypes/gacha/` two dirs). REC stands:
> never commit. Decide: leave untracked · move out of the repo · delete.
> **⑨ Release timing.** After G6: tag v1.5.0 per `deploy/linux/README.md` §Release
> (runbook-driven; an Opus operational agent has run it before — sha → tag → **wait for the
> CI release gate GREEN (the tag gate is where e2e actually runs)** → re-pin `~/apps/ctrl-b`
> → `install.sh prod` → verify). Rollback target = v1.4.6. Schema untouched (still 5) — no
> migration risk in this release.
> **⑩ Cross-project standing owner items (not this arc, don't lose them):** the F1
> notifications device round result (owner tested ~2026-07-30 PM — never reported back; ask)
> · web-push stays PARKED pending the two Fennec/Firefox checks (its memory) · stop the dev
> units when iteration ends.
>
> ### What G6 actually is (so a cold session can brief it)
> GACHA_PLAN §4.4 end-to-end: wire the palette VARIANTS into gacha's theme settings (the
> per-theme settings rows — the D31/§14.14 pattern; variant = tokens.css values, NO new CSS
> architecture), the ruled trio + the owner's two shifter picks + (if signed off) the dark
> dossier family + measured action button as options. Every variant passes the THEME_PAIRS
> contrast gate rows (the 48-combo matrix precedent from G2). Then the owner's device round.
> Cadence: Opus build from a pinned brief → main-seat audit → Codex → owner eyeball (G6 is
> eyeball-heavy BY NATURE — budget several rounds, the G0 lesson).
>
> ### Traps this day bought (do not re-pay)
> · **Push CI SKIPS e2e** — only the tag gate runs Playwright. After ANY theme-metric change,
> run the FULL local suite (`npx playwright test` from `frontend/`); the appbar slimming rode
> a green push with a broken gacha arm until the M3 builder's full run caught it.
> · A keyed `<img>` (`key={identity}`) is the lean fix for stale-request error races; the
> per-instance latch + parent-held state pattern is in `ServiceIcon.tsx`.
> · `classifyNamed`/`resolveNamed`/`keyFor` in `lib/media.ts` are the ONE rule for named
> binding — extend there, never beside.
> · A hand-authored `media.<unknown-ns>` key 422s (registry-validated); `media.gacha/
> frontier/kit` are the valid rows.
> · pydantic `computed_field` over `@property` is pyright-clean WITHOUT the mypy ignore.
> · Two writing agents in one tree collide — worktree isolation for PARALLEL waves;
> sequential waves via SendMessage to the still-warm builder agent (context intact, cheap).
> · The pre-push hook runs the FULL gate over the WORKING TREE — never push while a builder
> agent is mutating it (use the hook's documented `--no-verify` escape only when the stack is
> per-commit gated and CI covers it, and say so).
>
> ## ▶ UPDATE 4 (2026-08-05, Fable): **✅ M3 CLOSED — D53 MEDIA-V2 IS FEATURE-COMPLETE — superseded by the block above (same-day history)**
> The whole M-ladder closed in ONE day, each slice through the full cadence (Opus build →
> main-seat audit → Codex → fix wave where needed). M3 = `d70d395`+`bbbb859`+`6dcb7a1` + R1
> wave `8941676` + residual `06b6f7f` (as-built = the D53 M3 addendum: keyFor, the
> `key={identity}` race fix negative-proven ×5, `classifyNamed` one-classifier, the
> cross-platform stem rule, the two-group ConfTab test). Also fixed en route: `be4f4a2` — the
> morning's appbar slimming had broken a gacha layout e2e arm UNDETECTED because push CI
> skips e2e (the known gotcha; the M3 builder's full Playwright run surfaced it). **The tree
> state: FE 1549 vitest / BE 1306 pytest / 211 Playwright ALL GREEN, full gate green; 17
> LOCAL commits past origin `693a06a` — the owner pushes by word, ASK before pushing.** Owner
> eyeballs for G5/M2/M3 all DEFERRED-UNTIL-USE (standing ruling: no drops for now, the
> feature ships finished; every surface probe-verified live instead). Dev units RUNNING.
> **NEXT = G6** (GACHA_PLAN §4.4: the ruled palette trio + two accent-shifters + the owner's
> four DARK dossier palettes & measured action button as OPTIONS — **the dark-dossier flip is
> a TRIAL needing explicit owner sign-off**), then release v1.5.0 per deploy/linux/README
> §Release (prod stays v1.4.6 until then).
>
> ## ▶ UPDATE 3 (2026-08-05, Fable): **✅ M2 CLOSED — superseded above (M3 closed the same day)**
> **The owner's standing ruling this block inherits: NO file drops for now — the media feature
> ships FINISHED, probe-verified, eyeballs DEFERRED-UNTIL-USE** (G5's round, M2's, M3's — all
> the same standing; the owner: "I just want the feature ready for whenever I want to use
> custom art"). M2 landed as `8e0c6ba` (BE frontier row) + `7c3898d` (`named` kind +
> `resolveNamed` + gallery key rows) + `40b2b39` (the `ownerArt.ts` adapter, consumers, the
> `image` retirement) + fix `9e55090` (Codex 3 LOWs: first-declared-wins + registry
> uniqueness invariant + the owner-art e2e arm + neutral `sigil` seed). As-built = the D53 M2
> addendum. Probe-verified on the live dev backend (case-folded `Cube.png`→cube binding,
> unreadable-never-binds, hero pin PUT round-trip, percent-encoded URLs 200). ALL LOCAL past
> `693a06a` — the owner pushes by word, ask before pushing. **NEXT = M3** (kit services row —
> alwaysOn, `keyFor` over `kind ?? name`, ONE `ServiceIcon` w/ the (url,revision) latch, five
> surfaces, keyed gallery + collision/unmatched annotations, `useServiceIcons` policy, + the
> deferred two-group ConfTab render test), then G6 palettes, then v1.5.0.
>
> ## ▶ UPDATE 2 (2026-08-05, Fable): **✅ M1b CLOSED — superseded above (M2 closed the same day)**
> The owner gave the go ("make sure the implementation is correct… let's go"). M1b landed as
> `59b7c2a` (FE: lib/media.ts ops + the registry inversion + gacha recomposed, parity arms
> unmodified) + `2832744` (BE: `warnings[]` off the wire, `unusable_reason` added) + the fix
> wave `7890dab` (Codex LOW-1/2: `unusable` computed from its reason; truthiness filter).
> ALL LOCAL — nothing pushed since `693a06a`. Arc: Opus build → main-seat audit PASS (3
> deviations ruled, see the D53 M1b as-built addendum) → Codex READY WITH FIXES → both LOWs
> closed lean, LOW-3 (two-group ConfTab render test) DEFERRED to M3 where the kit row lands
> for real. Dev backend restarted on the final shape, index healthy. **NEXT = M2** (frontier:
> registry rows BE+FE, `named` kind + `resolveNamed` land with the stack consumer, rigs/hero/
> stack, the `appearance.frontier.image` RETIREMENT, 8-combo stack matrix) — gate includes
> the owner dropping art on dev for the eyeball. Standing M3 obligations so far: the kit
> registry row + two-group render test + `keyFor`.
>
> ## ▶ UPDATE (2026-08-05, Fable): **✅ THE STACK IS PUSHED · G5's OWNER ROUND DEFERRED · M1a CLOSED — superseded above (M1b built the same day)**
> The owner's word landed: **push** — origin/main is at `693a06a` (the whole G5 arc + D53 docs +
> an owner-requested kit tweak: the "on" appbar slimmed to the clear mode's 8/6 pads, kit-wide +
> gacha's override; live-verified 50px). Push CI green (local pre-push bypassed with its
> documented escape because a builder was mutating the tree — CI ran the same gate). **The G5
> FILE-DROP + gallery round is DEFERRED by the owner ("we'll leave that for some time later") —
> it no longer gates the M-slices but is still owed before v1.5.0 ships** (the one thing verified
> only at layout level: real-touch gallery reorder). **M1a is CLOSED** (`a767871`, LOCAL —
> unpushed): the total `themes:`→`media:` fold per MEDIA_PLAN §4, slot keys moved into the
> registry row (`MediaNamespace(roles, slots)` — the D53 as-built addendum records why), dev
> configs verified clean (hand-clean = no-op), ignored-old-keys test + the repo's first gallery
> round-trip e2e. Arc: Opus build → main-seat audit PASS (3 deviations ruled ACCEPTED) → Codex
> **READY, zero findings**. Gotcha until M2: a hand-authored `media.frontier` block 422s (no
> registry row yet). **NEXT = M1b** (lib/media.ts operations + FE registry inversion + ConfTab
> `applicableNs` + gacha parity arms + `warnings[]` off the wire) — brief is ready to write from
> MEDIA_PLAN §5; do not start without the owner's go-ahead.
>
> ## ▶ THE STATE THIS SESSION HANDS YOU (2026-08-05, Fable — written for a COLD session)
> **Where the phase stands: G0–G4 ✅ CLOSED AND PUSHED (origin @ `fb38289`) · G5 code+reviews
> ✅ COMPLETE but UNPUSHED · the media-v2 extension ✅ COUNCIL-SETTLED as D53 · release arc =
> owner G5 round → M1a–M3 → G6 → v1.5.0 (prod stays v1.4.6).**
>
> **⚠ EVERYTHING AFTER `fb38289` IS UNPUSHED, DELIBERATELY** — the G5 slice (11 commits
> `ac621ed..8f6297a`), its docs close (`5b50c4d`), and the MEDIA_PLAN/D53 docs. The owner's
> standing pattern: the stack pushes together once their G5 round passes. Do NOT push without
> the owner's word. Tree is clean except the two known untracked `design/prototypes/gacha/`
> dirs (~80 MB originals — owner call, REC never commit).
>
> **OPEN GATE 1 — the owner's G5 round (they went to work before it; ASK FOR THE VERDICT
> FIRST).** Dev units are RUNNING for it (:5434/:5173 — leave them up). The owner drops images
> over SSH/SMB into `~/.ctrl-b-dev/media/gacha/{characters,banner,wallpaper,reel,oracle}/`
> and checks: the fleet deal (alphabetical, `01-` prefixes work) · banner scene slides ·
> wallpaper/oracle swap · a reel cutout (NO baked glow — expected, the gallery's reel hint
> says so) · the Conf gallery on the phone (order, pins, warnings, REAL TOUCH reorder — the
> one thing verified only at layout level). G5 as-built = GACHA_PLAN §7.6; verdict folds like
> G3/G4 did (fix wave via Opus if findings, else close G5 in §7.6/TODO and PUSH the stack
> with the owner's OK).
>
> **THEN THE MEDIA-V2 BUILD (D53; spec = MEDIA_PLAN.md — read it WHOLE before briefing, §11
> holds the council rulings).** Slices in TODO: **M1a** (config re-home ALONE: ns-generic
> `media:` model, the `themes:` family deleted, readers/writers moved, BOTH dev configs
> hand-cleaned — main+prod-dev — ignored-old-keys test; no behavior change) → **M1b** (the
> `lib/media.ts` operations + the FE media registry + ConfTab `applicableNs` + gacha
> refactored on top with the §2 parity arms + `warnings[]` off the wire keeping probed
> format + unusable reason) → **M2** (frontier: rigs/hero/stack, the `appearance.frontier
> .image` RETIREMENT, 8-combo stack matrix; owner eyeball) → **M3** (kit services: `keyFor`
> JS-semantics normalization, ONE `ServiceIcon` with the (url,revision) latch, five
> surfaces, keyed gallery + collision/unmatched annotations; owner eyeball ≥2 themes).
> Cadence per slice: Opus build from a pinned brief → main-seat audit → Codex → owner.
> **Then G6 palettes** (GACHA_PLAN §4.4: the ruled trio + two accent-shifters + the owner's
> four DARK dossier palettes & measured action button as OPTIONS — **the dark-dossier flip is
> a TRIAL needing explicit owner sign-off**; it reverses G2's one-light-surface identity).
> **Then release v1.5.0** per deploy/linux/README §Release (runbook-driven, Opus operational
> agent precedent).
>
> **OPEN OWNER QUESTIONS / DESIGN CHOICES (carry them; none block M1a–M1b):**
> ① the G5 round verdict (gate 1 above) · ② the G6 dark-dossier sign-off · ③ the wordmark
> string (カプセルアーケード standing) · ④ the NEW ribbon (no data seam — needs owner
> semantics if wanted) · ⑤ carousel dots close the dossier (owner-flagged, unvetoed) ·
> ⑥ the ~80 MB untracked originals (REC never commit) · ⑦ M2/M3 eyeball verdicts when they
> come. **Standing kit items (minted this session, not scheduled):** a global request
> timeout for `getJSON` (the 5 s media-invalidation race is the local fix, comment names the
> item) · kit sr-only sheet close vs gacha's visible × · a11y e2e never opens the dossier ·
> kit-wide minimal plan/player overlap (vapor ledger §7.1). *Closed this session in passing:
> the "skipActiveViewTransition is global-not-per-layer" thread — G4's type-scoping IS the
> per-layer fix.*
>
> **WHAT SHIPPED THIS SESSION (2026-08-04→05, one continuous arc; as-builts §7.4-close/§7.5/
> §7.6 + MEDIA_PLAN):** G3 closed (device round passed wholesale; Gecko scanline branch not
> needed) · the VT spike SETTLED empirically without the owner's phone (outcome (a):
> `new(root)` is LIVE in Gecko — external-capture probe; found+fixed the dropShowcase
> nav-kill bug) · G4 built+closed same day (reel figure tokens; M2 prototype-exact; seam
> promoted; type-scoped skip; the GLOW LESSON: CSS drop-shadow blur length IS σ — Codex
> right, main seat wrong, settled by pixel experiment) · 7 dependency advisories zeroed
> lockfile-only · G5 built through THREE Codex rounds (NOT READY → two waves + final →
> main-seat-verified closed; DEGRADE-NEVER-BRICK minted as law after the crash-loop finding)
> · media-v2 designed + council-settled as D53. **FE 1404 / BE 1301 / 205 e2e, gate green
> throughout.**
>
> ## ▶ PREVIOUS BLOCK (2026-08-05, Fable): **◐ G5 BUILT + REVIEW-COMPLETE — owner FILE-DROP + GALLERY
> ROUND = the open gate.** Eleven commits `ac621ed..8f6297a` (as-built **§7.6** — read it),
> NOTHING PUSHED past `fb38289`. The namespace-generic media surface (ruled option b): hardened
> read-only `/api/media/{ns}/files/` mount + per-role index with `revision`, the
> `ThemeDef.media`-driven Conf gallery, the repo's FIRST SW runtimeCaching, and the durable
> **DEGRADE-NEVER-BRICK law** — a bad media layout disables the namespace with a visible
> reason; the pre-ruling code would have CRASH-LOOPED prod systemd on a stray file. Review arc:
> Codex NOT READY → two waves + a final fix → main-seat-verified CLOSED. BE 1301 / FE 1404 /
> 205 e2e. **Rulings of record:** reel_figure pins select from the REEL POOL · index wire =
> `{roles, slots}` (§5.2 amended) · advisory thresholds = named constants · post-boot
> root-swap = out of threat model. **NEXT: the owner drops real images into
> `~/.ctrl-b-dev/media/gacha/{characters,banner,wallpaper,reel,oracle}/` (dev backend is
> RESTARTED and serving), checks the deal/scenes/wallpaper/reel pickup + the phone gallery;
> then push the stack, then G6 palettes (the dark-dossier trial needs explicit sign-off),
> then v1.5.0.** Standing kit item minted: a global request timeout for `getJSON`.
>
> ## ▶ UPDATE 3 (2026-08-04, late): **✅ G4 CLOSED — the owner round PASSED on BOTH phone and
> desktop** ("they look good"; the 67% figure default stands untouched, M2's on-device tab
> switch confirmed, no tuning requested). The full G4 stack is PUSHED (owner-authorized).
> **NEXT = G5 media/roster (role-scoped folders §5.4; carries the owner-cutout glow expectation
> + the URL-scoped figure-latch reset), then G6 palettes (+ the §4.4 dark-dossier trial
> options), then release v1.5.0** — G5 awaits the owner's go-ahead per the phase-pause rule.
>
> ## ▶ UPDATE 2 (2026-08-04 night, Fable): **✅ (closed by UPDATE 3) G4 BUILT + REVIEW-COMPLETE — owner FIGURE EYEBALL
> + DEVICE ROUND = the open gate.** Seven commits `dd1a056..fa86ed3` (as-built **§7.5** — read
> it): the reel figure (all dials `--gc-figure-*` tokens, 67% default), M2 prototype-exact with
> the spike seam PROMOTED (**the `ctrlb.spike.navVT` flag NO LONGER EXISTS — older blocks below
> that mention it are historical**), the type-scoped VT skip, degradation latches, and the
> corrected baked glow (**durable: CSS `drop-shadow()`'s blur length IS the Gaussian σ** —
> Codex right, main seat wrong, settled by pixel experiment). Review arc: Codex READY WITH
> FIXES → wave → confirm ALL-RESOLVED → residual LOWs closed. FE 1363 / BE 1254. **NOTHING
> PUSHED since `8757c1c`** — the G4 commits await the owner's word. Dev units RUNNING; the
> figure + fuller glow are live on :5173. **NEXT: the owner's figure eyeball (tune via tokens,
> the owner speaks words, the seat turns dials) + the Fennec+Chrome device round (one-line M2
> check: slats keep sweeping through the cross-fade); then G5 media (carries: owner-cutout glow
> expectation + URL-scoped figure-latch reset), G6 palettes, release v1.5.0.**
>
> ## ▶ UPDATE (2026-08-04, Fable): **✅ G3 CLOSED — the owner device round PASSED wholesale** (all
> five checks; the arcade panel approved as re-ruled by the side session; the M6 Gecko
> `data-engine` scanline branch is NOT built and NOT needed; `:active`-wedge closed, no
> complaint). **All five side-session commits PUSHED** (`ba0b8b1..c8ddcdb`, owner-authorized;
> origin == main). Records: GACHA_PLAN §7.4 header + §7 G3 row + TODO. **THE VT SPIKE IS
> SETTLED (same day, NO phone test needed): outcome (a) — `::view-transition-new(root)` is
> LIVE in Gecko, so M2 ships prototype-identical.** An Opus external-capture probe (Xvfb +
> x11grab, the frames-not-screenshots bar) proved liveness on Gecko 151 in-app + FF 152
> engine-level; BCD pins ONE VT implementation at 144 for desktop AND Android. It also found
> a REAL bug — the reason the owner's desktop A/B looked dead: `GachaFleet.dropShowcase`
> skips ANY active transition (`activeTransition` has no owner token), so a fleet→X nav
> kills the nav VT 100% of the time. **G4 = reel figure + M2's three obligations (① the
> owner-token skip fix ② the `[data-transition="tab"]` CSS, which doesn't exist yet ③ the
> seam promotion) — full record = the §10.1 verdict block + the §7 G4 row.** Dependency
> housekeeping same day: 5 undici Dependabot alerts + 2 audit highs (brace-expansion,
> fast-uri) fixed lockfile-only (`0d87ac5`+`810de56`, frontend audit = 0 vulns), held
> UNPUSHED pending the owner's OK. Dev units RUNNING for the owner's checks.
>
> ## ▶ PREVIOUS BLOCK (2026-08-03 — **✅ G2 CLOSED · ◐ G3 code+reviews COMPLETE, owner DEVICE ROUND = the open gate · NEXT = that round, then G4**)
> **This block is written for a COLD session (the prior one closed at its usage limit after
> closing G1+G2 and building G3 end-to-end).** Everything through G3's review wave is
> COMMITTED AND PUSHED (verify `git log origin/main..main` is empty; if not, push — the owner
> authorized it). State: **FE 1343 / BE 1254 / 40 gacha e2e arms**, dev units RUNNING
> (:5434/:5173) for the owner's checks.
> **FIRST MOVE: ask the owner for the G3 device-round verdict** (the five checks: M7 blur ramp
> smoothness on Fennec — perf-lite drops it whole if janky · 12.5px bubble read comfort · the
> oracle pin across appbar modes · the flat `arcade` composer panel (+ its `--line-2` edge
> fidelity delta, an owner call) · the M6 scanline on Gecko — its `data-engine` branch is
> PRE-DESIGNED, NOT BUILT; the round decides). Fold verdicts as a fix wave via an Opus
> subagent, then close G3 in §7.4/TODO.
> **THEN G4 (re-scoped):** the reel FIGURE (smaller default, tunable — asset/timing/size
> eyeball) on G0's mechanism + the M2 root-VT question per the §10.1 spike (the owner runs
> `localStorage.setItem("ctrlb.spike.navVT","1")` on Fennec) — **M3's morph already SHIPPED at
> G2** (§7.3), so G4 is figure + M2 only. Then G5 media/roster (role-scoped folders, §5.4) and
> G6 palette variants close the phase; release = v1.5.0 (prod stays v1.4.6, owner ruling).
> **Read before building: §7.1–§7.4 as-builts** (the phase's laws: frames-not-screenshots for
> animations · VT capture-window commit discipline · generation tickets for async VT callbacks ·
> the bespoke-body stacking law · worktree isolation for PARALLEL build agents — two agents in
> one tree collided twice) + the D52 addenda in DECISIONS.
> **Standing threads:** kit sr-only sheet close duplicates gacha's visible × label (kit
> follow-up) · a11y e2e never opens the dossier (axe misses it — tag-gate note) ·
> `skipActiveViewTransition` is global-not-per-layer (fine today; revisit if the VT wrapper
> grows owners) · carousel dots close the dossier (owner-flagged, unvetoed) · owner picks
> open: wordmark string (カプセルアーケード standing) · NEW ribbon (no data seam) · ~80 MB
> original drops UNTRACKED in `design/prototypes/gacha/` (REC: never commit).
>
> ## ▶ SIDE SESSION (2026-08-04, Opus — a deliberate DEVIATION, now closed)
> **⚠ THIS DOES NOT CHANGE THE MAIN ARC. The open gate is still G3's owner device round, then G4 —
> read the block ABOVE this one and carry on from there. Everything here is a side note.**
> **An owner-attended session ran BESIDE the main arc while the main model was rate-limited. FOUR
> commits, NOT PUSHED — `origin/main` is four behind (`ba0b8b1` kit · `d65e7b7` gacha · `44aec0a`
> + `5578dc4` docs); gate green at each (1341 vitest, 94 e2e mobile + 94 desktop + 7 firefox,
> stylelint/prettier/tsc). Two Codex rounds + a council round ran over it. Full record: the amendment
> at the end of GACHA_PLAN §7.4 and the D52 G3 note.**
> Short form of what SHIPPED: the tools-menu open RING is gated to the `outline` composer skin (it was
> re-growing a border glass/bezel/sleek strip) with a new e2e arm proven red-on-broken · the `arcade`
> skin was re-ruled — no outlines anywhere, ONE hard accent drop, a sticker press · the M6 scanline's
> uncombed band fixed (the layer is now one travel-length taller than its box) · `--gc-fill-spread`
> calms the accent ramp on four SMALL filled controls · the dossier's second pass (tighter/squarer,
> two-line bilingual captions, mono ports, circle close, Shut-down re-coloured to a
> contrast-safe `--gc-dossier-accent`, the per-host service bar removed with its whole dead chain).
>
> **▶ WHAT THIS LEAVES FOR G6 — the owner chose new palette + button designs, and they are now
> OPTIONS in the plan: GACHA_PLAN §4.4 "Family 3 — the DOSSIER SURFACE".** Four owner-shortlisted
> DARK dossier palettes (neon-purple · sunset-orange · rose-pink · aurora-violet), each normalised so
> every gated pair passes, plus the ACTION BUTTON measured from the owner's mock (flat horizontal
> gradient, ~5px radius, a 1px rim at 1.10x the fill, NO elevation — it replaces the sticker language
> on the dossier only). **The dossier goes DARK as a TRIAL, not a lock** — that reverses G2's
> one-light-surface identity, so it wants an explicit owner sign-off before it ships. §4.4 also
> records the four measurement traps that cost this session, the two RULES the dark flip breaks that
> no token edit covers (`--gc-unit-no` at 2.94, and the close disc inverting into a white blob), and
> what is still unfinished (top brand strip, star badge, and the disabled/focus state sheet on dark).
>
> ## ▶ PREVIOUS BLOCK, same day (2026-08-03 — **✅ G2 BUILT + OWNER-EYEBALLED + PUSHED (unit dossier + the MORPH + the art showcase); G3 was next**)
> **The same owner-attended session closed G1 AND G2. Ten G2 commits `8c4c74f..c248260`, ALL
> PUSHED (origin @ `c248260` + the docs commit riding this handoff); FE 1309 / BE 1254, gate
> green per commit. G2 as-built = GACHA_PLAN §7.3 (READ IT — the morph arc is the session's
> big lesson: the first M3 pass shipped INVISIBLE and was caught only by the owner's device
> round; frames-not-screenshots is now the animation verification bar).** Short form: the
> light dossier (ruled grid, em-dash held metrics, action bar, live service rows, contrast
> THEME_PAIRS gate rows) + M3 pulled from G4 and made prototype-exact (BottomSheet
> `enterInstant`/`upkeepKey` seam — sheet at rest under VT) + swap morph + visible × +
> tap-outside/navigation close + the full-screen ART SHOWCASE (z-46, reverse morph). Codex:
> G2 round NOT READY → gen-ticket fix; M3 confirm READY WITH FIXES → all five taken; the
> G2-close sweep CLOSABLE WITH FIXES → all four taken (`294cc32`) — G2 is CLOSED, FE 1323.
> **▶ NEXT = G3 (agent tab):** GachaAgent body (oracle + §4.2 scroll mechanics) + the
> `arcade` composer skin (D37 — shared catalog value, cross-theme picker cost budgeted) —
> bubbles SHIPPED at G0; G3 carries bubble polish + the owner's 12.5px read-comfort device
> check + the M7 blur-ramp Fennec/Chrome device check. **Carried:** VT spike for M2/root
> (gates only G4's M2 now — M3 is DONE and device-proven) · owner picks: wordmark string ·
> NEW ribbon · carousel dots close the dossier (unvetoed flag) · kit sr-only close vs the
> visible × label (kit follow-up) · a11y e2e doesn't open the dossier · ~80 MB originals
> UNTRACKED (REC never commit) · dev units RUNNING · v1.5.0 = this theme's release, prod
> stays v1.4.6.
>
> ## ▶ PREVIOUS BLOCK (2026-08-02 night — **✅ G1 BUILT + OWNER-EYEBALLED (banner + capsule track + scenes); G2 was next**)
> **One owner-attended session: the whole G1 slice — build, two review waves, and 3+ LIVE owner
> eyeball rounds with rulings folded in real time. Fifteen commits `2898fad..4879f9e` on top of
> G0's seventeen, tree clean except the docs commit riding this handoff, NOTHING PUSHED — ask the
> owner before pushing.** End state: **1221 FE unit / 1254 BE / 33 gacha e2e arms**, full gate
> green per commit.
> **G1 as-built = GACHA_PLAN §7.2 (read it first)** — short form: the §6.4 banner CONTRACT
> implemented (pure `carousel.ts` reducer, keyed+buffered membership, one-shot timer matrix,
> inert offscreen slides, reel `inert` lock) + capsule track (geometry rule feat/pairs/
> trailing-wide, stars, tap shine) + wallpaper on `.kit-main` + **the eyeball-born SCENE
> slides** (owner drops b2/b3 → named event slides via the researched `SCENE_TITLES` pool —
> hero-style templated copy, inert, filename-stable keys). Review: Codex R1 READY WITH FIXES
> (4 MED/2 LOW) → 9-fix wave → confirm 8/9 → residual closed; scenes wave → its own Codex
> round **READY FOR SLICE CLOSE** (one pre-existing LOW carried: a host named `hero` collides
> with `HERO_KEY` — `host:`-prefix promo keys when G2 touches the slide plumbing). **Post-close
> fix:** the owner's device round found touch swipe DEAD (implicit-capture `lostpointercapture`
> bubbling from the slide child read as a cancel — §7.2's post-close entry has the full
> diagnosis + the durable lesson); one-line target guard + 2 tests, Chromium-touch-verified
> live, **✅ owner-confirmed working on the Fennec device**.
> **OWNER RULINGS THIS SESSION (all recorded, D52 addendum + plan):** 3★ ladder ≥3→★3 (§6.1
> re-rule) · 5★ stays 1:1 · **G5 media dir = ROLE-SCOPED folders** `{characters,banner,
> wallpaper,reel}/`, drop-in = assignment (§5.4) · banner scenes = EXTRA SLIDES over cycling
> hero (§6.4) · scene copy = templated, named pool, never numbered · scrim/star-hi/focus value
> picks (the owner-override-of-prototype-literals precedent). **The owner's own art is IN the
> bundled set** (roster `[pegasus, atlas, 3, 4, lyra-tail]`; lyra guards the G4 cutout).
> **▶ NEXT SESSION = G2 (the unit dossier):** pin the Opus brief from **§7's G2 row + §4.8
> (pinned values + the ruled frontier metrics grid: Ping 応答 · Uptime 稼働 "—" · Services
> サービス · Seen 最終確認) + the council-H3 host ACTION BAR (a named fidelity checkpoint) +
> reuse G1's star engine + extract the shared host-detail derivation to `lib/` (council M6) +
> the §4.9 sheet-timing call.** The click seam is WIRED AND WAITING: `openHostDossier` in
> GachaFleet.tsx (cards + promos both route through it; fill it, delete the stub comment).
> Gate: eyeball + contrast probe (light inversion!).
> **Owner picks still open (carry to G2/G3 eyeballs):** wordmark string (カプセルアーケード
> standing) · NEW ribbon (no data seam — needs owner semantics if wanted) · promo-click→dossier
> destination formally unconfirmed (proposal unvetoed through three rounds — treat G2's first
> eyeball as the confirm) · counter semantics implicitly accepted. **Housekeeping:** ~80 MB of
> original drop images UNTRACKED in `design/prototypes/gacha/{chars,banner images}/` — owner
> call, REC don't commit · dev units RUNNING (:5434/:5173) for the owner's checks — stop when
> done · the G0 threads stand: VT spike untested (gates G4 M2) · chat 12.5px check at G3 ·
> v1.5.0 = this theme's release, prod stays v1.4.6.
>
> ## ▶ PREVIOUS BLOCK, same day (2026-08-02 evening — **🔒 D52 LOCKED + ✅ G0 BUILT AND OWNER-SIGNED; G1 was next**)
> **One continuous owner-attended session: the LOCK, then the whole G0 slice through four owner
> eyeball rounds. Everything committed `eaa89e0..c26d1eb` (17 commits), tree clean, NOT pushed —
> ask the owner before pushing.** Read the lock record in the next block down (all §8 ruled →
> council §11 → D52); this block is the BUILD record + what G1 needs.
> **G0 as-built = GACHA_PLAN §7.1 (read it first)** — the short form: the kit seams unit
> (`brandText` · `TabDef.subLabel` · `runViewTransition` extraction+hardening) landed as one
> commit; gacha registers as the 5th theme (3-tab, JP sub-labels, `starMode` 5★, wallpaper +
> sticky-oracle ON); 70-glyph frozen fonts 192,856 B/12 woff2 (+guard, proven live); the reel
> mechanism + the FENCED VT spike at `useSections` (default OFF); the roster resolver + star
> ladders (37 tests); riders (stats.html precache, ConfTab resolve, boot-mirror `--bg`).
> **Four eyeball rounds made the chrome prototype-exact** (§7.1 has the full cause list —
> highlights: content scrolls UNDER the floating 68px nav pill; `--accent-fill` two-stop swept
> all 14 filled controls in one token edit; the appbar's excess height was an inherited
> `line-height`, the clear-mode illegibility was the kit's inherited text-shadow painting
> INSIDE the gradient-clipped wordmark; the bar→content gap is now the prototype's literal
> 0px, e2e-pinned; chat bubbles pulled FORWARD from G3 by owner ask — white/pink-hard-shadow
> + the prototype's 12.5px type; the composer says コマンド入力… via the NEW
> `ComposerSlots.placeholder` seam, D52 addendum `c26d1eb`). **Review record**: fresh-lens
> Opus council LOCK + Codex rounds 4→7 (slice SHIP WITH FIXES → wave NOT READY → closed →
> READY FOR OWNER EYEBALL); every finding ruled in plan §11 / folded; owner signed G0 at
> round 4.
> **▶ NEXT SESSION = G1 (the theme's face):** pin the Opus brief from **§7's G1 row + §6.4
> (the banner CONTRACT — slide identity by key, gesture state machine, timer matrix, inert
> slides, all owner-ruled) + §10.3/§10.4 recipes + §5.3's one shared resolver (already built,
> reuse it)**. Owner checkpoints riding G1: the promo-click→dossier proposal + all-hosts
> membership (veto-able), the katakana wordmark copy pick, promo JP caption picks, card
> geometry (feat/wide/counter/NEW ribbon) by eyeball, the zero-services ★1 floor confirm.
> Method unchanged (Opus build → main-seat audit → Codex → eyeball; expect fidelity WAVES —
> G0 took four rounds, that is the cadence working, budget for it).
> **Carried threads:** ① the **VT spike is UNTESTED** — owner runs
> `localStorage.setItem("ctrlb.spike.navVT","1")` on Fennec under gacha when convenient; it
> gates only G4's M2 (the observed swap-before-reel-covers is WHAT M2 masks; body-only
> deferred-display fallback pre-designed in §10.1). ② Chat 12.5px read-comfort check on
> device at G3. ③ The TTS-flash device eyeball (pre-gacha thread) — **dev units LEFT
> RUNNING** (:5434 + :5173), stop when done. ④ v1.5.0 = this theme's release; prod stays
> v1.4.6. ⑤ G6 = owner picks two accent-shift palettes (§4.4: ember/glacier REC'd over
> nebula/eridu).
>
> ## ▶ PREVIOUS BLOCK, same session (2026-08-02 — **🔒 GACHA DESIGN LOCKED: D52 RECORDED**)
> **The LOCK session ran exactly as prescribed.** ① The owner answered the seven open §8 items
> (reel every-switch · **default 5★** — emma carries 5–6 services · palettes = the 3 base-ramp
> variants PLUS **2 accent-SHIFTING variants** · JP sub-labels kept, must be REAL Japanese ·
> banner = fixed hero **+ live per-host promos, clickable AND swipeable** · oracle ghosted entry
> accepted · dossier = the frontier four) — all folded, §8 fully ruled. ② An Opus research pass
> sourced real gacha-game UI palettes → **four accent-shift candidates in §4.4**
> (ember/glacier/nebula/eridu, hexes + provenance; every contrast ratio re-computed by the main
> seat and confirmed; default pick ember+glacier, **owner picks the final two at G6**). ③ The
> council round: a FRESH Opus architecture lens (verdict **LOCK**; top finds: the roster config
> home → `themes:{gacha:{…}}` + the media-index read path · the missing dossier ACTION BAR ·
> `/api/media/{ns}/` namespacing) + **Codex round 4** delta (verdict READY WITH FIXES; top: the
> §6.4 carousel hardened into contracts — slide identity by key, gesture state machine, one-shot
> timer, inert offscreen slides). All 24 findings ruled in the plan's new **§11 reconciliation**;
> BOTH confirm rounds ran and their residuals (assignment-stays-client-side wording, BottomSheet
> 420 ms pinned, >8-slide prev/next keyboard path, zero-services ★1 ruled, stale-ref sweep) are
> folded. ④ **D52 recorded in DECISIONS.md** (rulings + committed kit extensions + the media
> threat model + rejections); plan/TODO/CLAUDE.md flipped to LOCKED.
> **Owner-flagged items riding the build eyeballs (veto anytime):** promo click opens that
> host's DOSSIER (proposed) · promos cover ALL hosts, sleeping dimmed ("for each pc" read
> literally; online-only is a one-line owner call) · the owner-drop dir moved to
> **`$CTRLB_HOME/media/gacha/`** (was `art/gacha/` — same ruled shape, namespace-generic
> mount) · the katakana wordmark string + promo JP copy = G1 eyeball picks.
> **▶ NEXT:** build **G0** (the settle-everything slice — the §7 row is the brief's spine,
> recipes §10; the kit seams unit lands FIRST as one commit; the VT-liveness spike needs the
> owner's Fennec at the checkpoint), then G1–G6, owner eyeball between slices. Carried threads:
> the TTS-flash device eyeball (dev units still running for it) · ledger §7.1 minimal-chrome
> overlap · **v1.5.0 = this theme's release** (prod stays v1.4.6 until then).
>
> ## ▶ PREVIOUS STATE (2026-08-02 late morning — **post-Phase-16 housekeeping + two owner asks SHIPPED; NEXT = the H1 GACHA DESIGN CONVERSATION**)
> **A short owner-driven session (rulings + two small slices), all pushed:**
> **① v1.5.0 RULED: stays RESERVED for the gacha theme (H1)** — Phase 16 does NOT take it; the owner
> also **deferred any prod update until gacha lands** (prod stays v1.4.6; no tag cut — Phase 16 +
> this session ride the post-gacha release, which is the natural v1.5.0). **② Gacha prototypes
> BANKED `37144c0`:** the owner's standalone round is FINISHED — the FINAL prototype is
> `design/prototypes/gacha/uploads/prot/capsule-arcade/index.html` (the rest = prior iterations,
> provenance); verified clean (no manifests/lockfiles — the Dependabot class stays dead; mock
> hosts.json; reference-art screenshots only); ROADMAP §H1 pinned to it. **③ The TTS flash
> rebuilt kit-wide `5c352ed`** (owner: "as it was"): `KitTtsFlash` in kit/AppBar.tsx — faithful
> 1.1 s pill on kit tokens, prev-ref (kills the old latent StrictMode first-paint flash),
> reduced-motion gate, mounted UNCONDITIONALLY in DefaultRoot's overlay zone (Codex R1 MED: the
> Conf switch must echo under off/minimal too), z 41 + the floating-launcher `:has` yield (its
> confirm-round LOW); 5 unit tests; the ledger's V4 "no kit counterpart" delta CLOSED. **④ The
> Chrome-Android favicon fix, same commit:** bookmark/home-screen tiles ignore the .ico and need
> PNG `rel=icon` 48+192 (Firefox reads the .ico — exactly the owner's symptom); `icon-48.png` via
> the gen-pwa-icons fan-out + two index.html links. NOTE: reaches the owner's phone only at the
> next deploy, and Chrome refreshes a bookmark's tile on the next visit — re-add the bookmark if
> stale. **⑤ Swap/tmpfs review flag CLOSED by owner** (rebooted; don't re-raise unless it bites —
> the TMPDIR discipline stands). Method: full FE gate green per commit (937 vitest, +5); Codex
> round + confirm round on the slice (1 MED + 3 LOW, all folded).
> **⑥ THE GACHA PREP SESSION RAN (same session, owner-directed): [`GACHA_PLAN.md`](./GACHA_PLAN.md)
> DRAFTED — Phase 17 in TODO.** The owner gave the requirements round (pinned as the plan's §2
> R1–R10: fidelity mandate · replaceable characters/background/transition-figure (smaller) · a
> config ROSTER gallery not linked to PCs · services-driven 1–5 stars w/ pink-gold top tiers +
> an optional 3-star mode · wallpaper + sticky-oracle ON by default · the rate pill live from
> online-host count · captions/JP kept · more dark-blue palette options). Method: main seat read
> ALL FIVE prototype files (357 ln) + drafted; ONE Opus seam pass (11 seams VERIFIED file:line —
> key verdicts: bespoke agent BODY = the oracle-header answer, no kit extension; `svcByHost` =
> the star input; only PING is real of the dossier's 4 metrics; NO user-image serving exists;
> ThemeId is a closed union); Codex round 1 = **NOT READY, 4 HIGH** (reel ordering vs the kit nav
> chokepoint + VT top-layer → now a G0 SPIKE; the single-scroller/bottom-pin oracle mechanics;
> roster conflation → split §5.1–5.5 + the read-only-dir middle option; the FALSE "authenticated"
> — the app has NO app-layer auth, tailnet = the boundary, media threat-model → D52) + 4 MED/LOW
> (3-tab `defaultLayout` at G0 · star data semantics/config home · the shared-extension ledger
> §4.9 · inventory precision) — ALL FOLDED; Codex confirm = 8/8 RESOLVED + 3 nits, fixed.
> **⑦ THE DEEP-RESEARCH ROUND RAN (same session, owner-directed "be extra sure"):** FOUR Opus
> passes (transition/VT · scroll+GPU · assets · kit fine-grain) synthesized into
> **GACHA_PLAN §10 — the implementation dossier + ranked risk ledger** (recipes with measured
> numbers: passive reel CONFIRMED prototype-faithful, pre-nav hook DROPPED, M2 needs its own
> chokepoint seam or dies at G0; oracle = wrapper-fade + child crossfade over a static blur;
> per-card backdrop-filter DELETED by design; fontsource JP REJECTED on measurement (757 KB/72
> req + 31 MB dist) → frozen 62-glyph committed subset ~140 KB; the media mount's Content-Type
> stored-XSS hole closed by an allowlist subclass; the kit fence list incl. the 2/4-tab layout
> obligation). Codex round 3 on the dossier: READY WITH FIXES — 3 HIGH all folded, incl.
> **reversing my theme-scoped composer recommendation because it contradicted LOCKED D37**
> (look-named shared skin it is). **PLUS the owner ruled 5 of §8 in-session:** roster = (b)
> read-only dir + gallery · stars = CONFIGURED services w/ exact ladders (§6.1 tables) ·
> wordmark = KATAKANA (brandText committed) · card geometry + reel size = in-slice eyeballs.
> §8 has SEVEN items left.
> **▶ NEXT SESSION — the LOCK session (clean, per the owner's directive):** 1. Collect the
> owner's answers to **GACHA_PLAN §8's seven open items** — each now carries its elaborated
> options + a standing REC inline (walked through in prose at close; **the owner left
> deliberating**: reel frequency (REC every-switch, cooldown as the eyeball valve) · default
> star mode (REC 3★) · palette variants (REC arcade/midnight/indigo, base-ramp only) · JP
> sub-labels (REC keep via a `subLabel` kit extension, Utils = ツール) · banner slides (REC
> the fixed faithful set) · oracle entry (REC accept the ghosted state) · dossier metrics
> (REC the 4-real-facts grid: Ping·Services·Last-seen·Status)). 2. Council round on the plan
> (the D51 shape — note Codex has already run THREE rounds; the council's FRESH lens matters
> more than another Codex pass). 3. Record **D52** in DECISIONS.md (incl. the §10.4 media
> hardening/threat-model + the committed kit extensions: brandText · look-named composer skin
> per the D37 lock · shared runViewTransition helper · subLabel if kept). 4. Build **G0** per
> the §7 ladder (recipes pre-pinned in §10; the one empirical spike = VT-new liveness on the
> owner's Fennec), owner eyeball between slices. Carried owner threads: the TTS-flash device
> eyeball (**dev units LEFT RUNNING for it** — stop them when done) · ledger §7.1
> minimal-chrome overlap · **v1.5.0 = this theme's release** (prod stays v1.4.6 until then,
> owner ruling).
>
> ## ▶ PREVIOUS STATE (2026-08-02 — 🏁 **PHASE 16 / D51 VAPOR ASSIMILATION COMPLETE, ALL PUSHED through `b4c2db6`**)
> **The session's arc (one continuous lock→build session, 2026-08-01→02):** council round on the
> draft plan (Codex correctness + Opus architecture lenses, both LOCK WITH CHANGES → reconciliation
> R1–R30 in the plan §7, both confirm rounds clean) → owner §5 answers code-verified (chat = kit
> look; Fleet stays as-is; **the prod logo 404 found + fixed `e28c590`** — a real bug behind the
> owner's "logo isn't visible") → **D51 LOCKED** → built V0–V6, every slice through the full method
> (Opus build → main-seat audit → Codex round → waves → owner D7 eyeball; **100% of review rounds
> produced ≥1 accepted finding**). Slices: V0 `381250b` cosmos=DEFAULT_THEME (flip-only + mirror
> matrix + PWA colors) · V1 `9c9d718` hygiene (9 git-mv, 20 keyframes, Waveform→safeRafLoop) · V2
> `5f70a16`+ shared data-accent (+ the PRE-EXISTING confrow label-crush fix `930a5e7`, reproduced
> on prod v1.4.6 — not a phase regression) · V3 `7668a1d` tokens.css + the 41-banner LEDGER
> (`VAPOR_BANNER_LEDGER.md`) + ratchet · V4 `873f85c`/`9b7fcfd`/`16d4412` THE PIVOT (VaporRoot=56
> ln on DefaultRoot; kit `brandMark` slot; bespoke chrome DELETED; owner-driven plan-pin fidelity —
> centered flush hanging-tab on kit hooks) · V5 `3456c03` the deletion ladder (extras.css 3028→204;
> 3 kit gaps filled incl. `.conf-foot a` broken on ALL kit themes; mini-player yields fixed) · V6
> `b4c2db6` equality fences + **sections waiver RETIRED (tab-count now works under vapor)** + lazy
> flip measured (5.3 KiB gz) → DROPPED + `.os-windows` glyph restored. **End state, test-enforced:**
> vapor = thin Root + pinned bespoke VaporFleet + tokens.css + ~900 CSS ln; net **−3113 CSS lines**;
> `CONTRACT_WAIVERS === {}`. Tests grew to **BE 1254 / FE unit 932 / e2e 144**; gate 6/6 on all 11
> commits + 3 docs commits.
> **▶ NEXT SESSION:** 1. **Owner's final V6 eyeball** if not done in-session (tab-count 3/2-tab under
> vapor · the ⊞ glyph on Windows hosts · daily use). 2. **The v1.5.0 conversation** — this phase is
> the natural candidate for the RESERVED tag (release = runbook §Release; prod still v1.4.6, rollback
> unchanged). 3. Backlog seeds from the phase: the kit-wide `minimal`-chrome plan/mini-player overlap
> (VAPOR_BANNER_LEDGER §7.1 — needs a kit-geometry slice) · owner ruling pending on wanting the old
> TTS toast back as a kit capability (died with vapor's bespoke appbar; flagged at the V4 eyeball,
> no objection so far) · **emma's 511M swap exhausted AGAIN this session (4 background review
> processes killed)** — the standing tmpfs/swap review item bites now. 4. `design/prototypes/gacha/`
> appeared untracked (owner's material for the future H1 gacha conversation) — left uncommitted.
>
> ## ▶ PREVIOUS STATE (2026-07-31 evening — **NEXT PHASE PICKED: Phase 16 VAPOR ASSIMILATION (plan drafted, design NOT locked) + C2 wake word researched & shelved; three docs commits on main, UNPUSHED**)
> **The session's arc (a planning/design session — zero code):** full project-map review → the owner
> picked two threads. **① Wake word (C2):** one Opus research pass → dossier **R14** banked +
> indexed (main seat re-verified the two load-bearing claims in primary sources). The verdict that
> reshaped §C2: the background ceiling is ANDROID's (a mic needs a `microphone`-typed foreground
> service; a web page can't create one) — Firefox background = structurally impossible (Fenix
> manifest declares no FGS permission), Chrome = architected-but-unproven; **Porcupine is DEAD**
> (free tier revoked 2026-06-30). ROADMAP §C2 split into **C2a** foreground pure-web (ship-viable,
> AudioWorklet + openWakeWord ~3.7 MB or sherpa-onnx `wasm/kws` ~19 MB zero-training) and **C2b**
> always-listening (= Capacitor WebView wrapper + mic FGS + native microWakeWord, ≈1 week — the
> Home Assistant shape). **Owner ruling: NOT now; someday possibly BOTH.** Commits `9258628`
> (dossier) + `ffdd230` (ROADMAP/TODO). **② Vapor assimilation = THE NEXT PHASE (16).** Owner
> rulings: **COMPLETE migration** (port component-by-component onto the kit, EXTEND the kit where
> vapor's look demands — brand-lozenge AppBar slot, kit `sheet` composer, chat via 3-gate/
> ChatSurface — then DELETE each legacy piece; no permanent bespoke remainder) and **cosmos becomes
> `DEFAULT_THEME`** (new V0 slice; fresh boots + heal target only, persisted choices untouched).
> Main-seat verification sweep: all six §14.15.3 hooks confirmed live, vapor.css refs 58/107/113/162
> still EXACT, B2 waiver constant at `themeContract.test.ts:53`, `extras.css` (~3000 vapor-scoped
> lines styling the shared components) identified as the deletion iceberg. Everything pinned in
> **[`VAPOR_ASSIMILATION_PLAN.md`](./VAPOR_ASSIMILATION_PLAN.md)** (slices V0–V5 + §4 kit
> extensions + §5 owner questions); TODO Phase 16 added; CLAUDE.md doc map updated.
> **▶ NEXT SESSION (the lock session):** 1. **Collect the owner's device-round answers** (plan §5:
> the Agent-tab port-vs-switch list · what simply DROPS · lozenge spin? · cosmos first-boot
> mode/accent — the owner is checking vapor on device meanwhile). 2. **Council round on the plan**
> (Codex + review per the method), fold, **lock the D-entry** in DECISIONS.md. 3. Build **V0**
> (cosmos default) then **V1+V2**, owner eyeball between slices. 4. Push the three docs commits
> with the owner's go-ahead. Prod stays v1.4.6; dev units stopped; the D2-A daily-use watch +
> Phase-15 open items carry unchanged from the block below.
>
> ## ▶ PREVIOUS STATE (2026-07-31 — 🏁 **PHASE 15 / D2-A MONITOR + PRESENCE WAKE COMPLETE (15a·15b·15c all WAVE CLEAN) + WEB PUSH RESEARCHED-THEN-PARKED; PUSHED through `2fbddee`, push CI pending at close**)
> **The session's arc:** owner picked Web Push (F1 ch.2) → two research dossiers (R10 stack · R11
> peers) → **PARKED by owner** after R10 showed it terminates in the SAME `showNotification()` that
> failed the channel-1 device round (park record + resume checks = ROADMAP §F1; both owner concerns
> dissolved on evidence — no real contact address needed, a +0-dep path exists). Pivoted to **D2-A**:
> two more dossiers (R12 tailscale presence — which KILLED the specced trigger for an always-on
> phone; owner's real usage = Tailscale OFF until wanted, so the plain edge is right and R12's
> home-endpoint predicate was deliberately dropped · R13 monitor-loop craft — the 12-line core,
> 3/2 damping, record≠notify) → **D50 LOCKED + Codex-amended** (phone ARMING machine · tailnet
> health gate · pinned transition fn · silent boot baseline · Event vocab status=OK both ways) →
> built in three slices, every one through the full method (Opus build → main-seat audit → Codex →
> waves): **15a** monitor+fleet Events (`4dbdcad`+`a583f59`), **15b** armed wake (`c82dbc9`+
> `b66633c`+`0cd25b8`+`109d359` — FOUR rounds; R3 caught the REVERSE dashboard-first double-wake
> after the D50 amendment CONDENSED AWAY the "checks both maps" half of the design finding — lesson
> recorded inline in D50 M3: keep BOTH halves of a read-and-write rule) · **15c** Conf UI in the
> SERVER group (owner ruling: no new section; `d31fbb1`+`f172c0c` — blank≠0 coercion, field-wise
> fallbacks, the floor's dual-role label). **Owner directive pinned by test: every machine defaults
> OFF** (`wake_on_presence`); per-host cooldown override; the shared 300 s map = the automatic-wake
> dedupe floor across BOTH triggers (only `cooldown_s: 0` removes it). Plus an owner device round
> mid-session: wrapped-seg line-fill · kit `.mrow-switch` layout · tcat 13px + full ModeSeg
> (`c67d7a2`) · the hosted-utils DOUBLE-MARGIN pair (nested confgroup + `.util` page inset — the
> host owns the inline inset; `f172c0c`+`2fbddee`, owner-verified). Tests **1199→1254 BE /
> 890→904 FE**; gate 6/6 on all 15 commits; dossiers R10–R13 banked + indexed.
> **✅ RELEASED + LIVE ON PROD as v1.4.6, same day** (runbook §Release via the ops agent; DB snapshot
> `ctrlb-20260731-143659.db.gz`; schema stays 5, no config migration; rollback = `update.sh v1.4.4`).
> **v1.4.5 BURNED** — its tag gate (the only e2e pipeline) went red on the a3 run-now sequencing
> test flake (the arbiter releases AFTER the history row terminalizes — the 409 was the server being
> right; same class as v1.4.3's); fixed `c33db18` (`_run_now_accepted` accept-when-idle, the 638ce7f
> invariant-not-winner rule); never deployed, NOT a rollback target. **The owner's phone (h20,
> `100.64.151.87`) is SET in prod `wake.presence_device_ips` via the settings API; every per-host
> `wake_on_presence` switch is OFF — the owner enables machines themselves. v1.5.0 stays RESERVED
> for the owner's next theme.**
> **▶ NEXT SESSION:** 1. Owner exercises D2-A in daily use on prod (per-host switches in the machine
> editor; watch for host up/down Events + the presence wake on a real arrival). 2. Dev units were
> RUNNING at close — stop them if the owner is done
> (`systemctl --user stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web`).
>
> ## ▶ PREVIOUS STATE (2026-07-30 night — 🏁 **PHASE 14 / A3 COMPLETE and ✅ LIVE ON PROD as v1.4.4**)
> **✅ v1.4.4 RELEASED + LIVE on emma 2026-07-30 night** (v1.4.1 → v1.4.4; the plain-form updater's
> THIRD clean run; DB snapshot `ctrlb-20260730-221525.db.gz`; **migrations v4+v5 folded on prod's
> first boot — health reports schema 5**; tag pinned + pid==MainPID + HTTPS verified; the
> automations API live with an empty roster; rollback = `update.sh v1.4.1` + that snapshot, since
> the schema advanced). Owner ruling: **v1.5.0 stays RESERVED** — this shipped as a patch tag.
> **TWO TAGS BURNED buying real fixes (tags are immutable; both are tagged but were NEVER deployed
> and are NOT rollback targets):** `v1.4.2`'s gate — the ONLY pipeline that runs e2e — caught the
> Conf tab CRASHING whenever `/api/automations` answered malformed (`automationsSummary` reduced
> over undefined; the e2e mock's unmocked-GET `{}` = any proxy error body in prod) → fixed
> `c928e41` (array-prove at both consumers + a realistic e2e fixture route). `v1.4.3`'s gate —
> two of the new M1 race tests were timing-pinned (the slow runner let the OTHER legal writer win
> first-writer-wins, and a sleep-vs-grace margin inverted; the PRODUCT invariant held) → rewritten
> scheduling-independent `638ce7f` (`_HeldTurn` event choreography · invariant-not-winner pins ·
> two latent same-class 14b flakes fixed; 15/15 repeat + 5/5 under 10× CPU starvation).
> **A3 device testing = PENDING VIA NORMAL USE (owner ruling at session close):** no formal round —
> the owner will exercise automations in daily use (create via chat → confirm → card → run-now →
> `automation_done` notification → unread → open-thread) and report anything off. Same posture as
> the F1 Fennec-delivery mystery, which that use will also probe. **v1.5.0 stays RESERVED.**
>
> ## ▶ NEXT SESSION — pick from the OPEN OPTIONS (owner will choose in a clean session)
> Phases 0–14 are ALL COMPLETE and live. Nothing is in flight; the next move is a fresh pick.
> The live menu, by likely value (each links to its design home — re-read it before proposing):
> 1. ~~**F1 channel 2 — Web Push**~~ → **RESEARCHED-THEN-PARKED 2026-07-31 (owner)** — R10/R11
>    banked; resume = the two phone checks in the ROADMAP §F1 park record (Fennec "Site
>    notifications" channel · which Firefox build).
> 2. ~~**D2-A monitor loop**~~ → **✅ SHIPPED 2026-07-31 as Phase 15 (D50)** — see the top block.
>    The F1 host-up/down notify toggle is now UNBLOCKED (the FE classifier gains the class when
>    F1 next moves).
> 3. **A4 slash commands** (ROADMAP §A4; TODO future row): the composer-as-console registry +
>    custom commands.
> 4. **A3 tails** (AUTOMATIONS_PLAN §Out of v1): notify-and-wait question policy (the A1+A2+F1
>    bridge — needs park/resume design) · `pinned` thread mode · rolling takeover/detach.
> 5. **D3 Slice 1 — multi-homed addressing** (ROADMAP §D3, designed 2026-06-30; flagged near-term
>    since 2026-07-16).
> 6. **A8 composer attachments** (owner-noted 2026-07-11) · **C3 chunked TTS** (owner-noted
>    2026-06-26) · **C2 wake word**.
> 7. **H1 "gacha" theme** (owner wants a design conversation, 2026-07-21) · the **vapor-assimilation
>    ladder** (THEME_ENGINE §14.15.3 — Phase 11's only remaining work).
> 8. **G security hardening** (known_hosts pinning · per-action tokens · secrets encryption-at-rest)
>    · **B1 memory backends** (vector MemoryProvider on the built 4f embeddings client) ·
>    **E0a per-tool settings** · **E1 bots**.
> 9. LOW backlog / polish: sendIcon/gradient-accent fills (the QoL cluster's unreached item 4) ·
>    **`SwUpdatePrompt.tsx`'s `onNeedRefresh` is DEAD CODE under `registerType:"autoUpdate"`**
>    (verified from installed plugin source, R10 §3.5 — the F26 "new version" toast can never fire;
>    fix = drop it or switch strategies, NOT a drive-by) · the F13 eslint-warning backlog
>    (Compiler prep, 40 warns) · e2e `fixtures.ts` carries no `notifications`/`monitor`/`wake`
>    blocks (degrades via FE fallbacks by design — extend when e2e next grows) ·
>    **F1 channel 3 (ntfy)** is the natural notifications continuation while Web Push sits parked.
> *(Parked/declined stay parked: ROADMAP §P · I1 worktree deploy · I2 env credentials · E2 facade ·
> A9 model indicator · vault/wiki spec.)*
>
> ## ▶ PREVIOUS STATE (2026-07-30 night — 🏁 **PHASE 14 / A3 AUTOMATIONS COMPLETE**: 14c + 14d built + review-clean same day; 14a–14c PUSHED CI-GREEN, 14d + docs UNPUSHED — since released, see above)
> **The whole automations feature is BUILT.** This session: pushed the 14a/14b stack (first CI run
> GREEN) → **14c surface** (`c4bc9fa`+docs `d3da383`, R3 WAVE CLEAN after Codex R1 DO-NOT-SHIP
> 4H/4M: REST router w/ 202-DETACHED run-now · Conf group 14 list + PromptModal-shell sheet on its
> own `auto-pm` z-45 layer · `openThread`+`loadGen`+`openSeq` in the chat store · shared
> `modalKeyDown` focus trap) → **PUSHED with the spinner/seg/F1-note commits, CI GREEN** →
> **14d tools** (one big commit, R2 WAVE CLEAN after R1 5×MED all accepted: `create_automation`
> confirm-gated create-only w/ the in-tool non-interactive DENY · `list_automations` headless-ok ·
> `Deps.automations` seam · EVERY run terminal records ONE Event via first-writer-wins
> `finish_run` · the headless confirm→DENIED conversion now AUDITED (`record_policy_denial`,
> decision="policy") · `automation_done` 4th notify class + stream-driven Conf invalidation ·
> the persisted created-card w/ Open-in-Conf jump). Live-smoked TWICE on dev incl. a REAL headless
> run (LLM turn → `ok` → exactly one terminal Event matching the FE predicate). Tests
> **1199 BE / 886 FE**. Gate 6/6 on every commit. As-builts: AUTOMATIONS_PLAN §As-built slices 3–4;
> TODO Phase 14 all ✅. Also this session: the STT transcribing spinner (`26fd1a7`, owner-requested,
> all four composers) · the `.mform` seg hug fix (`4bac951`, owner device round) · the F1
> Fennec-not-delivering note (`f5c93bc`, note-and-observe, ROADMAP F1).
> **▶ NEXT SESSION:** 1. Push the 14d + docs commits (owner confirmation). 2. Owner device
> eyeball of 14c/14d end-to-end (create via chat → confirm → card → run-now → notification →
> unread → open-thread), then **release when the owner wants A3 live** (runbook §Release; next
> tag likely v1.5.0 — migration v4+v5 fold on prod's first boot). 3. Carried: the F1 device
> mystery (Fennec delivers nothing — observe in daily use) · backlog unchanged (sendIcon/gradient
> fills · Web Push · ntfy · host up/down notify).
>
> ## ▶ PREVIOUS STATE (2026-07-30 evening — A3 AUTOMATIONS: design LOCKED + slices 14a/14b SHIPPED review-clean; ELEVEN commits on main, NOT PUSHED)
> **The A3 design conversation ran end-to-end and the feature is half-built.** Full arc: owner
> rulings (question policy skip|use_default · concurrency 1 · misfire skip · fresh-per-run +
> rolling option, `pinned` future · agent tool in v1 · agent-as-scope) → THREE research dossiers
> (**R7** scheduler: hand-rolled poll-and-claim + `cronsim`, APScheduler/croniter rejected on
> evidence; **R8** authoring + the per-task-placement addendum; **R9** attribution: 8/8 systems
> ADD an initiator dimension, never overwrite actor) + a codebase seam map → **council round**
> (Codex 15 findings + Opus-architecture 12, both SHIP-WITH-CHANGES; all folded; 2 overrules
> recorded) → **D49 LOCKED, owner-signed** · spec authority = **`AUTOMATIONS_PLAN.md`** (build
> against it + its §As-built deltas; TODO Phase 14).
> **✅ 14a — attribution (R3 WAVE CLEAN):** `3dd2d3b`→`262c9d5`→`b1ff4fb` + close-out `4c59fc7`.
> Events gain origin/origin_id/run_id/decision; REQUIRED `origin` kwarg at the invoke chokepoint;
> propagated through subagents; riders = **atomic-per-migration runner** (closed a pre-existing
> stranded-service crash window) + lenient event reads (`unknown` = read-side-only sentinel).
> **✅ 14b — the engine (R4 WAVE CLEAN, after R1 DO-NOT-SHIP 4H/4M/2L):** `22c102d`+`f3d0317`→
> `508f20a`→`573bad6`→`3d0ce03` + close-out `998ad48`. Migration v5, the atomic claim
> (misfire-grace, rev check, frozen snapshot), the runner driving headless turns THROUGH the turn
> machinery (reserve kind="automation" → `_build_session` → `_spawn_drain_task`; cancel/watch/caps
> work; honest terminals incl. `interrupted`), session options (message_actor=AUTOMATION,
> reflection re-keyed off origin), question_policy + choice chips, retention + orphan sweep +
> `automations:` config. Review caught real ones: the **DST-fold epoch regression** (cron next-fire
> must filter strictly-greater EPOCH), timeout releasing the arbiter early, thread-delete vs live
> turns (new non-task-bearing `prune` TurnKind; markers released only AFTER commit; endpoints
> revalidate AFTER reserve), and the **asyncio collapsed-cancels test trap** (two `cancel()` before
> a resume = ONE delivery — space test cancels by a scheduling step). Gate 6/6 on every commit;
> tests **1085→1162 BE / 801 FE**. Ruled residuals in the TODO 14b row (awaiting_answer audit row ·
> unbounded post-cancel wait). The `a3-automations-progress` memory carries the gotchas.
> **▶ NEXT SESSION, in order:** 1. **Push** (eleven commits `d4b82ff`…`998ad48` — owner
> confirmation, then first CI run over the stack). 2. **14c — REST + Conf UI**: `/api/automations`
> CRUD + run-now (409 via `runner.busy`) + runs/mark-read + schedule-preview; Conf "Automations"
> ConfGroup (list) + SHEET editor (presets + raw-cron escape hatch + live next-fires, agent picker,
> privilege chip, policy/results segs, history w/ unread). Seams are 1:1 ready: `AutomationDraft`
> IS the request body; errors NotFound|Invalid|CapReached|Busy|AgentMissing → 404/422/409/409/422;
> everything on `app.state` (`automations`/`automation_service`/`automation_runner`). Method
> unchanged: pinned Opus brief → main-seat audit → detached Codex round → waves to WAVE CLEAN →
> close-out. Start the dev units for the owner's eyeball when the UI lands. 3. **14d — the tools**
> (`create_automation` confirm-gated create-only + `list_automations` + created-card + F1 polish).
> 4. Carried: **the F1 notifications device round** — owner was to test PM 2026-07-30, result never
> reported; ASK. 5. Backlog unchanged (sendIcon/gradient fills · Web Push · ntfy · host up/down).
>
> ## ▶ PREVIOUS STATE (2026-07-30 morning — ✅ v1.4.1 LIVE; both releases today ran the PLAIN-FORM updater clean)
> **✅ v1.4.1 RELEASED + LIVE same day** (tag @ `5a6faed`; release gate green run 30526099548 incl.
> e2e; the plain-form updater's SECOND clean run, 1.4.0→1.4.1; health/pid/HTTPS verified; DB snapshot
> `ctrlb-20260730-102239.db.gz`; rollback = `update.sh v1.4.0`, no config-shape change). It carries
> the popover motion/skin slice below + the archive dependabot de-index (`050c2df`+`5a6faed`:
> lockfiles + prototype package.json deleted, flask requirements renamed — **zero indexable manifests
> left in archive/, dependabot alerts at ZERO, class dead**). Everything below is now PUSHED.
>
> **✅ v1.4.0 (the QoL cluster) RELEASED + LIVE on emma 2026-07-30** — tag @ `d6f3aae`, release gate
> green (run 30520253335, incl. e2e), **and the MILESTONE landed: the shipped `update.sh`'s FIRST
> PLAIN-FORM run** (`bash ~/apps/ctrl-b/deploy/linux/update.sh v1.4.0`) executed clean end-to-end —
> parsed the stamped marker, self-verified CI + health, 1.3.2→1.4.0, pid==MainPID, HTTPS serving
> 1.4.0. **The update chain is proven in its normal form.** Rollback target: v1.3.2 (no config-shape
> change). Wake-on-connect default: audited on owner request — already OFF at every layer and no
> flag set in prod or dev config; nothing changed.
> **Then the POPOVER MOTION + SKIN slice shipped same day (owner-requested), THREE commits on main,
> NOT pushed:** `f05bd26` slice (popovers join the `composerSkin` axis + plan-sheet open/close motion
> via stay-mounted `inert` + retention; per-skin chrome glass/bezel/sleek; `.priv-menu` fold; plan
> panels' latent `aria-hidden` focus trap → `inert`) → `e5c76e3` Codex wave (MED `:has()` handoff
> snap · retention release on transitionend + sync paths · rider/identity tests) → `165f7e0`
> micro-wave (`transitioncancel` closes the late-displacement retention leak). **Review ledger: R1
> SHIP-WITH-FIXES (1 MED + 2 LOW, all accepted) → R2 verify 2×CLOSED + 1 new LOW (the snap cancels
> the exit transition whose end-event released the rows) → R3 confirm: 3/3 sound, zero new, WAVE
> CLEAN.** Notable ruling: Codex's reactive-subscription fix overruled for `onTransitionCancel` on
> the existing handler. **Durable gotcha (caught by a failing test, would have shipped green
> otherwise): react-dom wraps ONLY `transitionend` as SyntheticTransitionEvent — `transitioncancel`
> arrives as the BASE synthetic with NO `propertyName`; read `e.nativeEvent.propertyName`.** Gate 6/6
> on every commit; both engines live-verified (Chromium + Gecko dispatch `transitioncancel` on the
> snap). ~~Next release carries this slice~~ → **shipped in v1.4.1 (above), OWNER-APPROVED on
> device 2026-07-30.** Dev units STOPPED at session close (on-demand — start when iterating:
> `systemctl --user start ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web`).
>
> ## ▶ PREVIOUS STATE (2026-07-29 — the QUICK QoL CLUSTER was COMPLETE + review-CLEAN, since released as v1.4.0)
> **All four cluster items BUILT, SIX Codex rounds closed, final verdict WAVE CLEAN (zero open
> findings). Nine commits on main, NOT pushed:** `39a7fdd` A2 autocomplete → `ad8ef82` A6 tools/skills
> menu → `a0bfdfa`+`0b0aad2` review waves → `04247c7` micro-wave → `0bfaf34` F1 foreground
> notifications + D2-B wake-on-connect → `7168521` transport wave (notifications publish on EVERY
> transport: live/buffered/turn.sync/re-attach) → `842398c` closing wave (suspended-reattach
> reconstruction · null-terminal guard · thread-scope capture · one permanent SW observer ·
> re-guarded create_task) → `db039fd` + this block = docs. Gate 6/6 on every commit; final counts
> **backend 1085 · FE 786/788**. Dev units RUNNING (:5434 + Vite :5173).
> **The review ledger (all closed):** R1 A2 SHIP-WITH-FIXES→wave · R2 A6+wave SHIP-WITH-FIXES→wave ·
> R3 verify all-CLOSED +3 LOWs→micro-wave · R4 slice3+micro SHIP-WITH-FIXES→wave · R5 verify on the
> wave 2×CLOSED/4×refine +1 MED→closing wave · **R6 verify: 5/5 CLOSED, no new issues, WAVE CLEAN.**
> Every finding fixed or explicitly ruled; rulings live inline in the ROADMAP F1/D2/A6/A-autocomplete
> entries. ACA core twice confirmed regression-free under adversarial scrutiny.
>
> ## ▶ NEXT SESSION — the checklist, in order
> 1. ~~Owner device eyeball~~ + ~~release~~ + ~~popover eyeball~~ — **✅ ALL DONE 2026-07-30**
>    (v1.4.0 then v1.4.1, both via the plain-form updater; **popovers OWNER-APPROVED on device**).
> 2. ~~A3 automations = THE DESIGN CONVERSATION~~ — **✅ DONE 2026-07-30 evening (see the top
>    block): design LOCKED as D49 + AUTOMATIONS_PLAN.md, slices 14a/14b BUILT review-clean.** The
>    original primer (kept for provenance):
>    **ROADMAP §A3 (lines ~116–128)** — automations invoke the agent on a schedule with a saved
>    prompt + privilege level (cron + prompt + privilege → unattended run; "2am: sleep idle GPU
>    boxes"). Sketched shape: `Automation { id, name, cron, prompt, privilege_level, target_thread,
>    enabled, last_run, last_status }` in SQLite + an async cron runner in the FastAPI process,
>    reusing the SAME agent loop + action registry headless; results land in the Event log + a
>    thread. **Open questions (the conversation):** what a headless run does at a `question`/
>    `confirm` gate (per-automation policy: skip / default / notify-and-wait — F1 notifications can
>    now carry the "waiting" ping) · concurrency limits · scheduler mechanism (APScheduler vs own
>    loop) · UI (Conf list per ROADMAP ~763). **Seams already built for it:** the F1 notification
>    engine · D2-B's wake service + `Actor` system actor (event-log attribution) · A5 `task_plan`
>    (makes headless runs legible) · D8 one-file tool registry · ACA routing/retry (D43). Also
>    weigh ROADMAP's "Notify when blocked" (A1+A3+F1 tie, ~line 76) and the D2-A monitor-loop tie
>    (~462, ~664). Do NOT start coding without the design conversation + owner sign-off.
> 3. **The F1 device round — owner tests the afternoon of 2026-07-30** (paper-verified only): on
>    the installed PWA via https://emma.lobster-vector.ts.net — enable Notifications in Conf (the
>    permission prompt rides the toggle gesture), background the app, trigger a confirm-gated action;
>    a notification should land (Android delivers via the SW registration — the constructor throws
>    there by platform design, handled). Known limit: the tap informs but doesn't navigate (custom SW
>    arrives with the Web Push slice). Also sanity-check wake-on-connect cooldown vs real reconnects.
> 4. *(folded into item 2 above)*
> 5. *(Backlog, owner-deferred, recorded):* the `sendIcon` setting + gradient-accent fills
>    (the cluster's item 4, never reached) · Web Push channel (custom SW, VAPID) · ntfy/bot channels ·
>    host up/down notify toggle (needs the D2-A/A3 monitor loop).
>    **Popover/menu `composerSkin` participation — ✅ SHIPPED 2026-07-30:** one shared popover shell
>    (`.kit-suggest` · `.tools-sheet`, with the drifted `.priv-menu` copy folded in) + per-skin chrome
>    for the two composer-anchored ones + the plan sheet's open/close slide, via mounted-when-closed
>    `inert` (which also closed the plan sheet's own latent `aria-hidden`-over-focusable trap).
>    →ROADMAP §A2, THEME_ENGINE §14.16/§15.
> **Residuals ledger (all LOW, all recorded where they belong):** armed menu pick lost on 409/Stop-
> harvest · cross-device notification-prefs staleness while hidden (PUT-echo fixed same-device;
> polling declined) · id-less-transport turns share a thread-scoped dedupe key (bounded, tested) ·
> confirm-permission prompt text isn't persisted → reconstructed notifications use the degraded
> "<tool> is waiting" body (key identical) · cold hidden load announces a just-ended turn within
> `linger_s` (owner-approved semantics) · "default + don't auto-route" not expressible on the wire
> while `agent.auto_rotate` is on · a11y e2e scans only tab panels, not composer chrome.
> **Ops notes for the next session:** harness background-Bash is killed at ~10 min — long Codex runs
> go `setsid nohup … &` from a FOREGROUND call + a Monitor on the OUTPUT FILE; `$!` after setsid is
> the dead wrapper, not codex (match by `pgrep -f "codex exec"`, judge liveness by LOG GROWTH). The
> `second-opinion` skill + the `qol-cluster-shipped` memory carry the same notes.
>
> ## ▶ PREVIOUS STATE (2026-07-28 night — ✅ **v1.3.2 IS LIVE ON EMMA**)
> **The stabilization patch SHIPPED as `v1.3.2` (= `92241a4`; `v1.3.1` = `983f7dc` stays tagged but
> was NEVER DEPLOYED — it carries the updater bug below; not a rollback target).** CI release gate
> green (run 30386540373, 4m12s, e2e ✓) · cutover via the **bootstrap form of the FIXED
> `update.sh`** (supervisor ruling — the on-disk v1.3.0 copy was the broken one; runbook §Release now
> documents the bootstrap form as the broken-updater recovery path) · migration correctly "not
> needed" (marker stays 1) · DB snapshot `ctrlb-20260728-201917.db.gz` · health ok/**1.3.2**, pid ==
> MainPID (81309), config 0600, HTTPS ingress serving 1.3.2 · rollback one-liner names v1.3.0
> correctly (the fixed soft read, verified in the field) · dev units stopped (on-demand) · everything
> pushed through `92241a4` + tag; post-release: this handoff amendment + the runbook note
> (commit-only, push with the next batch). **Remaining owner-facing item: a device spot-check of the
> UI at https://emma.lobster-vector.ts.net.** Next session: whatever the owner picks — the patch
> charter is DONE (all 5 device findings · the triaged sweep · the draft-loss fixes · two Codex
> rounds + a verify round · the release-blocker fix `0f87652` with its real-writer/real-reader test).
> **▶ THE RELEASE STORY (owner gave the go 2026-07-28 evening):** the push + annotated tag `v1.3.1`
> (@ `983f7dc`) + CI release gate (run 30385055513, green incl. e2e) all succeeded — **and the cutover
> was REFUSED pre-flight (exit 78, prod untouched at v1.3.0): the shipped `update.sh` could not parse
> the marker line its OWN migrator writes** (`config_version: 1  # …` — the ruamel end-of-line comment;
> `parse_version` rightly rejects it; the v1.3.0 bootstrap run passed only because the config was then
> UNSTAMPED — the first stamp broke the first shipped-script run). The ops agent stopped per its brief,
> prod verified byte-untouched. **FIXED `0f87652`** — `marker_value()` cuts at the first `#` at both
> call sites; new `test_update_sh_marker.py` stamps a config with the REAL migrator and runs the REAL
> script's functions under `bash -euo pipefail` (3 tests). **Ruling: release proceeds as `v1.3.2`
> (v1.3.1 stays tagged, never deployed) via the BOOTSTRAP form of the FIXED script** — the runbook's
> manual fallback was rejected because it would leave prod holding a broken updater; this way prod
> lands a working update chain and the NEXT release finally exercises the shipped-script path.
> **What shipped in the patch (all owner device findings + triaged sweep + two review rounds):**
> - **The 5 device findings:** stop glyph = stroked square, family box, stroke 2.4, vapor-ratio sizes,
>   nudge-exempt centering (owner-iterated on device) · app-bar contract — visible bar 85%+blur14
>   (vapor's proven strength), **appbarMode=minimal gets a 34px scroller inset** (the owner's real mode
>   — his screenshot cracked it; content started at y=0 under the floating launcher), clear bar slimmed
>   64→50px + content pulled up −14px (owner round 2) · frontier fleet = the codebase's FIRST min-width
>   breakpoint (700px, auto-fill minmax(240px,1fr), art bounded ~240–380px, phone 2-col untouched) ·
>   **#4/#5 picker disclosure SKIPPED (owner ruling)** — design shelved in ROADMAP §P.
> - **The sweep (triaged IN, all shipped):** SYS-5 /api JSON-404 guard · SYS-6 save_settings fenced ·
>   SYS-9.2 composer /agent set refresh (agents was the gap; skills/providers already wired) ·
>   SYS-10 theme drift test · SYS-17a+b voice caps as config fields (+ bounded STT read) · A-fallbacks
>   no empty `fallbacks: []` · A-steps1 chain self-fallback dedup (registry, NOT the fold) · A-steps2
>   actionable bare-`models:` refusal at build_plan · A5-x /compact too-small = benign noop · A-verb
>   verified already surfacing (no change; strict 422 pinned).
> - **The ConfTab draft work (main-seat ruling: M1 loses nothing — one global save; the LOSS vectors
>   fixed):** save-diff + dirty + providersDirty all diff against the DRAFT EPOCH (`seededRef`), never
>   live query data (the Slice-8 LWW race + the fabricated-409 sibling Codex found) · AgentsEditor =
>   full epoch semantics via shared `pickAgentSection` projection + submitted-snapshot reconcile on its
>   OWN mutation instance + call-time re-entry ref (a shared instance DETACHES the first call's
>   observer — I1's class; the Codex verify round caught it) · AgentRow detail value-guard.
>   **Per-section granularity stays DEFERRED (D42 follow-up, recorded in DECISIONS) — cosmetic once
>   the loss vectors are closed.**
> - **Review record:** full-patch Codex round (DO NOT SHIP → 4 findings, all accepted; the ASGI
>   receive-limiter prescription REJECTED on the tailnet threat model — bounded read instead) → fix
>   wave `9e595ba` → **Codex verify round (FIX THE FIXES: 3 closed, HIGH re-opened on the observer
>   detach)** → `859bdd2` closes it with the reviewer's own prescribed minimal form; loop ruled closed.
> - **Owner rulings this session:** QR-to-phone DELETED → **ROADMAP §P "Parked — not planned"** (new
>   section; sweeps must skip it; the parked-items memory says why) · whisper-warm TTL closed as
>   misconception (his server unloads at 30min idle by config) · picker disclosure skipped.
> - **Residuals recorded, NOT in this patch:** per-section draft granularity (D42) · theme cold-load
>   mode/accent (M1, accepted) · never-settling-PUT wedge (L1, accepted) · `hold(ep)` chat-gate dedup ·
>   SYS-2/3 structural · F9/F13 (lint now **40 warnings**, all deliberate F13-class — UI_AUDIT row
>   updated) · MemoryEditor latent reseed shape (primitive-dep protected).
> - Session notes: a mid-session REBOOT + a usage-limit kill both recovered clean (one half-done
>   SYS-6 rename finished by hand; agents relaunched) · `docs/Screenshot 2026-07-28 182629.png` is the
>   owner's untracked reference shot — his file, not committed.
>
> ## ▶ PREVIOUS STATE (2026-07-28 morning, superseded — kept for the release record)
> **✅ v1.3.0 IS LIVE ON EMMA (2026-07-28).** Tag `v1.3.0` = `d386099` · CI release gate green (run
> 30365243491, 4m23s) · cutover via the **bootstrap-form `update.sh`** (its first real run — clean,
> exit 0) · **the A11 fold ran on prod: config_version 0→1, all 11 legacy keys folded, config
> backup `config.yaml.20260728T135338Z`, DB snapshot `ctrlb-20260728-155338.db.gz`** · health
> ok/1.3.0, pid == MainPID, config 0600 · **the three provider renames are applied**
> (`emma-speaches` / `vault-speaches` / `vault-alltalk`, refs cascaded server-side, secrets followed
> their providers, voice stt+tts live). Post-tag on main: the postcss/sharp dev-dep bumps
> (`8f482e2`) + doc syncs. Backend 1051 · FE 629 passed/631 · `check.py` 7/7 incl. e2e on the tag.
> ~~New LOW: update.sh's success-path rollback hint~~ **FIXED `f1b267d`** — the hint is now
> version-aware ($from's runner VERSION vs the on-disk marker; one-liner only when $from can read
> today's shape; fragment-tested under `bash -euo pipefail`). The owner's device spot-check is DONE
> — findings below.
>
> ## ▶ NEXT SESSION (locked by the owner, 2026-07-28 night): the QUICK QoL CLUSTER
> **One small session of daily-use wins — all four have recorded seams in ROADMAP; read each entry
> BEFORE designing (the canonical flow: this file → ROADMAP → DECISIONS → DESIGN → TODO):**
> 1. **A2 — composer autocomplete** (ROADMAP §A: "viable + cheap, FE-only"). The composer's verb
>    sets (skills/agents/providers, `lib/composer.ts`) are the data; they now refresh on CRUD +
>    settings saves and carry response-generation guards (v1.3.1), so the source is trustworthy.
> 2. **A6 — composer tools/skills menu** (ROADMAP §A: "layout seam already exists, zero contract
>    change").
> 3. **F1 — foreground notifications** (ROADMAP §F: "v1-trivial") **+ D2-B PWA-connect wake**
>    (ROADMAP §D2: "trivial, no new deps").
> 4. *(Room permitting, cosmetic seams already wired:* the gradient-accent two-channel fills ·
>    the `sendIcon` composer setting.*)*
> **Method:** design-first per item (each is small but net-new UI → VAPOR_PATTERNS/THEME_ENGINE
> before styling; D36/D37 hooks for anything in the chat/composer tree) · Opus builds from pinned
> briefs · ONE Codex round over the wave (small slices included — the standing rule) · start the
> dev units for the owner's eyeball · pause per slice for the owner. **Release when the owner says
> so — and that release is the shipped `update.sh`'s FIRST plain-form (non-bootstrap) run:**
> `bash ~/apps/ctrl-b/deploy/linux/update.sh vX.Y.Z` — the fixed updater is on the prod tree now.
> **A3 automations is the agreed NEXT DESIGN CONVERSATION after this cluster** (the biggest
> unlocked capability; needs the full design-first treatment).
>
> ## ▶ DONE (2026-07-28, shipped as v1.3.2): the v1.3.1 STABILIZATION PATCH charter
> **The owner's charter, in his words: "I want to fix every single small piece that isn't working
> as intended… check every older system that has been implemented by now, and every issue, every
> improvement, and everything that we left behind… let's make this release completely stable and
> functional."** No new roadmap features until this ships. Two work sources:
>
> **A. The owner's v1.3.0 device findings (fix all):**
> 1. **Chat STOP button is off-theme** — outline-styled and larger than its siblings; make it
>    consistent with the sliding button family, per theme. (Find the stop control in the shared
>    chat tree — D36 class hooks — and style it through each theme's existing button recipe, not a
>    bespoke rule.)
> 2. **minimal theme: the app bar has no spacing below and paints OVER content** — section titles
>    in the Agent, Tools, and Conf tabs sit under it. Related but distinct: **frontier's app bar
>    sits on top of the "N LIVE" hint** in the fleet header art. Audit the app-bar/content spacing
>    contract across ALL four themes rather than patching per-tab paddings twice.
> 3. **frontier fleet: host-card images grow far too large on wide screens** — the 2-column grid is
>    wrong at desktop widths. Cap the card/art size or add columns at a breakpoint; owner likes the
>    current behavior at narrow (2-col) widths.
> 4. **Inference (chat backend) provider picker offers the voice providers**
>    (`emma-speaches`/`vault-speaches`/`vault-alltalk`) with nothing saying what KIND of endpoint a
>    provider is. Owner: "that should be more clear". DESIGN FIRST (Fable): providers deliberately
>    have no `kind` field (D48 — any provider may serve any role); the fix is likely picker-side
>    disclosure (api_mode + which sections reference it) or capability hints, NOT a hard type
>    system. Check D48 + the R1 dossier (capability discovery) before choosing.
> 5. **Embeddings model picker offers chat models** (e.g. gemma on openrouter) for the embeddings
>    role. Owner is unsure it's even feasible to filter an external catalog by embedding
>    capability — investigate (R1 §capability discovery covers what peers do); if infeasible,
>    disclosure over filtering. Same design pass as #4.
>
> **B. The left-behind sweep (inventory, then triage into the patch):** the recorded residuals
> (this file: the two steps.py LOWs, the theme mode/accent-during-cold-load residual, the
> never-settling-PUT wedge note, the reserved-verb fail-open, empty `fallbacks: []` cosmetics) ·
> `docs/SYSTEM_AUDIT.md` addendum (the ASYNC240 lexical blind-spot list) · `docs/UI_AUDIT.md`
> deferred F-items (incl. F13, the 27-warning eslint Compiler-prep backlog) · any ROADMAP "v1 seam"
> notes marked cheap-now. Method: one Opus inventory agent sweeps the docs for every recorded
> residual/deferral; Fable triages what makes the patch; Codex reviews the fixes; ship as v1.3.1
> via `update.sh` (its first NON-bootstrap run — the shipped script drives it end-to-end).
> - **▶ 2026-07-28, Fable main seat: the recommended pre-tag Codex pass RAN — and earned its keep
>   again.** Verdict FIX FIRST: 4 confirmed defects in the previous fix wave, all closed in
>   `edba2b9` (HIGH: provider identity ops now FREEZE on `savingRef` mid-save — delete/recreate
>   during an in-flight rename crossed the old credential onto a NEW endpoint; MED: `switchTheme`
>   returns a `SwitchOutcome` and pickTheme persists only on `"applied"` — a refused switch was
>   persisted, deferred, and auto-applied; MED: the settings queryFn now threads TanStack's
>   AbortSignal so a cancelled GET can't overwrite the fresh providers-rev with its stale header —
>   false 409s; LOW: a card's own queued rename source is exempt from the serverNames guard so
>   undo works, safe only WITH the freeze). A fifth finding (validator msg echoes the submitted
>   provider name) was **OVERRULED**: names are documented public identity (they ride `loc`,
>   `GET /api/settings`, composer verbs) and the echo returns the single user's own typed input.
>   The fix set got its own Codex verification round; its two findings were **ruled residuals**:
>   M1 (a mode/accent pick during a cold theme load loses to the incoming theme's defaults) is
>   pre-existing local semantics that the fix made server-CONSISTENT (pre-fix was strictly worse —
>   the interleaving could un-persist the switch), and L1 (a never-settling PUT freezes identity
>   ops) requires a fetch the browser's own timeouts don't bound, and the same ref has gated
>   `onSave` since the previous wave — reload recovers. The main session also audited the whole
>   update workflow hands-on (runner · steps · install.sh · update.sh · boot preflight ·
>   chokepoints · README bootstrap form): sound; two recorded LOW residuals (identical legacy
>   local/cloud endpoints → self-fallback; bare `models:` on a hand-migrated provider → generic
>   sanitised refusal).
> - **The release (UPDATE_PLAN slice 8) is the ONLY remaining work**, and §17.2's preconditions
>   **0–6 are all closed**, including **6b — the recovery rehearsal**, which found and fixed a HIGH in
>   the installer (`install.sh prod` silently repointed the LIVE systemd unit when run from any other
>   tree; `SYSTEMD_USER_DIR` + a drift test).
> - **Then two audits landed on A11 and changed the shape of the day.** The parked backend deep audit
>   (SHIP WITH FIXES) and a first-ever **frontend** audit (**DO NOT SHIP**, four HIGHs, two of them
>   credential-handling) were both worked to completion, then **re-reviewed twice more** — and each
>   re-review found HIGHs *in the fixes*, including fixes to fixes. All closed.
> - **The credential defects are worth knowing about even after the fact** (they shape the invariants
>   now guarding them): a display mask with nothing stored was written to disk AS the credential; a
>   rename could hand an old provider's key to a NEW connection pointing at a different host; and
>   rejected requests echoed the submitted document — including `api_key` and `ssh_password` — back to
>   the client, **through two doors** (our own handlers, and FastAPI's automatic request validation,
>   which opens first). Each is closed at a CHOKEPOINT with a drift test, not at the call site.
> - **▶ THE ONE OPEN QUESTION — RESOLVED 2026-07-28:** the owner said yes; the pass ran, found 4
>   real defects (see above), the fixes shipped in `edba2b9` and were verified in their own round.
>   **What remains is the release itself, awaiting the owner's push confirmation:**
>   push → **v1.3.0** → tag → wait for the CI release gate → the **bootstrap-form**
>   `update.sh` → prod's three provider renames.
> - **What this session did NOT do:** update D48 / UPDATE_PLAN with the fix-wave record (the commit
>   messages carry it in full), and it did not push anything.

> ## ▶ ACTIVE — develop ON emma. PROD = v1.2.1 (2026-07-21). **On main, UNRELEASED: A11 COMPLETE
> (chat + voice/embeddings) + D3 slice 3 + the 2026-07-26 fix wave.
> ▶ **[`UPDATE_PLAN.md`](./UPDATE_PLAN.md) SLICES 1–7 ✅ ALL BUILT + REVIEWED (2026-07-26/27).** The
> runner (**§11**) · the fold's move out of the config load path (**§12**) · env overrides (**§13**, which
> **overturned its own spec** — the `CTRLB_PROVIDERS__…` overlay was ruled against and the env-secret
> promise RETRACTED, on [R6](./research/R6-env-overrides-and-secret-provenance.md) evidence) · the
> import-time boot refusal (**§14**, measured under systemd) · `install.sh` (**§15**) · Windows parity
> (**§16**) · `update.sh` + the runbook rewrite (**§17**). Gate **7/7 incl. e2e**, backend **1042**, tree
> clean, **31 commits UNPUSHED**.
> **▶ SLICE 8 IS THE RELEASE, AND EVERY PRECONDITION IS NOW CLOSED (§17.2 steps 0–6, 2026-07-27).**
> 0+1 manual belt-and-braces backups + `install.sh dev` end-to-end · 2 the two §17.1 `update.sh` fixes +
> all four slice-6 §16 corrections verified in the tree · 3 **the owner ratified all three D48 Slice-2
> interpretations** · 4 **the A11 pre-release fix list is BUILT** (`8841386` the MUST-FIX: a mask with
> nothing to restore is dropped, not written as the credential · `4a056aa` the MED bounded gate wait
> [ratification ③'s condition], the LOW masked `providers_rev`, and the test gaps) · 5 **the D48
> amendment + doc sync** (`73a7637`) · 6 **full gate 7/7 on the release sha + the §10 real-config
> rehearsal on THREE inputs** (prod-legacy, the dev legacy backup, the already-migrated dev config):
> clean check/apply, idempotent re-apply, 0600, marker 1, four roles resolve, secrets set-equal, and the
> **only** comment loss is the three documented inline ones on consumed keys.
> **▶ WHAT REMAINS IS STEP 7 ONLY — the release itself, and it needs the owner: push, pick the version,
> tag, wait for the CI release gate, then `update.sh`.** ⚠ The first release MUST use the **bootstrap
> form** — `update.sh` ships *in* this release and does not exist on v1.2.1:
> `git -C ~/apps/ctrl-b show <tag>:deploy/linux/update.sh | bash -s -- <tag>` (README §Release). Two
> things the release still OWES prod after the cutover: prod's config migrates to **host-port slug**
> provider names (`127.0.0.1-9000`, `192.168.1.137-9000`, `192.168.1.137-7851`), so re-apply the same
> three renames dev got (`emma-speaches` / `vault-speaches` / `vault-alltalk`), and re-add by hand the
> three inline comments the fold drops if they are wanted. §10 is the slice list, §8 the owner rulings,
> §9 the council record.
> **Agent discipline now lives in [`.claude/skills/second-opinion/SKILL.md`](../.claude/skills/second-opinion/SKILL.md)** —
> read before spawning Codex or subagents.
> **▲ WORKFLOW: see the READ-FIRST block at the top of this file** — since 2026-07-28 the main
> seat is **Fable 5 on high**, Opus 5 (high) subagents carry the heavy token work, Codex
> `gpt-5.6-sol` high co-reviews. *(The 2026-07-24 Opus-main arrangement that previously stood here
> is superseded.)* — v1.2.1 = the seg stadium-trick patch on top of v1.2.0 same night: ACA Slices 1–8 + the D45/D46 reasoning arc + D47 multi-homed s1–2 + UI polish; both released via runbook §Release by the agent — v1.2.0 gate 29801506922, v1.2.1 gate 29802230245, both green incl. e2e; **the prod config riders are LIVE: `api_mode: llamacpp` + `max_concurrent_requests: 1` on local, `api_mode: openrouter` on cloud**; snapshots `ctrlb-20260721-063649` + `-065258.db.gz`. Prior: v1.1.1 2026-07-16 · v1.1.0 2026-07-10 · v1.0.0 same day.
> **✅ ctrl-b v1.0.0 (tag `v1.0.0` = `8fa8404`) deployed to emma per the D32-amended plan — first try,
> release gate green on its maiden tag run (full gate + Playwright e2e on ubuntu).** As-executed record:
> the PRE-FLIGHT block atop [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md); living runbook: `deploy/linux/README.md`.
> - **PROD:** `~/apps/ctrl-b` (sparse, tag-pinned) → `~/.ctrl-b` → :5433 →
>   **https://emma.lobster-vector.ts.net** (Tailscale Serve HTTPS; phone + mic verified by the owner)
>   **+ direct `http://emma:5433`** since v1.0.1 (bind 0.0.0.0 — owner waiver 2026-07-10, SECURITY_MODEL §2.1).
>   Fresh DB (as decided). Fleet ICMP/WOL verified from the systemd service (all 4 hosts online).
> - **DEV:** workspace `~/github/ctrl-b` (`main` — the invariant: it never leaves main) → `~/.ctrl-b-dev` →
>   uvicorn :5434 `--reload` + Vite :5173. Git hooks (`core.hooksPath=.githooks`) + `[dev]` toolchain in.
>   **ON-DEMAND since the D32 AMENDED-2 ruling (owner, 2026-07-10):** the two dev units are installed but
>   not boot-enabled — `systemctl --user start ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web` when
>   iterating, stop when done.
> - **Agents (D32 AMENDED-2):** TWO boot instances of the template `ctrl-b-agent@.service` **in the
>   workspace** — `@fable` → tmux **`ctrl-b-fable`** (`claude-fable-5`, high) and `@opus` → tmux
>   **`ctrl-b-opus`** (the `opus` alias = latest Opus, **Opus 5**, high); attach: `tmux attach -t
>   ctrl-b-opus`. **Fable 5 on high is the MAIN model (owner, 2026-07-28; Opus 5 held the seat
>   2026-07-24 → 28)** — Opus 5 works as high-effort subagents and via its own session when the
>   owner drives it; both units stay enabled. Match the model to the session:
>   `tmux display-message -p '#S'`. The launcher
>   waits (≤60s) for network before starting claude — RC registers at startup and doesn't retry
>   (post-reboot finding). One writer per tree at a time (simultaneous second writer → worktree).
>   Effort/perm overrides via `~/.config/ctrl-b/agent[-<i>].env`. The one-time first-clone *trust prompt*
>   was cleared by the owner (runbook §agent notes it). **Claude dev framework migrated — emma's
>   `~/.claude/projects/-home-emma-github-ctrl-b/memory` (35 files) is the CANONICAL memory now**; git
>   identity + settings merged. **Dev sessions happen ON emma from here on; the corsair/Windows checkout
>   is FROZEN (plain clone, reference only; corsair = just a managed fleet host).**
> - **Voice (owner, same day):** both instances re-pointed via `PUT /api/settings` (hot-reload) to emma's
>   local **speaches :9000** — STT `istupakov/parakeet-tdt-0.6b-v3-onnx` (parakeet v3) · TTS
>   `speaches-ai/Kokoro-82M-v1.0-ONNX` voice **`bf_isabella`**; fallbacks = vault (`.137:9000` whisper /
>   `.137:7851` tts-1); per-endpoint `api_key` (schema field already existed). Verified end-to-end
>   (dashboard TTS→STT round-trip, exact transcript, `X-Voice-Served-By: primary`). **Inference stays on
>   vault's llamacpp `.137:5001` (owner-confirmed; corsair's instance unused).** The target's `config.yaml`
>   is canonical — the Windows snapshot is stale by design (bootstrap re-runs won't clobber).
>
> **▶ CURRENT WORK (updated 2026-07-14): frontier **F4 — the Agent tab — is ✅ COMPLETE and
> owner-ratified** (commits `61f2267`→`696842f` [9]; six owner eyeball rounds; mid-build adversarial
> audit: 1 bug [scroller mask clipped the sticky appbar] fixed same round; FE gate 415 tests).**
> Shipped: **D36 + THEME_ENGINE §15 — the chat hooks + token contract** (themes reskin the ONE shared
> chat tree on pinned class hooks; never fork) · AgentTab's log extracted to the shared
> `components/ChatThread.tsx` + `usePlanOpenAutoClose` re-homed to `<AppEngines/>` (the A4 ⚠ resolved
> structurally) · `FrontierAgent` bespoke body: sticky-pinned bobbing rig stack that RECEDES to a
> 0.72/0.18 living watermark (`data-thread`, `/clear` reverses), title-top scroll-free empty state +
> 2 composer-filling chips, see-through shell over the `in oklab` dusk-glow, prototype bubbles (black
> user / transparent bot, who-line right). **Owner rulings now standing (override the prototype): NO
> OUTLINES theme-wide in frontier** (fill-differentiation everywhere; exceptions = fleet `0x…` plate
> tags [now bottom-right on the art] + kit Clear-appbar chrome; focus rings kept) · accent-repainted
> plan family (wordless accent-count pill · accent done-ticks · accent Reboot/Wake). **Kit/global
> riders:** `AppbarMode` **"transparent"** (Conf "Clear") — null-paint bar, squared glass iconbtns,
> `--bg` brand halo, ONE `appbarShown()` predicate · the LINE composer grows as a rounded square
> (999→24px, flex-end; r18+6=24 concentric corners) + `kit-btn-pop` · the flexbox min-content
> `min-width:0` overflow fix on EVERY composer variant (the pill used to clip mic/send) · docked
> placeholder → "Message" · tab indicator cap 88px. **Removed after live jank:** the agent-tab
> scroller mask (masked scroller + bobbing child re-rasterizes per frame — no agent edge fades by
> design).
> **frontier F5 ✅ CLOSED — THE FRONTIER THEME (T5) IS COMPLETE (owner sign-off 2026-07-15 on the
> Gate D §0 walk, 18/18 PASS; a 3-lens adversarial review [TS/CSS/docs] + full e2e 109/109 preceded
> the close).** *(Slice record below kept as the as-built history; authoritative record =
> the `FRONTIER_PLAN.md` banner; the axis architecture = **D37 + THEME_ENGINE §14.16**.)*
> *(The F5 re-scope's parked pair is RESOLVED — the asset pass SHIPPED 2026-07-16 `6e7a29a`
> [hero.png 1.9MB→551KB] and the art-override UI was DROPPED by the owner, the backend
> `host.appearance.frontier.image` field being sufficient. Only the FINAL hero ART remains, on the
> owner.)* **Slice A ✅ SHIPPED 2026-07-13 (`5193f4c`, owner-eyeballed live + ratified, FE gate 422):**
> chat no-outlines promoted to the kit-wide `outlines` axis — `kit/axes.ts` factory+resolver
> (undeclared themes→ON) · `kit/axes.css` in the NEW `@layer base, theme, axes, reset` position
> (strips-only, NEVER fills, `.kit`-scoped) · `body[data-outlines]` stamped by an AppEngines
> `useLayoutEffect` (never `applyBodyAttrs` — store↛registry) · minimal/cosmos default ON, frontier
> OFF (pixel-identical) · "Outlines" switch auto-renders in Appearance. **Slice B ✅ SHIPPED 2026-07-15
> (`6c78d17`+`a433c8f` [round 2], owner-eyeballed live + ratified; adversarial audit clean; all 12
> layout×skin combos live-verified [Playwright computed-chrome matrix]; FE gate 427; as-built record =
> D37 AMENDED 2026-07-15):** the `composerSkin` axis, EXPANDED at the owner's pre-build review to FOUR
> skins + the LAYOUT DEDUP — the `composer` seg = the three real layouts `[stacked, sheet, line]`
> (borderless/ghost wrappers DELETED; stale synced values degrade, no migration code); the skin seg =
> `outline`|`glass`(old Borderless)|`bezel`(frontier's sweep — round 2 generalized the bezel to EVERY
> layout after the owner's "docked has no bezel" eyeball)|`sleek`(old Ghost); segs declared ADJACENT
> (ConfTab renders declaration order); kit.css "composer skins" base-layer section; frontier.css no
> longer styles composer chrome (D37 authority rule); KitComposer picks the glass arrowhead glyph by
> resolved skin (the one sanctioned TS seam). "Composer icon setting" PARKED (owner → ROADMAP).
> **F5 gates: A ✅ + C ✅ SHIPPED 2026-07-15 (Gate A `5c0a504` = all six a11y fixes, FE gate 431;
> Gate C `10e355b` = frontier-render.spec deep-drive + frontier axe arm + the firefox Playwright
> project [ci installs chromium+firefox], e2e 109/109; as-built record + the A2 pointer-capture
> review fix = the `FRONTIER_PLAN.md` banner + §9 STATUS block). The 4 §9 owner rulings RESOLVED —
> incl. ④: the cosmos "minors" were first closed as non-issues — **then SUPERSEDED same day by Gate B
> round 1's on-device evidence (code DID change: B3+B4)**; cosmos offline-row dim-LED visual accepted.
> ROADMAP gained the cosmos host-sheet planet-switcher chevrons (owner idea, 2026-07-15).**
> **Gate B ✅ CLOSED (owner, 2026-07-15 — two on-device rounds).** Round 1 found real issues —
> theme-switch scroll loss + cosmos chop on Firefox desktop/Fennec (REOPENED+superseded ruling ④'s
> "non-issues") + frontier cube chop on Fennec — and shipped 5 revertible-one-commit fixes
> `16e8c21`..`69cde60` (scroll-keep · Gecko-only sheet-slide blur drop [NEW `body[data-engine="gecko"]`
> branch, THEME_ENGINE §14.11] · planet-transition delete · Gecko-only grain swap + dive filter drops ·
> frontier glow off the bobbing layers). Round 2 re-eyeball: "the rest looks good" with ONE deliberate
> acceptance — the cosmos sheet-slide keeps its mild Gecko chop; the blur-drop cure read worse and was
> REVERTED (`10203e6`; the engine branch + `data-settling` stamp stay). Full record + revert paths =
> the §9 GATE B ROUND 1 block.
> **Gate D ✅ WALKED (18/18 PASS, §9 GATE D WALK block) + OWNER-SIGNED 2026-07-15 → F5 CLOSED.**
> **The two sign-off clarifications SHIPPED same day: K1 `1281d10`** — sheet-open composer hide/slide
> promoted to the KIT DEFAULT (the theme population is CLOSED: no new themes, existing themes formalize
> onto the kit — rule-of-three superseded; ROADMAP vapor-assimilation entry AMENDED) · **K2 `a578141`** —
> frontier gradient accents via `--accent-fill` (swatch-mirrored 150deg gradients; `--accent` stays flat;
> owner-eyeballed + ratified). **COSMOS also feature-CLOSED 2026-07-15: the host-sheet planet-switcher
> chevrons `d26a498`+`87eadf1`** (stepId wrap-around over the orbit order; build-caught gotcha: content
> near the sheet handle needs z-index above its invisible 16px drag hit-strip; ROADMAP entry closed; the
> uptime "—" stays deferred on a backend boot-time seam). ALL PUSHED, CI green through `87eadf1`.
> *(F0–F3 shipped 2026-07-12, F4 2026-07-13; the `FRONTIER_PLAN.md` banner holds all as-built records.)*
>
> **▶ SESSION 2026-07-16 — UI-polish close-out: 4 local commits `6e7a29a`→`4e85dbf`, NOT PUSHED;
> owner plan: eyeball → push → PRODUCTION RELEASE same day PM (runbook §Release; version
> v1.1.1-vs-v1.2.0 undecided).** Shipped: hero.png 1.9MB→551KB (`6e7a29a` — palette-256+oxipng,
> quality-eyeballed; the parked F5 asset pass CLOSED; the art-override UI DROPPED by owner — the
> backend `host.appearance.frontier.image` field suffices) · the **SettingRow sweep** (`0d32e35`,
> 28 rows DOM-identical — Bucket-A's one real carry-forward; Bucket-A itself was found ALREADY
> SHIPPED 2026-06-27, stale row fixed) · **a release-blocker found+fixed: the e2e contrast gate had
> been BLIND on frontier since K2** (`9dfe07e` — `color: var()` devolves on an `<image>` token; the
> probe now resolves via the `background` shorthand and gates EVERY gradient stop per §14.15.1-⑨;
> the tokens were always WCAG-compliant, worst 4.66:1; unseen because push CI skips e2e — only the
> tag release gate runs it) · docs reconciled (`4e85dbf`). Full gate `check.py --e2e` **7/7 GREEN**
> on the tip; dev units RUNNING for the eyeball. Loose thread (owner-aware, not requested): the
> placeholder hero art has a baked-in "LEARN MORE" pill top-left under the map scrim — a paint-out
> with sampled sky is a 15-min follow-up if ever wanted.
>
> **✅ EXECUTED same day (2026-07-16): the four fixes SHIPPED — `f5c8e05` (SYS-16 ruff ASYNC+B
> ratchet pulled + its 3 findings fixed) + `69c02a1` (hero pill paint-out, 560,472 B). Full gate
> `check.py --e2e` 7/7 GREEN on the tip. ▶ ✅ THE PM RELEASE SHIPPED same day: **v1.1.1 LIVE ON
> PROD (2026-07-16)** — owner OK'd (version call = v1.1.1: patch, fixes/polish only; **v1.2.0 is
> reserved for the FINAL frontier hero art** — owner ruling at release time) → pushed `main`
> (`3576315..b3d13d6`, pre-push gate 6/6 + main CI green) → tag `v1.1.1` @ `b3d13d6` → release
> gate GREEN (run 29501070297) → re-pinned `~/apps/ctrl-b` + `install.sh prod` (DB snapshot
> `ctrlb-20260716-151348.db.gz`) → verified: `git describe` = v1.1.1, health version 1.1.1,
> HTTPS 200. Dev units stopped.**
>
> **▶ SAME DAY (2026-07-16 PM): ACA SLICE 1 ✅ EXECUTED — ALL LOCAL, NOT PUSHED; owner eyeball
> pending (dev units RUNNING).** Pre-build: a 3-agent re-verification pass (code-truth vs HEAD +
> research refresh + pluggability/vault research) → ACA **v2.3 amendments** pinned in the doc; §6
> Q3 ANSWERED (owner: CONSUME); the owner's **vault idea PARKED** (no formal spec — standing
> requirement = whole-functionality enable/disable toggles like tools/skills; memory
> `vault-parked-enable-disable-pluggability`). Then the 5-wave orchestrated build (Opus 4.8 high
> subagents, per-wave hand-review + own-gate-run): MCP whole-lifecycle deadline +
> `call_timeout_s` · timeout-normalizer guard + SSH 30s backstops + the machine-enforced
> `ADAPTER_BOUNDED` deadline policy · `agent.subagent_child_timeout_s`/`skill_min_overlap`/
> `skill_max_active` de-hardcoded + confirm-token CONSUME-on-remint · call-scoped stall guard +
> malformed-args JSON-repair steering (empty-string keeps the legacy zero-arg path — orchestrator
> ruling) + `ORDER BY ts, rowid` + `_static_prefix` docstring truth · per-endpoint `extra_body`
> cache pin + cache telemetry + the A8 context-cost debug line + `_finalize` wrap-up
> `tool_choice:"none"` (live-probed on the deployed llama-server). **Then the post-build
> ADVERSARIAL AUDIT (fresh-eyes Opus pass): 12/12 spec-complete, contract compliant, ONE real
> find — MED-1, a malformed-args call behind a confirm bubble silently invoked with `{}` on
> resume — reproduced + FIXED (`ToolCallPart.invalid_raw` replaces the memory-only side-channel;
> regression test); LOW/INFO findings ruled + recorded on the §5 Slice 1 heading. Riders: the
> summarizer `complete()` cache pin + the SECURITY_MODEL ACA-9/extra_body rows. Full gate
> `check.py --e2e` 7/7 GREEN on the tip; 298 backend tests (+44). As-built record =
> AGENT_CHAT_AUDIT §5 Slice 1 heading.**
>
> **▶ SESSION 2026-07-17 (the checklist below EXECUTED through step 4): ① model check ✓ ② dev units
> up + owner eyeball ran — round 1 found the DISMISS RETRY LOOP, fixed same session (`2e4bc18` +
> `3638ac5`, see the note inside step 2 below) ③ PUSHED with owner OK (14 commits `6a9ac4c..3638ac5`,
> pre-push gate 6/6, main CI GREEN) ④ **ACA SLICE 2 ✅ EXECUTED + ADVERSARIALLY AUDITED — ALL LOCAL,
> NOT PUSHED; owner eyeball pending.** Design review first per the plan: code-truth re-verify
> (3-agent) + an owner-directed SEVEN-AGENT source-level field pass (opencode/Goose/Codex/pi/Hermes/
> Gemini/Claude Code — turn-state, busy handling, cancel persistence, storage atomicity; findings
> pinned in ACA §5 v2.4-S2-F) → **D38 LOCKED** (`868cf8a`) → 4 Opus build waves (`afb5e22` txn CM ·
> `e228089` turn registry · `26a0bdb` shielded-finally · `dfd42d2` client+mode) + audit fixes
> (`1d2c002`). Fresh-eyes audit: NO HIGH/MED, spec+contract clean. Full gate 6/6 every wave; backend
> 324 tests, FE 25 store tests. As-built record = ACA §5 Slice 2 heading. **Slice 2 eyeball script:**
> ① two rapid-fire messages on one thread → the second gets the "// a turn is already running" note
> (not an error bubble) ② mid-turn `/clear` → blocked note ③ `/local` + "reboot corsair" → deny at
> the bubble → check the resumed turn stays local (dev log shows the endpoint) ④ mid-turn plan-dot
> tap → nothing happens (guard) ⑤ normal turns. NEXT after eyeball+push: Slice 3 (durable turns,
> design review first — D35 proposed in §5) or owner's pick.**
>
> **▶ 2026-07-18: SLICE 2 PUSHED after an 8-angle pre-push code review (owner /remote-control
> order; 5 review fixes incl. the runShell 409 miss + the modeByCall ACA-16 pin + the turn-guard
> invariant test; main CI GREEN @ `24015e5`). Owner then PARKED per-slice formal eyeballs (bugs
> surface through daily use; rigor moves to design+build — memory `testing-parked-wing-it`) →
> ACA SLICE 3 (durable turns) RAN THE FULL PIPELINE same day: 5-source field research
> (opencode/LibreChat/Codex/OpenAI-background/Goose+pi+Hermes+CC) + a code-truth pass → **D39
> LOCKED** (`0cb9e09`; a 4-HIGH adversarial DESIGN review was resolved INTO the decision before
> build) → 4 Opus waves (`fc500ef` A11+reconciler · `622f258` the server-owned drain-task core ·
> `5a135aa` endpoints/terminal-cache/shutdown/#116720 · `d7ea3a7` client re-attach/seq-gate/Stop)
> → fresh-eyes audit (NO HIGH; 2 MED client fixes + release-first ordering landed, `b7b4ca6`).
> Backend 354 tests, FE store 31; full gate 6/6 every wave. **Turns now SURVIVE disconnects**
> (phone lock / app kill → the cold-load probe re-attaches; Stop button on EVERY composer;
> crash-recovery reconciler at boot). As-built = the ACA §5 Slice 3 heading. **Slice 3 is LOCAL,
> NOT pushed (`0cb9e09..b7b4ca6` + docs) — the 8-angle pre-push review runs next, then the owner's
> push OK. NEXT after push: Slice 4 (turn speed — per-call persistence + streaming + parallel
> dispatch, the one structural `_run_calls` refactor; design review first) or owner's pick.**
>
> **▶ SESSION CLOSED 2026-07-18 (clean handoff) — ✅ ALL 16 COMMITS PUSHED (`24015e5..3347ed9`,
> pre-push gate 6/6; CI watch was green-tracking at close — verify `gh run list` if in doubt). Dev
> units STOPPED (on-demand ruling). NEXT SESSION, in order:**
> 1. **/model check** (fable-5 + HIGH; Opus 4.8 high subagents for mechanical work; **Codex
>    `gpt-5.6-sol` high = the STANDING foreign pre-push reviewer** — `codex exec -m gpt-5.6-sol -c
>    model_reasoning_effort=high -s read-only`).
> 2. **Confirm main CI green** on `3347ed9` (the push landed at session close).
> 3. **ACA Slice 4 (turn speed) — DESIGN REVIEW FIRST**, the full pipeline: field research (the
>    same 7-agent set; per-call persistence / parallel tool dispatch / streaming-while-tools-run
>    are the topics) + code-truth pass → adversarial design review → D40 → Opus waves → audits →
>    the tri-review incl. Codex. Slice 4 owns THE one sanctioned `_run_calls` structural refactor
>    (cross-slice contract) — per-call persistence supersedes the wave-1 tail wrapper; read ACA §5
>    Slice 4 + the §7 formal-audit record first (its accepted-debt list names what Slice 4 should
>    sweep up: subagent-safety test pins, skills-zero-context boundary, `result_sig` fidelity).
> 4. Owner may also pick: ROADMAP D3 Slice 1 / 6c-1/6c-2 flags, or the vapor ladder (Phase-11 tail).
> **Standing session rules:** per-slice eyeballs PARKED (`testing-parked-wing-it`) — bugs surface
> via daily use; rigor lives in the pipeline. Commit autonomously/clearly; push needs the owner's
> word. Run gates under `set -o pipefail` (a piped gate once swallowed a failure).
>
> **▶ SAME DAY (2026-07-18 PM): the 8-angle review + a TRI-REVIEW (Codex CLI joined as the foreign
> second opinion — found 2 HIGHs three same-family rounds missed) + then the owner-ordered FORMAL
> AUDIT of every agent functionality and every ACA fix: an Opus matrix (F1–F28 + all fixes) →
> FIVE Codex cluster verifications (`gpt-5.6-sol` high, read-only) → 5 HIGH / 16 MED / ~14 LOW
> found, ALL dispositioned same day in three gated fix waves (`9cc7e93` confirm-flow fail-closed:
> decision Literals, token revoke-on-deny + re-mint single-liveness, pre-invoke RUNNING persist,
> turn-scoped cancel · `0583507` machinery: the empirically-proven dual-shield persistence tail,
> commit-failure rollback, terminal-cache preference, never-started-task cleanup, OpenAPI
> wall-clock backstop, compaction suspend protection, executable ACA-21 fallback, live template
> cache pin · `a9e5199` resume skill continuity + buffered-question pins + probe race + proposal
> truths + a 7-item regression batch). Full record = **ACA §7**; accepted-with-reason items listed
> there. **CODEX IS NOW A STANDING PRE-PUSH REVIEWER for structural slices** (owner directive).
> Backend 397 tests / FE 40; tip gate 7/7 incl. e2e @ `a9e5199`. ~16 commits LOCAL — awaiting the
> owner's push OK.**
>
> **▶ SESSION 2026-07-19: ACA SLICE 4 (turn speed) ✅ EXECUTED end-to-end — THE FULL PIPELINE —
> ALL LOCAL (`44bdfdd..62ab584`, 10 commits), awaiting the owner's push OK.** Design first:
> 7-agent×3-topic source-level field research (a usage-limit cutoff mid-research was re-run as
> per-repo gap-fills — nothing re-bought) + a code-truth pass (7 sketch contradictions pinned) →
> a 3-lens adversarial DESIGN review (3H/9M resolved INTO the decision; headline: the prefix
> narrowed to builtin-authored `read_only` ONLY — idempotent ≠ order-independent) → **D40 LOCKED**
> (`44bdfdd`; owner go, incl. the **llamacpp rider** `InferenceEndpointCfg.max_concurrent_requests`
> — the owner's backend has 1–2 NON-QUEUING slots; per-endpoint semaphore held for the whole
> stream, never across tools). Then 5 Opus waves (schema/gate → classifier → the `_run_calls`
> async-generator inversion + per-call ONE-txn persistence → the parallel executor head → notices/
> debt riders), a MID-BUILD audit after wave 3 (its prefix↔tail checklist = wave 4's pre-flight),
> a POST-BUILD fresh-eyes audit (NO HIGH/MED; 2 LOW fixes `df5ce7a`), and **the Codex tri-review:
> 1 HIGH the same-family rounds missed (permit released WITHOUT closing the abandoned stream →
> `c961e8d` close-before-release) + a 4-LOW regression batch (`62ab584`)**. Full record = the ACA
> §5 Slice 4 as-built heading. **Turns now stream + persist each tool result AS IT RESOLVES and
> run read-only batches in parallel** (multi-host ping ≈ max not Σ). **NEXT SESSION:** ① owner
> push OK → `git push` (pre-push gate runs full) ② owner config: set `max_concurrent_requests: 1`
> (or 2) on the LOCAL inference endpoint in `config.yaml` (None = unlimited = today's behavior)
> ③ live poke via dev units when desired (`testing-parked-wing-it` stands — no formal eyeball)
> ④ next slice = owner's pick: ACA Slice 5 (steering queue) / Slice 6 (compaction v2, design
> review first) / ROADMAP D3 Slice 1 / 6c-1/6c-2 flags / vapor ladder.**
>
> **▶ SAME DAY (2026-07-19, continued): SLICE 4 PUSHED (owner OK; `44bdfdd..1e112b5`, main CI
> GREEN @ `1e112b5`) → ACA SLICE 5 (steering queue) ✅ EXECUTED end-to-end — 15 commits LOCAL
> (`0d000d4..5e383d6` + the close-out docs), awaiting the owner's push OK.** The full pipeline:
> code-truth + 6-system field pass (Codex fact corrected: core drains at turn END) → 2-lens
> design review (5H resolved in) → **D41 LOCKED** → 5 Opus waves (queue core+202s → drain A →
> drain B+cancel → FE → **the owner-directed DESIGN/SPEC docs sweep** [8 stale-claim clusters
> fixed]) → mid-build audit (4 MED fixed) → post-build audit (**2 HIGH: the feature was
> UNREACHABLE from the UI** [composer guards; a composer-DRIVEN test is now house pattern] +
> all-exec drains rendered nothing — fixed) → **Codex: 7 HIGH/1 MED/1 LOW, its largest haul**
> (async interleavings: delayed dones, lost Stop responses, thread-switch races, the task-less
> all-exec drain, the successor-queue harvest) → two gated fix waves (`7adf8b2` backend incl.
> the D41 cancel AMENDMENT [`?turn_id=` scope-before-harvest] + the replayable harvest receipt;
> `5e383d6` FE incl. stream-generation ownership) → a fix-set verifier: **all 9 CLOSED, no
> regressions**. Tip gate 7/7 incl. e2e. **You can now TYPE (or voice) MID-TURN — Enter/mic
> steer, the button is Stop; queued bubbles are tappable-to-remove; Stop returns drafts to the
> composer.** As-built = the ACA §5 Slice 5 heading. **NEXT: ① owner push OK (15 commits;
> pre-push runs the gate) ② owner config when it reaches prod: `max_concurrent_requests: 1` on
> the LOCAL inference endpoint (the Slice-4 llamacpp rider; None = today's behavior) ③ live
> pokes per `testing-parked-wing-it` (the ACA §5 Slice 5 LIVE-VERIFY list) ④ next: ACA Slice 6
> (compaction v2 — design review first, the `context_window` prerequisite) or owner's pick.**
>
> **▶ SESSION CLOSED 2026-07-19 (clean handoff). Slice 5 PUSHED + main CI GREEN @ `f80c1d9`.
> SLICE 6 DESIGN PHASE ✅ COMPLETE — D42 v4 AWAITING THE OWNER'S LOCK: the full draft is
> [`docs/SLICE6_PLAN.md`](./SLICE6_PLAN.md)** (pipeline: 2 code-truth + 3 field passes + a
> 2-lens adversarial review [4H resolved in] + TWO owner direction rounds — ① settings surface
> [Conf UI knobs, hot at next turn] + window discovery [llama.cpp `/props` probe > config >
> fallback, source-verified] ② fallback windows [free-ride on the unified endpoint object] +
> per-agent output budgets ON ModelRef [the summarizer gets capping free; reserve_output
> subtracts from the trigger] + reasoning effort/tokens [= ACA A10 SCHEDULED; universal ladder;
> llama.cpp translates `off`→enable_thinking:false, silently-drops the rest — verified]).
> **NEXT SESSION, in order:** ① /model check (fable-5 HIGH) ② confirm CI green @ `f80c1d9` ③
> owner reads SLICE6_PLAN → **LOCK D42** into DECISIONS.md → ~6 Opus build waves (schema/config
> +probe → estimator/trigger → clearing+summarizer+thrash → reactive+ModelRef wire → Conf UI →
> the DESIGN/SPEC docs sweep) + mid/post-build audits + the Codex tri-review — the standing
> pipeline. ④ **Dev units LEFT RUNNING** (owner intends to poke Slice-5 steering on :5173 —
> ⚠ dev drives the REAL fleet; stop the units after). ⑤ Owner config reminders:
> `max_concurrent_requests: 1` on the local endpoint (Slice 4) · `context_window` per endpoint
> once Slice 6 ships. **OWNER DIRECTIVE REITERATED at close (standing, memory
> `orchestrate-with-opus-subagents`): Fable 5 = ORCHESTRATOR + FEATURE REVIEWER ONLY, alongside
> Codex (`gpt-5.6-sol` high) as the standing co-reviewer; ALL specified implementation /
> mechanical work / research = Opus 4.8 subagents — never burn Fable on menial tasks.**
>
> **▶ SAME WEEKEND (2026-07-19, the next session): D42 LOCKED (owner go) → ACA SLICE 6 (compaction
> v2) ✅ EXECUTED end-to-end — 12 commits LOCAL (`d8c6744..2e4dac9` + this close-out), awaiting the
> owner's push OK. Final tree gate 6/6; backend 617 / FE 507 tests.** The full standing pipeline:
> D42 transcribed into DECISIONS (`d8c6744`) → SIX Opus waves (schema/config+probe `681310f` →
> window ladder + fraction trigger + served-endpoint pricing + the anchored estimator `76b4a85` →
> clearing tier + 5-section summarizer + `/compact <instructions>` + thrash machine `f9c43bb` →
> the `_call_config` ModelRef wire + the reactive overflow backstop `7313155` → the Conf UI
> surface `c3d1dec` → the DESIGN/SPEC/deploy/config-example docs sweep `c04e1f4`+`08ade3e`) →
> MID-BUILD audit (1 HIGH: anchored clearing double-credit → the exact-delta fix `483dc6a`) →
> POST-BUILD audit (GO; polish `2acd592`) → **Codex tri-review: 2 HIGH/6 MED/2 LOW NOT-READY →
> two gated fix waves (`2e4dac9` backend: the app-owned EndpointGates [a settings PUT split the
> D40 cap across client generations] + `_finalize` joins clearing/backstop; `b1d0262` FE)** → a
> fix-set verifier: **all 9 CLOSED, no drift, no regressions** (1 MED deferred with reason: the
> pre-existing ConfTab draft lifecycle). D42 carries the AMENDED-as-built list; the full record =
> the ACA §5 Slice 6 heading. **You can now: set per-endpoint context windows in the Conf UI (or
> let the local one auto-probe /props) · watch old tool outputs trim for free before any paid
> summary · `/compact focus on X` · cap any agent's output + reasoning effort per agent · survive
> a context overflow via the one-shot fold+retry.** **NEXT SESSION, in order:** ① owner push OK
> (12+1 commits; pre-push runs the full gate) ② owner config when it reaches prod: the deploy
> README §"Inference tuning" — `context_window` per endpoint (cloud manual), the anchoring
> telemetry flags (local already pinned via `return_progress`; cloud wants
> `stream_options.include_usage`), consider disabling llama.cpp context-shift so overflows
> surface ③ live pokes per `testing-parked-wing-it` (the ACA §5 Slice 6 LIVE-VERIFY list) ④
> next: ACA Slice 7 (model routing & retry visibility — design review first) or Slice 8
> (approvals) or the owner's pick (ROADMAP D3 Slice 1 · 6c-1/6c-2 flags · vapor ladder).**
>
> **▶ NEXT DAY (2026-07-19→20, same session): SLICE 6 PUSHED (owner OK; `f2aed3f..0ed9d80`, main
> CI GREEN @ `0ed9d80`) → ACA SLICE 7 (model routing & retry visibility, D43) ✅ EXECUTED
> end-to-end — and ✅ PUSHED same day (owner OK; `0ed9d80..0977e91`, main CI GREEN @ `0977e91`).
> Final tree gate 6/6; backend 668 / FE 514 tests.** The full pipeline: 2 code-truth + 1 sourced
> field pass (Goose's lead/worker retreat; pi's classifier; the retry-consensus table) → my D43
> draft → 2-lens adversarial review (7H/13M/4L — **`lead_turns` DROPPED**, both lenses converged)
> → TWO owner discussion rounds (the fallback-chain-vs-routing clarification landed on: "like a
> fallback, but escalating to the designated smarter model after crash-and-burn turns"; retry
> reshaped to the GLOBAL `inference.retry_attempts: 2` + per-endpoint override) → **D43 LOCKED**
> (`8c4a7b2`) → 5 Opus waves (`de88a54` failover-async-generator + classifier + visible
> transient retry tier → `c748b58` typed events + `retry_status` snapshot + degraded-notice
> deletion → `fa50a09` the failure-fallback routing machine → `4a62857` FE → `77ea3a9` docs) →
> post-build audit (GO; 1 MED + 2 LOW → `0b46f19`) → **Codex tri-review: 3 HIGH NO-GO (the
> routing lifecycle — thread-global route lock vs D41 fresh-during-suspend; live-config re-deref
> on resume; conclude-before-finalize counting a cancelled turn) → ONE unified fix
> (`c00a640`): per-suspended-call ModelRef SNAPSHOTS + turn-local flags + conclude-after-finalize
> — closed all three and DELETED two state fields** → verifier: all 6 CLOSED, no drift. **You
> now get: visible in-place retries on busy servers (`// retrying local in 2s…`) instead of
> silent model switches · live `// failover → cloud` narration · a retry line on phone re-attach
> instead of a dead spinner · and optional two-tier routing (set `agent.defaults.routing:` in
> YAML — after N crash-and-burn worker turns the designated lead model takes over for M turns,
> announced both ways).** As-built = the ACA §5 Slice 7 heading; D43 AMENDED-as-built.
>
> **▶ SESSION CLOSED 2026-07-20 (clean handoff; both slices pushed, main CI green @ `0977e91`).
> Dev units LEFT RUNNING** (:5434 + Vite :5173 — the Slice 5/6/7 LIVE-VERIFY pokes are all still
> outstanding per `testing-parked-wing-it`; ⚠ dev drives the REAL fleet — stop the units after:
> `systemctl --user stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web`). **NEXT SESSION, in
> order:** ① /model check (fable-5 HIGH — the app selector may default low) ② owner config when
> desired: `agent.defaults.routing:` (config.example has the block) — retry needs NOTHING
> (global default 2 shipped per the owner's ruling); the Slice-6 reminders stand (deploy README
> §Inference tuning: per-endpoint `context_window`, the cloud `include_usage` anchoring flag,
> the ctx-shift note) ③ live pokes when desired (the ACA §5 Slice 6 + Slice 7 LIVE-VERIFY
> lists) ④ **prod is still v1.1.1** — release via `deploy/linux/README.md` §Release when the
> owner wants Slices 4–7 live on :5433 ⑤ next: ACA Slice 8 (approvals evolution — design review
> first, aligns with ROADMAP privilege levels/D16) or the owner's pick (ROADMAP D3 Slice 1 ·
> 6c-1/6c-2 flags · vapor ladder · the parked Composer Surface). **The standing directives hold:
> Fable 5 = orchestrator + feature reviewer alongside Codex (`gpt-5.6-sol` high); ALL specified
> implementation / mechanical work / research = Opus 4.8 subagents.**
>
> **▶▶ SESSION 2026-07-23 (later) — A11 SLICE 2 (voice + embeddings) ✅ BUILT + TRIPLE-REVIEWED + GATED
> — A11 IS FEATURE-COMPLETE. The 2 Slice-1 D48 calls were OWNER-RATIFIED at session start (recorded in
> D48 AS-BUILT); Slice 2 then ran the full pipeline: 2-agent code-truth maps → 11 orchestrator rulings →
> Opus build waves `e7e60bb` (backend) + `29a3712` (frontend) → docs wave (config.example new-shape ·
> README · runbook §Rollback A11 CONFIG block; SECURITY_MODEL was already right) → fresh-eyes Opus audit
> [0 HIGH · 2 MED] + Codex gpt-5.6-sol high review [NO-GO: 1 HIGH + 5 MED + 2 LOW, every finding
> code-verified + ruled] → 7-fix wave `a62faa6` → Codex fix-set verification [**GO-with-changes**:
> 1/3/5/7 + FE guard CLOSED, rulings internally consistent, no new defects] → full `check.py --e2e`
> **7/7 GREEN** (backend 876 pytest · FE 604 vitest · e2e green · pyright 0). LOCAL COMMITS, NOT PUSHED.**
> Headline review catches (both now fixed + regression-pinned): the config-write chokepoint had a
> PRE-EXISTING umask bug stripping `config.yaml` to 0664 on every write — every writer now goes through
> an fd-opened 0600 tmp + `os.replace` (self-heals) · the migration write-back would have materialized
> env-only secrets into YAML — the fold now runs twice (disk-truth for the write-back, env-truth for
> runtime). Shipped shape: ONE shared `_build_section_chain` (inference refolded, behavior-identical) +
> frozen per-section policies · rebuild-together generation publish + refcount drain on Voice/Embeddings
> clients · voice/embeddings migration folds (dedup against existing providers, host-port slugs,
> per-field accretion, 32-char-safe suffixes) · shared FE `SectionRefEditor` (Inference refolded
> DOM-identically) · per-model voice/speed/language/format/dim editors (FX17 closed) · reference-guard +
> rename cascade extended to all sections + two new strict-422 mirrors · B4 parity e2e (`conf.spec.ts`) ·
> npm audit fix (Dependabot #38 closed — it was in the LIVE FE lockfile, dev-tooling-only class).
> **OWNER-REVIEW ITEMS: ① the 3 interpretation calls in the D48 AS-BUILT Slice-2 note** (voice-only
> providers excluded from advertised composer verbs [Codex reads C7's letter differently — my ruling:
> no-capability-tags governs] · `X-Voice-Served-By` = served provider name · voice/embeddings acquire
> finite D40 gates) **· ② the accepted env-only-legacy-secret transition residual** (same note) **· ③
> eyeball the new Conf Voice STT/TTS/Embeddings editors + per-model fields live at narrow width.**
> **NEXT = owner ratify/eyeball → push → release A11 + D3s3 via D48 §rollout + runbook §Release**
> (prod boots the migration lenient — IDENTICAL runtime behavior; first config write materializes +
> writes the one-time 0600 `.bak-a11-*` backup; rollback = §Rollback CONFIG block).
> **Durable lesson:** `Path.write_bytes`/`write_text` + `os.replace` inherits the process umask — any
> secret-bearing file replaced that way silently loses 0600; write through an fd opened `0o600` (the
> `.bak-a11` idiom). The bug predated A11 and had already degraded dev+prod configs to 0664.
>
> **▶▶ SESSION 2026-07-27 (PM) — EVERY SLICE-8 PRECONDITION CLOSED; only the release itself is left.**
> 3 commits (`8841386` the MUST-FIX, from the session start · `4a056aa` the rest of the fix list ·
> `73a7637` the D48 amendment + doc sync). Gate **7/7 including e2e** on the release sha; backend
> **1042** (was 1039). Tree clean, **28 commits unpushed**, prod untouched.
>
> **The two code fixes, and why each one is shaped the way it is:**
> - **The bounded gate wait (the MED; ratification ③ was conditional on it).** The acquire sits *inside*
>   the failover attempt, so an unbounded one **cannot fail over** — nothing has failed yet. A provider
>   serving chat + STT at cap 1 parks a mic clip behind a ten-minute stream with a healthy fallback idle.
>   Shipped as ONE seam, not three copies of a wait: `EndpointGates.hold(target, wait_s=…)` — no-op on an
>   unlimited target, releases on any exit, and on timeout raises **`GateWaitTimeout`**, a *message-bearing*
>   `TimeoutError` (`str(TimeoutError())` is empty and `failover()` renders a hop as `f"{label}: {exc}"`,
>   so a bare one would have logged `speaches: `). `wait_for` cancels the pending acquire, so a timed-out
>   waiter consumes no permit — asserted. **Budgets are the existing transport ones, no new config:** voice
>   waits `connect_timeout_s` (a saturated server is a hop we cannot reach in time), embeddings waits
>   `timeout_s` (its section has no connect budget — waiting longer than one whole request for a *slot*
>   means the hop is saturated). **Chat keeps the unbounded wait deliberately.** Zero behaviour change on
>   today's config: speaches is uncapped.
> - **`providers_rev` hashes the MASKED subtree** (the LOW). The digest is published *beside* the masks,
>   so a raw-secret digest made the pair an offline verification oracle. The only sensitivity lost is a
>   rotation to a same-mask value, which is safe *because* a stale draft echoing the mask restores whatever
>   is currently stored — it cannot clobber the rotation it missed.
>
> **Recorded honestly, twice:** the audit named **5** test gaps but only **2** survive by name in this
> file, so the other three are a **reconstruction** (the untested A11 paths), not a recovery. And my own
> rehearsal script's comment check was **blind to inline comments** — it reported zero loss; a `grep -o
> '#.*'` diff against each source is what actually proved the loss is exactly the three documented inline
> comments on consumed keys. Same lesson as the earlier regex-vs-YAML secret comparison: **the cheap
> checker agreed with me, and it was the checker that was wrong.**
>
> **▷ THEN BOTH REVIEWERS RAN ON THE FIX WAVE (owner-requested), on different lenses — and each found
> a defect IN THE MUST-FIX ITSELF.** Codex `gpt-5.6-sol` high on correctness, Fable 5 high on
> design/systems; fixes in `1e2aa46` + `1b01402`; **both then verified their own fix-set: Codex all five
> items CLOSED, Fable "SHIP" once 6b passes.** Gate 6/6, backend **1044**.
> - **Codex MED — the MUST-FIX had a hole.** `looks_masked` used `re.fullmatch(r".{2}….{2}")`, and `.`
>   **excludes newline**, so a credential with a trailing newline (`"ab-token\n"` → `"ab…n\n"`) failed
>   the shape test and the literal mask was *still* persisted as the credential. Replaced with the truer
>   shape test: five codepoints with `…` in the middle, or `••••`.
> - **Fable MED — the MUST-FIX had CAUSED a regression.** Its rewrite dropped `_map_key_is_secret` from
>   the RESTORE arm of the credential-map branch (keeping it only in the new drop filter), so a
>   **non-secret** `env`/`headers` entry — displayed raw, never masked — could no longer be cleared: an
>   explicit `""` silently restored the stored value. Blank-keeps was always a *secret* affordance and
>   the leaf branch still gates on `_SECRET_LEAF_KEYS`, so the two branches had come to disagree.
> - **THE ONE SPLIT, RULED — and the ruling is the interesting part.** Codex: voice's 3s
>   `connect_timeout_s` is a realistic single-provider regression (a capped chain fails just before it
>   would have succeeded); use `timeout_s`. Fable: `connect_timeout_s` is the semantically right budget
>   for "cannot reach a slot". **Both hold, for DIFFERENT hops** — the bound exists so the CHAIN can
>   advance, so it is short only while there IS somewhere to advance to. Voice now waits
>   `connect_timeout_s` while a next hop exists and `timeout_s` on the last one. Fable ratified it as a
>   **derived** rule rather than a split-the-difference compromise, and confirmed the layering (chain
>   position lives in the caller that owns the chain; `hold` stays a dumb one-parameter seam — teaching
>   `EndpointGates` about chain position would have been the real smell).
> - **Codex LOW ×3:** the bounded-failover test would have **wedged** the suite rather than failed on
>   revert (no pytest-timeout) · two assertions could pass a reverted implementation · and, on the
>   verification pass, **`timeout_s: .inf` is valid YAML that passes `gt=0`** and would have restored the
>   indefinite park — `allow_inf_nan=False` on the three floats that bound a gate wait. *A bound is only
>   a bound if no config value can disarm it.*
> - **Verified positively, worth keeping:** `hold` is leak-free across 2,000 timeout/grant races plus
>   cancellation and body-error cases · `GateWaitTimeout` gets no special downstream treatment anywhere ·
>   no backend or frontend consumer needs `providers_rev` to change on a secret rotation ·
>   `target is chain[-1]` is safe (failover passes the chain's exact objects) and its degradation
>   direction is safe anyway (a broken identity test yields the SHORTER budget, never a park).
> - **Deferred with reason (Fable):** the *buffered* chat gate site is a third hand-rolled copy of the
>   acquire idiom that `hold(ep)` would replace exactly. The honest boundary is **lexical vs
>   stream-lifetime permit scope**, not voice-vs-chat: the streaming permit crosses a generator boundary
>   and releases after a shielded close, which no context manager can express. Not touching the chat hot
>   path in a release-day commit; the end-state is recorded in the D48 amendment.
> - **▶ §17.2 STEP 6b — THE RECOVERY REHEARSAL: owner said run it, and it EARNED ITSELF ON THE FIRST
>   RUN (as-executed record = [UPDATE_PLAN §17.4](./UPDATE_PLAN.md#174-step-6b--the-recovery-rehearsal-as-executed-2026-07-27)).**
>   The printed §Rollback sequence is correct and executable verbatim — `ls -t`/`cp -p` (0600 kept) ·
>   sidecars + `gunzip` + `integrity_check` ok · **`git checkout v1.2.1` backwards through a sparse
>   tag-pinned tree, cone intact** · **v1.2.1's own pre-protocol `install.sh` still completes today**
>   (3.14 venv, `npm ci`, Vite build) · **the old build BOOTS on the restored config with all four roles
>   back** (chat local+cloud, STT/TTS primary+fallback, embeddings; `voice/status` `{stt:true,tts:true}`).
>   **But rehearsing it found a HIGH that no review had caught — R1, and it is in the installer we are
>   about to SHIP:** `install.sh prod` cannot be rehearsed off-prod, because `REPO`/`CTRLB_HOME` isolate
>   the tree and the data but **NOT the systemd unit** — the render is an unconditional
>   `sed … > "$HOME/.config/systemd/user/<fixed name>"`, so running it from any other tree **silently
>   repoints the LIVE prod unit** at the scratch paths. The running service survived only because the
>   rehearsal had stubbed `systemctl`; unstubbed, the damage is **latent until the next `daemon-reload`
>   or reboot**. Restored immediately and verified (file · systemd's loaded `ExecStart` · `is-active` ·
>   **`NRestarts=0`, `MainPID` unchanged** · health 1.2.1). **Proposed one-line fix, NOT applied —
>   owner's call, it touches slice 5 on release day:** `SYSTEMD_USER_DIR="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"`.
>   **R2, proven not reasoned:** booting the old build on a *migrated* config (skipping the config
>   restore) really does return `{"status":"ok"}` with every endpoint blank and voice dead, **logging
>   nothing** — the silent failure the whole ordering exists to prevent, now evidence.
>
> **Doc drift closed:** interpretation ① was recorded with the Slice-1 strict trigger set; Slice 2
> correctly extended it to `voice` + `embeddings`. Consequence worth knowing before the first voice edit
> on prod: **a dangling voice fallback now 422s any voice save.** Two release-note items from the fix list
> stand (they are notes, not code): the migration no longer fires unattended, and an `agent.yaml` `mode:`
> pinned to `cloud` is rewritten once by the slice-2 fold.
>
> **▶▶ SESSION 2026-07-26/27 — UPDATE_PLAN SLICES 3–7 BUILT AND REVIEWED; the release is next.**
> 25 commits, gate 6/6 throughout, backend 897 → **1039**, tree clean, **NOTHING PUSHED**. Every slice
> went design → build → **both reviewers** (Codex `gpt-5.6-sol` high on defects, Fable 5 high on
> architecture/systems) → fix wave → verification round. **The reviews found more than the builds did**,
> and several findings corrected things this session had already reported as verified.
>
> **What shipped:** §13 slice 3 (retire the env-secret promise; guard the retired path) · §14 slice 4
> (import-time boot refusal + `RestartPreventExitStatus=78`) · §15 slice 5 (`install.sh` gates the
> migration) · §16 slice 6 (Windows parity) · §17 slice 7 (`update.sh` + the runbook rewrite). Full
> as-built records + every finding are in those sections; **§13.1 §14.1 §15.1 §17.1 §17.3 are the review
> records** and are the most valuable reading for the next session.
>
> **The five findings that changed real behaviour** (all reproduced before fixing):
> ① **A rejected config value reached the systemd journal** — `str(ValidationError)` renders
> `input_value=…`, uncaught at `main.py`. The sanitiser already existed *inside* the migration package
> for that exact reason; it moved to `config.py`. Its provenance matters: the hole shipped in **slice 1**
> and was reachable via the CLI's own stderr for two days. ② **Migrating ≠ loading** — `detect()` never
> validates, so a stamped-but-invalid config died in the lifespan as **exit 3**, which
> `RestartPreventExitStatus=78` does not cover, i.e. a crash-loop. The preflight now calls
> `load_settings()` itself. ③ **A YAML *constructor* failure escapes as a bare `ValueError` quoting the
> input** (`api_key: 2026-01-99` → "day 99 must be in range…", both parsers) — not a YAML error class,
> so `_parse` never caught it. ④ **`install.sh`'s three gates all failed open** — the stop swallowed
> failures and read `deactivating` as stopped; the env scan **both missed and invented** overrides
> (systemd shell-quotes each entry, so `tr ' '` reported a FAKE and missed the REAL one); the health gate
> accepted **any** 2xx, so a stale hand-started process could pass it (`/api/health` now reports `pid`
> and the gate requires it to equal systemd's `MainPID`). ⑤ **A11 MUST-FIX** — a display mask with no
> stored counterpart was written to disk **as the credential**; it is now dropped.
>
> **Three corrections to claims this session made** — the pattern worth internalising: ⓐ I reported the
> `update.sh` downgrade guard as "verified, G4 functioning". **It never ran**: under the script's own
> `set -euo pipefail`, the absent `v1.2.1:…/VERSION` makes `git show` exit 128 → `pipefail` fails the
> assignment → `errexit` kills the script *before* the `:-0` default. **A shell fragment must be
> exercised under the options of the script that will run it.** ⓑ I claimed the config preflight ran
> before the frontend build in **three documents**; it ran after it. Fixed by moving the steps, not the
> prose. ⓒ I recorded "nothing on Windows restarts it" — `autostart-enable.ps1` registers a Scheduled
> Task with `-RestartCount 3 -WindowStyle Hidden`, which makes the autostart path the WORST case, not the
> safe one.
>
> **Two findings were about the RECOVERY TEXT rather than the code**, and both would have produced the
> failure the plan exists to prevent: `update.sh` printed the go-back command *before* the "your config
> was migrated, restore it first" warning (a cold operator runs the tag revert alone → old build boots
> "healthy" with zero providers), and **§Rollback in the runbook had the same defect** — code first, then
> "config must precede it" — in the file that had just been rewritten to fix exactly that.
>
> **▷ LIVE MACHINE STATE.** *(▲ superseded by the 2026-07-27 PM block above: 28 commits ahead, gate 7/7,
> backend 1042.)* Tree clean, `main` is **25 commits ahead of origin — NOTHING PUSHED**. Gate
> `check.py` 6/6 on the tip; backend 1039. **PROD is UNCHANGED: v1.2.1, still LEGACY-SHAPE, config still
> 0664** (the migration heals it to 0600 at the cutover, as it did for dev). Dev units STOPPED; the two
> agent units untouched (verified by tmux session identity across the `install.sh dev` run). **Manual
> pre-release backups exist OUTSIDE the tooling**: `~/.ctrl-b/backups/config.yaml.manual-prerelease-*`
> and `ctrlb-manual-prerelease-*.db.gz`, both 0600, DB integrity-checked.
>
> **▶ NEXT SESSION — finish precondition 4, then release.** In order: ① model check
> (`tmux display-message -p '#S'` → `ctrl-b-opus` = Opus 5 high). ② **The rest of the A11 pre-release fix
> list** — the MED that ratification ③ is *conditional* on (bound the voice/embeddings gate acquire with
> `connect_timeout_s`, treat a timeout as a failed hop) · `providers_rev` hashes RAW secrets, so hash the
> masked dump · the strict-resolve doc drift (it was extended to voice/embeddings; the ruling record still
> says the Slice-1 list) · the named test gaps. ③ The **D48 amendment** + doc sync. ④ Full gate **plus
> §10's real-config rehearsal on the release sha**. ⑤ Push, then tag → **wait for the CI release gate** →
> release. **⚠ The first release MUST use the bootstrap form** — `update.sh` ships *in* this release and
> does not exist on v1.2.1: `git -C ~/apps/ctrl-b show <tag>:deploy/linux/update.sh | bash -s -- <tag>`
> (README §Release). **The prod cutover block has never executed** — the release is its first run, which
> is what §17.2 step 0's manual backups exist to cover.

> **▷ LIVE MACHINE STATE (▲ UPDATED at the 2026-07-26 PM close — SESSION CLOSED CLEAN, ALL PUSHED):**
> tip = **UPDATE_PLAN slices 1 + 2** (`4761483` the runner · `4523374` the fold's move) on top of the
> 2026-07-26 AM wave. **Backend suite 998 green** (was 897; +101). **Working tree CLEAN, main == origin
> — everything through slice 2 is PUSHED** (the AM wave went out with it after sitting unpushed).
> Full gate `check.py` **6/6** on the tip. No background tasks in flight; all review agents completed
> (Codex ×5, Fable ×5 across the two slices) and their findings are banked in `UPDATE_PLAN.md` §11/§12.
> **Dev units STOPPED** — `systemctl --user start ctrl-b-dashboard-dev{,-web}` when iterating
> (:5434 + Vite :5173).
> **PROD REMAINS v1.2.1 — A11 still UNRELEASED**, gated on: slices 3–8, the A11 pre-release fix list,
> and the three owner ratifications.
> **▲ THE DEV CONFIG IS NOW MIGRATED + RENAMED (new shape, `config_version: 1`, 0600).** Its providers
> are `llamacpp · openrouter · emma-speaches · vault-speaches · vault-alltalk`; backup at
> `~/.ctrl-b-dev/backups/config.yaml.20260726T175344Z`. So **dev is no longer a legacy-shape test
> input** — rehearse future slices against a copy of **PROD's** config (`~/.ctrl-b/config.yaml`), which
> is **still LEGACY-SHAPE and still 0664**, or against the dev backup. Never rehearse in place.
> ⚠ **Do not start dev on a tree older than slice 2** — that code expects the legacy shape.
> Session scratch (Codex prompts/reviews) lived in the tmpfs scratchpad and is gone by design;
> everything durable is in the repo.

> **▶▶ SESSION 2026-07-26 (PM/2) — UPDATE_PLAN SLICE 3 BUILT: the env-secret capability RETRACTED,
> the retired path GUARDED.** Gate **6/6**; backend **1013** (was 998). Full as-built + every ruling:
> **[`UPDATE_PLAN.md` §13](./UPDATE_PLAN.md#13-slice-3--as-built-2026-07-26-the-env-override-capability-retracted-the-retired-path-guarded)**.
> Owner ruled Design **C** ("its ok if both reviewers have thought the same lets go with that").
>
> **The slice was specified as an implementation and shipped as a retraction.** §7 asked for
> `CTRLB_PROVIDERS__<encoded-name>__<field>` so provider keys could live in `.env`. Field research
> ([R6](./research/R6-env-overrides-and-secret-provenance.md), 11 projects, NEW dossier) found the peer
> class **abandoned** env→named-entry addressing (6 of 8 use a file-side reference instead; the only two
> that do it needed a hex escape or shipped lossy collisions). Then Codex and Fable, on different
> lenses, independently returned the same verdict:
> - **Codex HIGH ×2 (the overlay is unbuildable as specified):** the PUT baseline is env-overlaid, so a
>   providers-carrying save **materialises the env secret into `config.yaml`** — for all six allowlisted
>   fields, not just `api_key` (LiteLLM's own bug report: the copy then *shadows the env source on every
>   restart*) · and an env-addressed provider **cannot be renamed or deleted** — there is no valid
>   two-phase state.
> - **Fable HIGH:** a permanent public env grammar in permanent code for a capability with **zero users**
>   (no `.env` exists on either box; all four secrets are inline in `config.yaml`).
>
> **Two defects the round table found in the PLAN ITSELF, both Codex HIGH, both fixed:** ① my retires
> list was derived from what the fold *consumes*, but `embeddings.model` and `inference.fallbacks` are
> consumed **and still declared** — same spelling, new meaning — so the guard would have refused a valid
> `CTRLB_EMBEDDINGS__MODEL`; now pinned mechanically against the live models. ② §3.5's cutover contract
> contradicted §7 (keep the old variable through cutover vs any retired variable hard-fails = no
> successful state); rewritten so the value moves to **disk**, not to another variable.
>
> **Reviewers split once, and I ruled with Fable** (Codex wanted exit 78 at boot): the 78 taxonomy is
> defined over *the config file*, and the CLI and the service see **different environments** (the CLI
> sees the shell + `.env`; the service also sees systemd `Environment=`), so neither subsumes the other.
> → **refuse (78) in `--check`/`--apply`** (attended, prod still serving), **log at boot** (slice 4 —
> and `_refuse_retired_env` is deliberately NOT in `detect()`, which the boot path calls). **I overruled
> both** on the four phantom `.env.example` variables: instead of listing names that never existed as
> "retired", an override onto any path `Settings` doesn't declare now **warns** — closing the class,
> typos included, without growing legacy knowledge.
>
> **Shipped:** one shared grammar parser (`config.env_override_vars`, names never values) used by both
> the overlay and the guard so they cannot drift · `Step.retires` + six declared paths in the deletable
> `steps.py` · the refusal · the undeclared-path warning · the docs retraction across **five** documents
> (README · DESIGN §9 · `.env.example` · SECURITY_MODEL §Storage · `config.py`'s module docstring) ·
> **the overlay's first-ever tests** (15) + the flipped slice-2 pin · the conftest `CTRLB_*__*` strip ·
> **[ROADMAP I2](./ROADMAP.md#i2)** recording the ruled seam if the capability is ever wanted (explicit
> `api_key_env:` field, resolved at the registry through one helper, **never** a magic string, and
> `secret_values()` must return the resolved value or shell-output redaction stops protecting the key).
> **Rehearsed on copies of both live configs:** clean check on each, refusal + exit 78 with a retired
> var and no value leaked, no refusal on a live one, prod copy migrates → idempotent → 0600 → all four
> roles resolve.
>
> **▷ BOTH REVIEWERS THEN CONFIRMED THE BUILT RESULT (commits `757781c` + the fix wave `ab8b307`).**
> **Fable: "Sound. Ship it."** — seam placement ratified, `Step.retires` acceptable *because* the
> invariant test pins it, §13 does not misrepresent the ruling, and the phantom-var overrule leaves no
> real gap. **Codex: all four original findings CLOSED**, plus five new — three taken, one taken lean,
> one ruled against (§13.1): `detect()` now precedes the env refusal (a downgrade must out-rank a stale
> variable) · `_apply_env_overrides` takes ONE `dict(os.environ)` snapshot (collect-then-re-read is a
> torn read) · **the completeness gap was real and the fix earned itself immediately** — the retired
> list is now DERIVED (2-segment consumed paths the schema no longer declares) and failed on its first
> run because the fixture omitted `inference.cloud` · conftest's guard pinned by its rule.
> **Codex's HIGH was ruled against, and re-placed:** a credential living only in the unit's
> `Environment=` is invisible to the CLI, so the provider boots unauthenticated with a journal line —
> real, but an unauthenticated provider fails VISIBLY at call time while a refusing unit takes down the
> only UI there is to diagnose it from. **→ slice 5 requirement (recorded in §10): `install.sh` scans
> the rendered unit's `Environment=` lines for `CTRLB_*__*` and fails the attended gate.**
> ⚠ **Standing split for slice 4:** Codex and Fable have now disagreed twice on the same axis
> (fail-closed vs fail-visible for environment residue). The ruling is **fail-visible**, refusals live
> at the attended gates, and slice 4 logs at **ERROR** naming the variable and the role it no longer
> feeds.
>
> **▷ THEN A FULL CODE REVIEW OF THE IMPLEMENTATION, owner-requested, both reviewers, two rounds
> (`d9151bd` + `dcc5458`; §13.2). Fable SHIP AS BUILT → CONFIRMED. Codex DO NOT SHIP → one real HIGH:**
> **a rejected value was reaching the systemd journal.** `str(ValidationError)` renders `input_value=…`
> per failing field and `load_settings` let it escape uncaught to `main.py` — so the very thing this
> slice forbids (`CTRLB_PROVIDERS__X__API_KEY=<secret>`) was warned about, applied, failed validation,
> and put the secret in a traceback. Reproduced, then fixed: `ConfigValidationError` carrying the
> **sanitised** rendering — and the sanitiser already existed inside the migration package for this
> exact reason, so it moved to `config.py` (Fable: it *is* secret-hygiene machinery, the family
> `config.py` already owns) and the package imports it. **Two of my own fixes were caught by my own
> tests:** `raise … from None` suppresses only the *display* of the chained exception — the object still
> reaches the `ValidationError` via `__context__` (fixed by raising outside the handler; the test
> asserts on both `__cause__` and `__context__`) — and escaping only the variable NAME left
> `section`/`key`, slices of the same text, raw. Also fixed: a malformed `Step.retires` declaration
> silently disabled the guard (refused as a step bug, like slice 1's empty `consumes`); the earlier
> ordering fix over-corrected so every step failure preempted the env guard (now **marker/downgrade →
> environment → plan**); the dead forwarding shim deleted. **Two DECLINED, both recorded with evidence
> in §13.2:** a lock around `os.environ` mutation (nothing mutates it after startup) and suppressing
> dynamic `loc`s because a KEY can be secret-shaped — **keys are not secrets here**: masking is
> value-side, provider names ride `GET /api/settings` unmasked and are advertised to the model as
> `/<provider>` verbs. **⚠ Slice-5 rider CORRECTED by Fable:** scan `systemctl --user show <unit> -p
> Environment` (the MERGED view), **not** the rendered unit file — `systemctl --user edit` writes a
> drop-in, which is exactly where a service-only variable would live. Backend **1026**, gate 6/6, tree
> clean, re-rehearsed on copies of both live configs.

> **▶▶ SESSION 2026-07-26 (PM) — UPDATE_PLAN SLICE 2 BUILT: the fold LEAVES the config load path.**
> Gate **6/6**; backend **998** (was 952). As-built + every defect the council found:
> **[`UPDATE_PLAN.md` §12](./UPDATE_PLAN.md#12-slice-2--as-built-2026-07-26)**. NOT PUSHED.
>
> `app/config_migration/steps.py` now owns every piece of legacy-shape knowledge — **488 lines left
> `config.py`**: the fold, `_SLOT_MAP`, the `_PENDING_MIGRATION` write-back channel, the `.bak-a11-*`
> block inside `edit_config_yaml`, the per-load `agent.yaml` fold, `delete_dotted`, `_env_override_paths`.
> `load_settings` is four lines and knows nothing about old shapes; `VERSION` → 1.
>
> **The council ran THREE rounds and every round found something real** — the review process is what
> made this slice safe, not the first draft:
> - **Codex HIGH:** "legacy chat exists" does not prove the named slot is reconstructible.
>   `inference: {fallbacks: []}` yields an empty slot map, so an agent on `mode: local` became
>   `provider: local` — valid enough that validation AND the postcondition passed. Fixed by refusing
>   against the **actual slot map** instead of a proxy for it.
> - **Codex HIGH:** a config merely BROKEN rather than legacy (`inference: nonsense`) was invisible to
>   every step, so `--check` passed it and it got stamped — during an update that reads: preflight says
>   go, service stopped, restart fails on a file we just certified. The runner now validates any
>   non-empty config, plan or no plan.
> - **Fable MED:** `inference: {default_mode: local}` alone did not trigger `applies`, so a legacy key
>   could survive under a "verified" stamp — invisible to the postcondition, *because the postcondition
>   IS `applies`*.
> - **Both, converging on the CLASS:** the fold trusts input shape at the nodes it reads
>   (`base_url: 7` → `TypeError`; a bad port → a `ValueError` **that quotes the value**). Fixed
>   structurally in the RUNNER — `_call_step` turns any non-`MigrationRefused` exception into a
>   sanitised refusal naming only the exception type — plus an 11-case malformed-config corpus test
>   asserting *refused or converged, never raised*. Node-by-node guards were rejected: that is how R5's
>   1229-line peer converter happened.
>
> **Owner directive this session:** *"fable can also check correctness, it's also a smart model for
> that"* — folded into `.claude/skills/second-opinion/SKILL.md` (use both reviewers for defects, on
> DIFFERENT lenses so they don't re-tread; the cheap correctness pass is a `SendMessage` follow-up to a
> Fable agent that already has the context).
>
> **Rehearsed on copies of both live configs after every fix wave** (six times total): five providers,
> strict resolve OK, all API keys carried, chat/stt/tts/embeddings resolve, marker at 1, re-run a no-op.
>
> **▶ ✅ BOTH OWNER DECISIONS EXECUTED (owner: "lets do that", 2026-07-26).**
> ① **THE DEV CONFIG IS MIGRATED FOR REAL** — the first live use of the tool, not a rehearsal.
> `CTRLB_HOME=~/.ctrl-b-dev python -m app.config_migration --apply` → backup
> `~/.ctrl-b-dev/backups/config.yaml.20260726T175344Z` (0600, byte-identical to the pre-flight copy),
> marker at 1, `--check` clean, and the file **healed 0664 → 0600** (an outstanding item from the
> 2026-07-25 close). Dev then BOOTED on it (`/api/health` ok) and strict-resolved.
> ② **THE THREE RENAMES ARE DONE**, through the sanctioned cascade (`PUT /api/settings` with
> `provider_renames` + the full `providers` map + `providers_base` — a rename-only PUT is refused by
> design: *"provider_renames requires the full 'providers' map in the same PUT"*). Result on disk:
> `voice.stt.provider: emma-speaches` → fallback `vault-speaches`; `voice.tts` → `emma-speaches` →
> `vault-alltalk`; chat `llamacpp` → `openrouter`; embeddings `openrouter`. **All four secrets survived
> byte-exact** (verified with `config.secret_values()` over both documents — a first regex-based check
> reported a false loss; the YAML-aware comparison is the trustworthy one) and **no mask leaked into
> the file**. Dev unit STOPPED afterwards.
> ⚠ **PROD IS UNTOUCHED and still legacy-shape** — it runs old code that owns the fold until slice 8.
> The same two steps (migrate, then rename the same three) are part of the RELEASE, not done yet.
>
> **▷ THE MIGRATION WAS THEN REVIEWED AGAINST THE REAL RESULT (owner: "review the migration before
> closing off"), four ways — all pass:**
> 1. **Behaviour-preserving, proven not assumed.** The pre-slice-2 code (`d7466e0`, in a throwaway
>    worktree) was run against the PRE-migration config and its resolved endpoint chains compared with
>    today's code on the MIGRATED config: **byte-identical for all four roles** — same base_urls,
>    models, api_key fingerprints, `api_mode`, `max_concurrent_requests`, `voice`, `dim`,
>    `context_window`, `extra_body`. `inference` 2 endpoints, `stt` 2, `tts` 2, `embeddings` 1.
>    *(Re-runnable: resolve `*_chain` off `provider_registry.resolve_lenient` under both trees.)*
> 2. **Nothing outside the migration's remit moved:** `appearance`, `computers`, `mcp_servers`,
>    `memory`, `open_terminal`, `searxng`, `server`, `tool_overrides` all byte-equal; only
>    `config_version` + `providers` added, nothing removed at top level.
> 3. **Service-level knobs survived the fold** (they are NOT endpoint fields and had to stay put):
>    `inference.request_timeout_s`, `embeddings.enabled`, `voice.stt.language`/`vad_filter`/`hotwords`,
>    `voice.tts.format`/`timeout_s`.
> 4. **Secrets:** 4 distinct values before, 4 after, set-equal, no mask written into the file.
>
> **The exact prose the migration dropped — the SAME three will go on prod, so decide there:**
> `# EMMA (same ports as VAULT); may be stopped — see note above` (×2, on the `voice.stt.fallback` and
> `voice.tts.fallback` keys) and `# qwen3-embedding-4b vector size (verified live)` (on `embeddings.dim`).
> All three sat ON consumed keys, so they died with them per the owner's symmetric ruling — but the two
> `# EMMA` notes documented endpoints that **moved rather than died** (now `vault-speaches` /
> `vault-alltalk`). Re-add by hand onto those provider entries if wanted; the dev backup holds the
> originals.
>
> **▶ NEXT SESSION — slice 3, then 4–8.** In order:
> 1. **Model check** (`tmux display-message -p '#S'` → `ctrl-b-opus` = Opus 5 high).
> 2. **Slice 3 — env overrides.** `CTRLB_PROVIDERS__<encoded-name>__<field>` per §7: scalar-field
>    allowlist, name normalisation (`-`/`.`/`+` → `_`) resolved against the names already in the YAML,
>    every normalised collision rejected, unknown provider/field rejected, and a `CTRLB_*` landing on a
>    RETIRED path **hard-fails at boot** (a warning would ship a service running without its
>    credential). It also closes the env-only-secret hole that `test_an_env_only_legacy_secret_is_not_carried_across`
>    currently pins as today's behaviour — flip that test when you close it. The FX-B `--check`
>    hard-fail (§3.5) belongs here too.
> 3. **Slice 4** — the `main.py` import-time check + `RestartPreventExitStatus=78`, and **verify the
>    terminal `failed` status 78 on the dev unit** plus the `--reload` worker path (a reload worker exits
>    through uvicorn's `ChangeReload` parent, not systemd — behaviour unverified). The exit taxonomy it
>    consumes is already settled (§11 delta 5).
> 4. **Slices 5–8** — `install.sh`, Windows parity, `update.sh` + runbook (with the two comment/backup
>    lines §12 carries forward), then the D48 amendment + release.
>
> **Two things the RELEASE owes** (not done, prod is untouched): migrate prod's config with the same
> CLI, then re-apply the same three renames there — dev's rename does not carry over.

> **▶▶ SESSION 2026-07-26 (PM) — UPDATE_PLAN SLICE 1 BUILT: the config-migration runner.** Model check ✓
> (`ctrl-b-opus`, Opus 5 high). Full gate **6/6 GREEN**; backend **952** (was 897, +55). Working tree has
> the slice; **NOT PUSHED.** As-built record + every delta and defect: **[`UPDATE_PLAN.md` §11](./UPDATE_PLAN.md#11-slice-1--as-built-2026-07-26)**.
>
> New: `backend/app/config_migration/{__init__.py, __main__.py, VERSION}` + `tests/test_config_migration_slice1.py`.
> `STEPS` is empty and `VERSION` is **0** by design — the fold moves in at slice 2; no operator sees 0
> because slice 8 releases at 1. Touched outside the package: `CONFIG_VERSION_KEY` + the `load_settings`
> pop + the PUT strip (§3.8), `conftest.py`'s module-level guard (§3.7), and three `config.py` privates
> promoted (`yaml_rt` · `delete_dotted`/**new** `delete_path` · `Settings.agent_from`) rather than reached
> into from the new package.
>
> **The design changed twice under review, both times for a real defect:**
> - **The runner writes a DIFF, not the document.** A whole-document `sync_mapping` would let a buggy step
>   silently delete `hosts`/SSH credentials with validation AND the postcondition still passing — and
>   `edit_config_yaml` parses **YAML 1.2** while plans are built from `safe_load`'s **1.1**, so it would
>   also rewrite `debug: no` → `false` and `012` → `10` in lines nobody asked it to touch. Removals are
>   authorised one-by-one via `Plan.consumes` (renamed from `delete_list`, which now lied).
> - **Removals travel as key-segment tuples**, not dotted strings: `qwen/qwen3.5-72b` is a *live* model
>   key, and a dotted path splits the name and silently no-ops. Found in self-audit; Fable's confirmation
>   pass called it "a latent slice-2 silent-no-op waiting to ship".
>
> **Council** (owner-requested): Codex `gpt-5.6-sol` high on the design *before* building (BUILD WITH
> CHANGES — the two above), Fable 5 high on design/integration and Codex again on the built code, in
> parallel. Codex returned **DO NOT SHIP** with 2 HIGH + 5 lesser, all fixed with a test each (top: an
> empty `consumes` entry authorised *every* removal, since `()` prefixes everything; `_diff` used `!=`,
> and Python says `True == 1 == 1.0`, so a step's type normalisation produced no diff at all). Fable
> returned SHIP WITH CHANGES → after the fix wave, **SHIP AS BUILT**. One Fable finding **overruled**
> (`--check` exit 2 — §3.5 locks 0, and `install.sh`'s `--check || exit 1` would silently be wrong);
> Fable accepted the overrule. Its best find was an ageing bug: a future correction step legitimately
> restoring a path an earlier step consumed would have tripped the post-commit assertion.
>
> **Settled here so slice 4 doesn't have to:** the exit taxonomy. **78 is now the DEFAULT** for
> `MigrationRefused` — a config this build cannot migrate, which no restart fixes — and **1** is reserved
> for environmental failures a retry might clear. The unit has no `StartLimitBurst`, so the alternative
> was crash-looping forever at `RestartSec=5`.
>
> **Real-config rehearsal (the §10 bar), twice — before and after the fix wave:** copies of BOTH live
> configs through `--check`/`--apply`; the only diff is the added `config_version: 0` line; comments, key
> order and 0600 intact; `load_settings` still loads; the marker never reaches `model_dump`; re-apply a
> true no-op. **Found in passing: the gate was already RED at HEAD** — `09ac884` introduced a pyright
> error that only pre-push runs, and that wave was never pushed. Fixed (one-line narrowing).
>
> **▶ NEXT: slice 2** — move the fold into `steps.py`. Two things Codex found that slice 2 must do:
> deep-copy the config and each agent doc before folding (`_migrate_legacy` shallow-copies, then
> `walk_model_refs` mutates nested refs shared with its input — a step doing that would mutate its own
> `Context` and hide the change from `_diff`), and declare the four `…mode` paths the current fold's
> delete-list omits, which the new invariant will (correctly) reject.

> **▶▶ SESSION 2026-07-26 — fix wave 1/4/5 SHIPPED · the migration DESIGNED (UPDATE_PLAN v3) · the
> parked A11 deep audit DONE.** 3 commits (`09ac884` fix · `2613f54` tests · `dcafa95` docs) + the
> design/research/skill commit. Backend **897 green** (was 878). Model check ✓ (`ctrl-b-opus`, Opus 5 high).
>
> **① Fix-list items 1, 4, 5 CLOSED** (details in the list below). Item 1's blast radius was bigger than
> recorded — reproduced against copies of the real prod AND dev configs, the migration destroyed the whole
> four-line `# Voice (Phase 6, D18 failover)…` section header. Items 6+7 are **superseded** by UPDATE_PLAN.
>
> **② [`UPDATE_PLAN.md`](./UPDATE_PLAN.md) v3 — the update/migration architecture, ready to build.**
> Three layers (`update.sh` → `install.sh` → `python -m app.config_migration`), a quarantined migration
> module, `config_version`, an import-time boot refusal exiting `EX_CONFIG=78`, and Windows parity.
> **v1 was judged "not safe to build as written" (11 HIGH across three reviews); v3 is SMALLER than v1** —
> applying the owner's lean directive answered **three of Codex's HIGH findings by deleting code**
> (the cutover trap, multi-file restore, cross-platform service detection). §8 = owner rulings,
> §9 = the full council record incl. every reversal.
>
> **③ Research banked:** [R4](./research/R4-peer-config-migration.md) (8 peer projects: when a migration
> runs, whether the user's file is ever rewritten, how the legacy reader dies) +
> [R5](./research/R5-migration-code-structure.md) (how migration code is structured; **a production
> engine is 46–105 lines** — ours is ~90; the real cost is frozen legacy schemas, which we avoid by
> operating on raw dicts). **Two R2/owner premises corrected — see fix-list item 7.**
>
> **④ THE A11 PRE-RELEASE FIX LIST (from the parked deep audit — Fable 5, full `v1.2.1..HEAD` backend
> diff). Verdict: SHIP WITH THESE FIXES.** The implementation is otherwise unusually faithful to D48.
> - **MUST FIX — a masked secret can be persisted as the real API key.** `_is_unchanged_secret` ends
>   `and bool(stored)`, so an incoming display mask (`sk…yz`) with **no** stored counterpart (delete-then-
>   recreate, a rename missing `provider_renames`, a hand-crafted PUT) is written to disk verbatim as the
>   credential. Not a leak; silent auth breakage that presents as a provider outage. ~5-line guard + test.
>   *(Verified in source by the main session.)*
> - **The migration fires within MINUTES of boot, unattended** — the phone's appearance sync is a
>   `PUT /api/settings`, which is the write chokepoint. The owner does not get to choose the moment.
>   UPDATE_PLAN removes this by migrating from the updater.
> - **A cloud-pinned agent silently runs local after the first restart** — `agent.yaml` `mode:` maps via
>   the live `_SLOT_MAP` on boot 1; boot 2+ has an empty map, so `cloud` becomes a dangling provider and
>   falls to the default chain. Release-note it until UPDATE_PLAN slice 2 rewrites those files once.
> - **MED — voice/embeddings gate acquire is unbounded**: a capped provider serving chat + STT can park a
>   mic transcription behind a 10-minute stream, and failover cannot advance (the wait is inside the
>   attempt). Bound it with `connect_timeout_s`; treat timeout as a failed hop. Not triggering today
>   (speaches is uncapped).
> - **LOW — `providers_rev` hashes raw secrets**; with the first-2/last-2 mask it is an offline
>   verification oracle. Hash the masked dump instead — free.
> - **Doc drift:** strict-resolve was extended to `voice`/`embeddings` (correct) but the ruling record
>   still says the Slice-1 list; a dangling voice fallback now 422s any voice save.
> - **5 named test gaps**, incl. mask-as-new-key and `chain_for(mode=None, model=X)`.
>
> **⑤ Tooling:** [`.claude/skills/second-opinion/SKILL.md`](../.claude/skills/second-opinion/SKILL.md) —
> the first project skill. Codex invocation (**`< /dev/null` is mandatory**: `codex exec` blocks forever
> on a piped-but-unclosed stdin — this cost two full runs and was twice misdiagnosed as "high effort is
> slow"), the log-growth health check (CPU time proves nothing — it is I/O-bound), kill-by-PID not
> pattern, the **Fable 5 tier** (senior-engineer axis: architecture + systems integration + blind spots;
> on request only, one agent per scope, HIGH effort stated in the brief), the **council rule** (main +
> Fable + Codex must agree before building), and **known reviewer biases — Codex over-engineers: take the
> finding, re-derive the leanest fix**.
>
> **⑥ ROADMAP I1 added** — release-worktree deploy (rollback as a symlink flip in seconds vs today's full
> npm+pip rebuild), deferred with the owner's ruling recorded; deferring now costs **zero** rework.

> **▶▶ SESSION 2026-07-25 — A11 CLOSE-OUT REVIEW (design + research only; NO code changed, tree
> CLEAN at `f7d02da`). The owner PARKED the deep audit + the fix wave to next session at ~80% usage.**
> Model check ✓ (session `ctrl-b-opus`, `claude-opus-5`, settings pin `opus[1m]` + high). CI green
> through `f7d02da`; dev units UP.
>
> **OWNER RULINGS THIS SESSION:** ① **call ① RATIFIED — composer verbs stay TEXT-ONLY** (a provider
> referenced only by voice/embeddings is not advertised as a chat `/verb`). Field evidence is
> overwhelming (research **[R1](./research/R1-model-selection-and-capability.md)**): capability is
> declared by the config SECTION everywhere (Continue `roles`, open-webui's four tabs, LibreChat's
> `speech` block, LiteLLM `model_info.mode`), and **no probe can do better** — a live probe of our OWN
> `:5001` chat endpoint returns an embedder + a reranker with `architecture` fields byte-identical to
> the chat models. Codex's dissent is not supported by the field. ② **call ③ RE-FRAMED and standing:**
> the D40 gate is keyed `(canonical_base_url, effective_limit)` — a **SERVER** identity, not a provider
> name. Two different providers at different base_urls never block each other; one server referenced by
> two sections shares one cap (correct — the box is one queue). `None` = unlimited costs nothing.
> ③ Per-message model choice = **ROADMAP, not now** (owner: "future feature"). ④ **Research is now
> persisted** — new **[`docs/research/`](./research/)** database (owner directive: stop re-buying
> findings). **R1 + R2 + R3 written.** R3 is PARTIAL: it settles warning-scoping + capability-vs-dialect,
> but **provider auto-naming was never bought** (that pass was stopped on budget) — one tight bounded
> pass still owed there, and it gates fix-list item 3.
>
> **THE FIX LIST (next session — nothing here is built yet):**
> 1. **✅ FIXED 2026-07-26 — BUG (verified live, R2 §7): comment orphaning on delete.** `sync_mapping`
>    and `_delete_dotted` used a bare `del node[k]`. ruamel stores a key's trailing comment on the
>    *preceding* entry, so the delete carried away the prose for whatever came AFTER the deleted region.
>    **The live blast radius was bigger than recorded here:** reproduced against copies of the real prod
>    AND dev `config.yaml` — the migration's `inference.cloud` delete (last key, subtree value) destroyed
>    the whole four-line `# Voice (Phase 6, D18 failover)…` **section header**, not just the `max_steps`
>    line. Fix = a comment-preserving `_delete_key` shared by BOTH deleters (so the hosts/integrations
>    service-removal CRUD is covered too): rescue the block parked on the deleted region's deepest-last
>    leaf, drop only the deleted line's own end-of-line comment, and re-home it verbatim — after the
>    preceding entry, above the new first key at index 0, or bubbled one level up when the delete empties
>    a mapping (an emptied map renders inline `{}`, and a comment on its entry would land between key and
>    value and **no longer parse** — that case was caught by a test and would have been a corrupting fix).
>    Sequences park trailing comments at `ca.items` slot 0 instead of 2 (also caught by test). No library
>    API exists for any of this ([ruamel #377](https://sourceforge.net/p/ruamel-yaml/tickets/377/)); this
>    is the sanctioned rescue-and-reattach recipe. **OWNER RULING 2026-07-26 — the rule is SYMMETRIC:
>    the block ABOVE a key documents that key and DIES WITH IT** (*"we should drop the comment too in
>    order to not confuse anybody that's reading the config"*), while the block TRAILING the deleted
>    region documents what comes next and is re-homed verbatim. Note this staleness is **not** an
>    index-0 corner as first reported — a key's leading comment lives on the *preceding* entry's token,
>    so it applies at every position; the leading block of a first key is a list shared with the parent
>    slot, so clearing it in place needs no parent plumbing. ⚠ Documented caveat: deleting a top-level
>    key that is FIRST in the file would take the file's header banner with it (unreachable today — every
>    deleter addresses keys inside a section). Verified against prod + dev `config.yaml`: the full legacy
>    `delete_list` round-trips with the `# Voice …` and `# SearXNG …` section headers intact, the
>    end-of-line comments on the deleted keys gone, and the file re-parsing clean — the ruling changes
>    nothing on the owner's own configs (they carry no full-line comment directly above a deleted key).
>    13 new tests; full backend suite green.
> 2. **✅ FIXED 2026-07-25 (`4d839d1`; backend 878 green, live 3 warnings → 0) — BUG: the api_mode
>    advisory is chat-only but fired for EVERY provider**
>    (`provider_registry.py:551`). The owner sees 3 warnings telling him his speaches/AllTalk boxes
>    ignore `reasoning_effort`. Scope it to chat-referenced providers — note the advisory runs BEFORE
>    the chain is built (:560), so derive the set from config refs (`inf.provider` + `inf.fallbacks` +
>    the agent ModelRef homes), **reusing the `_validate_config_refs` walk at :527, not a second walker**.
>    **Research [R3](./research/R3-warning-scoping-and-capability-fields.md) settles the WHERE:** warn
>    at the **reference site**, never at declaration — *"warn only on proven inertness, never on
>    suspected inertness"* (k8s/systemd/nginx/Terraform/OTel all refuse the declaration-site warning;
>    firing a chat advisory at a speaches box is an *effective false positive* per Sadowski et al., the
>    seed of the trust death-spiral per Bessey et al.). Message shape = systemd's: name the setting AND
>    the discriminant. Dedupe to one warning per provider. ⚠ Do **NOT** solve this with a compound
>    `openai/tts` api_mode — `api_mode` is the WIRE DIALECT axis; role already comes from the section.
>    A declared capability field is legitimate *later* (LiteLLM `model_info.mode`, k8s `spec.type`,
>    systemd `Type=`) but in EVERY precedent it sits **beside** the dialect, never fused into it — and
>    it must be REQUIRED/defaulted, at which point the precedent says provable ⇒ **error, not warning**.
>    That's a breaking change ⇒ its own D-entry, not this fix. Also adopt R3's asymmetry: a section
>    referencing an UNDECLARED provider = hard error; a provider referenced by NOBODY = silent.
> 3. **Provider naming — ✅ OWNER RULED 2026-07-25. Convention = `<host>-<service>`, and NO DERIVATION
>    LOGIC.** The owner's reasoning: *"that's gonna be something that the user is gonna name itself"* —
>    so we do NOT build a heuristic that guesses a service name from a URL. The three names he wants
>    for **the current config specifically**: **`emma-speaches`** (`127.0.0.1:9000` — emma = the local
>    box) · **`vault-speaches`** (`192.168.1.137:9000`) · **`vault-alltalk`** (`192.168.1.137:7851`).
>    *(AllTalk is running on vault but is not otherwise configured in this project.)* These land as part
>    of the migration work (item 7) since nothing is on disk yet — the generic fallback slug stays
>    whatever it is; the user renames in Conf (rename-with-cascade shipped in Slice 1). ⚠ Role-based
>    names (`tts`/`stt`) can NOT be a general rule anyway — dedup-by-identity merges one server into ONE
>    provider, and the `:9000` speaches box serves BOTH roles, which is exactly why `<host>-<service>`
>    is the right shape.
> 4. **✅ FIXED 2026-07-26 — doc drift on D40.** `DECISIONS.md`, `DESIGN.md`, `SPEC.md` all described an
>    *inference-only* gate on `InferenceEndpointCfg.max_concurrent_requests` keyed by raw
>    `(base_url, limit)`. Code truth (verified): `ProviderCfg.max_concurrent_requests`, keyed
>    `(gate_identity, limit)` with `gate_identity = canonical_base_url(...)` — a SERVER identity —
>    acquired at THREE chokepoints (chat · voice · embeddings) through the app-owned `EndpointGates`.
>    D48 §C4 already had this right; the drift was that the older entries never got the forward pointer.
>    Fixed per house convention: D40 keeps its historical text + a `✏️ AMENDED by D48 C4` block; the
>    live-guidance sites in `DESIGN.md` (four of them, not one — §3 turn loop, the gate bullet, the
>    tunables list) were corrected in place; `SPEC.md` §6.3 had **no `providers{}` row at all** and its
>    `inference` row still read "local/cloud endpoints" — both rewritten to the D48 shape.
>    ⊕ Found en route and fixed (same A11 re-homing, verified against `config.py`): `DESIGN.md` still
>    sourced the compaction context window from `InferenceEndpointCfg.context_window`; it is
>    `ModelCfg.context_window` (per-model) since D48.
> 5. **✅ FIXED 2026-07-26 — test gap on the voice/embeddings gate.** Acquisition was pinned only by
>    *semaphore identity*, so deleting `await sem.acquire()` left the suite green. Added 6 tests to
>    `test_inference_gate_d40.py` (its existing A11/R4/R5 section — no new file): serialize-at-limit-1
>    for voice STT and embeddings · unlimited-when-None · failed-attempt-releases-the-permit for both ·
>    and the cross-adapter one that proves the shared registry earns its keep — **an in-flight voice
>    call parks a chat call on the same server**. **Both mutants verified**: deleting `sem.acquire()`
>    fails 3 of them (and the pre-existing identity test still passes — the gap was exactly as
>    reported); deleting `sem.release()` fails 5, the two release tests by deadlock-timeout, so they are
>    not vacuous. Adapters restored byte-identical to HEAD after the mutation runs.
> 6. **➡ SUPERSEDED 2026-07-26 — folded into [`UPDATE_PLAN.md`](./UPDATE_PLAN.md).** All four defects
>    were re-verified in source this session (two are sharper than recorded: the FX-B warning advises a
>    move that **hard-crashes the app** — `CTRLB_PROVIDERS__X__API_KEY` creates a junk string entry and
>    `Settings.model_validate` raises; and the `providers:` trigger fires on a **bare `providers:` line**
>    that YAML parses to `None`, not just `{}`). They close as consequences of the redesign, not as
>    separate patches — see UPDATE_PLAN §7 (env overrides) and §7 (config-file edge cases).
> 7. **➡ SUPERSEDED 2026-07-26 — the design pass is DONE: [`UPDATE_PLAN.md`](./UPDATE_PLAN.md) v3,
>    ready to build.** Peer research bought and banked as **[R4](./research/R4-peer-config-migration.md)**
>    (when a migration runs) + **[R5](./research/R5-migration-code-structure.md)** (how the code is
>    shaped). ⚠ **Two premises in the block below turned out FALSE and are corrected in R4/R5:**
>    open-webui does **not** announce "migrating database" in any UI — that memory is the pre-0.9.6
>    peewee log path (R4 §2); and R2's "essentially nobody deletes migration code" is wrong in the peer
>    class — open-webui (−1673 lines, floor-version rule), LibreChat (−817) and Kilo all did (R5 §5②).
>    The owner's one-shot ruling stands, but the *mechanism* changed: **migrate from the UPDATER
>    (`install.sh`), not at boot** — boot-rewrite has the field's worst track record (R4 §4). The
>    original block is kept below as the provenance of the ruling.

> **NEXT SESSION, in order:** ① /model check (fable-5 HIGH) ② confirm CI green @ `f80c1d9` ③
> owner reads SLICE6_PLAN → **LOCK D42** into DECISIONS.md → ~6 Opus build waves (schema/config
> +probe → estimator/trigger → clearing+summarizer+thrash → reactive+ModelRef wire → Conf UI →
> the DESIGN/SPEC docs sweep) + mid/post-build audits + the Codex tri-review — the standing
> pipeline. ④ **Dev units LEFT RUNNING** (owner intends to poke Slice-5 steering on :5173 —
> ⚠ dev drives the REAL fleet; stop the units after). ⑤ Owner config reminders:
> `max_concurrent_requests: 1` on the local endpoint (Slice 4) · `context_window` per endpoint
> once Slice 6 ships. **OWNER DIRECTIVE REITERATED at close (standing, memory
> `orchestrate-with-opus-subagents`): Fable 5 = ORCHESTRATOR + FEATURE REVIEWER ONLY, alongside
> Codex (`gpt-5.6-sol` high) as the standing co-reviewer; ALL specified implementation /
> mechanical work / research = Opus 4.8 subagents — never burn Fable on menial tasks.**
>
> **▶ SAME WEEKEND (2026-07-19, the next session): D42 LOCKED (owner go) → ACA SLICE 6 (compaction
> v2) ✅ EXECUTED end-to-end — 12 commits LOCAL (`d8c6744..2e4dac9` + this close-out), awaiting the
> owner's push OK. Final tree gate 6/6; backend 617 / FE 507 tests.** The full standing pipeline:
> D42 transcribed into DECISIONS (`d8c6744`) → SIX Opus waves (schema/config+probe `681310f` →
> window ladder + fraction trigger + served-endpoint pricing + the anchored estimator `76b4a85` →
> clearing tier + 5-section summarizer + `/compact <instructions>` + thrash machine `f9c43bb` →
> the `_call_config` ModelRef wire + the reactive overflow backstop `7313155` → the Conf UI
> surface `c3d1dec` → the DESIGN/SPEC/deploy/config-example docs sweep `c04e1f4`+`08ade3e`) →
> MID-BUILD audit (1 HIGH: anchored clearing double-credit → the exact-delta fix `483dc6a`) →
> POST-BUILD audit (GO; polish `2acd592`) → **Codex tri-review: 2 HIGH/6 MED/2 LOW NOT-READY →
> two gated fix waves (`2e4dac9` backend: the app-owned EndpointGates [a settings PUT split the
> D40 cap across client generations] + `_finalize` joins clearing/backstop; `b1d0262` FE)** → a
> fix-set verifier: **all 9 CLOSED, no drift, no regressions** (1 MED deferred with reason: the
> pre-existing ConfTab draft lifecycle). D42 carries the AMENDED-as-built list; the full record =
> the ACA §5 Slice 6 heading. **You can now: set per-endpoint context windows in the Conf UI (or
> let the local one auto-probe /props) · watch old tool outputs trim for free before any paid
> summary · `/compact focus on X` · cap any agent's output + reasoning effort per agent · survive
> a context overflow via the one-shot fold+retry.** **NEXT SESSION, in order:** ① owner push OK
> (12+1 commits; pre-push runs the full gate) ② owner config when it reaches prod: the deploy
> README §"Inference tuning" — `context_window` per endpoint (cloud manual), the anchoring
> telemetry flags (local already pinned via `return_progress`; cloud wants
> `stream_options.include_usage`), consider disabling llama.cpp context-shift so overflows
> surface ③ live pokes per `testing-parked-wing-it` (the ACA §5 Slice 6 LIVE-VERIFY list) ④
> next: ACA Slice 7 (model routing & retry visibility — design review first) or Slice 8
> (approvals) or the owner's pick (ROADMAP D3 Slice 1 · 6c-1/6c-2 flags · vapor ladder).**
>
> **▶ NEXT DAY (2026-07-19→20, same session): SLICE 6 PUSHED (owner OK; `f2aed3f..0ed9d80`, main
> CI GREEN @ `0ed9d80`) → ACA SLICE 7 (model routing & retry visibility, D43) ✅ EXECUTED
> end-to-end — and ✅ PUSHED same day (owner OK; `0ed9d80..0977e91`, main CI GREEN @ `0977e91`).
> Final tree gate 6/6; backend 668 / FE 514 tests.** The full pipeline: 2 code-truth + 1 sourced
> field pass (Goose's lead/worker retreat; pi's classifier; the retry-consensus table) → my D43
> draft → 2-lens adversarial review (7H/13M/4L — **`lead_turns` DROPPED**, both lenses converged)
> → TWO owner discussion rounds (the fallback-chain-vs-routing clarification landed on: "like a
> fallback, but escalating to the designated smarter model after crash-and-burn turns"; retry
> reshaped to the GLOBAL `inference.retry_attempts: 2` + per-endpoint override) → **D43 LOCKED**
> (`8c4a7b2`) → 5 Opus waves (`de88a54` failover-async-generator + classifier + visible
> transient retry tier → `c748b58` typed events + `retry_status` snapshot + degraded-notice
> deletion → `fa50a09` the failure-fallback routing machine → `4a62857` FE → `77ea3a9` docs) →
> post-build audit (GO; 1 MED + 2 LOW → `0b46f19`) → **Codex tri-review: 3 HIGH NO-GO (the
> routing lifecycle — thread-global route lock vs D41 fresh-during-suspend; live-config re-deref
> on resume; conclude-before-finalize counting a cancelled turn) → ONE unified fix
> (`c00a640`): per-suspended-call ModelRef SNAPSHOTS + turn-local flags + conclude-after-finalize
> — closed all three and DELETED two state fields** → verifier: all 6 CLOSED, no drift. **You
> now get: visible in-place retries on busy servers (`// retrying local in 2s…`) instead of
> silent model switches · live `// failover → cloud` narration · a retry line on phone re-attach
> instead of a dead spinner · and optional two-tier routing (set `agent.defaults.routing:` in
> YAML — after N crash-and-burn worker turns the designated lead model takes over for M turns,
> announced both ways).** As-built = the ACA §5 Slice 7 heading; D43 AMENDED-as-built.
>
> **▶ SESSION CLOSED 2026-07-20 (clean handoff; both slices pushed, main CI green @ `0977e91`).
> Dev units LEFT RUNNING** (:5434 + Vite :5173 — the Slice 5/6/7 LIVE-VERIFY pokes are all still
> outstanding per `testing-parked-wing-it`; ⚠ dev drives the REAL fleet — stop the units after:
> `systemctl --user stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web`). **NEXT SESSION, in
> order:** ① /model check (fable-5 HIGH — the app selector may default low) ② owner config when
> desired: `agent.defaults.routing:` (config.example has the block) — retry needs NOTHING
> (global default 2 shipped per the owner's ruling); the Slice-6 reminders stand (deploy README
> §Inference tuning: per-endpoint `context_window`, the cloud `include_usage` anchoring flag,
> the ctx-shift note) ③ live pokes when desired (the ACA §5 Slice 6 + Slice 7 LIVE-VERIFY
> lists) ④ **prod is still v1.1.1** — release via `deploy/linux/README.md` §Release when the
> owner wants Slices 4–7 live on :5433 ⑤ next: ACA Slice 8 (approvals evolution — design review
> first, aligns with ROADMAP privilege levels/D16) or the owner's pick (ROADMAP D3 Slice 1 ·
> 6c-1/6c-2 flags · vapor ladder · the parked Composer Surface). **The standing directives hold:
> Fable 5 = orchestrator + feature reviewer alongside Codex (`gpt-5.6-sol` high); ALL specified
> implementation / mechanical work / research = Opus 4.8 subagents.**
>
> **▶▶ SESSION 2026-07-23 (later) — A11 SLICE 2 (voice + embeddings) ✅ BUILT + TRIPLE-REVIEWED + GATED
> — A11 IS FEATURE-COMPLETE. The 2 Slice-1 D48 calls were OWNER-RATIFIED at session start (recorded in
> D48 AS-BUILT); Slice 2 then ran the full pipeline: 2-agent code-truth maps → 11 orchestrator rulings →
> Opus build waves `e7e60bb` (backend) + `29a3712` (frontend) → docs wave (config.example new-shape ·
> README · runbook §Rollback A11 CONFIG block; SECURITY_MODEL was already right) → fresh-eyes Opus audit
> [0 HIGH · 2 MED] + Codex gpt-5.6-sol high review [NO-GO: 1 HIGH + 5 MED + 2 LOW, every finding
> code-verified + ruled] → 7-fix wave `a62faa6` → Codex fix-set verification [**GO-with-changes**:
> 1/3/5/7 + FE guard CLOSED, rulings internally consistent, no new defects] → full `check.py --e2e`
> **7/7 GREEN** (backend 876 pytest · FE 604 vitest · e2e green · pyright 0). LOCAL COMMITS, NOT PUSHED.**
> Headline review catches (both now fixed + regression-pinned): the config-write chokepoint had a
> PRE-EXISTING umask bug stripping `config.yaml` to 0664 on every write — every writer now goes through
> an fd-opened 0600 tmp + `os.replace` (self-heals) · the migration write-back would have materialized
> env-only secrets into YAML — the fold now runs twice (disk-truth for the write-back, env-truth for
> runtime). Shipped shape: ONE shared `_build_section_chain` (inference refolded, behavior-identical) +
> frozen per-section policies · rebuild-together generation publish + refcount drain on Voice/Embeddings
> clients · voice/embeddings migration folds (dedup against existing providers, host-port slugs,
> per-field accretion, 32-char-safe suffixes) · shared FE `SectionRefEditor` (Inference refolded
> DOM-identically) · per-model voice/speed/language/format/dim editors (FX17 closed) · reference-guard +
> rename cascade extended to all sections + two new strict-422 mirrors · B4 parity e2e (`conf.spec.ts`) ·
> npm audit fix (Dependabot #38 closed — it was in the LIVE FE lockfile, dev-tooling-only class).
> **OWNER-REVIEW ITEMS: ① the 3 interpretation calls in the D48 AS-BUILT Slice-2 note** (voice-only
> providers excluded from advertised composer verbs [Codex reads C7's letter differently — my ruling:
> no-capability-tags governs] · `X-Voice-Served-By` = served provider name · voice/embeddings acquire
> finite D40 gates) **· ② the accepted env-only-legacy-secret transition residual** (same note) **· ③
> eyeball the new Conf Voice STT/TTS/Embeddings editors + per-model fields live at narrow width.**
> **NEXT = owner ratify/eyeball → push → release A11 + D3s3 via D48 §rollout + runbook §Release**
> (prod boots the migration lenient — IDENTICAL runtime behavior; first config write materializes +
> writes the one-time 0600 `.bak-a11-*` backup; rollback = §Rollback CONFIG block).
> **Durable lesson:** `Path.write_bytes`/`write_text` + `os.replace` inherits the process umask — any
> secret-bearing file replaced that way silently loses 0600; write through an fd opened `0o600` (the
> `.bak-a11` idiom). The bug predated A11 and had already degraded dev+prod configs to 0664.
>
> **▷ LIVE MACHINE STATE (▲ UPDATED at the 2026-07-25 close — SESSION CLOSED CLEAN, ALL PUSHED):**
> the close-out session's **5 commits** (research database R1–R3 · the two owner rulings · the
> chat-scoped advisory fix + its 2 regression tests · the reference correction) went out on top of
> `e158519`; pre-push gate green. Prior tip was `e158519` (the A11 Slice-2 stack `e7e60bb`→`0949cab` +
> `8431122` + the Opus-5 workflow sweep). **Working tree CLEAN**, no background tasks in flight, dev
> units STOPPED at close. **PROD REMAINS v1.2.1 — A11 is still UNRELEASED** (the fix wave + the deep
> audit come first; see the close-out block above for the ordered list). **The on-demand dev units are UP** *(they had gone DOWN in the interim — verified inactive
> and RESTARTED 2026-07-25; :5434 health ok + Vite :5173 → 200)* — `ctrl-b-dashboard-dev` (:5434) + `-dev-web` (Vite
> :5173), left running for the owner's Conf eyeball; `systemctl --user stop ctrl-b-dashboard-dev{,-web}`
> when done. **Prod + dev `config.yaml` are still `0664`** (`~/.ctrl-b/` + `~/.ctrl-b-dev/`): the
> `a62faa6` fix HEALS to 0600 on the next config write (prod: the first write after the A11 release), so
> they self-correct on rollout — but if you want them tight *now*, `chmod 600 ~/.ctrl-b/config.yaml
> ~/.ctrl-b-dev/config.yaml` (they hold SSH passwords + API keys; single-user tailnet-only, so low-risk
> but real). Orchestration scratch (maps/briefs/review outputs) lived in the session scratchpad (tmpfs —
> already gone/going); the durable record is the D48 AS-BUILT Slice-2 note + this block. **Nothing was
> ratified or released — that is still the owner's call (below); the code is now on origin/main but
> UNRELEASED (prod remains v1.2.1), so the ratify → release step is untouched by the push.**
>
> **▶▶ SESSION 2026-07-25 — A11 CLOSE-OUT REVIEW (design + research only; NO code changed, tree
> CLEAN at `f7d02da`). The owner PARKED the deep audit + the fix wave to next session at ~80% usage.**
> Model check ✓ (session `ctrl-b-opus`, `claude-opus-5`, settings pin `opus[1m]` + high). CI green
> through `f7d02da`; dev units UP.
>
> **OWNER RULINGS THIS SESSION:** ① **call ① RATIFIED — composer verbs stay TEXT-ONLY** (a provider
> referenced only by voice/embeddings is not advertised as a chat `/verb`). Field evidence is
> overwhelming (research **[R1](./research/R1-model-selection-and-capability.md)**): capability is
> declared by the config SECTION everywhere (Continue `roles`, open-webui's four tabs, LibreChat's
> `speech` block, LiteLLM `model_info.mode`), and **no probe can do better** — a live probe of our OWN
> `:5001` chat endpoint returns an embedder + a reranker with `architecture` fields byte-identical to
> the chat models. Codex's dissent is not supported by the field. ② **call ③ RE-FRAMED and standing:**
> the D40 gate is keyed `(canonical_base_url, effective_limit)` — a **SERVER** identity, not a provider
> name. Two different providers at different base_urls never block each other; one server referenced by
> two sections shares one cap (correct — the box is one queue). `None` = unlimited costs nothing.
> ③ Per-message model choice = **ROADMAP, not now** (owner: "future feature"). ④ **Research is now
> persisted** — new **[`docs/research/`](./research/)** database (owner directive: stop re-buying
> findings). **R1 + R2 + R3 written.** R3 is PARTIAL: it settles warning-scoping + capability-vs-dialect,
> but **provider auto-naming was never bought** (that pass was stopped on budget) — one tight bounded
> pass still owed there, and it gates fix-list item 3.
>
> **THE FIX LIST (next session — nothing here is built yet):**
> 1. **✅ FIXED 2026-07-26 — BUG (verified live, R2 §7): comment orphaning on delete.** `sync_mapping`
>    and `_delete_dotted` used a bare `del node[k]`. ruamel stores a key's trailing comment on the
>    *preceding* entry, so the delete carried away the prose for whatever came AFTER the deleted region.
>    **The live blast radius was bigger than recorded here:** reproduced against copies of the real prod
>    AND dev `config.yaml` — the migration's `inference.cloud` delete (last key, subtree value) destroyed
>    the whole four-line `# Voice (Phase 6, D18 failover)…` **section header**, not just the `max_steps`
>    line. Fix = a comment-preserving `_delete_key` shared by BOTH deleters (so the hosts/integrations
>    service-removal CRUD is covered too): rescue the block parked on the deleted region's deepest-last
>    leaf, drop only the deleted line's own end-of-line comment, and re-home it verbatim — after the
>    preceding entry, above the new first key at index 0, or bubbled one level up when the delete empties
>    a mapping (an emptied map renders inline `{}`, and a comment on its entry would land between key and
>    value and **no longer parse** — that case was caught by a test and would have been a corrupting fix).
>    Sequences park trailing comments at `ca.items` slot 0 instead of 2 (also caught by test). No library
>    API exists for any of this ([ruamel #377](https://sourceforge.net/p/ruamel-yaml/tickets/377/)); this
>    is the sanctioned rescue-and-reattach recipe. **OWNER RULING 2026-07-26 — the rule is SYMMETRIC:
>    the block ABOVE a key documents that key and DIES WITH IT** (*"we should drop the comment too in
>    order to not confuse anybody that's reading the config"*), while the block TRAILING the deleted
>    region documents what comes next and is re-homed verbatim. Note this staleness is **not** an
>    index-0 corner as first reported — a key's leading comment lives on the *preceding* entry's token,
>    so it applies at every position; the leading block of a first key is a list shared with the parent
>    slot, so clearing it in place needs no parent plumbing. ⚠ Documented caveat: deleting a top-level
>    key that is FIRST in the file would take the file's header banner with it (unreachable today — every
>    deleter addresses keys inside a section). Verified against prod + dev `config.yaml`: the full legacy
>    `delete_list` round-trips with the `# Voice …` and `# SearXNG …` section headers intact, the
>    end-of-line comments on the deleted keys gone, and the file re-parsing clean — the ruling changes
>    nothing on the owner's own configs (they carry no full-line comment directly above a deleted key).
>    13 new tests; full backend suite green.
> 2. **✅ FIXED 2026-07-25 (`4d839d1`; backend 878 green, live 3 warnings → 0) — BUG: the api_mode
>    advisory is chat-only but fired for EVERY provider**
>    (`provider_registry.py:551`). The owner sees 3 warnings telling him his speaches/AllTalk boxes
>    ignore `reasoning_effort`. Scope it to chat-referenced providers — note the advisory runs BEFORE
>    the chain is built (:560), so derive the set from config refs (`inf.provider` + `inf.fallbacks` +
>    the agent ModelRef homes), **reusing the `_validate_config_refs` walk at :527, not a second walker**.
>    **Research [R3](./research/R3-warning-scoping-and-capability-fields.md) settles the WHERE:** warn
>    at the **reference site**, never at declaration — *"warn only on proven inertness, never on
>    suspected inertness"* (k8s/systemd/nginx/Terraform/OTel all refuse the declaration-site warning;
>    firing a chat advisory at a speaches box is an *effective false positive* per Sadowski et al., the
>    seed of the trust death-spiral per Bessey et al.). Message shape = systemd's: name the setting AND
>    the discriminant. Dedupe to one warning per provider. ⚠ Do **NOT** solve this with a compound
>    `openai/tts` api_mode — `api_mode` is the WIRE DIALECT axis; role already comes from the section.
>    A declared capability field is legitimate *later* (LiteLLM `model_info.mode`, k8s `spec.type`,
>    systemd `Type=`) but in EVERY precedent it sits **beside** the dialect, never fused into it — and
>    it must be REQUIRED/defaulted, at which point the precedent says provable ⇒ **error, not warning**.
>    That's a breaking change ⇒ its own D-entry, not this fix. Also adopt R3's asymmetry: a section
>    referencing an UNDECLARED provider = hard error; a provider referenced by NOBODY = silent.
> 3. **Provider naming — ✅ OWNER RULED 2026-07-25. Convention = `<host>-<service>`, and NO DERIVATION
>    LOGIC.** The owner's reasoning: *"that's gonna be something that the user is gonna name itself"* —
>    so we do NOT build a heuristic that guesses a service name from a URL. The three names he wants
>    for **the current config specifically**: **`emma-speaches`** (`127.0.0.1:9000` — emma = the local
>    box) · **`vault-speaches`** (`192.168.1.137:9000`) · **`vault-alltalk`** (`192.168.1.137:7851`).
>    *(AllTalk is running on vault but is not otherwise configured in this project.)* These land as part
>    of the migration work (item 7) since nothing is on disk yet — the generic fallback slug stays
>    whatever it is; the user renames in Conf (rename-with-cascade shipped in Slice 1). ⚠ Role-based
>    names (`tts`/`stt`) can NOT be a general rule anyway — dedup-by-identity merges one server into ONE
>    provider, and the `:9000` speaches box serves BOTH roles, which is exactly why `<host>-<service>`
>    is the right shape.
> 4. **✅ FIXED 2026-07-26 — doc drift on D40.** `DECISIONS.md`, `DESIGN.md`, `SPEC.md` all described an
>    *inference-only* gate on `InferenceEndpointCfg.max_concurrent_requests` keyed by raw
>    `(base_url, limit)`. Code truth (verified): `ProviderCfg.max_concurrent_requests`, keyed
>    `(gate_identity, limit)` with `gate_identity = canonical_base_url(...)` — a SERVER identity —
>    acquired at THREE chokepoints (chat · voice · embeddings) through the app-owned `EndpointGates`.
>    D48 §C4 already had this right; the drift was that the older entries never got the forward pointer.
>    Fixed per house convention: D40 keeps its historical text + a `✏️ AMENDED by D48 C4` block; the
>    live-guidance sites in `DESIGN.md` (four of them, not one — §3 turn loop, the gate bullet, the
>    tunables list) were corrected in place; `SPEC.md` §6.3 had **no `providers{}` row at all** and its
>    `inference` row still read "local/cloud endpoints" — both rewritten to the D48 shape.
>    ⊕ Found en route and fixed (same A11 re-homing, verified against `config.py`): `DESIGN.md` still
>    sourced the compaction context window from `InferenceEndpointCfg.context_window`; it is
>    `ModelCfg.context_window` (per-model) since D48.
> 5. **✅ FIXED 2026-07-26 — test gap on the voice/embeddings gate.** Acquisition was pinned only by
>    *semaphore identity*, so deleting `await sem.acquire()` left the suite green. Added 6 tests to
>    `test_inference_gate_d40.py` (its existing A11/R4/R5 section — no new file): serialize-at-limit-1
>    for voice STT and embeddings · unlimited-when-None · failed-attempt-releases-the-permit for both ·
>    and the cross-adapter one that proves the shared registry earns its keep — **an in-flight voice
>    call parks a chat call on the same server**. **Both mutants verified**: deleting `sem.acquire()`
>    fails 3 of them (and the pre-existing identity test still passes — the gap was exactly as
>    reported); deleting `sem.release()` fails 5, the two release tests by deadlock-timeout, so they are
>    not vacuous. Adapters restored byte-identical to HEAD after the mutation runs.
> 6. **Migration defects beyond the recorded residual** (code-truth pass): the env-only-legacy-secret
>    window is **wider than D48 says** (it closes on process restart / a `load_settings()` writer, NOT
>    on "migration settling" — the settings PUT path never re-reads disk) · **silent post-migration
>    credential loss** (once the disk is new-shape, one-level env paths can't address
>    `providers.*.api_key`, so `CTRLB_EMBEDDINGS__API_KEY` lands on an ignored extra and embeddings
>    runs unauthenticated) · the chat trigger blocks on the mere PRESENCE of a `providers:` key, so
>    `providers: {}` permanently disables chat migration silently · a stale `mode:` in a config-held
>    ModelRef is a **hard boot ValidationError** (`extra="forbid"`), while `agents/*/agent.yaml`
>    degrades gracefully — mixed-shape handling is not uniform.
> 7. **THE MIGRATION GETS ITS OWN DESIGN PASS + PEER RESEARCH — NEXT SESSION, NOT A SIDE-FIX (owner,
>    2026-07-25).** *"That needs its own design path, because half-migrated configurations is exactly
>    what's giving us a headache right now — that's a potential issue machine."* The research brief is
>    **peer-class ONLY** (see [`docs/research/README.md`](./research/README.md) §Reference class):
>    **open-webui** (it announces *"migrating database"* at boot — find how), AnythingLLM, LibreChat,
>    opencode, Codex CLI, Kilo Code. The question: **is boot-time the right moment for the whole thing,
>    and how is the cleanup of the old config made part of the system rather than a leftover?** The
>    owner explicitly left the *when* open: *"I don't know if it should be done all at boot time or
>    not — that's what I want you to research."* ⚠ Do NOT re-buy the generic-infra survey (R2 already
>    covers it and was off-class). **✅ OWNER RULED — THE MIGRATION IS ONE-SHOT AND THE CODE DIES WITH IT.** *"I want the
>    migration to occur once, and then we don't have to use that extra code… the extra code should be
>    [there] just for the migration itself, and then we are using the new values, the new systems, the
>    new configuration."* So: **converge at BOOT (not lazy-on-next-save), then DELETE the fold** — no
>    permanent legacy readers, no version-marker-forever machinery. This closes R2's two open questions
>    in the strictest direction and is the standing `no-legacy-seams-clean-final-code` rule applied to
>    its end state. **Owner also required heavy guardrails**: *"this needs heavy testing… make sure
>    that everything [is] defined when you're doing the migration coding."* Design implications to work
>    out BEFORE coding — boot-time write-back must survive a read-only/unwritable config dir, must not
>    fire on a fresh install (Alembic's `stamp` case), must back up first (`.bak-a11-*`, 0600), and the
>    deletion step needs a stated trigger (after the owner's config is confirmed converged, since this
>    is a single-user product with exactly two configs: prod + dev). The prior R2 framing of these as
>    open questions is SUPERSEDED. (both about *deletability*, per the standing
>    no-legacy-seams rule): **(a) add a persisted version marker, or accept the fold is permanent.**
>    Syncthing is the ONLY surveyed project that actually deleted migration code, and the only one with
>    a version int + a declared floor; shape-sniffing produces zero evidence licensing deletion, which
>    is why Authelia (43 folds since 2019) and Gitea (8 releases past their own deadline) can never
>    remove theirs. Marker likely belongs in `ctrlb.db` (we already have `schema_version`) since the
>    YAML is hand-edited. **(b) reconsider LAZY write-back** — "persist on the next save" is a minority
>    position and is *live for us*: a config the user never saves never settles, so the fold can never
>    be retired. Also cheap + recommended: surface deprecations in the UI, not the log.
>
> **NEXT SESSION, in order:** ① model check (`tmux display-message -p '#S'`) ② **build
> [`UPDATE_PLAN.md`](./UPDATE_PLAN.md) slice 1** (the migration runner + tests; nothing moved yet) —
> the plan is v3, council-reviewed, owner-ratified, and its §10 is the slice list ③ then slices 2–8 in
> order, auditing each ④ the A11 pre-release fix list (below) ⑤ owner ratifies the three D48 Slice-2
> calls ⑥ push ⑦ release. **Read `UPDATE_PLAN.md` §8 (owner rulings) and §9 (council record) before
> touching anything — six design decisions were reversed by review and the reasoning is recorded there.**
> **AGENT DISCIPLINE:** [`.claude/skills/second-opinion/SKILL.md`](../.claude/skills/second-opinion/SKILL.md)
> is now the canonical how-to for Codex + subagents (invocation, the stdin trap that cost two full runs,
> scoping, the Fable tier, the council rule). Read it before spawning anything.

> **▶▶ SESSION 2026-07-23 CLOSE-OUT — A11 SLICE 1 (chat) + the owner UI/UX polish are
> COMPLETE, PUSHED to origin/main @ `cfedad7` (CI running; push CI skips e2e — full `check.py --e2e` was
> 7/7 green locally before the push), dev units STOPPED. PROD UNCHANGED = v1.2.1; A11 Slice 1 + D3 slice
> 3 are on main but UNRELEASED.** Session closed clean: main == origin, gate green, nothing in flight.
>
> **WHAT SHIPPED THIS SESSION (7 commits `81dbbd5`→`cfedad7`, atop last session's D48 docs `0fb21e0`
> which was also unpushed and went out now):** ① A11 Slice 1 backend `81dbbd5` + frontend `63f6538` +
> as-built docs `56a11ab` (full build+review pipeline — detail in the block just below). ② The
> owner-requested visual/UX polish in FOUR commits: `796207d` the P1 wave (**kit-tree port** — the HIGH:
> the A11 controls were vapor-only CSS, unstyled under minimal/cosmos/frontier [the boot theme] — +
> wrapping/focus/aria/typography/token fixes + drag-reorder + per-row Advanced fold; Codex GO-w/changes
> → 5 fixes) · `3f4ac95` docs · `8186141` clean field naming (research-backed: **"Wire id"→"Model ID"**,
> **"Max-tokens field"→"Output-limit param"** + a one-line clarifier [it selects which API field carries
> the OUTPUT cap, NOT the context], `auto (from api mode)`→`auto`) + Models-section spacing + the Agents
> compaction number-grid 14px inset · `cfedad7` the FINAL fallback layout the owner signed off:
> **one line `✕ · #N · picker · ⠿`** (✕ remove left of the index, drag handle right, picker fills the
> middle showing the full provider name; the ⠿ handle carries BOTH pointer drag AND ArrowUp/Down keyboard
> reorder — the interim ⋯ dropdown removed). **Final gate: backend 839 pytest · FE 592 vitest · e2e 109 ·
> `check.py --e2e` 7/7.**
>
> **▶ NEXT SESSION — "more stuff to do" (owner-stated), in order:**
> 1. **Owner-ratify 2 D48-interpretation calls** still open (the owner eyeballed + approved the UI, but
>    these two backend/scope decisions were made under agent judgment and flagged, not explicitly
>    signed): **① strict-resolve gating** (FX7 — the strict-resolve 422 fires only for PUTs touching
>    `providers`/`inference`/`agent`; other saves [appearance sync…] run lenient+warn, so a hand-edited
>    lenient-tolerated config can't brick unrelated saves — a reading of D48 C2/R26) · **② voice-scoped
>    per-model UI deferral** (FX17 — only chat-relevant model fields [context_window, output-limit param,
>    id, extra_body] are editable in Slice 1; voice/speed/language/format/dim editors land with Slice 2's
>    consumers; they round-trip unharmed meanwhile, test-pinned). Both in **DECISIONS D48 AS-BUILT**.
> 2. **Build Slice 2 — voice + embeddings** (TODO Phase 13 Slice 2 + D48 §Migration steps 2–3 + C8):
>    mechanical over Slice 1's registry. Flat `provider`/`model?`/`fallbacks[]` on `voice.stt`/`voice.tts`/
>    `embeddings`; delete `VoiceEndpointCfg`/`EmbeddingsCfg` legacy fields (service knobs STAY);
>    `_migrate_legacy()` voice/embeddings folds (dedup by (canonical base_url, api_key) against
>    already-created providers); winning-format from the served hop; TTS voice precedence
>    request>model>"alloy" + model.speed at the wire; STT language model>service; embeddings dim-agreement
>    (422/drop+warn); the Voice STT/TTS/Embeddings section editors (REUSE the Slice-1 picker/fallback/
>    Advanced-fold components) + the deferred per-model voice fields; the **B4 parity list asserted
>    field-by-field** in the Conf e2e. Same pipeline: Opus waves → Codex review → owner pause.
> 3. **Release** (owner's call on timing/bundling): A11 (Slice 1 alone, or wait for Slice 2) AND the
>    still-unreleased **D3 slice 3** ride main. A11 releases ONLY via **D48 §rollout** (prod boots the
>    migration lenient = IDENTICAL runtime behavior; the FIRST config write materialises the new shape +
>    writes the one-time 0600 `config.yaml.bak-a11-<stamp>` backup; rollback = stop→restore .bak→prev
>    tag→start+health, per `deploy/linux/README §Release`). Bundle the `config.example.yaml`/README/
>    SECURITY_MODEL/DEPLOY_EMMA new-shape doc updates Slice 2 finishes.
>
> **DURABLE LESSONS (this session):** styling a SHARED Conf component needs rules in BOTH
> `theme/extras.css` (vapor) AND `theme-engine/kit/kit.css` under `.kit` (THEME_ENGINE §14.4.1) — a
> vapor-only add is invisible under the kit themes; the F1 brief's "net-new pixels ONLY in extras.css"
> line caused exactly this, caught only by the rendered+Codex visual audit, not by gates. · Optimistic
> concurrency for a full-map-replacement subtree = **ETag-scoped-to-subtree**: ride the fingerprint on
> the resource GET (`X-Providers-Rev` on `GET /api/settings`) so the draft's base binds atomically to
> the snapshot it seeded from. · The Conf `.confrow .k` label column carries `flex:1` +
> `min-width: min(140px,45%)`; a content-width label row must override BOTH (bump specificity
> `.confrow.fallback-row .k`). · Codex gpt-5.6-sol(high) earned its keep: the 3 real HIGHs (failover-off
> bypass via chain_for coercion, cross-provider model carry on the /verb, 409-retry stale-draft clobber)
> were code-verified, not noise. · **Dependabot:** the push surfaced 1 high alert (#38) — per the memory
> `dependabot-archive-lockfiles` these have been dev-only vite/esbuild in archive lockfiles; glance to
> confirm #38 is the same class before ignoring.
>
> **ACCEPTED RESIDUALS (recorded, not bugs):** the FE reference-guard blocks a raw id equal to a FORMER
> catalog key the draft removes (errs toward blocking a still-resolvable save; no provenance state) · a
> hand-authored config with BOTH `providers:` and stale legacy keys never migrates (legacy ignored, not
> deleted) · single-user 409 is loud-not-silent (dirty draft keeps its map; reload to rebase).
>
> **▶▶ SESSION 2026-07-23 — A11 SLICE 1 (CHAT) ✅ BUILT + TRIPLE-REVIEWED + GATED (build detail; the
> close-out above is the current truth — PUSHED, not the "NOT PUSHED" this block first recorded).** The unified provider
> registry chat slice, built against D48 via the full orchestrated pipeline: 2-agent pre-flight
> code-truth maps (backend+frontend, every seam file:line-verified) → 26 orchestrator rulings → 3 Opus
> build waves (**B1** backend core: `providers:` schema · quarantined `_migrate_legacy()` + agent.yaml
> fold · `domain/provider.py` · `core/provider_registry.py` [strict/lenient, canonical
> `(gate_identity,limit)` gates, min-wins] · adapter on `ResolvedTarget` + refcount-drain `retire()` ·
> **B2** backend API: C1 rename transaction [restore-by-old-identity secrets, cascade on the final
> merged doc] · providers-base 409 under the write lock · typed 422s [+ fixed a latent 422→500
> serialization bug] · `GET /api/providers` · write-back moved INTO the `edit_config_yaml` chokepoint
> [hosts-CRUD triggers it] · **F1** frontend: Providers ConfGroup cards + shared ProviderModelPicker +
> reorderable fallbacks + draft epoch + `/<provider>` verbs [built-ins > skills > providers] +
> AgentsEditor picker) → **fresh-eyes Opus audit + Codex gpt-5.6-sol(high) review — Codex NO-GO, 3 HIGH
> all code-verified real** (chain_for coercion bypassed `failover:false` · verb mode carried the routed
> model across providers [C7 violation] · 409-retry stale-draft clobber) → **18-fix wave (FX1-FX18)** →
> **Codex fix-set verification: 10/14 CLOSED + 1 new LOW, residual NO-GO on the base-binding skew** →
> **fix round 2: the base now rides `GET /api/settings` as `X-Providers-Rev` (ETag-scoped pattern,
> atomic doc+rev capture)** + skill-delete verb refresh + warning-staleness + picker raw-mode sync.
> **Final gates: backend 839 pytest · FE 579 vitest + 109 Playwright e2e · full `check.py --e2e` 7/7.**
> **OWNER-REVIEW ITEMS at this pause:** ① the strict-resolve gating interpretation + ② the Slice-2
> deferral of voice-scoped model-field UI (both in the D48 AS-BUILT note) + ③ eyeball the net-new Conf
> Providers UI live (cards/rename/model-rows/pickers at narrow width — dev units). Accepted residuals
> recorded in D48 AS-BUILT. Orchestration scratch (briefs/maps/rulings/review outputs) lived in the
> session scratchpad [tmpfs, transient]; the durable record = D48 AS-BUILT + this block + TODO Phase 13.
> **NEXT = owner eyeball/ratify → Slice 2 (voice + embeddings), then release via runbook §Release when
> the owner wants it live (prod boots the migration lenient — IDENTICAL runtime behavior until then).**
>
> **▶ SAME DAY (2026-07-23, later) — the owner-requested VISUAL/UX POLISH WAVE ✅ SHIPPED** (owner
> ratified the 3 design calls: drag-over-arrows · per-row Advanced disclosure · dual remove idioms
> documented). Triple audit first: a rendered Playwright pass (computed-style color diff, 360px,
> frontier+vapor) + a Codex visual audit — **CONVERGED HIGH: the entire A11 control family was
> vapor-only CSS, unstyled under minimal/cosmos/frontier** (root cause = the F1 brief's
> "extras.css-only" line; kit rule = BOTH trees, THEME_ENGINE §14.4.1) — + cited UX research (drag =
> LAYER over retained arrows per Primer/NN-g; progressive disclosure). The P1 wave (13 items) ported
> the family into `kit.css`, fixed wrapping/focus-visible/disabled/recipe-dedup/aria/notice-typography/
> danger-token hygiene, added `useDragReorder` (pointer events, 6px tolerance, pointerId-gated,
> pointercancel+blur+Escape+count-change cancel, NO pointer capture on touch [Fennec lore], aria-live)
> + the closable auto-open Advanced fold. Codex code review GO-w/changes → 5 fixes (incl. the
> forced-colors Highlight outline + the kit `.kv-text.json-field` specificity tie). FE 591 vitest +
> 109 e2e green. **Known cosmetic residual:** the frontier fallback row wraps its handle/arrows/✕ to a
> 2nd line at 360px (functional; vapor/cosmos fit) — owner may want a squeeze pass. **Screenshots =
> session scratchpad `shots-p1/` (tmpfs, transient). Device eyeball still owed: drag feel on Fennec.**
>
> **▶▶ SESSION 2026-07-22 (later) — A11 DESIGN SESSION ✅ COMPLETE — [`DECISIONS.md` D48](./DECISIONS.md)
> LOCKED + OWNER-SIGNED: THE UNIFIED PROVIDER REGISTRY. NEXT SESSION = BUILD (TODO Phase 13 Slice 1,
> chat).** The owner-requested prose design session ran full-pipeline and CLOSED: top-level `providers:`
> map (connection + name-keyed model catalog, clean name vs wire `id`) + flat `provider` primary +
> `fallbacks[]` per consumer section — **voice (STT/TTS) + embeddings unified in** (owner-widened scope;
> embeddings gains failover). Design evolved owner-led through: named endpoint list → per-section lists →
> providers registry → provider-owned model catalog → flat Hermes-style primary/fallbacks; **5 Opus
> web-research passes** (gateway configs · agent harnesses · voice configs · api_mode standards · registry
> patterns; plus the owner's real `~/.hermes` fleet inventoried read-only) grounded every fork. **api_mode
> enum KEPT** (openai|llamacpp|openrouter|none — re-verified: no canonical standard exists for the
> reasoning-dialect layer; D45/D46 stand). **4 Codex rounds** (gpt-5.6-sol high: NO-GO → NO-GO →
> GO-w/changes → GO-w/changes) — every finding verified + ruled + folded; headline catches: rename secret
> wipe / deep-merge can't delete map keys / D40 gate (base_url,limit) generations / uncataloged-model
> probe eligibility / atomic migration write-back at the common chokepoint / rollback ordering. **Owner
> rulings now standing:** NEW VERBS — `/⁠<provider>` (e.g. /llamacpp /openrouter); `/local` `/cloud`
> RETIRE with the slots · **C7-b universal pointer rule** — EVERY backend+model selection (agents,
> defaults, compaction summarizer, routing lead) = the same `ModelRef {provider,model}`, every FE selector
> becomes the shared provider→model picker (incl. AgentsEditor's hardwired Seg) · **NO-LEGACY-SEAMS is a
> PERMANENT rule** (memory `no-legacy-seams-clean-final-code`): one quarantined `_migrate_legacy()` fold,
> old classes DELETED · **build-brief exhaustiveness** (memory `orchestrate-with-opus-subagents`): Opus
> briefs restate every governing contract + exact read-first file/line lists, citations re-verified.
> Docs shipped this session: **D48** (the self-contained normative spec — contracts, module boundary
> [`domain/provider.py` + `core/provider_registry.py` + `ResolvedTarget`, generation publish+drain],
> migration, Conf UI parity spec, prod rollout/rollback incl. one-time 0600 `.bak-a11` backup) ·
> **ROADMAP §A11** amended (design LOCKED → D48) · **TODO Phase 13** (Slice 1 chat · Slice 2
> voice+embeddings; build against D48, NOT the checklist). Build notes for the next session: migration
> tests on temp `CTRLB_CONFIG`/`CTRLB_DB` only; Codex reviews EVERY slice; prod is v1.2.1 (D3s3 still
> unreleased) — A11 releases only via D48 §rollout. *(Design scaffolding briefs lived in the session
> scratchpad [tmpfs — transient]; D48 is deliberately self-sufficient.)*
>
> **▶▶ SESSION 2026-07-22 — ROADMAP D3 SLICE 3 ("Discover from Tailscale") ✅ BUILT + DOUBLE-REVIEWED +
> PUSHED (owner OK) — D3 (multi-homed addressing) IS NOW COMPLETE.** Commits: `cced768` backend ·
> `ebca9eb` frontend · `542005b` review-fix wave · `edcc496` Codex-verify MED fix · docs. The full pipeline at small-slice
> weight (owner-scoped: quick Codex, not the structural tri-review): 2-agent pre-flight (code-truth +
> `tailscale status --json` field research — DNSName label = the unique match key, HostName documented
> non-unique; CLI shell-out = the established on-node pattern; permissions already proven by the live
> access panel) → prose design owner-ratified (read-only endpoint + client applies via the existing PUT;
> zero new knobs; provider-neutral candidate seam, Tailscale wording in labels only; NO StableNodeID
> caching, NO review-checkbox UI — anti-bloat rulings) → 2 Opus waves → fresh-eyes Opus audit + quick
> Codex pass, which CONVERGED on a real HIGH: **the fill PUT's partial body would have wiped
> mac/os_type/services** (`_apply_fields` omit-preserves ONLY the two D47 fields — the wave-2 agent's
> "omit-preserves covers the rest" claim was false; the FE test had enshrined it) → the orchestrator
> review-fix wave `542005b`: full-body `hostToPayload` from a FRESH `/api/hosts` fetch + the YAML
> preserve-pin test + ExitNodeOption dropped from the peer filter (own-fleet exit-capable hosts were
> wrongly skipped; Location + foreign-suffix still kill Mullvad) + case-insensitive `differs` → Codex
> fix-set verification. Gates green every wave (backend 20-test slice files; FE 552). Accepted residuals
> (recorded in the ROADMAP D3 entry + hook doc): sub-second fetch→PUT last-writer-wins window ·
> row-opened-mid-flight skip gap — both single-user-consistent. Then the Codex fix-set verifier on
> `542005b` ruled all four findings CLOSED and surfaced ONE new MED (fill eligibility read the discovery
> snapshot, not the fresh DTO — a value set mid-discovery could be overwritten) → fixed + pin-tested
> `edcc496`. Dev units STOPPED at close (on-demand ruling; start them to poke the button — Conf →
> Computers; corsair's `vpn_host` is still empty on PROD, so after the next release the button is the
> one-tap fill). **STANDING DIRECTIVE AMENDED (owner, 2026-07-22): launch a Codex review agent whenever
> code review is warranted — small slices included, not just structural ones; the quick pass co-found the
> HIGH here and then caught the MED in the fix itself.** **NEXT SESSION = the A11 DESIGN CONVERSATION**
> (ROADMAP A11 — unified custom inference endpoints: retire local/cloud as schema positions → one
> named-endpoint list + failover chain over names; owner wants prose design discussion FIRST, seams are
> recorded in the ROADMAP entry; D3-then-A11 was the owner's stated order this session). Slices 1–8 +
> the reasoning arc + D47 are on prod (v1.2.1); D3 slice 3 is UNRELEASED — release via
> `deploy/linux/README.md` §Release when the owner wants it live.
>
> **▶▶ SESSION 2026-07-20 late → 21 — READ THIS FIRST (the thorough close-out). SESSION CLOSED
> CLEAN: main == origin @ the v1.2.1 tag + this docs commit, CI green, BOTH releases live
> (v1.2.0 → v1.2.1 same night, see the ACTIVE banner), dev units STOPPED (on-demand), prod
> healthy (version 1.2.1, HTTPS 200, riders verified).**
>
> **WHAT SHIPPED TONIGHT (compressed; full detail in the numbered blocks below):** the reasoning-arc
> final foreign review (Codex NO-GO → 7 doors closed → verifier GO) · the A9 owner ruling + head
> reorder (D15 #4 AMENDED) · Slices 4–8 live-verified via a Codex API tester (12 PASS; the S6 fails
> = ONE probe bug, fixed) · D47 multi-homed addressing Slices 1+2 through 3 Codex rounds (SSH
> VPN-failover + Conf fields + vantage-aware links) · the owner-poke UI rounds (reasoning select,
> SOUL legibility, seg stadium-trick, password-manager suppression, host-row summary, per-model
> window probe) · TWO production releases via the runbook agent.
>
> **▶ OWNER ACTIONS NOW AVAILABLE (nothing blocking, all one-tap/one-edit):**
> ① **Set corsair's `vpn_host` + `SSH via VPN first` in Conf → Computers** — the WHOLE POINT of D47
> is live on prod but corsair's field is still EMPTY; until it's set, its firewalled LAN SSH still
> can't be shut down from emma. One edit closes the original 2026-06-30 pain.
> ② Optional: `agent.defaults.routing:` (two-tier lead/worker — config.example has the block).
> ③ Optional: bump `max_concurrent_requests` 1→2 via a settings PUT if the 3060 serves 2 slots.
> ④ On-device eyeballs pending (gate-verified, not phone-eyeballed): the SOUL preview legibility,
> the reasoning select, seg round 2 (capsule when single-row), and whether Chrome's save-password
> nag is actually gone (the fix is the standard suppressor; a stronger escalation exists if not).
> ⑤ Infra you flagged for yourself: emma's 16G RAM tmpfs + the 511M swap sizing.
>
> **▶ NEXT-STEP MENU (pick the next session's work; each has a pinned home):**
> - **A11 — unified custom inference endpoints** (ROADMAP A11; owner-requested DESIGN SESSION):
>   retire local/cloud as schema positions → one named-endpoint list + failover chain over names.
>   Biggest design piece on the table; the seams are recorded in the entry.
> - **H1 — the "gacha" anime theme** (ROADMAP H1; owner-requested design): frontier-mold, kit-based;
>   FRONTIER_PLAN is the template; collect REAL reference images at design time (standing rule).
> - **D3 Slice 3 — "Discover from Tailscale"** (ROADMAP D3): auto-fill `vpn_host` from
>   `tailscale status --json` by HostName match; small backend+Conf slice on the shipped fields.
> - **The final frontier hero art** — the original v1.2.0 reservation, still outstanding; owner
>   supplies/choses art, the pipeline (palette-256+oxipng, contrast gate) exists.
> - **Vapor ladder** (THEME_ENGINE §14.15.3, Phase-11 tail) · **6c-1/6c-2 flags** (TODO) — the two
>   remaining pre-existing tails.
> - **Backbone (unscheduled, trigger-gated):** SYS-3 structural half (overlay-at-read makes the
>   settings-409 gate unnecessary) · SYS-2 two-phase `Deps` (trigger: next lifespan/main.py work) ·
>   the ACA backlog in ROADMAP A5-x (A8 deferred tool schemas · content-chant detector ·
>   thinking-block transforms · B1 progressive memory index) · UI_AUDIT F9/F13 chat render cost
>   (trigger: >~200-msg thread or input lag — Profiler first).
> - **LOW backlog from the live-test** (ROADMAP A5-x): turn-status DB fallback after terminal-cache
>   eviction (a completed thread reads `terminal_status: null` — display-only) · `/compact`-on-
>   small-thread UX (inflation-reject reads like a failure).
> - **A9 measurement rider:** just OBSERVE `cache_n`/`prompt_n` at turn boundaries in daily use
>   (parsed at `inference.py` ~1031; nobody has looked yet); escalation path if pressure appears =
>   read-through with write-invalidation, never the freeze (owner-ruled).
>
> **▶ NUANCES + ACCEPTED RESIDUALS a cold session must not re-litigate (all recorded in their
> D-entries):** D47's remote-execution residual (a transmitted command runs regardless of local
> deadlines — layered budgets + honest TIMEOUT wording + forced-confirm bound it; Codex's final
> NO-GO position recorded, ruled accepted) · D46's `openai` api_mode passes `off`/`xhigh`/`max`
> verbatim (the 400-feedback absorbs it) · `chat_template_kwargs` is not in the classifier's
> named-param set (a llamacpp-misconfig against an OpenAI server may not degrade on that key) ·
> the reasoning fold is dialect-blind + `_NAMED_PARAM_RE` keeps a trailing dot (both INFO,
> unreachable in measured shapes) · vault's router-mode llama-server: the probe now sends
> `?model=` (owner's find — bare `/props` reports n_ctx 0; NO manual `context_window` needed) ·
> Slice-7 retry tier remains NOT-TRIGGERED live (never forced; will show under real slot
> contention) · grants pin tool args only, so SSH failover can never break an approval.
>
> **▶ Standing session rules (unchanged)** *(▲ MODEL LAYER SUPERSEDED 2026-07-24 — main is Opus 5
> HIGH, subagents Opus 5 high, Fable 5 = on-request second opinion; see the ACTIVE block up top.
> Everything else below still stands):* /model check at start (fable-5 HIGH) · Fable =
> orchestrator/reviewer alongside Codex (`gpt-5.6-sol` high, the standing foreign reviewer — it
> caught real HIGHs again tonight, THREE rounds on D47); ALL mechanical/specified work = Opus 4.8
> subagents (incl. runbook releases — two more executed flawlessly tonight) · commit autonomously,
> push on the owner's word · `TMPDIR=/home/emma/.cache/tmp` on heavy commands (tmpfs!) · dev
> units on-demand · live-tester/reviewer HIGH claims get final-judge verification before fixes
> (two of three live-test "defects" tonight were artifacts).**
> **① The reasoning-arc FINAL FOREIGN REVIEW (checklist ③) ran and EARNED ITS KEEP: Codex NO-GO,
> 4 HIGH / 2 MED** — all six verified real by the orchestrator (headline: `off` was NOT absolute
> when an endpoint hand-set `extra_body.reasoning`; the forbidden OpenRouter pair was still
> emittable via the extra_body shorthand; a concurrency race skipped the D46 degradation) → Opus
> fix wave `bcdebfe` + an orchestrator-found SEVENTH door (`agent.defaults` reasoning edits never
> cleared demotions — `5c6c5a5`) → fresh-eyes verifier **GO** → close-out `4af01ee` (shape-only
> namespace now FOLDS the effort instead of dropping it) → **PUSHED with owner OK, main CI GREEN.**
> **② `api_mode` is SET ON DEV** (`local: llamacpp` · `cloud: openrouter`, schema-validated, backup
> beside it) — D45/D46 are live on :5434; prod gets the same two lines at release.
> **③ A9 RULED (owner): keep per-turn memory reads; freeze REJECTED as premature. Shipped the head
> reorder** `c5538fa` — memory now rides AFTER the roster (D15 #4 AMENDED; order-pinning test), so a
> memory write never evicts the roster from a prefix cache. Next = observe `cache_n`/`prompt_n` at
> turn boundaries in daily use. §6 is now FULLY ruled. *(Also: the Composer Surface was found
> already-COMPLETE since 2026-07-11 — the stale CLAUDE.md "parked" row fixed, `392200b`.)*
> **④ Slices 4–8 LIVE-VERIFY EXECUTED (owner-ordered, via a Codex live-tester on the dev API —
> repo read-only, fleet rails on): 12 PASS / 3 FAIL / 1 NOT-TRIGGERED.** S4 parallel dispatch +
> per-call persistence REAL (pings ≈ max not Σ) · S5 steering all four scenarios · S8 approvals
> end-to-end (grant/exact-pin/revoke/no-always-on-forced-confirm). **The S6 FAILs were ONE root
> cause, found+fixed same night `3563bb9`: vault's llama-server runs in ROUTER mode and `/props`
> reports `n_ctx: 0`, which the D42 probe accepted as the window** (activated that day by ②!) —
> window 0 made the summarizer's overflow guard short-circuit to the truncation placeholder without
> ever calling the summarizer (the tester's "destructive compaction + hallucinated recall").
> Non-positive probe ⇒ no-probe now. **⚠ OWNER CONFIG: router-mode endpoints CANNOT be probed — set
> `context_window` explicitly on `inference.local`** (deploy README §Inference tuning has the
> caveat). **S7.11 "re-attach turn loss" = NOT A DEFECT** (DB-verified full persistence; the
> `terminal_status: null` was the 60s/32-entry terminal-cache eviction — a display artifact; two LOW
> backlog items recorded in ROADMAP A5-x, `b7a0724`). A tester-induced junk memory entry was cleaned
> from dev's memories/.
> **⑤ ROADMAP D3 SLICE 1 (multi-homed addressing) ✅ BUILT + 3-ROUND FOREIGN-REVIEWED — D47.**
> The full pipeline: code-truth (design HELD + 6 amendments — typed `SshResult.kind`, ONE shared
> failover loop, blank-drop resolver) → **D47 LOCKED** `6837833` → build `925c71c` (schema
> `vpn_host`/`ssh_prefer_vpn` + `host_addresses()` chokepoint + connect-only failover at all three
> SSH sites + CRUD round-trip; 11 tests) → orchestrator review fix `c0bc4c9` (read-phase timeout
> was misclassified as connect ⇒ spurious re-execution) → **Codex NO-GO** (2H/1M/1L) → `8dbdb1f`
> (deadline-gated candidates · **omit-preserves on the two new fields** [the shipped MachineEditor
> predates them — an edit would have WIPED a configured vpn_host] · banner-timeout is
> connect-phase) → verify-2 `10c1165` (the 16s pre-gate can't be sufficient because auth is
> deliberately unbounded ⇒ the MEASURED post-connect exec cutoff: a command never starts without a
> full exec window remaining — also closes the pre-existing single-candidate overrun) → round 3
> `d879532` (paramiko's exec timeout is PER-OP not total ⇒ the total-exec channel re-slice +
> `SSH_BUDGET_SLACK_S` + the TIMEOUT summary now says "may still be completing on the host").
> **CLOSED BY ORCHESTRATOR RULING with an ACCEPTED RESIDUAL recorded in D47 AMENDED-2** (once the
> command is transmitted the remote host runs it regardless — irreducible; Codex's final NO-GO
> position recorded, not chased; forced-confirm bounds the destructive cases). **You can now give a
> host a `vpn_host` + `ssh_prefer_vpn: true` (YAML or API — corsair's firewalled LAN SSH finally
> gets VPN-first failover); the Conf editor fields + vantage-aware links = Slice 2 (ROADMAP D3).**
> **NEXT SESSION, in order:** ① /model check ② owner push OK → `git push` (~11 commits; pre-push
> runs the full gate) ③ owner config on dev when poking: `context_window` on `inference.local`
> (router-mode can't be probed); the standing Slice-4/6 reminders + `api_mode` on PROD at release
> ④ dev units are RUNNING — stop after poking (`systemctl --user stop ctrl-b-dashboard-dev
> ctrl-b-dashboard-dev-web`) ⑤ next = D3 Slice 2 (frontend: editor fields + vantage-aware service
> links) or the owner's pick (6c-1/6c-2 flags · vapor ladder) ⑥ prod release (Slices 1–8 + the
> reasoning arc + D47 s1 are all unreleased) via `deploy/linux/README.md` §Release when wanted.
>
> **▶ SESSION CLOSE 2026-07-20 PM (the previous close) — ALL PUSHED, CI green, tree clean @ `bee6760`.**
> **What shipped after Slice 8** (all on origin/main): `fb59c83`+`4dae8d5` host address field takes a
> DNS name on mobile (the numeric `inputMode` made it paste-only; label is now "IP or DNS name" — the
> e2e caught that "IP or host**name**" collides with "Hostname" under Playwright's SUBSTRING
> `getByLabel`) · `1b47e50`+`f550a2d` **SYS-16 CLOSED** (13 blocking fs calls off the event loop via
> `asyncio.to_thread` + TWO AST ratchets in `test_arch_invariants_sys16.py`; the 2nd guard — async defs
> calling sync helpers — found 2 sites the hand audit missed incl. `memory.write`) · `f0bbef4`
> **SYS-3/ACA-17 race CLOSED** (`PUT /api/settings` 409s on a `tool_overrides` patch while a turn is
> live; scoped so appearance writes AND the D44 grant path are unaffected — do NOT hoist that gate into
> `apply_settings_patch`, there's a named test) · `92dc3a3` post-ACA bookkeeping (7 built-but-unticked
> Phase-12 boxes ticked; 6 backlog items + 5 slice seams RE-HOMED into ROADMAP/DECISIONS so they survive
> the chapter closing) · `8172cfc`→`bee6760` **the reasoning arc (D45+D46)**.
>
> **▶ THE REASONING ARC (D45 + D46) — ✅ COMPLETE, and it is the cautionary tale of the session.**
> The premise the old code encoded was INVERTED: llama-server **ignores `reasoning_effort`** entirely
> (maintainer-confirmed) and **accepts a per-request integer budget** — so we were sending the dead knob
> and withholding the live one. Now: ONE explicit **`api_mode`** per endpoint
> (`openai|llamacpp|openrouter|none`, the Hermes naming convention; absorbed `max_tokens_field` as
> derived-with-override) → the `reasoning_effort` ladder translates per dialect (llama.cpp gets a token
> budget, `off`→0 and `max`→-1 being llama.cpp's OWN sentinels), `reasoning_tokens` is an explicit
> override, `off` is ABSOLUTE. **NO auto-detection** — field research across 13 systems found nobody
> infers wire shape from `base_url`, and Hermes shipped URL auto-detection then RETREATED from it; the
> self-hosted heuristic survives as an advisory WARNING only (`warn_suspect_api_modes`), never a branch.
> **⚠ THE OWNER MUST SET `api_mode: llamacpp` ON THE LIVE CONFIG** — it defaults to `openai` for
> back-compat, so on an untouched `config.yaml` the feature is INERT (that's what the warning nags
> about). No UI for it yet → YAML edit or a settings PUT. **Verified 2026-07-20: BOTH dev and prod have
> `api_mode` unset on `inference.local` AND `inference.cloud`** (local `192.168.1.137:5001` = llama.cpp,
> cloud = openrouter.ai) — so set `local: llamacpp` + `cloud: openrouter` on both.
> **The build wave's flagged risk on the `max_tokens_field` derivation flip was EMPIRICALLY CLEARED for
> this config:** with `api_mode` unset the derivation now sends `max_completion_tokens`, and a live
> probe confirmed **OpenRouter accepts BOTH spellings (HTTP 200 each)**; llama.cpp aliases both by
> design (`server-schema.cpp add_alias`). So no endpoint here breaks. The residual risk stands only for
> a *different* non-OpenAI cloud left on the default `api_mode` — recorded in D46, one-line remedy
> (set its `api_mode`, or pin `max_tokens_field` explicitly), and NOT covered by the D46 400-feedback
> path (it isn't a reasoning key, so it would burn the chain).
> **Three corrections I got wrong first, all fixed, all recorded honestly in D45/D46:** ⓐ I ruled that
> OpenRouter rejects `max` from a docs page narrower than reality and shipped a clamp — **live testing
> proved `max` is accepted (HTTP 200), their own invalid-value error literally reads `expected one of
> "max"|"xhigh"|…`**; clamp reverted. ⓑ the `off`→`none` map was right but incomplete (`none` 400s on
> mandatory-reasoning models). ⓒ the real lesson: **`supported_efforts` is PER-MODEL** (339 OpenRouter
> models, wildly varying sets; only 22 accept `max`) so **no static table can be correct** → D46 makes a
> reasoning-param 400 into capability FEEDBACK: strip the reasoning keys, retry the SAME endpoint ONCE,
> remember the demotion per `(endpoint, model)`, and WARN LOUDLY (silent dropping is LiteLLM's
> most-complained-about behaviour; RFC 9413 §5.1 says a fault must receive attention).
> **Method note for the next session: the live API was the only source that got this right.** Two of my
> own research passes and one adversarial audit each asserted a different wrong enum. When a wire
> contract matters, hit the endpoint.
>
> **▶ TOPIC THE OWNER WANTS TO DISCUSS NEXT: A9 / §6 Q5 — agent-memory freshness ("the frozen memory
> thing"). Researched 2026-07-20; the binary framing is FALSE and the recommendation is cheap.**
> Posed as per-turn re-read (today) vs Hermes-style per-session freeze. Reality: every backend
> invalidates a cache **only from the change point onward** (Anthropic breakpoints cascade downward,
> OpenAI prefix-matches, vLLM chains block hashes, llama.cpp reuses the common prefix), so what matters
> is **what sits AFTER memory**, not whether memory changes. Hermes' own tracker argues this: issues
> #13631 and #25971 (1% hit rate, 5–10× cost, 5-min prefills) were fixed by MOVING the volatile block
> after the cache breakpoint, not by freezing harder. **Code truth:** `session.py:_static_prefix()`
> orders system → appends → **memory** → roster → skills-note, and the roster is config-projected
> (~never changes) while the skills note changes per turn. **⇒ RECOMMENDED FIRST ACTION (2 lines,
> zero risk): reorder to system → appends → roster → memory → skills-note**, so a memory write stops
> needlessly invalidating the roster. **THEN MEASURE** — `cache_n`/`prompt_n` are already parsed
> (`inference.py:1031-1033`) and nobody has ever looked at them; compare turn boundaries with vs
> without a memory write. **Verdict: a per-session freeze is premature optimization HERE** — we already
> freeze within a turn (the loop reuses the head byte-identically), writes are rare (~2.2KB cap,
> consolidation-driven), and the decisive asymmetry is that **ctrl-b has NO memory `read` tool** (a
> deliberate Hermes-parity choice): Claude Code can freeze safely because its agent can always Read the
> file back, Hermes freezes without that hatch and eats exactly the "I told it to remember X and it
> acts like it doesn't know" defect. If measurement ever demands more, the right escalation is
> **read-through with write-invalidation** (reuse the snapshot unless THIS thread's agent wrote), not
> the freeze — the write is the invalidation signal, so the confusing failure becomes impossible.
>
> **▶ REMAINING BACKBONE TOPICS (the completeness sweep's open set, all with a home now):**
> ① **SYS-3 structural half** — the race is closed, but "overlay-at-read" (resolve tool overrides at
> `to_openai_tools`/catalog time so live specs become immutable and `tool_spec_orig` disappears) would
> make the gate unnecessary rather than merely correct. ② **SYS-2** — two-phase `Deps` / subagent
> runtime guards; its parking slice (ACA 3) shipped without it, now "open, unscheduled" with
> lifespan/`main.py` adjacency as the trigger. ③ **ACA backlog, re-homed into ROADMAP** — A8 deferred
> tool schemas · Gemini-style content-chant detector · pi thinking-block transforms · progressive
> memory index (B1). ④ **UI_AUDIT F9/F13** (chat render cost) now carry a concrete trigger: a
> >~200-message thread OR owner-reported input lag, measure with a Profiler trace first. ⑤ **The
> `openai` api_mode still passes `off`/`xhigh`/`max` verbatim** where OpenAI's enum may differ —
> recorded residual, and D46's 400-feedback now absorbs it at runtime.
>
> **▶ LIVE-VERIFY still outstanding (~19 owner pokes, Slices 5–8)** — the compact list is the ACA §5
> per-slice LIVE-VERIFY blocks. Slice 8's is short: tap **always** on a real MED bubble → the same
> command never re-asks and the row shows `[auto-allowed: …]` · the rule appears in Conf → Tools, revoke
> → next call re-asks · a `shutdown_host`/`run_shell` bubble shows NO always button. ⚠ dev drives the
> REAL fleet. ⚠ any approval granted on dev BEFORE `e0c1482` pins the old literal `"null"` and now fails
> CLOSED (re-tap "always" to regenerate).
>
> **▶ ENVIRONMENT — the session's biggest time sink, READ BEFORE DEBUGGING ANY "FLAKY" TEST.**
> emma's **`/tmp` is a RAM-backed tmpfs (16G of 30G RAM)**, not disk (the NVMe is at 21%). It hit 100%,
> and the failures LIE: Playwright died with `Check failed: No space left on device` presenting as
> varying "Target crashed" tests, agent tool calls silently lost stdout, and a **pre-push gate failed
> with 20 test errors that then passed four different ways**. RAM was 25G/30G used, `shared` ≈14G,
> **swap 511M/511M fully exhausted** (a suspiciously small swap for this box — owner flagged both for
> review). **Workaround that works: `TMPDIR=/home/emma/.cache/tmp` on every heavy command** (gates,
> pushes, e2e). Culprits: another project's `hermes-*` dirs (~4.6G, owner's, left untouched) and MY OWN
> research subagents cloning source repos into the scratchpad (~5G in one session — **clean those up
> after a research pass**). tmpfs only empties on reboot; the owner rebooted deliberately as the fix.
> Memory note: `emma-tmp-is-tmpfs-ram.md`.
>
> **▶ NEXT SESSION, in order:** ① /model check (fable-5 HIGH) ② confirm CI green @ `bee6760`
> ③ **⭐ OWNER-REQUESTED: a FINAL FOREIGN REVIEW of the WHOLE reasoning arc by Codex (`gpt-5.6-sol`,
> HIGH)** — the standing tri-review pattern that caught HIGHs on Slices 3–7 that same-family rounds
> normalized. Scope it at the full arc, not one commit: **`8172cfc` (D45 feature) → `811699b` (SDK
> signature fix) → `51e4c0f` (5 audit fixes) → `bee6760` (D46 `api_mode` + 400-degradation + clamp
> revert)**, plus DECISIONS **D45 (incl. AMENDED/AMENDED-2)** and **D46**. Point it especially at:
> the **400-degradation retry** (does it consume a D43 failover hop or a transient-retry attempt? can it
> loop? permit/semaphore handling on the retry? does the per-`(endpoint, model)` demotion leak across
> config reloads?) · the **`extra_body` deep-merge** (`chat_template_kwargs` + OpenRouter `reasoning`)
> and whether any input pair can still emit the mutually-exclusive `effort`+`max_tokens` · **per-hop
> `api_mode` resolution** across failover/routing (a llamacpp-shaped body must never reach an OpenAI
> hop) · the derived-with-override `max_tokens_field` · and whether D45/D46 as written match the code
> as shipped (three of my own rulings in this arc were WRONG before live testing — assume the docs may
> still overstate). ④ **set `api_mode: llamacpp` on the live config** (dev first, prod at release) —
> without it D45/D46 do nothing ⑤ the A9 memory reorder + measurement above (cheap, evidence-backed)
> ⑥ **the owner wants a working session on the AGENT-BACKBONE open set** — A9 (above), the REMAINING
> BACKBONE TOPICS list, and any nuance surfacing from ③'s review ⑦ **prod is STILL v1.1.1 and now
> ~100 commits behind** — Slices 1–8, approvals, the reasoning arc and today's fixes are all
> unreleased; release via `deploy/linux/README.md` §Release when the owner wants them live ⑥ then the
> owner's pick (ROADMAP D3 Slice 1 multi-homed addressing is the one that bites daily — corsair's LAN
> SSH is firewalled, the MagicDNS-name-in-the-`ip`-field stopgap is now at least typeable).
>
> **▶ SESSION 2026-07-20 (cont.): ACA SLICE 8 (persisted approvals / "always allow", D44) ✅ BUILT
> end-to-end across W1–W5 + POST-BUILD AUDITED — 7 LOCAL COMMITS, NOT PUSHED (`b2a2cb4` owner rig art
> + `2279d26` D44 LOCK + `08ef3c1` W1 + `919680b` W2 + `e080731` W3 + `137efe2` W4 docs + `e0c1482` W5
> post-audit fixes). Final gate `check.py --e2e` **7/7 GREEN**; backend 711 / FE 527 tests.** The pipeline: ACA §5 Slice
> 8 sketch + §6 Q7/Q8 → 1 code-truth pass + **3 sourced field passes** (CLI tools · agent
> frameworks/SDKs — the Claude Agent SDK's un-bypassable `requiresUserInteraction` class, goose's
> `permission.yaml`, opencode's Once/Always · mature policy systems — XACML combining algorithms, OPA,
> polkit, sudoers NOPASSWD footguns, browser/mobile grant decay) → **five owner rulings** → **2-lens
> adversarial review** (design + security, both GO-WITH-FIXES; 3 HIGH / 6 MED / 6 LOW all resolved into
> the plan) → **D44 LOCKED** (`2279d26`; brief = `docs/SLICE8_PLAN.md`) → 3 Opus build waves + this doc
> wave. **What you now GET, plainly: tap "always" on a confirm bubble and that EXACT command never asks
> again** — same tool, same arguments, down to an omitted optional (a `docker ps` grant does not cover
> `docker ps` in a different directory). **Manage or revoke them in Conf → Tools** (each tool card lists
> its rules; one tap to revoke, or add a widened rule with a glob). **`shutdown`, `reboot` and
> `run_shell` ALWAYS ask** — the designer's forced-confirm can't be bought off, and those bubbles show
> no "always" button at all. Every auto-allowed run is stamped `[auto-allowed: …]` in its activity
> summary, and a grant is actor-agnostic **by design** — it also silences that exact call for the agent
> and headless subagents (owner ruling ④, recorded as an accepted risk in SECURITY_MODEL §2.5). No
> expiry: a grant stands until you revoke it. **As-built amendments** (all in D44 AMENDED +
> SLICE8_PLAN's banner): the `[auto-allowed: …]` marker DOES stamp the granting run itself (benign —
> the rule lands before that run executes) · the eligibility check gained a `not spec.confirm` gate in
> W3 and the Tools editor is hidden for pinned tools (a hand-edited rule there is inert and not
> UI-revocable) · `exact_arg_pins` is the one shared pin builder · `/api/actions` carries `approvals`
> as the editor's read source · `settings_write_lock` + `apply_settings_patch` were re-homed into
> `runtime.py` and `PUT /api/settings` refactored onto them (one lock, one write sequence).
> **▶ POST-BUILD AUDIT → W5 (`e0c1482`, SHIP-WITH-FIXES, all 7 findings closed):** the audit VERIFIED
> the riskiest piece (the settings write-path re-homing — incl. the `model_copy()` restart-path
> subtlety that looks like a bug and isn't) and the 8 invariants, then found two real ones. **MED-1:**
> the `[auto-allowed: …]` marker dumped UNTRUNCATED arg values into every auto-allowed run's
> `Event.summary` — a `terminal_write_file` grant would have appended KB of file content per run, and a
> credential-bearing MCP arg would land in the log in the clear → values now clip at 32 chars (field
> names stay whole). **MED-2 (invariant 5 was literally FALSE):** `canonical_str(None)` and
> `canonical_str("null")` both produced `"null"`, so a grant pinning an omitted optional also matched a
> call passing the literal string — reachable end-to-end on `web_search` → `None` now canonicalizes to
> `NONE_CANON = "\x00null"`, pinned unescaped, **YAML round-trip verified empirically by test** (the
> writer escapes it, the loader returns it byte-identical, the rule still matches; residual documented
> limitation: canonicalization stays type-blind for an `int | str` field — no tool has one). Plus:
> `args: {}` (empty AND, zero-field tools) no longer conflated with `args: null` (whole-action) — the
> silent-widening path is closed · **ONE settings lock** (hosts + integrations CRUD dropped their
> private locks for `runtime.settings_write_lock`; no re-entrancy, taken at the outermost site only —
> a pre-existing two-lock/no-lock hazard W2's re-homing made cheap to fix) · a grant FAILURE now
> reaches the audit row too (`invoke(summary_note=…)` folded in before `_record`, not just the SSE
> frame) · the §9 promises that had no test now have one (concurrent settings write — **the first
> version passed without the lock, so it was rewritten with a `reconfigure` tracer and confirmed to
> FAIL on a no-op lock** · the headless-subagent marker · sibling `description`/`agent_mode`
> preservation). **⚠ Behavior break on dev-granted rules:** any rule granted on the dev instance
> earlier today pins the old literal `"null"` and will no longer match — it fails CLOSED (the call
> re-asks); re-tap "always" to regenerate. Prod is unaffected (still v1.1.1).
> **State:** dev units still RUNNING (:5434 + Vite :5173); **prod is still v1.1.1**.
> **NEXT SESSION, in order:** ① /model check (fable-5 HIGH) ② ~~**push OK** → `git push` (5 + doc commits;
> pre-push runs the full gate)~~ **✅ DONE — ACA Slice 8 is on `origin/main` (`b2a2cb4..96105de`); the whole
> ACA track, Slices 0–8, is pushed.** ③ live-verify pokes, all still outstanding — the ACA §5 LIVE-VERIFY
> lists for Slices 5, 6, 7 **and 8** (Slice 8: tap **always** on a real `terminal_exec` read → re-run
> never re-asks + the row shows `[auto-allowed: …]`; revoke in Conf → Tools → the next call re-asks; a
> `shutdown_host` bubble shows NO always button; ⚠ dev drives the REAL fleet) ④ release via
> `deploy/linux/README.md` §Release when the owner wants Slices 4–8 live on :5433 ⑤ next = the owner's
> pick (ROADMAP D3 Slice 1 · 6c-1/6c-2 flags · vapor ladder · the parked Composer Surface) — **the ACA
> plan's built slices now run 0–8, i.e. the whole §5 execution plan.**
>
> **▶ SESSION 2026-07-20 (post-ACA): three fixes + a docs bookkeeping/re-homing pass. 4 code commits
> LOCAL, NOT PUSHED** (`fb59c83` · `1b47e50` · `f550a2d` · `f0bbef4`) **+ this docs commit.** Slice 8
> and everything before it ARE pushed (`origin/main` @ `96105de`); these four are on top.
> - **`fb59c83`** — the Conf host-editor IP field dropped `inputMode="decimal"`, so a MagicDNS
>   hostname can finally be *typed* on Android, not only pasted (`ComputerCfg.ip` is a plain `str`).
>   Stopgap only — **ROADMAP D3** remains the proper LAN-vs-VPN split, and now records this.
> - **`1b47e50` + `f550a2d` — SYS-16 is CLOSED.** The deep pass the addendum deferred to "the ACA
>   Phase-12 deep pass" (which no slice ever owned) ran: every deferred blocking-fs site moved off the
>   event loop via one `asyncio.to_thread` hop per hoisted sync helper (the existing
>   `memory_backup._prep_repo_dir` convention), plus `tests/test_arch_invariants_sys16.py` — **two**
>   AST ratchets, one per blind spot ruff can't see (direct blocking calls in `async def`, **and**
>   async defs calling sync helpers that block). The second guard immediately found **2 sites the hand
>   audit missed**, including `memory.write`. 715 backend tests.
> - **`f0bbef4` — SYS-3/ACA-17 race closed.** `PUT /api/settings` 409s on a `tool_overrides` patch
>   while a turn is live (the integrations-rediscover gate precedent, same busy-truth registry),
>   scoped so appearance writes and the **D44 grant path are unaffected** — the gate is in the API
>   handler deliberately; do not hoist it into `apply_settings_patch`. SYS-3's structural half
>   (overlay-at-read) stays open + unscheduled.
> - **Docs pass:** Phase 12 Slices 1–7 ticked with commit evidence (they were built + pushed but still
>   `[ ]`); three shipped post-v1 backlog items ticked (A1 privilege levels, A2 `bb82882`, C1/D17
>   `3fb6603`); ACA §5's "ALL LOCAL, awaiting push OK" records corrected; the §5 doc-artifacts table's
>   stale **D35/D36/D37** → the real **D39/D38/D43** (with an inline correction note); SECURITY_MODEL's
>   confirm-token "gap → step 4b" row corrected to **closed** (4b shipped 2026-07-02); SYS-2 re-homed
>   (its parking slice, ACA Slice 3, shipped without it) — still open, unscheduled; UI_AUDIT F9/F13 +
>   ACA-14 got a real **measurement trigger** (>~200-message thread, or owner-reported streaming input
>   lag); the ACA Backlog's six orphans lifted into **ROADMAP A5-x + B1**; five slice-plan seams
>   appended to **DECISIONS D42/D44** out-of-scope blocks; the `!<cmd>`-is-a-stub code comments
>   corrected (it has been fully built since Phase 5).
> - **⚠ ONE OWNER CALL OUTSTANDING — ACA §6 Q5 / A9** (per-turn memory reads vs a Hermes-style
>   per-session freeze). It is the only §6 question never answered. **The standing default is per-turn
>   reads — today's behavior, by inaction, NOT an owner ruling.** Recorded as such in ACA §6, the §4
>   adoption row, and ROADMAP B1; nothing built either way.
>
> *(The block below is the previous session's close-out checklist, kept for provenance — steps 1–3
> are done as recorded above.)*
> **▶ SESSION CLOSED 2026-07-17 early AM (owner to sleep) — NEXT SESSION, in order:**
> 1. **/model check** (fable-5 + HIGH — the app selector may default low).
> 2. **Start the dev units** (`systemctl --user start ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web`;
>    stopped at close per the on-demand ruling) → **owner eyeball on http://emma:5173, the pinned
>    test script:** ① "Ping all my hosts and give me a status summary" (the ACA-12 no-false-stall
>    proof — pre-fix, identical ping results could cut the turn short) · ② "Which services are
>    running on vault, and are they healthy?" (bounded reads) · ③ "Reboot corsair" → confirm bubble;
>    **DENY unless a real reboot is acceptable — dev controls the REAL fleet**; the full
>    re-mint+consume path = leave the bubble >2 min then Allow (WILL reboot) · ④ composer
>    `!echo hello` then `!sleep 90` (clean ~60s timeout result, no hang) · ⑤ a few normal turns.
>    **▶ Eyeball round 1 (2026-07-17) found + FIXED the DISMISS RETRY LOOP:** the small model read
>    `[skipped] {tool} dismissed by the owner` as transient and re-called → fresh bubble each time.
>    Fix (researched vs Claude Code/Codex/Gemini/Cline denial wording; owner-approved design): dismiss
>    now yields `DENIED` + explicit owner-refusal steering ("REJECTED… NOT run… do not retry";
>    `question` variant "declined") · `_LoopGuard.denied_sigs` no-rebubble echo (a same-drive identical
>    re-issue gets "(already rejected)" DENIED, not progress → stall guard; user-approved resumes
>    exempt) · bubble labels execute/dismiss → **allow/deny** (+ proposal reject / question decline;
>    wire values + CSS classes unchanged) · proposal-dismiss summary reworded. Gate 7/7 incl. e2e.
>    (Cache-telemetry line is DEBUG-level — not visible at the dev units' default log level;
>    verified via tests + a live llama-server probe instead.)
> 3. **Owner push OK → `git push`** (12 local commits `6a9ac4c`..`6c32368`; pre-push hook runs the
>    full gate).
> 4. **ACA Slice 2 (turn integrity) — DESIGN REVIEW FIRST** (D36 drafted there, per §5): the
>    per-thread turn marker is a REGISTRY ENTRY on app.state (never a held lock — Slice 3 extends
>    it in place; note the existing `active_turns` int gauge stays alongside), scope = EVERY
>    thread-mutating endpoint (chat/resume/plan/apply/compact/exec → 409), reserve synchronously
>    in the handler (TOCTOU), shielded-`finally` step persistence (anyio CancelScope(shield=True),
>    YIELD-FREE, re-raise; anyio 4.14.1 installed = post-#642, safe), `Database.transaction()`
>    with **BEGIN IMMEDIATE + non-zero busy_timeout** (v2.3 amendment), frontend guards + the
>    ResumeRequest `mode` (ACA-16). **SYS-1 (`Database.transaction()` WAL rider) rides this slice.**
> **Session nuances worth carrying:** the pyright gate lesson (a "trivial" 4-line rider broke it
> unseen — run the FULL gate even on leaf fixes; also pyright nags to update 1.1.409→1.1.411,
> cosmetic) · skill-selector knobs (`skill_min_overlap`/`skill_max_active`) apply on RESTART only
> (documented; hot-reload = possible follow-up via per-call threading like the agent selector) ·
> `subagent_child_timeout_s` applies live per fan-out · INFO-5 accepted: stale `ADAPTER_BOUNDED`
> entries aren't test-caught (forward direction IS fail-closed) — opportunistic cleanup ·
> installed pins verified: MCP SDK 1.28.1 (in-SDK 2s stdio cleanup), anyio 4.14.1 · the owner's
> **vault idea is PARKED** (memory `vault-parked-enable-disable-pluggability`: no formal spec;
> the binding bit = whole-functionality enable/disable toggles like tools/skills) · the
> **subagent-usage split is standing** (Fable = analysis/audits/rulings ONLY; Opus 4.8 high =
> ALL mechanical/operational/well-specified work incl. runbook releases — v1.1.1 should have
> been one).
> *(The block below is the as-built record of those four fixes — the pre-flight pins they were
> built from, kept for provenance.)*
> - **①–③ the SYS-16 ruff ratchet (ASYNC+B)** — pyproject `[tool.ruff.lint]` select `["E","F","I"]`
>   → `+ "ASYNC","B"` (also refresh the stale "add B/UP/SIM later" comment ~line 65; NO
>   per-file-ignores needed, no noqa at any site; `--preview` would add 2 events.py findings —
>   preview stays OFF, recorded only; B008/`Depends()` count today = 0 — future endpoints use
>   `Annotated`, never a project ignore). Exactly 3 findings to fix:
>   **①** `memory_backup.py:101` (`commit`) — extract the per-path resolve loop into a static sync
>   `_rel_paths(paths, root) -> list[str]` (keeps `except ValueError: continue` per path; computes
>   `root.resolve()` ONCE) → `rels = await asyncio.to_thread(self._rel_paths, paths, root)`. Safe
>   under `guard()` — commit already awaits subprocesses with the lock held (guard is the
>   single-writer non-reentrant lock; callers memory.py:213/273 hold it).
>   **②** `memory_backup.py:173` (`_ensure_repo`) — fold the WHOLE blocking prelude (safe_root →
>   `.git` is_dir "ready" check → mkdir + its `except OSError` → `_write_gitignore`) into ONE sync
>   `_prep_repo_dir(root) -> "ready"|"init"|"abort"` + one `to_thread` hop; the async body keeps the
>   `_git_bin` check + the `_run` init/add/commit calls; final return =
>   `await asyncio.to_thread((root / ".git").is_dir)`. Behavior-preserving; deliberately covers the
>   ASYNC240-UNFLAGGED neighbors :168/:170/:176/:182 in the same hop (the rule misses BinOp
>   receivers + sync helpers). OUT of scope: `reconcile()` :121 `.exists()` + `_mtime_iso` stat
>   (cold-path, unflagged → the ACA deep pass; full blind-spot record = SYSTEM_AUDIT SYS-16
>   addendum). Tests: `test_memory_git_backup_d26.py` already pins every touched branch (init /
>   ready / secrets-abort / per-write commits) — no new test needed.
>   **③** `dns_trace.py:29` — `fam` → `_fam` (B007; the fn is sync + already to_thread'd).
> - **④ the hero "LEARN MORE" pill paint-out** — recipe (pinned; a verified candidate
>   `hero_candidate_final.png` 560,472 B exists in the 2026-07-16 session scratchpad, seam
>   Fable-eyeballed clean; scratchpads are ephemeral — reproduce from this recipe if gone): start
>   from the ORIGINAL blob `git show 3576315:frontend/src/themes/frontier/art/hero.png` (NOT the
>   already-quantized repo file); erase box **x∈[56,460] y∈[0,82]** (measured pill [64,452]×[5,72]
>   + AA margin; no drop shadow; the cloud streak is OUTSIDE the box, below-right); fill = per-row
>   linear interpolation between flank means x∈[46,54] / x∈[462,470], then GaussianBlur r=2.0
>   confined to box+4px; recompress = system-python3 Pillow `quantize(256, LIBIMAGEQUANT,
>   FLOYDSTEINBERG)` → pyoxipng level 6 (⚠ imports as `oxipng`; Pillow and pyoxipng live in
>   SEPARATE interpreters — system python3 vs the scratch venv). Same filename, zero code changes.
> - **Verify:** backend ruff clean → targeted pytest (`test_memory_git_backup_d26.py`,
>   `test_tools_8.py`, `test_retry_safety_i4.py`) → full `tools/check.py --e2e` GREEN → owner
>   eyeballs the frontier Fleet card (dev units) → push (needs the owner's explicit OK) → runbook
>   §Release.
>
> **▶ NEXT — pick with the owner (full open-work inventory swept 2026-07-15, two-agent doc+code sweep;
> stale T2/T3/T5 rows in TODO Phase 11 fixed same day; Phase-11/asset rows re-swept 2026-07-16):**
> 1. **ACA Slices 1–2** (`AGENT_CHAT_AUDIT.md` §5 / TODO Phase 12) — the headline next work: Slice 1 =
>    hang-proofing batch (MCP deadlines · timeout guards · de-hardcoded tunables · confirm-token hygiene;
>    ACA-3/6/7/8/9/12/13/18/20/21), Slice 2 = turn integrity (turn marker + 409s · quiet-boundary
>    rediscovery · shielded-finally persistence · frontend /clear+plan guards; ACA-1/2/10/16/17/19).
>    Riders first: **SYS-16 ruff ASYNC+B ratchet** precedes the ACA build waves; **SYS-1
>    `Database.transaction()`** rides Slice 2; MCP/OpenAPI adapter tests ride Slice 1.
> 2. **Phase-11 tail** (population closed; catalog complete): the **vapor-assimilation ladder V1–V5**
>    (§14.15.3, unscheduled) · Composer-Surface Phase D = vapor bullet only (→ ladder V4). *(CLOSED
>    2026-07-16: Bucket-A was found ALREADY SHIPPED 2026-06-27 — A.1–A.3, overlays/primitives/Conf
>    shell/deep editors/Agent chat; the 2026-07-15 sweep propagated a stale TODO row into this banner.
>    Its surviving carry-forward, the **SettingRow consistency sweep**, SHIPPED 2026-07-16 `0d32e35`
>    (28 rows — ConfTab groups 01–08 + the Agents/Memory/Skills editors; DOM-identical). The parked
>    **asset pass** SHIPPED `6e7a29a` (hero.png 1.9MB→551KB, palette-256+oxipng, quality-eyeballed);
>    the **art-override UI** was DROPPED (owner 2026-07-16 — the backend `host.appearance.frontier.image`
>    field suffices). Rider find: the e2e CONTRAST GATE had gone blind on frontier since K2 — probing
>    `color: var(--accent-fill)` devolves for an <image>; fixed `9dfe07e` to gate every gradient stop
>    per §14.15.1-⑨ (tokens were always compliant; caught because push CI skips e2e — only the tag
>    release gate runs it).)*
> 3. **Near-term flagged in ROADMAP:** **D3 Slice 1** (multi-homed addressing backend — blocks shutting
>    down Windows hosts from emma) · 6c-1 whisper-model warm (STT cold-start) · 6c-2 QR-to-phone (needs
>    owner OK on `segno`).
> 4. **Standing backlog (details in each doc):** ROADMAP A3 automations · A4 slash-registry+typeahead ·
>    A5 plan salience · A7 tools menu · A8 attachments · A9 model indicator (pairs w/ ACA wire work) ·
>    B1 vector memory (+D14/D27-B/C state+reflection) · C1/D19 voice streaming · C2 wake word · C3
>    chunked TTS · D2 wake-on-connection · E0 utils tools · E1 bots · E2 OpenAI facade · F1
>    notifications · F2 connection dot · G security hardening · THEME_ENGINE §14.15.4 backlog (kit.css
>    off eager path · overlay App-hoist) · UI_AUDIT F9/F13 (React Compiler prep; eslint warns
>    reconciled 2026-07-16 = 29 warns / 0 errors = 12 set-state-in-effect / 8 refs / 7 only-export-components
>    / 2 exhaustive-deps per QUALITY.md; F9/F13 stay deferred-until-measured) · SYS-2..17 opportunistic seams · housekeeping
>    (dependabot/archive-prune · dev-over-HTTPS for mic).
> **Methodology + session-start model check: memory [[orchestrate-with-opus-subagents]]** (Fable 5 HIGH
> orchestrates + hand-reviews; Opus 4.8 high subagents; VERIFY /model = fable-5 + high effort first).
> *(▲ MODEL LAYER SUPERSEDED 2026-07-24: main = Opus 5 HIGH, subagents = Opus 5 high, Fable 5 = an
> on-request second opinion. The methodology itself — pinned briefs, per-item review, Codex
> `gpt-5.6-sol` co-review — is unchanged.)*
>
> **▶ NEXT (the standing post-deploy order — pick with the owner):**
> 1. **~~Theme-engine Hardening slice v2~~ ✅ SHIPPED 2026-07-10** (all 10 items + riders a/b/c; as-built
>    record `THEME_ENGINE.md §14.15.1-A`; commits `bdaf511…9e21cdc`; release gate incl. e2e 7/7 green;
>    orchestrated multi-agent build, every item owner-ratified + diff-reviewed). The themeable-UI wave is
>    now UNBLOCKED.
> 2. Now the owner's menu: **frontier theme T5** (`FRONTIER_PLAN.md`, design LOCKED 2026-07-07) ·
>    **Composer Surface** (`COMPOSER_SURFACE_PLAN.md`, parked-not-superseded) · **ACA Slices 1–2**
>    (`AGENT_CHAT_AUDIT.md` / TODO Phase 12).
> 3. Housekeeping candidates *(Phase 10 cutover CLOSED 2026-07-10 — owner ruling, old Flask server retired)*: dependabot/archive-prune
>    (deferred until the tree settles) · dev-over-HTTPS if mic-in-dev is wanted (`tailscale serve --bg
>    --https=8443 5173`).
>
> **The dev→prod flow is now the standing procedure** (`deploy/linux/README.md` §Release/§Hotfix/§Rollback):
> develop in the workspace on `main` (hooks gate commit/push; CI on every push) → soak on the dev instance →
> tag `vX.Y.Z` on the soaked sha → push the tag (CI **release gate**: full + e2e) → re-pin prod:
> `cd ~/apps/ctrl-b && git fetch --tags && git checkout vX.Y.Z && bash deploy/linux/install.sh prod`
> (DB snapshot + aside-built dist + sub-second swap). Hotfix = throwaway worktree at the tag
> (`tools/add-dev-worktree.sh`), land-back on main NON-OPTIONAL. Rollback = previous tag; v1.0.0 itself
> has none → disable the service or fix forward.
>
> *(The block below is the pre-deploy handoff this banner supersedes — kept as the as-planned record.)*

> ## 🗄️ SUPERSEDED 2026-07-10 (executed) — the emma (Linux) deploy handoff
> **✅ The repo "face-wash" reorg is DONE (2026-06-30)** — the v2 app IS the repo root now (= **ctrl-b v1.0**):
> `backend/ frontend/ docs/ deploy/ agents/ skills/ config.yaml` at root; legacy in `archive/{v0.1-flask,
> v0.1-inference,ui-prototypes}/`; prototypes consolidated in `design/prototypes/` (the 112 KB `vapor.html` is the
> canonical D7 spec); dev launchers in `tools/`; `deploy/` generalized (`bootstrap.py` + `linux/` + `windows/`).
> All paths swept, the 2 code spots verified, README/AGENTS/CLAUDE rewritten, venv rebuilt. Spec/record:
> [`REORG_PLAN.md`](./REORG_PLAN.md). Git history was **NOT** rewritten (filter-repo deferred — the 142 MB mp4 was
> never committed; `.git` is 44 MB), so existing clones just `git pull`.
>
> **✅ PRE-DEPLOY HARDENING + POST-AUDIT FIXES ARE COMPLETE (2026-07-02 @ `43919f1`; main has since
> advanced to `a9a91d5` with the D34 theme-review docs, 2026-07-06).**
> The app is feature-complete (Phases 0–8) and now independently audited. Shipped since the last handoff:
> - **`PRE_DEPLOY.md` steps 1–5 ✅** — quality harness (D33: `python tools/check.py`) · `SECURITY_MODEL.md` ·
>   secret-hygiene tests · robustness P1s (SSE payload guards · stale-confirm-token recovery · risk-aware retry) ·
>   **Phase-9 Playwright smoke + axe-a11y suite** wired as an opt-in **pre-deploy gate** (`python tools/check.py
>   --e2e` — step-0 in `DEPLOY_EMMA.md` + a `.claude/settings.json` deploy-checklist hook).
> - **A 4-agent adversarial audit of the whole session → 9 findings fixed** (bypassed a11y toggles → shared `Switch`;
>   `resume(execute)` re-mint guard vs a 500/stuck bubble; a single-flight guard vs concurrent double-execute of a
>   non-idempotent action; chat frame guards; vapor `.tcat` 390px overflow; hook grep; doc reconciliation).
> - **Python 3.14 declared the canonical floor** (owner decision — `requires-python>=3.14` now consistent with ruff
>   `target-version=py314`; the code uses PEP 758 syntax). **Integration `risk` typed as `Risk` at the Pydantic
>   boundary** (eliminated the `_RISK` triplication; fail-fast on a bad config value; verified live against the real
>   `config.yaml`). Full context: memory [[predeploy-hardening-progress]] + `git log`.
>
> **📋 2026-07-07 — the system was independently specified + audited, and the owner REVIEWED + APPROVED
> the results the same day:** [`SPEC.md`](./SPEC.md) (the visual one-stop system spec; pillars P1–P10) ·
> [`SYSTEM_AUDIT.md`](./SYSTEM_AUDIT.md) (architecture audit, SYS-# — **one live bug: SYS-13**, `fillComposer`
> vs the F28 controlled composers, breaks confirm-bubble *edit* + code-block *send-to-composer* on all themes;
> **SYS-13 fix + SYS-14 Linux CI are now Phase-9 pre-deploy items**) · [`AGENT_CHAT_AUDIT.md`](./AGENT_CHAT_AUDIT.md)
> (chat audit + 8-agent comparative analysis + the **ACA plan — APPROVED, now TODO Phase 12**; Slice 0
> doc-truth pre-landed `ee23209`; D35–D37 get drafted at each slice's design review; Slices 1–2 are
> pre-deploy candidates, Slice 3+ post-deploy). A doc-consistency pass landed the same day (all claims
> verified vs code, `9c2d2a6`): stale counts/statuses fixed, DESIGN §9/§12/§16 + the ARCHITECTURE endpoint
> note corrected to code truth, status banners added. Note: **pytest is 254 now** (older "229"/"250" mentions
> below are historical).
>
> **▶ FINAL TOUCHES before the deploy (a fresh session) — highest value first:**
> 0. ✅ **The quality-harness audit is DONE (2026-07-07) — VERDICT: GO** ([`QH_AUDIT.md`](./QH_AUDIT.md)
>    §R). Gate run as-deployed: `--fast` 1.9s · full+`--e2e` **7/7 green, 1m12s** (the step-0
>    rehearsal) · CI green · hooks verified. 9 findings fixed in 7 commits (top: QH-1 — install.sh
>    enabled the hook gate without installing the `[dev]` toolchain, so emma dev-tree commits would
>    have died; QH-2 — the `npx playwright install` deploy-gate prereq was documented nowhere) + 4
>    new drift-guards (pytest 250→**254**). The two owner decisions were ruled + landed same day:
>    **QH-10** conftest auto-isolation fixture (pytest-only) · **QH-11** `target_port` default →
>    **5433** (override via config.yaml or `CTRLB_TAILSCALE__TARGET_PORT` in `.env`). **Nothing
>    blocks the deploy.**
> 1. **The deploy pre-flight IS the real gate.** Run `python tools/check.py --e2e` (must be GREEN), then verify the
>    owner-managed **`config.yaml`** against the `SECURITY_MODEL.md` safe-defaults checklist (bind `127.0.0.1`, debug
>    off, Tailscale-Serve-HTTPS the only ingress, `shell.*_exec` toggles as intended, no secrets tracked) + run
>    `bootstrap.py --dry-run`. The *code* defaults are already safe; it's the live config to confirm.
> 2. **Optional de-risk build:** `vpn_host` / tailnet (MagicDNS) addressing (ROADMAP **D3**) so deploy + monitoring
>    survive a LAN drift — the one worthwhile *build* to harden the Tailscale-first deploy. Or defer post-deploy.
> 3. **Optional polish (deferrable, NOT deploy-blocking):** `Switch`→native `<button role="switch">` (`UI_AUDIT.md`
>    §6b) · chat handler DEV-warn · PWA manifest/precache tuning.
> - **Theme engine (hardening + Composer Surface) is SAFE TO DEFER post-deploy** — the architecture + the D31/§14.14
>   extension contract + the data seams are already built/locked, so delaying adds **no structural refactor**. Only
>   rule: land the warn-first hardening slice BEFORE the *next themeable-UI feature wave*, not before the deploy.
>
> **▶ THEN the emma deploy — ✅ PRE-FLIGHTED under the D32 AMENDMENT (2026-07-09), ready to execute (not yet
> run). Start at the PRE-FLIGHT block atop [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md).** The topology was amended
> 2026-07-09 (owner-approved, 3-agent research pass) **before first deploy**: **trunk-based — `main` + immutable
> release tags, NO `dev` branch** ("dev" names only the instance); **prod runtime = `~/apps/ctrl-b`** (fresh
> sparse tag-pinned clone), **workspace = `~/github/ctrl-b`** (emma's existing checkout, never leaves `main`;
> other checkouts = throwaway worktrees); **`migrate-layout.sh` deleted — nothing on emma moves**. Also landed
> with the amendment: `install.sh` pre-cutover **DB snapshot** (WAL-safe `.backup` + keep-N) + aside-built dist
> swap; `bootstrap.py` **config-clobber guard** (target's config canonical after first deploy) + `--overwrite-config`;
> **CI on all branches + `v*` tags** (tag run = release gate incl. Playwright e2e); the **expand/contract**
> DB/config compat policy (deprecate in vX, drop in vX+1); hotfix-via-worktree procedure. Full detail: DECISIONS
> **D32 (amendment)** + `deploy/linux/README.md`.
> Sequence: `--e2e` gate green + security checklist → **tag `v1.0.0` first** (CI release gate) → `bootstrap.py
> --dry-run` → `bootstrap.py --with-dev --claude-env` → verify `https://emma.lobster-vector.ts.net` + the agent.
> **Addendum (same day): the dev FRAMEWORK migrates too** — `ctrl-b-agent.service` (always-on tmux Claude
> agent, boots with the box; model fable/opus via `~/.config/ctrl-b/agent.env`) ships with `install.sh dev`,
> and `bootstrap.py --claude-env` migrates memory + settings (`--start-agent` retired). PREP: owner deletes
> the emma scratchpad checkout + the hand-copied memory dir (ruled disposable 2026-07-09; workspace arrives
> as a fresh clone) · emma reachable (Bash needs `dangerouslyDisableSandbox`) · config.yaml current here
> (first-deploy SFTP) · DB fresh start on emma (DECIDED) · the `fable` tmux session = unrelated Hermes work, stays.
>
> **Working agreements (owner):** explain the issue + get a go-ahead BEFORE building each phase; research the
> conventional pattern + double-check every assumption; commit autonomously when the change is clearly stated but
> **CONFIRM before pushing**; pause for review between slices; audit each part before the next. Dev servers may be
> left running for eyeballing (backend `:5433` · frontend `:5173`).
>
> *(Everything below this block is older per-phase history — context, not the active task.)*

**Purpose:** **Phases 0–3, 4a (text round-trip), 4b (agent tools + confirm bubbles), 4c (composer
prefix routing + markdown), 4d (`task_plan` + plan panel), and now 4e (context compaction) are
done** — the Vapor Fleet tab drives real fleet/action/service typed-actions, and the **Agent tab is
a live tool-using chat**: the model sees the action registry as OpenAI `tools`, the loop runs ALLOW
calls through the existing `ActionService` and **suspends on a confirm-gated call** (med/high risk)
rendering a Vapor `.b.cmd` **command bubble** with execute/dismiss — resume re-opens the stream and
continues. **4c** added the shared composer's **prefix routing** (`!`→guarded shell [Phase-5 stub] ·
`/`→slash incl. `/local`//`/cloud` · else→agent), per-message inference-mode switching, and
**markdown bot replies** (hand-rolled, dep-free) with copy + send-to-composer on code blocks. **4d**
added the agent-only **`task_plan`** builtin + a live **plan panel** (TodoWrite-style checklist).
**4e** added **context compaction**: before each model call the loop folds the oldest complete turns
into a summary system message when the working context exceeds a configurable token threshold (or on
manual `/compact`), keeping full history in SQLite — with a **separately selectable summarizer
model**. **Phase 4f is essentially complete** — the agent gained: (1) SearXNG **`web_search`**
(collapsible result links), (2) an **MCP client** (Streamable HTTP, annotation-aware risk) merging
emma's `web-tools` (5 crawl4ai/SearXNG tools), (3) curated **open-terminal** shell/file tools
(configurable per-op risk), (4) a **generic OpenAPI tool provider** (for Open WebUI tool servers /
any OpenAPI service), and (5) an **embeddings client** (OpenRouter `qwen/qwen3-embedding-4b`,
verified live). All flow through the one registry → `ActionService` → gate → `.b.cmd` bubble. The
MCP supports **both transports** (Streamable HTTP + stdio, both live-verified). **Phase 4.5 (skills +
agents/subagents, D10/D11) backend is now DONE** — the loop is driven by a configurable `AgentDef`
(`agents[]`), file-discovered **skills** (`skills/<name>/SKILL.md`) inject instructions + narrow the
toolset (model-invoked by description · user-invoked via `/skill-name`), and **`spawn_subagents`**
delegates a batch of tasks to child agents run in bounded parallel (headless, depth-capped,
privilege-clamped). **Since then (see the 2026-05-28 session block below):** cloud chat is wired
(`inference.cloud` → OpenRouter Gemma 4 free, `default_mode` stays `local`); an **agent capability
layer** (loop-discipline guards + tool-selection routing) was added; a **`fleet` intent-skill**
auto-narrows the toolset so the weak local model behaves (the big finding — `minig+` isn't too weak,
the 21-tool namespaced set confused it); a **`check_service`** liveness tool + a **`reboot_host`**
action (with a device-row button); **clickable plan-step dots** (persistent, agent-aware); and an
**OS-compatibility pass** (ping/commands detect the host OS). **Phase 7 is sliced 7a–7e; 7a (settings
foundation + Inference/Server groups) and 7b (hosts + services CRUD machine editor) are built +
verified — see the two 2026-05-29 blocks below.** **7c (integrations: SearXNG/embeddings/open-terminal
hot-apply + MCP/OpenAPI managers with between-turn rediscovery) is built + verified. 7d (skills/agents
management UI + per-tool description overrides) is built + verified + committed (see the 7d block
below). **7e (prompts editors + memory panel) is complete too** — 7e-a…7e-g all shipped (see TODO Phase 7e). **The UI perf pass tracked in [`UI_AUDIT.md`](./UI_AUDIT.md) is now complete — Slices 1–8 shipped (10 of 13 findings landed; F9 `useTransition` and F13 React Compiler deferred until measured pressure warrants).**
This doc is the orientation; canonical detail is in the other `docs/` files. **The pixel-exact Vapor
fidelity mandate (D7) still governs every new component.**

> ## ⭐ The standing Vapor-fidelity mandate (D7) — applies to every phase
> The owner's priority is a **faithful, pixel-exact execution of `vapor.html`** — not "inspired by."
> Before writing any component:
> 1. **Open `../design/prototypes/variations/vapor.html` in a browser at ~390px** and study the real
>    thing — the hero (sun bob + retrowave stripes, twinkling stars, moving neon grid, city/mountains
>    skyline SVG, live waveform canvas), the appbar (logo lozenge + auto-TTS toggle), device rows with
>    the expandable dropdown (services + kv detail + wake/stop mask-icon buttons), the fleet summary,
>    and the bottom tab bar with its sliding indicator.
> 2. **The CSS is already lifted verbatim** into `frontend/src/theme/vapor.css` (the 1064-line
>    `<style>` block — `:root`/`[data-theme]` variables + all component CSS). **Reuse those exact
>    class names and variables; do not re-derive colors/spacing/animations.** Componentize the
>    *markup* into React, keep the *styles* as-is.
> 3. **Read `vapor.html`'s markup + JS** (the part after `</style>`, ~line 1077+) to copy the exact
>    DOM structure and the animation logic (waveform canvas draw loop, tab indicator slide, hero
>    toggles) — port it, don't reinvent it.
> 4. **Verify side-by-side** against `vapor.html` at phone width before calling any piece done.
>    "Visually indistinguishable" is the acceptance test.
> 5. **Read [`VAPOR_PATTERNS.md`](./VAPOR_PATTERNS.md) before styling anything** — the distilled
>    design language (tokens, button taxonomy, the per-theme danger-color philosophy, and the
>    per-component decisions from the `design/prototypes/vapor-chats/`). It exists so net-new components
>    (which have no `vapor.html` markup to copy) stay consistent by construction.

## Read order (5 min)

1. `DECISIONS.md` — every locked choice + reasoning, the open items, and the future-additions list.
2. `ARCHITECTURE.md` — backend/frontend/data-model/action-registry/agent/voice/deploy design.
3. `DESIGN.md` — **concrete code design**: data structures, the unified capability/registry model,
   the agent loop state machine, concurrency (incl. concurrent subagents), persistence, the SSE
   wire protocol, end-to-end flows, edge cases, and the extension cookbook. Build against this.
4. `TODO.md` — the phased build plan. **Begin at Phase 0.**
5. `RESEARCH.md` — library/version pins + sources (incl. the secure-context/mic analysis).
6. `ROADMAP.md` — post-v1 features + the v1 seams to build now so they slot in.
7. `SPEC.md` — the visual one-stop system spec (C4 diagrams, flows, inventories). The audit
   ledgers: `UI_AUDIT.md` (F#) · `SYSTEM_AUDIT.md` (SYS-#) · `AGENT_CHAT_AUDIT.md` (ACA-# + the
   plan, owner-approved 2026-07-07 = TODO Phase 12).

The **visual source of truth** is `../design/prototypes/variations/vapor.html` (mobile-first
vaporwave SPA: 4 tabs Fleet/Agent/Utils/Conf, per-host services, themes, composer w/ mic +
auto-TTS, command bubbles). Port it; copy assets (logo/favicon), don't import.

## Current state (**Theme-engine v2 (D29): BUCKET-A COMPLETE — `minimal` is a full reskin: chrome + Fleet (A.1) · ALL Conf editors + Utils tab (A.2) · the entire Agent chat (A.3), all token-driven under `.kit`. Every shared surface now renders under any reskin theme.** · **cosmos (T4, the bespoke orbital theme) is COMPLETE — C1–C3 shipped + pushed: starfield · orbital fleet (orbit/camera/liveness/service-cue) · the host-detail bottom sheet (reusable `BottomSheet` primitive + `CosmosHostDetail` + sheet-aware camera-lift + multi-snap + Audiowide + slide/fade). See [`COSMOS_HANDOFF.md`](./COSMOS_HANDOFF.md). The app-like text-selection / tap-highlight model shipped alongside (all themes).** · Since then, **minimal-nav chrome mode** shipped (`ui.appbarMode` visible/off/minimal + a floating `NavMenu`; Kit-wide), then **Slice 2a + the D30 composer-composition refactor**. Most recently (2026-06-29) the **bottom-sheet detent memory** (ISSUES #1) + cosmos host-detail polish shipped (`c098739`/`bc17d99`), and a full **theme-engine design-system architecture pass** was researched + LOCKED: **Swappable Surfaces** (DECISIONS **D31** + THEME_ENGINE **§14.14**) — the routing rule for every future themeable element. **▶ ACTIVE PRIORITY = emma (Linux) DEPLOY — see [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md) (start there).** The theme engine is **⏸ PARKED** (the Composer Surface + audit hardening are fully specified + ready to resume: [`COMPOSER_SURFACE_PLAN.md`](./COMPOSER_SURFACE_PLAN.md), architecture D31/§14.14, audit backlog [`external_audit/TRIAGE.md`](./external_audit/TRIAGE.md)). See the priority block in the newest session update below)

> ### 🧭 SESSION UPDATE — PRIORITY PIVOT: theme engine PARKED · REPO REORG (v1.0 face-wash) then emma DEPLOY — 2026-06-29 (cont.)
>
> **Read this priority list first — it supersedes the per-feature "NEXT" notes scattered in older blocks below.**
> **Note:** "v2"/"dashboard_v2" throughout these docs is the **development name** for what ships as **ctrl-b v1.0**.
>
> 0. **▶▶ ACTIVE / DO FIRST — Repo "face wash" to ship v1.0. FULL SPEC: [`REORG_PLAN.md`](./REORG_PLAN.md).**
>    Restructure the whole repo so the v2 app **is** the root (= official **v1.0**) and all legacy is archived:
>    `dashboard_v2/{backend,frontend,docs,deploy}` → repo root; `ctrl-b (Vapor)/`+`prototypes/` → `design/` (de-duped);
>    `wol_server/`+root v0.1 scripts+gitignored v1 secrets → `archive/v0.1-flask/`; `inference_server/` → `archive/v0.1-inference/`;
>    `ws_*` → `archive/ui-prototypes/`; `start_claude_remote.*` → `tools/`; drop the 142 MB `demo.mp4`; **generalize
>    `deploy/`** (→ `deploy/linux` + `deploy/windows` double-click launchers + manual `run.sh`). One atomic, verified
>    commit (pytest 229 + dry-run + build + zero stale `dashboard_v2/`/`ctrl-b (Vapor)/` refs). **OPEN: git-history choice
>    (clean tree only / filter-repo purge / squash) — REORG_PLAN §1.** Do this BEFORE deploy so paths are written once.
>
> 1. **▶ THEN — Deploy to emma (Ubuntu 26.04 LAN/tailnet server). TOPOLOGY LOCKED (D32) · ARTIFACTS READY (paths get updated by the reorg).**
>    *(⚠️ 2026-07-09: the branch model + paths in this historical item are SUPERSEDED by the D32 amendment — trunk-based `main`+tags, prod `~/apps/ctrl-b`, workspace `~/github/ctrl-b`, `migrate-layout.sh` deleted. Current sequence: the PRE-FLIGHT block atop DEPLOY_EMMA.md.)*
>    **Topology = DECISIONS.md [D32](./DECISIONS.md): TWO fully isolated instances, one repo.** PROD `~/github/ctrl-b`
>    (clean **sparse**, **tag-pinned** clone) → `~/.ctrl-b` → uvicorn **:5433** + **Tailscale Serve HTTPS**; DEV
>    `~/github/ctrl-b-dev` (`dev` branch — the dev side, ALL dev work, 1+ agents) → `~/.ctrl-b-dev` → uvicorn **:5434 --reload** +
>    **Vite :5173**. Separate data roots → dev experiments never touch the daily driver. Branches `main`(prod)/`dev`(WIP)
>    + release **tags**; promote = merge dev→main, tag, push, prod `checkout vX.Y`. Artifacts + runbook under
>    **[`../deploy/linux/`](../deploy/linux/)** (`install.sh [prod|dev]`, 3 systemd units, `bootstrap.py`, `serve-https.sh`,
>    `start-claude.sh`, **`migrate-layout.sh`**); rationale in **[`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md)**.
>    **Execute:** (1) ONE-TIME, agent-coordinated **`migrate-layout.sh`** on emma (stop the agent → converts the legacy
>    single checkout into the two trees); (2) `backend/.venv/Scripts/python.exe deploy/bootstrap.py` (SFTP secret →
>    ensure prod tree → `install.sh prod` → Serve; `--with-dev`, `--start-agent`). Subsumes TODO **Phase 9**.
>    Data-path audit (2026-06-29) confirmed every workspace path resolves under `CTRLB_HOME`; fixed `skills_dir_path()`
>    (was `config_path().parent` → now `home_dir()`, matching memories/agents) — 229/229 green.
> 2. **✅ DONE — backend test harness fixed + Python 3.14 readiness VERIFIED (2026-06-29).** The broken harness (audit
>    #2 R1: `76 failed / 153 passed` from `get_event_loop().run_until_complete()` in 13 files) is fixed via a shared
>    3.14-safe runner (`tests/_async.py` `run_async`) → **229 passed, 0 failed** on Python 3.11 **and** on emma's
>    **native 3.14.4** (validated in a throwaway 3.14 venv on emma). Empirically confirmed the **entire pinned stack
>    ships cp314 wheels** (pydantic-core 2.46.4 / uvloop 0.22.1 / cryptography 49 / fastapi / uvicorn / mcp); the only
>    change was **`pydantic-settings 2.14.1 → 2.14.2`** (= the Dependabot fix too). **The deploy now targets native
>    3.14** (`deploy/linux/install.sh` builds the venv with `python3`, rebuilds a mismatched venv). Commits
>    `…f0296d1`. **Then a full backend MODERNIZATION pass (commit `cd85a14`, audit
>    [`external_audit/MODERNIZATION_2026-06-29.md`](./external_audit/MODERNIZATION_2026-06-29.md)):** code was already
>    modern (Pydantic v2 / lifespan / modern typing+datetime / asyncio TaskGroup); fixed 4 dead imports, migrated the
>    **MCP `streamable_http_client`** deprecation (warning gone), bumped deps (fastapi 0.138.1 / openai 2.44 / mcp 1.28.1
>    `<2` cap / sse-starlette 3.4.5 / ruamel 0.18.17), and added **ruff** (clean). 229/229 still green on 3.11 + emma 3.14.
>    Only remaining warning is test-only (`starlette.testclient`→`httpx2`). Detail: [`external_audit/TRIAGE-2.md`](./external_audit/TRIAGE-2.md) R1.
> 3. **⏸ PARKED — Theme engine. When it un-parks, build the FINAL-REVIEW plan (2026-07-06, D34 — supersedes the
>    TRIAGE-3 slice ordering):** **(a) the Hardening slice v2 FIRST**, then **(b) the Composer Surface.** The
>    plan of record is **[`THEME_ENGINE.md`](./THEME_ENGINE.md) §14.15** — a 29-agent adversarial review
>    re-confirmed every architectural layer (nothing relitigated) and reshaped the slice to **10 items + 2
>    riders** (§14.15.1): ① `--accent-ink` contrast token (the one product bug — minimal light mode ships
>    3.2:1) · ② theme-fault boundary w/ Reload + **Reset-as-pick (write-through PUT)** · ③ `ensureThemeLoaded`
>    rejection eviction · ④ ThemeProvider cold-load catch→toast · ⑤ in-flight guard **inside `switchTheme`**
>    (replaces the T1 `useIsMutating` gate) · ⑥ registered-ID coercion (two doors, never auto-PUT) ·
>    ⑦ `resolveThemeSetting` (B4) · ⑧ `themeContract.test.ts` (B2: tokens + behavior + structural hooks +
>    Fleet-a11y + contrast group; vapor exemptions = ONE waiver constant) · ⑨ stylelint micro-slice ·
>    ⑩ **kit-render e2e smoke** (no test in ANY layer mounts DefaultRoot/kit.css today) — riders: persisted
>    `v` stamp + order-insensitive themeSettings compare. Then **(b)**
>    [`COMPOSER_SURFACE_PLAN.md`](./COMPOSER_SURFACE_PLAN.md) (A1→A2→A3; its §2.0 validation = slice item ⑦).
>    Historical routing: [`external_audit/TRIAGE-3.md`](./external_audit/TRIAGE-3.md) + TRIAGE/TRIAGE-2 🟡;
>    locked architecture **D31 / §14.14**; **vapor assimilation ladder** (owner 2026-07-06) in **§14.15.3**.
> 4. **📋 The external audits (HIGH visibility).** TWO independent audits, both routed: [`external_audit/TRIAGE.md`](./external_audit/TRIAGE.md)
>    (audit #1) + [`external_audit/TRIAGE-2.md`](./external_audit/TRIAGE-2.md) (audit #2 — theme engine + maintainability;
>    strongly corroborates #1). Their **SECURITY subset is pulled FORWARD into the deploy** (priority 1):
>    `SECURITY_MODEL.md`, debug-off, shell-off-by-default, secrets-masked, stale-confirm-token recovery, OpenAPI tool
>    hardening — these matter the moment the dashboard is reachable over Tailscale. Review DURING the deploy.
> 5. **🔧 Deferred small items** — [`ISSUES.md`](./ISSUES.md) (owner's-call polish).
> 6. **Later** — cutover (Phase 10) + the parked theme-engine hardening (TRIAGE 🟡) + the audit-#2 product-edge backlog
>    (IME guard, BottomSheet focus, API-DTO contract, SSE-disconnect test, dedicated `PUT /api/appearance`; TRIAGE-2 🔵).
>
> **Key researched constraint:** Claude Code `--remote-control` **requires a TTY** → it can NOT be a bare systemd/daemon
> process; the reliable headless pattern is **tmux** (the dashboard's uvicorn IS a clean systemd daemon). Details +
> sources in DEPLOY_EMMA.md. The Windows `--reload` gotcha does NOT apply on emma's Linux.
>
> **⚠️ emma operational cautions (carry into every emma session):** the dashboard can **shut down / reboot fleet
> hosts** — do NOT shut down PCs while testing; do NOT modify emma's system / MCP config beyond what's strictly needed;
> a **SECOND agent works in tandem** on emma (its own checkout ~`~/git*/ctrl-b` — treat as read-only; never commit
> there). Cross-agent coordination via files (e.g. the `external_audit/` folder). config.yaml/secrets are gitignored —
> they must reach emma out-of-band (not via git).
>
> ### 🧭 SESSION UPDATE — Theme-engine FINAL REVIEW (29-agent adversarial audit → D34; docs only) — 2026-07-06
>
> Owner-commissioned final validation of **every theme-engine decision** before the engine un-parks: 6
> parallel deep-dive clusters (CSS isolation · token contract · state/sync · component architecture · vapor
> drift · perf budget), each mixing web best-practices research with code audit; every risk/change finding
> independently **attack-verified** by an adversarial second agent; the main session as **final judge**
> (cross-checked agents against each other, the code, and the locked D-entries — several agent
> recommendations were overridden on verification, e.g. the overlay App-hoist's missed `.kit`-scoping
> precondition and the reconcile-loop hole in a local-only theme reset). **Verdict: every layer confirmed;
> no decision relitigated.** Outcomes (all → [`THEME_ENGINE.md`](./THEME_ENGINE.md) **§14.15** + DECISIONS
> **D34**): the **Hardening slice v2** (10 items + 2 riders — supersedes the TRIAGE-3 ordering; see item 3
> above), incl. the review's one **product bug** (`--accent-ink` missing → minimal light mode ships 3.2:1
> contrast) and one **coverage hole** (nothing ever mounts DefaultRoot/kit.css → new kit-render e2e smoke);
> new invariants (**server appearance doc = explicit-user-writes only** · browser floor FF146/Chrome118 ·
> the two-CSS-trees rule for shared markup · the grandfathered `isVapor` exception); the **vapor
> assimilation ladder** (owner directive: frozen = a phase — §14.15.3 + ROADMAP entry + D28 amendment); a
> vetted backlog + an explicit reviewed-and-REJECTED list (§14.15.4). Doc pass landed same-session: §10
> porting playbook rewritten as-built (was the superseded slot model), §13.6 superseded-banner, §14.11
> perf-sync correction (perf IS synced), §14.4.1 two-trees box, §14.14 a11y invariant. **No app code
> changed.**
>
> ### 🧭 SESSION UPDATE — Audit-#3 consolidation + multi-homed addressing design (docs only) — 2026-06-30
>
> Deep audit-consolidation + plan-revision pass. **No app code changed.** Next active task is unchanged, but
> **PRE-FLIGHT it first (owner directive 2026-06-30):** in a clean session, *review + validate* `REORG_PLAN` against
> the **current tree** before executing — re-verify the moves/dedup, the path-sweep targets, the 2 code spots
> (`config.py` `_PROJECT_ROOT`, `main.py` dist), the `config.yaml` collision + the filter-repo "this workspace is the
> rewrite source" caveat, and account for tree drift since the plan was written (this session committed 3 new files
> under `docs/external_audit/`; there's also an **unrelated unstaged `.claude/settings.json`** to resolve first).
> Surface anything stale/risky and **confirm before** the atomic commit + history purge. (Priority 0 in the block
> above; the approved *decisions* don't need re-litigating — this is execution validation, not a redesign.)
> - **Two new external audits triaged → [`external_audit/TRIAGE-3.md`](./external_audit/TRIAGE-3.md):** (1) a 3rd
>   theme-engine audit (verified at HEAD `8780e99`; strongly corroborates #1/#2 — "make the documented contracts
>   executable"); (2) the Corsair shutdown audit (separate, backend).
> - **Theme-engine un-park order LOCKED:** a standalone **Hardening slice** — `resolveThemeSetting` (B4) →
>   appearance-ID validation (R3) → transactional switch (R4) + the now-stale **T1** reconcile fix →
>   `themeContract.test.ts` (B2) → a **stylelint** warn-first micro-slice — ships **FIRST**, then the Composer
>   Surface. **stylelint** adopted as the CSS-contract layer; the **4-layer enforcement model + governance loop** is
>   documented in **§14.13.1**; fixed a doc bug (`inside` was never a vapor keyframe). **Owner: theme engine = right
>   after the deploy.**
> - **Corsair → multi-homed host addressing (ROADMAP D3): designed, DEFERRED to post-deploy.** Two address fields on
>   the unified Host — `ip` (LAN) + generic **`vpn_host`** — + per-host **`ssh_prefer_vpn`** toggle (default
>   **LAN>VPN**); one `host_addresses()` chokepoint; SSH failover (connection errors only); **vantage-aware** service
>   links (name-preferred). **Measured: Tailscale-direct ≈ LAN +1 ms** (same-LAN, not relayed). **Meanwhile, to
>   control the Windows hosts now (their LAN SSH is firewall-blocked): set each host's `ip` to its MagicDNS name**
>   (e.g. `corsair`/`g5`/`vault`) — ~0 latency cost. D3 slices 1+2 land post-deploy, with the theme hardening.
>   Hardcoding-checked: the only `tailscale` coupling is the legit Serve integration; the addressing path is generic.
>
> ### 🧭 SESSION UPDATE — Swappable Surfaces design system LOCKED + Composer Surface fully specified (planning + docs only) — 2026-06-29
>
> **No app code changed this session** beyond the already-pushed detent-memory + cosmos polish (`c098739`, `bc17d99`).
> This was a deep **architecture + documentation** pass to make the theme engine cleanly extensible before building.
> **Two parallel research streams** (existing-code map + web best-practices: Radix/React-Aria headless, W3C DTCG /
> Material 3 / Radix Themes tokens, MUI slots, VS Code/Backstage registries, Metz/Frost/Dodds on abstraction) backed
> every decision.
>
> **What got LOCKED + documented (read these before building):**
> - **DECISIONS D31 + THEME_ENGINE §14.14 — "Swappable Surfaces".** The standing routing rule for every future
>   themeable element: a **3-band spectrum** — **Tokens** (cosmetic reskin; covers chrome, **Tools tab**, **Conf/
>   settings** — confirmed in code: no per-theme Tools/Conf component) → **Surface** (a registry of variants over one
>   headless controller, ONLY when the **3-gate** passes: structural divergence + ≥2 real impls + a shared controller)
>   → **Bespoke** (one-off snowflake). **Today only Fleet + Composer are Surfaces.** Tools/Conf/AppBar = tokens
>   (matches VS Code/Primer/MUI/Backstage). Two variant-SELECTION mechanisms: **Root-pinned** (the `Fleet=` prop, one
>   per theme) vs **user-selectable** (registry + per-theme `seg` setting + resolver, e.g. composer). A surface
>   *graduates* pinned→selectable on the 2nd variant; the `createSurface` factory is **concrete-first** (extract on the
>   2nd user-selectable surface, not speculatively).
> - **[`COMPOSER_SURFACE_PLAN.md`](./COMPOSER_SURFACE_PLAN.md)** — the self-contained, edge-case-complete build spec
>   for the next feature (the Composer Surface). File-by-file (A1 mechanism → A2 `SheetComposer` → A3 wire themes),
>   15 enumerated edge cases (notably **#10** `--composer-h` re-measure on live swap, **#7** keep `.kit-composer`
>   class), characterization + theme-contract test strategy, and the **non-breaking guarantee** (vapor untouched;
>   cosmos orbit untouched; Fleet stays Root-pinned).
> - **An external static audit** (`external_audit/ctrl_b_dashboard_v2_systematic_audit.md`) was read + triaged in
>   **[`external_audit/TRIAGE.md`](./external_audit/TRIAGE.md)**. It **validates the architecture** (theme engine 8/10)
>   and our exact direction. Its theme-engine fixes that intersect the composer work are **folded into the plan**:
>   **B4** (validate per-theme settings → `resolveThemeSetting`; also self-enforces D31's capability list), **B2** (a
>   `themeContract.test.ts` — "best ROI in the theme engine"), **D1** (no theme-id branching — now an explicit §14.14
>   invariant), **H3** (composer slot semantics). The rest (D2 shared root hooks, E2 cosmos perf-lite/rAF pause, F2/F3
>   sanitization, plus out-of-scope backend/security) are the **next hardening pass**, routed in TRIAGE.md.
>
> **⛔ NEXT (clean session): execute `COMPOSER_SURFACE_PLAN.md`.** Build A1 (incl. the B4 `resolveThemeSetting` step +
> the B2 contract suite) → A2 → A3, pausing for the owner's 390px eyeball between slices. Confirm the design
> (D31/§14.14) still reads right, then build. Out of scope until later: Fleet→registry migration, the `createSurface`
> factory, vapor wiring (plan §6), and the theme-engine hardening backlog (TRIAGE.md 🟡).
>
> ### 🧭 SESSION UPDATE — moon-dive (Slice 2a) + D30 composer composition (plan pill → composer) — 2026-06-28 (cont.)
>
> **All committed on `main`; verified `typecheck` · `build` · 188 unit · 34 e2e green throughout.**
>
> **Moon-dive (Slice 2a).** Tapping the cosmos moon now DIVES the camera into it (reusing `useCameraFollow`/`followTarget` at the system centre, `DIVE_ZOOM`/`DIVE_MS`) while the orbital stage fades, then `navigate("agent")` via the `useSections` chokepoint — reduced-motion skips the dive. Files: `store/cosmosDive.ts`, `camera.ts` (`dive` opt), `CosmosFleet.tsx` (`.diving` stage class), `CosmosMoon.tsx`, `cosmos.css`. The moon no longer deselects (empty-tap does).
>
> **Glass/animation fixes (the road to D30).** The Agent tab's `kit-fade` was breaking the frosted plan badge (dark-snap) + dropdown glass — Chromium can't composite a `backdrop-filter` under an *animating* ancestor (opacity OR transform). Root-caused + the dropdown glass tuned to 82% (matches `.bs-sheet`).
>
> **D30 — composer composition (the big one).** The fix for the above was structural: move the frosted plan OUT of the kit Agent tab → into the COMPOSER, so the tab animates freely. Built as a reusable architecture (**DECISIONS D30**, **THEME_ENGINE §14.13 #12**): the composer is a base **variant** + **slot addons**, both theme-selected via `DefaultRoot` `Composer=`/`composerSlots=` props (mirrors `Fleet`). The **plan-pill addon** = `<PlanPill/>` (composer controls row) + a peek `<PlanSheet/>` (frosted panel rising from the composer's top edge, no drag) — self-subscribing, store-backed (`planSheet` + memo-stable `useCurrentPlan`), checklist shared via `components/PlanSteps`. Cosmos opts in; **vapor keeps its frozen in-tab plan** (gated `theme==="vapor"`); the **Agent `kit-fade` is re-enabled**. Cosmos auto-collapses the sheet when the host detail sheet opens. `SheetComposer` (vapor-peek style) is **stubbed** — the seam's proven, styling is future work.
>
> **Cosmos visual polish (follow-on).** (a) The `orbit` rune dropped its edge-dot → a plain ring (now identical to the `ring` rune — give it a distinct glyph if you want all-distinct). (b) **Service banners** now use the owner's `docs/screenshot/designs/asdff` artwork: 12 cropped WebP (`assets/cosmos/service-banners/`, Pillow-cropped by auto-detecting non-black regions), assigned per service by HASHING the stable service id + **de-duped within a host** (`serviceBanners.ts assignBanners`, linear-probe — fixed the corsair repeat), drawn as a `.hd-svc` background under a left→right readability scrim + a `--svc-veil` mute (42% online / 68% offline). Tunable in `cosmos.css .hd-svc`. Test: `tests/themes/serviceBanners.test.ts`.
>
> **⛔ NEXT.** *(⚠️ SUPERSEDED by the 2026-06-29 block above — `SheetComposer` is now built as a **user-selectable Composer Surface** per [`COMPOSER_SURFACE_PLAN.md`](./COMPOSER_SURFACE_PLAN.md) / D31, not a `Composer=` prop. The rest still stands.)* (1) **`SheetComposer` styling** — the vapor-peek composer variant (bottom-sheet look, NO drag), reusing `useComposer`. (2) **vapor-minimal wiring** (§14.13 #11 — VaporRoot maps `minimal`→`off` today). (3) **T2 phosphor** / the queued **emma deploy**. *Deferred + noted in ISSUES.md:* the plan-sheet + Android-keyboard scroll hardening (fix only if it recurs); whether the plan sheet should also collapse on a Fleet↔Agent tab switch (left sticky — owner's call).
>
> ### 🧭 SESSION UPDATE — MINIMAL-NAV chrome mode SHIPPED (core) · Slice 2 = the loose end — 2026-06-28
>
> **Kit-wide feature, grew out of cosmos but applies to every DefaultRoot theme.** Read this block before
> resuming; the canonical contract lands in `THEME_ENGINE §14.13` once Slice 2c ships.
>
> **✅ What shipped + committed on `main` (local; push pending owner OK):**
> - **`53c2c4f` minimal-nav core.** `ui.appbarMode` is a GLOBAL tri-state lever **`"visible" | "off" | "minimal"`**
>   (replaced the old `hideAppbar` bool). `minimal` = no appbar **and** no bottom tab bar — navigation moves to a
>   floating **orbit `NavMenu`** (top-right launcher → icon dropdown of the theme's sections). It's **per-device /
>   LOCAL** (NOT synced — unlike the rest of appearance). Key files: `components/NavMenu.tsx` (NEW; a pure
>   `useSections` consumer — the designed "render sections as a menu" seam, no nav-state fork; non-modal a11y:
>   Esc/outside-close/roving focus; press feedback gated `@media (hover: hover)` so touch `:active` can't stick),
>   `store/ui.ts` (`AppbarMode` type + `migrateAppbarMode(s, hasAppbarMode)` seed-from-legacy guard +
>   `stripLegacyAppbar`), `theme-engine/kit/DefaultRoot.tsx` (`visible`→appbar; `minimal`→`<NavMenu/>` replaces the
>   tab bar), `tabs/ConfTab.tsx` (3-way `Seg` On/Off/Min), `kit/kit.css` (`.navmenu-*`), `themes/cosmos/cosmos.css`
>   (silver launcher), `CosmosFleet.tsx` (re-measure the live zone on `appbarMode` change → lunar uses freed
>   height), Cosmos/Minimal/VaporRoot (read `appbarMode`, pass down), `hooks/useAppearance.ts` (reconcile strips a
>   stale synced `hideAppbar` so it can't re-dirty local). **vapor is a bespoke Root → it maps `minimal`→`off` for
>   now (deferred; see Slice 2c).**
> - **`d29e184` polish.** ISSUES **#1** — in minimal the floating NavMenu (z 30) buried the mini-player's ✕ (z 16);
>   fixed with `kit.css .kit:has(.navmenu) .mini-player { left/right anchor }` (the player makes room for the
>   launcher; `:has` keys off the rendered menu — no state mirror). ISSUES **#3** + floating player — rounded the
>   TTS play-triangle (fill + `stroke-linejoin:round`) and pause bars (`rx`) for `.tts-play` + `.mp-play`.
> - **ISSUES #2 (per-response model-source badge) — DEFERRED** (owner: not worth the full-stack cost now). Full
>   seam map preserved in [`ISSUES.md`](./ISSUES.md) for a cheap future pickup.
>
> **VERIFIED:** `npm run typecheck` clean · `npx vitest run` **188** green (migration-guard + reconcile-strip
> regressions) · `npm run build` green · live (toggle/persist across reload; minimal nav on cosmos; touch-stick
> fixed). Snapshot audit done (dead `data-appbar` removed; sync re-dirty fixed).
>
> **⛔ NEXT — Minimal-nav Slice 2 (small; the in-flight loose end — do this first). Three parts; the first two
> carry a genuine DESIGN FORK → CONFIRM with the owner BEFORE coding (don't guess):**
>
> **2a · cosmos moon → Agent.** Goal: tapping the central moon opens the Agent chat (a fast affordance in
> minimal, where there's no tab bar — Agent is *already* reachable via the NavMenu dropdown, so this is an
> EXTRA convenience, not the only path).
>   - **Seam:** `themes/cosmos/CosmosMoon.tsx:31` — the moon's `onClick` is currently `setCosmosSelection(null)`
>     ("clear selection / all systems"). Navigate via the chokepoint: `useSections().navigate("agent")` — **never**
>     `setUI({tab})` directly.
>   - **⚠️ FORK (confirm first):** the moon already has a job (deselect). Options — (i) moon→Agent **only when nothing
>     is selected** (deselect would be a no-op then); (ii) moon always deselects, a **distinct gesture**
>     (double-tap/long-press) → Agent; (iii) **minimal-mode only**: in minimal the moon tap = `navigate("agent")`,
>     otherwise it deselects. Recommend (i) or (iii). Also confirm: minimal-only, or all chrome modes?
>   - **Double-check:** if a host is selected / the BottomSheet is open, should navigating also clear selection /
>     close the sheet? Read `store/cosmosSelection.ts` + the `BottomSheet` open logic before wiring.
>
> **2b · tab transitions (verify, maybe upgrade).** A one-shot fade-IN **already exists**: `kit.css:99-102`
> `.kit .tab.active { animation: kit-fade 0.25s }` (transform/opacity, §14.11-OK), and it fires on every
> `navigate()` — including NavMenu-driven nav (navigate→`ui.tab`→active class flips). So "transitions are present."
>   - **🔴 REAL GAP to fix regardless:** `kit-fade` is **NOT motion-gated** (every other `.kit` anim is — grep
>     `body[data-motion="reduced"] .kit`). Add `body[data-motion="reduced"] .kit .tab.active { animation: none; }`
>     (§14.11 budget; [[themes-smooth-on-firefox-and-chrome]]).
>   - **⚠️ FORK (confirm):** is the existing fade-in enough, or does the owner want a true **fade-through** (outgoing
>     tab animates out + incoming in, Material-style)? A true cross-fade needs the outgoing tab kept mounted during
>     exit (`display:none` kills exit anims) → either the **View Transitions API** (already used by
>     `theme-engine/switchTheme.ts` for theme swaps — check it; mind Firefox VT support per §14.11) or a small
>     transition wrapper. **Web-research the pattern + perf before building**; likely just verify the fade reads
>     well in minimal and only build the upgrade if asked.
>
> **2c · docs (no code).** (1) `THEME_ENGINE.md §14.13` ("New-theme slot-in contract", line ~1073) — add an item:
> **the minimal chrome contract.** `ui.appbarMode` is the global tri-state lever; **DefaultRoot themes inherit
> minimal (the NavMenu) for free**; a **bespoke Root** (own `Root`, no DefaultRoot — e.g. vapor/cosmos*) MUST read
> `appbarMode` and either implement minimal or **explicitly map `minimal`→`off`**. (2) Note the **vapor-minimal
> TODO**: `VaporRoot` is the one bespoke Root not yet wired for minimal (maps minimal→off); to wire it, mount the
> Kit `NavMenu` under a `.kit` marker or a vapor-native equivalent. (*cosmos uses DefaultRoot, so it already has
> minimal.) (3) This `COSMOS_HANDOFF.md` already points here.
>
> **🔎 Pre-flight before you touch Slice 2 (owner asked for thoroughness — double-check anything extra):**
> 1. **Re-read the touch files** above (NavMenu, ui.ts, DefaultRoot, CosmosMoon, kit.css `.navmenu-*`/`.tab`) —
>    confirm you're reusing `useSections().navigate` + `appbarMode`, not forking nav state.
> 2. **Confirm the two forks** (2a moon behavior, 2b fade-through scope) with the owner in prose **before coding** —
>    these are real product decisions, and the owner prefers conversation on design ([[converse-on-design-decisions]]).
> 3. **Keep NavMenu a11y intact** (Esc / outside-pointerdown close / roving arrows / focus-restore) after any edit.
> 4. **§14.11 budget** holds: transform/opacity only, motion-gated, perf-gated. Verify on **Android (primary) +
>    Firefox + Chrome** ([[themes-smooth-on-firefox-and-chrome]]) — esp. the moon tap + tab fade.
> 5. **Don't touch frozen vapor art (D7)**; `appbarMode` stays **per-device/not-synced**; no hardcoding (any tunable
>    → config/Settings, [[prefer-configurable-no-hardcoding]]).
> 6. **Verify like every slice:** `npm run typecheck` · `npx vitest run` · `npm run build` + a live eyeball; pause
>    for review between 2a / 2b / 2c ([[pause-between-phases-for-review]], [[audit-each-part-before-continuing]]).
> 7. **Then** consider the broader roadmap (NOT in-flight): T2 **phosphor**, the queued **emma (Linux) deploy**,
>    **vapor-minimal** full wiring (2c's TODO), cosmos **C4** (parked), **unplugin-icons/Iconify** DX adoption.

> ### 🟢 SESSION UPDATE — BUCKET-A COMPLETE: A.3 Agent chat SHIPPED (+ A.1/A.2 recap) — 2026-06-27 (cont.)
>
> **What shipped (committed + green).** A.3 token-ported the entire Agent chat under `.kit` in audited
> sub-slices — the last shared surface. **Bucket-A is now complete**: `minimal` renders every shared surface.
> - **`ccc611f` A.3a** — base conversation: web-researched + owner-confirmed aesthetic (differentiate by
>   ALIGNMENT + FILL, muted tones) → **user = a filled accent-tint bubble** (right, flat bottom-right corner),
>   **assistant = QUIET, borderless** (left, prose/markdown is the main flow), sys = muted dashed caption;
>   who-line + dots, `.notice`, reasoning `.think` disclosure, streaming `.dots`/`.caret`/`.status-tag`, `.chat-err`.
> - **`57f8902` A.3b** — markdown (`.b.bot .md*`): prose/headings (clean sans), lists, links, blockquote/hr,
>   inline-code lozenge, fenced `.md-code` panel (lang + copy/send bar).
> - **`a5ba22f` A.3c** — tool/command bubbles: owner-confirmed **NEUTRAL `--surface` card** (not vapor green),
>   `$`-code well, exec=`--accent`/dismiss=`--text-3` actions, the result **semantic ladder** (ok=`--ok`,
>   error/denied/timeout=`--danger`, running=`--accent` pulse), web-search/output disclosures, the question
>   bubble, and the per-bubble **TTS play/pause** (`.tts-play`).
> - **`848dd85` A.3d** — the **plan panel** (`.plan-*`: pinned checklist + step ticks pending/active(`--accent`)/
>   done(`--ok` ✓), z 4 under the Kit appbar z 5) + the **session-privilege chip/menu** (`.priv-*`).
> - **`19b87b8`** — bottom edge-fade shortened + softened (owner eyeball).
>
> **VERIFIED:** every sub-slice green (`build` · `npm test` **120** · `test:e2e` **34**); an **A.3a audit** +
> a **whole-A.3 coverage sweep** (every chat class an emitter renders resolves to a `.kit` rule) — both CLEAN,
> 0 blocker/high. Distinct `kit-*` keyframes; all ambient anims motion-gated, frosted plan surfaces perf-gated
> (§14.11). vapor computed-identical.
>
> **⛔ NEXT (owner's pick):** **T2 phosphor** (§14.10 — the second reskin theme: its own `tokens.css` + Fontsource
> fonts + a CRT/scanline aesthetic, reusing the whole Kit + DefaultRoot — should be *mostly tokens now that the
> Kit is complete*; research the CRT effects against §14.11 first) · **OR** the queued **emma (Linux) deploy** ·
> OR T3–T5 (spatial themes, need `present()`). The deferred **SettingRow sweep** of the remaining Conf groups
> also still stands (owner: incremental).
>
> **🪐 Cosmos theme — see [`COSMOS_HANDOFF.md`](./COSMOS_HANDOFF.md).** C1 (starfield), **C2a-fix**, and **ALL
> of C2b** (per-planet compositor orbit · camera zoom-follow + tap-hit-area · liveness pulse/halo · service-cue
> moons/ring · Data/Visual/Off) are shipped + pushed on `main` (commits `2639ea2`→`2d44741`; FE 178 unit / 34
> e2e). **The ONLY remaining cosmos work is C3 — the bottom-sheet HostDetail**, with its design LOCKED in
> COSMOS_HANDOFF **§10** (cosmos-specific `CosmosHostDetail` + a shared dep-free `BottomSheet`; no scrim).
> **Read COSMOS_HANDOFF §2 + §10 before resuming cosmos.**
>
> **✅ Efficiency pass — FE + BE (owner-approved 2026-06-27, shipped).** A whole-app, web-researched
> efficiency sweep (separate from the Agent-tab note below). **Frontend:** FE#1 lazy-load non-default theme
> Roots (`loadRoot`+Suspense); FE#2 `useChatSlice` selector so the composer/mic/voice + PrivilegeChip don't
> re-render per streamed token (`f87ad5f`); FE#3 self-host vapor fonts via `@fontsource` latin+latin-ext,
> dropping the Google Fonts CDN — offline PWA, CSS held at 23.5 gz (`a79d1ee`); FE#4 `memo(DeviceRow)` (+
> stable controller callbacks / memoized `svcByHost` / `EMPTY_SERVICES`), Waveform rAF gated on `ui.motion`,
> Fleet carousel paused off-tab (`5e7fc59`). **Backend:** BE#1 stable per-turn prompt prefix (`a4b9265`) —
> `_static_prefix()` builds the system head once per turn + `_tools()` rendered once, reused byte-identically
> so the local llama.cpp KV cache (`cache_prompt`) and cloud auto-prefix cache hit on loop iterations 2..N
> (re-prefill only the appended tool result). Reflection nudge moved to an ephemeral tail layer so it never
> perturbs the cached head. Research: Codex CLI / Hermes / opencode / Claude Code all keep tools+system
> stable + append at the tail (caching is prefix-based, tools at the top of the hierarchy).
> **↳ Follow-up seam (not done):** add Anthropic `cache_control` breakpoint markers in `adapters/inference.py`
> to extend the same prefix-cache win to the cloud Anthropic path (local + OpenAI already benefit with no
> markers). **↳ React Compiler eval** still queued as a separate spike (owner: "spec it as a separate evaluation later").
>
> **⚙️ Deferred — a future Agent-tab efficiency pass (owner-noted 2026-06-27).** The big wins shipped
> (`408354f` memoize bubbles + markdown → per-token work O(streaming bubble) not O(all bubbles); `ad3e3ab`
> halve the frosted-blur radius 14→8px). Remaining, ranked, for when more is wanted: (1) **block-level
> markdown memo** — split a reply into top-level blocks so even the *streaming* bubble only re-parses its
> growing tail block (LibreChat/Vercel-AI-SDK pattern; no deps); (2) **pause off-tab Fleet polling/carousel**
> (the 5s/6s timers re-render the hidden Fleet while on Agent) + stop `setCallState`/`addToolResult` copying
> ALL messages (preserve identity for messages without the call, like `addToolResult` already does for the
> array) so memo survives tool-call events; (3) **virtualize the chat log** with `react-virtuoso` (adds a dep
> — only if very long threads still hitch after 1–2). Full diagnosis was an independent recon this session.
>
> ---
>
> ### 🟢 SESSION UPDATE — Bucket-A.2 SHIPPED (deep Conf editors + Utils tab) — 2026-06-27 (cont.)
>
> **What shipped (committed + green).** A.2 token-ported every editor-specific + Utils-tab surface from
> `[data-skin=vapor]` to `.kit`, in audited sub-slices (each: build → 120/34 → audit → commit → eyeball):
> - **`a419c47` A.2a** — Machine/Service (`.svc-*` + small auto-switch) · Inference fallbacks · Integrations
>   `.kv-text` · shared prompt-rows (`.conf-promptrow`/`.prompt-preview`/`.prompt-open`/`.kv-prompt`).
> - **`b44415d`** — PromptModal footer fix + pulled-forward Memory/Skills raw-editor (`.kv-text.skill-md`,
>   `.skill-md-bar`, `.mem-*`).
> - **`8c33dc9` A.2b** — Agents allowlist tri-state (`.tick-grid .tick`, scoped off the A.3 plan dots) +
>   limits grid (`.agent-lim`/`.lim-input`) + `.agent-store`/`.agent-slug`/`.agent-empty` · Tool descriptions.
> - **`f29feeb`** — 3 owner-reported UX fixes across **Kit + vapor** + documented as `THEME_ENGINE.md` **§14.12**
>   (draw symbols don't font them · dependent setting → own conditional sub-row · dialog footer neutral-left/
>   primary-right). Auto-route row split; the `+/−` add-glyph is now CSS-drawn (font-independent) in both skins.
> - **`da6ac44` A.2c** — Utils/Tools tab: `.util` run-cards (masked `.ico` yt/globe) + `.tcat-*` agent-tool
>   catalog (risk ladder high=`--danger`, confirm=`--warn`) + ModeSeg tri-state additions.
> - **`f938eb1`** — compact catalog tri-toggle (`small`) + sealed the Kit top-fade seam (opaque top stop).
> - **`+ this commit`** — `.kit .no-svc` caption (the one whole-A.2 audit LOW).
>
> **VERIFIED:** every sub-slice green (`npm run build` · `npm test` **120** · `npm run test:e2e` **34**); FOUR
> independent audits (A.2a/pm/mem, A.2c, the 3-UX-fixes, and a **whole-A.2 coverage sweep**) — all PASS/CLEAN,
> 0 blocker/high; the coverage sweep confirmed **every** class the editors + Utils tab emit resolves to a `.kit`
> rule. vapor stays computed-identical. Conventions match A.1 (inputs `--bg` @13px, cards `--surface`, flat
> `--accent`, danger ladder, mono = system stack).
>
> **⛔ NEXT = Bucket-A.3 — the Agent chat bubbles** (the last vapor-scoped shared surface under minimal):
> markdown replies + reasoning/thinking disclosure + `.b.cmd` tool-call/confirm bubbles (web-search/output
> disclosures) + the plan-panel & step dots (`.tick.tick-btn` — deliberately left off the A.2b allowlist chip)
> + the privilege chip/menu + the question bubble. Net-new patterns to research (chat-message + markdown
> styling, the disclosure/bubble interactions) → research → design-in-prose → confirm → audited slices. The
> **SettingRow sweep** of the remaining Conf groups is still deferred (owner: incremental).
>
> ---
>
> ### 🟢 SESSION UPDATE — Bucket-A.1 (overlays + Conf shell) + post-A.1 Conf polish — 2026-06-27 (cont.)
>
> **What shipped (committed + green).** Bucket-A.1 closed the reachable broken-UX (minimal Fleet wake/stop → an
> *unstyled* ConfirmDialog), then a run of owner-driven Conf/appearance polish landed on top.
> - **`7067bc3` — Bucket-A.1.** Token-driven `.kit`-scoped CSS for the shared **overlays** (ConfirmDialog `.modal`,
>   PromptModal `.pm-*`, Toasts, MiniPlayer), **primitives** (Seg/Switch), and the **Conf shell** (`.sec`/`.conftitle`/
>   `.confgroup`/`.conf-card`/`.confrow`/`.mwrap`/`.mconf`/`.mform`/`.mfoot`/`.conf-save`/…) — all in the ONE Kit
>   stylesheet (§14.4.1). Components unchanged (F17 a11y is theme-independent); flat fills (`--accent-fill` + text=`--bg`),
>   outline-secondary buttons, §14.11 (perf-gated blur incl. modal backdrops, motion-gated mini-player, transform-not-left
>   switch knob, overflow-wrap), distinct `kit-*` keyframes. `--bg` added to the base token contract. Research: Material-3
>   → centered decision dialogs ⇒ re-skin in place (no bottom-sheet restructure of shared components).
> - **minimal palette — the var()-on-:scope FIX (the big one).** Accent colors didn't change when switching cyan/moss/
>   iris/amber: the derived `--accent` formula was declared on `:scope` (`<html>`), so it computed ONCE from html's inputs
>   and only *inherited* — the `body[data-accent]`/`body[data-mode]` input overrides sat below the derivation and never
>   re-derived it. **Fix:** declare the derived tokens (`--accent`/`-fill`/`-soft`) on a `body{}` rule (inputs stay on
>   `:scope`). **Documented as a ⚠️ gotcha in `THEME_ENGINE.md` §14.4.1** so phosphor/observatory/etc. can't repeat it
>   (rule: raw values → `:scope`; any `var()`-formula token over a per-mode/accent input → `body`).
> - **minimal light-mode neutral retune** — page `#f4f2ed`→`#e5e3df` (a real warm-grey, not near-white), cards a step
>   lighter (not pure white), stronger hairlines/text, light accents richer/darker; light got its own `--warn`.
> - **Kit top/bottom edge-fade scrims** — `.kit-main::before/::after` (static `linear-gradient` to `--bg`, z-index 3 below
>   the composer/appbar, `pointer-events:none`, §14.11-safe). Bottom gated to composer tabs (`.has-composer`, set by
>   DefaultRoot) + height tracks `--composer-h`; top at `top:var(--appbar-h)` (just below the appbar, or page-top when
>   hidden), shorter + subtler.
> - **auto-TTS toggle in Conf → Voice · TTS** — reuses the appbar's `useAppChrome` controller (no new state; flips local
>   `ui.ttsAuto`), gated on `ttsConfigured`. Fixes the gap where minimal's `hideAppbar` removed the only toggle.
> - **Color-swatch palette picker + SettingRow.** New `Swatches` primitive — a **radiogroup** of color chips (W3C APG:
>   role=radiogroup/radio, aria-checked, aria-label=palette name, roving tabindex + arrow keys, selection ring), dual-skin
>   like Seg/Switch. **Extensible model:** `PaletteModel.accents[].swatch?: string | string[]` (single color/gradient now —
>   vapor gradients, minimal hues; `string[]` = conic multi-token preview = the seam for future "design-framework"/complex
>   palettes, additive). minimal chips use a boosted chroma so the quiet accents are still distinguishable as a picker.
>   New **`SettingRow`** helper (label + desc + control slot — shadcn's horizontal `Field` pattern, web-validated) applied
>   to the **whole Appearance group** (6 inline rows → one declarative shape). The `applyBodyAttrs` accent path (vapor
>   `data-theme` vs reskin `data-accent`/`data-mode`) was checked — already centralized in one chokepoint, not spaghetti.
>
> **VERIFIED:** `npm run build` clean · `npm test` **120** · `npm run test:e2e` **34** (vapor-palette e2e updated to the new
> `role=radio`; Conf axe a11y green). Two independent audit passes (A.1 CSS; swatch+SettingRow) — 0 blockers; all findings
> folded in. vapor stays computed-identical (Kit CSS inert without `.kit`).
>
> **⛔ NEXT = Bucket-A.2 — the deep Conf editors** (`svc`/`agent`/`tick-grid`/`kv-text`/`tooldesc`/`mem`/prompt-rows) token-
> driven under `.kit` (sub-slice 2 of §14.4.1; A.3 = Agent chat bubbles). **Carry-forward:** the `SettingRow` consistency
> sweep across the remaining Conf groups (server/inference/voice/agents/memory/…) is **noted for later** — only the
> Appearance group adopted it this slice (owner: do it incrementally, not one giant diff). Same research → design-in-prose
> → confirm → audited-slices discipline applies.
>
> ---

> ### 🟢 SESSION UPDATE — Kit + minimal: chrome + Fleet shipped → NEXT = Bucket-A (shared bodies + overlays) — 2026-06-27
>
> **What shipped (committed + green).** The Kit is real and **minimal renders for real** (chrome + Fleet); only the
> shared tab BODIES + global OVERLAYS remain unstyled under minimal.
> - **K1 `39c9068`** — the semantic token contract (`theme-engine/kit/tokens.css`, `@layer base`) + the `minimal` theme
>   module (`themes/minimal/`: `tokens.css` OKLCH dark/light×4-accent, Fontsource fonts via `loadFonts`, a `ThemeDef`
>   with `Root=DefaultRoot` + settings `hideAppbar`+`density`) + the registry row. **Bug fixed:** `ThemeProvider` now
>   loads the active theme's lazy CSS/fonts on mount (a cold-load with a non-default theme persisted booted unstyled).
> - **K2 `7d47a25`** — the token-driven Kit chrome (`kit/AppBar`/`NavBar`/`Composer` + `kit/kit.css`) under the **`.kit`
>   marker** DefaultRoot puts on its shell; reuses the SAME controllers (`useAppChrome`/`useSections`/`useComposer`) — no new logic.
> - **K4 `07063d2`** — `kit/Fleet.tsx` (`KitFleet`: device list + a 3-stat summary, **REAL host data only** — online/
>   ping/last-seen/mac/services; NO Hero/monitoring/waveform) wired as DefaultRoot's default `Fleet` section (the §14.4
>   signature seam) + `lib/relativeTime.ts`. Plus the 390px-eyeball polish: the composer **floats** over the scroller
>   (content shows in the gaps around it), the chrome is **frosted glass** gated on `data-perf` (§14.11), and a global
>   body-margin reset (the appbar edge-frame fix).
> - **`0be020b`** — the **Kit CSS architecture is LOCKED** (`THEME_ENGINE.md` §14.4.1, web-researched vs **Radix Themes**
>   + the design-token consensus): **reskin themes = a `tokens.css` ONLY** (token-only theming; per-theme component-CSS
>   overrides are the discouraged path); ONE Kit stylesheet under the `.kit` marker (= Radix's `.radix-themes`); vapor =
>   the bespoke escape hatch (no marker). **⚠️ This design CHANGED because of the research — see the directive below.**
>   Same commit added the **coding-discipline hooks** (`.claude/settings.json`): a `UserPromptSubmit` PRE-FLIGHT
>   (read→research→confirm) + a `git commit` POST-FLIGHT (independent audit). They fire every prompt/commit now.
>
> **VERIFIED:** `npm run build` clean · `npm test` **120** · `npm run test:e2e` **34** · an independent audit agent on
> K4 found no blocker/high. vapor stays computed-identical (Kit CSS is inert without the `.kit` marker). Servers: backend
> 5433 (no-reload), frontend **5173** (the config port; the old `5190` note was stale).
>
> **⛔ KNOWN GAP (= the next slice):** the shared tab BODIES (Conf editors, Agent bubbles, Utils) + the global OVERLAYS
> (`ConfirmDialog`/`PromptModal`/`Toasts`/`MiniPlayer`/`SwUpdatePrompt`) are still **vapor-scoped**, so under minimal they
> render unstyled — and the **reachable** ConfirmDialog/PromptModal (minimal Fleet wake/stop → confirm) render unstyled
> at the bottom of the screen (a real broken-UX, audit-confirmed via screenshot). The next slice closes this.
>
> **⛔ NEXT = Bucket-A — token-drive the shared bodies + overlays under `.kit`** (extend the ONE Kit stylesheet, §14.4.1).
> Sub-slice it (each with a 390px eyeball pause), recommended order:
>   1. **Overlays + primitives + Conf shell** (`ConfirmDialog`/`PromptModal`/`Toasts`/`MiniPlayer`/`SwUpdatePrompt` +
>      `Seg`/`Switch` + the Conf section/card/rows) — **fixes the reachable broken confirm**; start here.
>   2. **The deep Conf editors** (Agents/Machine/Skills/Memory/ServerList/ToolCatalog).
>   3. **Agent chat bubbles** (markdown · tool-call/confirm bubbles · plan panel) — styles the raw chat behind the composer.
>
> ## ⛔⛔ FOR THE NEXT SESSION — RESEARCH THE PATTERN + CONFIRM THE DESIGN *BEFORE* YOU BUILD (owner directive 2026-06-27, emphatic)
>
> **Last session the owner had to TELL the agent to research — and the research then CHANGED the design** (the
> token-only + `.kit`-marker model came out of researching Radix Themes / Angular Material). **Do not repeat that.**
> For Bucket-A, even though it "looks like just CSS," there are real net-new design decisions (modal/dialog positioning
> + a11y + focus-trap over a floating layout; bottom-sheet vs centered modal on mobile; toast stacking; chat-bubble +
> markdown patterns; the overlay scoping under `.kit`). So, **in order:**
>   1. **READ** the code you'll touch — the overlay components + their CURRENT vapor CSS (`extras.css`,
>      `@scope([data-skin=vapor])`), the primitives (`Seg`/`Switch`), `ConfTab` + its editors, `AgentTab` + `lib/markdown`,
>      and `kit/kit.css` (the §14.4.1 model: ONE stylesheet, `.kit`-scoped, `@layer base`, token-driven; vapor untouched).
>   2. **WEB-RESEARCH the established pattern for each net-new surface — do NOT guess** (the research may change the
>      design again): accessible modal/dialog (focus-trap, `aria-modal`, scroll-lock, mobile bottom-sheet vs centered),
>      toast stacking / `aria-live`, chat-message + markdown styling, and the token-driven overlay-scoping approach.
>   3. **WRITE THE DESIGN IN PROSE — name the pattern, state reuse-vs-build — and CONFIRM with the owner BEFORE coding**
>      (the owner prefers a prose back-and-forth: memories `converse-on-design-decisions`, `prioritize-robust-over-seams`).
>   4. **BUILD IN SMALL, AUDITED SLICES** — token-only (no per-theme component CSS; extend the ONE `.kit` stylesheet),
>      no vapor leak (scope everything under `.kit`/unique `.kit-*`; verify vapor computed-identical), §14.11 (perf-gated
>      blur, wrapping text), run the FULL suite (**120 unit + 34 e2e**), an **independent audit pass on any structural
>      change**, then commit + **pause for the owner's 390px eyeball (Firefox/Fennec AND Chrome)**.
>
> The `coding-discipline` PRE-FLIGHT/POST-FLIGHT hooks (`.claude/settings.json`) reinforce this every prompt/commit —
> this block is the belt to that suspenders. **Read `THEME_ENGINE.md` §14.4.1 + the memories `kit-theming-pattern` +
> `discipline-hooks-preflight-audit` first.**
>
> ---
>
> ### 🟢 SESSION UPDATE — Theme-engine v2 (D29): **M3 DONE → NEXT = Kit + minimal** — 2026-06-26
>
> **What shipped (committed + green; the vapor migration runbook M0–M3 is now COMPLETE).** M3 finished vapor's
> `ThemeDef` and built the **per-theme settings mechanism** (§14.3) — the reusable "minimal hides the appbar"
> machinery every future theme rides:
> - **`ThemeDef.settings`** — a namespaced schema (`{type:"switch"|"seg", label, desc, default}`), the VS-Code
>   `configuration` contribution-point model (web-researched + owner-confirmed before coding). `theme-engine/
>   types.ts` gained `ThemeSettingField`/`ThemeSettingsSpec`/`ThemeSettingValue`.
> - **Open `ui.themeSettings[themeId]` map** + `setThemeSetting` (additive, "shape data to extend, not migrate") in
>   `store/ui.ts`; `useThemeSetting(id,key)` (`theme-engine/settings.ts`) resolves override→declared default. The
>   Conf **Appearance picker auto-renders** the active theme's settings (switch→Switch, seg→Seg) — adding a theme's
>   option is now **zero Conf/core/backend change**.
> - **vapor's `skyline/loz/heroOn/waveformOn` migrated** out of core `UIState` into `vapor.settings` (with a one-time
>   `migrateVaporSettings` localStorage fold). **VaporRoot owns** writing `body[data-skyline]/[data-loz]` via a
>   pre-paint `useLayoutEffect` (the M2.4 `.no-composer` precedent); FleetTab reads hero/waveform via `useThemeSetting`.
> - **`motion` + `perf` now SYNC cross-device** (owner directive: device levers, but consistent) — folded ADDITIVELY
>   into the LWW appearance channel alongside the new `theme_settings` map. Backend `AppearanceCfg` gained
>   `motion`/`perf`/`theme_settings`; `useAppearance` (`AppearanceDoc`/reconcile/save/`currentAppearancePatch`) +
>   `switchTheme` (optional `SwitchTarget` extras) carry them. Wire is snake (`theme_settings`, like `updated_at`);
>   store is camel — bridged at the two sync points.
> - **⭐ The robustness catch (independent audit):** the new backend fields **default to `None`, not their UI
>   defaults** — a pre-M3 config has a stamped `updated_at`, so a concrete default would look *authored* and the
>   LWW reconcile (`server.x ?? local.x`) would **wipe the owner's local reduced-motion / lite-blur / just-migrated
>   per-theme prefs on the first upgrade load**. `None` = "unseeded" → client keeps local until the first real write
>   seeds it (same contract as `updated_at`). Guarded by two reconcile tests. **Live-verified:** the owner's eyeball
>   write seeded `theme_settings:{vapor:{skyline:"mountains",…}}` — end-to-end sync confirmed.
> - **Deferred to its owning phase (T1):** a latent double-`switchTheme` on a self-initiated skin pick (the
>   optimistic write re-fires the reconcile while `switchTheme`'s async bundle-load is pending). **Unreachable today**
>   (vapor is the only registered theme → `pickTheme` early-returns), so per `fix-in-the-owning-phase` it's documented
>   in `useAppearanceSync` for the first non-vapor theme to gate on `useIsMutating`.
>
> **VERIFIED:** frontend `npm run build` clean · `npm test` **120** (+12: settings resolution, migrations,
> setThemeSetting, reconcile incl. the upgrade guard) · `npm run test:e2e` **34** · backend appearance tests green ·
> live `GET /api/appearance` returns the extended shape. Servers restarted (backend 5433 no-reload, frontend 5190).
>
> **⛔ NEXT = Kit + minimal** (§14.4/§14.10 — the big slice): the token-driven shared chrome (`DefaultRoot` +
> AppBar/NavBar/Composer/ConfShell/device-rows/NowMonitoring/ChatBubble/primitives) + the semantic-token contract +
> reuse-and-skin the existing Conf editors + Kit overlays, then **minimal** (first new theme: `tokens.css` + Fontsource
> fonts + OKLCH mode×4-accent matrix + its Fleet view with REAL host data). **minimal's `settings` (e.g. `hideAppbar`)
> is the first consumer of the M3 mechanism — its `Root`/`DefaultRoot` reads `useThemeSetting("minimal", …)`.**
>
> ---
>
> ## (SUPERSEDED 2026-06-27 — Kit chrome + minimal Fleet are DONE; see the 2026-06-27 block at the top. The research → design-in-prose → confirm → audited-slices DISCIPLINE below STILL APPLIES to Bucket-A.) FOR THE NEXT SESSION — DOUBLE-CHECK EVERYTHING + RESEARCH BEFORE YOU BUILD Kit + minimal (owner directive 2026-06-26)
>
> The owner explicitly asked that the next session **double-check the whole state first** and **research before
> implementing the new theme** — this is the biggest, most net-new slice yet (a token contract + a headless Kit + the
> first ground-up theme), so do NOT rush into code. The discipline that made M0–M3 land cleanly is the bar.
>
> **STEP 0 — read, in this order (don't skip):** this whole block → `THEME_ENGINE.md` **§14.4** (the Kit + token
> contract), **§14.10** (build order), **§14.11** (the cross-browser perf RULE — minimal must pass it on Firefox/Fennec
> AND Chrome at 390px), **§9.7** (the 3-tier semantic-token contract), **§9.8** (the `PaletteModel`/OKLCH matrix) →
> `DECISIONS.md` **D29** (the locked architecture — the Kit is the OPTIONAL reuse layer; reskin themes = `DefaultRoot` +
> `tokens.css` + fonts + a Fleet view; bespoke themes write their own `Root`) → `TODO.md` "Kit + minimal" + "T2…T5" →
> `ROADMAP.md` (per-host visuals / `present()` seam) → `VAPOR_PATTERNS.md` (the design language, for parity) → `DESIGN.md`
> / `ARCHITECTURE.md` (where the Kit slots in). Then **read the actual code you'll touch** before writing a line: the
> 5 controllers (`useFleet`/`useComposer`/`useAgentChat`/`useSections`/`useAppChrome`) + `store/*`, the `theme-engine/`
> (registry/types/resolve/ThemeProvider/switchTheme/**settings.ts** — minimal's `hideAppbar` rides `useThemeSetting`),
> the vapor components the Kit generalizes (AppBar/TabBar/Composer/ConfTab + its editors/DeviceRow/Hero/NowMonitoring/
> Waveform), and how `body[data-skin]`/`@scope`/`@layer` gate CSS (§14.6).
>
> **STEP 1 — RESEARCH BEFORE IMPLEMENTING (the owner's explicit ask).** Kill ambiguity with web-search + a question,
> never a guess (memories `prioritize-robust-over-seams`, `converse-on-design-decisions`). Research at minimum:
> - **OKLCH palette generation** — building a `mode × 4-accent` matrix with perceptually-uniform OKLCH (lightness/chroma/
>   hue ramps, dark↔light pairing, contrast/APCA for WCAG); how to express it as CSS custom props per `@scope`.
> - **3-tier / semantic design tokens** — the global→semantic→component naming convention (the dominant external
>   pattern; follow it at the boundary per `follow-external-conventions-for-pluggability`) so the Kit's contract is
>   forward-compatible and a theme overrides at the right tier.
> - **Headless/token-driven component pattern** — `DefaultRoot`-style parameterized scaffold (Radix/Headless-UI/Kit
>   patterns) that consumes the controllers + token contract; how reskin themes stay cheap.
> - **Fontsource** self-hosted font activation (lazy `loadFonts`, FOUT/FOIT avoidance, the PWA-precache angle).
> - **The §14.11 perf budget for a NEW theme** — transform/opacity-only ambient anims, `data-perf`/`data-motion` gates,
>   ResizeObserver-sized + FPS-capped + IntersectionObserver-paused canvases (the cosmos/frontier trap), themed scrollbars.
> - Anything else genuinely uncertain (e.g. View-Transition cost across themes, real-host-data Fleet rows vs the
>   prototype's mock uptime/cpu/temp). **Web-research it, then ASK — don't assume.**
>
> **STEP 2 — DESIGN IN PROSE, SURFACE THE SEAMS + DECISIONS, AND WAIT FOR THE OWNER before coding** (memories
> `check-patterns-before-implementing`, `converse-on-design-decisions`, `design-quality-is-first-class`). State exactly
> which existing structures/controllers/tokens you reuse, where the Kit slots in (don't bypass a chokepoint — the
> appearance-sync, the theme registry, the controllers), what's net-new, and the open decisions (which Kit primitives
> exist; the token tiers; minimal's settings; how minimal's Fleet shows REAL host data). The owner prefers a prose
> back-and-forth over a model that rushes into code — this slice is exactly that kind of decision.
>
> **STEP 3 — BUILD IN SMALL, AUDITED SLICES** (memories `audit-each-part-before-continuing`, `pause-between-phases-for-
> review`, `prefer-configurable-no-hardcoding`, `themes-smooth-on-firefox-and-chrome`): no hardcoding (tunables →
> tokens/ThemeDef/Settings), no duplicated/near-duplicate code (one source of truth, in BOTH directions). After each
> part: re-read the diff · behavior-equivalence (vapor must stay byte/behavior-identical — it's the default) · re-render
> scope (the M2.1 lesson) · store-state survives a theme switch · run the FULL suite (currently **120 unit + 34 e2e** +
> backend) · then commit + push + **pause for the owner's 390px eyeball + a go-ahead** (Firefox/Fennec AND Chrome).
> **Run an independent audit pass on any structural change** (it caught M3's upgrade-wipe blocker) — robustness,
> efficiency, reliability.
>
> **The standing pre-flight + the controller pattern below (the M2 block) still govern** — re-read them; the Kit's
> shared controllers/primitives are built with the same store-backed, re-render-isolated discipline.

> ### 🟢 CLEAN-SESSION HANDOFF — Theme-engine v2 (D29): **M2 DONE → M3 (register vapor + per-theme settings)**, then Kit + minimal — 2026-06-26
>
> **⛔ READ FIRST, IN ORDER (don't skip):** (1) `DECISIONS.md` **D29** — the locked architecture; (2) `THEME_ENGINE.md` **§14**
> — the buildable spec (four layers, the controller catalog, the `ThemeDef`/`Root` contract, the `@scope` CSS model, the
> M0–M3 vapor runbook, the edge-case table) **+ the NEW §14.11 — the cross-browser perf + robustness RULE every theme MUST
> pass** (smooth on Firefox/Fennec AND Chrome at 390px; transform/opacity-only ambient anims; gate blur→`data-perf`,
> motion→`data-motion`; cap+pause canvas loops; wrap long text; themed scrollbars); (3) this block. **The §§9–13 "slot
> model" is SUPERSEDED — build against §14.** Everything is pushed (`origin/main`).
>
> **The architecture in one breath.** Ownership is INVERTED vs the old slot model: the **theme owns its whole presentation**
> (a `Root` component); the **app owns functionality as headless, STORE-BACKED controllers** mounted ABOVE the Root; an
> optional **Kit** (built later, with minimal) supplies reusable token-driven presenters. **vapor is being migrated as a
> normal theme** (the default until each other theme is verified), via the **M0–M3 verify-at-every-step runbook** (§14.7).
>
> **✅ M2 IS COMPLETE — all five controllers extracted (each committed + pushed + green; read the commits to verify):**
> - **M0** shell inversion (`App` = thin host rendering the active theme's `Root`; vapor's old App body → `themes/vapor/VaporRoot.tsx`; byte-identical) · **M1** `@scope` CSS isolation (`vapor.css`+`extras.css` wrapped verbatim in `@scope([data-skin="vapor"])`; **`data-skin` on `<html>`**; the gotcha — scoped selectors match DESCENDANTS → `:root`→`:scope`, `html,body`→`:scope,body`; §14.6).
> - **M2.1 `useFleet`** (`store/fleet` + the SINGLETON `useFleetCycle` engine in `<AppEngines/>` + pure `useFleet`) · **M2.2 `useComposer`** · **M2.3 `useAgentChat`** (COMPOSES `store/chat`; the `resultByCall`/`currentPlan` derivations live in `lib/plan`; `useChatInit`+`useAutoTts` mounted in `<AppEngines/>`; the bubbles + `#app-scroll` stick-to-bottom stay in AgentTab) · **M2.4 `useSections`** (generalizes `ui.tab`; TabBar's duplicate `TABS` deleted; `.no-composer` is now THEME-OWNED in VaporRoot via `useLayoutEffect`, not the core store) · **M2.5 `useAppChrome`** (`useAppChrome` = the auto-TTS toggle + `useNowPlaying` = the mini-player transport — split so the always-visible AppBar doesn't re-render on the player's ~4×/sec progress). **The CONTROLLER PATTERN that produced all five is the load-bearing reference below — reuse it for the Kit's shared controllers.**
>
> **Also shipped this session (UI polish + Firefox perf — a fresh session should know the current state):** round plan dots · tap-highlight removal · button/composer long-press-selection off · themed scrollbar-corner (no white box) · **mic** is flag-aware (records over plain-HTTP when the origin is browser-flag-whitelisted; greys ONLY when truly incapable; Fennec sticky-`:active` press fix) · a device-local **"Blur" perf toggle** (`body[data-perf="lite"]` drops backdrop-blur on the 3 frosted bars) · the **neon grid** GPU-composited (`background-position`→`transform: translateY`, 1:1, in vapor.css) · the live-ping **waveform canvas** optimized (30fps cap · pause off-screen via IntersectionObserver · no per-frame `getComputedStyle`/`getBoundingClientRect`) · the **plan panel** 3-state click cycle (pending→active→done, exactly-one-active via `lib/plan.advanceStep`) + clearer dots/count · **Tools catalog** sorted severity→confirm→core · the **mini-player** scrubber is now a desynced, motion-gated waveform. **⭐ The durable output: `THEME_ENGINE.md` §14.11 — the cross-browser perf + robustness RULE** (saved to memory `themes-smooth-on-firefox-and-chrome`); **every future theme MUST pass it.** Also noted **ROADMAP §C3** (chunked TTS — split a reply by paragraph/sentence/list-item, synth+play progressively; big improvement, moderate refactor; deferred).
>
> **⛔ NEXT = M3 — register vapor as a complete `ThemeDef` + build the PER-THEME SETTINGS mechanism (§14.3 + §14.7-M3).**
> vapor already has `Root=VaporRoot` (M0); M3 finishes its `ThemeDef` (palettes = named accents · eager `loadStyles` ·
> `settings`) and — the meaty part — builds **per-theme settings**: `ThemeDef.settings` (a small schema + defaults) → an
> open `ui.themeSettings[id]` map → **synced via the appearance channel** (extend `AppearanceCfg` ADDITIVELY, don't
> restructure) → `useThemeSetting(id,key)` → the Conf **Appearance picker auto-renders the active theme's settings**.
> After M3 vapor is a fully-migrated peer theme (still the default) → then **Kit + minimal** (the big slice; §14.4/§14.10).
>   - **Analyze FIRST (read before writing a line):** `store/ui.ts` (vapor's global decorative toggles — `skyline`/`loz`/
>     `heroOn`/`waveformOn` — are VAPOR-SPECIFIC and the natural first per-theme settings) · `tabs/ConfTab.tsx` (the
>     Appearance group rendering them today) · `hooks/useAppearance.ts` + backend `AppearanceCfg` (the cross-device LWW
>     sync — extend additively) · `theme-engine/{registry,types,ThemeProvider}` · `themes/vapor/index.tsx`.
>   - **THE OPEN DESIGN DECISION (owner's call — CONFIRM IN PROSE BEFORE CODING):** which of vapor's global toggles migrate
>     into `ThemeDef.settings` (skyline/loz/hero/waveform) vs stay global (theme/mode/accent/motion/perf). Shape
>     `themeSettings` additive (owner directive "shape data to extend, not migrate"); migrating a sparse map now is cheap —
>     but confirm the boundary + the `AppearanceCfg` extension with the owner first.
>
> **⭐⭐ BE EXTRA SURE BEFORE YOU IMPLEMENT — the owner's standing pre-flight (do NOT skip, ESPECIALLY for M3). A feature
> STARTS by reading the code it touches, not by writing code:**
> 1. **READ** every touch point above + the doc (D29, §14.3, §14.11) and CONFIRM you are reusing the existing data
>    structures / stores / hooks, slotting into the right architecture layer (don't bypass a chokepoint like the
>    appearance-sync or the theme registry), with **NO hardcoding** (tunables → config/AgentDef/ThemeDef/Settings) and **NO
>    duplicated / near-duplicate code** (one source of truth, in BOTH directions — don't fork an existing pattern, don't
>    re-own something you already have).
> 2. **DESIGN it in prose FIRST, then SURFACE the seams you'll reuse + any deviation + the open decisions to the owner and
>    WAIT for their confirmation BEFORE you code** (memories `check-patterns-before-implementing`, `converse-on-design-
>    decisions`, `design-quality-is-first-class`, `prioritize-robust-over-seams`). The owner explicitly prefers a prose
>    back-and-forth on architecture over a model that rushes into code — M3's "which settings migrate" + the sync extension
>    are exactly that kind of decision. When a dominant external convention exists, follow it at the boundary
>    (`follow-external-conventions-for-pluggability`); kill ambiguity with a web-search + a question, not a guess.
> 3. **AUDIT each part before continuing** (`audit-each-part-before-continuing`): re-read the diff · behavior-equivalence ·
>    re-render scope (the M2.1 lesson) · store-state survives a theme switch · run the FULL suite · then commit + push +
>    continue. **Pause for the owner's 390px eyeball + a go-ahead after each slice** (`pause-between-phases-for-review`) —
>    never batch or momentum-continue.
>
> **⭐ THE CONTROLLER PATTERN — FOLLOW IT EXACTLY (it's load-bearing):**
> 1. **State that must survive a theme switch or be shared across presentation instances → a STORE** (the dep-free
>    `store/createStore.ts` binding), never component `useState`. Reference: `store/fleet.ts`. Add a **unit test** for any
>    real store logic (reference: `tests/store/fleet.test.ts` — uses `vi.useFakeTimers` for the hold).
> 2. **A singleton ENGINE** (a timer or query-subscription that must run once) → a hook called ONCE inside **`<AppEngines/>`**
>    (a null-rendering child of App), **NOT in App's body.** ⚠️ **This is the M2.1 audit lesson:** a query-subscribing hook in
>    App's body makes App re-render every poll, and since `<ActiveRoot/>` is a fresh non-memoized element each render, the
>    **entire theme tree re-renders every ~5s.** Isolating it in `<AppEngines/>` keeps the re-renders there. App must
>    re-render ONLY on a theme change.
> 3. **A pure CONSUMER hook** (`useX`) the presentation reads — returns state + actions, **no markup.** References:
>    `useFleet`/`useComposer`. Use imperative store getters (e.g. `getDraft()`) in actions to avoid stale closures.
> 4. **Behavior-preserving:** the existing **108 unit + 34 e2e** must stay green at every step. The e2e flows (chat-send,
>    row-toggle, shutdown-confirm, theme-switch, live-ping-canvas) are your behavior guard — run them after each controller.
>
> **⚠️ DOUBLE-CHECK / BE CAREFUL ABOUT (the things that bite):**
> - **AUDIT EACH CONTROLLER before moving to the next** (owner's standing rule — memory `audit-each-part-before-continuing`):
>   re-read the diff, check behavior-equivalence vs the original, hunt for re-render scope regressions (the M2.1 lesson),
>   confirm the store-backed state survives a theme switch, run the full suite. Then commit + push, then continue.
> - **Don't re-implement logic that's already in a store/hook** (chat loop is in `store/chat.ts`; fleet data in `useHosts`).
>   Controllers COMPOSE; they don't duplicate.
> - **`@scope` discipline for any theme CSS (NOW relevant — M3 touches CSS):** a theme's CSS lives inside `@scope ([data-skin=X])`;
>   its `:root` must be `:scope`; `data-skin` is on `<html>`; a theme's `tokens.css` var block uses `:scope`.
> - **§14.11 perf + robustness rule governs EVERY theme** (transform/opacity-only ambient anims · blur→`data-perf` ·
>   motion→`data-motion` · cap+pause canvas · wrap long text · themed scrollbars). **`@scope` support floor = Firefox 146** —
>   an OUTDATED Fennec silently drops ALL scoped CSS → a near-blank page (the owner hit this, then updated; keep it in mind).
> - **Canvas components** (Waveform, cosmos/frontier later): size the backing store via a **ResizeObserver**, cap FPS, and
>   PAUSE off-screen via IntersectionObserver (the always-mounted-but-hidden-tab trap — see the live-ping + 30fps fixes).
> - **Vapor must stay byte/behavior-identical** through M3 — it's the only fully-working theme + the default; a render change
>   is a bug (unless it's an owner-approved fix). **TTS-idle note:** a slow (~24s) synth sends no bytes → an idle socket the
>   Tailscale path can reset (SSE chat survives — it streams); real fix = ROADMAP §C3 (chunked TTS), deferred.
> - **Windows env:** backend has **no `--reload`** (it breaks `asyncio.create_subprocess_exec`); restart it via the
>   kill-by-port + hidden `Start-Process` one-liner. The **Bash tool's cwd resets between turns** — always `cd
>   /c/Users/rovax/Documents/github/ctrl-b/dashboard_v2/frontend` before `npm`. LF→CRLF git warnings are benign.
>
> **VERIFICATION (run from `dashboard_v2/frontend`):** `npm run build` (tsc+vite) · `npm test` (vitest, **108**) ·
> `npm run test:e2e` (playwright, **34**). Backend tests: from `dashboard_v2/backend`, `./.venv/Scripts/python.exe
> tests/<file>.py` (pytest not installed). **Servers:** backend **5433** (`uvicorn app.main:app --port 5433`, no `--reload`),
> frontend **5190** (`npm run dev -- --port 5190`). Restart the frontend after structural changes so the owner can eyeball;
> **pause for the owner's 390px eyeball + a go-ahead after each slice** (memory `pause-between-phases-for-review`).
>
> **The big picture after M2/M3:** vapor = a fully migrated theme (default). Then the **Kit** (token-driven shared chrome +
> the semantic-token contract + `DefaultRoot` + reuse-and-skin the existing Conf editors + Kit overlays) and **minimal**
> (the first new theme: `tokens.css` + Fontsource fonts + the OKLCH mode×4-accent matrix + its Fleet view with REAL host
> data, not the prototype's mock uptime/cpu/temp). Then T2 phosphor (cheap, reuses the Kit) → T3 observatory → T4 cosmos →
> T5 frontier (bespoke animated Agent tab). Per-theme Fleet (and frontier Agent) get a 390px eyeball pass (owner directive).


> ### 🟢 ARCHITECTURE REVISION — Theme engine v2 (D29) — 2026-06-26 — **read this before building**
> The owner refined the requirement: a theme must be able to **restructure/relocate/hide/add** any element (minimal hides
> the appbar; frontier's chat has animated squares) while **full functionality stays reachable**. T0's **fixed 7-slot
> model can't do that**, so the architecture is revised (→ **DECISIONS D29**, spec **THEME_ENGINE.md §14**). **Build T1+
> against §14, NOT the §§9–13 slot model.**
> - **Invert ownership:** the **theme owns the whole presentation (`Root`)**; the app owns **functionality as headless,
>   store-backed controllers** (`useFleet`/`useComposer`/`useAgentChat`/`useSections`/`useAppChrome`) mounted **above**
>   `Root`; an optional **Kit** supplies reusable token-driven presenters (`DefaultRoot` + chrome + Conf + NowMonitoring +
>   primitives). Reskin themes = `tokens.css` + fonts + a Fleet view; bespoke themes write their own `Root`.
> - **vapor is migrated as a normal theme** (owner: full integration, no frozen special-case) — **default until each other
>   theme is verified.** Migration is the careful part → the **M0–M3 verify-at-every-step runbook** (§14.7): M0 shell
>   inversion (byte-identical) · M1 `@scope` CSS-scoping gate (vapor byte-identical scoped) · M2 controller extraction one
>   feature at a time · M3 register vapor + per-theme settings. Then Kit + minimal, then T2–T5.
> - **CSS isolation = `@scope([data-skin=X])`** (Baseline Dec 2025) — vapor.css stays verbatim except scope-root selectors;
>   far lower risk than a PostCSS prefix (web-researched). `@layer base,theme` orders Kit-vs-theme. Default eager, others lazy.
> - **Core invariant (no future refactor):** all state that must survive a switch / be shared lives in a controller/store
>   above `Root`, never theme `useState`. **Only Fleet (+ frontier Agent) deviate structurally**; everything else is
>   vapor's functionality restyled. T0 infra that **survives:** registry, provider, `ui {theme,mode,accent}`, cross-device
>   sync, View-Transition switch, no-FOUC script, `@layer`. **Replaced:** the 7-slot `ThemeSlots`/`useThemeSlot`/slot-host.
> - **⛔ NEXT = M0** (shell inversion, vapor verbatim under `<VaporRoot/>`, byte-identical). Audit each change before continuing.

> ### 🟢 SESSION UPDATE — Theme Engine **T0 (the engine; vapor untouched) SHIPPED** — 2026-06-26
> The foundation is built + fully green; **vapor renders byte-for-byte unchanged** (the acceptance test).
> **Read `THEME_ENGINE.md §§9–13` + `DECISIONS D28` + `TODO Phase 11` for the design; this block is what landed.**
> - **What shipped (the §9.13 touch list, exactly).** `src/theme-engine/` — `types.ts`, `registry.ts`,
>   `tabs.ts` (pure tab data, no component imports → lets `store/ui` read `hasComposer` with no runtime cycle),
>   `base.ts` (**empty BASE stub** — real BASE is T1), `vapor.tsx` (registers the existing components as slots,
>   frozen), `resolve.ts` (module-level **cached** slot map → stable identity, no context fan-out),
>   `ThemeProvider.tsx` (+`useThemeSlot`/`useThemeSlots`), `switchTheme.ts` (View-Transition path). Wiring:
>   `App.tsx` → **slot host** (preserves lazy-Conf/Suspense, `--appbar-h`, `hasComposer`); `store/ui.ts` →
>   `{theme,mode,accent}` + `data-skin`/cleared-`data-theme` + `migrateLegacyTheme`; `main.tsx` →
>   `theme/index.css` (`@layer frozen,base,theme` cage) + `<ThemeProvider>`; `ConfTab.tsx` → registry-driven
>   Theme/Mode/Palette picker. **Cross-device sync (day-1, §9.11):** backend `AppearanceCfg` (server-stamped) +
>   `GET /api/appearance` + `ComputerCfg.appearance` (per-host blob, schema-only); `hooks/useAppearance.ts`
>   (always-on query + `reconcileAppearance` + optimistic scope-serialized write); inline no-FOUC `<body>`-top
>   script in `index.html`.
> - **The `@layer` gate PASSED (the strategy fork).** Vite 7.3.3 preserves `@import … layer()` — the emitted
>   bundle wraps vapor.css/extras.css in `@layer frozen{…}`, byte-identical inner content. **No `cb-` namespacing
>   fallback needed.** Future themes in `layer(theme)` win over frozen vapor by cascade order, not specificity.
> - **Two robustness refinements beyond the spec wording** (found during the per-part audits): (1) the reconcile
>   **keeps local when the server is unwritten** (`updated_at=null`) — otherwise the owner's existing local theme
>   would revert to backend defaults on first load; server wins only once it has a recorded preference. (2)
>   `--appbar-h` uses a `.appbar, .cb-appbar`-scoped selector (a wrapper-ref is impossible on the frozen
>   `position:sticky` AppBar) — the theme-robust realization of §13.6's "stable ref". Also: the e2e mock is now
>   **stateful for appearance** (PUT updates it, GET returns it) so the optimistic-write→reconcile round-trip is
>   deterministic.
> - **Verified.** Frontend `tsc -b` + `vite build` clean (**CSS bundle hash unchanged** = vapor CSS untouched),
>   **92 unit** (+7: ui migration, legacy remap, reconcile) + **32 e2e**; backend **31 test files**
>   (new `test_appearance_d28.py` — defaults, GET/PUT round-trip + server-stamp persistence, per-host blob).
>   **Frozen files git-confirmed untouched** (vapor.css/extras.css/heroScene + all vapor components). Live
>   `GET /api/appearance` → `{vapor,dark,dark,updated_at:null}`. Servers restarted (backend 5433 no-reload,
>   frontend 5190).
> - **Doc reconciliation noted:** the per-host override is `ComputerCfg.appearance` (config schema) day-1 only —
>   the runtime `Host`/`_host_dto` wiring is additive at T3/T5 (§9.9 reasoning: no dead unwired field). The
>   earlier TODO "domain/host.py day-1" line is superseded (annotated in TODO Phase 11 T0).
> - **⛔ NEXT = T1 (minimal).** The first real theme + **the BASE token-driven chrome** (AppBar/Composer/TabBar
>   shell/Conf rows/ChatBubble/HostDetail consuming the semantic-token contract §9.7) + the **mode×4-accent OKLCH
>   matrix** (build the richest palette model here) + BASE FleetRows + the shared **NowMonitoring + Waveform**
>   slot (needs the `--accent-rgb` canvas channel, §13.7). BASE lands in `layer(base)` + a `cb-` namespace; its
>   TabBar indicator is **count-driven** (§13.8). The finer overridable sub-slots (NowMonitoring, then HostDetail
>   at T4/T5) get **added to `ThemeSlots`** in their owning slice (the T0 interface is the shell + 4 tab-body
>   slots; see `theme-engine/types.ts` header). Pause for the 390px eyeball after T1.

> ### 🟢 CLEAN-SESSION HANDOFF — Theme Engine designed (D28); T0 is the next build slice — 2026-06-26
> **The §8 research+design brief is DONE — no feature code written, per the owner directive.** The deliverables
> are locked: **[`THEME_ENGINE.md`](./THEME_ENGINE.md) §§9–10** (the code-level design spec + the prototype→module
> porting playbook), **DECISIONS [D28](./DECISIONS.md)** (the architecture + the resolved §5 decisions), **TODO
> [Phase 11](./TODO.md)** (T0–T5 slices), and a ROADMAP Appearance expansion. Five research streams ran (existing-
> code seam map · external best-practices, web-cited · prototype structural inventory · the per-host presentation-
> data pattern). **The owner resolved the four open judgment calls** (D28 "Resolved decisions"): shared base +
> per-theme slot overrides; **vapor = default *selection*, not the slot fallback** (fallback = the new BASE chrome,
> minimal is base made concrete); v1 = all themes mirror vapor's 4 tabs (flexible registry underneath); theme-owned
> `present()` + derive-by-default + optional open `host.appearance` override.
>
> **⭐ Owner directive (2026-06-26) — build the complete robust feature day-1, don't ship deferred seams that
> force a refactor.** Three items were pulled forward and are now **BUILT DAY 1** (or in their owning slice):
> **cross-device config-sync** (backend `appearance` block + lightweight `GET /api/appearance` + `ui`-store
> reconcile + no-FOUC inline script + optimistic write — §9.11), the **View-Transitions switch animation**
> (§9.12), and **frontier's per-host art override** (T5). Both new features were web-researched before locking
> (TanStack persistence/optimistic + offline-first SWR; View Transitions + React 19 `flushSync`). The standing
> rule going forward: kill ambiguity (web-search **and** ask the owner) before locking; prefer day-1 robustness
> over seams-for-later. (Recorded in memory: "prioritize-robust-over-seams".)
>
> **The architecture in one breath:** a `ThemeProvider` reads `ui.{theme,mode,accent}`, lazy-loads the active
> theme's `[data-skin]`-scoped CSS+fonts (caged from frozen vapor by CSS `@layer`), and resolves component
> **slots** from a typed `ThemeRegistry`
> (`registry[theme].slots[name] ?? BASE.slots[name]`); `App.tsx` becomes the slot host. **vapor's components +
> `vapor.css` are untouched** (only the shell generalizes → vapor renders byte-for-byte identically = the T0
> acceptance test). Non-vapor themes are self-contained modules (scoped lazy `tokens.css` mapping a semantic
> contract, own fonts/assets, declared palette axes, `present()`, `tabs[]`, slot overrides only for what they
> restructure). Adding a theme = one registry row + one module + one verbatim scoped CSS.
>
> **A final adversarial review ran (2026-06-26) — design validated, spec corrected.** Two streams (design-vs-code
> + web-cited best-practice) confirmed the architecture is the robust/efficient/reliable option and found **two
> vapor-breaking bugs** + robustness gaps in the spec *wording*, all now fixed (THEME_ENGINE.md §§9.6/9.8/**11–13**;
> **§13 is the T0 build checklist**): (1) **`data-skin` carries the ThemeId, NOT `data-theme`** (vapor.css gates
> aqua/ember on bare `[data-theme=…]` — overloading it kills 2 of vapor's 3 palettes); (2) a **trivial `ui`-store
> persisted-shape remap** for the owner's own legacy `theme:"aqua"` (low-stakes, single user — the field-fill
> merge can't value-remap, so a ~3-line read-time remap avoids reading back an invalid `ThemeId`); (3)
> **CSS `@layer`** cages the always-loaded frozen vapor/extras so an active theme wins by cascade order, not
> specificity — dissolving token + class-name collisions without editing the frozen files (T0 must `vite build`-
> verify `@import…layer()` survives; else `cb-` namespacing). Plus React-19 `precedence`/`preinit` FOUC handling,
> App.tsx shell-orchestration preservation, a `--accent-rgb` waveform channel, a count-driven tab indicator,
> container queries + View Transitions.
>
> **⛔ NEXT SESSION = BUILD T0** (the engine foundation — vapor untouched). **Read `THEME_ENGINE.md §§9–13`
> (§13 = the build checklist, §9.13 = the touch list) + `DECISIONS.md D28` + `TODO.md Phase 11` first**, then
> **pre-flight the actual code** the touch list names (`store/ui.ts`, `store/persist.ts`, `App.tsx`, `main.tsx`,
> `theme/vapor.css`+`extras.css`, `components/{Waveform,TabBar,AppBar,Hero}.tsx`, `tabs/ConfTab.tsx`) before
> writing anything — confirm each seam matches the spec. T0 ships nothing visible (vapor unchanged), just the
> registry/slots/`ThemeProvider`/`ui`-store generalization/Appearance picker + the `@layer` cage; **acceptance =
> byte-for-byte identical build**. T0's FIRST task is the `@layer` `vite build` verification. Then T1 (minimal)
> builds the BASE chrome + the OKLCH mode×accent matrix. This v1 commit is the clean baseline *before* the build.
>
> **The emma (Linux) deploy → cutover (TODO Phases 9 & 10) stays queued** — see the block below for the
> host-specific pre-flight; the owner chose the theme engine ahead of it.

> ### 🟢 (prior) CLEAN-SESSION HANDOFF — D27 done & pushed · only the emma deploy / cutover remains — 2026-06-26
> **Everything is pushed** (`origin/main` @ `af05a20`; tree clean except the untracked `prototypes/`
> UI-exploration dir, unrelated). **All green:** backend **30 test files** (`./.venv/Scripts/python.exe
> tests/<file>.py`; pytest not installed), frontend `npm run build` + **85 unit** + **32 e2e**
> (`npm run test:e2e`). Servers if needed: backend **5433** (`uvicorn app.main:app --port 5433`, **no
> `--reload`** on Windows), frontend **5190** (`npm run dev -- --port 5190`). On Windows restart the
> backend with the kill-by-port one-liner + a hidden `Start-Process` launch (a stray `&` exits the shell).
>
> **⭐ ACTIVE NEXT TRACK — the Theme Engine (analysis done, design open → [`THEME_ENGINE.md`](./THEME_ENGINE.md)).**
> The owner built **6 full theme prototypes** (`prototypes/project/variations/*.html`): minimal, phosphor,
> observatory, cosmos, frontier, + an evolved vapor. A deep analysis (4 parallel agents, 2026-06-26) found
> these are **not palette swaps — they're distinct design systems** with disjoint token namespaces, their
> own fonts, **restructured components** (cosmos = orbital planet fleet; frontier = photo-map + beacons +
> bottom-sheet; observatory = SVG topology; vapor-proto = canvas carousel hero), and a richer palette model
> (minimal = light/dark × 4 OKLCH accents). The proposed architecture is a **pluggable presentation layer**
> over the shared data/logic core: a `ThemeRegistry` of `ThemeDef`s, **semantic-token normalization** of the
> existing vapor components, **per-theme component slots** (esp. `FleetView`), a generalized `{theme,mode,
> accent}` palette model, and a per-theme host-presentation layer. Phased T0 (engine, **vapor untouched**)
> → minimal → phosphor → cosmos → frontier (observatory low-priority, last). **Scope + key decisions are
> RESOLVED** (owner 2026-06-26, in THEME_ENGINE.md): vapor **FROZEN/untouched**, vapor-proto dropped;
> in-scope = minimal+phosphor+cosmos+frontier (+observatory low-pri); frontier **IS** a Mœbius comic (the
> comic is in the owner's hand-drawn art, kept); persistence = v1 client-local with the cross-device
> config-sync seam designed in.
>
> **⛔ THE NEXT SESSION IS A RESEARCH + DESIGN PHASE, NOT IMPLEMENTATION (owner directive).** Do **not**
> write theme code yet. Read **[`THEME_ENGINE.md`](./THEME_ENGINE.md) §8** — it's the brief: research deeply
> (a) our existing render/store/CSS/asset code to find theme-switch seams that touch **no vapor code**, and
> (b) external best practices for skinnable React architectures (CSS strategy, component slots, token
> systems, per-theme font/asset loading) — the north star is that **adding a future theme or re-syncing one
> after the owner edits its prototype is cheap + mechanical**. Deliverables: a code-level design spec + a
> prototype→module porting playbook + **DECISIONS D28** + **TODO Phase 11** (T0–T5). The prototypes (+ art)
> are committed at `prototypes/project/variations/`. Then T0 (engine, vapor frozen) is the first build slice.
> D7 pixel-fidelity now applies *per theme*.
>
> **The v2 feature set is functionally complete** — Phases 0–8 shipped (fleet, agent tool-loop, voice,
> integrations, Conf, guarded shell, Tools tab + manage layer) and the memory subsystem is now fully
> built: two always-injected stores (per-agent `MEMORY.md` + global `USER.md`) + the **D27** additions —
> a **store registry** (`core/memory.py` `STORES`/`store_by_key`, the single spine), an opt-in emotional
> **`state.md`** (SET semantics, auto-applies), and opt-in **periodic reflection** (every N turns).
> Memory writes are atomic + git-backed (**D26**) and now race-free under one lock (the B-audit fix).
> All three D27 slices were independently audited; B and C each had a real finding fixed (B: a
> pre-existing concurrent lost-update; C: a non-one-shot nudge + subagent leak).
>
> **⭐ THE LAST v1 TRACK — emma (Linux) deploy → cutover (TODO Phases 9 & 10).** The owner is migrating
> dashboard_v2 from Windows (corsair) to **emma (Linux)**. **(Owner, 2026-06-26: deploy is NOT the next
> session — the dynamic theme engine is. This stays queued.)**
> **Pre-flight the deploy session first (host-specific — can't be assumed from corsair):** confirm emma's
> layout — home dir + fresh clone vs existing checkout, Python **3.11** present + where the venv lives,
> where `config.yaml` + the SQLite db will sit, the **Tailscale Serve** setup on emma (the HTTPS/mic
> path), and **systemd user-service vs system-service**. Get these from the owner before writing the unit
> or install script. Concrete remaining work:
> - **Phase 9 deploy:** (a) a **`systemd` unit** running uvicorn on boot (no `--reload`); (b) a **Linux
>   install/run script** (create venv + `pip install -e`/pinned deps, `npm ci && npm run build`, then
>   start) — v2 has **no install script yet**; the `*.bat` are the legacy Flask server's. Reuse the
>   single-origin prod path that already exists (FastAPI serves `frontend/dist`, `main.py`). (c) Optional
>   smoke tests (Android-viewport Playwright already exists via D24; add a couple of backend action tests).
> - **Phase 10 cutover:** feature-parity check vs the legacy `wol_server/wol_server_win.py` (WOL, monitor,
>   shutdown, command box, chat, YT/IP tools — all have v2 equivalents); run v2 beside the old server +
>   migrate `config.yaml`; flip the default; retire `wol_server/` (or keep as a Linux-WOL fallback) and
>   refresh README/AGENTS. **Keep the Tailscale-only, no-auth, no-public-bind boundary intact.**
>
> **Deferred / low-priority (none block cutover):** vector/semantic memory recall (the embeddings client
> is built + wired but unused — the `MemoryProvider` "both" seam); UI_AUDIT **F24** (component/axe a11y
> tests → Phase 9); **F9** `useTransition` / **F13** React Compiler (measure-first); QR-to-phone (`segno`
> dep, pending owner OK); ROADMAP **E2** OpenAI `/v1/chat/completions` facade; **D19** voice streaming
> transports (live STT + progressive TTS); **E0a** per-tool settings; **D27-C** reflection proposal-
> batching. Post-v1 backlog (ROADMAP): scheduled automations (A3), notifications (F1), wake word (C2),
> wake-on-connection (D1/D2), security hardening (G), privilege-selection UX (D16, specced).
>
> **Doc map for the deploy work:** `ARCHITECTURE.md` §6 (deployment profiles, the Windows `--reload`
> gotcha, the OS-branch invariant) · `README.md` (current run/build) · TODO **Phase 9/10** (the checklist
> below) · AGENTS.md §6 (the security boundary to preserve). The session blocks below are shipped history.

> ### 🟢 SESSION UPDATE — D27 Sub-slice C (periodic reflection) SHIPPED — 2026-06-26 — **D27 COMPLETE**
> The Hermes-style "save anything worth remembering every N turns" nudge is built + green. DECISIONS
> **D27 §C** has the spec. **A is pushed (`6e5e2f0`), B is pushed (`b47edc9`); C is committed locally,
> awaiting the owner's eyeball before push.** Backend **30 test files green**; frontend build + 85 unit
> + 32 e2e clean; live-verified (settings expose `reflection_enabled=False`/`reflection_interval=10`).
> - **What shipped.** `MemoryCfg.reflection_enabled` (off) + `reflection_interval` (10, `ge=1`).
>   `MessageRepo.count_user_messages` counts user msgs **including compacted** (compaction-stable cadence).
>   `AgentSession._maybe_arm_reflection` (from `run_turn`, after the user msg persists → every Nth turn)
>   arms a per-turn `_reflect_now`; `_assemble` injects one reflection `system` msg **after the skills
>   note**. Resume doesn't re-arm (turn-start concern); `_finalize` clears it (its tool-less wrap-up must
>   not say "use the memory tool"). The `state` clause shows only when `state_enabled`. Reflection only
>   *steers* — saves ride the normal `auto_write` path (on→saved, off→proposed), `state` auto-applies;
>   **no propose-batching** (each `memory` call already yields its own bubble — deferred UI nicety).
>   Frontend: Conf → Memory "Periodic reflection" toggle + gated "Reflection interval".
> - **Audited (independent review) + fixed before push.** (1) **One-shot (MAJOR):** the nudge was
>   re-injected every `_drive` iteration → `_assemble` now consumes `_reflect_now` on first injection
>   (one model call/turn; a weak model could otherwise re-save). (2) **Subagent scope (MINOR):**
>   `_maybe_arm_reflection` now gates on `self._depth == 0` so headless subagents don't reflect into
>   durable memory. +2 tests (`test_reflection_d27` now 9). Review confirmed count/compaction-stability,
>   gating order, `_finalize` exclusion, frontend wiring all clean.
> - **Eyeball pending (390px):** the two new Conf → Memory rows. **NEXT = emma deploy** (TODO Phase 9
>   systemd/install + Phase 10 cutover) — the memory roadmap is now fully shipped.

> ### 🟢 SESSION UPDATE — D27 Sub-slice B (`state.md`) SHIPPED + deep-audited — 2026-06-26
> The emotional-state store is built, fully green, live-verified, and **deep-audited** (independent
> adversarial reviewer + a concurrency regression test). DECISIONS **D27 §B** has the full spec + audit
> notes. Backend **29 test files green**; frontend `build` + **85 unit** + **32 e2e** clean. **Awaiting
> the owner's final OK to commit** (uncommitted as of this block; A is committed at `6e5e2f0`).
> - **What shipped.** Registry constants moved to `core/memory.py` (`STORES` + `store_by_key`) — the one
>   spine for the provider, the `memory` tool, and the memory API. `state` = AGENT/`STATE.md`/**SET**/
>   PERSONA, opt-in `state_enabled` (default off), `state_char_limit≈600`, **auto-applies** (bypasses the
>   `auto_write` propose-gate, D27 #1). `write` branches on `spec.semantics` (SET → wholesale, no
>   `§`/`_tidy`; APPEND unchanged), shared F1 cap-guard. Tool gate enforces action↔semantics + the state
>   gate. New `GET/PUT /api/agents/{name}/memory/{store}` (registry+scope-validated → 404; bare `/memory`
>   = `memory` alias; `/memory/user` = the lone GLOBAL store). Frontend Conf → Memory: "Emotional state"
>   toggle + gated "State cap" + per-agent `· state` rows. **Routing decoupled from enablement** — a
>   disabled store still resolves to its own file (never misroutes), gated only at inject + write.
> - **Audit fix (BLOCKER, folded in): `write` is now a race-free read-modify-write.** Found a
>   *pre-existing* (D26) lost-update — only the file *write* was under the backup lock, not the *read*, so
>   concurrent writers (subagents, or a write during the `reconcile()` sweep) clobbered each other. Now the
>   whole read→merge→cap-check→write→commit is one `async with backup.guard()` critical section (merge
>   pulled into a pure `_merge`). Proven by **`test_memory_concurrency_d27`** (forces the interleaving;
>   non-vacuity verified — loses an update on the old code). MINORs fixed: SET-aware cap-error wording; a
>   **drift-guard test** + an "adding a store" checklist at `STORES` (the `stores:{cap}` map stays the
>   D27-deferred seam — only 3 stores). **NEXT = Sub-slice C (periodic reflection)** — see D27 §C.

> ### 🟢 SESSION UPDATE — D27 Sub-slice A (store registry) SHIPPED — 2026-06-25
> The prerequisite refactor for `state.md`/reflection is **done + green** (DECISIONS **D27 §A**, "✅ SHIPPED").
> Kept as a **pure behavior-preserving refactor** — only `core/memory.py` + `services/agent/memory.py` touched
> (a tighter scope than D27's original §A pre-flight, which folded in `state.md` plumbing; that plumbing —
> the tool `"set"` action, `state_char_limit`, the store-keyed API route, the frontend `stateSlot` — is dead
> scaffolding until a SET store exists, so it's **deferred to B, its owning slice**).
> - **`core/memory.py`** — new pure types: `StoreScope`/`StoreSemantics`/`StorePosition` enums + a frozen
>   `StoreSpec{key,label,scope,filename,semantics,position,injected,writable,backed_up}`. Carries **every**
>   field B/C need, so they reopen this file for nothing (B = append a `state` spec + a SET branch in `write`).
> - **`services/agent/memory.py`** — `MEMORY_STORE`/`USER_STORE` consts (both APPEND/FACTS) + `_stores()`;
>   `_memory_file`/`_user_file` → one `_store_file(agent, spec)` (keyed by scope+filename); `_cap_for`/
>   `_store_enabled`; `_target` → `(path, spec)`; `load_context` iterates the registry **PERSONA-first then
>   FACTS** (stable sort preserves memory→user). `write` stays APPEND-only (both stores APPEND → identical
>   behavior); the SET branch lands in B with the first SET store. `_commit_msg` now takes the spec's filename.
> - **Safety property held:** the four prior memory suites (`test_memory_7e`/`_tool_7e`/`_panel_7e`/
>   `_git_backup_d26`, 41 tests) pass **unchanged**; new `test_memory_registry_d27.py` (5) pins the registry
>   shape + that resolution matches the old hardcoded mapping. **Full backend suite 27 files green.** Frontend
>   untouched (A is backend-only, no observable UI/API change). **NEXT = Sub-slice B (`state.md`)** — see D27 §B.

> ### 🟢 CLEAN-SESSION HANDOFF — memory hardening done (Slices 1/1b + D26) · roadmap D27 spec'd · build Sub-slice A next — 2026-06-25
> **Everything is pushed** (`origin/main` @ `aee59fb`; tree clean except the untracked `prototypes/` UI-exploration
> dir, unrelated). **Backend 26 test files green** (`./.venv/Scripts/python.exe tests/<file>.py`; pytest not
> installed). **Frontend** `npm run build` clean + **85 unit tests** + 32 e2e. Servers if you need them: backend
> **5433** (`uvicorn app.main:app --port 5433`, **no `--reload`** on Windows), frontend **5190**
> (`npm run dev -- --port 5190`). ⚠️ The first real backend boot **git-inits the live `memories/` folder** (D26's
> intended behaviour — a gitignored nested repo).
>
> **The memory subsystem as it stands (mental model for a fresh session):**
> - **Two always-injected stores** (Hermes/Letta model): per-agent `MEMORY.md` + global `USER.md`, read fresh each
>   turn by `FileMemoryProvider.load_context` and injected as a `system` message with cap-usage headers
>   (`## Agent memory (67% — …/2,200)`). Caps 2200/1375 (Hermes defaults). The agent edits via the **`memory`**
>   builtin (`add`/`replace`/`remove` of `§`-entries); the owner edits raw via Conf → Memory.
> - **Recall today** = always-inject + lexical `session_search` (FTS5). **No vector/semantic recall** (the unbuilt
>   `MemoryProvider` "both" seam + the wired-but-unused embeddings client).
> - **Hardening shipped this session** — read the F-findings in context: **Slice 1** (`ecfe762`) F1 grow-only cap
>   guard (an over-cap store could no longer be dug out — silent memory loss), F2 action-aware error, F3a orphan-`§`
>   cleanup, F5 invariant doc. **Slice 1b** (`0c70146`) **F6 unique-match** (`replace`/`remove` now require `old_text`
>   to hit exactly one place — 0→not-found, >1→"ambiguous, add context"; killed the silent wrong-entry bug, matches
>   Hermes + Claude's memory tool) + an **opt-in consolidation nudge** (default OFF; when a store ≥
>   `consolidation_nudge_pct`, `load_context` appends a "consolidate before adding" line; F10 neutral over-cap
>   wording; Conf → Memory toggle + threshold).
> - **D26 git backup** (`cd6c195`, audit-fixed `6570a1b`): all memory lives under `MemoryCfg.memory_dir` (the repo
>   root); `write`/`overwrite` are **async** — atomic write (temp+fsync+`os.replace`) then `git add`+`commit` under a
>   process-wide lock (commit captures exactly that write). Manual edits captured by a startup reconcile + 120s
>   sweep. Secrets-guard, `-c` identity, best-effort, `core.autocrlf=false` (the audit's CRLF-churn fix). `push`
>   deferred. Files: `services/agent/memory_backup.py` (`GitMemoryBackup`/`NoopBackup`).
> - **The redactor (`core/redact.py`) does NOT touch memory/state** — it masks config secrets in *captured external
>   output* (shell, `session_search` snippets, event logs); the model's curated memory is trusted + verbatim.
> - **F4 reframed (not a gap):** dedup/contradiction resolution is the **model's job by design** (Hermes confirmed —
>   it deliberately does *not* auto-consolidate memory). The only residue was the prompt nudge → shipped as 1b.
>
> **⭐ THE NEXT SLICE — D27 Sub-slice A (store registry). Fully specced + pre-flighted in DECISIONS D27; read it
> first.** The two stores are hardcoded across ~6 sites; generalize to a `StoreSpec` registry (`core/memory.py`) the
> provider reads from — **behaviour-preserving, no data migration, current tests must pass unchanged.** Then
> **Sub-slice B** = `state.md` (emotional state: one registry entry, `SET` semantics, persona-position, auto-applies,
> backed-up) and **Sub-slice C** = periodic reflection (Hermes every-10-turns "save anything worth remembering";
> turn-counter + `_assemble` nudge injection; `auto_write`-off → propose). All three opt-in, defaults off. D27 has the
> file-level pre-flight for each. **Two open build-time sub-decisions** (also in D27): the `api/agent.py` store-keyed
> route shape; reflection proposal-batching when `auto_write` is off.
>
> **Doc map:** DECISIONS **D26** (git backup, shipped) + **D27** (registry → state.md → reflection, the spec) ·
> CLAUDE.md "shape data to extend, not migrate" (why the registry is one entry per future store) · ROADMAP A3
> (scheduled automations — the tanya-style async state-evolution seam). The blocks below are shipped history.

> ### 🟢 SESSION UPDATE — Memory consolidation hardening + memory-dir git backup (D26) SHIPPED — 2026-06-25
> Two slices, both pushed (`origin/main` @ `cd6c195`). Backend **26 test files** green (new
> `test_memory_git_backup_d26.py`). Frontend untouched (D26 is backend-only; the in-UI history/restore
> surface is a recorded future seam, not built).
> - **Slice 1 — consolidation hardening (`ecfe762`).** Fixed the core robustness hole in
>   `FileMemoryProvider.write`: the over-cap guard rejected *every* over-cap result, so once a store hit
>   its cap a `remove`/shrinking-`replace` was also blocked — trapping the very edits meant to free space
>   (a weak local model would give up → memory silently lost). **F1** = grow-only cap guard (shrinks always
>   allowed, even while over cap); **F2** action-aware cap error; **F3a** `_tidy()` drops orphaned `§` bullets
>   (conservative — never mangles multi-line entries); **F5** documented the no-interleave invariant. +4 tests.
> - **Slice 2 — memory directory = auto-committed git repo (`cd6c195`, DECISIONS D26).** Every memory change
>   is versioned: `write`/`overwrite` are now **async**, each doing an atomic file write (temp+fsync+
>   `os.replace`) then `git add`+`commit` under a process-wide lock (the commit captures exactly that write).
>   The owner's **manual edits** are captured by a startup reconcile + a 120s sweep (`git status` → per-file,
>   mtime-dated commits) — dependency-free, because app writes leave the tree clean. **Configurable roots**
>   (`MemoryCfg.memory_dir` repo root + vault-relative `AgentDef.memory_dir`); all memory consolidated under
>   the memory dir (specialists migrated from `agents/<slug>/memories/` at startup). **Secrets guard** disables
>   the backup if config/db lie inside the memory dir; system `git` via `core.proc.run_capture` (no shell);
>   best-effort (a git failure never breaks a write); identity via `-c`; **push deferred** (future opt-in,
>   private remote). New `services/agent/memory_backup.py` (`GitMemoryBackup`/`NoopBackup`). Live-verified
>   under real uvicorn. **Deferred:** F4 (dedup/contradiction on `add` + auto-summarization) — folds into a
>   future structured/Obsidian-memory layer; Slice 3 (in-UI history/diff/restore, off-box push).
>
> The two-slice effort began from an audit of the memory subsystem (HANDOFF→code). Memory recall today =
> always-inject MEMORY.md/USER.md + lexical `session_search`; **no vector/semantic recall** (the unbuilt
> `MemoryProvider` "both" seam). **emma deploy is still the only remaining v1 track** (TODO Phase 9 systemd/
> install script + Phase 10 cutover).

> ### 🟢 SESSION UPDATE — D25 a11y consistency sweep SHIPPED — 2026-06-24
> The deferred sweep is **done** (DECISIONS **D25**, "Consistency sweep — SHIPPED"). All green: backend 25,
> frontend **85 unit + 32 e2e**. (1) **~40 editor inputs** across AgentsEditor/MachineEditor/ServerListEditor/
> MemoryEditor/SkillsEditor/PromptModal/the ConfTab fallback editor got a programmatic name (`aria-label`,
> or `aria-labelledby` for PromptModal — the editors use `aria-label` not native `<label for>`; the
> per-input id-pairing churn wasn't worth native's marginal click-to-focus benefit, owner's call — D25
> documents the three naming idioms). (2) New **`lib/disclosure.ts`** `disclosureToggle()` (ARIA-button
> pattern) spread onto **12** bare-div expand/collapse toggles (ConfGroup, the Agents/Machines/Servers/
> Skills/Memory/fallback rows) → all keyboard-operable; each header verified button-free first. e2e gained a
> keyboard-toggle test + a findable-by-label test. **The `disclosureToggle` helper + the DeviceRow plain-div
> pattern are the drift-guards** for future expand/collapse rows. The frontend a11y story is now complete
> (F14–F27 + D24/D25); **emma deploy is the only remaining track** (TODO Phase 9 systemd/install script +
> Phase 10 cutover).

> ### 🟢 (prior) CLEAN-SESSION HANDOFF — D25 a11y consistency sweep (the deferred half) — written 2026-06-24
> **Everything is green + pushed** (`origin/main` @ `0c75461`; tree clean except the standing
> `start_claude_remote.ps1`). **Backend 25 test files**, **frontend 85 unit + 28 e2e**. Servers:
> backend **5433** (no `--reload`, venv) · frontend **5190** (`npm run dev -- --port 5190`). e2e:
> `npm run test:e2e` (Playwright builds+previews + drives the real app; ~25s).
>
> **What just shipped (D24 + first half of D25 — read DECISIONS D24/D25 for the full rationale):**
> - **D24 — the e2e/a11y test layer.** Playwright + `@axe-core/playwright`, `e2e/*.spec.ts` (separate
>   from `tests/`), own `playwright.config.ts`, devDeps only (prod `dist/` unaffected). Mocks `/api` at
>   the browser level (`e2e/fixtures.ts` — mock applied via a **`page`-fixture override** so EVERY spec
>   gets it, incl. the a11y scans that take only `{ page }`). 14 specs × {mobile, desktop} = **28**:
>   render smoke · flows (row-body toggle, tool run, shutdown confirm/cancel, chat send, theme) · axe per
>   active panel (WCAG 2.0/2.1 A+AA, **`color-contrast` excluded** = the deliberate D7 Vapor aesthetic).
> - **D25 (gate findings, fixed).** (1) 25 unlabeled Conf inputs → shared **`Field`** got `useId` + the
>   label `id` + **`aria-labelledby`** on the input. (2) Fleet device-row **`nested-interactive`** → row
>   header is a plain **`<div onClick>`** (tap-anywhere toggles) + the **chevron is a real `<button
>   aria-expanded>`** for keyboard; both chevron + action buttons `stopPropagation`. No visual change.
>
> **⭐ THE NEXT SLICE — D25 consistency sweep (fully specced in DECISIONS D25 "Remaining consistency
> backlog"; read it first).** axe couldn't catch these (collapsed Conf groups are `display:none`; axe
> can't detect a click handler on a plain `<div>`), but they're real and the approach is settled:
>
> 1. **Editor input labels (unassociated `<label>`s).** `AgentsEditor` (~13), `MachineEditor` (~8),
>    `ServerListEditor` (~18), `MemoryEditor` (~3) render `<label>text</label><input>` **siblings with no
>    association**. Fix = native **`<label htmlFor={id}>` + `id` on the input** (free in the `.mform`
>    grids — inline-vs-block is a non-issue there, unlike `Field`'s `.confrow` block flow which is why
>    `Field` used `aria-labelledby`; **this mechanism split is deliberate — see D25**). Use `useId()`
>    (one per form, suffix the ids, or one per field). Pure a11y; **no visual change**.
> 2. **Bare-div disclosure toggles → keyboard access (WCAG 2.1.1).** `ConfGroup .conftitle`
>    (`components/ConfGroup.tsx`), `AgentRow .confrow` (`AgentsEditor.tsx:~314`), `MachineEditor`'s
>    `.svc-edit-head` + machine rows: clickable `<div>`s with **no `role`/`tabIndex`/key handler** → not
>    keyboard-operable. Fix = a **shared helper** (e.g. `lib/disclosure.ts` → `disclosureToggle(open,
>    onToggle)` returning `{ role:"button", tabIndex:0, "aria-expanded":open, onClick, onKeyDown }` with
>    Enter/Space `preventDefault`), spread onto each toggle div. **The disclosure-toggle pattern (D25):
>    ARIA-button-on-the-row EXCEPT where the row contains nested interactive controls** — DeviceRow is the
>    only nested case (it uses the `<div onClick>` + child-button approach instead; do NOT add `role=button`
>    to a row that has buttons inside it or you re-create `nested-interactive`).
>    - **⚠️ Verify each header is button-free before adding `role=button`.** `ConfGroup`/`AgentRow` headers
>      are button-free (safe). **`MachineEditor` is nested** (a machine row contains a `.svc-edit-head`
>      toggle, and the expanded bodies have remove/save buttons) — handle carefully; check the header only.
>
> **Verification for the sweep:** the a11y gate won't auto-catch these (collapsed/undetectable), so:
> (a) consider a small e2e that **tabs to a `ConfGroup` + presses Enter** to prove keyboard toggle, and/or
> an axe scan with a Conf group **expanded**; (b) eyeball that no label change shifts a `.mform` layout;
> (c) run `npm run test:e2e` (28) + `npm test` (85) + the backend suite (25) green. **One coherent pass**
> — a partial sweep leaves some toggles operable and some not (the inconsistency we're removing).
>
> **Pre-flight (read before coding, per the standing directive):** DECISIONS **D25** (the spec) · the
> touch points above (`AgentsEditor`/`MachineEditor`/`ServerListEditor`/`MemoryEditor`, `ConfGroup`,
> the `.mform`/`.confrow` label CSS) · confirm the shared `disclosure` helper's home + that each toggle
> header is button-free. Then `Field`/`DeviceRow` (already done) are the reference for the two patterns.

> ### 🟢 SESSION UPDATE — D23 external-store + Switch/Seg dedup SHIPPED — 2026-06-24
> The `createStore`/`Switch` cleanup backlog is **done** (DECISIONS **D23**, two slices, both pushed). No
> behavior change; deep-researched + independently audited before committing.
> - **Slice 1 (`590f03f`).** Ten module-singletons hand-rolled the identical external-store wiring (the 9
>   `store/*.ts` **+** `lib/audioController.ts`). Extracted to one dep-free primitive **`store/createStore.ts`**
>   `createStore() → { subscribe, emit, useStore(getSnapshot) }` — owns **no** state, imposes **no** shape:
>   each store keeps its own `let state` + (guarded) update fn calling `emit()` + its snapshot. Chosen over a
>   state-owning factory so the **chat reducer changes ~4 lines, not ~90**, and the Set/primitive/promise-bridge/
>   DOM-singleton stores keep their natural shapes. **`store/persist.ts`** (`loadPersisted`/`savePersisted`)
>   folds the 3 persisted stores' load/save try-catch. **Build-vs-buy researched** (web-sourced): dep-free over
>   Zustand for this near-complete single-user PWA; migrating to Zustand later stays low-risk. Tests **65** (+8
>   for the primitives); independent line-by-line diff audit found **zero regressions**.
> - **Slice 2 (`<this commit>`).** Extracted the byte-identical **`Switch`** (×4) + the generic
>   **`Seg<T extends string>`** (×3; covers `ServerListEditor`'s string usage) into shared
>   `components/Switch.tsx` + `components/Seg.tsx`. `ModeSeg` (the richer tri-state) stays separate.
> - **Verified:** `tsc -b` (noUnusedLocals) + `vite build` clean; **65/65** tests; owner verified the live UI.
>
> **Next:** the v2 backlog is essentially clear — **emma (Linux) deploy / v1 cutover** is the remaining big
> track. Deferred polish: ROADMAP E2 OpenAI `/v1/chat/completions` facade, UI_AUDIT §6c (F14–F26 a11y/resilience),
> F9 `useTransition` / F13 React Compiler (measure first). Owner's stated near-term additions: minor chat/agent
> work + a dynamic-themes pass (the `ui` store + `applyBodyAttrs`/CSS-var path is ready for both — D23 verified).

> ### 🟢 SESSION UPDATE — Phase 8b reviewed + finalized (D22) — 2026-06-24
> Owner eyeballed at 390px (approved after two polish rounds — see below) and an independent code review
> ran over the full diff. **All four D22 invariants verified correct.** One real bug + two hardening fixes
> landed before commit:
> - **Bug (legacy-fold guard).** `_fold_legacy_tool_descriptions` guarded on falsiness (`if not
>   existing.get("description")`), so an explicit `description: ""` (the catalog's restore-to-built-in)
>   coexisting with a lingering on-disk `tool_descriptions` key got **re-reverted to the legacy text on the
>   next load**. Fixed → guard on `is None` (an explicit blank now wins). Covered by
>   `test_explicit_blank_override_beats_lingering_legacy`.
> - **Hardening.** (a) The catalog's change-detection now compares the **trimmed** draft description, so a
>   whitespace-only edit no longer writes a redundant override equal to the default (matches `UtilCard`).
>   (b) `rediscover_integrations` now drops the captured originals for the remote (`mcp`-category) tools it
>   removes, so re-discovered specs are re-captured at their *current* server-side defaults (a latent
>   staleness inherited from the 7d overlay).
> - **Accepted nuance (not a bug):** clearing an override persists an inert `{…: null}` entry in
>   `tool_overrides` (deep_merge can't delete a map key) — harmless cruft; the UI reads the actions DTO and
>   `apply_tool_overrides` maps `None`→default. Matches the 7d precedent + CLAUDE.md "shape to extend".
>
> **Final verification:** backend `test_tool_overrides_8b.py` **13** + full suite **25/25 files**; frontend
> `tsc -b` + `vite build` clean, **57/57**. The detail of the build is in the original session block below.
>
> **Follow-up — the two-section model clarified (owner).** **Section A = run cards = tools BOTH the user
> and the agent can use** (utility + `ui_exposed`); **Section B = tools ONLY the agent can use** (everything
> else; a future plan adds user-run functionality for these too). Landed:
> - Each run card has a **compact tri-state inline on the title row** (not a separate row) writing the same
>   `tool_overrides[name].agent_mode` (immediate-save). The `ModeSeg` control was **extracted to
>   `components/ModeSeg.tsx`** (shared by the catalog + cards; gained a `small` variant).
> - **Section B excludes the Section-A run cards** (`category=="utility" && ui_exposed`) so they're not
>   duplicated — Section B is the agent-only set (actions/builtins/mcp + agent-only utilities like web_search).
> - **Invariant (owner-confirmed):** the agent-access toggle governs the **agent only** — `apply_tool_overrides`
>   flips `agent_exposed`, never `ui_exposed`, and `GET/POST /api/tools` guard on `ui_exposed`, so a utility
>   set to **disabled** is still listed + **user-runnable** from its card. Locked by
>   `test_disabled_utility_still_user_runnable`.
> - Backend: extracted **`runtime.spec_dto`** (DTO + `default_agent_mode`) shared by `GET /api/actions` *and*
>   `GET /api/tools` so the cards get the default for "pick-default = reset".
>
> `test_tool_overrides_8b.py` now **15**; backend suite **25/25**, frontend `tsc`+build clean, **57/57**;
> `/api/tools` live-verified (`default_agent_mode=enabled`). Owner-eyeballed at 390px (inline toggle + spacing).
>
> ### 🟢 SESSION UPDATE — Phase 8b tool manage layer BUILT (D22) — 2026-06-24 (uncommitted)
> **8b is built + verified except the 390px eyeball.** The Tools tab gained **Section B — the agent-tool
> catalog**: every agent tool gets a per-tool **description override** + a **tri-state agent-access mode**
> (core / enabled / disabled), written to the unified **`tool_overrides`** map. Per-agent tool *selection*
> stays in Conf → Agents; the two compose (the AgentsEditor tick-grid now locks core on / disabled off).
>
> **What shipped:**
> - **Backend.** `config.py` `ToolOverride{description?, agent_mode?}` + `tool_overrides: dict[str,ToolOverride]`
>   replacing `tool_descriptions`, with a `@model_validator(before)` that folds the legacy key in (zero-touch;
>   live config had no `tool_descriptions` key so it's a no-op there). `runtime.apply_tool_overrides`
>   (renamed from `apply_tool_descriptions`) captures originals of `(description, agent_exposed, core)` on
>   `app.state.tool_spec_orig` and overlays description **+** `agent_mode → (agent_exposed, core)`
>   (core→T,T · enabled→T,F · disabled→F,F · absent→restore). Shared `agent_mode_of(exposed,core)` helper;
>   `api/actions` DTO gains `default_agent_mode` (from the captured originals, so a live-overridden tool
>   still reports its default). 3 call sites + reconfigure `_changed` key updated. **No registry-logic
>   change** — `for_agent`/`agent_tools` already read those fields (the single seam is `session._tools()`).
> - **Frontend.** New `components/ToolCatalog.tsx` — grouped, risk-sorted rows with a tri-state vapor `.seg`
>   + a click-to-edit description (reuses `requestPrompt`). **Current state is reconstructed entirely from
>   the actions DTO** (`agentModeOf(spec)` mirrors the backend; `default_agent_mode` marks the default with
>   a dot; `description` is the effective text) — no `useSettings` (it's Conf-scoped and wouldn't fetch on
>   the Tools tab); a save PUTs only the changed axis per tool (deep_merge keeps the other) and invalidates
>   `["actions"]`. `run_shell` renders **read-only** (governed by Conf → Shell). Catalog filters to tools
>   whose *default* mode ≠ disabled (so `tailscale_*` USER-only actions stay out; a user-disabled tool stays
>   visible to re-enable). `UtilsTab` adds Section B; `ToolDescriptionsEditor` **deleted**, Conf #14 left as
>   a pointer; `AgentsEditor` `TickGrid` takes `toolModes` and locks core/disabled. `agentModeOf` lives in
>   `hooks/useActions.ts` (shared by catalog + ConfTab, no drift). Net-new CSS in `extras.css`; **vapor.css
>   untouched (D7)**.
> - **Verified.** `test_tool_overrides_8b.py` **11** (replaces `test_tool_descriptions_7d.py`, retired —
>   its PUT round-trip + legacy paths folded in). Backend suite **25/25 files**. Frontend `tsc -b` + `vite
>   build` clean, **57/57** tests. **LIVE on 5433:** `/api/actions` shows `default_agent_mode` correct
>   (task_plan/memory/session_search=core · wake/ping/run_shell=enabled · tailscale=disabled). Servers up:
>   backend **5433**, frontend **5190**. **NOT yet eyeballed at 390px** (the one thing tests don't cover —
>   the catalog rows, the tri-state seg, the AgentsEditor lock states). Did **not** live-PUT against the real
>   `config.yaml` (temp-config PUT is covered by the test).
>
> **Theme polish (post-eyeball #1).** Owner reviewed at 390px → three fixes: (1) the in-card save bar was
> flush/edge-to-edge — the catalog root is now a vapor **`.conf-card`** so `.conf-card > .conf-savebar`
> applies its standard inset (matches the other editors); (2) the section header showed a stray **"B"** —
> Section B is now a **collapsible numbered `ConfGroup`** ("04 agent tools", default-collapsed); (3) the
> section is collapsible like the Conf groups. To avoid duplication, **`ConfGroup` was extracted from
> ConfTab into `components/ConfGroup.tsx`** and reused by both ConfTab and UtilsTab (one disclosure/collapse
> source). `tsc`+build clean, 57/57. **Re-eyeball pending.**
>
> **Polish #2 — editable descriptions on the run cards.** The Section-A utility cards (yt/ip/dns) showed a
> static description; they're now **click-to-edit** (pencil affordance), writing the same
> `tool_overrides[name].description` the Section-B catalog manages. Extracted a shared
> **`hooks/useToolOverrides.ts`** (`useSaveToolOverrides`) used by both `UtilCard` (single-tool) and
> `ToolCatalog` (batched) — one save path that invalidates **`["tools"]` + `["actions"]` + `["settings"]`**
> (the catalog previously missed `["tools"]`, so a utility's description edited there now updates its card
> too). `tsc`+build clean, 57/57.
>
> **Next:** owner eyeball at 390px → then commit + push (tree currently has the 8b changes + the standing
> `start_claude_remote.ps1`). After that: the `createStore<T>()` / `Switch` dedup backlog slices → emma deploy.
>
> ---
>
> ### 🟢 (prior) CLEAN-SESSION HANDOFF — start Phase 8b (tool manage layer, D8/D22) — written 2026-06-24
> **Phase 8a is shipped + pushed** (HEAD `a339d6a`, `origin/main` in sync, tree clean except the standing
> `start_claude_remote.ps1`). The **Utils tab is now the "Tools" tab**: a live `@tool` registry with three
> utility cards (yt_captions / ip_info / dns_trace) the owner runs directly and the agent can call. Backend
> suite **25/25**, frontend **57/57**. **Servers:** backend uvicorn **5433** (no `--reload`, venv) ·
> frontend Vite **5190** (`npm run dev -- --port 5190`). Tests: `./.venv/Scripts/python.exe tests/<file>.py`
> (pytest not installed) · `npm test` (frontend). On Windows, restart the backend with the kill-by-port
> PowerShell one-liner + a non-`&` `run_in_background` launch (a stray `&` makes the shell exit early).
>
> **Phase 8a recap (what's already built — `ef569af` + `a339d6a`):**
> - `core/tool.py` **`@tool`** = thin sugar over `@action` (presets `category="utility"` + `ui_exposed=True`).
> - `services/tools/{yt_captions,ip_info,dns_trace}.py` — flat input models, blocking I/O via
>   `asyncio.to_thread`. **yt** puts the transcript *text* in `output` (bounded `_AGENT_OUTPUT_CAP=8000`,
>   the model reads summary+output, never `data`) and the full structured transcript in
>   `data.download={filename,content}` (UI-only). **ip_info** = net-new ip-api.com lookup (free, plaintext
>   HTTP, blank→own public IP). **dns_trace** = dep-free getaddrinfo + reverse PTR.
> - `api/tools.py` — `GET /api/tools` (utility cards only) + `POST /api/tools/{name}`, a **category-guarded
>   facade** over `ActionService.invoke` (USER, audited; 404s on non-utility/agent-only names). No 2nd exec path.
> - `services/action_service.py` — enforces **`ToolSpec.timeout_s`** (default `None` = unbounded, so an
>   uncapped tool can never be cut off; generous per-tool: dns 20s, yt 60s, ip relies on its httpx 10s).
>   `wait_for` gives up *waiting*, does NOT kill the worker thread (documented). TimeoutError → clean TIMEOUT.
> - Frontend: `hooks/useTools.ts`, generic `components/UtilCard.tsx` (schema→form, no per-tool code,
>   client-side Blob download), `tabs/UtilsTab.tsx` (maps the registry), `TabBar` relabeled "tools".
>   Results use vapor's `.kv`/`.download`; the **owner-directed default-font override** for `.util` text is
>   in `extras.css` (vapor.css untouched, D7). **Card order = registration order = yt → ip → dns.**
> - Tests `test_tools_8.py` (12). **Owner eyeballed + approved 8a at 390px.**
>
> **What Phase 8b is — the manage layer (full file-level plan; all decisions locked in DECISIONS D22):**
> The Tools tab gets a **Section B "agent tools" catalog** below the run cards. It manages every agent tool
> via **one unified `tool_overrides` object** (Option B — NOT sibling maps; research-backed, see D22) and a
> **tri-state agent-access mode (core / enabled / disabled)**. **Per-agent tool selection STAYS in
> AgentsEditor** (different axis); the two layers compose visually. Build:
>
> *Backend:*
> 1. **`config.py`** — `class ToolOverride(BaseModel){ description: str|None=None; agent_mode:
>    Literal["core","enabled","disabled"]|None=None }` (a future `settings` field is purely additive — E0a).
>    Replace `tool_descriptions: dict[str,str]` → **`tool_overrides: dict[str, ToolOverride]`**. Add a
>    `@model_validator(mode="before")` that folds any legacy `tool_descriptions[name]` into
>    `tool_overrides[name].description` (don't clobber an explicit one) then drops it — zero-touch migration
>    (verify the live config first; it's ~empty).
> 2. **`runtime.py`** — rename `apply_tool_descriptions` → **`apply_tool_overrides`**: capture originals of
>    `(description, agent_exposed, core)` on `app.state.tool_spec_orig`; apply description (as today) **and**
>    map `agent_mode` → `(agent_exposed, core)`: **core**→`(T,T)` · **enabled**→`(T,F)` · **disabled**→`(F,F)`
>    · **absent**→restore originals. `for_agent`/`agent_tools` already read those fields → no registry-logic
>    change. Update the 3 call sites (lifespan/reconfigure/rediscover) + reconfigure's changed-key check.
> 3. **`api/actions.py` `list_actions`** — enrich each DTO with **`default_agent_mode`** (from
>    `tool_spec_orig`) so the catalog marks defaults, stores only deviations, and offers reset. Add a shared
>    `agent_mode_of(exposed, core)` helper (runtime + api). `spec_to_dict` already returns `agent_exposed`+`core`.
> 4. **Tests `test_tool_overrides_8b.py`** — legacy→unified migration; overlay truth table; `for_agent`
>    (core survives empty allowlist + skill narrowing, disabled removed from `agent_tools`);
>    `default_agent_mode` DTO; clear→restores built-in; `run_shell` still governed by its `decide` gate.
>
> *Frontend:*
> 5. **`types.ts`** — `AgentMode`, `ToolOverride`; extend `ActionSpec` with `core: boolean` + `default_agent_mode?`.
> 6. **`components/ToolCatalog.tsx` (new)** — reuses `useActions()`; grouped by category; each row = title +
>    category/risk badges + a **tri-state `.seg`** (vapor segmented control) + an inline **description
>    override** (reuse the `PromptModal` opener pattern from `ToolDescriptionsEditor`). Writes `tool_overrides`
>    via `useSaveSettings`/`PUT /api/settings`. **Special cases:** `core`-default marked "(default)" (pick-default
>    clears the override); **`run_shell`** read-only → link to Conf → Shell (its `decide(shell.agent_exec_enabled)`
>    gate governs — no lying toggle); **MCP/OpenAPI** tri-state works but sits under the per-server enable (stale
>    overrides ignored; rediscover re-applies the overlay).
> 7. **`tabs/UtilsTab.tsx`** — add Section B under the run cards with a `.sec` divider ("agent tools · access & descriptions").
> 8. **Retire `ToolDescriptionsEditor`** — remove the Conf → Agent tools group from `ConfTab.tsx` (descriptions
>    now per-row in the catalog); leave a one-line "managed in Tools tab" pointer.
> 9. **`AgentsEditor.tsx` `TickGrid` mirror** — pass per-tool effective mode (from `useActions`): **disabled**→
>    locked-off (greyed) · **core**→locked-on (ticked, non-toggle) · **enabled**→interactive.
>
> **Pre-flight touch points (read before coding):** `config.py` (`tool_descriptions` + the settings PUT
> deep-merge), `runtime.py` `apply_tool_descriptions` (+ its 3 call sites + `_changed`), `api/actions.py`
> `list_actions`/`spec_to_dict`, `core/tool.py` (`ToolSpec.core`/`agent_exposed`, `for_agent`), `frontend
> src/hooks/useActions.ts`, `components/ToolDescriptionsEditor.tsx` (retire), `components/AgentsEditor.tsx`
> (`TickGrid`), `tabs/UtilsTab.tsx`. Confirm the design per the standing pre-flight directive before building.
>
> **Semantics to keep straight (DECISIONS D22):** **core bypasses BOTH the per-agent allowlist AND skill
> narrowing** — demoting a default-core tool (e.g. `session_search`) to `enabled` means specialists with
> explicit `tools` lists lose it unless they list it (the owner's intended trade). **Membership ≠ privilege:**
> the tri-state controls *availability only*; `risk`/`confirm`/`decide()` still gate execution independently
> (a `core` HIGH tool is always available but still confirms).
>
> **Deferred (don't build unless asked):** bool/enum form widgets in `UtilCard` (text-input + Pydantic
> coercion works as interim; build + test with the first tool that needs one) · per-tool **settings**
> (ROADMAP E0a — additive `settings` field on `ToolOverride`, typed as a Pydantic v2 discriminated union per
> tool, rendered by the same schema→form path; do NOT re-introduce sibling maps).
>
> **Doc map:** TODO Phase 8 (8a done, 8b slice) · DECISIONS **D8** (registry) + **D22** (Tools-tab manage
> layer — the locked 8b decisions) · ROADMAP **E0a** (per-tool settings future) · CLAUDE.md hard rule "shape
> data/config to extend, not migrate" · VAPOR_PATTERNS (the `.util` card). Session blocks below = shipped history.

> ### ⭐ Session update — 2026-06-22 (build session #12 cont. — **D18 inference failover** · committed `657ba19`, unpushed)
> The core chat path now has failover (voice already did). A request whose selected endpoint fails walks
> an ordered chain — `[selected, other-of-local/cloud, *inference.fallbacks]` (deduped, blanks dropped,
> gated by `inference.failover` default-on) — reusing `core/failover.py`, **fully encapsulated in
> `InferenceClient`** (the agent loop is unchanged, like `VoiceClient` hides failover from `api/voice`).
> Research-validated (LiteLLM/LangChain priority-fallback + **stream-start failover**: open the stream +
> pull the first chunk per endpoint; the first that yields a chunk wins; **no mid-stream failover** — a
> partial reply can't be restarted). Model override (`ModelRef.model`) applies to the **selected endpoint
> only**; fallbacks use their own model. A `StreamReport` surfaces degradation → `session.py` emits a
> `notice` breadcrumb (`// inference failover → cloud`); the frontend renders it as a sys note (safely
> ignored by the buffered `collect_turn` path). Conf → Inference has a Failover toggle; `fallbacks[]`
> round-trips opaquely (deep_merge) — the list UI editor + a circuit breaker are deferred (design-compatible).
> Also fixed a pre-existing `test_voice_6a` regression (6b-3's `stt_auto_send` shape). **Verified:**
> `test_inference_failover_d18` (8); full backend suite (24 files); frontend 57; **LIVE** dead-cloud → real
> local served "pong" (degraded), dead-local → cloud-429 → aggregated error. Full design in **D18**.
>
> **Fallbacks-list UI editor + audit fixes (`30af624`):** Conf → Inference now has an inline fallbacks
> editor (`inference.fallbacks` add/remove/edit, saved by the Inference saveBar). A pre-build deep audit
> caught + fixed **two bugs**: `endpoint_chain` failover-off + blank-selected silently routed to the other
> (now strictly the selected); `unmask_secrets` matched secret lists by index → removing a non-last
> fallback clobbered the others' api_keys → now matches by stable identity (base_url/url/name), surviving
> reorder/remove. Suite: backend 24/24 (`test_inference_failover_d18` now 11), frontend 57. **Editor
> eyeball at 390px pending.**

> ### ⭐ Session update — 2026-06-22 (build session #12 cont. — **frontend tests Tier-2** · committed `09fdf8b`, unpushed)
> Finished the logic net: **56 tests / 9 files** now (`npm test`). Tier-2 (`09fdf8b`, 22): `lib/privilege`,
> `store/composer`, `store/ui` (incl. selector-isolation), `lib/markdown` (parser→DOM + the `javascript:`
> XSS guard), `hooks/useDictation` (the mic state machine over fakes — fill/auto-send/502-unavailable/
> insecure-context). Test-only → production bundle still byte-identical, `tsc -b` clean. Full design in
> **D21**. Component/a11y/pixel tests stay Phase 9 (F24). **Next: the D18 LLM inference fallback chain** —
> the core chat path currently has no failover (voice does); the new chat-reducer tests are the safety net
> under that rework. Then **emma deploy / v1 cutover**.

> ### ⭐ Session update — 2026-06-22 (build session #12 cont. — **frontend test foundation (D21)** · committed `33ae459`, unpushed)
> Owner chose to harden before the emma deploy. Analysis: backend had 23 test files, frontend had **zero**
> despite holding the most intricate logic. Built a **Vitest** foundation (research-backed: vitest + jsdom +
> @testing-library/react, all devDeps), **fully isolated from production** — proven: the prod bundle is
> **byte-identical** before/after (all 4 asset sha256 match a captured baseline), `tsc -b` + `vite build`
> clean, tests live in `tests/` (outside `src`, separate `vitest.config.ts`, test tsconfig not referenced by
> root). **Philosophy = backend-style: test the logic, eyeball the pixels** (no component/pixel tests — Phase
> 9 / F24). **27 tests / 4 files:** `toSpeech` (6), `composer` routing (9), `chat` streaming reducer (5, via a
> `mockSSE` fetch through the real `sendMessage`/`resumeCall` — covers confirm-suspend + resume), `audioController`
> (7, fake `<audio>`). Non-vacuity proven by a mutation→red→revert. Full design + conventions in **DECISIONS D21**.
> Scripts: `npm test` / `npm run test:watch`. **Tier 2 next:** `useDictation`, `store/composer`+`store/ui`,
> `lib/privilege`, `lib/markdown`. Then the **D18 inference fallback** (the test net de-risks that rework), then emma.

> ### ⭐ Session update — 2026-06-22 (build session #12 cont. — **6c-2: in-app HTTPS control built**)
> Built the Conf → Access HTTPS toggle (DECISIONS D20) end-to-end. **Backend `7e3dfe3`** + **frontend
> `56e87a4`** (both **unpushed** as of this note). Pre-flighted the real `tailscale serve status --json`
> schema on the host first (it varies by version). What landed:
> - **`core/proc.py run_capture()`** — shared subprocess-capture core; **`shell.py._run` refactored onto
>   it** (no dup; `test_shell_5` still 10/10). The tailscale actions exec the `tailscale` **binary directly
>   with argv** (no shell → no injection), unlike `run_shell`.
> - **`services/actions/tailscale.py`** — `resolve_status()` (live read: available/serving/url/reason,
>   parsed from `tailscale status --json` + `serve status --json`, binary PATH-resolved + fallbacks) +
>   audited `tailscale_serve_enable`/`disable` MED actions (`ui_exposed=False`, `agent_exposed=False` —
>   USER-only via the endpoint). **`serve` only, funnel never constructed** (no-public-bind intact).
> - **`api/access.py`** — `GET /access/status` (always-on read; tailscaled = source of truth, no stored
>   on/off → no drift) + `POST /access/serve {enable}` (invokes the action at USER/FULL → audited Event).
> - **`config.py TailscaleCfg`** (`tailscale`): `target_port=5173`, `enabled`, `timeout_s`.
> - **Frontend** — `hooks/useAccess.ts` + a `TailscaleAccessCard` in the **Server** conf group (no
>   renumbering): live Enable/Disable toggle + status + URL + copy; degrades to a hint when the CLI is
>   unavailable. `.conf-url`/`.conf-copy` in extras.css; **vapor.css untouched (D7)**.
> - **Verified:** `tsc -b` + `vite build` clean; backend restarted on 5433 + **live-verified against the
>   active Serve** (`/access/status` → `serving:true, url:https://corsair.lobster-vector.ts.net`;
>   idempotent enable → ok, didn't disrupt the phone); `test_tailscale_6c2.py` (5, parsing edge cases).
>   **Eyeball the panel at 390px pending** (owner).
>
> **The one remaining D20 piece — QR-to-phone:** a server-rendered QR SVG (`GET /access/qr.svg`) via
> **`segno`** (zero-dep pure-Python), so the panel `<img>`s it. **Deferred pending the owner's OK on the
> `segno` backend dep.** Everything else of 6c-2 is done.

> ### ⭐ Session update — 2026-06-22 (build session #12 cont. — **6b-3: mic auto-send setting**)
> Owner clarification → small follow-up. **Auto-play of TTS stays the AppBar toggle (unchanged, owner's
> call).** Added a **mic auto-send setting, default off**: off → fill the composer for review (prior
> behavior); on → send the transcript immediately. **Backend:** `SttServiceCfg.auto_send: bool = False`;
> exposed to the always-on mic via `GET /voice/status` → `stt_auto_send` (the Conf settings query is
> tab-scoped, so the mic reads it from status, not settings — a Conf save invalidates `["voice-status"]`,
> wired in 6b-1). **Frontend:** Conf → Voice · STT "Auto-send" Switch; `useDictation` routes the transcript
> through `runComposer` (like a typed+sent message) when on, **guarded against firing into a streaming turn**
> (would be dropped — left in the composer instead). `getDraft()`/`getChatStatus()` imperative getters added.
> Live-verified: `/voice/status` → `{stt,tts,stt_auto_send:false}`, `/api/settings` round-trips
> `voice.stt.auto_send`. `tsc -b` clean. Backend restarted on 5433. **Eyeball pending** (needs a browser).
>
> **Player restyle (`0c24a44`):** owner feedback — the mini-player play button is now the accent-gradient
> icon (like the mic, masked, no disc), and the player **floats as a frosted pill just below the appbar**
> (fixed, centered, not full-width), not a bottom bar. CSS-only; vapor.css untouched (D7).
>
> **STT-latency audit (measured, no code change):** felt-slow STT is **not our code** — warm STT ≈0.6s and
> our backend overhead ≈0 (0.63s via backend vs 0.63s direct to Speaches). The lag is the **whisper model
> cold-reloading after idle (~3s)**; fix is **server-side: keep the Speaches model warm** (model TTL /
> preload). `vad_filter`+`language=en` are already optimal (faster than minimal). **Recommend the owner set
> the Speaches model TTL** — independent of any app change.
>
> **D19 — voice streaming transports DESIGNED (not built):** owner asked for live-dictation STT + progressive
> TTS as a real integrated pattern. Logged as **D19** (DECISIONS) + ROADMAP C1 revision: each voice service
> has a reliable buffered transport (shipped) + an optional streaming transport layered as a *fast-path that
> degrades to buffered* (preserves D18 failover). STT = Speaches `/v1/realtime` WS proxy + a `useDictation`
> extension (verified your model is supported); TTS = a 2nd source strategy (MSE) on the `audioController`
> singleton. Reuses D17's `auto|on|off`, the proxy invariant, and the 6b hook/singleton — no parallel code.
> **Post-v1 polish, deferred.** This revises the old "STT always buffered" stance.
>
> **6c-1 — Tailscale Serve HTTPS ✅ DONE + owner-verified on the phone.** [`HTTPS_TAILSCALE.md`](./HTTPS_TAILSCALE.md).
> `tailscale serve --bg 5173` (ran **non-elevated** on Windows for the admin user) → real TLS cert at the
> device's `*.ts.net` name (tailnet-only) → the owner confirmed the full voice UX works over HTTPS on
> Android. Coexists with the plain HTTP/Firefox-flag path. No app change (`vite.config.ts` already had
> `allowedHosts: true`). **6c-2 — DESIGNED (D20), build next:** an in-app **Conf → Access** panel (status +
> URL + **server-rendered QR** + Enable/Disable toggle) over typed host-actions (`services/actions/tailscale.py`,
> reusing the `run_shell` exec core; **`serve` only, never `funnel`**), an always-on `/api/access/status`
> (tailscaled = source of truth), and `TailscaleCfg` desired-state. Reuses the action chokepoint + the
> `/voice/status` pattern + the 7c panel UX; only new dep is a tiny server-side QR lib (`segno`). Viable on
> both OSes. **Pre-flight the `serve status --json` schema before coding.**

> ### ⭐ Session update — 2026-06-22 (build session #12 — **Phase 6b-2: TTS mini-player + auto read-aloud** · committed `8105d2c`(6b-1)+next, NOT pushed)
> Built 6b-2 straight after 6b-1 (owner: "commit and keep going"). The architecture was pre-agreed (DOM-backed
> singleton controller, no `store/voice.ts`); owner refined the player spec to **minimal** (drop skip ±10s +
> speed; remaining-time only). Self-audited (found+fixed 3 controller race/lifecycle bugs), `tsc -b` + `vite
> build` clean. **Phone eyeball pending** (audio + scrubbing need a real browser; can't verify headless).
>
> **What shipped (6b-2, frontend only — same 6a voice API contract):**
> - **`lib/audioController.ts`** (new) — the shared singleton: one `<audio>`, reactive `{id,status,current,
>   duration}` mirrored from native media events, per-message blob cache (synth once, `clearAudioCache()` on
>   `/clear`), `toggle`/`togglePlay`/`seekFraction`/`dismiss`, a `usePlayback(selector)` hook (mirrors
>   `useUISlice` — per-bubble buttons select only their own status, so the ~4×/sec `timeupdate` only re-renders
>   the player). 502 → "voice servers unreachable" toast. **Fixed in audit:** pause-on-switch (old clip kept
>   playing during the new synth), guarded the pause handler (async pause clobbered `loading`), and
>   `reqSeq`-bump in `reset()` (dismiss-during-load could still start playing).
> - **`lib/toSpeech.ts`** (new) — markdown→prose strip so TTS reads words, not syntax.
> - **`components/MiniPlayer.tsx`** (new) — docked bar (play/pause · range seek · `-M:SS` remaining · ✕),
>   rendered in `App.tsx` above the composer, self-hides when nothing's docked.
> - **`hooks/useAutoTts.ts`** (new) — speaks the latest completed reply on the streaming→idle transition,
>   gated by `ttsAuto` + `tts` configured. Scans only the latest assistant turn (no stale/historical replay).
>   **Buffered-mode (D17) auto-TTS is a documented best-effort gap** (the reply lands via reloadChat *after*
>   the transition) — the manual per-bubble toggle always works; streaming (the PWA default) auto-plays.
> - **`tabs/AgentTab.tsx`** — per-bubble `TtsButton` in the bot who-line (play↔pause), gated on `tts:true`,
>   only on a settled text reply; calls `useAutoTts()`.
> - **`components/AppBar.tsx`** — auto-TTS button hidden when TTS unconfigured; muting it stops playback
>   (replaced the dead `window.speechSynthesis.cancel()` — we own TTS now).
> - **`theme/extras.css`** — ~118 lines, all vapor tokens (adapts dark/aqua/ember). **vapor.css untouched (D7).**
>
> **Start here next: 6c** — HTTPS via Tailscale Serve (unblocks the mic + TTS on Android) + a real phone verify
> of the whole 6b voice UX. Also queued: the **LLM inference fallback chain** (D18 follow-up, reuses
> `core/failover.py`) and the **`createStore<T>()` factory dedup** backlog slice. **Push 6b when the owner OKs.**

> ### ⭐ Session update — 2026-06-22 (build session #12 — **Phase 6b-1: mic dictation + 4-state machine** · committed `8105d2c`, NOT pushed)
> Sub-sliced 6b into **6b-1 (mic STT) → 6b-2 (TTS mini-player)** with the owner. Cold pre-flighted every
> touch point (Composer stub, chat store, AgentTab bubbles, AppBar `ttsAuto`, ui store, `api/voice.py` +
> `adapters/voice.py`), researched the state-architecture question (owner flagged the duplication risk),
> built 6b-1, self-audited, tested headlessly, updated docs.
>
> **Design decision locked with the owner (records the seam for 6b-2 + a backlog item):** recording state
> is read by one place (the Composer mic), so it's a **custom hook (`useDictation`), not a store** — no
> duplication of the chat/ui store plumbing. TTS *playback* in 6b-2 IS genuinely shared (per-bubble players
> + the chat reducer's auto-play + the AppBar toggle), so it gets a **DOM-backed singleton audio controller**
> subscribed via `useSyncExternalStore` — structurally unlike `chat.ts`, not a near-duplicate. **Backlog
> (owner wants it, own slice):** `ui.ts`/`chat.ts`/`composer.ts` all hand-roll the same external-store
> boilerplate → extract a shared `createStore<T>()` factory. The owner explicitly values robust, well-patterned
> architecture as a first-class goal.
>
> **What shipped (6b-1, frontend only — no backend change; the 6a voice API is the contract):**
> - **`hooks/useVoiceStatus.ts`** (new) — TanStack `useQuery` over `GET /api/voice/status` → `{stt,tts}`.
>   Always-on (composer is on Fleet/Agent). `useSaveSettings` now invalidates `["voice-status"]` so a Conf
>   Voice edit flips mic/TTS availability without a reload.
> - **`hooks/useDictation.ts`** (new) — tap-to-start/tap-to-stop recorder. `getUserMedia → MediaRecorder →`
>   on stop POST the clip to `/voice/stt` → `appendDraft(transcript)`. mimeType↔filename-ext agreement from
>   the recorder's **actual** `mimeType` (`extFromMime`). 4-state machine via `status`: idle · recording ·
>   sending · unavailable. 502 (whole chain failed) → reactive `unavailable`; secure-context + permission
>   denied get distinct toasts (NOT marked unavailable); re-arms on the next status probe.
> - **`store/composer.ts`** — added `appendDraft(text)` (imperative, space-joins onto the current draft).
> - **`components/Composer.tsx`** — dropped `useState(rec)`; mic renders only when `stt:true`, driven by the
>   recorder's real phase. `.rec` (recording) / `.unavail` (unreachable) classes.
> - **`theme/extras.css`** — one rule `.composer .mic.unavail` (muted bg + dimmed + inert). **vapor.css
>   untouched (D7).**
>
> **Verified:** `tsc -b --noEmit` clean. Backend 5433 + frontend 5173 up (HMR'd). `GET /api/voice/status` →
> `{"stt":true,"tts":true}` (mic renders). **Live TTS→STT round-trip:** synth "Wake up the vault server
> please." → mp3 (served-by primary) → STT → "Waking up the vault server, please" (HTTP 200, multipart,
> filename-routed) — the exact path the hook drives. Empty clip → **422** (not 502), confirming an empty tap
> won't grey the mic. **Not yet eyeballed at 390px** (needs a secure context — `getUserMedia` is blocked over
> plain `http://corsair:5173`; works on `localhost`, phone waits on 6c).
>
> **Start here next: build 6b-2** — the DOM-backed singleton audio controller (`lib/audioController.ts`),
> the per-bubble `MiniPlayer` in AgentTab, auto-TTS off the chat store's `done` transition gated by `ttsAuto`,
> per-message blob cache. Pre-flight is mostly done (touch points above); the new design is the controller shape.


> ### ⭐ Session update — 2026-06-22 (build session #11 — **Phase 6a voice: backend + failover (D18) + Conf forms** · ALL PUSHED `9844a43`)
> **Everything is pushed to `origin/main`** (`main` in sync; HEAD `9844a43`). Four commits this session:
> `2b08fde` (voice backend + failover) · `f3470e0` (STT params) · `a413e28` (Conf Voice forms) · `9844a43`
> (audit: timeout floor). Tree clean except the standing `start_claude_remote.ps1` + the gitignored `config.yaml`.
>
> **Phase 6a is done** — the voice subsystem (STT + TTS) is a working OpenAI-compatible proxy with a
> primary→fallback chain, configurable in the Conf tab, **live-verified against the real servers**. The
> visible UI lands in **6b** (mic + the scrubbable mini-player); 6a-2 only added the *settings* forms.
>
> **What shipped + key facts a fresh session needs:**
> - **`core/failover.py` (D18)** — generic, value-agnostic failover primitive. **The LLM inference fallback
>   chain is the queued next-after-voice slice and reuses it unchanged** (its own pre-flight over
>   `inference.local/cloud + default_mode + /local`//`/cloud` + per-agent `ModelRef`).
> - **Backend** — `adapters/voice.py` `VoiceClient` (transcribe/synthesize full-clip + `configured`/`status`),
>   `api/voice.py` (`POST /voice/stt`→`{text}` · `POST /voice/tts`→full audio+`X-Voice-Served-By` · `GET
>   /voice/status` probe; 502 all-fail / 503 unconfigured / 422 empty), `runtime.set_voice` (hot-apply via
>   `reconfigure`; `app.state.voice` only). `config.py` `voice{enabled, stt:SttServiceCfg, tts:TtsServiceCfg}`
>   over a base `VoiceServiceCfg` (failover chain + split connect/read timeouts **floored `gt=0`** + `extra_body`).
> - **STT params** — `language` (default `en`, blank→auto, sent native) · `vad_filter` (on) · `hotwords`
>   (fleet-name bias) — the last two are Speaches extras sent via `extra_body` (proven to reach the multipart
>   endpoint). **TTS speed stays client-side** (`<audio>.playbackRate`, for 6b).
> - **Conf UI** — two groups **Voice · STT (#07) / Voice · TTS (#08)** on the existing scalar `Draft`/`saveBar`
>   pattern (reused `Field`/`Switch`/`Seg`, nested-secret round-trip); editor groups renumbered 09–16; typed
>   `VoiceEndpoint`/`VoiceStt`/`VoiceTts` in `SettingsDoc`. vapor.css untouched (D7). Eyeballed at 390px, zero
>   console errors.
> - **Live config (`config.yaml`, gitignored)** — VAULT primary for both (STT Speaches `192.168.1.137:9000`,
>   TTS AllTalk `:7851`), EMMA fallback **wired** (`192.168.1.160:9000`/`:7851`, same ports). ⚠️ **EMMA's voice
>   servers aren't actually up** (emma:9000 is a non-OpenAI whisper UI; emma TTS down) — owner to start the same
>   Speaches/AllTalk stack for the fallback to serve. A dead fallback is harmless (vault serves; only tried if vault fails).
>
> **Design locks (D18, full text in DECISIONS):** failover = a *separate shared subsystem* (active endpoint
> delegates to an ordered chain on **any** error; surface via header / 502; split timeouts). **Full-clip TTS**
> (not chunked) so the 6b mini-player gets a natively seekable blob — chunked streaming deferred to ROADMAP.
>
> **6b spec (owner request):** mic state machine (MediaRecorder → `/voice/stt` → composer; capability probe via
> `GET /voice/status`; folds in UI_AUDIT F21) **+ a scrubbable TTS mini-player** (ChatGPT/Telegram/WhatsApp
> style — play/pause + draggable seek + skip/speed) over a styled `<audio>` + per-message blob cache. The
> recorder's mimeType + upload filename extension **must agree** (Whisper routes by extension) — the 6a↔6b contract.
>
> **Mic-button visual states (owner-locked 2026-06-22):** reuse the existing stub's classes, **no new vapor.css** (D7):
> 1. **Idle** (available, not recording) — the current default look, unchanged.
> 2. **Recording** — the current red pulse (`.rec` + the `micrec` keyframes); drive it from the recorder's real
>    state (drop the stub's local `useState(rec)`). The owner explicitly likes this animation — keep it.
> 3. **Disabled in settings** (`/voice/status` `stt:false` — voice off / no STT endpoint) — **hide** the mic
>    entirely (distinct from F21's "keep visible during the *lifecycle*"; the config-off hide is fine, layout adapts).
> 4. **Unavailable** (configured but the STT chain — primary *and* fallback — is unreachable) — **muted/greyed +
>    inert + tooltip**. Detection = **REACTIVE** (owner's call): looks normal until a recording attempt 502s
>    (whole chain failed), *then* grey + "voice servers unreachable". No proactive liveness probe (zero new infra).
>
> **Start here next session: build 6b** (its own pre-flight over the Composer mic stub + the chat/TTS-toggle UI),
> then **6c** (Tailscale Serve HTTPS + real Android verify). The **LLM inference fallback chain** (D18 follow-up)
> is also queued. Servers: backend **5433** (no `--reload`), frontend **5173** (`http://corsair:5173`).

> ---
>
> **↓ Pre-6a pushed history (archive).** The running "current state" as of Phase 5 / 7e — all pushed
> (Phase 5 = `a6618e7`). Kept for the detail; superseded as the live snapshot by the 6a block above.
> **Phase 5 (guarded local shell, the `!` escape hatch) is shipped + owner-verified live at 390px** —
> see session #10 below. 7e is fully complete; **D17 dual-mode chat**, **A1 per-session privilege
> (D16)**, **A2 `question` kind**, and **7e-g AgentSelector** all shipped earlier — see their blocks below.
>
> **7e-f-3 — the shared Approve-to-apply propose-UI (`4b63f59`).** When a proposable builtin (`memory`
> with `auto_write` off / `skill_manage` with `skills_auto_write` off) returns OK + `data["proposed"]`
> instead of writing, the chat bubble now renders **Approve/Dismiss**, and Approve performs the same
> write the agent proposed.
> - **Tool refactor:** `memory_tool.py` + `skill_tool.py` split into shared **`gate_*` + `apply_*`**
>   pieces. The tool branches `gate → (auto_write ? propose : apply)`; the apply path does `gate → apply`,
>   bypassing **only** the auto-write switch (master/user-profile/skills switches, slug/arg checks, caps
>   all still enforced). No write logic duplicated.
> - **`services/agent/proposals.py`:** a small registry `{memory, skill_manage} → (input_model, gate,
>   apply)` + `apply_proposal(deps, agent, tool, args)` — endpoint stays tool-agnostic; a 3rd proposable
>   is one entry.
> - **`POST /api/agent/apply` `{thread_id, call_id, decision}`** (plain JSON, mirrors `/agent/plan`'s
>   in-place `messages.update`): finds the proposed call+result by id, resolves the **proposing agent
>   from `message.agent`** (7e-c), applies via the registry, rewrites the stored result (clears
>   `proposed`, marks `applied`) + flips the call to OK + audits a **USER Event**. Dismiss marks it
>   resolved. A denied/failed apply (master switch off, over cap, stale `old_text`) **leaves the proposal
>   pending**. Security property: it's **approve-the-existing, not write-anything** — applied args come
>   from the *stored* `call.args`, the request body carries only ids+decision.
> - **Frontend:** `store/chat.ts` **`applyProposal(callId, apply|dismiss)`** (optimistic POST + local
>   `tool_result` patch, mirrors `editPlan`; in-flight double-tap guard); `AgentTab` `CmdBubble` gains the
>   Approve/Dismiss affordance when `result.data.proposed` is set, reusing the confirm bubble's
>   `.actions`/`.exec`/`.dismiss` classes (**vapor.css untouched, D7**).
> - **Verified:** `test_apply_proposal_7e.py` (8) — apply/dismiss, persistence, USER audit, gate-denied +
>   stale kept-pending, 404/409, specialist agent resolution. **Full backend suite green (16 files)**,
>   `tsc` clean, live boot on 5433 confirms the route. **Not yet eyeballed live:** the interactive
>   propose→approve bubble itself (needs `auto_write: false` + a chat turn) — render is type-checked +
>   HMR'd to 5173; a human glance is the one thing the tests don't cover. **Minor open notes (non-block):**
>   an unknown `decision` value falls through to apply (mirrors `ResumeRequest`'s `execute`-default); a
>   sub-round-trip double-tap past both guards could double-write (negligible, single-user).
>
> **f-3 propose-UI verification (DONE this session).** Owner live-tested with `memory.auto_write` off: the
> `memory` call returned a proposal and the bubble showed **Approve/Dismiss** as designed. One real bug
> surfaced + fixed (`8007772`): the propose result read as an OK "proposed…" and the model told the owner
> it was *saved* while the bubble was still pending. Both propose paths now say "**— awaiting the owner's
> approval (NOT saved yet)**" + a one-line steering `output` ("say you've proposed it; don't claim it's
> saved"). Backend apply is covered by `test_apply_proposal_7e.py` (8). **Still un-eyeballed (low):** the
> Approve-writes / reload-doesn't-resurrect / `skill_manage`-propose paths — backend-tested, just no human
> glance yet; finish opportunistically. **Noted, not changed:** a *dismissed* proposal keeps `state=OK`
> (summary "the owner rejected this proposed write — not applied") — clear enough; flip `_resolved` to SKIPPED if ever desired.
>
> **▶ 7e-g `AgentSelector` shipped (`b7ce996`) → 7e is FULLY COMPLETE.** Optional per-turn auto-router:
> when no `/agent` is pinned **and** `agent.auto_rotate` is on, the chat endpoint picks the best-matching
> specialist by token overlap of the user message against each agent's `name + description`. Off by default;
> explicit `/agent` + `spawn_subagents` stay primary. All locked decisions honored (default OFF · per-turn,
> no `thread.agent` write · match `name+description` · strict-winner threshold `auto_rotate_min_overlap`
> default 2, `ge=1` · tie/below-threshold → default · specialists-only candidates · graceful no-op · one
> shared matcher). What landed:
> - **`core/textmatch.py`** (new) — `tokens` + `rank_by_overlap(query, items, text_of, *, min_overlap)`,
>   extracted from `skills.py`; **`KeywordSkillSelector` refactored onto it** (one scoring path, skill tests
>   green). **`core/agents.py`** (new) — `AgentSelector` Protocol; `select(user_msg, agents, *, min_overlap)`
>   takes the threshold **per call** (the one spec deviation from the "no-min_overlap protocol" sketch — owner
>   intent was "read live", so the protocol carries it; an LLM router can ignore it).
> - **`services/agent/selector.py`** (new) — `KeywordAgentSelector` (strict winner over `min_overlap`, tie →
>   `None`) + `select_agent(settings, selector, user_msg)` (loads specialists, **skips a malformed one**, reads
>   `agent.auto_rotate_min_overlap` live).
> - **`domain/agent.py`** `AgentDef.description` · **`config.py`** `AgentCfg.auto_rotate=False` +
>   `auto_rotate_min_overlap=Field(2, ge=1)` · **`api/agent.py`** chat-endpoint routing (resume untouched;
>   A1 per-session privilege still composes — `model_copy` runs after selection) · **`main.py`**
>   `app.state.agent_selector = KeywordAgentSelector()`.
> - **Frontend** — `AgentsEditor` gains a per-specialist **Description** input + an **"Auto-route to
>   specialists"** master Switch & min-overlap control (immediate-save off `props.cfg`, mirrors SkillsEditor;
>   number commits on blur). `AgentDef`/`AgentSectionCfg` types + `ConfTab` mapping updated. vapor.css
>   untouched (D7).
> - **Verified:** `test_agent_selector_7eg.py` (7: winner/threshold/tie/empty, `select_agent` resolve +
>   malformed-skip, the chat-endpoint gate on/off/explicit, a `KeywordSkillSelector` regression). **Full
>   backend suite green (19 files)**, `tsc` clean, **backend rebooted on 5433** (`/api/settings` round-trips
>   `auto_rotate`/`auto_rotate_min_overlap`; `agent_selector` is a `KeywordAgentSelector`). **Not yet
>   eyeballed live:** the new AgentsEditor controls at 390px (HMR'd to 5173 — a human glance is the one thing
>   the tests don't cover; finish opportunistically).
>
> **▶ START HERE NEXT SESSION — 7e + D17 + Phase 5 all done; pick the next track (owner's order, no rush):**
> **Phase 6 voice** (STT/TTS — D17 was the chat half of C1; the mic-button state machine folds in
> UI_AUDIT F21; HTTPS via Tailscale Serve for the Android mic) → **emma (Linux) deploy / v1 cutover**.
> Deferred polish: ROADMAP E2 OpenAI `/v1/chat/completions` facade, F29 opt A (UI_AUDIT §6b). Each needs
> its own cold pre-flight before building. **Phase 5 caveat for Windows hosts:** `run_shell` uses
> `powershell -Command`, and Windows PowerShell 5.1 rejects `&&`/`||` (pipes/single cmds fine); bash on
> emma has no such limit — flip to `pwsh` in `shell.py` if `&&` is ever needed on a Windows box.
>
> **7e-d (file memory), 7e-e (`session_search`), and 7e-f-1 (per-agent skills) are done.** 7e-d: read path (`16bde75`) + the
> **`memory`** write tool (`e5ebcaa`/`ed1dfa8`) + the **Conf Memory panel** (`2e18638`). 7e-e
> (`003bad3`): migration #3 FTS5 `messages_fts` + `MessageRepo.search` + the **`session_search`**
> builtin (global + secret-redacted). **7e-f-1 (`6dc06db`)**: `available_skills(global_provider,
> settings, agent)` — a specialist's own `agents/<name>/skills/` is always available, merged over the
> global `skills/` it inherits via its existing **`skills` allowlist** (`*`/list/`[]` = all/subset/none —
> **no new field**, the reuse decision); own overrides inherited by name; default agent = the global set.
> `resolve_skills` refactored to take the precomputed set; `_activate_skills` rewired. Default-agent
> behaviour byte-identical. Verified: **full backend suite green (13 files)**, live boot clean. Tree
> clean except `start_claude_remote.ps1`.
>
> **7e-f is sub-sliced (owner's call): f-1 per-agent skills ✅ → f-2 `skill_manage` + core-builtins (NEXT)
> → f-3 shared propose-UI.** **7e-f-2 is fully pre-flighted and design-locked this session** (build it
> next):
> 1. **Core-builtin reachability (resolves the deep-audit finding #1).** Add **`core: bool = False` to
>    `ToolSpec`** + a `core=` param on `@action`; mark **`task_plan`, `memory`, `session_search`** as
>    `core=True` (owner's pick: the cognitive set — *not* `spawn_subagents`/`skill_manage`, those stay
>    explicit-grant). **`ToolRegistry.for_agent()` always unions the `core` tools** → they survive any
>    `tools` allowlist *and* any skill narrowing, in one place (fixes the `coder` agent silently lacking
>    `memory`/`session_search`).
> 2. **`skill_manage` builtin** (mirror `memory_tool.py`; **not** core): `@action("skill_manage",
>    category="builtin", risk=LOW, ui_exposed=False)`, `action: save|remove` · `name` (slug) · `content`
>    (full SKILL.md). Writes to the agent's **own** skills folder (specialist → `agents/<name>/skills/<slug>/`;
>    default → global `skills/`) — the `available_skills` mirror. Gating `skills_enabled` →
>    **`skills_auto_write`** (OFF → propose-only, returns `data["proposed"]` for f-3). Slug-validated →
>    ERROR on bad name; auto-audited via `ActionService._record`.
> 3. **Config:** add **`AgentCfg.skills_auto_write: bool = True`** next to `skills_enabled` (skills config
>    already lives under `agent.*` — no new `SkillsCfg`).
> 4. **De-dup the skill-file write:** extract the generic `_write_text_eol` from `api/agent.py` to a small
>    **`core/fsutil.py`**; add **`write_skill_md(root, name, content)` / `remove_skill_md(root, name)`** +
>    a shared slug validator to `services/agent/skills.py`; refactor the existing `/api/skills` endpoints
>    to use them (one source of truth). **Pre-flight already done** (skills subsystem, `memory_tool.py`,
>    skills API, config all read). Test on a **temp `$CTRLB_HOME`**.
>
> **Then f-3 — the shared Approve-to-apply propose-UI** (frontend): render `data["proposed"]` from *both*
> `memory` and `skill_manage` as an Approve/Dismiss affordance on the tool bubble + an apply endpoint.
> Needs its **own pre-flight** over the tool-bubble / confirm-resume frontend code (AgentTab `.b.cmd`
> command bubble + the resume flow). Biggest new frontend surface of 7e-f.
>
> **Deep-audit nuances still open (low, non-blocking — full detail two session blocks below):** (2) FTS
> triggers key on `messages.rowid` (VACUUM-fragile; INNER JOIN protects correctness; migration #4 only
> if ever needed). (3) `session_search` snippet truncation could leak a secret *fragment* (secrets rarely
> in chat text). Finding (1) is being resolved in f-2 above; the `ge=1` cap floor already landed (`d422dcc`).
>
> **The 7e sequence (D14/D15):** 7e-a✅ → 7e-b✅ → 7e-c✅ → 7e-d✅ → 7e-e✅ → **7e-f✅** (f-1✅ · f-2✅ ·
> f-3✅) → **7e-g** (optional `AgentSelector`, the last slice).
>
> **Decided-but-deferred builds** (all design-locked): C1 dual-mode chat (D17), A1 privilege selection
> (D16), A2 question kind, F29 opt A (UI_AUDIT.md §6b).
>
> **Servers:** backend uvicorn **5433** (no `--reload`, venv), frontend Vite **5173** (HMR; `npm run
> dev` defaults to 5173 unless `--port 5190`). Phone: `http://corsair:5173`. Both tearable down
> without state loss. **Heads-up:** pytest is **not installed** in the backend venv — every test file
> has a `__main__` runner; run `./.venv/Scripts/python.exe tests/<file>.py`.

### ⭐ Session update — 2026-06-28 (**cosmos T4 COMPLETE — C1–C3 + the app-like selection model** · pushed `2639ea2`→`88bfa84`)

Built the bespoke **cosmos** orbital theme end-to-end across several sessions and finished it this day. Full
detail lives in [`COSMOS_HANDOFF.md`](./COSMOS_HANDOFF.md) (its top banner + §2 are the shipped inventory).
Highlights + the reusable bits a future theme should know:

- **The orbital fleet** (C1/C2): a fixed starfield canvas + DOM planets placed by `present()` (golden-angle),
  sized by service health, on faint rings; WAAPI orbit, rAF camera zoom-follow, breathing-pulse/halo liveness,
  service-cue moons/ring. All compositor-only + `data-motion`/`data-perf`-gated (§14.11).
- **C3 — the host-detail bottom sheet.** A **reusable, dependency-free `BottomSheet` primitive**
  (`components/BottomSheet.tsx`, kit-level — frontier reuses it): **multi-snap** closed/peek/full (content
  marks the peek line with `[data-bs-peek]`), imperative `translateY` (no per-pixel re-render), `pickSnap`
  (nearest-or-velocity-flick, unit-tested), quick fade-in + slide-up enter / opaque slide-down exit, an
  `entering` guard so a mid-slide font-swap reflow re-targets instead of snapping, non-modal a11y. Cosmos
  content = `CosmosHostDetail` (Audiowide name hero + compact status/id info + action bar + services). A
  **sheet-aware camera-lift** floats the focused planet above the sheet (derive `offsetY` per render; keep
  `fitScale` on the closed zone so zoom size is constant).
- **App-like text-selection + tap-highlight model (ALL themes)** — a last-ordered `@layer reset`: nothing
  selectable by default (kills the Chrome/Android tap box + stray selection on every control incl. `all:
  unset`, the mini-player, and scrolling), content islands opt back in, controls stay `none` even nested in
  content (sub-layers). Lifted into `THEME_ENGINE.md` §14.13 #10.
- **A subtle-but-important fix:** interaction animations must gate on the **`data-motion`** lever, NOT the
  raw OS `prefers-reduced-motion` query — the sheet "wouldn't slide" for the owner because OS reduced-motion
  was on while their in-app Motion was `full`. Lifted into §14.11.

Commits `2639ea2` (C2a-fix) · `12bc5e9`/`723f93e`/`6fbf3d6`/`5dbdb51`/`2d44741` (C2b) · `02c53e6` (C3a) ·
`09ae361` (C3b/C3c) · `88bfa84` (selection model). 184 unit / 34 e2e green. **NEXT: T2 phosphor or emma
deploy.** Cosmos C4 (per-host `appearance.cosmos` override) is optional/later.

### ⭐ Session update — 2026-06-21 (build session #10 — **Phase 5 guarded local shell shipped** · pushed `a5deb24`+`a6618e7`)

Picked the next track with the owner (Phase 5, their stated order), cold-pre-flighted every touch
point (composer stub, `permissions.decide`'s reserved `run_shell_allowed` gate, `core/tool.py`,
`ActionService`, `Deps`, `config.py`, `conversation.py` parts + `session._assemble`, `api/agent.py`
chat endpoint, the `chat.ts`/`AgentTab` command-bubble render), locked two design points with the
owner, built it end-to-end, verified, committed. Tree clean except the standing `start_claude_remote.ps1`.

**The `!<cmd>` escape hatch is live — a real shell command on the *backend host* (corsair/emma).**
Distinct from open-terminal (a remote box). One exec core, two entry points:
- **`services/actions/shell.py`** — `run_shell` (`@action`, HIGH, `ui_exposed=False`). Shared `_run`
  core: `asyncio.create_subprocess_exec` through a per-OS shell (`platform.system()` → `powershell
  -NoProfile -NonInteractive -Command` on Windows · `bash -lc` elsewhere — the legitimate server-OS
  branch, like `fleet._ping_cmd`), cwd = `shell.workdir` (blank → `$CTRLB_HOME`), **kill-on-timeout**
  (`wait_for`→`proc.kill()`+reap), combined stdout/stderr **redacted** (`settings.secret_values()`) +
  **truncated** (`max_output_chars`). Exit code in `data`.
- **User `!` path — `POST /api/exec {command, thread_id?}`** (`api/agent.py`). Guards
  `shell.user_exec_enabled` (→403), creates a thread like `/agent/chat`, then **reuses
  `actions.invoke("run_shell", actor=USER, privilege=FULL)`** — FULL ⇒ ALLOW (the user typing `!`
  *is* the authorization) **and the Event audit comes for free**. Persists the result as an
  `assistant`(tool_call) + `tool`(tool_result) pair — the same shape the agent loop produces — so it
  **renders as a command bubble *and* feeds the agent's context next turn** (`_assemble` round-trips it).
- **Agent `run_shell` gate** — wired the *already-reserved* `run_shell_allowed` at the **single**
  `decide()` call: `run_shell_allowed=self._deps.settings.shell.agent_exec_enabled`. Default **off** →
  DENY below FULL; on → HIGH still confirms. The user `!` path (FULL) is never blocked by it.
- **`config.py ShellCfg`** (`settings.shell`): `enabled` · `user_exec_enabled=True` ·
  `agent_exec_enabled=False` · `workdir=""` · `timeout_s=60` · `max_output_chars=6000`. Read live each
  call (no reconfigure builder — like memory/fleet).
- **Frontend**: `store/chat.ts runShell` (POST `/api/exec` → set threadId → `reloadChat`, mirrors the
  D17 buffered path); `composer.ts routeShell` now calls it (stub gone); `/help` updated. **CmdBubble
  gained a collapsed `output` disclosure** (owner's call — also surfaces agent `terminal_exec`/file-read
  output, hidden before; skipped for `web_search` which has its own hits UI). Conf **Shell** group (#06,
  groups 07–14 renumbered). Net-new CSS (`.cmd-output`) in `extras.css`; **vapor.css untouched (D7)**.

**Two design points locked with the owner:** (1) `run_shell` stays **always-registered + gated by
decide()** (not dynamically hidden) — keeps the user `!` path simple; the model may see a tool it gets
denied on when agent_exec is off (acceptable, matches D3). (2) the CmdBubble **renders `result.output`**.

**Verified:** `test_shell_5.py` (10: exec success / nonzero-exit / timeout-kill / secret-redaction /
truncation · the decide truth-table · agent denied-without-optin / confirms-with-optin · endpoint
persists tool_call+result / 403 when user-exec off). **Full backend suite green (21 files)**, `tsc`
clean, `compileall` clean. **Live on 5433** (real uvicorn, not just TestClient): `POST /api/exec
{command:"echo …"}` ran the real subprocess (exit 0, ~200ms) and persisted the assistant tool_call +
tool result pair exactly as `reloadChat` renders. **Not yet eyeballed live in the PWA:** the `!` command
bubble + the new output disclosure + the Conf Shell group at 390px (backend HMR'd; a human glance is
the one thing the tests don't cover — finish opportunistically).

**Owner verified live at 390px (Puppeteer, this session):** the `!` command bubble renders faithfully —
green/exit-0 with a working **OUTPUT** disclosure (`echo second`→`second`), red for an error — zero
console errors; the Conf **Shell** group (#06) renders all six controls + the renumber (07 MCP / 08
OpenAPI) is correct. **Caveat found:** a `&&` test exited 1 because **Windows PowerShell 5.1 rejects
`&&`/`||`** (host-shell limitation, not our code; fine on emma/bash — see the START-HERE caveat above).

**Start here next session:** Phase 6 voice (STT/TTS — D17 was the chat half of C1; the mic state machine
folds in UI_AUDIT F21) → emma (Linux) deploy / v1 cutover. Deferred: ROADMAP E2 OpenAI facade, F29 opt A.
**All pushed** (HEAD `a6618e7`). Servers: backend **5433** (no `--reload`), frontend **5173**.

### ⭐ Session update — 2026-06-21 (build session #9 — **D17 dual-mode chat shipped** · committed `3fb6603`, not pushed yet)

Long design+research session first (the owner pressure-tested the streaming-signal convention), then
built D17 end-to-end. One commit on `main` — **NOT pushed** (awaiting go-ahead, alongside `b7ce996`+
`bba38d8` from session #8 which are also unpushed). Tree clean except the standing
`start_claude_remote.ps1`.

**The chat + resume endpoints are now streaming-or-buffered.** Buffered mode is a second *consumer* of
the same `run_turn()`/`resume()` `AgentEvent` generator via a new `collect_turn()` — the loop is never
forked.

**Two decisions taken with the owner (researched, web-sourced):**
1. **Signal = a `stream` body field** (OpenAI/Anthropic convention), **revising D17's original Accept
   header.** `ChatRequest.stream`/`ResumeRequest.stream` (bool, default `False`; the PWA always sends
   `true`). The server `AgentCfg.streaming = auto|on|off` is **authoritative** — `on`/`off` force it for
   every client, `auto` honors the field. Rationale: the project lives in the OpenAI-compatible
   ecosystem, so the toggle should look the way any future client/facade expects; a body field also
   beats a header for robustness (proxies can't strip it).
2. **Keep ctrl-b's custom stateful protocol as the core; OpenAI stays a boundary/adapter format only**
   (anti-corruption layer — OpenAI themselves moved agents to the stateful Responses API). A
   **`POST /v1/chat/completions` facade is deferred to ROADMAP E2** — a ~200–300 LOC adapter reusing
   `run_turn` + `collect_turn` + the existing `interactive=False` headless-confirm path. The `collect_turn`
   built here is its foundation.

**What landed (`3fb6603`):**
- **`session.collect_turn(events)`** → `{state, messageId?, permission?, question?, error?}`. `permission`
  carries the confirm **token+prompt** — the one thing not persisted — so a **buffered confirm stays
  resumable** (the make-or-break edge case; unit-tested).
- **`api/agent.py`**: `_effective_stream(setting, requested)` resolver + a shared `_turn_response()` that
  branches SSE-vs-JSON for **both** chat (counts `active_turns`) and resume (doesn't), draining the same
  generator. The streaming branch is **byte-identical** to before (verified live).
- **`config.py` `AgentCfg.streaming`** (`Literal["auto","on","off"]="auto"`) + a **before-validator**
  coercing the YAML-1.1 booleans `on`/`off` back to strings (hand-edited-config gotcha — two of three
  values are YAML bools).
- **Frontend**: `store/chat.ts streamTurn` branches on response `content-type` — JSON → seed
  `confirmTokens` from `payload.permission`, then `reloadChat()` (renders the persisted turn + confirm/
  question bubbles from persisted state; no parallel reducer). All three senders add `stream: true`.
  Conf → Agents gains a **"Chat delivery" Auto/Stream/Buffer Seg** (savebar-saved). vapor.css untouched (D7).

**Verified:** `test_dual_mode_d17.py` (8: collect_turn folds completed/suspended-confirm-with-token/
suspended-question/error/capped · resolver truth table · endpoint content-negotiation · on/off overrides ·
streamed-vs-buffered parity). **Full backend suite green (20 files)**, `tsc` clean. **Live on 5433:**
`stream:false` → `application/json` payload, `stream:true` → SSE; minig+ answered "pong" both ways. A
buffered turn that **calls a real tool** (`ping_host`) drained the full multi-step loop and persisted
`user → assistant(reasoning+tool_call) → tool(result) → assistant(reply)` — exactly what `reloadChat()`
renders. **PWA buffered render eyeballed at 390px (`400c19e` follow-up):** forced buffered via the
`CTRLB_AGENT__STREAMING=off` env override (no `config.yaml` write), drove the PWA with Puppeteer — the
reply rendered fully via `reloadChat` (reasoning disclosure + answer), **zero console errors**, and the
Conf "Chat delivery" Seg correctly showed **Buffer**. Backend restored to `auto` after. **Still not
forced live:** a buffered *confirm-suspend* with the real model (needs a deterministic med/high-risk
tool call) — covered by the scripted endpoint test + the `collect_turn` unit test.

**Start here next session:** Phase 5 (`!` user-shell, stubbed in `lib/composer.ts`) → Phase 6 voice
(STT/TTS — D17 is the chat half of C1; TTS/STT are the remaining transports) → emma (Linux) deploy.
Deferred: the ROADMAP E2 OpenAI facade, F29 opt A. Push `3fb6603` (+ session #8's `b7ce996`/`bba38d8`)
when ready. Servers: backend **5433** (no `--reload`), frontend **5173**.

### ⭐ Session update — 2026-06-21 (build session #8 — **7e-g `AgentSelector` shipped → 7e COMPLETE** · committed `b7ce996`, not pushed yet)

Pre-flighted 7e-g cold despite the prior session's owner-locked spec (re-read every touch point:
`services/agent/skills.py` `KeywordSkillSelector`, `core/skills.py`, `domain/agent.py`, `api/agent.py`
chat/resume + `resolve_session_agent`, `config.py` `AgentCfg`, `main.py` wiring, `AgentsEditor`/
`SkillsEditor` master-switch pattern, `config.py` `list_agent_names`/`load_agent`/`_load_agent_folder`),
built it end-to-end, ran the full suite + a live boot, committed. **One commit on `main` — NOT pushed
(awaiting owner go-ahead).** Tree clean except the standing `start_claude_remote.ps1`.

**What shipped (`b7ce996`) — full detail in the "Current state" block above.** The optional per-turn
auto-router: `agent.auto_rotate` (default OFF) + a shared `core/textmatch.py` matcher (`KeywordSkillSelector`
refactored onto it, one scoring path) + `core/agents.py` `AgentSelector` protocol + `services/agent/selector.py`
`KeywordAgentSelector`/`select_agent` + `AgentDef.description` + the chat-endpoint routing + the AgentsEditor
controls. All locked decisions honored.

**One spec deviation (noted, sensible):** the spec sketched `AgentSelector.select(user_msg, agents) ->
AgentDef | None` (no threshold), but the locked "read `min_overlap` live, pass per call" requirement needs
the threshold *somewhere* per call — so the protocol carries `*, min_overlap` (an LLM/embeddings router can
ignore it). This is the clean reconciliation of the two locked points; flag it if the owner wanted the
threshold threaded some other way.

**Verified:** `test_agent_selector_7eg.py` (7), **full backend suite green (19 files)**, `tsc` clean, backend
rebooted on **5433** (`/api/settings` round-trips the two new `agent.*` fields; `agent_selector` is a
`KeywordAgentSelector`). All workspace tests on a temp `$CTRLB_HOME`. **The one gap:** the new AgentsEditor
Description input + auto-route switch/number weren't eyeballed live at 390px (HMR'd to 5173) — a human glance
next session.

**Start here next session:** 7e is complete — pick the next track per the owner's order (Phase 5 `!` user-shell
→ Phase 6 voice → emma deploy), or a deferred polish item (C1 dual-mode chat D17, F29 opt A). Push `b7ce996`
first if not already done. Servers: backend **5433** (no `--reload`), frontend **5173**.

### ⭐ Session update — 2026-06-21 (build session #7 — **A2 `question` kind** shipped + owner-tested · pushed `bb82882`+`472c731`)

Pre-flighted A2 cold (read the confirm-suspend/resume machinery in `session.py` — `_run_calls`,
`resume`, `_find_pending`, `_drive`, `_tool_content`, the `AgentEvent` wire contract, `task_plan` as the
sibling), specced it, built it, owner-tested it live, fixed a reported padding bug, pushed. Two commits.
Tree clean except `start_claude_remote.ps1`. **Locked sub-decisions:** `question` is **core** · the answer
is typed in the **bubble's own input** · **free-text** MVP (deferred: optional `choices` → quick-reply buttons).

**Key insight from pre-flight:** A2 reuses the confirm-suspend *shape* but the trigger + resume differ —
the **tool itself** signals suspend (not the permission gate), and resume **injects the owner's answer as
the call's result** (the dismiss-injection path), it doesn't re-run anything.

- **Backend (`bb82882`):** `RunState.AWAITING_ANSWER`; `services/agent/question.py` `question` builtin
  (`core=True`, LOW) returns AWAITING_ANSWER with the prompt as summary. `session.py`: a suspend branch on
  AWAITING_ANSWER (persist, emit **`tool.question`**, stop) mirroring the confirm suspend — same headless
  guard (subagent → DENIED, carries on); `_run_calls` gains `resume_answers` injecting the reply as an OK
  result (`output`=answer, read via `_tool_content`); `_find_pending` matches AWAITING_ANSWER;
  `resume(decision="answer", answer=…)` drives it. dismiss skips a question (reuses `_DISMISS`); an
  abandoned one falls into `_assemble`'s SKIPPED synthesis. API: `ResumeRequest.answer` + `decision="answer"`.
- **Frontend (`bb82882`):** `RunState += "awaiting_answer"`; `chat.ts` `tool.question` handler +
  `answerQuestion(callId, text)` (carries session privilege like `resumeCall`); a dedicated **`QuestionBubble`**
  (sibling of PlanBubble): prompt + reply input (Send/Dismiss) while awaiting, the answer once resolved.
- **Padding fix (`472c731`, owner-reported):** `.b.cmd .body` is `padding:0` (each child insets itself);
  the net-new `.q-prompt`/input had none → gave them the 12px inset and moved Send/Dismiss to the
  edge-to-edge `.b.cmd .actions` footer so the question bubble matches the confirm bubble. Audited the
  whole bubble subsystem — every other child (confirm/propose `.actions`, `.cmd-result`, `.think`,
  `.cmd-links`, plan/sys `.body`) was already inset; the question bubble was the only one affected.
- **Verified:** `test_question_a2.py` (6: builtin, suspend+event, find_pending, answer injection, headless
  DENIED, dismiss SKIPPED); full backend suite green (**18 files**; `test_core_builtins` updated — `question`
  joined the core set); tsc clean; live boot confirms the tool (core) + `ResumeRequest.answer`. **Owner
  live-tested** the ask→answer→continue loop (works; minig+ calls it on a forced prompt).

**Start here next session: 7e-g — `AgentSelector`** (optional, last 7e slice) or C1/F29. Servers: backend
**5433** (no `--reload`), frontend **5173**.

### ⭐ Session update — 2026-06-21 (build session #6 — **A1 per-session privilege selection (D16)** shipped + edge-case review · pushed `3bb7716`+`8e29690`)

Pre-flighted A1 cold (read `permissions.decide`, `AgentDef.privilege`, the loop's `self._agent.privilege`
at `session.py:657`, `subagents.resolve_child` clamp, `composer.ts`/`chat.ts` sticky-state, the
AgentsEditor Seg), specced it fully, built it, owner-tested live, then ran an edge-case review that
caught + fixed a real nuance. Two commits, pushed. Tree clean except `start_claude_remote.ps1`.

**Leaner than specced:** D16 #1 (global default = `agent.defaults.privilege`) + #2 (per-agent
`AgentDef.privilege`) were **already editable** in the AgentsEditor Privilege `Seg` (default-row binds
`agent.defaults`). So A1 was purely the **per-session override + surfacing**.
- **Backend (`3bb7716`):** `ChatRequest.privilege: Privilege | None` (lenient validator → unknown/blank
  coerces to None); pure `resolve_session_agent(settings, name, privilege)` = `resolve_agent` +
  `model_copy(update={"privilege": …})`, most-specific-wins, **no clamp** (owner may raise or lower).
  The loop + `decide()` are unchanged — it only selects a level on the existing gate. Subagents inherit
  it correctly: `resolve_child` clamps children to the (overridden) `ctx.agent.privilege` ceiling.
- **Frontend (`3bb7716`):** shared **`lib/privilege.ts`** (type + `PRIVILEGE_LEVELS`/`_VALUES`/
  `privilegeLabel`); `AgentsEditor` de-duped onto it (`useAgents` re-exports the type). Reactive
  `sessionPrivilege` in the chat store (sticky across `/clear`, threaded into the send body); **`/privilege
  [lvl]`** composer verb (+ `read` alias, bare/`default`/`clear` reset, `/help` line); a tappable
  **`PrivilegeChip`** in the chat section header (Vapor tokens, vapor.css untouched, D7).
- **Edge-case review → harden (`8e29690`):** the override wasn't carried across a **confirm resume**
  (D16 had specced "like `mode`"), so a *lowered* session could silently revert to the agent's higher
  default mid-turn after executing one confirm — a sharper edge for a **security** control than for
  routing. Fixed: `ResumeRequest.privilege` (+ shared `_coerce_privilege`), `resume()` passes it,
  `resumeCall` re-sends `state.sessionPrivilege`. Also chip label `default`→`Default`. **This deviates
  from D16's "not carried across resume" wording — owner-approved.**
- **Verified:** `test_privilege_7e.py` (4: validator incl. ResumeRequest, override applies/none,
  session-beats-agent + no-clamp, `decide()` flips HIGH-risk CONFIRM→ALLOW at `full`); full backend suite
  green (**17 files**; the `_session` spy in `test_messages_agent_7e` gained the `privilege` kwarg), tsc
  clean, live boot confirms `privilege` on **both** ChatRequest + ResumeRequest schemas. Owner manually
  confirmed the chip + verb + gating (readonly denies, confirm gates, full auto-runs).

**Start here next session: 7e-g — `AgentSelector`** (optional, last 7e slice) or a decided-but-deferred
build (C1/A1-done/A2/F29). Servers: backend **5433** (no `--reload`), frontend **5173**.

### ⭐ Session update — 2026-06-21 (build session #5 — **7e-f-3 shipped: Approve-to-apply propose-UI → 7e-f COMPLETE** · pushed `4b63f59`)

Pre-flighted f-3 cold (read `AgentTab`/`store/chat.ts`/`types.ts` + the backend `tool.result`
emission, `/agent/plan` + `/agent/resume`, `action_service._record`, `Deps`), locked the design with
the owner (4 confirmations), built it end-to-end, deep-reviewed, and **pushed** (`4b63f59` + this docs).
**7e-f is now complete.** Tree clean except the standing `start_claude_remote.ps1`.

**Key pre-flight finding that shaped the design:** `data["proposed"]` already rides the `tool.result`
SSE event into the `tool_result` part — so f-3 is a **render on a completed OK result**, NOT a
suspend/resume. The persistence model copies `/agent/plan` (in-place `messages.update` of the stored
call+result by id), so an "applied/dismissed" proposal survives a reload instead of resurrecting its
buttons. Full spec in the "Current state" block above.

**Shape (one slice, backend + frontend):** tool refactor into shared `gate_*`/`apply_*` →
`services/agent/proposals.py` registry → `POST /api/agent/apply` → `store/chat.ts applyProposal` →
`AgentTab` CmdBubble Approve/Dismiss (reuses `.actions`/`.exec`/`.dismiss`, D7). The apply path bypasses
**only** the auto-write switch; it's approve-the-existing (args from the stored call, not the request).

**Verified:** `test_apply_proposal_7e.py` (8), full backend suite green (16 files), `tsc` clean, live
route probe on 5433 (404 unknown-thread = handler reached). All write-tests on a temp `$CTRLB_HOME`.
**The one gap:** the interactive bubble wasn't eyeballed live (needs `auto_write: false` + a chat turn) —
type-checked + HMR'd to 5173; worth a human glance next session if convenient.

**Start here next session: 7e-g — `AgentSelector`** (optional, the last 7e slice; D15 #8). Mirror
`KeywordSkillSelector`: a default `KeywordAgentSelector` that auto-rotates the active agent by matching
the user message against agent titles/descriptions, swappable via the same protocol seam. **Pre-flight
`session.py`'s `_activate_skills` + how `_agent`/`resolve_agent` are wired** before building. Or pick a
decided-but-deferred build (C1/A1/A2/F29). Servers: backend **5433** (no `--reload`), frontend **5173**.

### ⭐ Session update — 2026-06-20 (build session #4 — **7e-f-2 shipped: core builtins + `skill_manage` + skill-write de-dup** · pushed `fc1aec2`/`af6299e`)

Built 7e-f-2 end-to-end off the design lock from build-session #3 (re-read every touch point cold first,
per the pre-implementation directive — `core/tool.py`, `memory_tool.py`, `skills.py`, `config.py`,
`api/agent.py` skill/agent file CRUD, the builtin registration), deep-reviewed, and **pushed** (`fc1aec2`
code + `af6299e`/this docs). Tree clean except the standing `start_claude_remote.ps1`.

**Three pieces (all locked specs):**
- **Core-builtin reachability.** `ToolSpec.core: bool` + `@action(core=…)`; `ToolRegistry.for_agent`
  unions every `core` tool on top of the allowlist match — and since the *narrowed* allowlist is fed
  back through `for_agent`, core survives skill narrowing too. `task_plan`/`memory`/`session_search`
  are `core=True`. `for_agent` starts from `agent_tools()` (already `agent_exposed`-filtered), so core
  can never surface a non-exposed tool — no security-boundary change (all three are LOW read/cognitive
  ops still gated by ActionService). Resolves deep-audit finding #1. `spec_to_dict` carries `core`.
- **`skill_manage` builtin** (`services/agent/skill_tool.py`, mirrors `memory_tool.py`) — agent-only,
  LOW, **not** core (self-authoring is an explicit grant). `save|remove` a SKILL.md in the agent's own
  skills folder (`agent_skills_root`: default → global `skills/`, specialist → `agents/<slug>/skills/`).
  Gating: `agent.skills_enabled` → new **`AgentCfg.skills_auto_write`** (off → propose-only, returns
  `data["proposed"]`). Bad slug / empty `save` body → ERROR; auto-audited via `ActionService._record`.
  Registered in `services/actions/__init__.py`.
- **De-dup the skill-file write.** Extracted the EOL-preserving atomic writer to **`core/fsutil.py`**
  (`write_text_eol`); added `agent_skills_root`/`write_skill_md`/`remove_skill_md` + a shared
  `valid_skill_slug` (+ `SKILL_SLUG`) to `services/agent/skills.py`; refactored `/api/skills` (dropped
  the local `_SKILL_NAME`/`_skill_md_path`/inline writer) and `/api/agents` (uses the relocated
  `write_text_eol`) to reuse them — one source of truth, no parallel writer.

**Verified:** `test_core_builtins_7e.py` (5) + `test_skill_manage_7e.py` (8); **full backend suite green
(15 files)**, `compileall` clean. Backend restarted on **5433** (no `--reload`) — `/api/actions` shows
`skill_manage` (builtin, core=False, ui_exposed=False) + `task_plan`/`memory`/`session_search` core=True,
`spawn_subagents` core=False; `/api/settings` round-trips `agent.skills_auto_write`. All write-tests on a
temp `$CTRLB_HOME` (never the real config/skills). Frontend untouched this slice (5173 left as-is).

**Deep review (post-push) — clean, one behavioral note:** `for_agent` starts from `agent_tools()` (already
`agent_exposed`-filtered), so `core` can only re-add tools an agent could already be granted — it can't
surface a hidden/UI-only tool → **no security-boundary change** (the trio is LOW read/cognitive, still
gated by `ActionService`). Gating order matches `memory_tool`; the de-dup is behaviour-preserving (7d
suites green). **Note (not a bug, locked design):** the default agent has `tools="*"`, so it now sees
`skill_manage` and — with `skills_auto_write` default-**on** — can autonomously author/delete **global**
skills (exactly mirrors `memory.auto_write`). Kill switch + f-3 propose-mode + audit Events cover it; flip
`agent.skills_auto_write: false` for propose-only.

**Start here next session: 7e-f-3 — the shared Approve-to-apply propose-UI** (frontend, the biggest new
surface of 7e-f). Both `memory` and `skill_manage` already emit `data["proposed"]` when their auto-write
switch is off (`memory.auto_write` / `agent.skills_auto_write`). **Pre-flight its own touch points first** —
the AgentTab `.b.cmd` command bubble + the confirm/resume flow (`/api/agent/resume`) + a new apply endpoint.
Don't start cold. After f-3, 7e-f is complete → **7e-g** (optional `AgentSelector`, mirrors
`KeywordSkillSelector`) is the last 7e slice.

### ⭐ Session update — 2026-06-20 (build session #3 — **7e-f-1 per-agent skills** + **7e-f-2 pre-flight/design-lock** · pushed)

Sub-sliced 7e-f (owner's call: f-1 per-agent skills → f-2 `skill_manage` + core-builtins → f-3 shared
propose-UI), built f-1, and fully pre-flighted + design-locked f-2. `6dc06db` (f-1) + this docs commit,
pushed. Tree clean except `start_claude_remote.ps1`.

**7e-f-1 — per-agent skills + inheritance (`6dc06db`).** Reuse decision (locked with owner): **no new
`skills_inherit` field** — the existing `AgentDef.skills` allowlist already expresses all/subset/none,
so it *is* the global-inheritance knob; a specialist's own `agents/<name>/skills/` is always available
on top.
- `services/agent/skills.py`: new **`available_skills(global_provider, settings, agent)`** = global
  `list()` filtered by `agent.skills` ∪ the agent's own-folder skills (specialist only), own-overrides-
  inherited by name. **`resolve_skills` refactored** to take that precomputed set (allowlist filtering
  moved out of it). The AgentsEditor Skills tick-grid (already bound to `agent.skills`) now reads as the
  inheritance selection — **no frontend change**.
- `services/agent/session.py`: `_activate_skills` builds the per-agent set via `available_skills`;
  subagents inherit the same path via `deps.skills`. **Default-agent behaviour byte-identical** (own=[],
  global filtered by its allowlist). The only semantic shift — `skills=[]` now means "no *inherited*
  global, own folder still on" — affects no current agent (own folders are new this slice).
- Tests `test_skills_per_agent_7e.py` (6). Full suite green (13 files); live boot clean.

**7e-f-2 — pre-flighted + design-locked (build next).** Two owner decisions taken: (a) **core builtins =
the cognitive set `task_plan`/`memory`/`session_search`** (not `spawn_subagents`/`skill_manage`),
bypassing both the agent allowlist and skill narrowing via a `core=True` `ToolSpec` flag honored in
`for_agent`; (b) **`skills_auto_write` lives in `AgentCfg`** (next to `skills_enabled`, no new section).
Full locked spec + the de-dup plan (extract `_write_text_eol` → `core/fsutil.py`; `write_skill_md`/
`remove_skill_md` in skills.py; refactor `/api/skills` to use them) is in the "Current state" block
above. No code written for f-2 yet.

**Heads-up for the propose-UI (f-3):** it's the shared Approve-to-apply affordance that both `memory`
(`auto_write=OFF`) and `skill_manage` (`skills_auto_write=OFF`) already feed via `data["proposed"]`. It
needs its own pre-flight over the AgentTab command-bubble (`.b.cmd`) + confirm-resume frontend before
building — don't start it cold.

### ⭐ Session update — 2026-06-20 (build session #2 — **7e-e `session_search`** + a **deep audit pass** · pushed)

Built 7e-e end-to-end (pre-flight → design → build → verify → review), then ran a deep audit over the
session's surface (7e-d-2/d-3 + 7e-e) at the owner's request. `003bad3` (7e-e) + an audit-hardening
commit + this docs commit, all pushed.

**7e-e — `session_search` (`003bad3`).** Pre-flight read `db.py`, `domain/conversation.py`,
`services/conversation.py`, and de-risked the FTS5+`json_each`-in-trigger approach with a throwaway
SQLite check before recommending it.
- **db migration #3:** `messages_fts` FTS5 over user/assistant message *text*. Kept in sync by AI/AU/AD
  triggers that extract the concatenated `TextPart` text from the JSON `parts` via `json_each`
  (reasoning/tool/system excluded by a `WHEN role IN ('user','assistant')` guard) + a one-pass backfill
  of existing rows. Pure SQL — no `MessageRepo` coupling; `parts` stays the single source of truth.
- **`MessageRepo.search`:** FTS5 `MATCH … ORDER BY rank` + `snippet()`, joins thread context, excludes
  archived (ephemeral subagent) threads at *query* time. `_fts_query` sanitizes each word to a quoted
  literal term so a model query with FTS operators can't throw.
- **`session_search` builtin** (LOW, `ui_exposed=False`): global recall; each snippet redacted via
  `core.redact` against **`Settings.secret_values()`** (a new value-level collector mirroring
  `mask_secrets`). Formats like `web_search`.
- Tests `test_session_search_7e.py` (8). Live: migration applied to the real db — **schema_version 3,
  backfill 368/368**, tool registered, snippets render.

**Deep audit findings (surfaced; none blocking):**
1. **Builtin reachability (inconsistency — owner decision).** The agent toolset is `for_agent(allowlist)`
   intersected with skill narrowing; there is **no always-on core-builtin notion**. So a specialist with
   an explicit `tools` list (the `coder` agent lists `task_plan`/`spawn_subagents`/terminal/web_search
   but **not** `memory`/`session_search`) silently can't use the new builtins, and every future builtin
   needs each specialist's allowlist updated. Pre-existing property, amplified by adding builtins.
   Recommend deciding in 7e-f: implicitly grant a core-builtin set, or document the requirement.
2. **FTS rowid coupling (latent fragility — low).** Triggers key on `messages.rowid`, not stable across
   `VACUUM` (messages has a TEXT PK). The app never VACUUMs, and the search `INNER JOIN messages ON
   m.id = f.message_id` means orphaned/stale FTS rows can't produce wrong results — only the
   trigger-resync would target a stale rowid post-VACUUM. Robust fix = key triggers on `message_id`
   (needs a migration #4); deferred (no VACUUM in the codebase).
3. **Snippet fragment redaction (nuance — low).** Redaction replaces whole secret strings, but `snippet()`
   truncates at token boundaries, so a secret split by word-boundary chars (e.g. `sk-…`) could leak a
   *fragment*. Low severity (secrets rarely live in chat text; tool outputs are pre-redacted at write
   time; a fragment isn't usable). Documented limitation.
4. **FK-cascade delete (verified non-issue).** A thread delete may not fire the AD trigger (orphaned FTS
   rows), but the search INNER JOIN filters orphans → no wrong results, only potential bloat. No action.
5. **Applied hardening:** `MemoryCfg.memory_char_limit`/`user_char_limit` floored `Field(…, ge=1)` — a
   blanked Conf cap field (→ 0) used to silently wedge all agent memory writes (every write over-caps);
   now the PUT 422s. Suite re-verified green.

**Start here next session: build 7e-f** (per-agent skills + `skill_manage` + the shared propose-UI; and
likely resolve audit finding #1). Pre-flight list is in the "Current state" block above.

### ⭐ Session update — 2026-06-20 (build session #1 — **7e-d-2 + 7e-d-3 → 7e-d file memory COMPLETE** · 3 commits, all pushed `2e18638`)

Build session following the pre-flight read→design→build→review loop end-to-end. Finished file
memory: the write tool, a review-driven hardening, and the Conf panel. **3 commits on `main`, pushed**
(`e5ebcaa` → `ed1dfa8` → `2e18638`). Tree clean except the standing `start_claude_remote.ps1`.

**7e-d-2 — `memory` write tool (`e5ebcaa`).** Pre-flight read `planning.py`/`subagents.py` (builtin
patterns), `core/tool.py`, `services/agent/memory.py`, `action_service.py` (`_record` audit) before
writing. New `services/agent/memory_tool.py`: `@action("memory", category="builtin", risk=LOW,
ui_exposed=False)` — `add`/`replace`/`remove`, `target: memory|user`, substring `old_text`, **no read**
(content injected by d-1). `FileMemoryProvider.write` does the file edit (`§`-delimited add; first-match
replace/remove; blank-run collapse; over-cap → `MemoryCapError`). Gating order in the tool: master
switch → `user` profile switch → `auto_write` (OFF = propose-only/non-blocking, returns `data["proposed"]`,
Approve-UI deferred to 7e-f). Auto-audited via `ActionService._record`. Tests `test_memory_tool_7e.py`
(11). Registered alongside `planning`/`subagents`; live `/api/actions` confirms `category=builtin
risk=low agent_exposed=True ui_exposed=False`.

**Hardening (`ed1dfa8`).** Self-review/code-review of the d-2 diff caught a latent footgun: `needle =
old_text or ""` meant an empty `old_text` for replace/remove matched the always-present empty substring
(prepend / no-op) instead of erroring. The tool guards it today, but the provider gains a Conf-panel
caller in d-3, so made `write` self-protecting (reject empty `old_text`). Confirmed: **no concurrency
risk** — the sync `write` has no `await` between read and write, so parallel subagents serialize cleanly.

**7e-d-3 — Conf Memory panel (`2e18638`).** Provider `read_raw` + `overwrite` (blank clears; **uncapped**
— manual owner edits aren't bound by the agent's auto-write cap, owner's "soft cap" call) + protocol
additions. File API mirrors the skills/SOUL.md endpoints: `GET/PUT /api/agents/{name}/memory` (incl.
`default` → root) + `GET/PUT /api/memory/user`, slug-guarded via `_agent_folder`, paths delegated to the
provider. Frontend: `hooks/useMemory` (a `MemorySlot` abstraction + `useMemoryContent`/`useSaveMemory`,
mirroring `useSkills`), `components/MemoryEditor` (toggles direct-mutate `memory.*` like the Skills master
switch; caps in a local draft + Save; one editable row per file reusing `.kv-text.skill-md` + a cap-usage
counter), new Conf **Memory** group (#10; Agent tools/Computers/Appearance renumbered 11–13). Tests
`test_memory_panel_7e.py` (8). `tsc` clean; net-new CSS (`.mem-md-bar`/`.mem-count`) in `extras.css`
(vapor.css untouched, D7).

**Verified:** full backend suite green (11 files), `tsc` clean, backend rebooted on 5433 (read-only
endpoint smoke: default/user/coder → 200, bad slug → 422), frontend live on 5173 (HMR). Write paths
proven on **temp `$CTRLB_HOME`** workspaces — never the real `memories/`/config.

**Start here next session: build 7e-e — `session_search`** (FTS5 over `messages` + a builtin tool,
global + redacted, D15 #7). Pre-flight reading list is in the "Current state" block above.

### ⭐ Session update — 2026-06-16 (build session #2 — **7e-d-1 file-memory read path** + hook fix · cut off by a connection drop, handed off clean)

Build session, ended by a connection drop mid-way through "continue to 7e-d-2" — **no 7e-d-2 code was
written**, tree is clean at `16bde75`, everything pushed. What landed:

**7e-d sub-sliced (owner's call): d-1 (read path) → d-2 (write tool) → d-3 (Conf panel).** Plus two
locked decisions for the tool: `auto_write` OFF = **propose-only, no write, no block**; the
Approve-to-apply **UI affordance is deferred to 7e-f** (shared with `skill_manage`).

**7e-d-1 — file memory read path (`16bde75`).** The file impl of the ROADMAP B1 `MemoryProvider`,
injecting saved notes into every turn:
- `config.py` **`MemoryCfg`** (`Settings.memory`): `enabled` · `user_profile_enabled` · `auto_write`
  · `memory_char_limit` 2200 · `user_char_limit` 1375 (Hermes-named, `extra="allow"`).
- `core/memory.py` **`MemoryProvider`** Protocol (`load_context(agent) -> str`) — mirrors
  `core/skills.py`'s `SkillProvider`.
- `services/agent/memory.py` **`FileMemoryProvider.load_context`** — reads per-agent MEMORY.md (default
  agent → `$CTRLB_HOME/memories/`; specialist → `agents/<slug>/memories/`) + global `memories/USER.md`,
  formats each as a Hermes-style section (`## Agent memory (1% — 24/2,200)`). Stateless (paths/caps from
  live Settings each call → edits land with no restart).
- Wired on **`Deps.memory`** + **`app.state.memory`** (main.py, like `skills`); **`AgentSession` gains
  `memory=`**, injected in **`_assemble` right after `_appends()`** (D15 #4) via a `_memory_block()`
  helper; subagents pass `deps.memory`. `memory=None` → byte-identical prior behaviour.
- **`memories/` + `agents/*/memories/` gitignored** (personal data, D14) — landed *before* any file is created.
- `tests/test_memory_7e.py` (6): inject order, usage header, profile toggle, master switch, empty, per-agent isolation.

**Hook fix (`f2002c0`).** The commit-time post-flight reminder hook (`94f7bf8`) was **over-firing on
non-commit Bash** — the `if: Bash(git commit*)` gate mishandled compound `cd … && …` commands. Fixed by
dropping the gate; the command now greps its own stdin for `git commit` and emits the reminder only
then. Pipe-tested both ways (clean → silent, commit → reminder, exit 0). The hook is working as
intended now — you'll see it fire only on real `git commit` calls.

**Verified:** 38 backend tests green (6 new), `compileall` clean, backend rebooted on 5433 with the new
wiring, `/api/settings` confirms the live `memory` section. No frontend in d-1.

**Start here next session: build 7e-d-2** (the `memory` tool / write path) — full spec + pre-flight
reading list is in the "Current state" block above. Apply the coding-discipline loop; the commit-time
hook will remind you of the post-flight.

### ⭐ Session update — 2026-06-16 (build session #1 — shipped **7e-c `messages.agent`** + the `coder` example agent · 3 commits)

Build session, following the new pre-implementation directive end-to-end (read every touch point
before writing). Closed out 7e-c, added a real specialist agent as the live fixture, and recorded a
reusable engineering-discipline skill. Three commits on `main`, pushed with this handoff.

**7e-c — per-turn agent attribution (`messages.agent`, D15 #5) — `680b310`.** Records which AgentDef
produced each assistant turn so a restored thread shows the agent per-turn across `/agent` switches,
and resume continues as the last turn's agent.
- **db**: additive **migration #2** (`ALTER TABLE messages ADD COLUMN agent TEXT`, nullable — `null`
  = legacy rows / non-assistant turns). Applied live to the real `ctrlb.db` on restart (66 legacy
  rows → `null`).
- **domain/repo**: `Message.agent` round-trips through `MessageRepo.add`/`_row` (`update` left alone —
  agent is set at insert, immutable).
- **session.py**: stamp `self._agent.name` on the assistant turn in **both** `_drive` and `_finalize`
  (the forced-final-answer path — caught by the post-flight diff review, which is why both got it),
  and carry `agent` on the **`message.start`** SSE event so a live specialist turn is labelled
  immediately, not only after reload.
- **api/agent.py**: `resume()` resolves the **last assistant turn's `agent`** (→ `thread.agent` →
  default). Resume-only — a bare `/agent` clears the sticky session agent to `null` on the chat path,
  so applying the last-agent fallback there would break clear-to-default (verified in `composer.ts`).
- **frontend**: `ChatMessage.agent`; `AgentTab` labels a turn with its agent **only when it differs
  from the resolved default** (new always-on `useAgentRoster()`, reusing the `["agents"]` query key the
  mutations already invalidate); `store/chat.ts` carries the `message.start` agent onto the live bubble.
- **tests**: `test_messages_agent_7e.py` — 5 tests (migration + round-trip, restore API shape, resume
  prefers last-assistant agent over thread, latest-wins after switch, fall-through). Suite **32 green**,
  `tsc` clean. Run via the venv's `python tests/<file>.py` (**pytest is not installed in this venv** —
  every test file has a `__main__` runner; heads-up vs the docs that say "run with pytest").

**`coder` example specialist agent — `fe2cbe5`** (`dashboard_v2/agents/coder/`). Created through the
**file API** (`PUT /api/agents/coder` + `…/soul`) — the validated chokepoint, not hand-written files.
Scoped toolset (terminal read/list/grep/glob/write/exec + `web_search` + `task_plan` +
`spawn_subagents` + `mcp__web-tools__*` glob; **no** fleet/service controls — also exercises the
`tools` allowlist), `privilege=confirm`, `max_iterations:20`, `max_calls_per_tool:10`, and a
read-before-write coding persona in `SOUL.md`. `agents/` is **not** gitignored, so it's tracked.
Doubles as the live attribution fixture. (Reminder confirmed: agents are **folder-only** now — the
`agents:[]` config vector was removed in D15 #3; `$CTRLB_HOME` = project root = `dashboard_v2/` on
corsair, so the folder is `dashboard_v2/agents/coder/`.)

**`coding-discipline` skill — `cdace1b`** (`.agents/skills/coding-discipline/SKILL.md`). An always-on
engineering loop (pre-flight read/reuse/pattern/no-hardcoding → clean build → review/audit/debug/verify)
with a trivial fast-path; delegates depth to the existing audit/debug/karpathy/refactor/commit skills
rather than duplicating them. Claude-Code tooling, not a dashboard runtime skill.

**Heads-up / housekeeping:** the live attribution test left one throwaway chat thread (an "ok" turn)
in `ctrlb.db` — harmless, `/clear` drops it. Servers left up: backend **5433** (no `--reload`),
frontend **5173**.

### ⭐ Session update — 2026-06-15/16 (design/decisions session — **unresolved-items backlog closed**; no feature code)

Pure planning + decision session (per [[pause-between-phases-for-review]] + the new pre-implementation
directive). Walked the open-questions/loose-specs across HANDOFF/TODO/UI_AUDIT/DECISIONS one by one
with the owner and **locked every live decision**, grounding each in the actual code so the eventual
builds reuse existing seams (no parallel paths). **All pushed** (`f9c6315` → `ea03495` → `349dfcc` →
`11ce86a` + this handoff). Tree clean except the standing `start_claude_remote.ps1`.

**Decisions locked (each cites the seam it reuses):**
- **A1 privilege selection → D16.** Global default = **`agent.defaults.privilege`** (already wired —
  *no new `agent.default_privilege` field*; that was explicitly rejected as redundant), per-agent =
  `AgentDef.privilege` (shipped), per-session = a new **`ChatRequest.privilege`** override (`model_copy`,
  mirrors `ChatRequest.agent`); surfaced via a header chip + sticky `/privilege` verb (reuses the
  `/local`//`/cloud` plumbing). `core/permissions.decide()` already implements the full ladder — no new
  engine. Standalone slice, **not** 7e. Per-host + time-boxed escalation deferred.
- **Dual-mode chat → D17 (build).** Buffered mode is a **second consumer** of the existing
  `run_turn`/`resume` `AgentEvent` generator via a new `collect_turn(events)` collector — **the loop is
  not forked**. `AgentCfg.streaming: auto|on|off`; `auto` = Accept-header negotiation; setting
  authoritative (`off` buffers the PWA too); one content-negotiated endpoint; client branches on
  response content-type and reuses the reload render path. Chat only.
- **C1 STT/TTS → decoupled per-transport** (ROADMAP C1): chat = D17's `AgentCfg.streaming`; **TTS** =
  own chunked-playback knob (Phase 6); **STT** = always buffered, no toggle. No single global toggle.
- **Prompted-JSON tool-calling fallback → DROPPED** (native-only; the weak-model fix was the `fleet`
  skill + loop guards, not the call format).
- **A2 `question` kind → design locked, build deferred** (ROADMAP A2): a `question` builtin (sibling of
  `task_plan`) → `RunState.AWAITING_ANSWER` suspend → `tool.question` event → question bubble →
  **extends** `/api/agent/resume` with `decision="answer"`. Reuses the confirm-suspend machinery.
- **7e-g AgentSelector → default `KeywordAgentSelector`** (mirrors `KeywordSkillSelector`), protocol
  swappable (D15 #8).
- **F29 option A → sub-decisions locked, build deferred** (UI_AUDIT §6b): conflict policy = restore +
  toast (user resolves); scope key = `<editor-type>:<instance-id>`.
- **D1 idle → OS-native sleep** (let each host's own power plan do it; ctrl-b builds no remote idle
  detection). **Compute-aware idle** (don't sleep during GPU jobs) = the only future variant worth
  ctrl-b involvement; deferred.
- **D2 wake-on-connection → Tailscale-status poll** (primary; reuses tailnet + the fleet monitor-loop
  pattern, no public surface) **+ PWA-connect trigger** (near-free MVP). Pairs with the A3 scheduler.
- **Stale DECISIONS "Still open" reconciled** — MCP (both transports shipped), routing (tab state),
  auth (standing decision), memory (D14) all marked resolved.

**New standing rule (owner directive 2026-06-16): check the design before implementing.** A feature
starts by *reading* the code it touches; reuse existing data structures/classes/architecture layers,
no hardcoding, no duplicate/near-duplicate paths; surface the seams + any deviation and confirm before
coding. Recorded in **AGENTS.md §9 + CLAUDE.md Hard rules** + memory [[check-patterns-before-implementing]].

**Dependency security cleanup (same session, `07d64da` + `a06e3b5`).** Cleared the Dependabot
backlog: **frontend** `package.json` gained `overrides: { esbuild: ^0.28.1 }` (vite 7.3.3 capped it at
`^0.27.0`) and vite bumped 7.3.3 → **7.3.5** (`npm audit` → 0 vulns, build verified); **backend**
`python-multipart` 0.0.29 → **0.0.31** (venv reinstalled, `pip check` clean, `app.main` imports). The
15 alerts on the dead `ws_*` prototype dirs were **dismissed as "not used"**. Heads-up for a fresh
checkout: a clean `npm install` honors the esbuild override; the backend venv already has 0.0.31. (The
GitHub banner may briefly still show the 4 python-multipart alerts until Dependabot re-scans `main`.)

**Start here in a fresh session — back to *building* 7e-c:**
1. **Finish 7e-c — the `messages.agent` column** (the only remaining 7e-c item, D15 #5). Additive
   migration in `db.py` (`messages` has no `agent` col yet, only `threads`); set it to the resolved
   AgentDef name on each assistant turn; **resume order** = explicit → last assistant turn's `agent` →
   `thread.agent` → default; restore shows the per-turn agent. Backend-led, small frontend touch.
   **Apply the new directive:** read `session.py` (`_drive`/`run_turn`/`resume`), `api/agent.py`
   (`_session`), `domain/conversation.py` (`Message`/`Thread`), and `db.py`'s migration applier first;
   reuse them, don't add a parallel path.
2. **Then 7e-d** (file memory) — fully specced by D15 #4/#6; `agents_dir_path()`/`memories_dir_path()`
   seams already exist. The next big slice.
3. **Decided-but-deferred builds** (pick when wanted, all design-locked above): C1 dual-mode chat (D17),
   A1 privilege selection (D16), A2 question kind, F29 opt A.

**Servers:** backend uvicorn **5433** (no `--reload`, venv), frontend Vite **5173** (HMR; `npm run dev`
defaults to 5173 unless `--port 5190`). Phone: `http://corsair:5173`. Tearable down without state loss.

### ⭐ Session update — 2026-06-14 (evening) (shipped **7e-b** + **7e-c agents-as-folders** · all pushed `b202f5b`)

Build session. Shipped 7e-b end-to-end and the larger half of 7e-c, all pushed to `origin/main`
(`62935af..b202f5b`). Tree clean (except the standing `start_claude_remote.ps1`).

#### 7e-b — `<PromptModal>` + Conf-sizing (commits `d92aff6`, `62935af`)
- **`<PromptModal>`** (`components/PromptModal.tsx`) — the one reusable full-page prompt/markdown
  editor, opened imperatively via **`requestPrompt()`** (`store/prompt.ts`, the same store/host
  pattern as `ConfirmDialog`). Sizes to the `--app-h` shell (Android keyboard), focus-trap/Escape/
  restore mirror F17, char counter only, `[Load default]`/`[Restore default]` only when `defaultText`
  is passed (`useDefaultPrompt` → `/api/agent/default-prompt`). Text seeded **during render** (no
  stale-frame flash). Inline prompt rows shrank to a preview (`lib/promptPreview.ts`) + opener.
- **Wired**: Conf → Inference System prompt (+ new **append**), per-agent Prompt (+ **append** +
  `inherit_append` Seg), Skills SKILL.md keeps its inline editor + a fullscreen opener.
- **Conf-sizing refine** (`62935af`): `.mform` label col 90→104px, Limits grid 2-col @≤420px,
  `.confrow .k .label` overflow-wrap. All net-new CSS in `extras.css`; **vapor.css untouched (D7)**.

#### 7e-c — agents are folder-only (commits `0a30375` backend, `3e34d9c` frontend, `fc15ceb`+`e417859` refine/fix, `b202f5b` docs)
- **Backend (`0a30375`)**: `$CTRLB_HOME` root (`home_path()`, env `CTRLB_HOME`, **default = project
  root** so corsair is unchanged; `CTRLB_CONFIG`/`CTRLB_DB` still override). `config_path()`/`db_path()`
  layer on it; new `agents_dir_path()`/`memories_dir_path()`. **`agent.defaults`** inheritance base +
  `deep_merge` load; **`agents:[]` removed from the Settings schema** (D15 #3 — no migration; the live
  v2 config had no `agents:`/`agent:` block, confirmed no-op). `resolve_agent`/`list_agent_names` read
  folders; **SOUL.md → `AgentDef.prompt`** (so `_system_prompt()` is unchanged). **File API**:
  `GET/PUT/DELETE /api/agents/{name}` (+ `…/soul`); the default/root agent can't be created/deleted
  here (its fields live in Conf, persona = root SOUL.md). Tests rewritten/migrated, **27/27 green**.
- **Display names (`3e34d9c`)**: optional **`AgentDef.title`** (in agent.yaml) + **`agent.default_title`**
  for the root agent. The folder **slug stays the `/agent` id**; UI shows `title || slug`; `title`
  never inherits from `agent.defaults` (popped before the merge).
- **Frontend (`3e34d9c`)**: `AgentsEditor` rewritten off the file API (`useAgentList`/`useAgent`/
  `useSaveAgent`/`useDeleteAgent`/`useSaveAgentSoul`). **Unified list (owner's pick)**: default/root
  agent first row (fields ↔ `agent.defaults`, title ↔ `default_title`, persona ↔ root SOUL.md),
  specialists below (own `agent.yaml` + SOUL.md). SOUL saves **directly** (file-backed) through the
  PromptModal; add-agent takes a **slug + optional display name**, scaffolds, opens.
- **Two refinements after owner feedback**: `fc15ceb` made the fields **explicit about what they
  edit** (a storage caption `agents/<slug>/ · agent.yaml + SOUL.md` or `config.yaml · agent.defaults +
  root SOUL.md`; labels `Persona · SOUL.md`, `Prompt append`, `Inherit global append`). `e417859`
  **fixed the Skills control**: the old All/None/Custom Seg made Custom unreachable (empty Custom ==
  None); now it's an "all skills" Switch + tick-grid, identical to the Tools control.

#### Process notes / heads-up for next session
- **Live write-test slip + remediation**: a backend API smoke-test ran against the **real**
  `dashboard_v2/config.yaml` (no `CTRLB_HOME` set), briefly writing `agent.default_title: Atlas` +
  creating `agents/`. Caught, **reverted, dir removed, backend restarted clean** ([[test-write-endpoints-on-temp-config]]).
  **Next session: set `CTRLB_HOME` to a temp dir for any live write-test of the agents/memory APIs.**
- **Remaining 7e-c = `messages.agent`** (see Current state #1). Then **7e-d** (file memory) is the big
  one; the `memories_dir_path()` seam is already in place.

### ⭐ Session update — 2026-06-14 (pushed 7e-a · verified · **reshaped 7e into the D14 agent-workspace design**)

Planning + housekeeping session. Pushed the pending work, live-verified 7e-a, then researched
**Hermes Agent** + **OpenClaw** memory/agent models and reshaped Phase 7e around a **file-based,
portable, per-agent-workspace** design — locked as **D14**. No feature code (per
[[pause-between-phases-for-review]]); the artifacts are the doc updates.

#### Housekeeping done
- **Pushed** `615c694..6d212a9` → `origin/main`: `d4cd25c` (7e-a) + a new `6d212a9` docs commit
  recording the 7e-a ship. `start_claude_remote.ps1` left untouched (standing rule).
- **Backend restarted on 5433** (no `--reload`, venv) and **7e-a verified live** —
  `GET /api/agent/default-prompt` → baked `DEFAULT_SYSTEM_PROMPT` (1739 chars). Frontend on 5190 up.

#### The D14 design (canonical detail in `DECISIONS.md` D14 + `TODO.md` 7e)
Researched that **Hermes profiles** and **OpenClaw workspaces** are both *single-agent-per-process*
(separate `HERMES_HOME`/gateway/bot-token, or one agent per Gateway). We **keep our in-process
multi-agent runtime** (`resolve_agent` + in-process `spawn_subagents` — strictly more capable for
"a generalist that *uses* specialists") and adopt only their **folder convention**:

- **Relocatable root `$CTRLB_HOME`** (env, default `~/.ctrl-b/`; composes with `CTRLB_CONFIG`/`CTRLB_DB`)
  holds `config.yaml` + `ctrlb.db` + `SOUL.md` + `memories/` + `skills/` + `agents/` — mirrors `HERMES_HOME`,
  sets up the emma deploy.
- **Default agent = the root** (root `SOUL.md`/`memories/`/`skills/`, **no `agent.yaml`** — it *is* the
  config.yaml globals). **`agents/<name>/` = specialists only** (`fleet` stays a *skill*, not an agent):
  `agent.yaml` (overrides only — absent fields inherit a config.yaml `agent.defaults` block via
  `deep_merge` at load) + `SOUL.md` + `memories/MEMORY.md` + `skills/`. Scan-discovered, live-reloaded.
- **Agents are folder-only** (D15 #3, owner-clarified 2026-06-14): **no migration feature** —
  `agents:[]` is removed from the schema; agents are read exclusively from folders; any existing
  live-config entries are relocated by hand during 7e-c (one-time dev step, likely a no-op).
- **`SOUL.md`**: scaffold-if-missing from the baked default + a setting to disable the baked default
  entirely (empty = empty). Portable to/from Hermes/OpenClaw.
- **Memory**: file impl of the ROADMAP B1 `MemoryProvider` — per-agent `memories/MEMORY.md` + **global**
  `memories/USER.md` (gitignored); a Hermes-shaped **`memory` tool** (add/replace/remove · target
  memory|user · substring old_text · no read), **autonomous auto-write** + `memory.auto_write` kill
  switch, configurable caps (2200/1375 default), over-cap → consolidate, injected via 7e-a's machinery,
  audited as Events. Vector = later "both" mode over the unused `memory` table + 4f embeddings.
- **`session_search`** = FTS5 over `messages` + a builtin tool. **Sessions stay central + agent-
  agnostic in `ctrlb.db`** — a *deliberate divergence* from Hermes/OpenClaw (preserves `/agent`
  mid-thread switching + cross-agent search).
- **Session attribution** (7e-c): nullable **`messages.agent`** column (additive migration) records
  the resolved agent per assistant turn → restore shows the per-turn agent across `/agent` switches,
  resume prefers the last turn's agent, `session_search` can filter by agent. `threads.agent` stays
  the thread's primary/default.
- **Skills**: per-agent (global `skills/` = the default agent's set; each agent its own folder);
  `agent.yaml` `skills_inherit` = all | specific subset | none. Plus a **`skill_manage` agent tool**
  (sibling of `memory`: self-author `SKILL.md`, auto-write + `skills.auto_write` kill switch) — built
  in 7e-f, Hermes-style self-improvement.
- **Skipped vs the Hermes home**: `auth.json` (no OAuth), `.env` split (secrets stay in masked
  `config.yaml` + `CTRLB_*__*` env), `sessions/` + `logs/` (central `ctrlb.db` + the `events` table /
  process journal). Hermes' `cron/` → ROADMAP A3 (reserve seam).
- **Invocation**: explicit `/agent` + `spawn_subagents` primary; optional `AgentSelector` auto-rotate
  (mirrors `SkillSelector`), default off.
- **UI**: `AgentsEditor` repointed to a file-per-agent API with a first-class **add-agent** flow
  (scaffolds the folder) + edit/delete, well-designed @390px.

#### 7e-b decisions locked (2026-06-14)
The six open questions from the 2026-06-09 block are answered (all the "recommended" options):
1. **`[Load default]` placement** — **modal-only** (inline rows stay terse: preview + opener).
2. **Modal Save semantics** — **draft-update + close** for settings-backed fields (Inference /
   per-agent append → group Save persists); **file-backed editors** (`SOUL.md`/`MEMORY.md`/`SKILL.md`,
   7e-c+) **save directly** via their file API. The modal supports both modes.
3. **`[Load default]` on append fields** — **no** (append default is `""`); only the *replace*
   fields (System prompt → `SOUL.md`) get Load/Restore default, fed by `/api/agent/default-prompt`.
4. **`inherit_append` UI** — **Seg** (`Inherit`/`Ignore`), matching the other `AgentsEditor` knobs.
5. **Skills `SKILL.md`** — keep the **320px inline editor + `Open fullscreen ↗`** opener.
6. **Counter** — **char counter only** (no token dep). Renders chars/cap + % like Hermes
   (`67% — 1,474/2,200`); the 7e-d memory panel reuses it against the configurable caps.

**Hermes caps verified (2026-06-14):** `MEMORY.md` 2,200 chars (~800 tok, `memory_char_limit`),
`USER.md` 1,375 chars (~500 tok, `user_char_limit`), both configurable — our D14 defaults match
exactly. 7e-d should mirror Hermes' config-key names for cross-tool portability.

#### Design audit + D15 (2026-06-14)
A whole-project review (docs vs shipped code) found doc↔code drift and loose specs. **All findings
are tracked in `TODO.md` → "Design audit — 2026-06-14"**; the 7e-blocking specs are **locked in
`DECISIONS.md` D15** (`agent.defaults` merge · `CTRLB_HOME` · agents folder-only (no migration) · `MemoryProvider`
interface + injection · `messages.agent`/resume · `skill_manage` · `session_search` scope/redaction ·
`AgentSelector` seam). Headlines: **`ARCHITECTURE.md`/`DESIGN.md` need a reconciliation pass** (they
predate 7a–7d + D14); the **A1 privilege ladder is already built** in `permissions.decide()`
(downgrade to UX-only); **C1 streaming-both-ways + A2 `question` kind** are doc "day-one" claims that
aren't built; **Utils/D8 registry should reuse `core/tool.py`**; **Phase 5 `run_shell`** — decide
drop vs keep. **Recommended order:** lock D15 ✓ → reconcile `ARCHITECTURE.md`/`DESIGN.md` ✓
(2026-06-14: status banners + D14/D15 fixes; C1/A2 overclaims corrected; A1 downgraded; D8-unify
confirmed) → **build 7e-b (next)**.

#### D15 ratified one-by-one (2026-06-14)
All eight D15 specs were decided with the owner (marked ✅ inline in D15): #1 `agent.defaults` block
(model included) · #2 `CTRLB_HOME` layered/project-root default · **#3 agents folder-only — NO
migration feature** (`agents:[]` removed from schema; existing entries relocated by hand in 7e-c) ·
#4 memory injection mirrors Hermes' format · #5 resume = continue as last turn's agent · #6
`skill_manage` default OFF + **non-blocking propose** (memory same when off) · #7 `session_search`
global + redacted · #8 `AgentSelector` seam locked, algorithm at 7e-g. **Also noted:** composer
**autocomplete/typeahead** for `/`-commands, `/agent`, `/skill` (frontend-only, reuses existing
endpoints) → recorded in ROADMAP A4, lands as a small slice once 7e makes the lists real.

#### State of the tree
- **`origin/main` HEAD `5df69be`** — everything from this session is **pushed**: 7e-a (`d4cd25c`),
  D14 + refinements, D15 + the 8 ratified specs, the whole-project design audit, and the
  ARCHITECTURE/DESIGN reconciliation. Nothing local pending.
- Tree clean except `start_claude_remote.ps1` (owner's launcher tweak — leave it).
- Servers: backend uvicorn **5433** (live, 7e-a verified), frontend Vite **5190** (`--host 0.0.0.0`).
  Tearable down without state loss (config in `config.yaml`, data in `ctrlb.db`).

#### Start here in a fresh session — **build 7e-b**
1. **Build 7e-b** (`<PromptModal>` full-page editor + the 4-item Conf-sizing refine). The **six design
   questions are answered + locked** ("7e-b decisions locked" subsection above) — no blockers. New file
   `frontend/src/components/PromptModal.tsx`; net-new CSS in `extras.css` (vapor.css untouched, D7).
   Wire the four callsites + the `inherit_append` Seg; char counter only. Separate `refine` commit for
   the Conf-sizing items. Verify @390px ×3 themes before calling it done.
2. Then **7e-c → 7e-d → 7e-e → 7e-f → 7e-g** per `TODO.md` + **D14/D15** (the build specs). Note 7e-c
   makes agents **folder-only** (no migration; `agents:[]` removed from schema) and adds `$CTRLB_HOME`
   + the `messages.agent` column.
3. **Both former open items are now decided (2026-06-14):** **Phase 5 = KEEP + build** — the `!`
   prefix is the user-driven **local shell on the backend host** (Claude-Code model: `!git status`),
   target local-only · cwd `shell.workdir` default `$CTRLB_HOME` · output→agent-context · enabled by
   default (`shell.user_exec_enabled`); the agent's `run_shell` stays excluded-by-default. Spec in
   `TODO.md` Phase 5 + D3. **Voice (Phase 6)** confirmed still planned as designed; its config block
   lands when Phase 6 is built. **No open design decisions remain.**

### ⭐ Session update — 2026-06-09 (7e-a backend shipped · 7e-b design discussion locked, paused for review)

Half-session. **7e-a (additive system-prompt axis + show-the-baked-default endpoint) is
committed locally as `d4cd25c`, not pushed.** Then we designed 7e-b out loud — the
`<PromptModal>` shape, callsite list, save semantics, and a 4-item Conf-sizing refine.
**Paused before writing any frontend code** so the owner can answer six design questions
([[pause-between-phases-for-review]]).

#### 7e-a — what shipped (`d4cd25c`)

The 2026-05-30 plan's three open decisions were closed by the owner at the start of session:

1. **Per-agent append vs. global append:** **both apply** with a per-agent `inherit_append: bool`
   opt-out. Mirrors Claude Code's CLAUDE.md model (always added, persona independent).
   Default `True`; flip to `False` for a sandboxed/clean-room persona.
2. **Append as a separate `system` message** (yes): emitted *after* the base prompt, *before*
   the roster and the skills note. Order in `_assemble`: **base → global append → per-agent
   append → roster → skills note → history**. Keeps the base stable as a future cache-key
   candidate; makes the extra easy to attribute when reading logs.
3. **Home phase:** 7e (this is `7e-a`).

##### Files touched

| File | Change |
|---|---|
| `app/config.py` | `InferenceCfg.system_prompt_append: str = ""` |
| `app/domain/agent.py` | `AgentDef.prompt_append: str = ""` + `AgentDef.inherit_append: bool = True` (with docstrings) |
| `app/services/agent/session.py` | New `_appends()` helper; `_assemble` emits 0-2 extra `system` messages right after the base |
| `app/api/agent.py` | New `GET /api/agent/default-prompt` → `{"text": DEFAULT_SYSTEM_PROMPT}` for the editor's `[Load default]` / `[Restore default]` |
| `backend/tests/test_prompt_append_7e.py` | **New, 8 tests** — happy path, whitespace trim, clear-falls-back, built-in default inheritance, per-agent isolation, GET/PUT API shape, multi-line YAML round-trip, default-prompt endpoint |

##### Invariants verified during design

- `apply_settings_inplace` rebinds `cur.inference = new.inference` → `_appends()` reads
  `self._settings.inference.system_prompt_append` lazily, so a hot-apply lands immediately.
- `_finalize` adds its wrap-up `system` message **after** `_assemble`, so appends still lead.
- Compaction operates on **persisted** messages only; new system blocks are constructed fresh
  per turn from live Settings → no interaction with the rolling summary.
- The resume path goes through `_drive` → `_assemble`, so resumed turns also see appends.

##### Test status

All backend suites green: **7a 7 · 7b 2 · 7c 4 · 7d 2+1+1 · 7e 8**; `compileall` clean.
Writes were exercised against `tempfile.mkdtemp()` via `CTRLB_CONFIG` / `CTRLB_DB`
(per [[test-write-endpoints-on-temp-config]]) — **never the real `config.yaml`**.

##### Live verification status

**Not yet live-verified.** Backend on 5433 is still running the pre-`d4cd25c` build — needs a
restart to load the new endpoint + the `_appends()` plumbing. Restart command (per the Windows
`--reload` gotcha):

```powershell
# kill the running uvicorn on 5433, then:
cd dashboard_v2/backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 5433
```

The smoke checks worth doing after restart:
1. `GET /api/agent/default-prompt` returns the baked `DEFAULT_SYSTEM_PROMPT` text.
2. Send a chat turn with `inference.system_prompt_append` set → confirm the model honors it
   (e.g. set append = "Always sign off with 'cheers'." and watch the reply).
3. Set `AgentDef.inherit_append=False` on one agent + global append set → that agent doesn't
   inherit; default agent does.

#### 7e-b — design discussion (paused for owner review)

**Scope:** one reusable `<PromptModal>` + wire 7e-a's UI fields + 4-item Conf-sizing refine.
The original 7-item Conf-sizing list collapses: items 1-3 (System prompt / per-agent Prompt /
SKILL.md textareas) are absorbed into the modal pattern, item 7 is moot.

##### `<PromptModal>` proposed shape

```
┌──────────────────────────────────────────┐
│ ‹ Title (e.g. "System prompt")       ✕  │  ← .mhead style
├──────────────────────────────────────────┤
│  [ monospace textarea, fills viewport ] │
├──────────────────────────────────────────┤
│  1,247 chars                            │  ← char counter, dim
│  [Load default] [Restore default]       │  ← contextual (System prompt only)
│  [Cancel]                       [Save]  │
└──────────────────────────────────────────┘
```

- Reuses the existing `100dvh` + `--app-h` viewport shell from `App.tsx` (Android keyboard).
- Focus trap + Escape-to-cancel + focus restore on close — same pattern as ConfirmDialog (F17).
- **Net-new CSS lives in `extras.css`; `vapor.css` stays untouched** (D7).

##### Callsite inventory

| Where | Inline shows | Modal opens with |
|---|---|---|
| Conf → Inference → System prompt | Preview ("override active · 1.2k chars · 'You are…'" or "empty — using baked default") + `Edit fullscreen ↗` | Title "System prompt"; footer `[Load default]` + `[Restore default]` |
| Conf → Inference → System prompt append **(new, 7e-a)** | Preview + opener | Title "System prompt append"; plain footer (no Load default — see Q3) |
| Conf → Agents → per-agent Prompt | Preview + opener | Title "Agent prompt: \<name\>"; footer `[Load default]` |
| Conf → Agents → per-agent Append **(new, 7e-a)** | Preview + opener; paired with the `inherit_append` Seg | Title "Agent prompt append: \<name\>" |
| Conf → Skills → SKILL.md editor | **Keep** existing 320px inline + add `Open fullscreen ↗` opener | Title "Skill: \<name\>"; footer `[Remove skill]` |

##### Save semantics

Modal `[Save]` updates the **parent Conf group's draft state**, then closes. The user still
hits the group-level `Save` button to persist. This matches the existing Inference/Agents/
Skills group-save pattern. Modal `Save` does **not** hit the backend directly. `Cancel`
discards the modal-local edit. (The `beforeunload` listener from F19 catches reload-with-dirty
if the user forgets the group Save — known limitation of F29 option A not being shipped yet.)

##### Conf-sizing refine — the 4-item list to bundle

1. `.mform` label column — widen 90 → 100-110px or allow `label` to wrap to 2 lines (long
   labels like "Subagent fan-out limit" wrap awkwardly @390px).
2. Agents → Limits grid — switch 3-col → 2-col at viewport ≤ 420px.
3. `.confrow` `word-break` audit on masked secrets / long URLs that don't render through
   `.k .desc` (which vapor already breaks).
4. Decision: separate `refine(dashboard_v2): 7e Conf sizing` commit so the modal slice's diff
   stays focused.

##### Six design questions waiting on owner

1. **`[Load default]` placement:** modal-only (recommended — keeps inline rows terse) vs.
   inline next to the field as well?
2. **Modal Save semantics:** draft-update + close (recommended — matches current Conf group
   flow) vs. direct backend write per-field?
3. **`[Load default]` on append fields?** Recommended **no** — the default of an *append* is
   `""`, there's nothing to load. The replace fields (System prompt, per-agent Prompt) get it.
4. **`inherit_append` UI shape:** Seg (`Inherit` / `Ignore`, matching how other bool/enum knobs
   render in `AgentsEditor`) vs. plain checkbox row? Recommended Seg for consistency.
5. **Skills SKILL.md:** keep 320px inline **plus** `Open fullscreen ↗` (recommended — SKILL.md
   benefits from in-place editing) vs. shrink to preview + opener like the others?
6. **Char counter only**, no token counter? (Token counter would need the tokenizer + isn't
   worth the dep.)

#### State of the tree

- **Local HEAD: `d4cd25c`** (1 commit past `origin/main`'s `40f94e8`). **Not pushed**;
  push needs owner go-ahead.
- Tree clean except `M start_claude_remote.ps1` (owner's launcher tweak — see the
  2026-06-08 block + standing rule: leave it untouched).
- **Servers up:** backend uvicorn on **5433** (corsair, no `--reload`) — **but still serving
  pre-`d4cd25c` code**, restart needed to live-verify 7e-a (see command above). Frontend Vite
  dev on **5190** (`--host 0.0.0.0` for Tailscale phone access). Either tearable down without
  state loss.
- **Phone access URL (Tailscale):** `http://corsair:5190` (or `http://100.76.212.35:5190`).

#### Start here in a fresh session

1. **Answer the six 7e-b design questions** at the bottom of the 2026-06-09 block. ~5 min;
   recommendations are pre-filled, so just confirm or override.
2. **Restart backend 5433** to live-verify 7e-a (command above). Smoke checks listed.
3. **Build `<PromptModal>` (7e-b)** following the locked answers. New file
   `frontend/src/components/PromptModal.tsx`; net-new CSS in `extras.css`. Wire the four
   callsites + the new `inherit_append` Seg. Char counter (no token counter).
4. **Bundle the 4-item Conf-sizing refine** as a separate commit (see list above).
5. **Push `d4cd25c` + the 7e-b commits** after the owner D7 eyeball at 390px × 3 themes.
6. Next: 7e-c (`prompts/*.md` editors), then 7e-d (memory panel on the 4f embeddings seam).

### ⭐ Session update — 2026-06-08 (UI_AUDIT.md §6c F14–F26 a11y/resilience backlog — closed end-to-end)

Long session. Closed the entire F14–F26 backlog the 2026-06-02 audit had filed, plus a
discovered F28/F29 and a UX miss on the Conf Save button. **13 commits, all pushed to
`origin/main` (HEAD `40f94e8`)**, tree clean.

#### What shipped (in chronological order)

| # | Slice | Audit ID | Commit | One-line |
|---|---|---|---|---|
| 1 | A1 | F25 | `ab24a27` | Global `:focus-visible` magenta ring — WCAG 2.4.7 fix on ~30 buttons that were doing `all: unset`. |
| 2 | A2 | F14 | `ab24a27` | DeviceRow `.top` ARIA button pattern (can't be `<button>` because of nested action buttons); Hero `.now-dots` → real `<button>`s. |
| 3 | B | F15 | `fa0742d` | "Motion" toggle in Conf → Appearance (not OS-driven `@media (prefers-reduced-motion)` — owner reframed it as a per-user preference). First-install default honors the OS query. |
| 4 | C1 | F23 | `98f30f0` | Root ErrorBoundary inside QueryClientProvider + React 19's `createRoot` `onUncaughtError`/`onCaughtError` hooks. Researched react-error-boundary lib — chose to keep the custom 50-LOC component (the "similar code for the same thing we already own" trap). |
| 5 | C2 | F22 | `f647ee7` | `aria-hidden` sweep on 13 decorative `.chev`/`.arrow`/`.svc-chev`/`.conf-chev` sites. |
| 6 | D1 | F17 | `c7bd0d9` | ConfirmDialog focus trap (Tab ↔ Cancel/Confirm) + focus restoration + scoped keydown (was on window) + `aria-labelledby`/`aria-describedby`. Did NOT migrate to native `<dialog>` — CSS port risk against the Vapor design. |
| 7 | D2 | F18 | `25d942c` | TabBar WAI-ARIA tabs pattern: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, roving tabindex, arrow-key nav (auto-activation). Each top-level tab container gets `role="tabpanel"` + `aria-labelledby`. |
| 8 | E0 | F28 | `3b2e45c` | **Discovered mid-session by owner:** composer textarea was uncontrolled; switching to Conf/Utils dropped the draft. New `store/composer.ts` (mirrors `store/ui.ts`) — controlled textarea, persisted to localStorage. Survives tab-switch + reload. |
| 9 | E1 | F19 | `4ea10a9` | New `store/dirty.ts` cross-editor dirty registry + `beforeunload` listener in App.tsx. Conf / Agents / Skills editors each register their existing `dirty` expression via `useRegisterDirty()`. |
| 10 | F29-fix | F29 | `6f6c7e9` | **Discovered while wiring E1:** `ConfGroup` was `{!collapsed && children}`, so collapsing a group mid-edit unmounted the editor and dropped the draft. Fixed via option B (keep children mounted, CSS-hide the body). |
| 11 | E3 | F26 | `76b8490` | `useRegisterSW({ onNeedRefresh })` → sticky info toast with a "refresh" action. Extended `store/toast.ts` with optional `action` + `sticky` (backwards-compatible). |
| 12 | F1 | F16 | `be86f40` | SSE event-stream error handler + manual exponential-backoff reconnect (browser stops auto-retrying at `readyState=CLOSED` once Vite's proxy returns 5xx). New `store/connection.ts` + `.conn-badge` in AppBar (`role="status"`, magenta pulsing dot for "reconnecting", danger-rgb dot for "disconnected"). Reconcile-after-reconnect calls `qc.invalidateQueries()` *and* `reloadChat()` (chat isn't a React Query consumer). **Second connection-health signal added in F2 below.** |
| 13 | F2 | F20 | `40f94e8` | Chat-stream retry affordance. **Audit's fix-sketch was wrong**: `/api/agent/resume` is only for confirm-gated suspension (`call_id`+`confirm_token`), not network drops. Phase A landed: `retryLastTurn()` walks back to the user message, truncates the failed turn, calls `sendMessage()` for a clean re-run. `failStream` now also fires when the loop exits with `!settled` (server killed mid-stream without a terminal event). Cross-channel `setConnection("reconnecting")` on chat-fetch failure. Plus: global React Query QueryCache observer in `useEvents.ts` — any cache entry in error state → "reconnecting" — much more reliable than EventSource's silent-drop detection. |
| + | UX fix | — | `dc98486` | Owner caught: Save button was only at the bottom of `Open-terminal` (the 5th of 5 saveable Conf groups). Refactored to render `{saveBar}` at the bottom of each: Inference / Server / SearXNG / Embeddings / Open-terminal. |

#### Deferrals + future-only notes

- **F21 → Phase 6.** The mic stub honest-disable was reframed as Phase 6 (Voice / STT / TTS).
  Owner's call: "I want the features and issues handled in their own phase if possible."
  TODO.md Phase 6 gains the explicit mic-button state-machine checkbox; UI_AUDIT.md F21 is
  marked `🟦 DEFERRED TO PHASE 6` with a resolution block. **New feedback memory recorded:**
  [[fix-in-the-owning-phase]].
- **F29 option A** (reload-survival for sub-editor drafts via `store/composer.ts`-style
  lifting) — recorded in UI_AUDIT.md §6b. Two design decisions to lock when it ships:
  conflict policy when server-persisted state diverges, and scope key for multi-instance
  editors.
- **F27** (offline-row screen-reader indicator) — recorded in UI_AUDIT.md §6c.
- **F24** (axe-core CI gate) — Phase 9 already owns it.
- **HMR-safe store modules** — recorded in UI_AUDIT.md §6b. **Dev-only ergonomics, zero
  production impact.** We hit this hard during live F2 testing in Firefox: editing
  `store/chat.ts` left React subscribers attached to the old module's listeners Set while
  the new module's `set()` calls notified an empty new Set, so UI silently didn't update.
  Verified F2 works end-to-end via **Playwright headless Chromium** (debug-f2.mjs, since
  deleted). Fix is `if (import.meta.hot) { import.meta.hot.dispose(data => …); }` — ~12
  lines per store. Apply to `chat.ts` first if it bites again.

#### Recurring feedback memories saved this session

- **[[pause-between-phases-for-review]]** — after each slice, summarize what changed +
  wait silently for go-ahead. No batching, no momentum-continue. Owner caught me drifting
  into a parallel preference channel (OS `@media` motion gate) when `UIState` + an
  Appearance Switch already modeled user prefs. Compounded by the existing
  [[commit-autonomously-clearly]].
- **[[fix-in-the-owning-phase]]** — see F21 above.
- **CLAUDE.md + AGENTS.md** both gained a new Hard Rule: *"Don't duplicate existing
  patterns — in either direction."* Two failure modes named: (1) different code for similar
  things (parallel implementation bypassing an existing pattern); (2) similar code for the
  same thing we already own (pulling in a dep that overlaps with our own code). Consistency
  by construction beats cleanup after the fact.

#### State of the tree

- **Origin/main HEAD: `40f94e8`** (10 + 3 commits past `3ca412a` at session start).
- Tree clean; no uncommitted work; nothing local pending push. **Includes the launcher's
  `start_claude_remote.ps1` effort-tweak left untouched** (owner's personal config).
- **Servers left running:** backend uvicorn on **5433** (corsair, no `--reload`, venv at
  `dashboard_v2/backend/.venv` — restarted many times during F1/F2 live testing). Frontend
  Vite dev on **5190**, `--host 0.0.0.0` for Tailscale phone access. Either can be torn
  down without state loss — config in `config.yaml`, chat/events/memory in `ctrlb.db`.
- **Phone access URL (Tailscale):** `http://corsair:5190` (or `http://100.76.212.35:5190`).

#### Start here in a fresh session

1. **Pick the next focus** (ranked at the top of this block):
   - **Recommended: prompt-append + Conf-sizing (7e-a).** Direction locked 2026-05-30 — go
     read that block below for the three decisions to confirm + the seven-item Conf-sizing
     checklist. Should be a clean, ~half-day slice.
   - **Then: 7e proper** (prompts editors for arbitrary `prompts/*.md` + memory panel on
     the 4f embeddings seam).
2. **Heads-up on dev workflow:** if you find yourself editing `store/*.ts` modules
   repeatedly and the UI behaves oddly between edits, hard-quit the browser (not just
   refresh). Or ship the HMR-safe pattern from UI_AUDIT.md §6b first.
3. **No live verification regrets:** F1's reconnect badge was verified live; F2's retry
   button was verified via Playwright. If a future session wants a live-Firefox check of
   F2, kill the backend, send a chat message, and the bubble should show
   `// <error> [retry]` within a couple of seconds.

### ⭐ Session update — 2026-06-02 (UI perf pass shipped end-to-end + follow-up audit recorded)

Long session. Two distinct things shipped:

**Part 1 — UI perf pass complete (Slices 1–8 of `docs/UI_AUDIT.md`).** Eight commits closed
10 of the 13 perf-pass findings. Commits, in order:
- `5906ba3` — Slices 1–6 + cross-OS docs (the bulk). Bundle analyzer, PWA icon fan-out,
  hoist constants, AgentTab memoize, Hero/NowPanel/FleetSummary memo (Waveform deliberately
  not — see F2 caveat), transition audit (3 surgical edits), body-attr mirroring into
  `setUI()`, `useScopedQuery` for Conf-only queries, lazy `ConfTab` + Suspense + idle
  prefetch. Plus the OS-agnostic docs + the Windows `--reload` ping gotcha (documented in
  CLAUDE.md, ARCHITECTURE.md §6, README.md, main.py). Plus configurable
  `feature_cycle_seconds`, sub-millisecond ping precision (corsair self-ping reports 0.5ms
  now), Vapor-themed conic-gradient busy spinner.
- `40cc5fa` — Slice 6 follow-up. The first ship of Slice 6 had two bugs found in a
  post-implementation audit (chunk fetched on mount instead of on intent; Suspense
  fallback overlaid the active tab during download). Fixed via conditional-mount
  (`confMounted` state) + a small reusable `components/ErrorBoundary.tsx` that catches
  stale-chunk-after-deploy failures.
- `d915d57` — Slice 7 (`useUISlice` selector pattern). Audit had claimed 25 `useUI()`
  consumers; actual count was 5 (App, TabBar, AppBar, FleetTab, ConfTab). All migrated;
  `useTabActive` rewritten as a one-line wrapper over `useUISlice`; `useUI()` kept
  `@deprecated` as an escape hatch.
- `e944ec7` — Slice 8 (F7 — `lucide-react` audit). Found the dep was dead (never imported;
  zero bytes in the build). Removed. Bundle hashes pre/post identical. Bundle is now
  ~70% React itself; no further legitimate trim targets.

Final bundle: main 282 KB / 86.7 KB gz · lazy ConfTab 45 KB / 11.4 KB gz · CSS 60.8 KB /
11.5 KB gz. First-paint cost ≈ 99 KB gz (Main JS + CSS).

**Part 2 — Follow-up audit recorded (`1c4a35e`).** A second pass focused on areas the
perf pass deliberately deferred: **accessibility, resilience, edge-case correctness**.
13 new findings (F14–F26) documented in `docs/UI_AUDIT.md` section 6c. No implementation
in this pass — pure documentation with severity, mechanism, safety verdict, and a fix
sketch each. Critical ones (🔴, keyboard users functionally blocked today): **F25** (`all:
unset` wipes focus outlines on ~30 buttons — WCAG 2.4.7 AA fail), **F14** (interactive
`<div>`s in DeviceRow + Hero now-dots — keyboard skips them), **F15** (37 animations
ignore `prefers-reduced-motion`). Resilience (🟡): **F16/F20** (SSE + chat-stream have no
reconnect signals), **F23** (no root `ErrorBoundary` outside the Conf lazy chunk).
Polish/UX/future-proofing (mostly 🟢): F17 (ConfirmDialog focus trap), F18 (TabBar ARIA
tablist + arrow keys), F19 (`beforeunload` on dirty Conf), F21 (mic stub disable), F22
(decorative-glyph `aria-hidden`), F24 (axe-core CI gate — already TODO Phase 9), F26 (SW
update toast). UI_AUDIT.md footer documents the recommended implementation order.

#### State of the tree
- Eight commits ahead of `origin/main`. All 7d/perf/audit work is local. Pushing all
  needs owner confirmation (per the standing rule).
- No uncommitted changes (working tree clean as of this session end).
- Servers as left running this session: backend on **5433** (corsair, no `--reload` per
  the Windows gotcha; venv at `dashboard_v2/backend/.venv`); frontend Vite dev on **5190**
  with HMR. Either can be torn down without state loss — config in `config.yaml`,
  chat/events/memory in `ctrlb.db`. The dev server has cycled HMR through most files
  many times this session — all clean.

#### Start here in a fresh session
1. **Decide pushing the eight local commits.** Tree is clean at `1c4a35e`; safe to push.
2. **Pick the next direction:**
   - **a11y backlog (F14–F26)** — concrete fix sketches are in `docs/UI_AUDIT.md` §6c with
     a recommended order in the doc footer. F25 (one-line global focus rule) +
     F14 (interactive divs → buttons) + F15 (`prefers-reduced-motion` media block) are the
     highest-leverage; together they restore keyboard usability and reduced-motion
     respect.
   - **prompt-append + Conf-sizing (7d follow-up / 7e-a)** — direction locked 2026-05-30
     (block below). `Settings.inference.system_prompt_append` + optional per-agent
     `prompt_append` + a `<PromptModal>` full-page editor. See that block for the locked
     decisions and the seven-item Conf-sizing checklist.
   - **7e proper** — prompt-file editors for arbitrary `prompts/*.md` + a memory panel
     built on the 4f embeddings seam.
3. **Bundle analyzer is wired** — every `npm run build` writes `dist/stats.html`. Open it
   if you ever want to see the treemap.

### ⭐ Session update — 2026-05-30 (planning · system-prompt direction set · 7d wrap)

A short planning session. No code shipped; direction locked for the next slice.

#### State of the tree
- **4 local commits on `main`, none pushed:** `c47bb1a` 7d-a · `16c160f` 7d-b · `293ee2f` 7d-c ·
  `eb5ce4a` docs. Push needs owner go-ahead (per the standing rule).
- **Two uncommitted Conf CSS refinements** sitting in the working tree (from late polish):
  1. **Skills · SKILL.md editor** restructured to render *outside* the `.mform` grid, self-styled,
     **320px min-height** (up from 200), 10px gap above the `.mfoot` so the editor sits clearly above
     the remove/save buttons. (`extras.css` `.kv-text.skill-md` rewritten as standalone.)
  2. **Agent tools · category heading** got `padding: 0 14px 4px` (matches `.confrow`) so the
     uppercase letter-spaced "FLEET" word clears `.conf-card`'s `border-radius: 14px` +
     `overflow: hidden`. Was being cropped on the left.
  Fold both into a single `refine(dashboard_v2): polish 7d Conf` commit at the start of tomorrow's
  session, before the new work.
- **Servers up:** backend on **5433** (venv, serving 7d code — relaunched today after killing the
  stale system-python that was on the port; see the same trap noted in the 2026-05-28 block) and
  frontend on **5190** (Vite HMR). Leave them up or restart in the fresh session — either is fine.
- **Owner D7 eyeball pending:** Agents / Skills / Agent-tools forms @390px × 3 themes. A live check
  that `/agent <name>` switches the agent and that an edited tool description shifts the model's pick.

#### Research delivered + direction locked
The owner asked how opencode, little-coder, and Claude Code handle the system prompt. Findings:

- **Claude Code (Agent SDK)** — baked `claude_code` preset (text not user-editable). Four
  customization layers, each explicitly *append* or *replace*: **`append`** to the preset (additive,
  recommended default · "lowest-risk"), **custom string** (full replace), **output styles** (markdown
  files; replace by default, `keep-coding-instructions: true` flips to extend), **CLAUDE.md** (injected
  as *conversation context*, not the system prompt — always additive, auto-discovered).
- **opencode** — assembles `AGENTS.md`/`CLAUDE.md` discovered instructions (additive, FS + URL) →
  then agent-specific prompt (defined in `opencode.json` or `.opencode/agents/*.md` frontmatter+body,
  replace). Same two-axis model.
- **little-coder** — deliberately **lean ~1000-token base** + 4 tools, then **30 markdown skill
  files** injected on demand by extensions. Whole thesis is "scaffold–model fit" for small local
  models (9.7B Qwen 19%→45% on Aider Polyglot). Validates our `fleet` intent-skill +
  `KeywordSkillSelector` approach: don't grow the base, lean harder on skills.

**Common pattern:** baked base · two customization axes (additive layer + replaceable persona) ·
specialization in injected fragments (skills), not the base.

**Where ctrl-b sits today:** baked `DEFAULT_SYSTEM_PROMPT` → `inference.system_prompt` (replace) →
`agent.prompt` (replace) + skills injection. **We're missing the additive axis** (the
`append`/AGENTS.md equivalent) and a way to *see* the baked default. That's the gap A + B close.

**Owner-locked plan:**
- **A — additive layer:** new `inference.system_prompt_append: str` (+ optional per-agent
  `prompt_append`). Effective context = base + an append, **emitted as its own `system` message**
  (separate from the base — mirrors how the roster and active skills are injected; keeps the base
  prompt stable for any future caching, makes the "extra" easy to attribute in logs).
- **B — show the default:** `GET /api/agent/default-prompt` returns the baked text + the prompt
  editor gets a "Load default" button (pre-fills the override field with a copy) and a "Restore
  default" button (clears the override → falls back to baked). Removes the "blank = mystery" UX.

**Decisions to lock at the start of tomorrow's session (~5 min):**
1. **Per-agent append vs. global append composition:** does `AgentDef.prompt_append` *layer onto*
   `inference.system_prompt_append`, or *replace* it? Claude Code's analog has them independent
   (CLAUDE.md always added, persona independent), suggesting **both apply** with an opt-out flag per
   agent (e.g. `inherit_append: false`). Confirm.
2. **Append as a separate `system` message** (lean: yes, clean + cache-friendly + visible in logs)
   vs. concatenated to the base. Confirm.
3. **Home phase:** A + B fit naturally in **7e** ("prompts editors + memory panel"); folding the
   baked default into a "default" prompt asset is also 7e-shaped (option D from the research). Confirm
   7e as the home so 7d stays the finished slice — or call it `7d-d`.

#### UX proposal — full-page prompt modal (the "small text fields" fix)

Owner reaction was right: textareas inside `.mform` rows / `.conf-textrow` are too small for a real
prompt. Proposal:

- **One reusable `<PromptModal>`** — full-viewport overlay, opened from any prompt field by an inline
  **"Edit fullscreen ↗"** button. Uses the same `100dvh` + `--app-h` (`visualViewport.height`) shell
  the app already runs (`App.tsx`), so the Android keyboard shrinks the modal correctly.
- **Layout:** header (title + close) · tall monospace `<textarea>` filling the body · char/token
  counter · footer `[Load default] [Restore default] [Cancel] [Save]`. For SKILL.md the footer adds
  `[Remove skill]`.
- **Opens from:** Conf → Inference → System prompt; Conf → Agents → per-agent Prompt; Conf → Skills
  → SKILL.md editor. The inline row keeps a 1-line preview (`override active · 1.2k chars · "you are
  ctrl-b, a concise assistant…"`) so the Conf list stays scannable.
- **Why a modal over a sub-page:** matches the mobile-first single-window design, reuses the shell,
  no tab-state plumbing. A "Prompts" sub-page can come later in 7e if the count of editable prompts
  grows.
- **Alternatives considered:** inline expand (fights with fixed composer/tab bar), bottom sheet
  (visually identical to a modal on mobile, more code).

#### Conf sizing/cropping inventory (one `refine` commit)

Group these into one `refine(dashboard_v2): conf sizing` commit so the diff is reviewable:

1. **Inference → System prompt textarea** (`.conf-textarea` 64px, max-width 62%) → replace with the
   "Edit fullscreen ↗" button + 1-line preview.
2. **Agents → per-agent Prompt** (`.kv-text` 48px inside `.mform`) → same opener.
3. **Skills → SKILL.md editor** — keep the inline 320px (already polished in the working tree) but
   add an "Open fullscreen ↗" button for long files.
4. **`.mform` grid** (90px label / 1fr value) — long labels ("Subagent fan-out limit", "Clamp
   subagent privilege") wrap awkwardly at 390px. Either widen the label column to 100–110px or allow
   `label` to wrap to 2 lines.
5. **Agents → Limits grid** (3 columns) — tight at 390px; switch to 2 columns at viewport ≤ 420px.
6. **Masked secrets / long URLs** in `.confrow` — audit `word-break` on values that don't render
   through `.k .desc` (which vapor already breaks).
7. **Fold the two CSS refinements in the working tree** (tooldesc heading padding + skill textarea
   bigger) into this same commit.

#### Start here tomorrow

1. **Lock the three decisions above** (yes/no in 5 min).
2. **`refine(dashboard_v2): polish 7d Conf` commit** — pick up the two uncommitted CSS refinements
   in the working tree (skills textarea standalone + 320px, tooldesc heading padding). Verify @390px.
3. **Push 7d (4 commits + polish)** to `origin/main` after the owner eyeball — or hold per the
   standing rule.
4. **Slice the prompt-append + default-prompt slice (`7d-d` or `7e-a`):**
   - Backend: `Settings.inference.system_prompt_append` + optional `AgentDef.prompt_append` + the
     inheritance flag. `_system_prompt()` returns the base; `_assemble()` emits a *second* `system`
     message carrying the append (and a third if per-agent append exists, depending on the
     compose decision). `GET /api/agent/default-prompt` returns the baked text. Tests:
     `test_prompt_append_7e.py` — base + global append + per-agent append round-trip through
     `_assemble`; endpoint returns the default text.
   - Frontend: `<PromptModal>` (one component), wired from Conf → Inference / Agents / (optionally)
     Skills SKILL.md. Inline rows shrink to "preview + Edit fullscreen ↗".
5. **Slice the Conf-sizing refine** (the 7-item list above) as a separate commit so the diff stays
   reviewable.
6. After both: the rest of **7e** (prompt-file editors for arbitrary `prompts/*.md` + the memory
   panel built on the 4f embeddings seam) is unblocked.

### ⭐ Session update — 2026-05-29 (Phase 7d — skills/agents management + per-tool descriptions)

**Built + verified + committed locally** (`7d-a` per-tool descriptions · `7d-b` agents UI · `7d-c`
skills UI; **not yet pushed**). Conf gains the last management groups so agents/skills/tool-wording
are all UI-editable — no more hand-edited YAML for these. The big lever here is that the agent picks
tools by their model-facing **description**, so editing those steers a weak local model (the
2026-05-28 finding) without code.

- **7d-a — per-tool description overrides:** `Settings.tool_descriptions` (name→text) +
  `runtime.apply_tool_descriptions` overlays them onto the **live registry specs** — the single seam
  both `GET /api/actions` and `to_openai_tools` read, so the model + the UI reflect a change at once.
  Originals are captured once on `app.state.tool_desc_orig` so **clearing an override restores the
  built-in**. Wired in lifespan (after every provider registers), `reconfigure` (when the section
  changed), and at the end of `rediscover_integrations` (fresh MCP/OpenAPI specs pick overrides up).
  Edited via the existing `PUT /api/settings`. Conf → **Agent tools** group (collapsed): agent-exposed
  tools grouped by category, editable description each, blank = reset.
- **7d-b — Agents management** (`components/AgentsEditor.tsx`, `hooks/useAgents.ts`): a group-level
  draft saved through `PUT /api/settings` — the **whole `agents` list is replaced** (deep_merge
  replaces lists) and the `agent` section deep-merges, in one PUT; the full agent objects round-trip
  so unexposed fields (compaction, extras) survive. Per-agent form: name (add-only), backend
  (inherit/local/cloud) + model id, privilege Seg, prompt, a **tools tick-grid** (all vs explicit
  subset), a **skills mode** (all/none/custom + tick-grid), and a **loop/subagent limit grid**. Plus
  default-agent select + subagent fan-out limit + clamp-privilege toggle. **`/agent <name>` composer
  switch** (sticky per session, bare = default — same non-persistent caveat as `/local`//`/cloud`):
  `ChatRequest.agent` → `_session(agent_name)` override (resume uses thread/default); `GET /api/agents`
  returns names+default for the composer + UI.
- **7d-c — Skills management** (`components/SkillsEditor.tsx`, `hooks/useSkills.ts`): master
  `skills_enabled` toggle (via `PUT /api/settings`), the discovered-skills list, a **raw `SKILL.md`
  editor** + add/remove via new **`GET/PUT/DELETE /api/skills/{name}`** (slug-guarded against
  traversal → 422; EOL-preserving; a blank PUT writes a frontmatter scaffold; DELETE removes the file
  + an empty folder, keeping sibling resources). The `FileSkillProvider` re-scans per call, so edits
  are **live, no restart**.
- **Frontend shape:** all three reuse the vapor `.mwrap`/`.mform`/`.mfoot` recipe + the 7a/7c
  `.conf-textarea`/`.kv-text` inputs; net-new CSS only (tick-grid, limits grid, `.skill-md`) in
  `extras.css` — **`vapor.css` untouched (D7)**. Conf groups renumbered 01–12 (Agents 08, Skills 09,
  Agent tools 10, Computers 11, Appearance 12); all collapsible with persisted state.
- **Verified:** `test_tool_descriptions_7d.py` 2/2 · `test_agents_7d.py` 1/1 (StrEnum privilege
  round-trip = audit A1 exercised live, hot-apply via `resolve_agent`, `/api/agents`, 422 on bad
  privilege, clear→built-in default) · `test_skills_7d.py` 1/1 (scaffold + live discovery, overwrite +
  re-parsed description/allowed_tools, slug-guard 422, delete + 404). **All backend suites green** (7a
  7 · 7b 2 · 7c 4 · 7d 2+1+1); `compileall` + `tsc -b` + `vite build` clean. **Writes tested on a temp
  config/skills dir only** (audit E3).
- **Owner D7 eyeball pending:** the **Agents**, **Skills**, and **Agent tools** forms @390px across
  vapor/aqua/ember — and a live check that `/agent <name>` switches the agent and an edited tool
  description actually changes the model's tool pick.

### Earlier baseline (Phase 4.5 + 2026-05-28 capability/UX session)

**Everything through Phase 4f is committed + pushed to `origin/main`** (4a `f9e9965` · 4b `6c2d181`
· 4c `b44c039` · 4d `df612e3` · 4e `60f8e68` · vite-host fix `f2774b8` · **4f**: web_search `05e5a48`
+ links `271c0b3` · MCP `e148a41` + risk `2ed987d` · open-terminal `c4ec84c` · OpenAPI `a4e3e86` ·
embeddings `97e4f89` · **Agent-tab polish**: collapse tool command bubbles by default `9d1b1e2` ·
group a thinking block with the tool call it produced `73fe813` · inset fix `5b41dfb` · **MCP stdio
transport `874cdb1`**). **Phase 4.5 (skills + agents/subagents) is committed + pushed to `origin/main`
(through `591cc5b`):** AgentDef spine `c964237` · skills `e2c90e8` · subagents `e84797f` · 4.5 docs
`ba11479` · **subagent parameter inheritance** `b407cec` + docs `70571c4` · **tool-description fallback
fix** `f72ccb0`. The 4e/4f file lists below are reference.

### ⭐ Session update — 2026-05-29 (Phase 7c — integrations panel)

**Built + verified + pushed to `origin/main`** (7c-a `455ae8c` · 7c-b `7804212` · collapsible-Conf
polish `e99ea49`; tree clean). Conf gains an integrations panel; the agent's external endpoints are
UI-managed. Two apply paths, by design (owner's call):

- **7c-a — scalars hot-apply** (`455ae8c`): SearXNG / embeddings /
  open-terminal groups edit through the existing `PUT /api/settings`. `runtime.py` gained async `set_searxng`/
  `set_embeddings`/`set_open_terminal` single-source builders (await old `aclose`, rebuild, repoint
  `app.state.*` **and** `deps.*`), called by both lifespan and `reconfigure` (no drift). `reconfigure`
  rebuilds each only when its section changed. No restart.
- **7c-b — MCP + OpenAPI managers + rediscover:** `api/integrations.py` (list CRUD keyed by name,
  comment/secret-safe via `edit_config_yaml`+`sync_mapping`; `_minimal` trims defaults so the YAML
  stays hand-written-style), `GET /integrations/status` (per-server discovered-tool summaries +
  `dirty` flag), `POST /integrations/rediscover`. **Apply between turns, never mid-turn** (the safe
  design for live-registry mutation): a write flips `app.state.integrations_dirty`; `api/agent.chat`
  re-discovers **before** building the turn's toolset when dirty; the manual **Rediscover** button
  applies on demand and **409s while `active_turns>0`** (counter bumped around `run_turn`).
  `ToolRegistry.remove`/`remove_category("mcp")` (MCP + OpenAPI both register as `"mcp"`) clears the
  bucket before re-running both providers' `discover()` under `app.state.discovery_lock`. No restart.
- **Frontend:** `components/ServerListEditor.tsx` (reuses the vapor `.mwrap`/`.mform`/`.mfoot` shell;
  MCP transport `Seg` toggles http url+headers ↔ stdio command+args+env; OpenAPI base/spec/auth/
  include; headers/env/args via compact `.kv-text` textareas — net-new in `extras.css`). Each row
  shows its discovered-tool count or error from the status. `hooks/useIntegrations.ts` (status +
  CRUD + rediscover); name is read-only on edit (rename = delete+add). `vapor.css` untouched (D7).
- **Verified:** `test_integrations_7c.py` (scalar hot-apply rebuilds client+deps; MCP CRUD + dirty +
  409 dup + 404; rediscover busy-409 + empty-ok clears dirty; registry remove). All suites green
  (7a 7/7, 7b 2/2, 7c 4/4); `compileall` + `tsc -b`/`vite build` clean. Backend relaunched on 5433 —
  `GET /integrations/status` works (emma's `web-tools` currently shows a discovery error since emma
  is unreachable right now — failure-isolation surfacing it; Rediscover when it's up).
- **Collapsible Conf sections** (`e99ea49`): all 9 `.confgroup` headers now collapse via a leading
  magenta `›` chevron (design unchanged); open/closed state persists per-section in `localStorage`
  (`store/collapse.ts`). Default expanded.
- **Note:** MCP discovery wraps connection failures as "unhandled errors in a TaskGroup (1 sub-
  exception)" — ugly but harmless (0 tools registered, surfaced in the row). Friendlier error
  extraction is a small follow-up. **Owner D7 eyeball pending:** integrations forms @390px ×3 themes.

### ⭐ Session update — 2026-05-29 (Phase 7b — hosts + services CRUD)

**Built + verified + pushed** (`e325468` + services-collapse `d80a1f1`). The Conf → Computers group
is now a real editor: add / edit / delete machines (Vapor machine forms) **and** their services.

- **Backend `api/hosts.py`:** `POST /api/hosts`, `PUT /api/hosts/{id}`, `DELETE /api/hosts/{id}`.
  GET `_host_dto` gained **`has_password`** (bool — never the value) + **`services[]`** (full `cmd`
  map). Blank password on PUT keeps the stored secret (audit A2). **Rename** re-keys the entry via
  `comps[new] = comps.pop(old)` (preserves the node's inner field comments) + re-slugs the id.
  Service add/remove handled by `sync_mapping` (removed keys disappear). Each op validates via
  `ComputerCfg.model_validate` (422) + semantic checks (name/ip required, slug uniqueness → 409,
  dup service name), then `edit_config_yaml(mutate)` + `reconfigure(app, load_settings())` to
  hot-apply + invalidate caches (audit B4) — new machine shows next poll, no restart. `asyncio.Lock`.
- **`config.py` generalized:** the 7a comment/EOL-preserving writer is now `edit_config_yaml(mutate,
  path)` (the single YAML-write chokepoint) + `sync_mapping(node, target)` (set-if-changed / add /
  delete, comment-preserving) + public `host_slug`. `apply_patch_to_yaml` delegates to it. This is
  the seam 7c's MCP/integration list editors will reuse.
- **Frontend:** `components/MachineEditor.tsx` ports vapor's `.mwrap`/`.mform`/`.mfoot` machine rows +
  add-machine row (CSS already in `vapor.css`); a **net-new services sub-editor** (`.svc-*` in
  `extras.css`, built from VAPOR_PATTERNS tokens — `vapor.css` untouched) edits name/kind/port/path/
  autostart + per-host-OS start/stop/restart `cmd`, carrying other-OS `cmd` through unchanged.
  `hooks/useHostMutations.ts` (create/update/delete → invalidate `['hosts']`+`['settings']` + toast);
  `del()` added to `api/client.ts`; delete goes through the existing `requestConfirm`.
- **Verified:** `tests/test_hosts_7b.py` 2/2 (TestClient on a **temp** config — add/edit/rename/
  delete/services-sync/multi-OS-cmd/secret-keep/409/422); 7a tests still 7/7; `compileall` + frontend
  `tsc -b`/`vite build` clean. Backend relaunched on 5433 (venv) — `GET /hosts` on the real config
  shows `has_password`/services with no secret leak. **Writes were tested only on a temp config
  (audit E3 — never the real `config.yaml`).**
- **Known limitation:** a comment *physically trailing a deleted element* is dropped with it (ruamel);
  leading section comments (the owner's style) survive sibling deletions.
- **Owner D7 eyeball pending:** machine form + the net-new services editor @390px in vapor/aqua/ember.

### ⭐ Session update — 2026-05-29 (Phase 7a — Conf settings read/write foundation)

**Phase 7 is now sliced 7a–7e (TODO.md); 7a is built + verified (commit pending — not yet pushed).**
Started with a **pre-implementation audit** ([`AUDIT_settings.md`](./AUDIT_settings.md)) of the
settings functionality + config→runtime design, then built the slice with the findings folded in.

- **`GET/PUT /api/settings`** (`api/settings.py`): GET returns the full config secret-masked; PUT
  takes a **partial deep-merge patch**, restores unchanged secrets, validates (422 on bad value),
  persists, and hot-applies. Conf tab's **Inference** + new **Server** groups are wired to it
  (`hooks/useSettings.ts`, `putJSON`, dirty-tracked Save + toast); Appearance stays UI-store-only.
- **Audit blocker caught (A1):** `save_settings` did `model_dump(mode="python")` → `yaml.safe_dump`,
  which **can't serialize a `StrEnum`** → would crash the first save once an `agents[]` entry (with
  its `privilege`) exists. Fixed with `mode="json"`. Latent only because `agents` was empty.
- **Secret safety (A2):** `unmask_secrets` — a masked/blank secret echoed back from the form is
  treated as unchanged (keeps the stored real value); a new value overwrites. No more wiping SSH
  passwords / API keys with the mask.
- **⭐ Runtime reconfigure seam (B1/B2, `app/runtime.py`):** the owner's concern was lifespan↔reload
  **drift**. Solved by design: **single-source `set_*(app, settings)` builders** that *both* lifespan
  and `reconfigure()` call — exactly one construction site per subsystem, can't drift. `reconfigure`
  updates the shared `Settings` in place (live readers fleet/services/deps see it), rebuilds
  `InferenceClient`, invalidates status caches; PUT is `asyncio.Lock`-guarded. This module is the
  future `build_runtime` home — 7c adds `set_searxng`/etc. here and extends `reconfigure`.
- **⭐ Comment/format preservation (E1, owner-approved):** the static audit under-rated this — live
  testing showed `save_settings` **normalized the whole file** (stripped comments, reordered,
  expanded defaults). Added **`ruamel.yaml` (pinned 0.18.10)** + a **patch-based writer**
  (`apply_patch_to_yaml`): a UI save edits only the changed leaves in place (`prune_unchanged`),
  keeping comments/order/quoting/minimal-style verbatim; unchanged lines (incl. secrets) untouched.
  **EOL preserved too (E2):** detects LF/CRLF from raw bytes, writes bytes directly (no Windows
  `\n`→`\r\n` churn). **Verified live:** a real PUT changed *only* the one `poll_seconds` line.
- **⚠️ Process note (E3):** during testing I briefly ran live PUTs against the owner's real
  `config.yaml` and it got normalized; **recovered losslessly** (reconstructed from the diff, proven
  byte-equivalent via validated `model_dump`s, comments restored). Lesson logged: write-endpoint
  live tests must use a throwaway `CTRLB_CONFIG`/`CTRLB_DB`, never the real config.
- **Verified:** `compileall` + app import clean; `tests/test_settings_7a.py` **7/7 pass**; frontend
  `tsc -b` + `vite build` clean; **live on 5433** — GET masks (`sk…2f`/`ne…go`), PUT preserves
  secrets+comments+EOL, `poll_seconds` applies without restart, port flags `restart_required`, bad
  value → 422. Backend relaunched on 5433 (venv), reachable via the 5190 Vite proxy.
- **Owner eyeball pending (D7):** the Conf **Inference + Server** forms @390px (Save pill mirrors
  vapor's `.mfoot button.save`; net-new CSS in `extras.css`, `vapor.css` untouched).

### ⭐ Session update — 2026-05-28 (committed + pushed; tree clean, in sync at `c6d3ff5`)

Everything below is on `origin/main`. **Servers were restarted many times; one clean backend now
runs on 5433 (venv python), frontend on 5190.** Watch out: a stale *system-python* backend had been
serving 5433 with pre-fix code earlier this session — always confirm the instance on 5433 is the
venv one running current code.

- **Cloud chat wired** (`c6577c6`): `inference.cloud` → OpenRouter `google/gemma-4-31b-it:free`,
  same key as `embeddings:`; `default_mode` stays `local` (`/cloud` is opt-in). Live-verified; the
  `:free` tier is heavily rate-limited (429s surface as a clean SSE error).
- **Agent capability layer** (`27529de`, `a0b8e5a`, `d112754`) — *C1 loop discipline*: per-turn
  duplicate-call suppression (`max_repeat_calls`), per-tool cap (`max_calls_per_tool`), result-based
  progress (a repeated outcome isn't progress), stall detection → **forced final answer** instead of
  a silent `capped` dead-end (the stall guard must NOT count narration text — that was a real bug).
  *C2 tool-selection*: routing rules in the prompt + sharper tool descriptions. Also **`task_plan`
  is now lenient** (repairs `status: in_progress`→active, alt field names, bare-string steps — fixed
  "broken task_plan call"). New knobs live on `AgentDef` (configurable, inherited by subagents).
- **⭐ The key finding (proven live): `minig+` is NOT too weak — the full 21-tool *namespaced* set
  confused it** (it hallucinated names like `mcp__fleet_ping`/`fleet.ping_host`, never called
  `task_plan`, spammed web search). **Fix = a `fleet` intent-skill** (`da9f6ff`,
  `skills/fleet/SKILL.md`) that **auto-activates** (KeywordSkillSelector, little-coder style) and
  narrows the toolset → the same prompt went from a 16-search spiral to **4 clean calls** (task_plan
  → ping_host → open_service_url ×2 → accurate answer). **Opt-out for capable models: set
  `skills: []` on an agent** → full toolset, model's own judgment (Claude-Code style). Documented in
  `config.example.yaml` + README; roadmap **A7** (`c61dd68`) tracks a Conf UI / `/agent` switch.
- **`check_service` liveness tool + `open_service_url` correctness fix** (`448249a`): the agent had
  no real service health check and was calling services "operational" off `open_service_url` (which
  only *builds* the URL — no probe). `check_service` does a live TCP probe (reports DOWN if the host
  is offline); descriptions updated so the model never conflates the two. Verified live with emma off.
- **`reboot_host` action + UI** (`1df085f` backend · `6a7770e` button · `7308cbf`/`42b8353` refine):
  OS-agnostic (per-target `os_type`), HIGH/confirm. Device-row button beside shutdown (wake-accent
  gradient, gapped rotate glyph), shown with shutdown when online, wake-only when offline; eq bars
  trimmed + buttons grouped in one `.acts` grid cell so they fit (vapor `.top` is a 5-col grid).
- **Clickable plan-step dots** (`b525553`, `0cc9e09`): tap a step's dot in the pinned plan panel to
  toggle done/undone — **persistent + agent-aware**. `POST /api/agent/plan` updates the latest
  `task_plan` call's *args* (what the model sees next turn) + its result *in place* (no breadcrumb
  spam). Reuses message history (no separate plan store). Dot keeps its original look.
- **OS-compatibility pass** (`c6d3ff5`): `fleet._ping_cmd` is a 3-way `platform.system()` branch
  (Windows `-n/-w ms` · Linux `-c/-W sec` · macOS/BSD `-c/-t sec`); shutdown/reboot OS-command
  lookups use `.get()` with a clean DENIED fallback. WOL/paths/SSH/sockets/HTTP were already
  portable. **Ready to run on emma/Linux at cutover.**
- **Housekeeping:** the 2 moderate Dependabot alerts (vite/esbuild in the dead `ws_codex_2`
  prototype) were **dismissed as not-used** — the active `dashboard_v2` already runs patched vite
  7.3.3 / esbuild 0.27.7.

**Still owner-eyeball (D7):** the reboot button + clickable plan dots @390px; the fleet-skill
behavior in the live UI (a fleet ask should now plan, use real tools, and render the plan panel).

**Live-probed against `minig+` this session (servers up on 5433/5190):** `web_search` ✅ (model
calls it, auto-runs, clean answer); forced skill `/web-research` ✅ (activates, narrows tools, fuller
synthesized answer); **subagent runtime ✅ live** — a direct `spawn_subagents` invocation (confirm
token → execute) ran a real 2-child fan-out (2/2 ok, both real `minig+` answers aggregated).
**Caveat:** `minig+` will **not *choose*** `spawn_subagents` in chat even when told to — it reaches
for the concrete `search_web`/`mcp__web-tools__search_web` instead (it *does* fan several searches in
one step on its own). That's the known weak-local-tool-calling limit (TODO 4c: prompted-JSON
fallback), not a wiring bug — the delegation plumbing is proven; a stronger/cloud model would pick it.
**Tool descriptions:** all 21 tools expose their own model-facing description (explicit / docstring /
MCP-remote); the docstring fallback now takes the first *paragraph* (no mid-sentence truncation), and
each description lives on `ToolSpec` — the seam a Phase-7 Conf per-tool override will overlay.

⭐ NEW in Phase 4.5 — agent definitions + skills + subagents (`backend/app/`):
```
  domain/agent.py              # ⭐ AgentDef (prompt/model/tools/skills/privilege + loop & subagent
                               #     limits) + ModelRef (moved here from config; re-exported there)
  config.py                    # ⭐ Settings.agents[] + resolve_agent(name); AgentCfg.default_agent /
                               #     global_subagent_limit / skills_dir / skills_enabled; skills_dir_path()
  core/tool.py                 # ⭐ ToolRegistry.for_agent(allow) (glob narrow); InvocationContext.depth+agent
  core/skills.py               # ⭐ Skill + SkillProvider/SkillSelector protocols (swappable seams)
  services/agent/skills.py     # ⭐ FileSkillProvider (SKILL.md frontmatter+body) + KeywordSkillSelector
                               #     (default) + resolve_skills / skills_prompt / narrow_tools
  services/agent/subagents.py  # ⭐ spawn_subagents builtin (MED) + Orchestrator/ParallelOrchestrator
                               #     (asyncio.TaskGroup, per-agent + tree-wide sems) + run_subagent
  services/agent/session.py    #   AgentSession driven by AgentDef (prompt/tools/privilege/model/iters);
                               #     per-turn skill activation; headless mode (interactive=False) +
                               #     depth forwarded to invoke
  services/action_service.py   #   invoke()/_execute thread actor/privilege/interactive/depth/agent → ctx
  services/deps.py             #   agent-runtime handles (inference/threads/messages/actions/skills/
                               #     selector/subagent_sem) for spawning children; back-filled in lifespan
  adapters/inference.py        #   stream_chat gains a model override (an AgentDef selects its model)
  api/agent.py                 #   _session resolves the thread's AgentDef; ChatRequest.skills; GET /api/skills
  main.py                      #   builds FileSkillProvider+KeywordSkillSelector; back-fills Deps + the sem
  ../skills/web-research/SKILL.md   # ⭐ worked example skill (search → summarize w/ sources)
```
**Design decisions made here (D11 strategies):** skill auto-selection default = **keyword/description
overlap** (`KeywordSkillSelector`) — deterministic + model-agnostic so it works with a weak local
model; the `SkillSelector` protocol keeps an LLM-based selector a drop-in. Subagent orchestration
default = **bounded parallel** (`ParallelOrchestrator` over `asyncio.TaskGroup`); `Orchestrator` is
the swappable seam (sequential/map-reduce later). The **default chat agent** is a *synthesized*
`AgentDef` (all agent tools, CONFIRM, chat backend) so behaviour is identical when no `agents[]` are
configured. Subagents run **headless** (a confirm-gated call denies in place — no UI to confirm),
with **depth** bounded by `max_subagent_depth`. `spawn_subagents` is MED-risk → the default CONFIRM
agent confirms a fan-out before spending tokens; an `auto_low`/`full` agent spawns silently.

**Subagents inherit every parameter from the parent** (owner request, `b407cec`): `resolve_child`
clones the parent's `AgentDef` — model, **context-window/compaction** (now per-`AgentDef`, falling
back to the global `agent.compaction`), privilege, tool/skill allowlists, iteration + fan-out caps —
and a *named* subagent def overlays **only the fields it explicitly set** (so "configure just the
prompt" inherits the rest); no name → a full clone. Privilege is clamped to the parent unless
`agent.subagent_clamp_privilege: false`. So to give subagents more autonomy, raise the *parent's*
privilege (they inherit it); the headless deny only bites at CONFIRM (which means "ask a human").

**Verified (Phase 4.5):** backend `compileall` + app import clean; `tsc -b` + `vite build` clean.
Unit/stub tests pass: agent resolver (default/named/unknown-fallback) + `for_agent` glob filtering +
a stubbed turn honoring a custom prompt/cloud-model override; skills (frontmatter parse, selector
match/no-match, resolve dedup + allowlist restriction, prompt injection, tool narrowing) + a stubbed
turn where an active skill narrows tools to `web_search` and injects its instructions while an
unrelated message keeps the full toolset; subagents (parallel 2/2 batch on archived threads, depth
DENY, privilege clamp, headless deny-in-place, interactive suspend still works); a minimal-config
TestClient boot (spawn_subagents registered, Deps back-filled). **Not yet eyeballed live against
`minig+`:** whether the model actually picks a skill / calls `spawn_subagents`, and the subagent
command bubble @390px (it renders in the existing `.b.cmd` bubble — the children's answers in the
output line; a richer subagent panel is later polish) — **owner to do the side-by-side.**

**Agent-tab UX (this session, `frontend/src/tabs/AgentTab.tsx` + `theme/extras.css`):** tool command
bubbles (`.b.cmd`) now **collapse the `$`-args by default** (tool name + outcome stay visible; tap
the chevron to expand; auto-opens while awaiting a confirm so the owner reviews before approving),
and a thinking model's **reasoning renders inside the command bubble it produced** (think→act in one
unit) — a shared `ThinkBlock` is hosted in the first non-`task_plan` call's bubble, falling back to a
standalone bot bubble only when there's no call to host it. `web_search` hit links were already a
collapsed disclosure. `vapor.css` stays untouched (D7); all net-new CSS is in `extras.css`.

**Dev servers (per the owner's standing preference):** backend uvicorn on **5433** (launch with LAN
access / sandbox disabled — see the run gotchas), frontend Vite on **5190**. Confirm health at
`/api/health` direct + via the `:5190/api` proxy. A Vite server may already be live on 5190 (HMR).
**Phase 4f essentially done: `web_search` (SearXNG), the MCP client, curated open-terminal tools, a
generic OpenAPI tool provider, and the embeddings client all landed** (see below); MCP supports both
Streamable HTTP and stdio. The 4e file list further down is reference for earlier work.

⭐ NEW in Phase 4f — embeddings client (`backend/app/`):
```
  config.py                    # ⭐ EmbeddingsCfg (base_url/api_key/model/dim/enabled) + Settings.embeddings
  adapters/embeddings.py       # ⭐ EmbeddingsClient — OpenAI-compatible /v1/embeddings; embed(texts)→vectors
  services/deps.py · main.py   #   Deps.embeddings; built on app.state, closed at shutdown
```
**Design:** the OpenAI-compatible `/v1/embeddings` sibling of the chat `InferenceClient` (same lazy
`AsyncOpenAI`), local or cloud. `embed()` returns one vector per input, input order preserved
(sorted by the API's `index`). **There is no consumer yet** — the vector `MemoryProvider` + semantic
recall are Phase 7 (DESIGN §6); this is the tested seam they plug into, sitting on `Deps`. Wired to
**OpenRouter `qwen/qwen3-embedding-4b`** using the same key as cloud chat (OpenRouter *does* serve
`/v1/embeddings` — confirmed) — the key lives in the gitignored `dashboard_v2/config.yaml`'s
`embeddings:` block. **Verified live:** 2560-dim vectors, cosine sanity (self 1.0, unrelated 0.52).
*(The same OpenRouter key now also fills `inference.cloud` (model `google/gemma-4-31b-it:free`) so
`/cloud` chat works — `default_mode` stays `local`; the `:free` tier is rate-limited, see the 4c note.)*

⭐ NEW in Phase 4f — generic OpenAPI tool provider (`backend/app/`):
```
  config.py                    # ⭐ OpenApiServerCfg (base_url/spec_url/api_key/auth/risk/include) + Settings.openapi_servers
  adapters/openapi_tools.py    # ⭐ OpenApiToolProvider.discover() fetches /openapi.json, registers an
                               #     OpenApiTool per operation (api__<server>__<opId>); call() splits args→path/query/body
  main.py                      #   lifespan discovers into the registry (app.state.openapi + openapi_summary)
```
**Design:** the HTTP sibling of the MCP client — for Open WebUI "tool servers" or any OpenAPI/REST
service. Each operation is registered into the **same registry** (→ ActionService + gate + bubble).
The model gets a **self-contained JSON Schema**: path/query params become top-level props, the
requestBody becomes a nested `body` prop, and `#/components/schemas/...` `$ref`s are rewritten to
local `$defs` (attached) so nothing needs external resolution — reuses the `ToolSpec.raw_schema`
seam. On call, the flat args are split back into path substitutions / query / headers / JSON body.
**Risk:** GET/HEAD auto-run (LOW — reads); mutating verbs use the per-server `risk` (default med →
confirm). Per-server failure isolation (a bad spec logs + registers nothing). **Verified live** by
pointing it at open-terminal's own `/openapi.json` (12 ops; `$defs`/ref-rewrite correct; a GET
auto-ran; a POST gated → token → ran). *(The owner has no `openapi_servers` configured yet — it's
there for when they wire their Open WebUI tool servers; `openapi_summary` is `[]` until then.)*

⭐ NEW in Phase 4f — open-terminal tools (`backend/app/`):
```
  config.py                       # ⭐ OpenTerminalCfg (base_url/api_key/*_risk/…) + Settings.open_terminal
  adapters/openterminal.py        # ⭐ OpenTerminalClient — httpx Bearer client over the REST API
                                  #     (/execute + /files/{read,list,grep,glob,write})
  services/actions/terminal.py    # ⭐ terminal_exec/read_file/list/grep/glob/write_file + register_openterminal(reg,cfg)
  services/deps.py · main.py      #   Deps.open_terminal; main registers the tools (risk from cfg) + closes the client
```
**What open-terminal is:** open-webui/open-terminal — a Bearer-auth **REST API** ("a computer you
can curl"), *not* an MCP server — so it's wired as **curated typed actions**, not via the MCP
client. The owner's instance is emma `:9999` (bare-metal, runs as user `emma` in `~/workspace`,
`--api-key 0`). **Design:** these register **dynamically** (`register_openterminal`, called in
lifespan) instead of `@action`-at-import, so **risk is per-operation and config-driven**
(`OpenTerminalCfg.{exec,write,read}_risk`): reads (read/list/grep/glob) default LOW → auto-run;
`terminal_exec` + writes default HIGH → confirm (it's arbitrary remote shell — the remote analog of
the Phase-5 guarded `run_shell`). Skipped entirely if unconfigured. **Verified** unit + **live
against emma**: read-only auto-runs, `exec` gates → confirm token (single-use, args-bound) → runs
(`whoami`/`pwd` etc.), nonzero exit → ERROR. The **api-key is `0`** (effectively open remote shell on
emma — fine under tailnet-only/no-public-bind, worth knowing; keep exec/writes gated).

⭐ NEW in Phase 4f — MCP client slice (`backend/app/`):
```
  config.py                    # ⭐ McpServerCfg (transport/url/headers/command/args/env/risk/…) + Settings.mcp_servers
  core/tool.py                 # ⭐ ToolSpec.raw_schema — native JSON Schema handed to the model when set
                               #     (to_openai_tools prefers it over input_model.model_json_schema())
  adapters/mcp_client.py       # ⭐ McpClient — discover() registers an McpTool per remote tool into the
                               #     shared registry; call() opens a fresh session per call; per-server
                               #     failure isolation; both transports wired (Streamable HTTP + stdio)
  main.py                      #   lifespan: build McpClient → discover into the registry → app.state.mcp(_summary)
  pyproject.toml               #   + mcp==1.27.1
```
**Design:** the agent must see MCP tools as just more entries in the one toolset (DESIGN §3), so each
discovered remote tool is wrapped as an `McpTool` (the `Tool` protocol) and **registered into the
same `ToolRegistry`** as built-in actions — it then flows through the existing `ActionService`
(validate → `decide()` gate → execute → audit Event) and renders in the same `.b.cmd` bubble; the
loop never special-cases MCP. Names are `mcp__<server>__<tool>` (sanitized to the OpenAI
function-name charset `[A-Za-z0-9_-]`, ≤64 chars — **colons from the DESIGN's `mcp:server:tool`
would be rejected by the API**, so `__` is used). The remote's native `inputSchema` is handed to the
model via the new `ToolSpec.raw_schema`; arg **validation is a permissive passthrough**
(`_PassthroughArgs`, `extra="allow"`) because the remote server validates — a faithful
JSON-Schema→pydantic build would be fragile. **Per-tool risk** (`_risk_for`): MCP **annotations**
win — `readOnlyHint` → LOW (auto-runs: search/crawl/file-read never gate), `destructiveHint` → HIGH
(always confirms, a safety floor even on a `low` server) — else the server's configured **`risk`**
(default `med`; the owner's `web-tools` is set `low` since it doesn't annotate and search/crawl are
read-only). Connection is
**per-call** (a fresh short-lived `streamablehttp_client` + `ClientSession` entered/exited in one
coroutine) — this dodges the SDK's anyio-task-group lifecycle pitfalls of holding sessions open
across the lifespan, and makes **failure isolation** trivial (a down server fails into a clean
`ToolResult`, never crashing the agent; discovery of a down server logs + registers 0 tools, startup
proceeds). **Verified:** unit (fake session — discovery, raw-schema passthrough to OpenAI tools,
call→ToolResult, `isError`→ERROR, down-server isolation, med-risk gating at agent privilege) + boot
(`/api/actions` lists the MCP tools) + **live against emma's `web-tools`** (`http://192.168.1.160:3003/mcp`:
5 tools discovered — search_web / search_and_crawl / crawl4ai_crawl / _crawl_stream / _markdown — and
a live `search_web` call returned real results) **+ stdio live** against
`@modelcontextprotocol/server-filesystem` via `npx` (14 tools; the server's `readOnlyHint`/
`destructiveHint` annotations drove reads→LOW/auto-run, writes→HIGH/confirm — proving `_risk_for`
against a server that actually annotates). **`_session()`** branches on `transport`: Streamable HTTP
(`url`/`headers`) or stdio (`StdioServerParameters` with the operator env merged onto
`get_default_environment()` so `PATH`/`npx`/`uvx` resolve). **Follow-ups:** hot re-discovery on a
config `PUT` (Phase 7); rendering MCP `output` in the bubble (arbitrary text/JSON — a generic
disclosure like `web_search`'s links, later polish).

⭐ NEW in Phase 4f — `web_search` slice (`backend/app/`):
```
  config.py                    # ⭐ SearxngCfg (base_url/enabled/timeout_s/language) + Settings.searxng
  adapters/searxng.py          # ⭐ SearxngClient — cached httpx.AsyncClient → /search?format=json;
                               #     normalizes hits to SearchResult; SearxngError on down/non-JSON/bad-status
  services/actions/web_search.py  # ⭐ @action web_search (utility, LOW, agent-only) — shapes input,
                               #     formats numbered results for the model, normalizes failures to ToolResult
  services/actions/__init__.py #   imports web_search to register it
  services/deps.py             #   + Deps.searxng (SearxngClient | None)
  main.py                      #   builds SearxngClient onto app.state + Deps; aclose() at shutdown
  ../config.example.yaml       #   documented `searxng:` block (JSON-format-required note)
```
**Design:** `web_search` is a normal `@action` — `category="utility"`, LOW risk, `ui_exposed=False`
(no Utils card until the Phase-8 registry), `agent_exposed=True` — so it **auto-runs in the agent
loop** (LOW → ALLOW, no confirm gate) through the same `ActionService`, and renders in the existing
Vapor `.b.cmd` bubble via the outcome line (no frontend change needed). The SearXNG round-trip lives
in `adapters/searxng.py`; the tool reaches it via `ctx.deps.searxng`. Unconfigured / disabled →
clean `DENIED` ("not configured"); a stock SearXNG that only serves HTML → `ERROR` telling the owner
to enable the JSON format. **Verified:** unit (mocked `httpx` transport — happy path w/ param +
count-cap assertions, empty, HTML-not-JSON, 403, unconfigured, disabled) + boot (real config parses
`searxng`, `/api/actions` lists it as utility/LOW/agent-only) + **live against emma's instance**
(`http://192.168.1.160:8888`, real results, JSON format enabled). *(A richer search-results panel
beside the bubble — like the plan panel — is later polish, not blocking the next slice.)*

**Dev-server host fix (`f2774b8`):** `vite.config.ts` now sets `server.allowedHosts: true`. Vite
≥5.4 otherwise rejects any `Host` header that isn't localhost/IP (a DNS-rebinding guard), which
blocked reaching the dev server by machine name (`http://corsair:5190`) and would block the
Tailscale Serve `*.ts.net` FQDN needed for the mic over HTTPS. Safe here — tailnet-only, no public
bind (AGENTS.md §6). *(Note: GitHub flagged 2 moderate Dependabot vulns on push — not yet triaged.)*

⭐ NEW in Phase 4e (`backend/app/`):
```
  config.py                    # ⭐ ModelRef + CompactionCfg (enabled/threshold_tokens/keep_last_messages
                               #     /summarizer) + AgentCfg; Settings.agent
  adapters/inference.py        # ⭐ InferenceClient.complete — buffered (non-stream) summary call w/
                               #     mode+model override (summarizer selectable, D11)
  services/agent/compaction.py # ⭐ Compactor.compact(force=) + estimate_tokens + transcript render;
                               #     turn-boundary-safe split, rolling re-fold, truncation fallback
  services/agent/session.py    #   builds Compactor; loop runs compact() before each model call →
                               #     `compaction` event; public compact() for the manual path
  api/agent.py                 # ⭐ POST /api/agent/compact (force-fold; {removed, summaryId?, truncated?})
```
⭐ NEW in Phase 4e (`frontend/src/`):
```
  store/chat.ts                # ⭐ compactThread() (POST /agent/compact + breadcrumb) + `compaction`
                               #     SSE case → sys note; compactionNote() helper
  lib/composer.ts              #   /compact verb routes to compactThread(); added to /help
```
**Design:** compaction shrinks only the model's **working context** (the repo's
`include_compacted=False` view), never the visible chat log or the DB. The cut is `keep_last_messages`
from the end, **snapped back to a `user` message** so an assistant `tool_calls` is never split from
its `tool` results (which would make the OpenAI context invalid) — complete turns fold, complete
turns stay. The summary is a real `system` message timestamped at the boundary (`tail[0].ts - 1µs`)
so it round-trips through `_assemble` + `GET /threads/{id}/messages` with no extra store. A prior
rolling summary in the head is fed back to the summarizer (single live summary). Summarizer failure →
a truncation **placeholder** (still flips `compacted` so the next call can't blow the window; DB rows
never deleted). The summarizer is `agent.compaction.summarizer{mode,model}` — both `None` by default,
so it inherits the chat backend (a cheap model can be set later). `estimate_tokens` is ~chars/4
(excludes reasoning, which `_assemble` already drops). The UI shows a `// compacted N messages`
breadcrumb (auto: from the `compaction` SSE event; manual: from the POST response) and does **not**
re-read history — surfacing the raw summary mid-log beside the originals would just confuse.

⭐ NEW in Phase 4d (`backend/app/`):
```
  domain/plan.py               # ⭐ Plan + PlanStep (status pending|active|done); .done count
  services/agent/planning.py   # ⭐ @action task_plan (builtin, LOW, agent-only) — echoes the plan in data["plan"]
  core/tool.py                 #   @action gained a `category` param (default "action"; task_plan uses "builtin")
  services/actions/__init__.py #   imports planning to register task_plan
  services/agent/session.py    #   system prompt now tells the model to use task_plan for multi-step work
```
⭐ NEW in Phase 4d (`frontend/src/`):
```
  types.ts                     #   + Plan / PlanStep / PlanStepStatus (mirror domain/plan.py)
  tabs/AgentTab.tsx            # ⭐ PlanBubble — task_plan call/result → checklist panel; latest = full,
                               #     superseded = "// plan revised" breadcrumb. planFrom() reads result.data.plan
                               #     (falls back to call.args.steps so it renders before the result lands)
  theme/extras.css             # ⭐ net-new `.b.plan` panel + per-step tick states (vapor tokens; vapor.css verbatim)
```
**Design:** `task_plan` is a normal `@action` (LOW risk, `category="builtin"`, `ui_exposed=False`,
`agent_exposed=True`) so it **auto-runs** in the loop (no confirm gate) and flows through the same
`ActionService`. It has **no side effects and no deps** — it validates the steps and returns the
structured plan in `ToolResult.data["plan"]`. **There is no separate Plan store**: the plan lives in
the `task_plan` tool_result part in the message history, so reload (`GET /threads/{id}/messages`) and
the agent's own assembled context both recover it for free. The model **rewrites the whole list each
call** (TodoWrite-style) → the most-recent call is the live plan; the UI renders that one as the full
panel and collapses earlier ones. *(`/api/actions` now lists `task_plan` too — harmless; nothing
renders a UI button for it since `ui_exposed=False`.)*

⭐ NEW in Phase 4c (`backend/app/`):
```
  api/agent.py                 # ⭐ ChatRequest.mode validator (junk→None, else local|cloud) + run_turn(mode=)
  services/agent/session.py    #   run_turn/_drive take `mode`; forwarded to stream_chat (resume uses default)
```
⭐ NEW in Phase 4c (`frontend/src/`):
```
  lib/composer.ts              # ⭐ runComposer prefix router (!shell stub · /slash · else agent) + shared fillComposer
  lib/markdown.tsx             # ⭐ hand-rolled dep-free markdown→React + CodeBlock (copy + send-to-composer)
  store/chat.ts                #   sendMessage(text,{mode}) + sticky sessionMode; pushSystemNote/pushUserEcho;
                               #     startNewThread (/clear); initChat no longer clobbers local-only notes
  components/Composer.tsx      #   send → runComposer (was sendMessage+setUI)
  tabs/AgentTab.tsx            #   bot text rendered via <Markdown>; fillComposer now imported from lib/composer
  theme/extras.css             # ⭐ net-new `.md` block/inline + `.md-code` bar styles (vapor tokens; vapor.css verbatim).
                               #     NB: fenced `<code>` is reset so it doesn't inherit the inline-code green lozenge
                               #     (that bug — a green box per wrapped word inside code blocks — was caught + fixed).
```
**Routing grammar** (the agreed v2 shape, ARCHITECTURE §Composer): `!<cmd>` → guarded shell — the
sigil is `!` (the *only* command prefix, no `$`/`>`), a const in `lib/composer.ts`, configurable in
Conf later (Phase 7); Phase 5 wires the real `run_shell`, so 4c **stubs** it (echo + "not wired"
note). `/local`//`/cloud` with a message force the backend for that one message; **bare** they set a
sticky `sessionMode` (module var in `store/chat.ts`) until changed. `/clear` → fresh thread (history
stays in SQLite; next send mints a new one). `/help` lists commands. `mode` rides `ChatRequest.mode`
→ `stream_chat(mode=…)`. **Markdown is React-node output (never innerHTML)** so it's XSS-safe by
construction; links are scheme-allowlisted (http/https/mailto only). Streams fine — re-parsing the
short text each token is cheap and a half-typed ``` fence still renders.

> **Cloud is now configured** — `inference.cloud` points at OpenRouter (`https://openrouter.ai/api/v1`,
> model `google/gemma-4-31b-it:free`, same key as `embeddings:`); `default_mode` stays `local` so
> `/cloud` is opt-in per message. **Caveat:** the `:free` tier is heavily rate-limited upstream
> (frequent 429s under back-to-back use) — wiring is proven (a live `stream_chat(mode="cloud")` returned
> `pong`; 429s surface as a clean SSE `error`, not a crash). For reliable cloud, BYOK a Google AI Studio
> key in OpenRouter or switch to a cheap paid model. **Resume runs on the default mode** (the
> per-message mode isn't carried across the confirm round-trip — only matters if the summary model
> would differ; acceptable for now).

**Runtime extras landed alongside 4b (same commit):**
- **Fleet roster injection** (`session._roster`): each turn the agent gets an id↔name map of hosts +
  services projected from config, so it resolves a named host/service to its slug `host_id`/
  `service_id` itself instead of asking the owner. Prompt updated to forbid asking for ids.
- **`sudo -S` over SSH** (`adapters/ssh.run_command` gained `stdin_data`): `shutdown_host` (POSIX) and
  the service control runner (`actions/_common._prepare_sudo`) rewrite `sudo`→`sudo -S -p ''` and pipe
  the SSH password as the sudo password (an exec channel has no TTY). Both now detect sudo-auth
  failure instead of reporting false success. Assumes SSH password == sudo password (true on emma).
- **Owner's real `config.yaml`** (gitignored, not in the commit) now declares real services
  (corsair: llamacpp/signal-bot · vault: whisper/tts · g5: open-webui/sillytavern/old-dashboard ·
  emma: open-webui/searxng/open-terminal) and **staged config for later phases**: `stt`/`tts`
  (vault, Phase 6 voice), `searxng` (emma:8888) + `mcp_servers` (emma `http://192.168.1.160:3003/mcp`,
  Streamable-HTTP crawl4ai) — **real targets for Phase 4f**. These extra sections round-trip via
  Settings `extra="allow"`; the typed `SttCfg`/`TtsCfg`/`SearxngCfg`/`McpServerCfg` models are still
  TODO (add them when 4f/6 consume the sections).

**Dev-run gotchas (this box):** the backend must run with **LAN access** (don't sandbox it) or every
ping/WOL/SSH fails and hosts read offline though the code is fine. Avoid `uvicorn --reload` when
launching detached — its child worker orphans and holds 5433; run plain and restart on changes.
Frontend pinned to **5190** (5173–5175 are other workspaces).

⭐ NEW in Phase 4b (`backend/app/`):
```
  domain/conversation.py       # ⭐ ToolCallPart (call_id/tool/args/state) + ToolResultPart in the Part union
  core/tool.py                 # ⭐ ToolRegistry.agent_tools() + to_openai_tools() (input_model → JSON-Schema fn defs)
  adapters/inference.py        # ⭐ ToolCallRequest + ChatDelta.tool_calls; stream_chat(tools=…) reassembles streamed calls
  services/conversation.py     #   + MessageRepo.update()/get() (flip a ToolCallPart's state in place)
  services/agent/session.py    # ⭐ run_turn = the tool loop (assemble incl. tool_calls/results in OpenAI shape →
                               #     call w/ tools → ALLOW via ActionService · DENY synth · CONFIRM suspend) + resume()
  api/agent.py                 # ⭐ POST /api/agent/resume (execute|dismiss + confirm_token) → fresh SSE stream
```
⭐ NEW in Phase 4b (`frontend/src/`):
```
  types.ts                     #   + ToolCallPart / ToolResultPart (extend Part)
  store/chat.ts                # ⭐ multi-message turns; part.added/tool.permission/tool.result; resumeCall(); shared streamTurn()
  tabs/AgentTab.tsx            # ⭐ Vapor .b.cmd command bubbles (pairs tool_call+result by id) + allow/edit/deny
  theme/extras.css             # ⭐ net-new: cmd-result outcome line (state-colored) + resolved/gate states (vapor tokens)
```
**Agent privilege = `CONFIRM`** (the AgentDef default, D11): low-risk tools (wake/ping/start_service/
open_service_url) **auto-run** in the loop; med/high (stop/restart_service, shutdown_host) **gate** on a
confirm bubble — identical to the UI's `decide()` policy, just `Actor.AGENT`. The confirm dance reuses
Phase 2's single-use TTL'd token (minted by `ActionService`, surfaced in the `tool.permission` SSE event,
sent back on resume). A **suspended** turn parks in the DB (`ToolCallPart.state=AWAITING_CONFIRM`); resume
finishes that step then loops so the model summarizes. `_assemble` round-trips persisted tool calls/results
into OpenAI `assistant.tool_calls` + `tool` messages, synthesizing a `skipped` result for any abandoned
confirm so the context is always API-valid. `MAX_ITERATIONS=8`. SSE events added: `part.added`,
`tool.permission`, `tool.result` (DESIGN §12). **`vapor.css` untouched** (D7) — the `.b.cmd` shell is
verbatim; the outcome line is net-new in `extras.css` (vapor's `.cmd.done::after` hardcodes a shell
message, so resolved bubbles render the real `ToolResult.summary` instead of using `.done`).

----

⭐ NEW in Phase 4a (`backend/app/`):
```
  adapters/inference.py        # ⭐ InferenceClient — AsyncOpenAI per mode; stream_chat → ChatDelta(text|reasoning)
  config.py                    #   + InferenceCfg (local/cloud endpoints, default_mode, timeout); config.yaml local=minig+
  domain/conversation.py       # ⭐ Thread + Message + Part union (text/reasoning/error)
  services/conversation.py     # ⭐ ThreadRepo + MessageRepo (parts as JSON over db.py)
  services/agent/session.py    # ⭐ AgentSession.run_turn — text-only loop, yields SSE AgentEvents
  api/agent.py                 # ⭐ GET/POST /api/threads · GET /threads/{id}/messages · POST /api/agent/chat (SSE)
  main.py                      #   wires InferenceClient + Thread/Message repos onto app.state; mounts agent router
```
⭐ NEW in Phase 4a (`frontend/src/`):
```
  types.ts                     #   + Role/Part/ChatMessage/Thread
  store/chat.ts                # ⭐ dep-free streaming store: messages + status + sendMessage (fetch ReadableStream SSE parser)
  tabs/AgentTab.tsx            #   live chat log (Vapor bubbles + dim reasoning disclosure + streaming caret), initChat history load
  components/Composer.tsx      #   send → sendMessage + jump to Agent tab; disabled while streaming
  theme/extras.css             # ⭐ net-new: reasoning disclosure + caret + chat-error (vapor tokens; vapor.css verbatim)
```
The model `minig+` is a **thinking** model (Gemma, fits the owner's 3060) and is **fast in practice
even with reasoning** — the earlier "cold-loads slowly (2–3 min)" note was a one-time first-load
artifact, not steady-state; don't budget UX around it. The client timeout stays a generous 600s as a
safe upper bound. Reasoning is streamed/persisted as a `ReasoningPart` (dimmed, NOT replayed into the
model's next context). One thread for now (Vapor's "one agent · one thread"); thread-list UI later.

----

⭐ Phase 3 (already committed, `2675f82`) (`backend/app/`):
```
  domain/service.py            # ⭐ Service (+ command_for) + ServiceStatus (derived, never stored)
  config.py                    #   + ServiceCfg nested under ComputerCfg; Settings.services() projection
  services/svc.py              # ⭐ ServiceService — cached concurrent TCP port-probe off fleet status
  services/actions/_common.py  #   + ServiceTargetInput + run_service_command (shared SSH runner)
  services/actions/{start,stop,restart}_service.py · open_service_url.py   # ⭐ @action, one file each
  services/actions/__init__.py · deps.py · main.py   #   register + wire ServiceService into Deps
  services/action_service.py   #   _record target now falls back to service_id
  api/services.py              # ⭐ GET /api/services · POST /api/services/{id}/actions/{action}
```
⭐ NEW in Phase 3 (`frontend/src/`):
```
  types.ts                     #   + Service / ServiceStatus
  hooks/useServices.ts         # ⭐ useServices — polls ['services'] at poll_seconds
  hooks/useEvents.ts           #   SSE now invalidates ['services'] too
  tabs/FleetTab.tsx            #   fetch services, group by host_id, pass each row its own
  components/DeviceRow.tsx     #   ⭐ Vapor .svc-row list (led/name/host:port/↗ link) + "· N svc" sub
```
`config.example.yaml` gained a documented `services:` block under two hosts (the shape to copy).
No `vapor.css` changes (the `.svc-row` styles were already lifted in Phase 0) — D7 unaffected.

----

⭐ Phase 2 (already committed, `21781f7`) (`backend/app/`):
```
  domain/enums.py        #   + Risk / Privilege / Actor / RunState
  domain/result.py       # ⭐ ToolResult (+ Artifact) — the one outcome shape for every capability
  domain/event.py        # ⭐ Event — the single audit record (mirrors the `events` table)
  core/tool.py           # ⭐ ToolSpec / Tool / InvocationContext / ToolRegistry + @action + registry
  core/permissions.py    # ⭐ Decision + pure decide()  (CONFIRM-priv → wake/ping ALLOW, shutdown CONFIRM)
  core/events.py         # ⭐ in-proc EventBus (pub/sub → SSE; drops oldest, never back-pressures)
  core/redact.py         # ⭐ redact(text, secrets) — scrubs the SSH password from any output
  adapters/wol.py ssh.py # ⭐ wakeonlan + paramiko, blocking → called via asyncio.to_thread
  services/actions/      # ⭐ wake.py shutdown.py ping.py + _common.py (HostTargetInput); @action-registered
  services/action_service.py  # ⭐ validate → decide → confirm-token dance → execute → record Event
  services/events.py     # ⭐ EventService — persist to SQLite + publish to EventBus
  services/deps.py       # ⭐ Deps (settings + fleet + events) handed to InvocationContext
  api/actions.py events.py    # ⭐ GET/POST /api/actions[/{name}] · GET /api/events[/stream] (SSE)
  db.py                  #   + execute()/query() helpers (serialized write / WAL read)
  main.py                #   lifespan builds EventBus→EventService→ActionService; routers mounted
```
⭐ NEW in Phase 2 (`frontend/src/`):
```
  types.ts               #   + Risk/RunState/ToolResult/ActionSpec/CtrlEvent/InvokeResponse
  api/client.ts          #   + postJSON (surfaces FastAPI `detail`)
  hooks/useActions.ts    # ⭐ useActionSpecs + useFleetActions (confirm→optimistic→toast→invalidate)
  hooks/useEvents.ts     # ⭐ useEventStream — EventSource → refresh fleet on any recorded event
  store/toast.ts confirm.ts   # ⭐ dep-free stores (activity toasts + imperative requestConfirm())
  components/Toasts.tsx ConfirmDialog.tsx   # ⭐ toast stack + the lone (shutdown) confirm dialog
  components/DeviceRow.tsx     #   buttons wired to onAction; `busy` drives the ◐ spinner
  tabs/FleetTab.tsx App.tsx    #   FleetTab uses useFleetActions; App mounts Toasts+ConfirmDialog+SSE
  theme/extras.css       # ⭐ net-new toast/modal CSS — built from vapor tokens; vapor.css stays verbatim
```

The Phase 1 surface (Fleet read path, hero scene, theme store) and Phase 2 action stack are
unchanged underneath.

**Run it (two terminals):**
```powershell
cd dashboard_v2/backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433
cd dashboard_v2/frontend ; npm run dev      # proxies /api → 5433
```
NOTE: this dev box already has Vite servers on 5173–5175 (other workspaces: ws_codex*, ws_claude_2,
a telegram bot). Vite will drift to a free port — pin it if you want a known one:
`npm run dev -- --port 5190 --strictPort`. Open the Vapor prototype next to it at ~390px:
`design/prototypes/variations/vapor.html`. **Acceptance is still the human side-by-side check.**

**Verified (Phase 4a):** `compileall` clean. A `TestClient` run (stubbed inference) passed: threads
CRUD, the SSE event order (`thread`→`message.start`→`reasoning.delta`/`text.delta`→`message.end`→
`done`), reasoning+text persisted as distinct parts, unknown-thread 404, and the backend-error path
(clean `error`+`done(error)`, `ErrorPart` persisted). **Live round-trip against `minig+`** worked
end-to-end: 14 `text.delta` events streamed over SSE, a clean sensible answer ("I help you monitor
and manage your fleet of homelab PCs remotely."), persisted + reloaded via `initChat()`. Frontend
`tsc -b` + `vite build` clean. Agent tab reviewed @390px — Vapor chat bubbles (teal user / magenta
bot, `who` dots) used verbatim; reasoning disclosure + caret are net-new in `extras.css`.

**Live-render fix (post-review):** the first cut only showed replies after a reload — the client
SSE parser split on `\n\n`, but `sse-starlette` frames end in `\r\n\r\n`, so no frame ever parsed.
Parser now tolerates `\r\n`/`\n` (`store/chat.ts`). Confirmed streaming live in-browser against
`minig+`, including the **reasoning disclosure live** (it's a thinking model — chain-of-thought
streams dimmed). Added a **working indicator**: on send, an assistant placeholder appears instantly
with animated "…" dots + a `thinking`/`working` tag in the who-line until the first answer token
lands (covers the slow cold-load / reasoning wait). Two more review fixes: **auto-scroll** now
sticks to the bottom on the **window** scroller (the `.chat-log` div isn't the scroller — `body` has
`padding-bottom` for the fixed composer) so the view follows the bot while it types (unless you've
scrolled up); and the **reasoning persists** after the turn as a collapsed **"▸ thinking · tap to
view"** dropdown chip (was auto-collapsing too subtly and felt lost) — tap to re-expand it. All CSS
net-new in `extras.css`. **Mobile layout — app-shell (the real fix):** the original window-scroll +
`position:fixed` composer/tab bar broke on Android Firefox — the dynamic toolbar shrinks the visual
viewport, so at the bottom of the chat the fixed bars and the body's bottom padding misaligned
(colored gaps / vanishing tab icons). (An earlier `--vv-bottom` "pin to visual viewport" attempt
double-counted Firefox's own fixed-positioning and made it worse — reverted.) Now the app is a
**`100dvh` flex column** (`extras.css`): a scrolling content pane `.app-scroll` (appbar + tabs),
then the composer + tab bar in **normal flow** at the bottom. `100dvh` tracks the toolbar/keyboard,
the bars are always at the visible bottom, and the chat scrolls in its own pane — **no body padding,
no fixed/viewport mismatch** by construction. `App` restructured to the shell; `AgentTab`
stick-to-bottom scrolls `#app-scroll` (not the window). **Keyboard:** `100dvh` tracks the browser
toolbar but NOT the on-screen keyboard, so the shell height is driven by `--app-h` =
`window.visualViewport.height` (App effect) which DOES shrink when the keyboard opens — the composer
rides up above it instead of being hidden (`dvh` is the CSS fallback). Desktop verified (layouts
unchanged, pane scroll + pin-to-bottom; shrinking `--app-h` lifts the composer); **owner to confirm
the Android toolbar + keyboard behaviour on the phone**.

**Cloud backend** is now configured (OpenRouter Gemma 4 free, `default_mode` stays `local`) and the
path is live-verified, though the `:free` tier is rate-limited (see the 4c note above). The cold-load
is now visibly indicated (dots) rather than a dead spinner. No `vapor.css` changes — D7 unaffected.

**Verified (Phase 4b):** `compileall` clean; frontend `tsc -b` + `vite build` clean. A `TestClient`
run with a **stubbed scriptable inference** (emits tool calls) + two synthetic tools (one LOW, one
HIGH/confirm) registered into the real registry passed end-to-end: `to_openai_tools` exposes the
toolset; **ALLOW loop** (model calls the low tool → auto-runs via `ActionService` → result fed back
as a `tool` message → second model call → `completed`); **CONFIRM** (high tool → `tool.permission`
with a token, no model call while parked → `suspended`); **resume(execute)** with the token → tool
runs → `completed`; **persistence** round-trips `tool_call` + `tool_result` parts; **resume(dismiss)**
→ synthesized `skipped` result → `completed`; **bad/empty args** tolerated (→ `{}` → validation,
no crash). **Not yet exercised live against `minig+`** — needs eyeballing that the model actually
emits tool calls (it's a thinking model; if native tool-calling is weak, that's the 4b "capability
fallback" follow-up). The confirm bubble UX wasn't reviewed @390px against `vapor.html` yet — **owner
to do the side-by-side** (the `.b.cmd` shell is verbatim vapor, so it should match; the net-new
outcome line is the only new pixels).

**Verified (Phase 4e):** backend `compileall` clean; frontend `tsc -b` + `vite build` clean. A
direct `Compactor` test (temp SQLite + a stubbed summarizer) passed 7 cases: **auto-compaction** over
a low threshold (summary system message first in the working view, originals flipped `compacted`,
full history intact in the DB); **turn-boundary safety** (tail starts at a `user` message, no orphaned
`tool` result in the working context — a seeded `ping_host` call/result turn stayed together);
**under-threshold no-op**; **`force` (manual `/compact`)** compacts under threshold; **floor**
(below `keep_last_messages` → nothing folded); **summarizer failure → truncation placeholder** (still
compacts, history kept); **rolling re-fold** (a prior summary is fed back, single live summary in
context); **selectable summarizer** (`mode`+`model` forwarded to `complete`). Backend relaunched
clean on 5433 (a stale `--reload` orphan from a prior session was holding the port with old code — it
lacked `/agent/compact`; killed it); `/openapi.json` now lists `POST /api/agent/compact`, which 404s
an unknown thread and returns `{removed:0}` on an empty one. Frontend already live on 5190 (HMR),
proxy OK. **Not yet eyeballed live:** auto-compaction firing on a long real `minig+` thread + the
`/compact` breadcrumb @390px — **owner to confirm** (and to set a cheaper summarizer in
`agent.compaction.summarizer` if desired; default inherits the chat model).

**Verified (Phase 4d):** backend `compileall` clean; frontend `tsc -b` + `vite build` clean. A
script confirmed `task_plan` registers as a `builtin` (LOW, agent-only), its `input_model` renders a
valid OpenAI fn schema (nested `$defs`), and a direct call returns the plan in `data["plan"]`. A
**full agent-loop test** (stubbed inference emits a `task_plan` call) confirmed it **auto-runs** —
no `tool.permission` — the `tool.result` carries `data.plan`, the loop continues to a text summary
(`done` completed), and the `tool_call` + `tool_result` (with `data.plan`) **persist** + round-trip.
Backend relaunched on 5433; `/api/actions` lists `task_plan` (8 tools). **Not yet eyeballed live:**
whether `minig+` actually calls `task_plan` for a multi-step ask, and the panel @390px — **owner to
do the side-by-side** (the `.b.plan` panel is net-new from vapor tokens).

**Verified (Phase 4c):** backend `compileall` clean; frontend `tsc -b` + `vite build` clean. A
stubbed-inference script confirmed `ChatRequest.mode` sanitizes (`local`/`cloud` kept, junk→`None`,
absent→`None`) and that `run_turn(mode="cloud")` forwards `mode` to `stream_chat` (turn → `completed`).
Backend relaunched on 5433 with the new code; health OK direct + via the Vite proxy (5190). **Not
yet eyeballed live:** the markdown rendering @390px against a real bot reply, the slash UX, and the
shell stub — **owner to do the side-by-side** (markdown CSS is net-new `.md` from vapor tokens; the
`.md-code` bar reuses the `.b.cmd` palette). Cloud-mode switching is plumbed and cloud is **now
configured** (OpenRouter Gemma 4 free; rate-limited — see note above).

**Phase 3 stays verified** (committed `2675f82`): service actions register with right risk/confirm,
`GET /api/services` derives port-probe status + url/controls, confirm dance + audit trail all
checked; owner has g5/emma services declared in `config.yaml` and the `.svc-row` reviewed @390px.

**Phase 2 stays verified** (committed `21781f7`): registry/`decide()`/confirm dance/audit/SSE all
checked; **owner ran the live stack against the real fleet (2026-05-27)** — fleet pings real hosts
+ a real WOL wake from the UI works. Still untested on a real host: `shutdown_host` end-to-end +
the confirm-dialog UX (Windows hosts need OpenSSH Server; Linux needs passwordless `sudo`).

(Phase 1 stays verified: `/api/health|hosts|hosts/{id}/status` correct under concurrent pings;
owner confirmed the pixel-exact side-by-side at 390px on 2026-05-27.)

## What this is

Single-user homelab control panel — wake/monitor/manage a PC fleet over LAN + Tailscale, with a
text/voice LLM agent that drives **typed, allowlisted actions** (not raw shell). **Tailscale-only,
no public bind, no auth** — never weaken that boundary.

## Locked decisions (one-liners — detail in DECISIONS.md)

- **Frontend:** mobile-first **PWA** — React 19 + TS + Vite 7 + TanStack Query + lucide-react +
  vite-plugin-pwa. Ports the Vapor design; widens to desktop.
- **⭐ Visual fidelity (D7):** the UI must be a **pixel-exact port of `vapor.html`** — lift the CSS
  verbatim, same fonts/colors/animations/components/themes; verify side-by-side. Not negotiable.
- **Extensible tools (D8):** Utils is a **tool registry** — a new tool (DNS trace, whois, …) is one
  file (handler + input + metadata) that auto-creates its endpoint, Utils card, and agent tool.
- **Backend:** **Python + FastAPI + Uvicorn**. Reuse paramiko / wakeonlan / openai /
  youtube-transcript-api. Async concurrent pings.
- **Execution:** **hybrid** — typed-action registry (UI + agent) is primary; one guarded
  `run_shell` (captured output, timeout, dangerous-flagged, agent-excluded by default) for the
  command escape hatch.
- **Persistence:** **SQLite** (threads / messages / memory / events) + **YAML** config
  (`config.yaml` shape preserved, secrets gitignored + masked).
- **Secrets model (decided Phase 0) — hybrid:** `config.yaml` is the UI-managed source of truth
  **including** nested secrets (per-host SSH creds, API keys); `.env` adds bootstrap paths
  (`CTRLB_CONFIG`/`CTRLB_DB`) + optional `CTRLB_<SECTION>__<KEY>` scalar overrides that **win** over
  the YAML. The app only ever rewrites `config.yaml`, never `.env`. Both gitignored; `.example`
  templates committed. Detail in `DESIGN.md` §9.
- **Ports:** backend on **5433** (the live Flask app keeps **5432** until cutover); Vite dev on 5173.
- **LLM/voice:** all OpenAI-compatible base URLs — chat (llama.cpp `llama-server` `/v1` or cloud),
  STT (faster-whisper `/v1/audio/transcriptions`), TTS (Kokoro/openedai `/v1/audio/speech`).
- **Agent integrations (D9), all configurable in Conf:** **MCP client** (multiple servers over
  **stdio** + **Streamable HTTP**, tools merged/namespaced), **SearXNG** endpoint → `web_search`
  tool, **embeddings** endpoint (llama.cpp `/v1/embeddings`) → vector memory.
- **Agent runtime (D10):** **context compaction** (auto + `/compact`), a built-in **`task_plan`**
  tool (+ extensible toolset — new tool = one file), and **skills** (`skills/<name>/SKILL.md`,
  model- or `/skill-name`-invoked). Study `RESEARCH.md` prior art (opencode + public Claude-Code).
- **Configurable agent design (D11):** **selectable summarizer model** (local/cloud + name);
  **multiple agents** as definitions (`agents[]`, add more) + **subagents** via a `spawn_subagent`
  tool; **skill-selection + orchestration are swappable strategies** — sensible default, easy to
  switch in settings, **concrete approach decided at Phase 4** with prior art in hand.
- **Composer prefixes:** `!<cmd>` (configurable sigil) → guarded shell; `/<cmd>` → slash commands
  incl. `/local`,`/cloud`; else → agent. Markdown bot replies + copy/send-to-composer on code blocks.
- **Mic needs a secure context → serve over HTTPS via Tailscale Serve** (tailnet-only, not Funnel).
- **Deploy profiles:** Windows / Ubuntu / Termux off one Python codebase.
- **Notifications:** optional (master toggle); default PWA-native (foreground + Web Push, auto);
  ntfy / Telegram-Discord optional; per-event toggles. No native app required.

## Build now so the post-v1 backlog slots in (the "seams")

Pluggable `MemoryProvider` · action `risk` levels on every action · typed chat-message kinds
(`text`/`action`/`question`/`plan`) + turn-based agent loop · chat endpoint supports streaming
**and** buffered · a settings/policy layer (privilege rides on `risk`) · **agents/skills/orchestration
behind swappable strategy interfaces** (don't hardcode) · Conf tab in functional groups
(Inference·Agent·Agents·Skills·Memory·Voice·Automations·Fleet·Server·Notifications·Appearance·Integrations).

## Open questions to resolve in-phase

- Agent tool-calling format + weak-local-model fallback (Phase 4).
- Embeddings backend specifics for vector memory (when B1 vector lands).
- **Agent privilege ladder** exact steps + escalation UX — least pinned down.
- **Agent design specifics (D11), deliberately deferred to Phase 4** — skill auto-selection
  algorithm, subagent orchestration, agents-as-YAML-vs-files, subagent depth/concurrency +
  privilege inheritance. Decide then, with the `RESEARCH.md` prior art (opencode + public
  Claude-Code) in hand; keep them swappable.
- **Real idle detection** mechanism (helper agent per host?) — the hard part of D1; optional/opt-in.
- Frontend routing: tab state vs react-router.

## Environment / running

- Host: **Windows 11**, shell **PowerShell** (`$null`, `$env:VAR`, backtick continuation); Bash
  tool also available. Python **3.11**. Backend venv already exists at `backend/.venv`; frontend
  deps already installed (`npm install` done).
- The **live Flask app** (`../../wol_server/wol_server_win.py`, port 5432) **keeps running** until
  cutover (TODO Phase 10). Do **not** modify it or the old prototype folders.
- Repo is **public** (`github.com/nengoxx/ctrl-b`); `dashboard_v2/` is tracked. Secrets
  (`config.yaml`, `.env`, `clients`, `*_prompt.*`) are gitignored — keep them out of commits/logs.
  The root `config.yaml` still holds a real OpenRouter key (gitignored, never committed) — the owner
  may rotate it.

## First action — Phase 7 Conf (or Phase 5 guarded shell)

**Phase 4.5 backend + the 2026-05-28 session work are all committed + pushed** (in sync with
`origin/main` at `c6d3ff5` — see the session block above). The weak-local-model selection problem
that dogged earlier phases is now **largely solved by the `fleet` intent-skill** (auto tool-narrowing),
with `skills: []` as the opt-out for a capable model. The natural next slices:
- **Owner visual side-by-side @390px** (D7) — newest un-eyeballed bits: the **reboot button**, the
  **clickable plan dots**, and a live fleet ask now rendering the **plan panel**. Plus the older
  skill/plan/markdown/subagent bubbles.
- **Phase 7 Conf tab** — incl. the **Skills/Agents management UI** (manage `agents[]`, tick tools
  per agent = roadmap A7, the `/agent` switch) **and per-tool description editing** (override seam is
  `ToolSpec.description`). Needs the `GET/PUT /api/settings` form infra; `GET /api/skills` exists.
- **Capability fallback (TODO 4c, now lower priority)** — prompted-JSON tool-calling for weak models.
  The `fleet` skill mostly removed the need by narrowing the toolset; this is the deeper lever if a
  model has weak *native* calling. (Cloud chat is wired but the free tier is rate-limited; BYOK or a
  paid `inference.cloud` model is the reliable capable-tool-caller path.)
- Or: wire real **Open WebUI tool servers** (`openapi_servers:`), or **Phase 5** (guarded `run_shell`).

Each piece its own runnable slice + commit (footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

**Small 4f leftovers (optional, non-blocking):**
- **MCP follow-ups:** both transports are done (Streamable HTTP + stdio). Still open: hot
  re-discovery on a settings `PUT` (Phase 7); rendering MCP/OpenAPI `output` in the bubble (a generic
  disclosure, like `web_search`'s links).
- **Cloud chat — DONE:** `inference.cloud` is configured (`https://openrouter.ai/api/v1`, model
  `google/gemma-4-31b-it:free`, same OpenRouter key as `embeddings:`); `default_mode` stays `local`.
  Live-verified (`stream_chat(mode="cloud")` → `pong`). The `:free` tier is rate-limited (frequent
  429s, surfaced as a clean SSE error); for reliable cloud, BYOK a Google AI Studio key in OpenRouter
  or set a paid model. The owner uses local most of the time, so this is left on free Gemma 4 as-is.
- **Wire real Open WebUI tool servers** via `openapi_servers:` (the provider's tested; just needs the
  owner's tool-server URLs + keys).

Optional 4b/4c/4d/4e follow-ups, none blocking — each is an **owner eyeball**, not a code task:
- **Eyeball live against `minig+`**: send a fleet question — confirm the model emits tool calls, the
  `.b.cmd` bubble streams in, and a `shutdown_host`/`stop_service` shows the confirm bubble + resume.
  Give it a **multi-step** ask ("wake titan then start minecraft") and confirm it calls `task_plan`
  and the **plan panel** renders/updates. Confirm a prose reply renders as **markdown** with the
  code-block copy/edit bar. If the thinking model's native tool-calling is unreliable, that's the
  **capability fallback** item (prompted-JSON → same `ToolCallPart` path; TODO 4c).
- **Compaction live (4e):** hold a long thread until it crosses `agent.compaction.threshold_tokens`
  (default 6000) and confirm the `// compacted N messages` breadcrumb appears + the agent still has
  context; try `/compact` manually. Optionally set a cheaper `agent.compaction.summarizer{mode,model}`.
- **Side-by-side @390px** of the markdown bubble, `.md-code` bar, and the `.b.plan` panel vs the Vapor
  look (D7) — owner's call.
- **`web_search` live (4f):** ask the agent something it must look up ("search the web for …") and
  confirm `minig+` actually calls `web_search`, the `.b.cmd` bubble shows the result + the collapsed
  **links** disclosure, and the model uses the hits. (Tool + live SearXNG verified; model-behavior check.)
- **MCP live (4f):** the agent now also has emma's 5 `mcp__web-tools__*` tools (crawl4ai/SearXNG).
  The owner set the server `risk: low` so they **auto-run** (read-only search/crawl — no confirm
  prompt, per the owner's preference). Confirm `minig+` picks an MCP tool for a crawl/search ask and
  the result feeds back. (Per-tool risk is annotation-aware: a server that sets `destructiveHint`
  would still gate that tool even at `risk: low`.)
- Cloud mode + the SSH service/shutdown path are still untested against a real host (shared one SSH path).

Open `TODO.md` → **Phase 4** is fully `[x]` (4a–4f). **Phase 4f is complete**: web_search, MCP client
(Streamable HTTP **+ stdio**), open-terminal tools, generic OpenAPI provider, embeddings. Next
runnable slice is **Phase 4.5 (skills + agents/subagents, D10/D11)** — keep skill-selection +
orchestration behind swappable strategies (D11); prior art in `RESEARCH.md`.

**Resume protocol (4b, for reference):** the confirm bubble's execute/dismiss POSTs
`/api/agent/resume {thread_id, call_id, decision, confirm_token}` and consumes a **fresh SSE stream**
(same event vocab as `/agent/chat`). `confirm_token` comes from the `tool.permission` event; the
client holds it in `store/chat.ts`'s `confirmTokens` map. A second message to a suspended thread just
starts a new turn — `_assemble` synthesizes a `skipped` result for the abandoned call so nothing breaks.

**Resolved open question (frontend routing):** went with **tab state** (the `store/ui.ts` `tab`
field), not react-router — 4 tabs, no deep-linking need yet.

**Phase 2/3 design notes worth carrying forward:** the UI invokes actions as `Actor.USER` /
`Privilege.CONFIRM`, so `risk` alone decides gating — `shutdown_host` (HIGH) and
`stop_service`/`restart_service` (MED) gate; wake/ping/`start_service`/`open_service_url` (LOW) run
immediately. Change the privilege and the gating changes, no per-button logic — the agent (Phase 4)
reuses the **same `ActionService`** with its own actor/privilege. The frontend reads `confirm`/`risk`
from the registry rather than hardcoding. Confirm tokens are in-memory + single-use + 120s TTL (a
two-step gate, not CSRF). Service liveness is **derived** (TCP port probe, cached at `poll_seconds`
off the fleet host status), never stored; service ids are `"{host_id}.{svc_slug}"`. `vapor.css`
stayed verbatim; net-new component CSS lives in `theme/extras.css`.
