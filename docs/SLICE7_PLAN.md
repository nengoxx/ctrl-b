# SLICE7_PLAN — the D43 (model routing & retry visibility) design draft, v2

> **STATUS: REVIEW-RESOLVED, AWAITING THE OWNER LOCK.** Pipeline provenance: 2 code-truth
> passes (inference/failover/wire · session/AgentDef/state) + 1 field pass (×8 systems,
> sourced) + a 2-lens adversarial design review (correctness: 4H/6M/2L · design-fit: 3H/7M/2L
> — ALL resolved into this v2; the un-enumerated option both lenses converged on is now the
> recommendation). Author: Fable 5, 2026-07-19. Scope = ACA A4 (routing, REDUCED — see §5) +
> A6 (typed retry/failover events) + A7 (retryable classifier). The A7 thinking-block
> transforms stay unbuilt (code-verified unnecessary).

# D43 (v2 — lock-ready) — Slice 7: model routing & retry visibility

## 1. Decision summary

**(A7)** A retryable-error **classifier** at the D18 pre-authorized seam adds ONE new tier —
visible same-endpoint retry with a fixed backoff curve for genuinely-transient errors
(429/503/Retry-After) — in front of today's any-error→next-hop walk (tuned, not reversed;
applied to the CHAT stream only — the summarizer/`complete()` and voice paths keep straight
next-hop, ruled: compaction has its own fallback semantics and both paths are latency-bound).
**(A6)** Typed **`inference.retry`/`inference.failover` wire events** emitted LIVE from inside
the chain — the slice's one structural change: `failover()` becomes an **async generator**
(hop events out, the winning result last; a thin `failover_collect()` drains it for buffered
callers so voice/embeddings/`complete()` reduce byte-for-byte to today). A snapshot-carried
`retry_status` kills the dead-spinner-on-reattach hole during a backoff. **(A4, REDUCED)**
Per-agent **failure-fallback routing**: when the worker model hard-fails
`failure_threshold` consecutive turns, the next `fallback_turns` turns escalate to a configured
**lead ModelRef**, with a visible note each way. The v1 draft's `lead_turns` (lead-opens-thread)
is **DROPPED** — both review lenses converged: it is a coding-agent pattern (planning-heavy
first turns) transplanted without its workload; the homelab value is the fallback half, which
D18 structurally cannot provide (D18 rescues failed *requests*; this rescues a worker that
*completes* turns badly at the infra level — errors/stalls — turn after turn). No
content-sniffing (the Goose regret), no mid-stream failover, SDK retries stay 0, and nothing is
ever silent (the Gemini footgun): every retry, failover, and route change is a typed event + a
sys-note.

## 2. Config & knobs (schema deltas)

- **`RoutingCfg`** (domain/agent.py, the CompactionCfg placement precedent): `lead: ModelRef`
  (required) · `failure_threshold: int = Field(default=2, ge=1)` (consecutive hard worker
  failures that open a fallback episode) · `fallback_turns: int = Field(default=2, ge=1)`
  (episode length). NO `lead_turns`. Defaults = the Goose-shipped values for the two surviving
  knobs (2/2, source-verified).
- **`AgentDef.routing: RoutingCfg | None = None`** — `None` = no routing (default).
  **The global default is `agent.defaults.routing`** — the D16 precedent (a separate
  `Settings.agent.routing` would be the anti-pattern D16 rejected; `agent.defaults` IS the
  global base via deep-merge). Deliberate divergence from compaction's dual-home, cited.
  **Subagents: `routing` is copied by `model_copy` but INERT** — subagent sessions get no
  RoutingState and always run their configured model; documented, not sold as inheritance.
- **`InferenceEndpointCfg.retry_attempts: int = Field(default=0, ge=0)`** — the ONE retry knob
  (review: the D42 "one knob, one unit" bar; the curve is fixed module constants — base 2s,
  ×2ⁿ, cap 30s, a larger `Retry-After` wins — documented, not configurable). **Default 0 = no
  behavior change** (the `max_concurrent_requests=None` rider precedent; the v1 default-2 is
  withdrawn). Owner-config note: set `retry_attempts: 2` on the CLOUD endpoint post-deploy
  (cloud 429s are the main beneficiary; the local app-side gate already absorbs most
  local-busy).
