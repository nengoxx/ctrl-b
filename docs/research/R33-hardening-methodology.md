# R33 — Hardening methodology: architecture review, production readiness, and performance auditing at solo scale

**Date:** 2026-08-16 · **Class:** mixed — established methods literature (primary sources) + peer-class
repo survey (open-webui · LibreChat · opencode · Codex CLI · AnythingLLM · goose · aider · Continue · LiteLLM)
**Brief:** what established, *lightweight* methodologies exist for (a) reviewing an existing system's
architecture against common practice, (b) production-readiness/reliability review, (c) performance
auditing of a FastAPI+SQLite backend and a React PWA — and what the peer class actually practices.
**Drove:** the owner's hardening charge ("question every design choice against common practices…
so we can be sure every piece fits together and will be maintainable") — no D-entry yet.

**Confidence key:** **VERIFIED** = I read the primary source / probed the repo or this machine ·
**REPORTED** = secondary source or search snippet · **UNVERIFIED** = expected, not checked.

---

## 0. The headline

1. **The method that fits ctrl-b already exists and is named: TARA** (Woods, WICSA 2011). It was
   designed for exactly our situation — an *existing implementation*, a *single assessor*, and
   stakeholders who will not sit in a room. Cost, quoted by its author: *"explain what you're going
   to do in 10 minutes and do it in 2 or 3 days, write it up in another day and deliver the results
   in a couple of hours."* (**VERIFIED**, §1.2)
2. **ATAM is the ceremony.** It is a two-phase, 3–50-stakeholder workshop method whose value is the
   *vocabulary* (utility tree, sensitivity point, tradeoff point, risk/non-risk), not the process.
   Lift the vocabulary, drop the workshop. (**VERIFIED**, §1.1)
3. **Nobody in the reference class runs perf regression *gates* on UI or agent latency.** 3/9 peers
   carry a perf harness at all, and all three are explicitly **non-gating / excluded from CI
   discovery**, or assert only catastrophe ceilings with ~10× headroom. The one CI-gated perf suite
   (LiteLLM/CodSpeed) works *because* it measures simulated instruction counts, not wall time — and
   CodSpeed's own docs say that mode "struggles with I/O", which is ctrl-b's entire backend profile.
   (**VERIFIED**, §4)
4. **0/9 peers keep ADRs.** What the field actually ships in 2026 is *colocated `AGENTS.md` per
   package* (opencode 12+, LiteLLM 8+) — architecture guidance next to the code, addressed to agents.
   ctrl-b's `DECISIONS.md` is an outlier, and a good one; the gap it has vs the field is
   **locality**, not existence. (**VERIFIED**, §4.3)
5. **The measurement discipline is the deliverable, not the numbers.** LibreChat's benchmark README
   is a better artifact than its benchmark: base/HEAD/HEAD/base alternating blocks, cold sample
   excluded, block medians *and* pooled median reported, outliers never removed from a valid block,
   host CPU load captured to make contaminated runs visible. (**VERIFIED**, §4.2)

---

## 1. Architecture review, scaled down

### 1.1 ATAM — what survives, what is ceremony (**VERIFIED**, CMU/SEI-2000-TR-004, read via `pdftotext`)

Nine steps: *1* present the ATAM · *2* present business drivers · *3* present architecture · *4*
identify architectural approaches · *5* generate quality-attribute utility tree · *6* analyze
architectural approaches · *7* brainstorm and prioritize scenarios · *8* analyze architectural
approaches again against the step-7 scenarios · *9* present results. Two phases, with verbatim *"as
few as three to five stakeholders … as many as 40 or 50."*

**The four concepts worth stealing** (quoted/paraphrased from §7 of the TR):

| Concept | Definition | Why it survives at solo scale |
|---|---|---|
| **Utility tree** | Quality attributes → refinements → leaf scenarios, each prioritized on **two** axes: *importance to success* and *perceived risk of achieving it* (H/M/L each) | Gives a defensible ordering for "what do I harden first" with two cheap judgements per item. The report explicitly prefers H/M/L: *"stakeholders cannot reliably and repeatably make finer distinctions than High, Medium, and Low."* |
| **Risk / non-risk** | A **non-risk** is *"a good decision that relies on assumptions that are frequently implicit"* — and it must be recorded, with its assumptions. *"For a non-risk to remain a non-risk the assumptions must not change."* | This is the single most transferable idea for ctrl-b. Half of our design choices are non-risks whose assumptions (single user, tailnet-only, N≈7 hosts, one SQLite writer) are *implicit*. Writing them down converts "it's fine" into a falsifiable claim. |
| **Sensitivity point** | *"a property of one or more components … critical for achieving a particular quality attribute response"* — a **yellow flag: "use caution when changing this property"** | The natural output format for a hardening pass — cheaper and more durable than a fix. |
| **Tradeoff point** | a property that is a sensitivity point for **more than one** attribute | Names the places where "better performance" costs something else, which is the owner's actual question. |

The report also demands scenarios be **refutable**: *"'The architecture shall be modifiable and
robust' [is] untenable here, because [it has] no operational meaning: they are not refutable."*

