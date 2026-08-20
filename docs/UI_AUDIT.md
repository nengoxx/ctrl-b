# UI audit — frontend architecture, performance, and a usability-safe implementation plan

**Originally written:** 2026-06-01 (perf pass). **Extended:** 2026-06-02 (follow-up audit — section 6c, F14–F26).
**Scope:** `dashboard_v2/frontend/` (React 19, Vite 7, TanStack Query, Vapor port).

The original sections (1–6b) cover the performance + best-practices pass that ran as Slices 1–8 — all shipped (HEAD `e944ec7` at the time of audit). Section **6c (Follow-up audit)** is a second pass that focused on **accessibility, resilience, and edge-case correctness** — the layer the perf pass deliberately deferred. **STATUS UPDATE (2026-06-08 a11y backlog session): F14–F26 are now SHIPPED** (Slices A–F2 — F14·F15·F16·F17·F18·F19·F20·F22·F23·F25·F26·F28·F29 all landed; F21 mic-stub folded into Phase 6). **F24 (component/axe/Playwright a11y tests) SHIPPED 2026-07-02** (`frontend/e2e/a11y.spec.ts` — axe WCAG A/AA per tab, on top of the D21 vitest *logic* foundation). F27 shipped 2026-06-24. **Still deferred:** only F9/F13 (perf), until measured. The per-finding sections below retain their original analysis; treat the status line on each as authoritative.

> **Owner constraint (driving every decision below):** "I like how it flows. I like how it works." Performance and best-practices wins must not regress perceived responsiveness, freshness of fleet state, or interaction smoothness. Anything that *could* feel slower goes through an explicit "preserve behavior" mitigation before shipping.

---

## 1. State of the project

The frontend is a **single-bundle React 19 SPA** ported from `vapor.html`. ~3.4k lines of TS/TSX across 31 files; 4 top-level tabs (Fleet / Agent / Utils / Conf); a typed-action loop and SSE event stream talking to FastAPI on `/api`. Bundle today: **340 KB JS + 60 KB CSS + 185 KB PNG = 583 KB** (single chunk). Build is clean.

The architecture is sound. The issues below are refinements, not rewrites.

## 2. Architectural overview

```
src/
├── App.tsx                  shell · 100dvh + visualViewport sizing · all tabs mounted
├── api/client.ts            fetch wrappers (getJSON/postJSON/putJSON/del)
├── store/                   dependency-free external stores (useSyncExternalStore)
│   ├── ui.ts                  theme/tab/skyline/loz/heroOn/waveformOn/ttsAuto · localStorage
│   ├── chat.ts                streaming chat reducer (SSE → messages by id)
│   ├── toast.ts · confirm.ts · collapse.ts
├── hooks/                   TanStack Query wrappers + mutations
├── tabs/                    Fleet / Agent / Utils / Conf
├── components/              Hero, Composer, DeviceRow, AppBar, TabBar, editors…
├── theme/                   vapor.css (1028 lines) + extras.css (1208 lines) + heroScene.ts
└── lib/                     hand-rolled markdown · composer helpers
```

**Three orthogonal state systems:**

| State kind | Where | Tool |
|---|---|---|
| **Server state** | `hooks/useXxx.ts` | TanStack Query + SSE invalidation |
| **UI state** | `store/ui.ts` and friends | `useSyncExternalStore` + localStorage + body data-attrs |
| **Streaming chat state** | `store/chat.ts` | A reducer fed by SSE; messages appended/patched by id |

**Live updates** travel through one `EventSource("/api/events/stream")` opened in `App.tsx`; every persisted event triggers `invalidateQueries` for `hosts`/`services`/`events`. Every open client converges.

**Layout shell** is one of the strongest parts of the codebase: it sets `--app-h` from `window.visualViewport.height` (not `100dvh`) so the in-flow composer rides above the Android keyboard; publishes `--appbar-h` via a `ResizeObserver` so sub-headers clear it.

## 3. Where it's already done well (don't break these)

1. Tri-state separation (server / UI / streaming) on the right tools.
2. `useSyncExternalStore` for UI state — no Redux/Zustand, no provider tree, smaller bundle.
3. SSE event-stream + `invalidateQueries` instead of polling everywhere.
4. Single origin, no CORS, no auth — works through Tailscale Serve cleanly.
5. CSS is the design (lifted from `vapor.html`); body-attr theming; no runtime style cost.
6. Animations are transform/opacity + `will-change`; Waveform is a ref-fed RAF loop.
7. Stable keys on every iteration (host id, service id, message id).
8. PWA wiring honest (`autoUpdate`, `/api` denylisted from service-worker caching).

## 4. Findings — each one paired with a usability-safety verdict

Severity legend: **🔴** user-visible · **🟡** perf/cleanup · **🟢** future-proofing.
Safety verdict: **✅ SAFE** (no behavior change) · **⚠️ NEEDS MITIGATION** (safe only if implemented with the listed guardrails) · **🛑 RISKY** (defer or scope tightly).

---

### F1 🔴 — All four tabs are always mounted; every tab's queries run continuously

**The issue.** `App.tsx` mounts Fleet/Agent/Utils/Conf simultaneously. Polling, SSE subscriptions, and TanStack queries from every tab run whether or not that tab is visible. Wasted CPU, wasted network, wasted phone battery.

**Owner worry:** "Pausing inactive tabs will make switching to them feel sluggish."

**Safety verdict: ⚠️ NEEDS MITIGATION** — and the mitigation is **scoping**, not the naive "pause everything".

