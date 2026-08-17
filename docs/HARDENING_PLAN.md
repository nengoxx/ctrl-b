# HARDENING_PLAN — Phase 19: performance · reliability · design fitness

> **STATUS: SPECIFICATION ONLY (owner directive 2026-08-16) — execution comes later.**
> This document is the complete methodology + evidence base, written to be self-contained: a
> future session should be able to run the phase from this file alone. The owner rulings still
> needed before execution starts are collected in **§10** — nothing in §10 is decided yet.
> Council-reviewed 2026-08-16 (Codex + an independent Opus lens, both BUILD-WITH-CHANGES; all
> findings reconciled in §9). Evidence: [`research/R33-hardening-methodology.md`](./research/R33-hardening-methodology.md)
> · the 2026-08-16 open-findings sweep (§8) · the measured subsystem inventory @ `cdfd48d` (§7).

## 0. The charge (owner, 2026-08-16, lightly compressed)

"Harden the performance and reliability of the various subsystems, with their respective audits
and fixes and a thorough methodology — and any other part of the system that needs better design
or architecture. Question every design choice against common practices and better performance or
capability choices, so we can be sure every piece fits both together and is going to be able to
be maintained. Several points of view: main seat, Opus subagents, Codex."

**Second directive (owner, 2026-08-16, same day — widens the scope with a separate pass):** a
**design & architecture comparative pass** on two fronts. ① *"The theme engine, animations, and
basically the UI/UX, assessed and compared to standard practices and other similar projects'
design — to make sure we haven't overlooked a design flaw, an inconsistency, or simply an
inefficiency."* ② *"The same for the agent harness system, but with extra emphasis on the design
of the underlying turns, and the way we let the agent work and perform — in comparison with
projects like Claude Code, Codex, Hermes Agent, OpenClaw, and other efficient agent systems."*
Research bought and saved per the standing dossier convention. This is **Track D** (§3b);
the perf/reliability packets are **Track P**.

## 1. Scope and non-goals

**Phase 19 runs two tracks.** **Track P = backend + ops perf/reliability hardening** (packets
①–④, §3). **Track D = the design & architecture comparative pass** (packets DP-A and DP-B,
§3b) — a *design-lens* review, not a perf pass, judged against field practice via bought
dossiers.

Frontend/theme **performance** hardening remains a **separately chartered Phase 20**, opened
only if Phase 19's outcome and the F9/F13 trigger justify it. Rationale (council, accepted):
the FE perf headline items are *already owner-ruled* defer-until-measured with a named trigger
(UI_AUDIT F9/F13, set 2026-07-20), so a FE perf audit now would either re-report them or force
a re-ruling; and FE perf work is device-round-shaped — it needs owner screen time and cannot
close on autonomous mornings. **DP-A does not collide with this**: it reviews the *design* of
the theme engine/UI (contracts, token architecture, consistency, design-level inefficiency)
from docs + code + dossiers — measurement-light, morning-runnable; anything it finds that is
perf-measurement-shaped exits to Phase 20's charter, not into DP-A's fix wave.

**One deliberate cross-stack exception:** the SSE **wire contract** is audited end-to-end
including its client (`frontend/src/store/chat.ts` as the contract's consumer, plus the e2e
journey). A wire-contract change is **never authorized against the backend alone** — this closes
the "P3 ships a protocol fix, P9 later discovers the reducer assumed the old ordering" failure
mode without pulling FE internals into this phase.

**Declared non-goals** (recorded so they are never re-litigated; R33 §2.2/§3.3):
- No load testing, SLOs, error budgets, or on-call machinery (N=1 user, no traffic to divide).
- No CodSpeed / instruction-count CI benching (its cheap mode struggles with I/O — SQLite,
  subprocess, HTTP-to-LLM is our entire hot-path profile).
- No Lighthouse *scores* on emma (4 high-impact variance sources on a shared box; Lighthouse
  *audits* — the diagnostic list — remain fair game in Phase 20).
- No wall-clock perf gates in CI, ever. Gates only for deterministic quantities (bytes, counts,
  lint-shaped invariants). Where a timing assertion is genuinely wanted: a **catastrophe ceiling
  at ~10× observed** (goose posture — catches hangs, cannot flake).
- No scalability/multi-tenancy work; no new themes; no re-proposing ROADMAP §P items
  (QR-to-phone, picker disclosure).
- Fixes owned by a future phase are routed there, not built here (e.g. anything
  eval-harness-shaped → ROADMAP A12).

**The close rule: the phase CLOSES after Hf regardless of remaining candidates.** Residue exits
as ROADMAP entries with named triggers — `open, unscheduled` is a **banned status** in this
phase (the SYS-2/SYS-3/SYS-15 lesson: items that exited past audits into "opportunistically"
were still open months later). "Question every design choice" gets an end because every packet
is time-boxed: **one audit pass + one Codex round + one fix wave, hard stop.** One sizing
release valve (confirm-round fold): Packets ② and ③ are each larger than the whole of Packet ①
(~10k LOC each) — either **may split into two audit sub-waves at brief time** without
re-opening the charter; the time-box then applies per sub-wave, and the packet still closes with
one reconciliation + one fix ladder.

**Staleness rule (spec-only deferral):** §7/§8 are snapshots @ `cdfd48d` and are the ordering
evidence. If execution opens after further releases, **re-run the inventory + sweep as a delta
pass before H0** — the packet ranking is only as good as its numbers.

## 2. The methodology