**Ceremony to drop:** the two-phase agenda, stakeholder brainstorming/voting (step 7), the
presentation steps (1, 2, 9), and ABASs (attribute-based architectural styles) with their analytic
models (rate-monotonic analysis, queuing, Markov) — those exist to make a room of people converge.

### 1.2 TARA — the method actually designed for our case (**VERIFIED**, Woods, WICSA 2011, full text read)

Woods built TARA because scenario methods *"are not very widely used in industry, with informal
approaches or 'assessment by committee debate' being more common."* TARA differs from ATAM on four
axes, quoted:

- *"The approach isn't based on scenarios because creating valid and meaningful scenarios requires a
  lot of time and effort from a range of system stakeholders."*
- *"The method assumes that the system has already been implemented … where an implementation is
  available it forms an important input to the process."*
- *"TARA deliberately doesn't mandate specific sub-techniques (such as ATAM's use of quality
  attribute trees). Such techniques can all be used if appropriate."*
- *"TARA is intended for use by a single assessor or a small group of assessors."*

**The seven steps** (verbatim headings):

1. **Context diagram and requirements** — *"usually gathering this information is part of the
   assessment exercise."* Where quality requirements don't exist, *"the best approach … is to
   suggest a set of credible quality requirements based on domain and organisational standards and
   norms."* The requirement list is itself an output.
2. **Functional and deployment views** — "architectural sketches": runtime element structure + the
   environment it deploys into.
3. **Code analysis** — the objective counterweight: *"the code doesn't lie."* Recommended measures:
   module structure and dependencies (**automated**, "so showing the *real* structure"), size split
   **production vs test**, complexity/duplication/coupling metrics, and **test coverage**.
4. **Requirements assessment** — *"inevitably one of judgment rather than quantifiable assessment"*;
   output = requirement areas each with *"a clearly defined measure of the assessor's confidence …
   (we have typically used High/Medium/Low and 1-5)."*
5. **Identify and report findings** — grouped into *"logical concern-oriented groups, with each
   finding being clearly described with a short meaningful name, an identifier, a full description
   and a justification."* Explicitly iterative: writing findings sends you back to earlier steps.
6. **Create conclusions for the sponsor** — restate findings against *"the explicit or implicit
   questions being asked by the sponsor."*  ·  7. **Deliver the findings and recommendations.**

**Its own stated weaknesses** (do not skip these): *"Relatively Shallow — … the insight achieved is
relatively shallow … The results of a TARA assessment should be treated with some caution"*; and
*"Structure Based — … TARA doesn't [analyse the design process, the decisions made and their
tradeoffs]. The focus of TARA is on the architectural structures of the system."* That second one
matters: TARA assesses *what is there*, not *whether D-entry 37 was the right call* — pair it with
§1.4 for the decision half.

> **Shape match.** ctrl-b's `SYSTEM_AUDIT.md` / `UI_AUDIT.md` / `PROMPTS_AUDIT.md` already use TARA's
> finding format (short name + `SYS-#`/`F#`/`PR-#` id + description + justification, grouped by
> concern) — we have been doing TARA without the name. The steps we **skip** are 1 (no written
> quality requirements exist) and 3 (no automated dependency/complexity extraction; no coverage).

### 1.3 Architecture fitness functions (**REPORTED** for the taxonomy, **VERIFIED** for peer instances)

Ford/Parsons/Kua, *Building Evolutionary Architectures*: a fitness function *"provides an objective
integrity assessment of some architectural characteristic(s)."* Categories (**REPORTED**, O'Reilly
ch.2 via search — the chapter itself 403s): **atomic** (one aspect, singular context) vs **holistic**
(combined aspects, shared context); **triggered** (on a build) vs **continual** (in production);
implemented via *"tests, metrics, monitoring, logging, and so on"* — not one mechanism. Thoughtworks
adds seven example domains — code quality, resiliency, observability, performance, compliance,
security, **operability** (*"runbook presence, README documentation, alert configuration"*) — and
pushes automation into the pipeline (**REPORTED**).

**ctrl-b already ships fitness functions and doesn't call them that** (**VERIFIED**, local read):

| Existing | Category | Notes |
|---|---|---|
| `test_arch_invariants_qh9.py` pinning the OS-branch allowlist | atomic, triggered | Textbook architectural fitness function. |
| `stylelint-high-performance-animation` (transform/opacity budget) | atomic, triggered | Runs **warn-first** (exit 0) — a *measured* fitness function with no gate, which is the right posture for a burn-down. |
| `ctrlb/accent-*` custom stylelint rules | atomic, triggered, **error** | Correctness invariants with zero violations → gated. The repo already applies the "gate only what is at zero" rule. |
| a11y e2e (`@axe-core/playwright`) | holistic, triggered | CI-release-gate only. |

The gap vs the field: **no size/weight fitness function**. Codex CLI's `blob-size-policy.yml` is the
concrete precedent — `scripts/check_blob_size.py --max-bytes 512000 --allowlist
.github/blob-size-allowlist.txt` over the PR's changed blobs (**VERIFIED**, file read). Cheap,
deterministic, machine-independent, allowlist-escapable. That shape generalizes directly to a
**bundle-size** or **installed-media** budget for ctrl-b.

### 1.4 "Question every choice" formats

