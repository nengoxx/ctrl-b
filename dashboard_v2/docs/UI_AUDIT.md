# UI audit — frontend architecture, performance, and a usability-safe implementation plan

**Date:** 2026-06-01 · **Scope:** `dashboard_v2/frontend/` (React 19, Vite 7, TanStack Query, Vapor port). Captures the analysis review delivered in chat, then layers a **usability-safety pass** over every finding so we don't trade fluidity for "perf" by accident. Final section is the **phased implementation plan** — each slice independently shippable, each one preserving current behavior unless explicitly noted.

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

### F7 🟡 — `lucide-react` not audited

Tree-shakes, but worth verifying. No behavior change.

**Safety verdict: ✅ SAFE.** Pure measurement, then a possibly-zero change.

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
| F7 | `lucide-react` tree-shake audit | 🟡 | ✅ SAFE | XS | ⏳ Slice 8 (measure first) |
| F8 | Body-attr mirroring into `setUI()` | 🟡 | ✅ SAFE | S | ✅ Slice 4 |
| F9 | `useTransition` / `useDeferredValue` | 🟢 | 🛑 DEFER | — | ⏸️ defer until measured |
| F10 | Memoize `resultByCall` in AgentTab | 🟢 | ✅ SAFE | XS | ✅ Slice 1 |
| F11 | PWA icon fan-out + PNG compression | 🟢 | ✅ SAFE | XS | ✅ Slice 1 |
| F12 | Bundle analyzer in build | 🟢 | ✅ SAFE | XS | ✅ Slice 1 |
| F13 | React Compiler trial | 🟢 | 🛑 DEFER | — | ⏸️ defer until F1–F12 stable |

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

## 6b. Noted for later (not part of any current slice)

- **Theme registry / data-driven themes.** Today adding a theme is 3 manual edits (TS `Theme` union · `vapor.css` `[data-theme="…"]` block · Conf picker option). Easy enough at 3 themes; gets repetitive past ~6. A small refactor — export a `const THEMES = ["dark", "aqua", "ember"] as const` from `store/ui.ts`, derive `Theme` from it, iterate the array in the Conf picker — would let new themes "drop in" with one edit + the CSS block. **Bigger move** if ever wanted: load theme tokens (CSS variable sets) from YAML/JSON so new themes are pure config, no code edit. Out of scope until the theme count actually grows; noting here so future-us doesn't re-derive the design space.
- **Compositor-friendly toggle slide.** `.switch .knob::after` still animates `left` (layout-triggering). A refactor to `transform: translateX(20px)` would put it on the compositor. Single-element change, low risk, but out of scope for the perf pass — file under "polish."
- **Motion tokens.** Centralizing durations/easings into `--motion-fast / --motion-base / --motion-slow` + `--ease-standard / --ease-out` CSS custom properties, with a `prefers-reduced-motion` override. Every transition declaration is already explicit about its property, so this is a mechanical find-and-replace later. See `Slice 3` notes + the references at the bottom of this doc.

## 7. Out of scope (call out for clarity)

- Routing library (no `react-router` — the body-attr tab pattern is doing fine; would only add complexity).
- Server Components / Suspense data fetching (`TanStack Start` etc.) — overkill for a single-user homelab SPA.
- Switching state libraries (Zustand/Jotai/Redux) — `useSyncExternalStore` is already the right primitive.
- Storybook / visual regression infra — not worth the maintenance overhead at this size.

## 8. References

- [TanStack Query — Render Optimizations](https://tanstack.com/query/v5/docs/framework/react/guides/render-optimizations) — structural sharing, `select` behavior.
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [`useTransition` reference](https://react.dev/reference/react/useTransition) · [`useDeferredValue`](https://react.dev/reference/react/useDeferredValue)
- [Vite — Code splitting / lazy loading](https://medium.com/@akashsdas_dev/code-splitting-in-react-w-vite-eae8a9c39f6e)
- [PWA best practices 2026 — Wirefuture](https://wirefuture.com/post/progressive-web-apps-pwa-best-practices-for-2026)
- [React SPA development best practices — Tolga Ege](https://tolgaege.com/en/blog/react-spa-best-practices)

---

**Next action:** start with **Slice 1** (the four zero-risk quick wins). Each subsequent slice is gated on owner-approved verification of the previous.