Named pattern (R33): **TARA per subsystem** (Woods, WICSA 2011 — single-assessor assessment of
an implemented system; ctrl-b's SYS-#/F#/PR-# ledgers already match its finding format), plus
four ATAM concepts worth their cost at solo scale:

- the **non-risk register** — every "it's fine because…" written as a *falsifiable assumption*
  (single user · tailnet-only · N≈7 hosts · one SQLite writer · Fennec+Chrome only · …). A
  non-risk stays a non-risk only while its assumptions hold; writing them down converts "it's
  fine" into a claim a future change can check itself against.
- **sensitivity points** ("use caution when changing this") and **tradeoff points** (a property
  that is a sensitivity point for more than one quality — where "better performance" costs
  something else; these are *recorded decisions*, e.g. SQLite `synchronous` under WAL).
- **refutable statements** — "the architecture shall be robust" is banned phrasing; every
  quality judgement must be operationally checkable.

Plus **FMEA reduced to its detection column** ("would the owner ever find out?" — objectively
answerable from the code: log line, UI state, toast, event row; for a service with no monitoring
and one user asleep half the time, undetectability is the dominant risk multiplier), and
**concrete failure scenarios** feeding that table (no free-floating pre-mortem prose — council
cut). Design critique uses the Ousterhout vocabulary (module · interface · depth · seam ·
adapter · leverage · locality) + the deletion test ("would deleting it concentrate complexity,
or just move it?"). Peer comparison only from dossiers (buy-once; §5) — never from folklore.

### 2.1 The packet — fix-first

**A packet's deliverable is its fix wave.** The written packet is capped at **~one page plus the
finding cards**, recording only what changed a verdict:

a. The subsystem's **non-risk register**.
b. **Sensitivity/tradeoff points.**
c. The **FMEA-lite table**: failure mode | user-visible effect | current DETECTION | current
   mitigation | disposition. No RPN arithmetic.
d. Quality-requirement judgements are made **inside the packet where a verdict needs one**
   (refutable, with the assessor's H/M/L confidence) — there is no up-front all-subsystems
   requirements pass (council cut: numbers an auditor invents and then cites to itself are not
   a yardstick; the *journeys* in H0 are the yardstick).
e. **Finding cards** (§2.2).

**The cross-system reliability matrix** (the council's strongest addition): reliability must be
*failure-tested, not only structure-read*. Derived from the H0 journeys, a fixed list of
cross-subsystem modes, each probed where safe:

| Matrix item | Packet |
|---|---|
| Concurrent turn + SSE reconnect/re-attach | ② |
| Scheduler claims a run while a manual agent turn runs | ③ (with ②'s turn knowledge) |
| Config write during an active turn (hot-apply vs in-flight state) | ① |
| Shutdown/restart during DB write / active SSE | ① + ② |
| Provider timeout/failover mid-stream, partial tool call | ② |
| Service-worker update while a session is active | ④ |

Each credible mode gets **exactly one disposition**: a safe probe (temp `CTRLB_CONFIG`/
`CTRLB_DB`, stubbed fault, dev unit), an existing test (named), or an explicit
**unverified-risk** entry. Targeted concurrency probes are not load testing.

### 2.2 Findings: ids, severity, exits

- **Every new observation is an H-#** — canonical id assigned by the main seat at
  reconciliation; reviewers use temp labels (prevents two seats minting the same id). **One
  authoritative index table in this plan**: id · claim · **impact HIGH/MED/LOW** (user/system
  impact — same axis as the existing ledgers) · **evidence status** (REPRODUCED /
  VERIFIED-IN-SOURCE / INFERRED / HYPOTHESIS) · packet · ruling · destination · fix ref ·
  verification. Recommendation strength is **not** a recorded axis; impact + evidence drive
  rulings (council correction: "Strong/Worth-exploring/Speculative" conflated confidence with
  impact and would mis-rank a plausible data-loss race below a confident nitpick).
- **Existing ids are never re-minted.** An H-# may be tagged CONFIRMS / EXTENDS / RELATED-TO an
  existing SYS-#/F#/…; the old ledger gets a status-line update pointing at the H-#. The H-# is
  the single authoritative body; everything else is a pointer. No per-finding routing judgement
  (the 2026-08-16 sweep found 8 bookkeeping-drift items, all products of items living in two
  places).
- **A number is required to accept a perf fix, not to record a risk.** Hypothesis-labeled
  findings and measurement-gap findings are legal. Reviewers receive the known-open register
  (§8) as *context, not a gag* — dedup happens at main-seat reconciliation, not by reviewer
  self-censorship.
- **No unscheduled exits**: every accepted-not-now finding leaves the phase with a slice number
  or an F9-style named trigger.

### 2.3 The three-view loop per packet + the fix ladder

1. **Main seat** writes the packet brief: scope files + the measured numbers (§7) + that
   subsystem's slice of the known-open register (§8) + the matrix items it carries + what the
   *other* reviewer covers (no re-treading; two reviewers never share a lens on the same
   artifact).
2. **Opus subagent** (high, pinned brief): the deep audit — reads the subsystem end-to-end,
   runs the packet's measurements, drafts evidence (§2.1 a–d) + candidate findings.
3. **Codex** (`gpt-5.6-sol` high, read-only sandbox): adversarial round with the complementary
   lens (correctness/failure-modes vs design/perf — inverted per packet as fits).
4. **Main seat reconciles**: cross-checks findings against code + locked D-entries (a finding
   contradicting a D-entry needs a fact that breaks it, else the D-entry wins and the ruling is
   recorded), assigns H-#s, **re-derives the leanest fix** for every accepted finding (standing
   correction: Codex's diagnoses land, its prescriptions over-build — take the finding, not
   necessarily the fix).
5. **The pre-authorized fix class** (owner ruling §10.②, requested once): a fix that is XS/S,
   confined to the packet's files, behavior-preserving (or behavior-improving within
   already-ruled semantics), gate-green, touching **no D-entry and no security boundary**, ships
   in the packet's fix wave **without a per-item owner ruling** (the `commit-autonomously-
   clearly` posture, extended). Everything M+, behavior-visible, D-entry-adjacent, or
   security-adjacent goes to the owner's afternoon queue. This keeps 4 packets from needing 12
   ruling gates.
6. **The fix wave is new code**: it gets its own Codex review round; for M+-sized waves, a
   **cuts-only round first** (the D55 precedent — Codex briefed to argue only for cuts is this
   project's most effective counter to its own over-engineering). Gate green before merge;
   waves touching the wire or any journey also run the **targeted local e2e** journey (the
   Playwright suite runs on demand — e2e reality must not wait for a release tag; the v1.7.0
   lesson: the local pre-push gate runs NO e2e, only the CI release gate does).
7. **Pause between packets** (standing owner cadence); no packet opens while the previous fix
   wave is unmerged.

## 3. The slice ladder

Order note (council, accepted): **H1 runs before H0** so the owner charters with numbers in
hand, not blind.

### H1 — Baseline (measure first; zero fixes)

Journey-level measurement with a real protocol, per R33/LibreChat: each journey of the
**ruled §10.① list** (the list ruling arrives with the execution go, so H1 measures the real
set; H0 afterwards sets only the thresholds) driven N times against the **dev unit** (prod is touched read-only, via py-spy),
cold/warm separated and reported separately, medians + ranges (never means alone), git sha
stamped, host load recorded, **the other dev unit + second agent stopped** during measured
blocks. Instruments:

- **`py-spy record`** during driven journeys (flamegraph/speedscope output; `py-spy top`/`dump`
  are live diagnostics, not recorded artifacts). Attach-by-PID is production-safe; `dump` is
  also the standing "what is the agent loop stuck on" tool.
- **`PYTHONASYNCIODEBUG=1`** on the dev unit while driving journeys → the ≥100 ms slow-callback
  log. **Recorded as a diagnostic channel, not a latency number.** Known blind spot (probed,
  R33): anyio's thread pool is 40 tokens and work parked there (sync handlers,
  `run_in_threadpool`, subprocess waits) is *invisible* to this detector — py-spy covers it.
- **`EXPLAIN QUERY PLAN`** over the hot queries (messages/events/memory/automations) **with
  representative bindings, table cardinalities, and observed query times**. A `SCAN` on a
  growing table is a *lead*, not automatically a finding (council caveat: a query intentionally
  returning most rows, or using an index for ordering, legitimately scans).
- **FE bytes as a trend point only** (Phase 20 owns FE): split initial JS / lazy JS / CSS /
  compressed transfer / SW precache / media; `dist/stats.html` and sourcemaps excluded (raw
  `dist du` = 9.4 MB is NOT a user-relevant number). `rollup-plugin-visualizer` is already wired.

Output: a **measured-baseline table appended to this plan** (§ as-built), sha-stamped. It is the
before-picture every later before/after claim compares against.

### H0 — Charter (owner-ruled, small; becomes D58)

① Per journey of the §10.① list: an acceptable worst case AND a **detection clause** — how a
violation would be *noticed* (the clause that is always missing) — set with H1's numbers in
hand. **If H0 adds or materially edits a journey, it gets an immediate baseline top-up before
any packet opens** (Codex confirm-round fold — no journey enters a packet unbaselined).
② The **pre-authorized fix class** (§10.②). ③ The packet ranking confirmed (§10.③ — one table;
the ATAM utility tree is dropped as ceremony, the measured inventory already orders the work).
④ The non-goals + the close rule ratified.

### H2 — Hygiene + quick wins (proves the phase ships fixes on day one; de-loads every packet)

- The **8 bookkeeping-drift items** (§8.4).
- The **4 missing spec homes** — fleet/monitor, automations, PWA/SW, ConfTab have no section in
  the canonical DESIGN/SPEC/ARCHITECTURE trio (measured fact, §7). Right-sized: a section only
  where a durable external contract is genuinely absent; no speculative docs.
- **Coverage measurement wired for both runners** — the open SYS-15 half, and the prerequisite
  for ever using test-density arguments in later packets (council: "13 tests / 1,589 LOC" is
  test *count*, not execution coverage; measure before prioritizing by it).
- **E2e-local preflight**: prove the Playwright journeys run on demand on emma (with
  `TMPDIR=/home/emma/.cache/tmp` — /tmp is 16G RAM-backed tmpfs; filling it fakes flaky e2e).
- **Ordering inside H2** (confirm-round fold): the named fixes land first — they are the
  day-one proof the phase ships fixes; the spec homes may slip within the slice without
  stalling it.
- The **already-named, no-audit-needed fixes**: `PRAGMA optimize` (+ `optimize=0x10002` at open,
  periodic + after schema changes — sqlite.org prescribes exactly our single-long-lived-
  connection shape) · `getJSON` global timeout (standing KIT item) · SYS-7 fleet tunables →
  `ServerCfg` (+ rehome the finding — its named home, the D3 slice, completed without it) · any
  H1 EXPLAIN lead whose fix is a one-line index · the media-resolver stat cache **only if H1's
  numbers implicate it** (it's an uncached `iterdir()`+`stat()` per index request today, but
  measure first).
- One combined Codex round over the whole slice.

### H3 — Packet ① Persistence + config/bootstrap → calibration checkpoint

`db.py` + `domain/` + `config.py` + `main.py`/`runtime.py`/`deps.py`. The worst-covered
chokepoint (13 tests / 1,589 LOC) + the 2,211-line config module + SYS-2's home (two-phase Deps
init). Matrix items: config-write-during-turn, shutdown-during-DB-write. Candidate questions
recorded now: single-connection SQLite leaves WAL read concurrency unused (a design *choice* to
either justify in the non-risk register or revisit); `synchronous` under WAL as a recorded
tradeoff point; `load_settings` running ≥2× per boot; per-call FS/CPU rework (SYS-8's recorded
seam).

**→ CALIBRATION CHECKPOINT** (council: the original post-packet-5 checkpoint arrived after the
sunk cost): findings vs fixes vs sessions vs owner-minutes, with the **explicit right to re-cut
the packet form** before Packet ②.

### H4 — Packet ② The agent turn, end-to-end

`services/agent/` (session/turns/compaction/steering/exec) + `api/agent.py` + events/
conversation + `adapters/inference.py` + provider registry/failover + **the wire contract
including `store/chat.ts` as consumer** (contract level only — FE internals stay Phase 20).
The seams BETWEEN loop/wire/inference are this packet's reason to exist as one unit (largest
backend file `session.py` 2,646 with 3 `while True` drive loops; `api/agent.py` 2,008 — a
router grown into a subsystem, itself a structural finding candidate; the `while True` retry
loop at `inference.py:1490`). Prompt registry: spot-check only (newest, best-tested code).
Matrix items: concurrent turn + reconnect, provider timeout/failover mid-stream, shutdown
during SSE.

### H5 — Packet ③ Subprocess & integrations family

Tool registry/permissions/actions (`ActionService.invoke` — the security-critical chokepoint,
SYS-3's home) + agent memory/skills/subagents **incl. D57 Core Memory** (`core_memory.py` +
tool + head injection + the §3b copy-in surface; landed after the §7 inventory — see the §7
delta note; its live-drive residuals ride CORE_MEMORY_PLAN §14) + fleet/monitor/wake +
automations/scheduler + external adapters (mcp/ssh/wol/voice-backend/searxng — several have no
direct tests). Includes the **SECURITY_MODEL §5 safe-defaults re-walk** (the core-memory secret
gate + write rails join that walk) and the scheduler/manual-action matrix item.
Perf question recorded: the fleet sweep spawns one subprocess ping per host per sweep, driven by
both the FE poll and the monitor loop (R12's measured precedent: the tailnet adapter already
replaced a 5 ms subprocess with a 0.16 ms socket read — is the same available here?). The 4
backend `while True` loops get one shared review of their common shape (R13: sleep-then-work
self-rescheduling = structurally overlap-free; verify all four match it).

### H6 — Packet ④ Media + PWA/SW → continue/close checkpoint

`core/media.py` + `api/media.py` + the service worker (prompt-mode update flow — just had its
first real exercise 2026-08-16 — precache manifest, the 2 runtimeCaching routes and their
interaction with `Cache-Control: no-cache`). Matrix item: SW update mid-session.

**→ CONTINUE/CLOSE CHECKPOINT**, then:

### Hf — Fitness functions + close

Only deterministic, only what earned it: a bundle/precache budget on a **user-relevant
quantity** (initial-load bytes or SW precache bytes — not raw `dist du`; the Codex
`blob-size-policy` pattern: baseline + headroom, allowlist-escapable) · every invariant a packet
found worth pinning becomes a `test_arch_invariants_*` test ("the guarantee must be a TEST, not
a type" — R30's registry-bypass evidence). Wall-clock stays recorded-not-gated. Deploy/update
path + quality harness get their short review here (proven by 5 live releases; the H2 preflight
already validated the measurement/e2e machinery). Then the phase **closes**: residue → ROADMAP
with triggers; the **Phase 20 (FE/theme) charter decision** goes to the owner with Phase 19's
numbers in hand.

### The unit→packet manifest (every §7 unit assigned exactly once — nothing escapes silently)

| Inventory unit | Home |
|---|---|
| Bootstrap/runtime · config+settings API · config migration · DB+domain | Packet ① |
| Agent loop · chat API/SSE/events · inference/providers/failover · prompt registry (spot-check) · `store/chat.ts` as wire consumer | Packet ② |
| Tools/actions/permissions · memory/skills/subagents **(incl. D57 core memory — the §7 delta)** · fleet/monitor/wake · automations · external adapters + voice backend | Packet ③ |
| Media resolver · PWA/service worker | Packet ④ |
| Deploy/update path · quality harness | Hf (H2 carries the preflight) |
| FE shell/lib · FE query layer · FE stores (non-wire) · chat/composer UI · ConfTab/editors · theme engine/kit · themes · voice FE | **Perf lens: Phase 20** (F9/F13 triggers stand) · **Design lens: DP-A** (theme engine/motion/UX; §3b) |
| Agent harness design-vs-field (turns + capability layer) | **DP-B** (§3b — Packet ② keeps the perf/reliability lens on the same code) |
| E2E suite | Consumed by H2 preflight + fix waves; SYS-18c widening exits to ROADMAP with a trigger |

## 3b. Track D — the design & architecture comparative pass

Same machinery as Track P — the three-view loop (§2.3), H-# finding cards with impact +
evidence (§2.2), the close rule, the time-box, the pre-authorized fix class — but a different
packet form, because the question is different: not "is it fast/reliable" but **"is this
design right, consistent, and efficient compared to how the field solves the same problem?"**

### The design-packet form

a. **The design-choice register**: enumerate the area's load-bearing design choices (from
   D-entries + the owning docs + the code), and classify each against the dossier evidence:
   **ALIGNED** (matches field practice) · **JUSTIFIED DIVERGENCE** (differs, and the reason is
   recorded — our constraints genuinely differ: single user, tailnet, Fennec, solo maintainer)
   · **UNJUSTIFIED DIVERGENCE** (differs with no recorded reason that survives the evidence —
   a finding). A divergence is never a finding *by itself*; the field can be wrong for our
   constraints — the register forces the reason to be written either way.
b. **Internal-consistency sweep**: the CLAUDE.md two-failure-mode rule applied as an audit —
   *different code for similar things* (parallel implementations bypassing a pattern) and
   *similar code for the same thing* (near-duplicates that should be one source of truth).
c. **Design-efficiency critique**: Ousterhout vocabulary + the deletion test — shallow
   modules, needless indirection, interfaces wider than their use, leverage points.
d. **Sensitivity/tradeoff points** (same as Track P) + finding cards (H-#, same index).

**Comparison discipline**: every "the field does X" claim cites a dossier line (R34–R36 or an
existing dossier) — never folklore; where the dossiers are silent, the packet may commission a
bounded follow-up buy (§5) or record the question as evidence-gap, not guess.

### DP-A — Theme engine · motion · UI/UX

Scope: `theme-engine/` + Kit architecture (token contract, Swappable Surfaces D31, kit-vs-
bespoke §14.4, the layer/scope isolation model), the motion system (`--motion-*`/`--ease-*`
state, per-theme animation conventions, reduced-motion handling), and the UX surface
(navigation/app-bar/sheet patterns, Conf information architecture, consistency of interaction
grammar across themes). Evidence: **R34** + the existing THEME_ENGINE/VAPOR_PATTERNS records +
R15/R24/R26 (perf mechanics stay bought, not re-argued). Explicit hunt list from the charge:
overlooked design flaws · inconsistencies (internal and vs-field) · design-level inefficiencies
(e.g. token-layer structure vs the field's primitive→semantic→component layering; kit.css
monolith vs per-surface files; per-theme duplication the token contract should absorb).
Locked constraints honored: vapor byte-frozen (D51) · cosmos feature-closed · **no new themes**
· D7 per-theme fidelity. Perf-measurement-shaped findings exit to Phase 20's charter.

### DP-B — The agent harness: turns + how the agent works

Scope, with the owner's stated emphasis: **the turn design** — lifecycle/state machine, the
SSE wire + reconnect/durability contract, steering/drain semantics, compaction triggers,
per-call snapshots, retry layering (wire vs loop vs adapter) — and **the capability layer** —
tool surface size/granularity vs the field, parallel dispatch (D40) vs peers' defaults, output
caps/truncation norms, planning/task-tracking, subagent orchestration, autonomy/approval
patterns, caching-aware prompt ordering — **and the D57 memory tiering** (owner, 2026-08-17:
the two-tier model, head-injection/cap/promotion design and the copy-in interop judged vs the
field; evidence already bought: R37/R38/R39). Evidence: **R35 (turn machinery) + R36 (capability
layer)** + the ACA 8-agent comparative baseline + R30/R31. Peer set (owner-named): Claude
Code, Codex CLI, **Hermes Agent, OpenClaw** (both D14 references), + opencode/goose/aider as
the dossiers cover them. Overlap rule vs Track P's Packet ②: **Packet ② owns
perf/reliability-of-the-implementation; DP-B owns design-vs-field.** If both run, DP-B runs
FIRST or together with Packet ②'s audit pass (one subsystem read can serve both lenses — the
briefs say which lens each reviewer carries); DP-B design verdicts inform Packet ②'s fix wave
so we never harden a design the review is about to overturn (the fix-in-owning-phase rule).

### Ordering (owner-reorderable at charter)

DP packets are morning-runnable (docs + dossiers + code reads; no device rounds). Default:
**DP-B before or with Track P Packet ②** (shared read, see above) · **DP-A anytime**,
naturally after the H2 hygiene slice; its fix wave lands before Phase 20 is chartered so the
Phase-20 decision sees the post-design-review landscape.

## 4. Where results land (doc plumbing)

- This file is the plan of record once §10 is ruled; **D58** (reserved — D57 went to Core Memory, owner 2026-08-17) locks the methodology +
  the pre-authorized fix class in DECISIONS.md. TODO.md gains Phase 19 (the H-ladder as
  checkboxes) at charter time. HANDOFF points here.
- Per-packet **as-builts append to this plan** (the GACHA_PLAN §7 ladder pattern): one page +
  finding cards each. The H-# index table lives in this file.
- Existing ledgers (SYSTEM_AUDIT, UI_AUDIT, …) receive status-line updates pointing at H-#s —
  never a second authoritative body.
- **Colocated code notes**: only for rename/refactor-fragile sensitivity points, and they state
  **the assumption + what breaks if it changes** inline (the SYS-18a `kit.css` header pattern) —
  never a bare "see D58" pointer (the SYS-13 stale-pointer failure mode). R33's locality finding
  (peers keep per-package arch docs, 0/9 keep ADRs) is answered by the 4 spec homes in H2, not
  by comment sprinkles.

## 5. Research buys (bounded, packet-tied, buy-once)

| Shelf gap (2026-08-16 index) | When |
|---|---|
| **R34 — UI/theming/motion design practice** (W3C tokens, Radix/shadcn/Material 3, HA frontend, peer theming contracts) | **BOUGHT 2026-08-16** (commissioned with the Track D directive) — feeds DP-A |
| **R35 — peer turn architecture** (Codex CLI, Claude Code, Hermes Agent, OpenClaw, opencode/goose/aider: turn lifecycle, wire, steering, compaction, resume) | **BOUGHT 2026-08-16** — feeds DP-B |
| **R36 — agent capability patterns** (tool surface/granularity, parallel dispatch, planning, subagents, autonomy/approvals, caching-aware design) | **BOUGHT 2026-08-16** — feeds DP-B |
| SSE/streaming reliability in the peer class (reconnect, heartbeats, mid-stream cutoffs, resume) | Before Packet ② — **check R35 first**; buy only the delta |
| LLM provider failure-mode handling (timeouts, retries/idempotency, streaming aborts, partial tool calls) | Before Packet ② (same agent if scope allows) |
| Observability/logging posture in peers (SYS-11's seam: what to log, health surfaces, crash recovery) | Before Packet ① or ③ (wherever SYS-11 lands) |
| SQLite practice at our shape beyond R33 (single writer, aiosqlite, schema evolution) | Only if Packet ①'s questions exceed R33 |
| Peer FE long-thread performance | Phase 20's charter, not now |

One bounded agent per buy, no nested subagents, dossier drafted by the agent into
`docs/research/` per that README's conventions, indexed by the main seat.

## 6. Standing rules + operational nuances (the full list — nothing lives only in a session)

- **Measure before judging**; a number to *accept a perf fix*, not to *record a risk*.
- **Lean-fix rule**: severity attaches to the finding; the fix is re-derived to the minimum that
  closes it. Bug fixes stay minimal — no protection the old code never had.
- **Locked D-entries win** absent a breaking fact; a breaking fact goes to the owner as a
  D-entry amendment, never a silent override.
- **Gate green every wave** (pre-commit `--fast`, pre-push full); wire/journey waves run
  targeted local e2e; heavy gates run with `TMPDIR=/home/emma/.cache/tmp` (tmpfs discipline).
- **Never live-test config writes** against the real `config.yaml` — `CTRLB_CONFIG`/`CTRLB_DB`
  temp copies for every probe; prod is touched read-only (py-spy attach) and never edited in
  place; releases only via the runbook §Release.
- **Measurement hygiene**: stop `ctrl-b-dashboard-dev{,-web}` and the second agent during
  measured blocks; record host load with every number; alternate base/HEAD/HEAD/base blocks for
  any comparison; cold samples reported separately; medians + IQR, outliers never removed from
  a valid block; sha-stamp everything.
- **Subagent discipline**: one bounded question per agent, max 5 concurrent, briefs forbid
  nested subagents, confidence markers demanded, reviewers get the known-open register as
  context-not-gag, two reviewers never share a lens on the same artifact.
- **Owner cadence**: autonomous audit/measure work in the mornings; rulings + eyeball rounds in
  the afternoons; the afternoon queue carries only M+/behavior-visible/D-entry/security items
  (§2.3.5). Pause between packets; the owner's four standing owed items (notifications retest ·
  first prompt-edit drive · media-gallery round · corsair cold-boot watch) keep priority over
  new ruling asks.
- **Session hygiene**: long audit stretches hand off per the standing >200–300k context rule —
  the plan + as-builts must always be current enough to resume from.
- **No new deps** without a named robustness/quality justification (standing owner posture:
  justified deps fine, reflexive minimalism not required).
- **Commit cadence**: commit autonomously when each change is clearly stated; pushing waits for
  owner confirmation; release only on explicit ask.

## 7. The measured inventory (2026-08-16, `main` @ `cdfd48d` — the numbers that order the work)

Corpus: backend `app/` **28,812** LOC / 111 files · frontend `src/` **50,796** / 278 · backend
tests **37,971** LOC / **1,333** `def test_` · FE vitest **34,211** / **1,822** cases · e2e
**4,311** / 69 · `dist` 9.4 MB. 25 review units, 16 chokepoints. Full per-unit table (files ·
LOC · tests · spec § · perf notes) is reproduced from the inventory pass:

> **Post-inventory delta (2026-08-17):** Phase 20 Core Memory (D57) landed AFTER this measure —
> `core_memory.py` 1,271 + `core_memory_tool.py` 253 LOC, 2,766 test LOC across 3 files, touch
> points in 13 modules (session head injection, tool registry, config, Conf API). **H1 re-measures
> it in**; it reviews as part of the memory unit (Packet ③) + DP-B (owner, 2026-08-17 — the
> thorough pass covers it on BOTH lenses, perf/reliability and design/architecture; §3b's delta
> council check confirms the assignment).

| Unit | LOC | Tests | Chokepoint | Load-bearing numbers / notes |
|---|---|---|---|---|
| Bootstrap & runtime (`main/runtime/deps`) | 1,277 | 30 | YES | Every adapter built here (boot + reconfigure); `_memory_sweep` loop in lifespan |
| Config & settings API (`config.py` 2,211) | 2,551 | 68 | YES | Single 2,211-line module; `load_settings` ≥2×/boot; every subsystem reads Settings live |
| Config-shape migration | 1,664 | 95 | release-gate | Pure `(applies, apply)` steps; proven over 5 releases |
| **DB + domain** (`db.py` 450 + 11 domain files) | 1,589 | **13** | YES | **Worst chokepoint ratio (122 LOC/test)**; one aiosqlite conn + process write lock; WAL on, read concurrency unused; no `PRAGMA optimize` |
| Tools/permissions/actions (`ActionService.invoke`) | 2,766 | 88 | YES | The security chokepoint; only subprocess/SSH spawner |
| **Agent loop** (`session.py` 2,646 + 10 modules) | 4,875 | 253 | YES | Largest backend file; 3 `while True` drive loops; per-call frozen snapshots |
| Memory/skills/subagents | 1,750 | 103 | no | git subprocess on backup/reconcile; per-request file reads |
| Prompt registry (Phase 18) | 493 | 71 | YES | Best-tested (7 LOC/test); newest code |
| **Inference/providers/failover** (`inference.py` 1,643) | 2,776 | 210 | YES | Retry `while True` @ :1490; failover generator + backoff; per-gate semaphores |
| External adapters + voice | 1,964 | 59 | no | `tailnet.py` already socket-not-subprocess (R12); `searxng`/`wol` no direct tests |
| Fleet/monitor/wake | 1,344 | 93 | partial | One subprocess ping **per host per sweep**, FE-poll + monitor dual-driven; sleep-then-work loop |
| Automations/scheduler | 2,499 | 104 | YES | Poll-and-claim loop; second entry point into agent loop |
| Media resolver (`core/media.py` 608) | 764 | 33 | YES | `iterdir()`+`stat()` per index request, **no cache**; mount serves `Cache-Control: no-cache` |
| **Chat API/SSE/events** (`api/agent.py` 2,008) | 2,499 | 110 | YES | Router grown into a subsystem (drain tasks, harvest sweeps, cursors); 15 s keepalive; per-iteration disconnect checks |
| FE shell/chrome + lib | 2,778 | 94 | no | BottomSheet rAF drag/snap |
| FE API client + query hooks | 3,805 | 136 | YES | `useFleet`/`useServices` poll at `poll_seconds`; `useScopedQuery` pauses on hidden tab |
| **FE stores** (`store/chat.ts` 2,335) | 3,602 | 216 | YES | The SSE→UI reducer; per-frame patches; localStorage persistence |
| FE chat & composer UI | 3,405 | 151 | no | `ChatThread` renders `messages.map()` — **no virtualization** (F9's trigger) |
| **FE Conf tab** (`ConfTab.tsx` 2,577) | 8,184 | 252 | no | One 2,577-line component, code-split behind lazy |
| Theme engine + Kit (**`kit.css` 6,136** = largest file in repo) | 9,335 | 239 | YES | `safeRafLoop` gated animation; `@scope`/`@layer` |
| Themes ×5 (gacha 11,995 of 19,687) | 19,687 | ~730 | no | Best-tested corpus; 4 canvas/rAF surfaces; NOT a packet |
| Deploy/install/update | 1,571 | 3 | YES | Proven by 5 releases, not tests |
| Quality harness/CI | 1,002 | 4+ | YES | Local gate runs NO e2e (v1.7.0 lesson) |
| E2E suite | 4,311 | 69 | no | `layout.spec.ts` 1,808 lines / 31 tests dominates runtime |
| PWA/SW (vite-pwa config + SwUpdatePrompt) | ~190 cfg | 3 e2e | YES | prompt-mode update (first real exercise ✅ 2026-08-16); 2 runtimeCaching routes |

No-direct-test modules (import-level, verified): BE `searxng.py`, `wol.py`, `fsutil.py`,
`core/agents.py`, `svc.py`; FE `vapor/heroScene.ts` (284 L, largest untested FE module),
`MiniPlayer`, `PrivilegeChip`, `toolsMenu` sheets, `cosmosDive`, `useMemory`, `useTools`,
`lib/prefetch`, `lib/promptPreview`, a.o. (Phase 20 for the FE list.)

## 8. The known-open register (2026-08-16 sweep of all 11 ledgers — every packet brief carries its slice)

**8.1 Ledger verdicts:** QH-1…16 fully closed · PRE_DEPLOY closed (one stale §6 QR line — §P
wins) · PROMPTS_AUDIT: only PR-1 (deliberate-non-fix, `params:{}` seam recorded) · ACA Slices
0–8 shipped (residue below) · UI_AUDIT F1–F29 shipped except F9/F13 (trigger-gated: thread
>~200 msgs OR owner-reported input lag while streaming) + the §6b later-list.

**8.2 Genuinely OPEN, buildable (the audits must not re-report these — CONFIRMS/EXTENDS only):**
SYS-2 (two-phase `Deps` init, invalid states representable — Packet ①) · SYS-3 (tool overrides
mutate shared registry specs in place; overlay-at-read inversion — Packet ③) · SYS-7 (hardcoded
fleet polling tunables; **homeless** — H2 rehomes) · SYS-10 (default-theme literal duplicated
across codebases) · SYS-11 (logs-only observability; no logging-config seam) · SYS-15 halves
(coverage measurement — H2; fleet/svc characterization tests — Packet ③) · SYS-16 strict
ratchet (own slice, post-emma) + ASYNC240 lexical blind spot (recorded gap) · SYS-18c (e2e
smoke-scale vs theme matrix — ROADMAP exit) · SYS-9.3 (`store/chat.ts` raw fetch bypasses
`api/client.ts` — Phase 20 unless Packet ② touches it) · kit standing items (`getJSON` timeout
— H2; sr-only dup; a11y-e2e no-sheet-arm; `skipActiveViewTransition` global) · C2-L6/L7
(subagent-safety + skills-zero-context contracts partially unpinned — Packet ③) · SYS-17c (TTS
blob accumulation, conditional LRU) · C3 chunked TTS (buildable, big TTFA win — voice, Packet ③
records, likely ROADMAP exit) · 6b list (Switch div→button · store HMR · F29 draft persistence
[design LOCKED 2026-06-16] · knob `left`→`translateX` · motion tokens — all Phase 20) ·
**CM-1 (added 2026-08-17):** the core-memory secret gate is best-effort by construction —
`_SECRET_MIN_CHARS = 8` floor means a real ≤7-char credential is outside the rail
(CORE_MEMORY_PLAN §14b; joins Packet ③'s SECURITY_MODEL §5 re-walk) · **CM-2 (added
2026-08-17):** the default `index_char_limit` 8192 sits at 99% fill on a realistic 57-topic
corpus — the 80% consolidation nudge is permanently on at that scale (cap sizing vs nudge
threshold; Packet ③ CONFIRMS/EXTENDS, owner may resize at the live round first).

**8.3 OWNER-GATED / PARKED (ask, don't assume; §P never re-propose):** notifications retest
(path 2) · web-push parked (2 Fennec checks) · D2-A daily-use round · media-gallery round ·
vault spec · gacha color-theory session · R28 icon pickup · fleet-liveness decoupling (watch
first) · ~80 MB gacha originals call · **§P: QR-to-phone · picker disclosure**.

**8.4 The 8 bookkeeping-drift items (H2 fixes):** ① SYS-7 homeless (its named home, the D3
slice, completed without it) · ② eslint-warn count disagrees 27/38/42 across
QUALITY/PRE_DEPLOY vs UI_AUDIT vs HANDOFF (count it, fix all three) · ③ PRE_DEPLOY §6 QR line
stale vs ROADMAP §P · ④ TODO Phase-18 slice boxes unchecked though shipped (+ idle-sleep
backlog box vs Phase 15 COMPLETE) · ⑤ SYS-17c never dispositioned in SYSTEM_AUDIT §4's table ·
⑥ UI_AUDIT F21 status-table row stale (closed per closing line) · ⑦ ACA LIVE-VERIFY lists'
observation status unrecorded (ask owner once) · ⑧ SYS-15 halves unowned (this plan now owns
them: H2 + Packet ③).

**8.5 DELIBERATE-NON-FIX register (recorded decisions — re-opening one requires new evidence,
listed by home):** ACA §5/§7 residuals (S1-LOW-2/3, S1-INFO-5, S5-obs-1/2, S6-res-1/2/3, C1-L5,
C2-L4/5, C4-M1-res, C5-L4, S3-cold, ACA-15a/b) · SYS-8 (per-call FS/CPU rework; mtime-memo
seam) · PR-1 · A7-res · D3-res · 14b-res · F1-res1/2 · G-R20-2, G-R21-1/2 · HANDOFF LOWs 1–6 ·
I1-win · LOW-4 (`extra_body` unmasked, SECURITY_MODEL-noted) · vitest-include note.

## 9. Council record (2026-08-16)

**Codex (`gpt-5.6-sol` high, read-only): BUILD WITH LISTED CHANGES.** Findings accepted: C1
journey-level baseline + protocol (H1 rewritten) · C2 the cross-system reliability matrix
(§2.1) · C4 impact/evidence severity split, strength dropped (§2.2) · C5 measurement/e2e
preflight before packets + targeted local e2e per wave (H2, §2.3.6) · C6 the unit→packet
manifest (§3) · C7 EXPLAIN/coverage/dist caveats (H1, H2) · C8 temp-id → canonical H-# + one
authoritative index (§2.2) · C9 CONFIRMS/EXTENDS + hypothesis findings, number-to-fix-not-to-
record (§2.2) · C10 pre-mortem folded into FMEA scenarios, spec homes right-sized, pointer
comments restricted (§2, §4). It endorsed as sound: the non-risk register, detection-FMEA,
deterministic-only gates, before/after rule, declared non-goals.

**Opus (independent process-fit lens): BUILD WITH LISTED CHANGES.** Findings accepted: H-A
fix-first packet + one-page cap + pre-authorized fix class + no-unscheduled-exits · H-B merge
12 packets → 4 + hard close rule + per-packet time-box (evidence: Phase 18 ran 5 slices in ~2
days *from a pinned spec*; 12 audit packets ≈ 16–22 sessions and 12 afternoon ruling gates) ·
H-C two-phase charter (FE = Phase 20; its headliners are already owner-ruled with triggers) ·
H-D calibration checkpoint after Packet ① · H-E all-new-observations-are-H-# (no per-finding
routing) · H-F H0 cut to journeys+detection, H1 first, utility tree dropped · H-G the
hygiene/quick-wins slice up front · H-H colocated notes = assumption+consequence only · H-I
cuts-only Codex round for M+ fix waves.

**Overruled / modified (main-seat rulings, with reasons):**
- Codex C3 (contract clusters spanning into the FE packet) → replaced by the narrower §1 rule
  "the wire contract is audited with its consumer and never fixed backend-only"; FE internals
  still defer (Opus's already-owner-ruled evidence wins; C3's failure scenario is closed by the
  contract rule at a fraction of the scope).
- Codex C8's per-packet id prefixes (`H-P03-001`) → plain sequential H-# (temp-id + a single
  assigner already prevents collision; prefixes are ceremony).
- Codex C1's production-build phone trace in H1 → deferred to the Phase-20 charter unless an H1
  journey number implicates the client (the journey timings will say; phone tracing is
  device-round work).
**Confirm rounds on the reconciled text (2026-08-16):**
- **Opus: RESOLVED**, 3 non-blocking residuals, all folded: the ②/③ sub-wave release valve
  (§1) · the staleness/delta rule for the spec-only deferral (§1) · H2 orders named fixes first
  (H2).
- **Codex: all 10 findings RESOLVED**; one new defect from the reconciliation — H1 measuring
  candidate journeys the owner hadn't ruled — folded as: the journey LIST is ruled with the
  execution go (before H1), H0 sets only thresholds, and any journey added/edited at H0 gets an
  immediate baseline top-up before packets open (H1/H0 sections). With that fold, no open
  council findings remain.

**Scope note:** §3b (Track D) was added **after** this council round, on the owner's second
2026-08-16 directive. It reuses the council-reviewed machinery unchanged (three-view loop, H-#
index, close rule, fix classes); the new material is the design-packet form and the DP-A/DP-B
scoping. **A delta council check on §3b is owed before the execution go** — one Codex round +
one Opus round over §3b only, not a re-review of the whole plan.

## 10. OWNER COURT — the rulings needed before execution (nothing here is decided)

① **The critical user journeys** — proposed five: *wake a host → see it online* · *ask the
agent → streamed answer* · *a scheduled automation fires attributably* · *cold PWA open on the
phone* · *a config edit round-trips safely*. Add/cut/edit. **This list ruling arrives with the
execution go, before H1** (so the baseline measures the real set); the per-journey worst case +
detection clause are then set at H0 with numbers in hand.
② **The pre-authorized fix class** (§2.3.5) — this is the one process change: XS/S,
in-packet-scope, non-behavioral, non-D-entry, non-security fixes ship without per-item rulings.
③ **The packet ranking** — proposed ① persistence/config → ② agent turn → ③ subprocess family
→ ④ media/PWA. Reorderable at H0.
④ **The two-phase charter** — Phase 19 backend+ops now; Phase 20 FE/theme later, chartered on
Phase 19's numbers + the F9 trigger.
⑤ **D58 lock** — on go, DECISIONS.md gains D58 (this methodology; D57 = Core Memory, owner 2026-08-17), TODO gains Phase 19, HANDOFF
points here.
⑥ **Track D ordering** — proposed: DP-B runs before/with Track P Packet ② (shared subsystem
read, design verdicts inform the hardening fixes); DP-A runs after H2, before the Phase-20
charter decision. Confirm or reorder. (The §3b delta council check runs before the go
regardless.)