- **Active Design Reviews** (Parnas & Weiss, JSS 1987) — the oldest and sharpest answer to "how do I
  review without a room": *"The designers pose questions to the reviewers rather than vice versa"*,
  on questionnaires that force the reviewer to **make positive assertions** about the design rather
  than merely spot defects; 2–4 person interactions replace the big meeting. (**REPORTED** — abstract
  snippets only.) → Solo translation: the artifact is a **questionnaire answered in prose**, not a
  checklist to tick. "Which call sites depend on this being ordered?" beats "☐ ordering documented".
- **Pre-mortem** (Klein, HBR 2007): assume it has already failed, generate plausible causes.
  Grounded in Mitchell/Russo/Pennington 1989 — *prospective hindsight* raised correct identification
  of reasons for a future outcome **by 30%**. (**REPORTED**.) Cheapest technique in the dossier: one
  paragraph per subsystem, and the only one that reliably surfaces what a code read will not.
- **Deep-vs-shallow module critique** (Ousterhout vocabulary), as practiced by a peer — see §4.3.

---

## 2. Production-readiness / reliability review

### 2.1 Google's PRR (**VERIFIED**, *SRE Book* ch.32, fetched)

Two stated objectives: *"Verify that a service meets accepted standards of production setup and
operational readiness"* and *"Improve the reliability of the service in production, and minimize the
number and severity of incidents."* Six phases in the "Simple PRR" model: **Engagement → Analysis →
Improvements and Refactoring → Training → Onboarding → Continuous Improvement**, with *"a PRR
checklist explicitly for the Analysis phase."*

Sample analysis-phase checklist items quoted in the chapter:
- whether updates impact an unreasonably large percentage of the system simultaneously
- whether the service connects to appropriate dependency instances
- whether the service reports errors to central logging systems
- whether **user-visible request failures are well-instrumented and monitored**

**The honest reduced form for ctrl-b.** Four of the six phases (Engagement, Training, Onboarding,
Continuous Improvement) exist to transfer a service between *teams*; there is no second team. What
survives is **Analysis + Improvements** — one artifact, a per-subsystem checklist answered in
writing. The four sample items translate almost verbatim: *does an update take everything down at
once (the tag-pinned `update.sh` path already answers this)* · *does it talk to the right instance
(`CTRLB_CONFIG`/`CTRLB_DB`, prod :5433 vs dev :5434)* · *do errors reach one place* · *would I ever
find out that a user-visible failure happened*.

### 2.2 SLOs, honestly reduced (**VERIFIED**, *SRE Workbook*, "Implementing SLOs", fetched)

- *"We recommend choosing a small number (five or fewer) of SLI types that represent the most
  critical functionality to your customers."*
- **Critical user journey** = *"a sequence of tasks that is a core part of a given user's experience
  and an essential aspect of the service."* And the caveat: *"These tasks will almost certainly not
  map well to your existing SLIs; each task requires multiple complex steps that can fail at any
  point."*
- *"For your first SLIs, choose something that requires a minimum of engineering work."*
- *"Your first attempt at an SLI and SLO doesn't have to be correct; the most important goal is to
  get something in place and measured."*

**Reduced form:** a single-user tailnet service has no error budget (no traffic to divide, no
customers to disappoint, no on-call to page). What it *does* have is **critical user journeys** —
for ctrl-b plausibly: *wake a host* · *ask the agent something and get a streamed answer* ·
*a scheduled automation fires and is attributable* · *open the PWA cold on the phone*. The honest
artifact is not "99.5% availability" but **a named journey + a stated acceptable worst case + a way
to notice when it is violated**. The third clause is the one that is usually missing.

### 2.3 Fowler's eight standards (**REPORTED**, *Production-Ready Microservices*, via search)

stability · reliability · scalability · fault tolerance · catastrophe preparedness · performance ·
monitoring · documentation. Useful only as a **coverage checklist for the review's section
headings** — not as a standard to meet. Scalability is a non-goal at N=1 user / N≈7 hosts and should
be *declared* a non-goal rather than silently skipped.

### 2.4 FMEA-lite (**REPORTED**)

Classical FMEA scores each failure mode Severity × Occurrence × Detection = **RPN**, acting on
RPN ≥ 150 and recomputing after mitigation; it assumes *"a multidisciplinary, cross-functional
team."* Software FMEA is acknowledged even by advocates to be *"subjective and qualitative …
relying on engineer experience and instinct."*

**What survives is not the arithmetic — it is the third column.** Severity and Occurrence a solo
maintainer estimates badly and knows it. **Detection** ("would I ever find out?") is objectively
answerable from the code: is there a log line, a UI state, a toast, a notification, an event row?
For a service with no monitoring, no alerting, and one user who is asleep half the time,
*undetectability is the dominant risk multiplier* — and it is the column ctrl-b's audits have never
systematically filled in. Lite table: `failure mode | user-visible effect | current detection |
current mitigation | verdict`. Four columns of fact, one of judgement. Skip RPN.

---

## 3. Performance audit for this stack

### 3.1 Backend — FastAPI / asyncio

**The dominant class of bug in this stack is a blocking call on the event loop**, and Python ships
the detector for free (**VERIFIED**, docs.python.org asyncio-dev):