- The agent's `model` stays the worker. `routing.lead` is a full ModelRef; **the routed
  ModelRef threads EVERYWHERE** (§5 — the v1 "two RHS" undercount is fixed).

## 3. The classifier + retry tier (A7)

- **`categorize(err)`** in adapters/inference.py beside `is_context_overflow`, structured
  `code`/`status` first, message-substring fallback: `transient` (429 · 503 · Retry-After
  present · the llama.cpp busy/slot-full shapes, verified at build — the pi #6364 local-backend
  lesson) · `overflow` (delegates to `is_context_overflow`; consumer unchanged) ·
  `fatal_for_endpoint` (401/403 · 404 model-not-found · quota/billing markers) · `other`.
- **`InferenceError` gains `retry_after: float | None`**, parsed from the raw SDK exception's
  response headers (both delta-seconds and HTTP-date) INSIDE `attempt` before conversion —
  review F7: post-conversion the header is gone, so capture happens pre-flattening (the same
  rationale as D42's code/status capture).
- **Policy (the pi split — classify vs what-next):** `transient` → retry the SAME endpoint up
  to its `retry_attempts` (backoff curve above), then next-hop · `fatal_for_endpoint` → next-hop
  immediately, never retried-same (a different hop has different credentials/models — the
  cross-provider walk stays correct) · `other`/`overflow` → next-hop immediately (today's D18
  behavior verbatim). Nothing aborts the chain early.
- **Retry mechanics (review F8):** retries exist only at stream INITIATION (nothing streamed).
  The failed attempt has already released its endpoint permit (the existing except-release);
  the backoff sleep holds NOTHING — the retry re-enters `attempt`, which re-acquires. A cancel
  landing during the sleep propagates normally; between-attempts cleanup is a no-op by
  construction (no stream object exists yet) — stated as a build invariant.
- SDK `max_retries=0` stands (visible-retries-only generalizes the existing never-silently-
  re-fired rationale; pi's quota-burn guidance concurs).

## 4. Typed wire events + the failover generator (A6) — the structural change

- **`failover()` becomes an async generator** (core/failover.py, still value-agnostic): yields
  `HopRetry(index, attempt, max_attempts, delay_s)` / `HopFailover(from_index, to_index)`
  control items as they happen, then the terminal `FailoverResult` as the final item (async
  generators cannot `return` a value — the last-item contract is documented + typed). A thin
  **`failover_collect()`** helper drains events and returns the result — voice, embeddings, and
  inference `complete()` switch to it and reduce byte-for-byte to today (Invariant 6; the
  review's F1 contradiction is resolved by committing to this ONE shape — no duplicated chain
  walk, no callback side-channel). The policy param rides the generator; default = always
  next-hop, no retry items ever yielded.
- **`stream_chat` re-yields** the control items as typed dataclasses (`RetryNotice`,
  `FailoverNotice` — names/endpoint labels attached from the chain entries) interleaved BEFORE
  the first `ChatDelta`. **Both consumers** — the main loop AND `_finalize` (review F9: it is
  two sites, not one) — add an isinstance branch ABOVE the delta checks that emits and
  `continue`s, never touching `streamed_any`/text buffers (the D42 backstop's nothing-streamed
  flag stays honest).
- **Session events:** `inference.retry {endpoint, attempt, max, delaySeconds, category}` ·
  `inference.failover {from, to, category}` · routing notes (§5). The post-hoc degraded notice
  block (session.py ~1088) is **DELETED** — superseded by the live typed event (no
  double-narration). **Invariant 5 is stated precisely:** with `retry_attempts=0` +
  `routing=None`, behavior is identical to today EXCEPT degraded-serve narration moves from a
  post-stream notice to a live typed event (+ sys-note) — the only sanctioned delta.
- **Durability (review M4 — the dead-spinner hole):** events are live-only (D39 notice stance),
  BUT the turn snapshot gains a lightweight **`retry_status: {endpoint, attempt, max,
  until_ts} | None`** field (set by the session around a backoff, cleared on the next attempt/
  first delta) so a re-attach DURING a backoff renders "// retrying cloud (attempt 2/2)…"
  instead of a dead spinner — snapshot-carried state, not event-log durability; the
  TurnAccumulator stays notice-free. `collect_turn` folds the events into `notices` text
  (buffered parity, the D40 pattern).
- **FE:** two new cases in the chat.ts event switch (ship with the events — unknown kinds drop
  silently), rendered in the sys-note voice: `// retrying local in 2s (attempt 1/2 —
  rate-limited)` · `// failover → cloud (local unavailable)`; the `turn.sync` path renders
  `retry_status` when present.

## 5. The routing machine (A4, reduced to failure-fallback)

- **Resolution:** top of `_drive`, once per turn. The router returns **one routed `ModelRef`**
  (the lead during a fallback episode, else `agent.model`), and ALL FOUR derived locals read
  from it — `eff_mode`, `eff_model`, `eff_reasoning`, `reserve` (review F4/H2: the v1 "two RHS"
  silently left reasoning/max_tokens/compaction-reserve on the worker). `_finalize` gains the
  routed ModelRef's call-config via its params (fixing the noted `self._agent.model` re-read
  asymmetry); `_over_threshold_now` (the manual `/compact` path) keeps reading `agent.model` —
  it never enters a routed turn (sync-holder; benign, noted).
- **Precedence:** the per-message `/local`//`/cloud` prefix STILL WINS and bypasses the router
  (the 4c lock). Stated plainly (review L1): the prefix selects the ENDPOINT; a prefixed turn
  runs the WORKER ModelRef on that endpoint — the owner's hand chooses infrastructure, not
  persona. (The pre-existing explicit-model-id-on-wrong-endpoint 404 class is unchanged.)
- **`RoutingState`** (per-thread, `app.state.routing_state`, the CompactionState template:
  dataclass + `routing_state_for` + prune-when-default + injected at `_build_session`):
  `consecutive_failures: int = 0` · `fallback_remaining: int = 0` · `current_route:
  Literal["lead","worker"] | None = None` (the LOGICAL-turn route lock, see resume) ·
  `turn_had_model_failure: bool = False` (the per-turn flag the session writes; consumed +
  cleared at turn end). With `lead_turns` gone the state RETURNS to all-defaults on healthy
  threads, so prune-when-default genuinely works (review F11 resolved by the reduction).
- **The decision:** prefix → obey, router untouched. Else on a FRESH turn (`resume_assistant is
  None` — review F5): if `fallback_remaining > 0` → lead (decrement, note on the first turn of
  the episode); else worker. Record `current_route`. **A resume reads `current_route` instead
  of re-deciding** (review H3: the resolved route is carried across the suspend boundary the
  same way ACA-16 carries `mode` — no mid-logical-turn model flip, no double-decrement;
  restart loses it → a post-restart resume re-resolves, recorded residual in the
  steer-queue/compaction-state class). Cleared at the turn's end.
- **Failure counting — session-side, structural, hard-failures only** (review F2/F3: `_cleanup`
  never sees routed/degraded, and `capped` is nearly dead — counting moves INTO `_drive` where
  every signal lives): on a worker-routed turn, count a failure when (a) the chain-level
  `InferenceError` ends the turn AND the serve was not degraded-rescued AND not a
  chain-exhausted total outage (review F12 — all-endpoints-down is an infra event, not worker
  quality; it would escalate to an equally-dead lead), or (b) the turn reaches `_finalize` via
  ITERATION EXHAUSTION or the STALL GUARD (the true weak-worker signal — flowed as an explicit
  flag at the two known sites, never inferred from terminal strings). `completed` without
  either → reset to 0. `suspended`/`cancelled` → no count either way. At `failure_threshold` →
  `fallback_remaining = fallback_turns` + ONE notice (`// lead model for the next N turns
  (worker failing)`; the episode's end notes `// back to the worker model`). Honest scope
  statement (review L2): this catches HARD failures only — a worker that completes with
  useless answers is out of scope by design (content-sniffing rejected).
- **The D18 circuit breaker (review M3, reframed):** D18's deferred ~60s dead-ENDPOINT skip is
  an availability breaker at request/endpoint granularity — a DIFFERENT axis from this
  quality-ish escalation at turn/model granularity. It stays deferred as its own concern; the
  D-entry guards only against duplicating the SAME axis, not against the orthogonal one.
- **UI: none v1.** Per-agent routing is settled YAML-only by the D42 `Omit<"compaction">`
  precedent (the `Omit` gains `"routing"`); the genuinely open UI question is the GLOBAL row —
  see Open Question 3.

## 6. Invariants

1. A route decision is taken at most once per LOGICAL turn (suspend/resume included — the
   `current_route` carry) and never changes mid-turn.
2. The per-message mode prefix always beats the router and never mutates routing state.
3. No same-endpoint retry after the first streamed token; no mid-stream failover; the backoff
   sleep holds no permit and no stream.
4. Every retry, failover, and route change is wire-visible (typed event + sys-note), and a
   re-attach during a backoff sees `retry_status` — no silent switches, no dead spinners.
5. `retry_attempts: 0` + `routing: None` ⇒ identical behavior to today, except degraded-serve
   narration moves from the post-hoc notice to the live typed event (the one sanctioned delta;
   the old notice block is deleted, never double-emitted).
6. `failover()` remains value-agnostic; voice/embeddings/`complete()` via `failover_collect()`
   are behaviorally unchanged (no retry tier, no events).
7. A degraded-rescued turn and a chain-exhausted outage never increment the routing failure
   counter; control items never touch `streamed_any` or the text buffers.

## 7. Verification plan

Classifier matrix (429/503/Retry-After/llama.cpp-busy → transient · 401/404/quota → fatal ·
5xx/timeout → other; `retry_after` parsed from headers, both forms) · retry tier (per-endpoint
budget honored; curve + Retry-After-wins + cap; `retry_attempts=0` = today; next-hop after
budget; the permit is FREE during a backoff — a second request proceeds; cancel during backoff
cleans up with nothing open) · the failover generator (voice/embeddings/`complete()` via
`failover_collect()` behaviorally unchanged — the D18 pins re-run verbatim; event order:
retries → failover → result) · wire events (fake flaky provider: attempt/max/delay payloads;
FE cases render; buffered `collect_turn` parity; a control item before the first delta leaves
`streamed_any` false — the D42 backstop still fires after retries exhaust into an overflow) ·
`retry_status` (snapshot carries it mid-backoff; a `turn.sync` re-attach renders it; cleared on
first delta) · routing (consecutive hard failures open an episode of exactly `fallback_turns`;
degraded and total-outage turns don't count; completed resets; suspend inside an episode:
resume stays on `current_route`, no double-decrement — the H3 pin; exhaustion/stall-finalize
counts, plain completed doesn't; prefix bypasses and doesn't touch state; prune at
all-defaults; the routed lead's max_tokens/reasoning ride BOTH the main loop and `_finalize` —
the H2 pin; the compaction reserve prices the ROUTED ref's max_tokens) · live (the M7 items):
a real busy llama.cpp slot reaches the retry tier (not just cloud 429); cloud-lead/local-worker
on the dev units — force worker failures, watch the episode open/close; cache telemetry shows
no mid-turn churn.

## 8. Out of scope (recorded)

Content-based quality detection (Goose's regret) · `lead_turns`/lead-opens-thread (dropped v1→v2;
the seam — RoutingCfg is extensible — makes it a purely additive field later if real usage asks
for it) · mid-stream failover (D18) · SDK retries (stay 0) · retry tier on summarizer/voice
paths (ruled: straight next-hop) · the D18 endpoint-availability circuit breaker (distinct
axis, stays deferred) · A7 thinking transforms (do not build) · subagent routing at runtime
(field copied, inert, documented) · per-agent routing UI (YAML per the Omit precedent).

## 9. Open questions for the owner (lock blockers)

1. **A4 scope — the recommendation changed after review.** Recommended: **failure-fallback
   only** as specced in §5 (both review lenses independently converged: `lead_turns` is a
   transplanted coding-agent pattern; the fallback half is the real homelab value D18 can't
   provide, and the reduction dissolves three correctness edge cases outright). Alternative:
   park A4 entirely and ship A6+A7 alone — the seams (RoutingCfg/RoutingState homes) are cheap
   to add later, so parking costs little; but the reduced machine is now small (~a
   CompactionState-sized dataclass + one decision point + one counter site) and serves the
   weak-local-worker setup you actually run.
2. **`retry_attempts` default 0** (no behavior change; the rider precedent) with the deploy
   note recommending `2` on the cloud endpoint — OK, or do you want it on by default?
3. **Routing UI:** v1 ships YAML-only (`agent.defaults.routing` is the global, per D16). If you
   want a UI surface, the honest one is a GLOBAL routing row in the AgentsEditor
   global-settings area (where global compaction went) — lead mode/model + the two numbers.
   Proposal: skip for v1, add if routing survives real use.