**Mitigation plan:**
- **Always keep running, regardless of active tab:**
  - The SSE `EventSource` (it's the convergence backbone for all clients).
  - **`useHosts`** + **`useServices`** — the fleet leds/dots are expected to reflect reality even when you're on the Agent tab; switching back to Fleet should never show stale state. The polling cost is one HTTP per `poll_seconds`, trivial.
  - The chat streaming reducer (`store/chat.ts`) — a tool turn must keep running while you're inspecting other tabs.
- **Pause when their owning tab is inactive:**
  - Conf-only queries: `useSettings`, `useAgents`, `useSkills`, `useIntegrationsStatus` — none of these change unless *you* edit them in Conf, and the SSE invalidation already covers external edits.
  - Any future heavy queries (memory listings, prompt files…).
- **Cache on resume guarantees freshness:** when switching to a paused tab, set `refetchOnMount: 'always'` on its queries so the moment that tab becomes visible it kicks one refetch. Combined with TanStack's `staleTime`, the cached UI paints instantly and a fresh fetch lands within the normal poll cadence — **no perceived sluggishness, just no idle work**.
- **Acceptance test:** open the Network panel, sit on Fleet for 30s — confirm only `/api/hosts`, `/api/services`, `/api/events/stream` traffic. Switch to Conf — settings/agents/skills fetch once, then idle until edit. Switch back to Fleet — instant; no flicker, no spinner, no stale data.

**Result:** fewer background requests, identical perceived snappiness on tab switch, fleet state never feels behind.

---

### F2 🔴 — `Hero` re-renders on every fleet poll

**The issue.** `hosts` ref changes every poll (because `checked_at` ticks), so `<Hero>` re-renders. `<Sky>` is already memoized (just shipped). `<Waveform>` and `<FleetSummary>` and the `<NowStats>` subtree still reconcile each time.

**Safety verdict: ⚠️ NEEDS MITIGATION** (revised after live testing).

**Mitigation plan (and what shipped):**
- **`FleetSummary`** wrapped in `memo` — primitive props, safe.
- **`NowPanel`** extracted from Hero, memoized on primitive props (subnet/name/role/online/ping/mac/ssh) — safe.
- **`Waveform` must NOT be memoized.** The original audit was wrong here: it didn't account for the `stateRef.current = { online, ping }` mutation in the component body. The RAF draw loop reads from that ref every frame; when `memo` bails (two hosts on a LAN often share a ping value like 1ms), the ref stops syncing and the waveform freezes on the previous host's snapshot. **Lesson: a `React.memo` wrapper around a component that mutates a ref from its props during render is always wrong** — the ref pattern relies on the function body running on every parent re-render. The outer `NowPanel` memo is the barrier that saves work; Waveform's render itself is trivial (canvas + two legend divs).

This is documented in `Waveform.tsx` with a leading comment so the mistake isn't repeated.

---

### F3 🟡 — Per-render allocations in `DeviceRow` / `FleetSummary`

`EQ_ON.slice(0, 5)` allocates fresh array each render; `FleetSummary` re-filters/reduces on every render. Negligible at 4 hosts, measurable at 30+.

**Safety verdict: ✅ SAFE.** Pure refactor — extract constants, wrap derived values in `useMemo` keyed on `hosts`. Output identical.

---

### F4 🟡 — `useUI()` re-renders every consumer on any UI change · ✅ SHIPPED (Slice 7)

**The issue.** The hook returns the whole `UIState` object; `useSyncExternalStore` bails only on `===`. Every `setUI` triggers a re-render of every consumer. (Original audit estimated "25 consumer files" — actual count is **5**: App, TabBar, AppBar, FleetTab, ConfTab. The 25 was a count of `useUI` *imports* in the codebase grep, but only 5 of those are hook calls. Recorded here so the next planner isn't mis-anchored.)

**What shipped (Slice 7):**
- New `useUISlice<T>(selector)` in `store/ui.ts`. Generalizes the existing `useTabActive` (which also moved over to call `useUISlice` for consistency). Selector returns one slice; re-render fires only when that slice changes via `Object.is`.
- All 5 consumers migrated. ConfTab uses 5 separate slice calls (one per Appearance field) instead of a single composite — each subscription is independent, so toggling one field doesn't wake consumers of the others.
- `useUI()` kept and marked `@deprecated` in JSDoc; left as an escape hatch for a future debug/console panel that legitimately needs the whole state. IDE tooling flags accidental new usage.

**Contract for selectors (locked in JSDoc on `useUISlice`):**
- **Selectors must return a primitive or a stable reference.** A selector that builds a fresh object/array per call (`s => ({ a: s.a, b: s.b })`) creates a new reference each tick and triggers an infinite re-render loop. For multi-field reads, use multiple `useUISlice` calls — each subscription is independent.
- **Selectors run on every store notification.** Keep them cheap (field reads or primitive comparisons). Expensive derivations belong behind `useMemo` in the consuming component.
- If a future case genuinely needs an object/composite selector, add `useUISliceWith(selector, equalityFn)` modelled on Zustand's `useStoreWithEqualityFn`. Out of scope today.

**Verified:** typecheck clean; bundle size delta < 100 bytes; visual behavior identical across all themes and toggles; profiler shows AppBar re-renders only on `ttsAuto`, App/TabBar only on `tab`, FleetTab on `heroOn`/`waveformOn`, ConfTab on Appearance fields.

---

### F5 🟡 — `transition: all` / unprefixed `transition:` in vapor.css

**The issue.** `.dev`, `.confrow .chev`, `.tabbtn`, knob transitions all use `transition: all` or bare `transition: <duration>`, which animates every changed property — including paint-expensive ones like `box-shadow`. The `.dev` instance was causing the sun-stutter; the rest are smaller but cumulative.

**Owner worry:** "I don't want toggles to feel snappy/abrupt where they used to feel smooth."

**Safety verdict: ⚠️ NEEDS MITIGATION** — go surgical.

**Mitigation plan:**
- Enumerate each `transition: all` / bare transition site in a checklist before changing anything.
- For each site, ask: **what property change is the visible animation?** Keep that one explicitly. Drop the rest.
  - `.dev` — visible: border-color (subtle); was: + box-shadow (the perf hit). Keep border-color only. ✅ (already done.)
  - `.tabbtn color: 0.25s` — visible: color crossfade. Already explicit; leave alone.
  - `.confrow .chev transition: transform 0.2s` — visible: chev rotation. Already explicit; leave alone.
  - `.switch .knob transition: 0.2s` — visible: knob translateX + background. Make explicit: `transition: transform 0.2s, background 0.2s`. Identical visible behavior.
- Visual diff side-by-side at 390px before merging — every interactive control should look identical to today.

---

### F6 🔴 — No code splitting; everything ships in one chunk

**The issue.** 340 KB JS to a user who lands on Fleet contains the Conf editors (1500+ LOC), the Markdown renderer, the agent message renderer. First load and first PWA install are heavier than they need to be.

**Owner worry:** "When I click a tab the first time, will it pause to load?"

**Safety verdict: 🛑 RISKY at face value · ⚠️ NEEDS MITIGATION when scoped.**

**Mitigation plan:**
- **Don't lazy-load Fleet or Agent.** Fleet is the landing tab; Agent is the most-used. Both must remain in the initial bundle so day-to-day interactions are zero-Suspense.
- **Lazy-load only Conf** (and optionally Utils once it grows). Conf is heavy, edit-rarely, and you go there knowingly.
- **Prefetch on idle.** After first paint, `requestIdleCallback(() => import('./tabs/ConfTab'))` warms the chunk before you click. The first tap is instant unless the browser is genuinely under load.
- **Prefetch on hover/tap-start** of the Conf tab button as a backup signal (mousedown/touchstart triggers the import).
- **Suspense fallback** is a clean placeholder that matches the Vapor section header (`<div className="tab"><div className="sec">// loading…</div></div>`) — never a blank flash.
- Measure: first-paint TBT and tab-switch latency before & after. Hard guarantee: tab-switch latency to Conf is ≤ current behavior **once warmed** (and warming happens on idle within ~1s of page load).

---

### F7 🟡 — `lucide-react` not audited · ✅ SHIPPED (Slice 8 — dependency removed)

**Finding from `dist/stats.html`:** the bundle is dominated by React (`react-dom-client.production.js` alone is **65%** of total raw bytes — ~95 KB gz). Subtotal for React DOM + scheduler + React + tiny react-dom shim: ~104 KB gz / 70% of the bundle. TanStack Query is ~14 KB gz (7%). Our own code is ~25 KB gz (14%). Everything else is sub-1%.

**`lucide-react` is not in the bundle.** Grep confirmed zero imports across `src/` and zero occurrences in the built JS — it was tree-shaken at build time. The dependency was dead code in `package.json`.

**Action shipped:** removed `lucide-react` from `package.json` via `npm uninstall lucide-react`. Bundle hashes pre/post are identical (`index-CyaGVU_6.js`, `ConfTab-CqaCO4kP.js`) — confirming zero runtime impact. The win is purely dev-time: smaller `node_modules`, smaller `package-lock.json`, faster `npm install` on fresh checkouts, one less dep to track for security advisories.

**No other action warranted.** The only meaningful bundle-reduction lever left would be migrating to Preact compat (~50 KB gz savings), which is high-risk for a React 19 app using `useSyncExternalStore` + `Suspense`/`React.lazy`/concurrent features. Not worth it for a single-user tailnet PWA where the SW precaches the bundle after first install. The 95 KB gz React cost is the accepted floor.

**Lesson recorded:** any future "is this dep heavy?" question is one `npm run build` away from `dist/stats.html` — the analyzer wired in Slice 1 is the source of truth.

---

### F8 🟡 — `App.tsx` re-renders on every UI state change because it reads four UI fields

**The issue.** App subscribes to `theme, tab, skyline, loz` via `useUI()`; any of those changes re-renders the shell and (because of F1) every mounted tab. The actual visual update happens via body data-attrs, so the React re-render is wasted work.

**Owner worry:** does theme switch / tab switch still feel instant?

**Safety verdict: ✅ SAFE** (and actually **slightly faster**).

**Mitigation plan:**
- Move the body-attr writes from `App.tsx`'s `useEffect` into `setUI()` itself (synchronous: write to `state` then write to `document.body.dataset` then `emit()`).
- On module load, the store's initializer runs once → applies current attrs to body. Same effect as today's mount-time effect.
- App.tsx stops subscribing to `theme/skyline/loz`; it still subscribes to `tab` (because it conditionally renders Composer for fleet/agent and passes `active` to each tab).
- **Theme switch becomes synchronous instead of waiting for a React commit** — visibly the same or marginally faster, never slower.

---

### F9 🟢 — No `useTransition` / `useDeferredValue` anywhere

**The issue.** React 19's concurrent primitives are designed for exactly the cases we'll hit at scale (long Conf forms, long chat transcripts).

**Owner worry:** "I don't want streaming chat tokens to feel laggier."

**Safety verdict: 🛑 RISKY if applied to chat streaming · ✅ SAFE elsewhere.**

**Mitigation plan:**
- **DO NOT** wrap chat-streaming state updates in `startTransition`. The arriving tokens *are* the urgent update; deferring them makes the chat feel laggy.
- **DO** consider `useTransition` for Conf "Save" → re-validate → reconfigure round-trips (the user expects a brief "saving" state anyway; non-urgent).
- **DO** consider `useDeferredValue` on the chat message *list* when status is `"streaming"`, only after we cross ~200 messages — keeps token-by-token visible while the off-screen list virtualizes its catch-up.
- Defer the actual implementation until we observe a real bottleneck (today, the app is fast enough that adding these would be premature). **Mark F9 as "defer until measured."**

**MEASUREMENT TRIGGER (added 2026-07-20 — so "until measured" isn't indefinite).** "Defer until measured" with no trigger is just "never", and the same deferral now has a second owner: `AGENT_CHAT_AUDIT.md` **ACA-14** found the matching backend-side shape — `appendDelta` rebuilds the message array per token and `useAgentChat`'s `useMemo` is keyed on `messages`, so `pairResults` re-pairs **per token**; cost is O(messages) per token and is only contained by the `Bubbles` memo. ACA-14 is filed INFO/"watch, don't fix yet" and names **F13's wave as its owning item** — i.e. neither doc will act first without a trigger. So: **measure when EITHER fires —**
1. **a single thread passes ~200 messages** (the threshold this entry already names for `useDeferredValue`, and roughly where the per-token re-pair stops being free), **or**
2. **the owner reports input lag / a sluggish composer while a turn is streaming** (the subjective symptom that actually matters on the phone, which is the real target device).

**When one fires, measure before implementing** — a React Profiler trace on a long thread mid-stream, so we learn whether the cost is the re-pair, the array rebuild, or render, and fix *that*.

**MEASURED 2026-08-20 (owner-requested first data point — trigger 1's threshold exercised synthetically):** a throwaway instance (temp `CTRLB_HOME`/`CTRLB_DB`, current build) seeded with a **220-message thread** (all bubbles fully rendered — no virtualization), driven headless-Chromium at 420px with the Event Timing + Long Tasks APIs while typing ~15–25s into the composer, idle vs during a REAL streaming turn (qwen3.6-max on corsair over LAN — high token rate, the client-side worst case). Results: **un-throttled** idle p95 24ms/keystroke, streaming p95 16ms, zero long tasks; **4× CPU-throttled (phone-class)** idle p95 48ms · max 80ms, streaming p95 24ms · max 40ms, still **zero long tasks**. Streaming adds nothing measurable on top of idle typing. **Verdict: at the ~200-message threshold the trigger's *substance* (input lag) does not materialize — the F9/F13 deferral stands on data now, not just policy.** Residual caveat: emma headless ≠ the phone (Fennec especially); the owner's subjective on-device feel stays the live trigger, and a Profiler pass remains the next step if it ever fires. (Scripts: the session scratchpad `f13/` rig — temp-instance seed via the app's own repos + the CDP throttle harness — cheap to recreate.) Note compaction (D42) cuts the *model's* context, not the client's message list — a long thread stays long on screen, so trigger 1 does not self-resolve. F9's own safety rule still binds: **never** wrap streaming-token updates in `startTransition`; `useDeferredValue` on the message *list* is the sanctioned lever.

---

### F10 🟢 — `resultByCall` / `latestPlanCall` rebuilt linearly on every AgentTab render

**The issue.** `AgentTab.tsx` lines 393–403 iterate every message on every render to pair tool calls with their results. At 50 messages this is free; at 500 it's measurable.

**Safety verdict: ✅ SAFE.** `useMemo` keyed on `messages`. Identical output, run only when messages change.

---

### F11 🟢 — 185 KB PNG logo / single PWA icon

**The issue.** One large raster icon ships with the bundle; the PWA manifest only declares one size.

**Owner worry:** "Don't change how the logo looks — I like it."

**Safety verdict: ✅ SAFE** (we're not changing what's drawn, only what's served).

**Mitigation plan:**
- Keep the existing PNG as-is for in-app use (don't switch to SVG unless source is available and re-renders identically).
- Add resized icons (192, 256, 512, maskable variant) to `dist/` and reference them in the manifest. Install screens look sharp at every density.
- Optionally compress the source PNG (pngquant / oxipng) — visible bytes saving, lossless or visually-lossless.

---

### F12 🟢 — No bundle analyzer in the build

**Safety verdict: ✅ SAFE.** Dev-only tool, zero runtime impact.

**Plan:** add `rollup-plugin-visualizer` to `vite.config.ts` behind a `build --analyze` flag (or generate to `dist/stats.html` on every `build`). Tells us where F6/F7 savings will actually land.

---

### F13 🟢 — React Compiler off

**The issue.** React 19 ships an opt-in compiler that auto-memoizes everything. Could remove most of the manual `memo()` calls we add via F2 and F10.

**Owner worry:** auto-memoization in a compiler is a moving target; may not be worth the risk.

**Safety verdict: 🛑 DEFER.**

**Plan:** revisit only after F1–F12 are landed and stable. The compiler is most useful when there's a *lot* of code to memo; with explicit memos in place this is a quality-of-life feature, not a perf necessity.

---

## 5. Risk-stratified summary

| ID | Finding | Sev | Safety | Effort | Status |
|---|---|---|---|---|---|
| F1 | Pause inactive-tab queries (scoped) | 🔴 | ⚠️ MITIGATED | S | ✅ Slice 5 |
| F2 | Memoize Waveform / FleetSummary / NowStats | 🔴 | ✅ SAFE | S | ✅ Slice 2 (Waveform stays unmemoized — see F2 note) |
| F3 | Hoist constants / useMemo derived calcs | 🟡 | ✅ SAFE | XS | ✅ Slice 1 |
| F4 | `useUISlice` selector pattern | 🟡 | ⚠️ MITIGATED | M | ✅ Slice 7 |
| F5 | Audit `transition:` declarations | 🟡 | ⚠️ MITIGATED | S | ✅ Slice 3 |
| F6 | Lazy-load Conf only, prefetch on idle | 🔴 | ⚠️ MITIGATED | S | ✅ Slice 6 (+ follow-up fix for true lazy mount) |
| F7 | `lucide-react` tree-shake audit | 🟡 | ✅ SAFE | XS | ✅ Slice 8 (dead dep removed; bundle was already React-dominated) |
| F8 | Body-attr mirroring into `setUI()` | 🟡 | ✅ SAFE | S | ✅ Slice 4 |
| F9 | `useTransition` / `useDeferredValue` | 🟢 | 🛑 DEFER | — | ⏸️ defer until measured — **trigger set 2026-07-20:** a thread >~200 messages **or** owner-reported input lag while streaming (see F9) |
| F10 | Memoize `resultByCall` in AgentTab | 🟢 | ✅ SAFE | XS | ✅ Slice 1 |
| F11 | PWA icon fan-out + PNG compression | 🟢 | ✅ SAFE | XS | ✅ Slice 1 |
| F12 | Bundle analyzer in build | 🟢 | ✅ SAFE | XS | ✅ Slice 1 |
| F13 | React Compiler trial | 🟢 | 🛑 DEFER | — | ⏸️ defer until F1–F12 stable (they are) — now gated on the **same F9 trigger**; also carries the deferred eslint warns (the Compiler-prep backlog, SYS-16 — count lives in QUALITY.md's warning accounting, growing with each phase; same latest-ref class) and owns ACA-14 |
| F14 | Interactive divs missing keyboard/role | 🔴 | ⚠️ MITIGATED | S | 🆕 follow-up audit 2026-06-02 |
| F15 | `prefers-reduced-motion` not respected | 🔴 | ✅ SAFE | S | 🆕 follow-up audit 2026-06-02 |
| F16 | SSE no error handler / no reconnect UI | 🟡 | ⚠️ MITIGATED | S | 🆕 follow-up audit 2026-06-02 |
| F17 | ConfirmDialog: no focus trap / restoration | 🟡 | ⚠️ MITIGATED | S | 🆕 follow-up audit 2026-06-02 |
| F18 | TabBar missing ARIA tablist + arrow keys | 🟡 | ⚠️ MITIGATED | S | 🆕 follow-up audit 2026-06-02 |
| F19 | No `beforeunload` for unsaved Conf changes | 🟡 | ✅ SAFE | XS | 🆕 follow-up audit 2026-06-02 |
| F20 | Chat fetch-SSE has no reconnect on drop | 🟡 | ⚠️ MITIGATED | M | 🆕 follow-up audit 2026-06-02 |
| F21 | Mic button is a visual stub | 🟢 | ✅ DONE (folded into Phase 6 — real mic shipped) | XS | 🆕 follow-up audit 2026-06-02 |
| F22 | Decorative glyphs missing `aria-hidden` | 🟢 | ✅ SAFE | XS | 🆕 follow-up audit 2026-06-02 |
| F23 | No root `ErrorBoundary` outside ConfTab | 🟡 | ✅ SAFE | XS | 🆕 follow-up audit 2026-06-02 |
| F24 | No automated UI / a11y tests | 🟢 | 🟢 SHIPPED | M | 🆕 2026-06-02 · logic foundation 2026-06-22 (D21, Vitest); **axe/Playwright e2e shipped 2026-07-02** (`frontend/e2e/a11y.spec.ts` + render/flows) |
| F25 | `all: unset` wipes focus indicators on ~30 buttons | 🔴 | ⚠️ MITIGATED | S | 🆕 follow-up audit 2026-06-02 |
| F26 | SW `autoUpdate` has no in-app reload prompt | 🟢 | ✅ SAFE | XS | 🆕 follow-up audit 2026-06-02 |

## 6. Phased implementation plan

Each phase is one slice, independently verifiable, and reversible. Verification per slice:
- Type-check passes (`npm run typecheck`).
- Hot-reloaded preview at 390px on every theme (dark / aqua / ember).
- Side-by-side compare with previous behavior — UI flow must feel identical or better.
- For perf-targeted changes: 30s recorded session in Chrome perf panel before & after — flame chart should be quieter, no new long tasks.

### Slice 1 — Quick wins (no behavior risk) ⚡ XS

Together these are ~30 min of work, zero usability risk, measurable cleanup:

- **F12** Bundle analyzer wired into `vite.config.ts` (so we can measure F6/F7).
- **F11** PWA icon fan-out + PNG compression.
- **F3** Hoist `EQ_ON.slice(0,5)` to a constant; memoize FleetSummary derived values.
- **F10** Memoize `resultByCall` / `latestPlanCall` in AgentTab.

Acceptance: app behaves identically; bundle stats.html exists; install icons sharp on PWA.

### Slice 2 — Memo pass on the Hero ⚡ S · F2

`React.memo` on `Waveform`, `FleetSummary`, extract `NowStats` from Hero and memo it.

Acceptance: every Hero render at idle (between polls) does NOT reconcile the memoized children. Sun keeps floating smoothly. Live ping data still updates the waveform; led counts still update on host wake/shutdown.

### Slice 3 — Transition audit ⚡ S · F5

Enumerate each `transition:` in `vapor.css` + `extras.css`, replace `all` and bare `transition: <duration>` with explicit property lists. PR description includes the full list of what was changed and what stayed the same.

Acceptance: side-by-side video at 390px, all three themes — every interactive control looks identical to the recording from before.

### Slice 4 — UI store: body-attr mirroring into `setUI` ⚡ S · F8

Move `document.body.dataset` writes into `setUI()`; remove the corresponding `useEffect` from `App.tsx`. Initialize body attrs once at module load.

Acceptance: theme/tab/skyline/loz still apply correctly on first load, refresh, and after any toggle. App.tsx no longer subscribes to `theme/skyline/loz`.

### Slice 5 — Pause inactive Conf queries 🎯 S · F1

Add `enabled` prop pattern (or a `tabActive` context) so `useSettings`, `useAgents`, `useSkills`, `useIntegrationsStatus` only poll when Conf is the active tab. Apply `refetchOnMount: 'always'` so re-entering Conf force-refreshes.

**Do NOT touch:** `useHosts`, `useServices`, the SSE stream, the chat reducer.

Acceptance: Network panel shows ONLY hosts/services/events traffic while on Fleet/Agent for 30s. Switching to Conf triggers one settings/agents/skills/integrations fetch then idles. Switching back to Fleet shows current state instantly, no flicker.

### Slice 6 — Lazy-load Conf 🎯 S · F6

`React.lazy(() => import('./tabs/ConfTab'))` + `<Suspense fallback={<ConfShellPlaceholder/>}>`. Idle-prefetch via `requestIdleCallback`. Hover/touch-start prefetch on the Conf tab button.

**Important — design pitfall hit on first ship and fixed in a follow-up:** rendering `<ConfTabLazy>` unconditionally in the JSX tree causes React.lazy to invoke its loader on App mount, fetching the chunk immediately and making the prefetch step a no-op. Also: a Suspense fallback baked with `className="tab active"` will visually overlay whatever tab is actually active during the chunk download. Both fixed by **conditional mount** — render `<ConfTabLazy>` only after the user activates Conf at least once (then keep it mounted to preserve form drafts). With conditional mount, `prefetchOnIdle` becomes meaningful again because the import is no longer triggered on mount, and the Suspense fallback is only ever rendered when Conf is the active tab. **Rule for any future lazy tab: never put the lazy component into the tree before the user has signaled intent to view it.**

Acceptance: initial JS bundle drops ≥ 10% (achieved: 324 → 282 KB raw, 96 → 87 KB gz). Conf tab opens instantly after warm-up (verify via 3G throttling in dev tools). No visible Suspense flash under normal use. Lazy chunk fetch starts on idle (or hover/touch), **not** on App mount — verify in DevTools Network panel.

Also shipped in the follow-up: a small reusable `ErrorBoundary` (`components/ErrorBoundary.tsx`) wrapping the Suspense, with a Vapor-styled "Reload page" fallback. Covers the most common real-world failure (stale chunk URL after a deploy → 404 on click), which React.lazy can't recover from because it caches rejections — only a page reload picks up the new manifest. Boundary is reusable for any future lazy tab.

### Slice 7 — `useUISlice` selectors 🎯 M · F4

Add `useUISlice(selector)` alongside `useUI()`. Migrate **`App.tsx` and components that read a single field** first (TabBar, AppBar, FleetTab's heroOn/waveformOn). Leave components reading multiple fields on `useUI()` for now.

Acceptance: theme switch, tab switch, hero toggle all behave identically. Profiler shows fewer re-renders per UI change.

### Slice 8 — Measure & decide on F7, F9, F13

Look at the bundle analyzer output post-Slice 6 to see if `lucide-react` deserves explicit work (F7). Re-measure long-thread chat perf with a synthetic load to see if F9 is worth picking up. F13 (React Compiler) stays deferred until 7e and beyond settle.

---

## 6c. Follow-up audit — 2026-06-02 (F14–F26)

After the F1–F13 pass landed (Slices 1–8 shipped), a second pass focused on **accessibility, resilience, and edge-case correctness** — areas the original audit deliberately deferred while we got perf and structure right. The findings below were the new backlog. None were critical for single-user-on-tailnet operation; several were real WCAG 2.2 AA failures that matter for any phone/voice-input flow (Phase 6) and for usability in low-vision / motion-sensitive contexts. **STATUS: this backlog was implemented in the 2026-06-08 a11y session (Slices A–F2) — F14–F26 shipped; F27 shipped 2026-06-24. F24's component/axe layer shipped 2026-07-02 (`frontend/e2e/a11y.spec.ts`). The original "documented for prioritization" framing below is historical.**

Same severity legend as section 4: **🔴** user-visible · **🟡** perf/cleanup · **🟢** future-proofing. Safety verdicts use the same scale.

---

### F14 🔴 — Interactive `<div>`s lack keyboard + role

**The issue.** Two main interaction sites use `<div onClick>` instead of `<button>`:
- `DeviceRow.tsx` lines 55–60: `<div className="top" onClick={onToggle}>` — the row-expansion target. Tab key skips it entirely; screen readers don't announce it as interactive.
- `Hero.tsx` (NowPanel inner): the `.now-dots div` carousel dots — `<div onClick={() => onFeature(i)}>`. Same problem.

**Why it slipped.** Both ports trace from `vapor.html`'s prototype markup, which used divs. The pixel-fidelity mandate (D7) preserved the DOM shape without revisiting interactivity.

**Safety verdict: ⚠️ NEEDS MITIGATION** (the migration to `<button>` may shift box-model defaults — must verify with `all: unset` + the existing styles).

**Fix:** convert to `<button type="button">` and add `aria-expanded={open}` on the device row. Add `role="tab"` / `aria-selected` on the now-dots (they're a carousel selector). Pair with F25 to ensure focus indicators are visible on the new buttons.

---

### F15 🔴 — `prefers-reduced-motion` not respected

**The issue.** `vapor.css` declares **37** animation/keyframe/transition rules — sun float, grid scroll, sky shimmer, equalizer bars, heartbeat LED, send-button "brewing", TTS glow, tab-indicator slide, dot bounce, twinkling stars, retrowave grid motion, etc. None are gated on the user's reduced-motion preference. Zero occurrences of `prefers-reduced-motion` in either CSS file.

**Why it matters (per MDN/Josh Comeau/Tatiana Mac).** Motion can trigger vestibular disorders, migraine, nausea. The OS setting is well-supported (iOS, Android, macOS, Windows) and zero-cost to honor.

**Safety verdict: ✅ SAFE** — gating animations with the media query never *adds* motion; users without the preference are unaffected.

**Fix sketch:** one block at the top of `vapor.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
Or, more nuanced: keep functional transitions (button presses, disclosure rotations) but drop ambient motion (sun float, grid scroll, twinkle). Pairs naturally with the **motion tokens** in section 6b.

---

### F16 🟡 — SSE has no error handler / no reconnect signal

**The issue.** `hooks/useEvents.ts` opens an `EventSource` and listens only for `'event'`. No `'error'` handler. Comment claims "the browser's EventSource auto-reconnects on drop" — true, but with no max-retries, no backoff visibility, no Last-Event-ID resume, and **no UI signal that the connection is broken**. During a reconnection gap, events emitted server-side are missed entirely (the next refresh of `hosts`/`services` polls catches up, but agent-action events that didn't trigger a poll are lost).

**Real-world failure mode.** Phone leaves wifi → wakes back → SSE reconnects but the user sees a stale UI for the gap window. No "connection lost" indicator. On Tailscale flakes this happens routinely.

**Safety verdict: ⚠️ NEEDS MITIGATION** — adding error handling can incorrectly mark transient drops as fatal. Use the [HTML spec EventSource reconnection semantics](https://html.spec.whatwg.org/multipage/server-sent-events.html) + the [reconnecting-eventsource pattern](https://github.com/fanout/reconnecting-eventsource).

**Fix sketch.** Add an `error` listener that reads `es.readyState`: if `CLOSED` (server permanently rejected), give up; if `CONNECTING`, just show a small "reconnecting…" badge in the appbar. Optionally adopt the `reconnecting-eventsource` polyfill for exponential backoff + jitter. On reconnect, force-invalidate `hosts`/`services`/`events` so missed events are reconciled.

---

### F17 🟡 — `ConfirmDialog` missing focus trap + focus restoration

**The issue.** `ConfirmDialog.tsx`:
- Tab from the Confirm button moves focus **out of the dialog** — onto whatever element is next in DOM order. Keyboard-only users can lose the modal.
- `keydown` listener is on `window`, so Enter typed inside an unrelated textarea elsewhere on the page could trigger Confirm. (Not currently reachable while a modal is open because pointer events go to the backdrop, but typing focus is unaffected.)
- On close, focus doesn't return to the trigger element (e.g., the action button that opened the dialog).
- No `aria-labelledby` / `aria-describedby` linking the h3 + p to the dialog. Screen readers don't read the title on focus.

**Safety verdict: ⚠️ NEEDS MITIGATION** — switching to the native `<dialog>` element (per WCAG 2.2 + UXPin's 2026 modal guide) handles all three for free, but the styling needs porting from `.modal-backdrop` / `.modal` rules.

**Fix sketch.** Either (a) add `inert` to the rest of the app while the dialog is open + a focus-trap util, or (b) migrate to `<dialog>` opened with `.showModal()` — native focus trap, native Escape, native `::backdrop` styling.

---

### F18 🟡 — TabBar lacks ARIA tablist semantics + arrow-key nav

**The issue.** `TabBar.tsx` renders a `<nav>` with 4 `<button>`s. WCAG / WAI-ARIA "tabs" pattern expects `role="tablist"` with `role="tab"` children, `aria-selected`, `aria-controls` (pointing at the panel), and `←` / `→` arrow-key navigation between tabs (not just Tab → button → Tab → button). Screen readers announce a "tablist" with positional info ("Tab 2 of 4, selected") only when the role is present.

**Safety verdict: ⚠️ NEEDS MITIGATION** — adding `role="tab"` changes screen-reader announcements; verify no other code relies on `<button>` semantics.

**Fix sketch.** Add `role="tablist"` to the nav, `role="tab"` + `aria-selected={tab === t.id}` + `aria-controls={"tab-" + t.id}` to each button. Add an `onKeyDown` that maps `ArrowLeft`/`ArrowRight` to the prev/next tab. Each `.tab` panel needs `role="tabpanel"` + matching `id`.

---

### F19 🟡 — No `beforeunload` warning for unsaved Conf changes

**The issue.** `ConfTab.tsx` tracks `dirty` state (`JSON.stringify(draft) !== JSON.stringify(pickDraft(settings))`). The save button is gated on it. But a refresh / close / tab-switch-out of the browser silently discards the edit. No `beforeunload` listener.

**Owner risk.** Editing a multi-section Conf form and accidentally hitting refresh → minutes of work gone.

**Safety verdict: ✅ SAFE** — `beforeunload` only fires when something is genuinely dirty, and modern browsers limit it to a generic prompt anyway.

**Fix sketch.** In `App.tsx` (or a small hook): when ANY dirty store says it's dirty, register a `beforeunload` listener that calls `e.preventDefault()`. Aggregate dirty flags from Conf, Agents editor, Skills editor.

---

### F20 🟡 — Chat fetch-SSE has no reconnect on drop

**The issue.** `store/chat.ts:_streamTurn` (around line 270) uses `fetch` + a `ReadableStream` to parse the agent's SSE — *not* `EventSource`. This means **no auto-reconnect**. If the connection drops mid-stream (wifi flake, server restart, tailnet pause), the stream just ends. The catch surfaces an error toast and resets `status: "idle"`, but the user has to manually resend or, worse, the assistant's half-written reply is left orphan.

**Why fetch-SSE?** Because the agent endpoint is `POST /api/agent/chat` with a body — `EventSource` only does GET. The choice is forced.

**Safety verdict: ⚠️ NEEDS MITIGATION** — naive auto-resume would re-execute the agent turn (side effects). Need a server-side resume token.

**Fix sketch.** Phase A: detect mid-stream failure, show a "stream interrupted — resume" affordance (a button on the broken assistant bubble that calls the existing `/api/agent/resume` endpoint with the streaming message id). Phase B: pair with a server-side `Last-Event-Id` so reconnects continue from where they left off. The infrastructure is already there for confirm-gated suspends; extending it for network drops is similar.

---

### F21 🟢 — Mic button is a visual stub but looks fully functional · 🟦 DEFERRED TO PHASE 6

**The issue.** `Composer.tsx`'s mic button toggles a local `rec` state; the `.rec` class drives a pulsing animation. There's no STT wiring (correct — Phase 6 isn't done). But to a user, the button **looks** like dictation works: it's right next to the textarea, has a "toggle dictation" tooltip, animates when pressed.

**Safety verdict: ✅ SAFE** to clarify; trivial change.

**Resolution (2026-06-08).** Originally planned as Slice E2 (honest disable: `disabled` + `aria-disabled` + tooltip + drop the local `rec` state). Owner reframed it as a Phase 6 concern — the full mic lifecycle (capability probe, permission state, disabled visual, active recording state, transcript handoff) is one coherent piece that Phase 6 owns end-to-end; shipping an "honest disable" intermediate would be undone the moment the recorder lands. Deferred. The TODO.md Phase 6 section now carries the explicit checkbox + the design notes for the state machine.

---

### F22 🟢 — Decorative glyphs without `aria-hidden`

**The issue.** Several UTF glyphs are used decoratively in text content:
- `<span className="chev">›</span>` in DeviceRow / ConfTab / SkillsEditor / etc.
- `<span className="arrow">↗</span>` and `↗ http://…` link text in DeviceRow service rows.
- `<span className="arrow">—</span>` for offline service.

Screen readers announce these literally ("greater-than sign", "north east arrow", "em dash"). Decorative-only glyphs should have `aria-hidden="true"`.

**Safety verdict: ✅ SAFE** — `aria-hidden` only hides from AT, never visually.

**Fix sketch.** Add `aria-hidden="true"` to every `.chev`, `.arrow`, the chev character in `confrow .chev` rules, and the disclosure markers in `cmd-detail > summary .chev`.

---

### F23 🟡 — No root `ErrorBoundary` outside the Conf lazy chunk

**The issue.** Slice 6 introduced `components/ErrorBoundary.tsx` and wraps it around `<Suspense>` for ConfTabLazy only. If a render error happens in Fleet, Agent, Utils, AppBar, Composer, or any other always-mounted component, **React unmounts the entire root**, showing a blank page.

**Real-world trigger.** A bad chat-stream response that violates a type assumption; a malformed YAML in `config.yaml` that propagates to `useSettings`; a tiny prop type bug introduced in a future commit.

**Safety verdict: ✅ SAFE** — wrapping `<App>` in `<ErrorBoundary>` is a pure addition with no behavior change in the happy path.

**Fix sketch.** Wrap the `<App>` root in `main.tsx` with the existing `ErrorBoundary`, providing a Vapor-styled global fallback (looks like a tab section header reading "// the app hit a snag — reload to continue" + a Reload button). The Slice 6 boundary stays where it is for chunk-load specificity.

---

### F24 ✅ SHIPPED — automated UI / a11y tests

**The issue.** Zero test coverage on the frontend. No Vitest, no Playwright, no Storybook visual tests, no axe-core a11y CI. `TODO.md` Phase 9 mentions "Minimal smoke tests (Playwright desktop + Android viewport; a couple of backend action tests)" but that work is still queued.

**Safety verdict: ✅ SAFE** to add — testing is purely additive.

**Status. ✅ SHIPPED 2026-07-02.** `frontend/e2e/` now runs the real built app through Playwright — `render.spec.ts` (4-tab no-crash), `flows.spec.ts` (critical flows), and `a11y.spec.ts` (**axe-core WCAG A/AA** per tab) at mobile 390px + desktop, wired as the pre-deploy gate (`python tools/check.py --e2e`). It immediately caught + drove a real `aria-toggle-field-name` fix (the unlabelled `Switch`). The original backlog framing above is historical. (The WCAG findings F14/F15/F17/F18/F22/F25 now have the regression gate this section asked for.)

---

### F25 🔴 — `all: unset` wipes focus indicators on ~30 buttons

**The issue.** `all: unset` appears **~30 times** in `vapor.css` + `extras.css`, always on `<button>` styling. It strips the browser's default focus outline. Only a handful of inputs/textareas have replacement `:focus { border-color, box-shadow }` styles. The **buttons don't**: TabBar tabs, action buttons (wake/shutdown/reboot), the send button, the mic button, segmented controls in Conf, dropdown chevrons, etc., have no visible focus indicator at all. `composer textarea:focus { outline: 0 }` explicitly removes it too (mitigated by the parent's `.composer .field:focus-within` border treatment, which is OK).

**WCAG impact.** This is a **WCAG 2.4.7 Focus Visible (Level AA)** failure — keyboard users literally cannot see what they have focus on while tabbing through the UI. Combined with F14 (interactive divs not in the tab order at all), the app is functionally unusable from a keyboard today.

**Safety verdict: ⚠️ NEEDS MITIGATION** — adding `:focus-visible` outlines may clash visually with the Vapor design unless tuned. The magenta glow already used for input focus is the natural choice.

**Fix sketch.** A single global rule:
```css
:focus-visible {
  outline: 2px solid var(--magenta);
  outline-offset: 2px;
  border-radius: 4px;
}
```
Then sprinkle component-specific overrides where the global outline doesn't fit (round buttons want the outline rounded with `outline-offset` set to inset). Use `:focus-visible` rather than `:focus` so mouse-clicks don't show the ring (keyboard-only by default).

---

### F26 🟢 — Service worker `autoUpdate` has no in-app reload prompt

> **STATUS UPDATE (2026-08-11, v1.6.0):** the mode is now the plugin-default **`prompt`**. The original
> fix rode `registerType: "autoUpdate"`, whose register client skipWaits + force-reloads and **never
> fires `onNeedRefresh`** — the toast was dead code (unexercised: SYS-19 meant no worker had ever
> registered in prod). The analysis below is the historical record; `SwUpdatePrompt.tsx` carries the
> as-shipped flow.

**The issue.** `vite-plugin-pwa` is configured with `registerType: "autoUpdate"`. On a new deploy:
1. The next visit downloads the new SW + manifest in the background.
2. The SW takes over on the *next* reload.
3. The user is never notified that an update is available.

**Real-world failure mode.** The user has the old `index.html` loaded. We push a new build. The lazy chunk hash changes. They click Conf → 404. The Slice-6 `ErrorBoundary` catches the failure and offers "Reload page" — so we recover, but the user shouldn't have hit the error in the first place.

**Safety verdict: ✅ SAFE** to add a non-blocking toast.

**Fix sketch.** Subscribe to `vite-plugin-pwa`'s `useRegisterSW` (or the manual `navigator.serviceWorker.controllerchange` event) and `pushToast("// new version available — refresh to load", "info")` with a click-to-reload action. Standard PWA pattern.

---

### F29 🟡 — Collapsing a Conf group discards in-progress sub-editor state · ✅ SHIPPED (option B)

**The issue.** `ConfGroup` in `tabs/ConfTab.tsx` was conditionally rendering its children (`{!collapsed && props.children}`). So expanding **Agents** → typing into a draft → collapsing the group → re-expanding it gave a fresh `AgentsEditor` mount with the persisted-server state, dropping whatever was in the working draft. Same shape for **Skills**, **Integrations**, **Computers**.

**Why it mattered.** Same family as [F28](#f28----composer-textarea-loses-draft-on-tab-switch-and-reload--shipped) but one layer deeper. The Slice-E1 beforeunload guard catches refresh/close-tab while a group is *expanded*; this finding was about the *intra-session* loss when the user collapses the group mid-edit.

**Safety verdict: ✅ SAFE.** Two implementation paths weighed: (a) lift each sub-editor's draft into a store (same trick as F28's `store/composer.ts`), or (b) keep children mounted and use CSS to hide collapsed bodies. Shipped **(b)** because it's a one-line JSX change + one CSS rule, matches the project's existing "keep mounted, toggle visibility" pattern from the four top-level tabs (Fleet/Agent/Utils stay mounted; CSS shows only `.tab.active`), and dirty-registration via `useRegisterDirty` (E1) keeps working across the collapse cycle without effort. Memory cost is negligible for a single-user homelab.

**The fix (shipped 2026-06-08).** `ConfGroup` now always renders `props.children`; `extras.css` gains `.confgroup.collapsed > *:not(.conftitle) { display: none; }` to hide the body when collapsed. No new stores, no new effects, no editor changes.

**Option A as a future enhancement** — lifting each long-form editor's draft into its own store (mirrors `store/composer.ts`) would also enable **reload-survival** for in-progress edits in Agents / Skills / Integrations / Computers. Not needed to fix the collapse problem, but a natural follow-up. Tracked in §6b below.

---

### F28 🔴 — Composer textarea loses draft on tab-switch and reload · ✅ SHIPPED

**The issue.** `App.tsx` conditionally renders the composer (`{showComposer && <Composer />}`); switching to Conf/Utils unmounts it entirely. `Composer.tsx` held the textarea value in the **uncontrolled** DOM ref (`taRef.current.value`), so on unmount the value was destroyed — switching back gave the user an empty textarea. A full page reload had the same effect (no persistence layer).

**Why it slipped the original audit.** The audit pass focused on a11y / resilience / a few perf concerns. State-persistence on a single uncontrolled input wasn't explicitly probed; the owner hit it organically while testing the Slice D2 work.

**Safety verdict: ✅ SAFE** — controlled textarea + a localStorage-backed store is the same shape as `store/ui.ts`. Adding the store is purely additive; rewiring the textarea to controlled is a one-line semantic change. No mobile risk (controlled inputs behave the same as uncontrolled for English typing; IME edge cases are theoretical and don't apply to this homelab single-owner context).

**The fix (shipped between D2 and E1).** New `src/store/composer.ts` modelled on `store/ui.ts`: single `draft: string` slot, `useSyncExternalStore` subscription, persisted to `localStorage` under `"ctrlb.composer"`, swallowed quota error for private-mode browsers. `Composer.tsx` reads via `useDraft()`, writes via `setDraft()`, and calls `clearDraft()` after `runComposer()`. An `useEffect([draft])` re-runs the auto-size logic so a draft loaded from storage gets the correct height on first mount.

---

### F27 🟢 — Offline service rows have no screen-reader-perceivable offline indicator · ✅ SHIPPED 2026-06-24

**Resolution.** `DeviceRow.tsx`'s offline `.svc-row.off` div gained `aria-label={`${s.name} ${addr} —
offline`}` — one line, no CSS, no visual change. The online row already announces as a link; this gives
the offline row the equivalent auditory cue. (Minimal fix per the owner — low-priority, single-user.)

**The issue (historical).** In `DeviceRow.tsx`, an offline service renders as `<div className="svc-row off"><span className="led"/><div className="info">…</div><span className="arrow" aria-hidden>—</span></div>`. The `.off` class is purely visual (faded color, no LED glow); the `—` arrow is the only "offline" glyph and Slice C2 (F22) correctly marked it `aria-hidden` as a decorative character. Net effect: a screen-reader user hears `"ssh, name, host:port"` for both online and offline rows, with no auditory cue which is which.

**Why it's low priority.** Single-user homelab; the owner is sighted and uses Android in a normal context. Filed for the day the dashboard gets shared, or if voice/STT pivots ever require AT to make sense of service state.

**Safety verdict: ✅ SAFE** — pure addition of accessible text; no visual change.

**Fix sketch.** On the `.svc-row.off` div, add `aria-label={"${s.name} — offline"}` (or a visually-hidden `<span className="sr-only">offline</span>` if we want CSS-level styling). The online row is already an `<a>` so it'll announce as a link; this just gives the offline row equivalent semantic clarity.

---

## 6b. Noted for later (not part of any current slice)

- **`Switch` → native `<button role="switch">` (a11y/semantics polish).** The shared `Switch` is a
  `<div role="switch" tabindex=0>` with a hand-rolled Enter/Space handler — the div-with-role
  anti-pattern MDN warns against. The **accessible-name gap is already fixed** (Phase-9: a required
  `label` prop → `aria-label`, axe-green). The remaining improvement is converting the `<div>` to a
  native `<button role="switch">` (free focus/keyboard, drops the manual keydown). Deferred for the
  **visual-regression risk**: `.switch` in `vapor.css` + `.kit .switch` in `kit.css` set no
  background/border/padding, so a `<button>` needs `appearance:none; background:none; border:0;
  padding:0; font:inherit` resets in both, plus `type="button"` — a small but real risk to eyeball at
  390px + re-run the render/theme e2e. Do it when touching the toggle styling anyway.

- **HMR-safe store modules (dev ergonomics, not a prod issue).** Our `store/*.ts` modules
  hold module-scope state (`let state = …; const listeners = new Set<…>()`) — the
  `useSyncExternalStore` pattern from React docs. In production this is rock-solid; every
  full page load instantiates each module exactly once. **In Vite's dev server**, however,
  editing a store triggers HMR: a new module is hot-swapped in with fresh `state` and a
  fresh empty `listeners` Set, but the existing React components are still subscribed via
  the *old* module's listeners. The new module's `set()` calls notify a Set with zero
  subscribers — the UI silently doesn't update. **We hit this hard during F1/F2 live
  testing** (2026-06-08): a clean F2 retry-button implementation appeared broken in
  Firefox because every edit to `store/chat.ts` left behind orphaned subscribers, and only
  a full quit-and-relaunch of the browser cleared it. Playwright in a fresh headless
  Chromium confirmed the code was correct end-to-end. The Vite-recommended pattern is
  `if (import.meta.hot) { import.meta.hot.dispose(data => { data.state = state; data.listeners
  = listeners; … }); if (import.meta.hot.data.state) { /* restore */ } }` — ~12 lines per
  store, dead-code-eliminated in production. Apply to `chat.ts` first (most stateful + most
  edited); other stores (`ui`, `toast`, `confirm`, `connection`, `composer`, `dirty`) only
  if a similar friction surfaces. **Zero production behavior change** — it's pure dev QoL.
- **Editor draft persistence (F29 option A — reload-survival).** F29 was shipped via option B (keep children mounted, CSS-hide when collapsed) — that fully solves intra-session collapse/expand state loss. A future enhancement: lift each long-form editor's local draft state into a small store mirroring `store/composer.ts` (one per editor: Agents / Skills SKILL.md / Machines / Integrations / Tool descriptions), persist to localStorage, so a refresh / PWA reopen with unsaved changes restores the draft. **The two design sub-decisions are now LOCKED (✅ 2026-06-16, build still deferred):** (1) **conflict policy** = restore the local draft and show a toast *"Local changes restored — server differs · [Discard local] [Keep editing]"* (the user resolves; never silently overwrite either side); (2) **scope key** = `<editor-type>:<instance-id>` (e.g. `skill:<name>`, `machine:<slug>`, `mcp:<server>`, plus the singleton editors keyed by type alone) so multi-instance drafts never collide. The E1 dirty registry seam composes naturally — the persisted draft remains dirty across the reload, and the beforeunload guard never fires for a saved-locally draft. Build whenever reload-survival is actually wanted; the design is ready.
- **Theme registry / data-driven themes.** Today adding a theme is 3 manual edits (TS `Theme` union · `vapor.css` `[data-theme="…"]` block · Conf picker option). Easy enough at 3 themes; gets repetitive past ~6. A small refactor — export a `const THEMES = ["dark", "aqua", "ember"] as const` from `store/ui.ts`, derive `Theme` from it, iterate the array in the Conf picker — would let new themes "drop in" with one edit + the CSS block. **Bigger move** if ever wanted: load theme tokens (CSS variable sets) from YAML/JSON so new themes are pure config, no code edit. **✏️ SUPERSEDED by the theme engine (D28–D37):** the registry now exists (`ThemeRegistry`/`ThemeDef`), and adding a theme is a registry row + a tokens file — the 3-manual-edits problem described above is gone. Kept for the design space it maps, not as an open item.
- **Compositor-friendly toggle slide.** `.switch .knob::after` still animates `left` (layout-triggering). A refactor to `transform: translateX(20px)` would put it on the compositor. Single-element change, low risk, but out of scope for the perf pass — file under "polish."
- **Motion tokens.** Centralizing durations/easings into `--motion-fast / --motion-base / --motion-slow` + `--ease-standard / --ease-out` CSS custom properties, with a `prefers-reduced-motion` override. Every transition declaration is already explicit about its property, so this is a mechanical find-and-replace later. See `Slice 3` notes + the references at the bottom of this doc.

## 7. Out of scope (call out for clarity)

- Routing library (no `react-router` — the body-attr tab pattern is doing fine; would only add complexity).
- Server Components / Suspense data fetching (`TanStack Start` etc.) — overkill for a single-user homelab SPA.
- Switching state libraries (Zustand/Jotai/Redux) — `useSyncExternalStore` is already the right primitive.
- Storybook / visual regression infra — not worth the maintenance overhead at this size.

## 8. References

**Perf pass (F1–F13):**
- [TanStack Query — Render Optimizations](https://tanstack.com/query/v5/docs/framework/react/guides/render-optimizations) — structural sharing, `select` behavior.
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [`useTransition` reference](https://react.dev/reference/react/useTransition) · [`useDeferredValue`](https://react.dev/reference/react/useDeferredValue)
- [Vite — Code splitting / lazy loading](https://medium.com/@akashsdas_dev/code-splitting-in-react-w-vite-eae8a9c39f6e)
- [PWA best practices 2026 — Wirefuture](https://wirefuture.com/post/progressive-web-apps-pwa-best-practices-for-2026)
- [React SPA development best practices — Tolga Ege](https://tolgaege.com/en/blog/react-spa-best-practices)

**Follow-up audit (F14–F26):**
- [React Accessibility (A11y) Best Practices — rtCamp](https://rtcamp.com/handbook/react-best-practices/accessibility/)
- [SPA Accessibility: React/Vue/Angular Guide — TestParty](https://testparty.ai/blog/spa-accessibility)
- [How to Build Accessible Modals with Focus Traps (2026) — UXPin](https://www.uxpin.com/studio/blog/how-to-build-accessible-modals-with-focus-traps/)
- [Accessible Animations in React with `prefers-reduced-motion` — Josh W. Comeau](https://www.joshwcomeau.com/react/prefers-reduced-motion/)
- [`prefers-reduced-motion` reference — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [Designing Accessible Animations: A Practical Guide — Dacey Nolan](https://medium.com/@daceynolan/designing-accessible-animations-a-practical-guide-to-prefers-reduced-motion-0d3b89c3b1cb)
- [SSE protocol best practices — HTML spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [reconnecting-eventsource](https://github.com/fanout/reconnecting-eventsource)
- [Implementing React SSE with reconnection backoff — Logan Lee](https://medium.com/@dlrnjstjs/implementing-react-sse-server-sent-events-real-time-notification-system-a999bb983d1b)
- [WCAG 2.2 — Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) (AA, new in 2.2)
- [Keyboard Navigation & Focus — Accesify](https://www.accesify.io/blog/keyboard-navigation-focus-wcag/)

---

**Next action (perf pass):** complete — Slices 1–8 shipped.
**Next action (follow-up audit):** ✅ COMPLETE — the 2026-06-08 a11y session shipped the backlog in this order: Slice A = F25+F14 (`ab24a27`) → Slice B = F15 (`fa0742d`) → Slice C1 = F23 (`98f30f0`) → Slice C2 = F22 (`f647ee7`) → Slice D1 = F17 (`c7bd0d9`) → Slice D2 = F18 (`25d942c`) → Slice E0 = F28 (`3b2e45c`) → Slice E1 = F19 (`4ea10a9`) → Slice E3 = F26 (`76b8490`) → Slice F1 = F16 (`be86f40`) → Slice F2 = F20 (`40f94e8`); F29 (`6f6c7e9`) folded in; F21 → Phase 6 (done). **F24 ✅ SHIPPED** (PRE_DEPLOY step 5, 2026-07-02): the Playwright `e2e/a11y.spec.ts` axe (WCAG A/AA) suite scans all 4 tabs in the real built app — it caught + drove the fix of a real `aria-toggle-field-name` violation (the unlabelled `Switch`, now a required `label` prop). F27 (offline-row SR indicator) shipped 2026-06-24. F9/F13 perf items remain deferred until measured pressure — **with an explicit trigger since 2026-07-20** (thread >~200 messages, or owner-reported input lag while streaming; see F9). They also own `AGENT_CHAT_AUDIT.md` ACA-14 (per-token O(messages) re-pairing).