- Enable via `PYTHONASYNCIODEBUG=1`, `-X dev`, `asyncio.run(debug=True)`, or `loop.set_debug()`.
- *"Callbacks taking longer than 100 milliseconds are logged"*; the threshold is
  `loop.slow_callback_duration` (seconds).
- Also enables thread-safety checks on non-threadsafe APIs and logs slow I/O-selector executions.
- The doc's own framing: *"Blocking (CPU-bound) code should not be called directly. For example, if a
  function performs a CPU-intensive calculation for 1 second, all concurrent asyncio Tasks and IO
  operations would be delayed by 1 second."*

This is a **zero-cost, one-env-var audit** that runs against the real dev unit and produces a
ranked list of offenders with no instrumentation. It should be step one of any backend perf pass.

**The FastAPI-specific structural fact** (**VERIFIED**, probed on emma, py3.14 venv): `def`
(non-`async`) route handlers and every `run_in_threadpool` call route through
`anyio.to_thread.run_sync`, whose default capacity limiter is **40 tokens** (`CapacityLimiter(40)` in
`anyio/_backends/_asyncio.py:3038`; runtime probe → `total_tokens = 40`). Two review consequences:
(a) sync handlers don't block the loop but contend for a fixed 40-slot process-wide pool; (b) a
long-running sync call parked in that pool (an SSH wake, a subprocess ping) is **invisible to the
asyncio slow-callback detector**.

**Profiling a live service:** `py-spy` (**VERIFIED**, repo README) — *"a sampling profiler … It lets
you visualize what your Python program is spending time on without restarting the program or
modifying the code in any way"*; `record` (flamegraph/speedscope), `top` (live), `dump` (all thread
stacks now). *"py-spy is extremely low overhead: it is written in Rust for speed and doesn't run in
the same process as the profiled Python program. This means py-spy is safe to use against production
Python code."* `--native` covers C extensions. For a systemd-managed prod unit this is the right tool
and `cProfile` is the wrong one: attach by PID, no restart, no code change, no config-shape risk.
**`py-spy dump` is also a reliability tool** — the fastest answer to "what is the agent loop stuck on".

**SQLite.** Current ctrl-b state (**VERIFIED**, `backend/app/db.py:284-286`): `journal_mode=WAL`,
`busy_timeout=<BUSY_TIMEOUT_MS>`, `foreign_keys=ON`. Not set: `synchronous`, `cache_size`,
`mmap_size`, and no `PRAGMA optimize` anywhere in the tree.

- `PRAGMA optimize` (**VERIFIED**, sqlite.org/pragma.html): *"Applications that use long-lived
  database connections should run `PRAGMA optimize=0x10002;` when the connection is first opened,
  and then also run `PRAGMA optimize;` periodically, perhaps once per day or once per hour"*; and
  *"All applications should run `PRAGMA optimize;` after a schema change, especially after one or
  more CREATE INDEX statements."* ctrl-b holds exactly one long-lived connection and applies numbered
  SQL migrations → both clauses apply verbatim. Cost: *"usually a no-op or nearly so and is very fast."*
- `EXPLAIN QUERY PLAN` per hot query is the highest-value SQLite audit and needs no tooling — a
  `SCAN <table>` on a growing table (events, messages, memory) *is* the finding. (**UNVERIFIED**
  which of ctrl-b's queries scan.)
- `synchronous=NORMAL` under WAL is the standard durability/throughput trade — a **tradeoff point**
  in the ATAM sense (durability × latency), so a *decision to record*, not a default to apply. On a
  UPS-less homelab box the honest answer may be "leave FULL".

**Load testing is theater here.** One user, ≤2 concurrent SSE streams, a scheduler. Throughput has
no meaning; **tail latency of a single interaction on a cold cache** and **whether one slow path
starves another** do. Measure the journey, not the RPS.

### 3.2 Frontend — React PWA

- **`<Profiler>`** (**VERIFIED**, react.dev): `onRender(id, phase, actualDuration, baseDuration,
  startTime, commitTime)`; `actualDuration` reflects memoization effectiveness, `baseDuration` is the
  un-memoized worst case. Caveat, quoted: *"Profiling adds some additional overhead, so it is
  disabled in the production build by default. To opt into production profiling, you need to enable a
  special production build with profiling enabled."* → never quote dev-build numbers as the app's cost.
- **Core Web Vitals** (**VERIFIED**, web.dev/articles/vitals): **LCP ≤ 2.5 s · INP ≤ 200 ms · CLS ≤
  0.1**, measured at the **75th percentile** of page loads, segmented mobile/desktop. INP replaced
  FID and *"became a stable Core Web Vital metric in 2024."*
  → For ctrl-b the p75-of-a-population framing collapses: there is **one** user on **one or two**
  known devices. The metric definitions still apply (INP is the right number for "does the fleet
  card feel snappy"); the *percentile* does not. Measure on the device, repeatedly, and report the
  distribution.
- **Baseline device** (**VERIFIED**, Russell, *The Performance Inequality Gap, 2026*, Nov 2025):
  Samsung Galaxy A24 4G (MediaTek Helio G99 / Exynos 1330 class) on **9 Mbps down / 3 Mbps up /
  100 ms RTT**. Derived critical-path budgets, 2 TLS connections:

  | Target | JS-light total | JS-light JS | JS-heavy total | JS-heavy JS |
  |---|---|---|---|---|
  | 3 s | 2.0 MiB | 0.3 MiB | 1.2 MiB | 0.62 MiB |
  | 5 s | 3.7 MiB | 0.57 MiB | 2.3 MiB | 1.15 MiB |

  *"using four connections cuts the three-second budget by 350 KiB, to 1.5 MiB."*
  → ctrl-b's real network is a LAN/tailnet, not 9 Mbps — so the **byte** budget is slack and the
  **CPU** budget (main-thread work on a mid-range Android under Gecko) is the binding constraint.
  That inverts the usual advice: bundle size is *not* our problem; long tasks and layout/paint on
  Fennec are. This is consistent with the theme-engine gotchas already recorded (§14.11).
- **Bundle analysis** already wired (**VERIFIED**, `frontend/vite.config.ts:4,19` — `rollup-plugin-
  visualizer` emitting `dist/stats.html`, explicitly excluded from the SW precache at line 71). The
  measurement exists; there is no **budget** and no trend record.
- **Lighthouse CI** (**VERIFIED**, getting-started.md): runs Lighthouse **3× per HTML file** by
  default, uploads reports, sets GitHub status checks, asserts against `lighthouse:recommended`.
  Its variability doc (**VERIFIED**) is the reason to be careful: seven named variance sources, four
  **high impact** (page nondeterminism, local network, client hardware, resource contention), the
  mitigation *"The median Lighthouse score of 5 runs is twice as stable as 1 run"*, and hardware
  minimums (≥2 dedicated cores / 2 GB; avoid burstable cloud instances). On emma — a 30 GB box also
  running two agents, a prod unit and a dev unit — Lighthouse **scores** would be noise; Lighthouse
  **audits** (the pass/fail diagnostic list) would not.

### 3.3 Are regression *gates* worth it here?

Evidence says: **gate only the deterministic quantities; record the rest.**

| Quantity | Deterministic on a noisy shared box? | Verdict |
|---|---|---|
| Bundle bytes / blob size / asset count | Yes | **Gate.** (Codex's `blob-size-policy` is the pattern.) |
| Lint-shaped invariants (animation properties, arch allowlist) | Yes | **Gate** — already done. |
| Instruction counts (CodSpeed simulation) | Yes, hardware-agnostic | Not applicable — see below. |
| Wall-clock backend latency | No | **Record**, compare A/B by protocol (§4.2). |
| Lighthouse score / INP / render duration | No | **Record**; assert only catastrophe ceilings. |

CodSpeed's own docs (**VERIFIED**): simulation mode *"Simulates CPU behavior to measure performance,
taking into account instructions executed, cache and memory access patterns"* and *"Benchmarks run
only once for consistent, hardware-agnostic results"* — **but** it *"adds overhead that slows down
long-running benchmarks significantly"* and *"struggles with I/O operations due to simulation
variance"*; use walltime instead for I/O or >5 s benchmarks. ctrl-b's hot paths are SQLite I/O,
subprocess ping/SSH, and HTTP to an LLM. **CodSpeed-style CI gating does not fit this codebase.**

pytest-benchmark's FAQ (**VERIFIED**) is the other half: *"You run other services in your machine
that eat up your cpu or you run in a VM and that makes machine performance inconsistent"*, and when
variance is unavoidable, *"IQR is often better than StdDev"* — prefer median/IQR, raise warmups, and
consider `time.process_time` to exclude I/O and sleep.

---

## 4. Peer practice — what the reference class actually does

Survey method: GitHub API, default branch, recursive tree + `.github/workflows` listing, 2026-08-16.
All rows **VERIFIED** by reading the listed paths/files.

### 4.1 Inventory

| Project | Perf harness | In CI? | Reliability extras | ADRs |
|---|---|---|---|---|
| **open-webui** | none | — | `lint-backend.disabled`, `lint-frontend.disabled` (lint workflows literally disabled); frontend CI = format + i18n-parse + `git diff --exit-code` + build + unit tests | none |
| **LibreChat** | `e2e/benchmarks/` (agent-startup latency) + one vitest `.bench.tsx` | **No** — no benchmark workflow exists | `a11y.yml`, `docker-smoke.yml`, 2 Playwright workflows, `frontend-windows-nightly.yml`, `mongoose-latency-hook.cjs` (synthetic DB delay) | none (but a vendored `improve-codebase-architecture` skill references `docs/adr/`) |
| **opencode** | `packages/app/e2e/performance/` — 20+ files, `benchmark.ts` fixture, `chrome-trace.ts`, capped + uncapped Playwright configs, a `timeline-stability/` matrix suite | **No** — *"excluded from normal local and CI Playwright discovery"* | `typecheck.yml`, `test.yml`, `storybook.yml`, 12+ colocated `AGENTS.md` | none |
| **Codex CLI** | one criterion bench (`codex-rs/utils/image/benches/prompt_images.rs`) | unclear | **`blob-size-policy.yml`** (512 KB/blob + allowlist), `postmerge-ci.yml`, `cargo-deny`, `check-clean-worktree` action | none |
| **AnythingLLM** | none | — | `lint.yaml`, `run-tests.yaml`, `check-package-versions`, `check-translations` | none |
| **goose** | `ui/desktop/tests/e2e/performance.spec.ts` (`performance.mark()` + console log) | not in `ci.yml` | `pr-smoke-test.yml`, `update-health-dashboard.yml`, `scorecard.yml` (OpenSSF), `recipe-security-scanner.yml`, `documentation/docs/goose-architecture/error-handling.md` | none |
| **aider** | `benchmark/` — a **model/prompt** benchmark (exercism harness), not a perf harness | no | `pre-commit.yml`, ubuntu+windows test workflows | none |
| **Continue** | none | — | `auto-fix-failed-tests.yml`, snyk | none |
| **LiteLLM** | `.github/workflows/codspeed.yml` (**pytest-codspeed, `mode: simulation`**) + `weekly_load_anomaly.yml` (cron Sat 12:00, real Postgres service, boots the proxy, polls `/health/liveliness`) | **Yes** — the only one | `mutation-test.yml`, `ci-coverage.yml`, ~20 sliced `test-unit-*.yml`, `zizmor` (CI-security lint), `osv-scan`, `codeql`, `image-scan`, root + per-module `ARCHITECTURE.md` | none |

### 4.2 The two harnesses worth copying (both **VERIFIED** by reading their READMEs)

**opencode — `packages/app/e2e/performance/README.md`.** Load-bearing lines:

- *"excluded from normal local and CI Playwright discovery. The benchmark config builds the app and
  serves the production bundle before running scenarios serially."* — production bundle, serial, opt-in.
- *"The fixture requires every benchmark to call `report()` … and emits metrics as a consistent
  `BENCHMARK` JSON line"* → `BENCHMARK {"name":…,"context":{…},"metrics":{…}}`; navigation history is
  attached on failure.
- **The assertion posture, quoted:** *"Benchmarks do not assert machine-dependent performance
  budgets. … Assertions verify scenario and metric collection completion."*
- *"The streaming scenario's 30x CPU throttle is a deterministic stress profile, not a simulated
  end-user device."* — throttling *amplifies* differences; explicitly disclaimed as a device model.
- Metrics: renderer-observed completion time, throughput, **RAF callback-gap distributions**,
  frame-budget equivalents, **long tasks**, geometry settlement — disclaimed as *"main-thread
  callback diagnostics, not compositor presentation or dropped-frame measurements."* Traces are plain
  Chrome DevTools traces (`OPENCODE_PERFORMANCE_TRACE_DIR`), loadable in the Performance panel.

**LibreChat — `e2e/benchmarks/README.md`.** Measures three intervals from the Enter keypress:
`submitToAckMs` (POST response ends), `submitToFirstContentMs` (first token in the DOM, *before
paint*), `ackToFirstContentMs`. The protocol, quoted:

- *"The first request is reported separately as `cold`. Warmups and measured samples each use a new
  conversation, and measured conversations are deleted so history growth does not bias later
  samples."* (defaults: 5 warmups, 30 samples) · *"Each report also captures host load and CPU
  utilization to make contaminated runs visible."*
- *"For a base-versus-HEAD comparison, use identical dependencies and benchmark files, alternate
  blocks in base/HEAD/HEAD/base order, and exclude the cold samples. Report both block medians as
  well as the pooled median; do not remove outliers from an otherwise valid block. Avoid running
  builds, test workers, or other CPU-heavy work at the same time."*
- A **synthetic-I/O profile** (`E2E_LATENCY_MONGO_DELAY_MS`) *"reveals changes to the request's
  asynchronous critical path"*, with the discipline: *"Always label and report that profile
  separately … it is a controlled workload, not a claim about production database latency."*

**goose** shows the third posture: `expect(metrics['time-to-first-token']).toBeLessThan(10000)` and
`toBeLessThan(60000)` — **catastrophe ceilings with ~10× headroom**, not budgets. Immune to machine
noise; catches hangs and pathological regressions only.

### 4.3 Architecture-review habits (**VERIFIED**)

- **ADR directories: 0/9.** No `docs/adr/`, no numbered decision records anywhere in the class.
- **What replaced them: colocated agent-facing architecture docs.** opencode ships `AGENTS.md` at 12+
  paths including `packages/core/src/tool/AGENTS.md` and
  `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md`. LiteLLM ships root
  `ARCHITECTURE.md` **plus** per-module ones (`litellm/proxy/policy_engine/architecture.md`,
  `litellm/proxy/hooks/mcp_semantic_filter/ARCHITECTURE.md`,
  `litellm/integrations/websearch_interception/ARCHITECTURE.md`) and 6+ `AGENTS.md`. goose ships
  `documentation/docs/goose-architecture/{goose-architecture,extensions-design,error-handling}.md`.
- **LibreChat carries an architecture-review *method* as a Claude skill**
  (`.claude/skills/improve-codebase-architecture/SKILL.md`, `disable-model-invocation: true`):
  *(1)* **Scope before you scan — YAGNI**: *"walk back a good stretch of the commit history
  (`git log --oneline`) to find the codebase's hot spots … and let those paths pull your attention
  first."* *(2)* Fixed Ousterhout vocabulary — **module · interface · depth · seam · adapter ·
  leverage · locality** — with *"the deletion test"* (*"would deleting it concentrate complexity, or
  just move it?"*) and *"one adapter = hypothetical seam, two = real"*; enforced: *"Use these terms
  exactly … don't drift into 'component,' 'service,' 'API,' or 'boundary.'"* *(3)* Output = a card
  per candidate — **Files · Problem · Solution · Benefits · Before/After diagram · Recommendation
  strength** (`Strong` / `Worth exploring` / `Speculative`) — ending in one **Top recommendation**.
  *(4)* ADR handling: *"if a candidate contradicts an existing ADR, only surface it when the friction
  is real enough to warrant revisiting the ADR"*; on rejection, *"Want me to record this as an ADR so
  future architecture reviews don't re-suggest it?"*, offered only when a future explorer would need
  the reason — an exact match to ctrl-b's `parked-items-never-reproposed` memory / ROADMAP §P.
  ⚠ The skill references `CONTEXT.md` and `docs/adr/`, **neither of which exists in LibreChat** — a
  vendored generic skill, so its *process* is field evidence but its *adoption* is **UNVERIFIED**.

---

## 5. Synthesis — the leanest credible shape for ctrl-b *(my reading, not evidence)*

1. **Run TARA, per subsystem, not once over the whole app.** ~A day each, with step 1's output —
   credible quality requirements *invented by the assessor because none are written down* — treated
   as a first-class deliverable. ctrl-b has never stated what "fast enough" or "reliable enough"
   means for the fleet monitor, the agent loop or the scheduler; every perf argument goes in circles
   until it does.
2. **Make the review packet a fixed five-part form.** Per subsystem: *(a)* invented quality
   requirements + **confidence H/M/L** that the code meets each (TARA §4) · *(b)* a **non-risk
   register** — the "it's fine because…" assumptions written as falsifiable statements (ATAM §7.1) ·
   *(c)* **sensitivity points** ("use caution when changing this") · *(d)* an **FMEA-lite table whose
   load-bearing column is *detection*** · *(e)* one **pre-mortem paragraph**. Nothing else. Findings
   keep the existing `SYS-#`-style id + concern grouping, which already matches TARA §5.
3. **Adopt one severity ladder everywhere:** **Strong / Worth exploring / Speculative** (LibreChat's
   skill). Three rungs, judgement-shaped, no fake RPN arithmetic. Carry *confidence* as a separate
   axis so "I'm sure this is a problem" is never conflated with "this matters a lot".
4. **Measure first, judge second — make measuring free before making it rigorous.** Two instruments
   cost one env var each and should run *before* any harness exists: `PYTHONASYNCIODEBUG=1` on the
   dev unit (100 ms slow-callback log) and `py-spy top`/`dump` on the prod PID. Then
   `EXPLAIN QUERY PLAN` on every hot query. Only if those three find nothing is a harness justified.
5. **Gate only what is deterministic; record everything else.** Gate bundle/blob size, asset count,
   the existing arch-invariant and stylelint rules. Record — never gate — wall-clock latency,
   Lighthouse scores, React render durations. Where a timing assertion is wanted, use goose's
   posture: a **catastrophe ceiling at ~10× the observed value**, which catches hangs and cannot
   flake. Do **not** buy CodSpeed — its cheap mode is instruction-count simulation and its own docs
   say that mode struggles with I/O, which is what ctrl-b's hot paths are.
6. **When a number must be compared, copy LibreChat's protocol verbatim** — alternating
   base/HEAD/HEAD/base blocks, cold sample excluded and reported separately, block medians *and*
   pooled median, no outlier removal from a valid block, host load captured, nothing else running.
   On emma that also means stopping the other dev unit and the second agent first. It is the
   difference between a measurement and a vibe, and it costs only discipline.
7. **Emit one structured record per measurement from day one.** opencode's `BENCHMARK {json}` line
   is the whole mechanism: assert only that collection *completed*, let the numbers accumulate as
   data. Stamp the git sha (both aider's leaderboard row and LibreChat's `E2E_LATENCY_GIT_SHA` do).
8. **Fill the frontend gap where it actually is: CPU, not bytes.** The tailnet makes Russell's byte
   budgets slack; the binding constraint is main-thread work on a mid-range Android under Gecko —
   long tasks, RAF gaps, layout/paint — exactly what opencode's suite measures and what §14.11's
   gotchas already hint at. Profile from a **production build** (React's Profiler is off in prod
   builds by default; the dev build over-reports), on the owner's real phone, over Tailscale HTTPS.
9. **Close the *locality* gap on decision docs; don't restructure them.** The field's 2026 practice
   is architecture guidance next to the code (`AGENTS.md`/`ARCHITECTURE.md` per package; 0/9 ADR
   dirs). `DECISIONS.md` is better than what peers have — but a subsystem review is the moment to
   leave a short pointer beside the subsystem naming its D-entries, non-risks and sensitivity points,
   so the review has somewhere to *land*.
10. **Declare the non-goals in writing** — scalability, multi-tenancy, SLOs, error budgets, on-call,
    load testing. Gruntwork's framing is right: the checklist exists so omissions are *"conscious
    decisions to neglect particular components … as opposed to accidentally omitting them from
    consideration."* A pass that doesn't record what it refuses to care about gets re-litigated.

---

## 6. What I could not determine

- **Whether Codex CLI's criterion bench runs in CI** — `codex-rs/utils/image/benches/prompt_images.rs`
  exists; I did not read `rust-ci-full.yml` for a `cargo bench` invocation. Same for whether
  LibreChat's `MarkdownBlocks.bench.tsx` is wired to any npm script.
- **The full O'Reilly fitness-function taxonomy from the primary text** — `oreilly.com` 403s. The
  atomic/holistic and triggered/continual definitions here are **REPORTED**; the remaining categories
  (static/dynamic, automated/manual, temporal, intentional/emergent, domain-specific) are named in
  secondary sources but unquoted and unverified.
- **LAAAM** (Lightweight Architecture Alternative Assessment Method) — cited in secondary sources as
  an ATAM-lite; no primary description found, and I stopped chasing it because TARA covers the same
  need with a verified primary source. A deliberate stop, not an oversight.
- **Parnas & Weiss (1987) full text** and **Fowler's chapter-level checklists** — both **REPORTED**
  from abstracts/publisher copy. If either becomes load-bearing, buy the primary first.
- **Which of ctrl-b's own SQLite queries full-scan, and whether any handler blocks the event loop.**
  Cheap to answer with the §3.1 tools; out of scope for a methodology pass — these are the first two
  tasks of the pass this dossier enables.
- **Whether any peer runs a production-readiness review at all.** No PRR-shaped artifact in 9/9
  repos, but absence from a public repo is weak evidence — such a review lives in a private wiki.
  Read "0/9" as "not public", not "not done".
- **Real cost of a Lighthouse CI run on emma.** Lighthouse's hardware guidance implies scores would
  be noise on a box running two agents + prod + dev units; I did not measure it.

---

## 7. Sources

**Methods:** Kazman/Klein/Clements, *ATAM: Method for Architecture Evaluation*, CMU/SEI-2000-TR-004
(sei.cmu.edu/documents/629/2000_005_001_13706.pdf — **read via `pdftotext`**) · Woods, *Industrial
Architectural Assessment using TARA*, WICSA 2011
(eoinwoods.info/media/writing/WICSA2011-Industrial-Architectural-Assessment-Using-TARA.pdf — **read
in full**) · *SRE Book* ch.32 (sre.google/sre-book/evolving-sre-engagement-model/) · *SRE Workbook*,
"Implementing SLOs" (sre.google/workbook/implementing-slos/) · Klein, "Performing a Project
Premortem", HBR 2007 (**REPORTED**) · Parnas & Weiss, "Active design reviews", JSS 7(4) 1987
(**REPORTED**) · Ford/Parsons/Kua, *Building Evolutionary Architectures* ch.2 (**REPORTED** — 403) ·
Thoughtworks, "Fitness function-driven development".

**Tooling (primary, all fetched):** docs.python.org/3/library/asyncio-dev.html ·
github.com/benfred/py-spy · sqlite.org/pragma.html#pragma_optimize ·
pytest-benchmark.readthedocs.io/en/latest/faq.html · codspeed.io/docs/instruments ·
react.dev/reference/react/Profiler · web.dev/articles/vitals ·
github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md ·
github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md ·
infrequently.org/2025/11/performance-inequality-gap-2026/ · Gruntwork, *Production Readiness
Checklist for AWS* (framing only — AWS-specific, off-class).

**Peer repos (GitHub API, default branch, 2026-08-16):** `open-webui/open-webui` ·
`danny-avila/LibreChat` · `sst/opencode` · `openai/codex` · `Mintplex-Labs/anything-llm` ·
`block/goose` · `Aider-AI/aider` · `continuedev/continue` · `BerriAI/litellm`.
Files read verbatim: `sst/opencode:packages/app/e2e/performance/README.md` ·
`danny-avila/LibreChat:e2e/benchmarks/README.md` ·
`danny-avila/LibreChat:.claude/skills/improve-codebase-architecture/SKILL.md` ·
`BerriAI/litellm:.github/workflows/{codspeed,weekly_load_anomaly}.yml` ·
`openai/codex:.github/workflows/blob-size-policy.yml` ·
`block/goose:{ui/desktop/tests/e2e/performance.spec.ts,.github/workflows/ci.yml}` ·
`open-webui/open-webui:.github/workflows/frontend.yaml`.

**Local probes (emma, 2026-08-16):** `anyio` default thread limiter `total_tokens = 40`
(`anyio/_backends/_asyncio.py:3038` + runtime probe) · `backend/app/db.py:284-286` pragmas ·
`frontend/vite.config.ts:4,19,71` visualizer wiring · `frontend/stylelint.config.mjs` warn-first
posture · `frontend/package.json` scripts (no perf/bench/lighthouse script exists).

**Correction to a plausible premise:** goose's `quarantine.yml` is **not** a flaky-test quarantine —
it closes PRs from a list of quarantined GitHub users (`vars.QUARANTINED_USERS`). Spam control, not
reliability engineering. (**VERIFIED** by reading the file.)
