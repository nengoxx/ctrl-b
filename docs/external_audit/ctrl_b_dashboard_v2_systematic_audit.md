# ctrl-b `dashboard_v2` — systematic architecture, code-quality, design-system, and performance audit

**Repo reviewed:** `nengoxx/ctrl-b`  
**Area reviewed:** `dashboard_v2` frontend + backend + project docs  
**Date:** 2026-06-29  
**Audit type:** Static source review through the GitHub connector, plus cross-check against official/current docs for React, Vite, TanStack Query, FastAPI, Pydantic, SQLite, MDN Web APIs, Playwright, axe, and OWASP.

---

## 0. Limits of this audit

I could not clone and run the repository locally because outbound DNS/network access from the execution workspace was unavailable. This means I could not run `npm run typecheck`, `npm run build`, `vitest`, Playwright, the backend test suite, Lighthouse, bundle visualizer, or browser profiling. The conclusions below come from direct source inspection through GitHub and from the project's own docs/status notes.

That said, the source is detailed enough to audit the architecture meaningfully. The project is also unusually well documented, so the main risk is not a lack of design intent; the risk is drift between that intent and the implementation as the V2 dashboard grows.

---

## 1. Executive verdict

The architecture is strong. The project is not a helper-function swamp. It has a coherent core:

```text
Thin app host
  → active theme Root
    → theme-owned presentation shell
      → shared headless controllers/hooks
        → stores + TanStack Query + backend APIs
          → FastAPI services
            → unified action/tool registry
              → agent loop / UI actions / integrations
```

The two best ideas in the codebase are:

1. **Theme-owned roots instead of fake universal theming.** Vapor, minimal, and cosmos are allowed to have different presentation structures. The shared Kit exists for reskin-like themes, while bespoke themes can replace their signature surfaces.
2. **One backend capability model for UI actions and agent tools.** The action/tool registry + `ActionService` is the right security and extensibility choke point.

The main risks are:

1. **Theme contract drift.** The design system is partly encoded in types and partly in docs/comments. It needs more executable contract tests.
2. **Root duplication.** `VaporRoot` and `DefaultRoot` duplicate non-visual shell behavior. This is acceptable short term, but it will rot unless shared as hooks/utilities.
3. **Confirmation and retry edge cases.** The confirm-token model is fine for a personal tailnet panel, but expired/lost tokens and retrying side-effectful turns need better UX/state handling.
4. **Runtime validation gaps on frontend event/settings payloads.** TypeScript types are not runtime guarantees. SSE payloads and persisted/synced theme settings should be lightly validated.
5. **Comment and document aging.** The comments are helpful, but many include phase history that is already stale. That creates future confusion.
6. **Testing gap around themes.** The project has unit/e2e tests, but the next layer should be theme contract, switch-cleanup, visual/a11y, and motion/performance tests.

### Overall scores

| Area | Score | Verdict |
|---|---:|---|
| System architecture | 8.5/10 | Good separation of host, presentation, state, backend services, and capability registry. |
| Theme engine / design system | 8/10 | Correct model. Needs stronger executable contracts. |
| Frontend state model | 8/10 | External stores are justified; selectors and split stores are mostly disciplined. |
| Chat / agent loop | 8.5/10 | Mature for a personal dashboard: streaming, tools, confirm gates, compaction, loop guards. |
| Backend service design | 8/10 | Good registry/service split; app lifespan is coherent. |
| Security posture | 6.5/10 | Good permission gates for tools, but single-user assumptions must be explicit and tested. |
| Performance posture | 7.5/10 | Many good mitigations; future animation-heavy themes are the danger zone. |
| Testing posture | 6.5/10 | Decent base; missing theme-contract and component/a11y safety net. |
| Maintainability | 7/10 | Good seams, but phase comments and duplicated shell logic will become maintenance tax. |

---

## 2. Research baseline: what I compared the code against

This is the external baseline I used while auditing:

- **React external stores.** `useSyncExternalStore` requires the snapshot to be stable while the store has not changed; React compares snapshots with `Object.is`. This supports your `useUISlice` / `useChatSlice` approach, but also makes object-returning selectors dangerous unless cached.
- **React lazy/Suspense.** `lazy()` defers loading until first render, caches the promise and resolved component, and must be rendered under a `Suspense` boundary. Your `preloadableRoot` exists because you are avoiding a one-frame Suspense flash during theme switching, which is a valid concern.
- **Vite dynamic imports and CSS code splitting.** Vite splits dynamic imports into chunks and automatically handles async chunk CSS loading. Your lazy `loadStyles()` / `loadRoot()` approach fits this model, but theme switching must still handle load failures and stale chunks.
- **TanStack Query pausing.** `enabled: false` disables automatic fetches and also opts out of normal invalidation/refetch behavior. This matters for your inactive-tab pausing plan: paused queries need explicit `refetchOnMount` / stale handling or a reconnection reconciliation strategy.
- **FastAPI lifespan.** FastAPI recommends lifespan context managers for app-wide resources created before request handling and cleaned up on shutdown. Your `main.py` mostly follows this well.
- **Pydantic models.** Pydantic models are a natural fit for endpoint request/response schemas and JSON-schema generation; your backend leans into this correctly.
- **SSE / EventSource.** Browser EventSource has built-in reconnect behavior, but not every failure mode is equally recoverable. Your manual CLOSED-state recovery is justified.
- **View Transition API.** The API is intended for SPA state/view transitions, but it captures snapshots and can introduce accessibility/focus/perceived-latency issues if abused. Your progressive enhancement + reduced-motion gate is the right stance.
- **SQLite WAL.** WAL improves read/write concurrency but still has a single writer, checkpoint behavior, and WAL growth risks. Your single write lock is sensible for this scale.
- **Playwright/axe.** Playwright's auto-retrying assertions and `@axe-core/playwright` make theme smoke/a11y tests practical and cheap.
- **OWASP.** Even a tailnet single-user app should keep threat boundaries explicit: secrets, command execution, SSRF-like tools, CSRF/origin assumptions, and unsafe debug modes deserve tests and docs.

---

## 3. System map

### 3.1 Frontend layers

```text
frontend/src/App.tsx
  App-global effects only:
  - Event stream
  - viewport sizing
  - unsaved guard
  - AppEngines: fleet cycle, appearance sync, chat init, auto-TTS

frontend/src/theme-engine/
  - ThemeDef / registry / root resolution
  - lazy root preload strategy
  - theme switching + View Transition API
  - Kit scaffold for reusable theme chrome

frontend/src/themes/
  vapor/
    bespoke frozen root + old vapor components
  minimal/
    Kit reskin with tokens.css + settings
  cosmos/
    starfield + bespoke Fleet, Kit reused for other surfaces

frontend/src/store/
  - ui: theme/tab/motion/perf/appbarMode/themeSettings
  - chat: streaming reducer, message list, confirm tokens, send/resume/compact/retry
  - fleet: featured host + open rows
  - connection / toast / confirm / dirty / composer

frontend/src/hooks/
  - headless controllers: useFleet, useAgentChat, useComposer, useAppearance, etc.

frontend/src/tabs/
  - Fleet / Agent / Utils / Conf tab bodies
```

### 3.2 Backend layers

```text
backend/app/main.py
  FastAPI app factory + lifespan resource wiring

backend/app/config.py
  typed settings, config/env merging, secrets masking, workspace paths

backend/app/core/
  tool registry, permissions, events, memory, fs utilities

backend/app/services/
  fleet, services, action service, agent loop, integrations, memory, events

backend/app/adapters/
  inference, MCP, OpenAPI tools, SearXNG, terminal, voice, DB-facing pieces

backend/app/api/
  thin-ish routers for health, hosts, services, actions, agent, settings, integrations, voice

backend/app/db.py
  SQLite schema, WAL mode, migrations, write serialization
```

---

## 4. Detailed audit findings

Severity legend:

- **P0** — fix before relying on this feature heavily.
- **P1** — important architectural hardening.
- **P2** — maintainability/performance improvement.
- **P3** — polish/future-proofing.

---

# A. App host and root ownership

## A1. `App.tsx` is correctly thin

**Status:** Good  
**Priority:** Keep

`App.tsx` has the right responsibility: it runs app-global effects and renders the active theme root. It does not own the visual shell anymore. It also isolates global data engines inside `AppEngines`, which avoids re-rendering the active theme tree every time those engines update.

That is a strong architectural move. It means theme switching, chat init, fleet polling, and appearance sync have clear ownership.

### What is good

- `App` subscribes only to the active root selection.
- `AppEngines` mounts headless systems above the theme root.
- Visual viewport sizing is global, because every theme needs keyboard-aware sizing.
- Unsaved-change protection is global.

### Risks

The only real risk is that future visual/layout logic creeps back into `App.tsx` because it is easy to “just add it there.” Resist that. `App.tsx` should remain boring.

### Recommendation

Add a file-level invariant comment or test note:

```text
App.tsx may mount only app-global engines and the active theme root.
No theme-specific DOM, tab-specific query, or presentational logic belongs here.
```

This sounds pedantic, but it protects the architecture from death-by-one-small-exception.

---

## A2. Headless engines above roots are the right model

**Status:** Good  
**Priority:** Keep

The separation between `useChatInit`, `useFleetCycle`, `useAppearanceSync`, `useAutoTts`, and visual roots is exactly what you want for a theme engine. Themes should not accidentally double-start timers, chat hydration, or SSE streams.

### What to watch

Headless engines should be **idempotent** and **singleton-safe**. `useFleetCycle` explicitly documents that it should be called once. That is good, but it is still a convention.

### Recommendation

For singleton engines, add defensive runtime guards in development:

```ts
let mounted = false;
export function useFleetCycle(): void {
  useEffect(() => {
    if (import.meta.env.DEV && mounted) {
      console.warn("useFleetCycle mounted more than once");
    }
    mounted = true;
    return () => { mounted = false; };
  }, []);
}
```

Do this only where duplicate mounting would cause real bugs: fleet cycling, SSE streams, maybe auto-TTS.

---

# B. Theme engine and design system

## B1. The theme model is conceptually correct

**Status:** Good  
**Priority:** Keep

The `ThemeDef` model includes:

- `id`, `label`
- `Root`
- `palettes`
- `loadStyles`
- `loadFonts`
- `loadRoot`
- `present`
- `settings`
- `assets`

This is much better than a CSS-only theme system. Your own prototypes prove why: cosmos and frontier are not just colors; they restructure the app.

### Why this is the right approach

A dashboard with strong visual themes needs three different layers:

1. **Semantic skinning:** tokens, palette axes, fonts.
2. **Component composition:** slots/addons/variants for surfaces like Fleet, Composer, AppBar.
3. **Structural replacement:** bespoke theme roots/surfaces for designs like cosmos/frontier.

The current engine supports all three. That is the correct “design system on top of the app” model.

### Alternative approaches considered

#### Alternative 1: CSS variables only

This would be simpler, but it would fail cosmos/frontier immediately. CSS variables cannot turn a device row list into an orbital camera system or a map with bottom sheets.

Verdict: **reject**.

#### Alternative 2: One universal component tree with hundreds of props

This usually becomes a prop explosion: `variant`, `density`, `fleetMode`, `heroMode`, `sheetMode`, `navMode`, `orbitMode`, `mapMode`, etc. Eventually nobody knows which props matter for which theme.

Verdict: **reject**.

#### Alternative 3: Every theme fully duplicates everything

This preserves pixel fidelity but causes behavior drift. You already saw this with VaporRoot vs DefaultRoot.

Verdict: **usable only for special roots, not as the default policy**.

#### Recommended model

Keep your current hybrid:

```text
shared headless controllers
  + shared Kit for common app structure
  + theme-owned tokens/settings/assets
  + bespoke slots for signature surfaces
  + bespoke roots only where visual structure genuinely differs
```

That is the right compromise.

---

## B2. Theme contract should be executable, not just documented

**Status:** Needs hardening  
**Priority:** P1

Right now the design system contract lives across:

- `ThemeDef` types
- `registry.ts`
- `tabs.ts`
- comments
- `THEME_ENGINE.md`
- individual theme root behavior
- body/html data attributes

That is too much implicit contract.

### Current risk

A theme can be added and technically compile while still violating design-system assumptions:

- invalid default accent
- missing `loadRoot` for lazy Root
- `loadStyles()` failing silently
- stale body attributes leaking after switch
- tabs missing required IDs
- settings default not matching allowed options
- CSS missing required Kit semantic variables
- theme-specific `useLayoutEffect` attrs not cleaned up on unmount

### Recommendation: add `themeContract.test.ts`

Add a contract test for every registered theme:

```ts
import { registry, registeredThemes } from "../src/theme-engine/registry";
import { STANDARD_TABS, tabsFor } from "../src/theme-engine/tabs";

it.each(registeredThemes())("%s has valid palette defaults", (theme) => {
  const accents = theme.palettes.accents ?? [];
  if (theme.palettes.defaultAccent) {
    expect(accents.map(a => a.id)).toContain(theme.palettes.defaultAccent);
  }
  if (theme.palettes.defaultMode) {
    expect(theme.palettes.modes ?? []).toContain(theme.palettes.defaultMode);
  }
});

it.each(registeredThemes())("%s has valid settings defaults", (theme) => {
  for (const [key, spec] of Object.entries(theme.settings ?? {})) {
    if (spec.type === "switch") expect(typeof spec.default).toBe("boolean");
    if (spec.type === "seg") {
      expect(spec.options.map(o => o.val)).toContain(spec.default);
    }
  }
});

it.each(registeredThemes())("%s loads assets/styles/root", async (theme) => {
  await expect(theme.loadStyles()).resolves.toBeDefined();
  await expect(theme.loadFonts?.() ?? Promise.resolve()).resolves.toBeUndefined();
  await expect(theme.loadRoot?.() ?? Promise.resolve()).resolves.toBeUndefined();
});
```

Also add a DOM cleanup test:

```ts
it("theme switching does not leak body/html attrs", () => {
  // vapor → minimal → cosmos → vapor
  // assert stale data-density/data-skyline/data-loz/no-composer are correct/cleared
});
```

This is the best ROI improvement in the entire theme engine. It turns “remember the architecture” into “the test fails when you violate it.” Much better than hoping Future You has slept.

---

## B3. Move tab definitions into `ThemeDef`

**Status:** Architectural drift risk  
**Priority:** P1

`TabDef` is already a good abstraction: `id`, `glyph`, `lbl`, `hasComposer`. But actual tab sets live in `theme-engine/tabs.ts`, separate from the theme registry.

Today every non-vapor theme falls back to `STANDARD_TABS`. That is fine for current themes, but it means tab ownership is split.

### Problem

The theme module owns root/palette/settings/assets, but not its section list. This creates a second hidden theme registry.

### Recommendation

Add `tabs?: TabDef[]` to `ThemeDef`:

```ts
export interface ThemeDef {
  id: ThemeId;
  label: string;
  Root: ComponentType;
  palettes: PaletteModel;
  tabs?: TabDef[];
  loadStyles: () => Promise<unknown>;
  loadFonts?: () => Promise<void>;
  loadRoot?: () => Promise<unknown>;
  present?: Present;
  settings?: ThemeSettingsSpec;
  assets?: Record<string, () => Promise<string>>;
}
```

Then:

```ts
export function tabsFor(theme: ThemeId): TabDef[] {
  return registry[theme]?.tabs ?? STANDARD_TABS;
}
```

This keeps each theme self-contained. It also makes future frontier/observatory tab changes less awkward.

### Alternative

Keep `tabs.ts` as a separate pure data registry. This avoids importing `registry` into `tabs.ts`, but you already carefully handle cycles elsewhere. If cycles become an issue, place tab definitions in theme modules and export a small static registry.

Recommended: **move tabs into ThemeDef** unless a real cycle appears.

---

## B4. Per-theme settings need runtime validation

**Status:** Needs hardening  
**Priority:** P1

`useThemeSetting<T>()` reads an override and falls back to the theme default. Good. But the override is cast to `T` without checking whether it is valid for the theme setting schema.

### Why this matters

This setting map is persisted, synced, migrated, and open-ended. A stale setting can survive longer than the code that created it. Invalid values can come from:

- older localStorage schema
- cross-device synced appearance state
- manual config edits
- future theme option removal
- accidental bad writes from Conf UI

### Recommendation

Add a central resolver:

```ts
export function resolveThemeSetting(
  themeId: ThemeId,
  key: string,
  raw: ThemeSettingValue | undefined,
): ThemeSettingValue | undefined {
  const spec = registry[themeId]?.settings?.[key];
  if (!spec) return undefined;

  if (spec.type === "switch") {
    return typeof raw === "boolean" ? raw : spec.default;
  }

  if (spec.type === "seg") {
    return typeof raw === "string" && spec.options.some(o => o.val === raw)
      ? raw
      : spec.default;
  }
}
```

Then `useThemeSetting` should use it. Also sanitize `themeSettings` during persistence load/reconciliation.

### Nice-to-have

Add `sanitizeThemeSettings(themeSettings)` that:

- drops unknown theme IDs not in the registry
- drops unknown setting keys
- replaces invalid values with defaults or deletes them
- preserves unknown theme settings only if you intentionally want forward compatibility

For a single-user app, I would sanitize known themes and preserve unknown themes. That lets a future build re-enable a theme without nuking its stored settings.

---

## B5. Theme CSS isolation is good, but needs a required-token checklist

**Status:** Good but under-tested  
**Priority:** P2

The engine uses `html[data-skin]` and body attributes for skin/mode/accent. That is a good approach: low runtime cost, easy for CSS, and compatible with Vite CSS chunks.

### Risk

Kit themes rely on semantic variables. If a new Kit theme forgets a variable, the app may render with fallback weirdness rather than failing loudly.

### Recommendation

Create a token contract list for Kit themes:

```ts
const REQUIRED_KIT_VARS = [
  "--surface",
  "--surface-2",
  "--text",
  "--text-2",
  "--line",
  "--accent",
  "--ok",
  "--warn",
  "--danger",
  "--shadow",
];
```

Then add a Playwright smoke test that loads each theme and checks computed styles on `.kit` or `documentElement`.

You do not need to overdo this; just catch missing variables before they become invisible UI crimes.

---

# C. Theme runtime loading and switching

## C1. `preloadableRoot` is justified

**Status:** Good  
**Priority:** Keep

The custom `preloadableRoot` is a specialized solution to avoid a one-frame Suspense fallback during view-transition theme switching. React `lazy()` suspends until the imported component resolves; your wrapper caches the module and renders synchronously once preloaded.

This is a reasonable, narrow abstraction. It is not overengineering.

### Why it is good

- It keeps non-active heavy theme roots out of the initial bundle.
- It lets `switchTheme` load styles/fonts/root before flipping state.
- It avoids a blank after-snapshot during View Transition.
- It still supports cold-load Suspense for persisted non-default themes.

### Risks

- Rejected dynamic imports are cached forever, matching `React.lazy` behavior. That means stale chunks after deploy may require page reload.
- There is no detailed error boundary around theme root loading except the app-level Suspense fallback.

### Recommendation

Add a visible fallback for cold persisted theme load failure:

```text
Theme failed to load. Falling back to Vapor. Reload app.
```

Implementation idea:

- `ensureThemeLoaded(next)` already catches switch failures and emits a toast.
- For cold load, add a root-level `ErrorBoundary` around `<ActiveRoot />` that resets UI theme to `vapor` on theme-root chunk failure.

---

## C2. `switchTheme` is well designed

**Status:** Good  
**Priority:** Keep

The sequence is correct:

1. Load CSS/fonts/root first.
2. Then run `flushSync(setUI(...))` inside View Transition callback.
3. Skip transition when reduced motion or unsupported.
4. Do not do network work inside the transition callback.

That is exactly the right shape for this feature.

### Recommendation

Add a testable pure helper:

```ts
function shouldUseViewTransition(motion, startViewTransitionAvailable) { ... }
```

And test:

- reduced motion disables transitions
- unsupported browser disables transitions
- same-skin picks are no-ops in Conf
- failed style/root load leaves current theme unchanged

### Accessibility note

View transitions can preserve context, but they also create old/new snapshots and can confuse focus/live regions if overused. You are using it only for whole-theme skin swaps, which is fine. Avoid element-scoped view-transition names until you have a specific measured reason.

---

## C3. Cold-load non-default theme has a brief style-in risk

**Status:** Acceptable, but document/test  
**Priority:** P2

`ThemeProvider` calls `ensureThemeLoaded(theme)` in an effect. That means if the persisted theme is non-default, the body/html data attrs may indicate the theme before the lazy CSS finishes loading.

The code comment accepts one brief style-in on cold load. For a single-user PWA, this is fine. But once themes become a central feature, visual flash becomes more noticeable.

### Recommendation

Keep current behavior for now. Add one of these later if it becomes visible:

1. Inline minimal critical CSS per theme selection in `index.html` — too much work now.
2. Add a pre-boot script that reads `localStorage.ctrlb.ui.theme` and injects a `<link>` for the theme CSS before React boots.
3. Show `fallback=null` against a neutral background until `ensureThemeLoaded` resolves.

For now, do not complicate it. Put the goblin back in the drawer.

---

# D. Roots, Kit, and layout

## D1. `DefaultRoot` is a good reusable scaffold

**Status:** Good  
**Priority:** Keep

`DefaultRoot` owns:

- appbar/nav mode
- scroll container
- lazy Conf latch
- appbar height measurement
- composer height measurement
- Conf idle prefetch
- overlays
- optional Fleet slot
- optional Composer variant/slots

This is exactly what a Kit root should own. It is layout plumbing, not theme-specific data.

### What is especially good

The `Fleet` prop is the right slot boundary. Fleet is the signature surface. `Composer` + `composerSlots` is also the right shape: variant = style/layout; slots = feature addons.

### Risks

The Kit root may become a dumping ground for every future theme need. Keep it narrow:

- It may own common layout.
- It may expose slots.
- It should not learn cosmos-specific or frontier-specific behavior.

### Recommendation

Make a short `Kit contract` doc:

```text
DefaultRoot owns app layout plumbing only.
Theme-specific visuals enter via Root composition, CSS tokens, Fleet slot, Composer variant, and composer slots.
DefaultRoot must not branch on theme id.
```

No theme ID conditionals inside `DefaultRoot`. Ever. That way lies madness wearing a cardigan.

---

## D2. `VaporRoot` duplication is acceptable but should be reduced with hooks

**Status:** Risky over time  
**Priority:** P1

Vapor is frozen and bespoke. That is the right decision. But `VaporRoot` duplicates non-visual logic from `DefaultRoot`:

- lazy Conf mount
- scroll reset
- appbar height var
- Conf prefetch
- Suspense/error fallback shape
- overlay placement

### Why this is dangerous

When you fix a layout bug in `DefaultRoot`, you may forget `VaporRoot`. When you harden Conf lazy loading in one, the other may diverge. This is how codebases get haunted.

### Recommendation

Extract shared hooks/utilities without changing vapor DOM:

```ts
function useLazyConfMounted(activeSection: TabId): boolean
function useScrollReset(scrollRef, activeSection, except = "agent")
function useMeasuredAppbarHeight(scrollRef, selector, deps)
function useIdleConfPrefetch()
function ConfSuspenseBoundary({ active, classMode })
```

Then both roots can call the same behavior while preserving their DOM and CSS class structures.

### Do not do this

Do **not** force vapor through `DefaultRoot` just for purity. That would be architectural cosplay and probably break the one theme whose fidelity matters most.

---

## D3. Appbar mode is correctly global, but vapor minimal remains a known inconsistency

**Status:** Known gap  
**Priority:** P2 / P1 if you rely on minimal nav

`appbarMode` is global and per-device. Kit themes support `visible`, `off`, and `minimal`. Vapor maps `minimal` to `off` and keeps the bottom tab bar.

That is okay as a staged implementation. But it is inconsistent as a user-facing setting.

### Recommendation

Either:

1. Finish vapor-minimal wiring so vapor also uses `NavMenu`, or
2. Hide/disable the `minimal` option while vapor is active, with helper text: “minimal nav not supported by Vapor yet.”

Right now, selecting minimal appbar while on vapor produces a different semantic behavior than selecting it on Kit themes. That is not fatal, but it is a papercut.

---

# E. Minimal and Cosmos themes

## E1. Minimal is the ideal first Kit consumer

**Status:** Good  
**Priority:** Keep

Minimal uses `DefaultRoot`, lazy CSS/fonts/root, and a small setting (`density`) that maps to a body data attribute. This is exactly what a reskin theme should look like.

### What is good

- Minimal's `index.tsx` is small and declarative.
- `MinimalRoot` wires global `appbarMode` and per-theme `density` only.
- `useLayoutEffect` sets/clears `body[data-density]` to avoid stale attr leakage.

### Recommendation

Use minimal as the template for phosphor.

A new reskin theme should be roughly:

```ts
const { Root, preload } = preloadableRoot(() => import("./ThemeRoot"));

export const phosphor: ThemeDef = {
  id: "phosphor",
  label: "Phosphor",
  Root,
  loadRoot: preload,
  palettes: { ... },
  loadStyles: () => import("./tokens.css"),
  loadFonts,
  settings: { ... },
};
```

If phosphor needs a CRT overlay, add it as `PhosphorRoot` composition around `DefaultRoot`, not as a `DefaultRoot` branch.

---

## E2. Cosmos is the right kind of bespoke theme

**Status:** Good  
**Priority:** Keep

Cosmos reuses Kit chrome and shared tab bodies, while replacing Fleet and adding `CosmosStarfield`. That is the correct boundary: the theme is bespoke where it must be, shared where it can be.

### What is good

- `CosmosRoot` composes `CosmosStarfield` + `DefaultRoot`.
- `DefaultRoot` receives `Fleet={CosmosFleet}`.
- Cosmos opts into the plan-pill composer slot.
- Cosmos owns palette/settings/present() in its module.

### Main risk

Cosmos is animation-heavy. Starfield, orbital fleet, camera motion, service banners, liveness effects, and bottom sheets can become expensive on mobile.

### Recommendations

1. Add a `perf: lite` behavior for cosmos, not only global glass blur.
2. Ensure every rAF loop stops when:
   - tab inactive
   - theme inactive
   - page hidden
   - reduced motion active
   - perf lite active
3. Add a Playwright smoke test that switches to cosmos, changes tabs, and asserts no duplicate canvases/rAF-driven DOM leaks.
4. Add `document.visibilitychange` handling for starfield/orbit loops.
5. Use Performance panel once on the actual Android device. Desktop smoothness lies like a politician.

---

## E3. Per-host presentation data should become a real config seam

**Status:** Partly implemented  
**Priority:** P2

`ThemeDef.present(host, index, override?)` is the right idea. It lets cosmos/frontier map real hosts into visual encodings.

### Current issue

The type exists, cosmos uses it, but the override path should be standardized before frontier/observatory land.

### Recommendation

Add an optional host appearance shape to backend config/types:

```yaml
hosts:
  - id: corsair
    name: Corsair
    appearance:
      cosmos:
        symbol: ring
        orbit: 2
        color: violet
      frontier:
        x: 42
        y: 61
        asset: rig-03
```

Frontend `present()` receives:

```ts
present(host, index, host.appearance?.[themeId])
```

Validation should be permissive but namespaced.

### Avoid

Do not add top-level `planetColor`, `mapX`, `orbitAngle`, etc. to the host model. That pollutes domain data with presentation junk. Keep the theme-specific mess in a theme-specific drawer, where it belongs.

---

# F. UI state and external stores

## F1. The external-store approach is justified

**Status:** Good  
**Priority:** Keep

For UI state and streaming chat, `useSyncExternalStore` is a reasonable choice. You avoided adding Zustand/Redux, and the app is small enough that the custom store is understandable.

### What is good

- The store binding is dependency-free.
- `useUISlice` and `useChatSlice` avoid waking unrelated consumers.
- Comments correctly document the stable snapshot requirement.
- The store is module-local, not context-provider soup.

### Main risk

External stores are sharp tools. A selector returning a new object/array can cause repeated renders or loops.

### Recommendation

Add ESLint comments/rules or tests for known selector patterns. At minimum, add a test for `useCurrentPlan` and a test that object selectors are rejected/documented.

If you ever need composite selectors, add:

```ts
useStoreWithSelector(selector, equalityFn)
```

Do not start returning fresh objects from `useUISlice`. That is how you summon React demons.

---

## F2. `ui.ts` migrations are good, but settings sanitization is missing

**Status:** Mixed  
**Priority:** P1

`ui.ts` has careful migrations:

- old vapor theme axis → `{theme: vapor, accent}`
- legacy vapor top-level settings → `themeSettings.vapor`
- legacy `hideAppbar` → `appbarMode`
- stale per-theme `hideAppbar` stripped

This is good. It shows the code already treats persisted state as dirty, which is exactly correct.

### Missing piece

Sanitize current theme settings against `ThemeDef.settings` as noted in B4.

### Recommendation

Add:

```ts
sanitizeUIState(raw: unknown): UIState
```

This should:

- fill defaults
- migrate old shapes
- validate theme id against registered or known ThemeId
- validate mode/accent against theme palette defaults
- validate theme settings against theme schemas
- strip stale legacy fields

This centralizes persistence hygiene instead of spreading it across migrations.

---

## F3. Body/html data attrs are effective but need cleanup tests

**Status:** Good but under-tested  
**Priority:** P1

`applyBodyAttrs` synchronously mirrors UI state to DOM attrs. This is right for CSS-driven theming and avoids one-frame mismatch after setting UI state.

### Risk

Attributes owned by theme roots (`data-density`, `data-skyline`, `data-loz`, `no-composer`) are not owned by `applyBodyAttrs`. Each root must clean up after itself.

The current code appears careful, but this needs automated tests because future themes will add more attrs.

### Recommendation

Add a cleanup contract:

```ts
const THEME_OWNED_ATTRS = ["density", "skyline", "loz", ...]
```

Test switching chains:

- vapor → minimal
- minimal → cosmos
- cosmos → vapor
- vapor with no-composer tab → cosmos
- minimal compact density → vapor

Assert no stale attrs/classes remain.

---

# G. Sections/tabs and navigation

## G1. `useSections` is a good headless controller

**Status:** Good  
**Priority:** Keep

The shift from hardcoded `tab` UI to “sections controller” is correct. Themes may render tabs, menu, drawer, rail, or hidden navigation, so navigation capability should be presentation-neutral.

### Recommendation

Once `tabs` moves into `ThemeDef`, `useSections` becomes even cleaner.

Also add guard behavior when current active tab is not present in the active theme's tab set. For example, if frontier someday omits Utils and the user switches from vapor/utils to frontier, the current active tab becomes invalid.

Add:

```ts
function coerceActiveSection(theme, active) {
  return tabsFor(theme).some(t => t.id === active)
    ? active
    : tabsFor(theme)[0].id;
}
```

Apply it during theme switch or inside `useSections` with a layout effect that corrects invalid state.

---

## G2. `NavMenu` as minimal chrome is a good feature seam

**Status:** Good  
**Priority:** P2 follow-up

The nav-menu pattern is better than forcing every theme to use bottom tabs.

### Recommendation

Add e2e tests:

- open menu
- Escape closes
- outside click closes
- roving focus works
- selecting each section navigates
- minimal mode hides bottom nav
- visible/off modes keep bottom nav

This is not glamor work, but it prevents mobile nav from becoming a haunted drop-down.

---

# H. Composer architecture

## H1. Headless `useComposer` is good

**Status:** Good  
**Priority:** Keep

`useComposer` owns draft, send routing, streaming gate, mic state, and STT readiness. It leaves auto-grow and markup to theme composer variants. This is exactly the right split.

### What is good

- Shared behavior across vapor and Kit composers.
- No duplicated prefix routing.
- Composer reads only chat `status`, not full messages, so streaming tokens do not re-render the composer.
- Imperative `getDraft()` avoids stale closure when sending.

### Risk

`fillComposer()` writes directly to the DOM and dispatches `input`. That is a compatibility shim from old behavior, but it bypasses React/store state if not carefully handled.

### Recommendation

Move `fillComposer` onto the composer store rather than direct DOM when possible:

```ts
export function fillComposer(text: string): void {
  setDraft(text);
  requestAnimationFrame(() => focusComposerTextArea());
}
```

Keep DOM focus as imperative, but make the draft state the source of truth.

If the auto-grow relies on the input event, expose an imperative `composerFocusAndMeasure` event or let the textarea effect run from draft.

---

## H2. Prefix routing is clear but should be parsed more formally

**Status:** Good enough now  
**Priority:** P2

`lib/composer.ts` routes:

- `!cmd` → shell
- `/local`, `/cloud`
- `/agent`
- `/privilege`
- `/compact`
- `/clear`
- `/help`
- `/<skill>`
- default → agent chat

This is useful and readable. But the command parser is currently string-splitting in one function.

### Recommendation

When commands grow, replace the switch with a command registry:

```ts
interface SlashCommand {
  name: string;
  aliases?: string[];
  help: string;
  run(rest: string): void;
}
```

Then `/help` renders from registry. Skills remain dynamic fallthrough.

No need now, but once you add more commands, do this before the switch becomes a municipal plumbing diagram.

---

## H3. Composer slots are the right composition model

**Status:** Good  
**Priority:** Keep

The D30 split between composer variant and slots is the right design:

- variant controls layout/styling (`KitComposer`, future `SheetComposer`)
- slots add features (`PlanPill`, `PlanSheet`)

This avoids boolean config soup like `showPlan`, `useSheet`, `variant`, `planMode`, etc.

### Recommendation

Formalize slot names and lifecycle expectations:

```ts
interface ComposerSlots {
  controlsStart?: ReactNode;
  controlsEnd?: ReactNode;
  overlay?: ReactNode;
  below?: ReactNode;
}
```

Use only what you need now, but document placement semantics. Slots become weird fast if every theme invents its own gravity.

---

# I. Agent tab and chat presentation

## I1. `AgentTab` does too much, but the split is not urgent

**Status:** Functional, medium maintainability risk  
**Priority:** P2

`AgentTab.tsx` includes:

- helper functions for extracting parts
- plan bubble
- pinned plan
- search results
- think block
- TTS button
- command bubble
- question bubble
- memoized message rendering
- privilege chip
- scroll-stick logic
- tab markup

It is still readable because the code is well-commented, but it is one of the larger front-end components and is a natural future split point.

### Recommendation

Split by bubble type:

```text
src/tabs/agent/
  AgentTab.tsx
  Bubbles.tsx
  CmdBubble.tsx
  QuestionBubble.tsx
  PlanBubble.tsx
  PinnedPlan.tsx
  PrivilegeChip.tsx
  useChatScrollStick.ts
```

This is not urgent. Do it when editing this file again. Do not refactor it just to feel clean — that is how people accidentally spend Sunday inventing folders.

---

## I2. Message memoization is thoughtful

**Status:** Good  
**Priority:** Keep

The `Bubbles` component is memoized so streamed token updates re-render only the active bubble. The `resultFor` callback uses a ref to stay stable. This is a good performance technique for streaming logs.

### Risk

The memoization relies on message identity stability in `store/chat.ts`. If future reducers rebuild all message objects per token, this optimization dies.

### Recommendation

Add a reducer/store test:

```ts
it("appendDelta preserves identity for non-streaming messages", () => { ... })
```

This protects the optimization.

---

## I3. Reasoning display needs a policy decision

**Status:** Product/design risk  
**Priority:** P2

The code renders reasoning blocks as “thinking” disclosures. Technically fine. But decide whether this is intended long-term.

### Options

1. Keep reasoning visible because this is a personal/local tool and helps debugging.
2. Hide reasoning by default but allow a dev/debug toggle.
3. Store reasoning but do not show it in normal UI.
4. Drop reasoning entirely before persistence.

Given this is a control dashboard, I would make it a setting:

```yaml
agent:
  show_reasoning: false | true | debug
```

Default to false or debug. Reasoning text can be huge, weird, or not user-facing quality. It is useful but not always pleasant. Like a cat bringing you a dead lizard: data, yes; presentation, questionable.

---

## I4. Retry UI should be risk-aware

**Status:** Needs hardening  
**Priority:** P1

The code explicitly acknowledges that retrying a failed turn re-runs the user's last message and can re-run side effects.

That is acceptable for low-risk chat, but not for a system-control dashboard.

### Recommendation

Track whether a failed turn included any mutating/risky tool calls.

Possible implementation:

- Add `risk` and/or `mutates` to `ToolSpec` DTO exposed to frontend.
- Store risk on `ToolCallPart` when emitted, or derive from known action metadata.
- When rendering retry:
  - if no tool calls or only read-only tools: show `retry`
  - if mutating/risky calls happened: show `retry as new draft` or `copy last request`
  - never one-click retry a side-effectful failed turn

### UI copy

```text
This turn may have run actions already. I put the request back in the composer instead of retrying blindly.
```

This avoids double-shutdown/double-restart nonsense. Computers are already enthusiastic enough about ruining your day.

---

# J. Chat store and SSE reducer

## J1. Streaming reducer architecture is strong

**Status:** Good  
**Priority:** Keep

The chat store is not TanStack Query, and that is correct. Streaming chat is an append/patch reducer, not a cache fetch.

### What is good

- One active thread state.
- SSE events reduce into message parts.
- Buffered JSON path reuses persisted messages by reloading thread.
- Confirm tokens are kept client-side only.
- Compaction and notices surface as system notes, not silent backend behavior.
- `useCurrentPlan` memoizes a stable plan snapshot.

### Risk

The store is now large and owns both reducer logic and async network calls. That is workable, but it is approaching the point where a small internal state machine would clarify behavior.

### Recommendation

Split into:

```text
store/chat/state.ts       // state + useChat/useChatSlice
store/chat/reducer.ts     // pure event reducers
store/chat/network.ts     // streamTurn/send/resume/compact/runShell
store/chat/selectors.ts   // currentPlan/resultByCall/text helpers
```

Or keep one file but add tests for all event transitions. I would split only when editing heavily.

---

## J2. SSE parser is pragmatic but payload validation is thin

**Status:** Needs hardening  
**Priority:** P1

The SSE frame parser handles CRLF and bare LF. Good. It ignores non-JSON frames. Also good.

But event payloads are parsed into `Record<string, unknown>` and cast. Since backend/frontend are same repo, this is mostly okay. Still, chat is core enough that malformed events should fail clearly.

### Recommendation

Add tiny validators, not a new dependency unless you already want one.

Example:

```ts
function asString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new Error(`bad event: ${field}`);
  return v;
}

function parseMessageStart(data: Record<string, unknown>) {
  return {
    messageId: asString(data.messageId, "messageId"),
    agent: typeof data.agent === "string" ? data.agent : null,
  };
}
```

Use this for critical events:

- `thread`
- `message.start`
- `part.added`
- `tool.permission`
- `tool.result`
- `done`
- `error`

### Alternative

Use Zod or Valibot shared schemas. For this project, hand-written guards are probably enough.

---

## J3. Confirm tokens are fragile after reload/restart

**Status:** Needs hardening  
**Priority:** P1

Confirm tokens exist in memory on both backend and frontend. They are single-use and TTL-bound. This is acceptable for a single-user tailnet panel, but creates stale UI states:

- page reload loses frontend token
- backend restart loses backend token
- token expiry leaves `AWAITING_CONFIRM` bubble unusable
- buffered mode seeds the token once, but persistence does not include it

### Recommendation: stale-confirm recovery

Minimum fix:

- If resume returns `no pending action` or token invalid/expired, mark bubble as stale and show:

```text
confirmation expired — ask again / dismiss
```

Better fix:

- Add `/api/agent/confirm-token` to re-mint a token for a pending call after validating the pending call still exists and still requires confirmation.

Best fix:

- Persist a pending confirmation challenge with:
  - call id
  - tool name
  - args hash
  - expires_at
  - used_at
  - thread id

For this project, I would do the better fix. Full persistence is probably overkill until multiple users/devices matter.

---

## J4. Buffered and streaming modes are cleanly unified

**Status:** Good  
**Priority:** Keep

The backend drains the same event generator for SSE and JSON buffered mode. That is excellent because it avoids having two agent loops.

### Recommendation

Add tests that assert streaming and buffered modes produce equivalent persisted messages for:

- plain text reply
- tool call success
- confirm suspension
- question suspension
- compaction event
- inference error

This is the kind of thing that pays off when the agent loop grows another limb.

---

# K. Backend agent loop

## K1. The loop state machine is mature

**Status:** Good  
**Priority:** Keep

The agent loop has:

- static prompt prefix caching
- tools caching per turn
- compaction before model call
- message assembly with tool_call/tool_result mapping
- permission-gated tool execution
- confirm suspension/resume
- question suspension/resume
- duplicate-call suppression
- per-tool call caps
- repeated-result stall detection
- forced final answer

That is very good for a personal dashboard.

### What is especially good

The loop understands that local/weak models can spiral. The guard against repeated tool calls and repeated outcomes is not theoretical; it is exactly the sort of practical scar tissue these systems need.

### Risk

`AgentSession` is now a very large class. It is coherent, but if agent features keep growing, it may become the backend equivalent of `AgentTab.tsx`.

### Recommendation

Long term, split by concern:

```text
agent/session.py        // public run_turn/resume orchestration
agent/assemble.py       // message assembly and context conversion
agent/tool_runner.py    // _run_calls, confirm/question/resume behavior
agent/loop_guard.py     // repeat/stall logic
agent/finalize.py       // forced final-answer behavior
```

Not urgent. But the next big agent feature should pay this cleanup tax.

---

## K2. Static prompt/tool caching is a strong performance detail

**Status:** Good  
**Priority:** Keep

The code caches the turn-invariant tool schema and static system head per turn, which protects prefix caching in local/cloud inference providers.

### Recommendation

Add a small regression test ensuring:

- `_tools()` returns the same object/list within a turn.
- `_static_prefix()` returns identical content across loop iterations.
- memory writes during a tool call do not mutate the current turn prefix.

This preserves the performance property explicitly.

---

## K3. Agent privilege override needs an audit log signal

**Status:** Needs visibility  
**Priority:** P2

The frontend has `/privilege` and a privilege chip. The backend applies the override by copying the resolved `AgentDef` with the new privilege. That is fine for an interactive owner.

### Risk

If a session is raised to `FULL`, it should be obvious in the transcript and/or event log.

### Recommendation

When privilege is changed, persist a system message or event:

```text
// session privilege → Full access
```

The frontend already pushes a local system note. But local notes disappear on reload. Consider persisting privilege changes to the thread, or include privilege in action events.

This matters because a later tool run should be explainable: “why did that execute without confirmation?” Answer: because session privilege was raised. No mystery meat.

---

## K4. Tool result truncation/redaction should be centralized and tested

**Status:** Needs audit tests  
**Priority:** P1

The architecture says outputs are redacted/truncated upstream. That is the right policy. But every tool/integration path must comply:

- shell
- terminal
- MCP
- OpenAPI
- SearXNG/crawl
- memory/skill file tools
- future file tools

### Recommendation

Create a single `safe_output()` helper:

```py
safe_output(text, *, max_chars, redact_secrets=True)
```

And a test suite with fake secrets:

- API key
- SSH password
- bearer token
- config file contents
- env vars

Then assert no `ToolResult.output`, `Event.output`, or SSE event leaks secrets.

---

# L. Capability registry, actions, tools, permissions

## L1. Unified tool registry is one of the best decisions

**Status:** Excellent  
**Priority:** Keep

The `ToolRegistry` unifies actions, utility tools, builtins, and MCP/OpenAPI tools. The UI sees `ui_exposed`; agents see `agent_exposed` filtered by allowlist/core settings.

This prevents the classic divergence where UI actions and AI tools become two separate systems with different validation/security behavior.

### Recommendation

Preserve this invariant:

```text
Every privileged operation must go through ActionService.invoke().
No router, agent, automation, or integration should execute a privileged operation directly.
```

Add a code search check or architectural test if you can.

---

## L2. Permission policy is simple and good

**Status:** Good  
**Priority:** Keep

The `decide()` model is understandable:

- deny forbidden shell unless allowed/full
- readonly denies non-low-risk actions
- confirm if tool forces confirm or risk high
- medium risk requires confirm except higher privilege
- low risk allows

### Recommendation

Add table-driven tests for every combination:

```py
@pytest.mark.parametrize("risk,confirm,privilege,interactive,expected", [...])
def test_decide(...): ...
```

Also test `run_shell` specifically.

### Possible future improvement

Add a `mutates: bool` or `side_effect: Literal["none","local","remote","destructive"]` to `ToolSpec`. Risk is about approval. Side-effect class is about retry, audit, and display.

Example:

```py
class ToolSpec(BaseModel):
    risk: Risk
    side_effect: SideEffect = SideEffect.NONE
```

This would help retry safety, tool filtering, and UI warnings.

---

## L3. Confirmation token design is acceptable for single-user, but document the threat model

**Status:** Acceptable with docs  
**Priority:** P1/P2

In-memory confirm tokens are not CSRF protection. The code correctly says this. They are a two-step UX gate.

### Recommendation

Write a short `SECURITY.md` or `docs/SECURITY_MODEL.md`:

```text
This is a single-user tailnet dashboard.
Trust boundary: authenticated network/tailnet + local browser.
No multi-user auth is implemented.
Confirm tokens are UX/action guards, not authentication.
Command execution must be disabled unless the operator accepts local RCE risk.
```

Then add checklist items:

- debug disabled by default
- shell disabled by default unless explicitly enabled
- secrets masked on API reads
- no raw secrets in Event/output logs
- OpenAPI/MCP tools default risk high or configurable
- external URL/crawl tools considered SSRF-like and constrained where possible

This is where OWASP thinking helps: not because this must become enterprise security theater, but because the dangerous assumptions should be written down before they become invisible.

---

# M. FastAPI app lifecycle and backend services

## M1. Lifespan resource wiring is good

**Status:** Good  
**Priority:** Keep

`main.py` uses an async lifespan context manager, initializes settings, services, DB, clients, registries, integrations, memory backup, and then cleans up clients/tasks on shutdown.

That matches current FastAPI guidance for app-wide resource lifecycle.

### What is good

- Resources are created before serving requests.
- Shared clients are closed on shutdown.
- Memory sweep task is cancelled cleanly.
- Integrations discover into registry at startup.
- Dirty integrations are rediscovered at turn boundaries, not mid-loop.

### Risk

The lifespan function is long. It is coherent, but it has many ordering dependencies.

### Recommendation

Split setup into named functions:

```py
async def setup_core(app): ...
async def setup_integrations(app, deps): ...
async def setup_agent_runtime(app, deps): ...
async def setup_memory(app, deps): ...
async def shutdown_resources(app): ...
```

Keep them in `main.py` or `bootstrap.py`. This makes ordering explicit and easier to test.

---

## M2. `app.state` is pragmatic but can become global soup

**Status:** Acceptable now  
**Priority:** P2

Using `app.state` for shared services is common and fine for a small app. But the app now has many state fields.

### Recommendation

Bundle related state into containers:

```py
@dataclass
class RuntimeState:
    settings: Settings
    deps: Deps
    actions: ActionService
    threads: ThreadRepo
    messages: MessageRepo
    integrations: IntegrationRuntime
```

Then attach `app.state.runtime = RuntimeState(...)`.

No need to rewrite now. Do this when `app.state` access starts feeling like a junk drawer with network privileges.

---

# N. Config, secrets, and settings

## N1. Hybrid config/secrets model is reasonable

**Status:** Good with caveats  
**Priority:** Keep + test

The project uses `config.yaml` as the UI-managed source of truth, with `.env`/environment overrides for bootstrap/scalar secrets. That is practical because repeated structured secrets do not fit cleanly into flat env vars, and the UI needs to edit config.

### What is good

- `config.yaml` is gitignored.
- secrets are masked on API read.
- env overrides win.
- settings are typed with Pydantic.
- YAML writer preserves formatting/comments via `ruamel.yaml`.

### Risks

- “Secret hint” matching by substring can miss weird names or over-mask innocent fields.
- Config editors can accidentally round-trip masked secrets incorrectly unless unmasking logic is perfect.
- MCP/OpenAPI headers/env can contain secrets with arbitrary names.

### Recommendations

1. Add tests for `mask_secrets`, `unmask_secrets`, and config patching.
2. Add explicit secret field metadata where possible instead of relying only on name hints.
3. For arbitrary maps like headers/env, allow user-marked secret fields:

```yaml
headers:
  Authorization: "Bearer ..."
secret_fields:
  - headers.Authorization
```

4. Add a config export mode that redacts everything secret-like.

---

## N2. Settings API should validate unknown extras by domain

**Status:** Mixed  
**Priority:** P2

Some models use `extra="allow"` for forward-compatible config round-tripping. That is fine. But permissive config can hide typos.

### Recommendation

For UI-managed fields, validate strictly. For future/extension blocks, allow extras.

Pattern:

```py
class AgentCfg(BaseModel):
    model_config = {"extra": "allow"}  # okay for future agent knobs
```

But for sensitive blocks like shell/integrations, be stricter unless there is a reason.

Add a Conf warning for unknown config keys if you parse them.

---

# O. Persistence and SQLite

## O1. SQLite + WAL + single write lock is right for this scale

**Status:** Good  
**Priority:** Keep

For a single-user homelab dashboard, SQLite is the right database. WAL mode plus serialized writes is a sane async design.

### What is good

- WAL enabled.
- foreign keys enabled.
- migrations are explicit and append-only.
- write lock prevents `SQLITE_BUSY` under async fan-out.
- FTS5 index supports session search.

### Risks

- WAL can grow if checkpoints starve.
- One connection + one write lock is fine now but may bottleneck if subagents/tools write heavily.
- JSON `parts` is flexible but weakly queryable outside the FTS triggers.

### Recommendations

1. Add a periodic lightweight checkpoint or expose a maintenance endpoint if WAL growth becomes visible.
2. Add tests for migrations from empty DB and from each version.
3. Add backup/export command for `ctrlb.db`, especially because it holds chat and events.
4. Consider `PRAGMA busy_timeout` even with single-process lock, for safety if another process opens DB.

---

## O2. Message-parts model is correct

**Status:** Good  
**Priority:** Keep

`Message.parts` as a discriminated union is the right substrate for this chat:

- text
- reasoning
- tool_call
- tool_result
- error
- future question/plan/message-part variants

This is much better than flat `content` plus random side tables.

### Recommendation

Add versioning for part schemas before they become numerous:

```py
class Message(BaseModel):
    schema_version: int = 1
```

Or include migration logic in repos when loading unknown/old parts.

Not urgent, but useful if you keep evolving message parts.

---

# P. Fleet/services/events

## P1. Fleet polling + SSE invalidation is balanced

**Status:** Good  
**Priority:** Keep

The project keeps hosts/services polling at server-provided cadence and also invalidates on backend events. That is a good hybrid: polling gives liveness even without events; SSE gives convergence after actions.

### What is good

- Hosts and services are small, so polling is acceptable.
- `useFleetCycle` pauses carousel off-tab while keeping data polling alive.
- Event stream invalidates live caches and reconciles all caches after reconnect.

### Risk

The global query-cache observer marks connection reconnecting if **any** query is in error state. That can over-report connection trouble if one optional endpoint fails while core backend is fine.

### Recommendation

Classify query errors:

- core reachability queries: health/hosts/services/events
- optional feature queries: voice, integrations, agents, skills

Only core query errors should set global connection to reconnecting. Optional feature failures should show local warnings.

Otherwise a broken SearXNG status query could make the whole app look disconnected. Drama queen behavior, basically.

---

## P2. EventSource reconnect logic is good

**Status:** Good  
**Priority:** Keep

The code handles a practical browser failure: EventSource does not always keep retrying if it transitions to CLOSED after backend/proxy failure. The manual exponential backoff reconnect is justified.

### Recommendation

Add tests with mocked EventSource:

- open → connected
- error while CONNECTING → no manual reconnect
- error while CLOSED → closes and schedules reconnect
- successful reconnect → invalidates caches + reloads chat

This logic is important enough to protect.

---

# Q. Performance and rendering

## Q1. Current performance posture is thoughtful

**Status:** Good  
**Priority:** Keep measuring

The project already has a UI audit and many shipped improvements. Important good choices:

- lazy Conf only, not Fleet/Agent
- memoized settled bubbles
- sliced external stores
- idle prefetch
- app viewport CSS var for mobile keyboard
- ResizeObserver for appbar/composer measurements
- event-stream invalidation instead of polling everything blindly

### Main future risk

Themes will add animation and canvas work. Cosmos and frontier can easily become “looks amazing, murders phone battery.”

### Recommendations

1. Add a `perf: lite` contract per theme.
2. Pause all rAF loops when inactive/hidden/reduced-motion.
3. Add a test helper to detect duplicate animation loops in development.
4. Keep React Compiler deferred until measured need. Do not enable it as magic dust.
5. Add a bundle budget:

```json
"build:analyze": "vite build && vite-bundle-visualizer"
```

and track:

- initial JS gzip
- active theme chunk sizes
- CSS per theme
- asset sizes

---

## Q2. TanStack Query pausing must be done carefully

**Status:** Needs policy  
**Priority:** P2

The UI audit says inactive heavy tab queries should pause. That is good, but TanStack Query's `enabled: false` ignores invalidation/refetches while disabled. Your reconnect logic says disabled tab queries become stale and refetch when active. Make that explicit.

### Recommendation

Create a helper:

```ts
export function useScopedQuery(tab, options) {
  const active = useTabActive(tab);
  return useQuery({
    ...options,
    enabled: active && (options.enabled ?? true),
    refetchOnMount: "always",
  });
}
```

Then use it for Conf/settings/integrations, not hosts/services.

### Important

Do not pause hosts/services. Fleet liveness is core dashboard data and cheap enough.

---

# R. Accessibility and mobile ergonomics

## R1. Accessibility has good signs, but needs systematic tests

**Status:** Partial  
**Priority:** P1

The code uses aria labels, `aria-expanded`, `role=tabpanel`, menu roles, and button labels in several places. That is good.

### Gaps

- Theme switching visual changes need focus retention tests.
- `details/summary` controls are convenient but can be inconsistent for custom keyboard behavior.
- Floating overlays/sheets need focus management.
- Cosmos bottom sheet and NavMenu should be tested with keyboard and screen-reader-ish queries.

### Recommendation

Add Playwright + axe tests per theme:

```ts
for (const theme of ["vapor", "minimal", "cosmos"]) {
  test(`${theme} has no serious axe violations`, async ({ page }) => {
    await setTheme(page, theme);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}
```

Also add interaction tests:

- composer enter/shift-enter
- confirm bubble execute/dismiss buttons
- question bubble input
- plan step cycling
- NavMenu keyboard/outside close
- mini-player close not hidden behind nav
- Android-ish viewport resize around composer

---

## R2. Mobile viewport handling is a strong point

**Status:** Good  
**Priority:** Keep

Using `window.visualViewport.height` to set `--app-h` is the right move for mobile keyboard behavior. This is one of those tiny things that separates “works on desktop demo” from “usable on a real phone in the kitchen while swearing at a server.”

### Recommendation

Add a Playwright mobile viewport test or at least a manual checklist:

- composer visible with keyboard
- last chat message scrolls above composer
- `--composer-h` updates when textarea grows
- no content hidden behind bottom nav
- bottom sheet + composer interaction works

---

# S. Security and trust boundaries

## S1. The app needs a written security model

**Status:** Needs docs/tests  
**Priority:** P1

The code includes dangerous features by design:

- shell execution
- SSH service control
- MCP tools
- OpenAPI tool servers
- web search/crawl tools
- memory and skill file writes
- agent-driven actions

The code has meaningful gates. But the assumptions need to be explicit.

### Recommended `docs/SECURITY_MODEL.md`

Sections:

1. Deployment assumptions: single user, tailnet/LAN, HTTPS through Tailscale Serve.
2. No multi-user auth model.
3. Secrets model: config YAML + env overrides + masking limits.
4. Shell execution: disabled by default; enabling means local RCE by dashboard user.
5. Agent privileges: readonly/confirm/auto_low/full.
6. Confirmation tokens: UX gate, not auth/CSRF defense.
7. External tools: MCP/OpenAPI/web/crawl risks.
8. Audit trail: every privileged action emits Event.
9. Safe defaults checklist.
10. Incident recovery: disable shell, disable agent_exec, remove MCP/OpenAPI servers, rotate secrets.

### P1 tests

- shell disabled returns 403
- agent cannot call shell unless enabled/full policy allows
- medium/high risk action requires confirm under default privilege
- confirm token wrong args fails
- confirm token single-use
- expired token fails gracefully
- secrets do not appear in settings response or event output

---

## S2. Origin/CSRF assumptions should be documented

**Status:** Needs clarity  
**Priority:** P2

Because the app is single-origin and likely tailnet-only, you may not need full auth. But if it is reachable from a browser, origin risks still exist if another site can cause requests from the user's browser.

### Recommendation

At minimum:

- Set `SameSite` if cookies ever appear.
- Require JSON `Content-Type` for mutating endpoints.
- Consider checking `Origin`/`Host` headers for mutating endpoints if exposed beyond localhost/tailnet.
- Keep CORS disabled unless explicitly needed.
- Keep Tailscale Serve/auth boundaries documented.

Do not build enterprise auth unless needed. But do not pretend browser security is fairy dust either.

---

# T. Testing and quality gates

## T1. Add lint/type/test gates

**Status:** Missing/unclear  
**Priority:** P1

The frontend package has scripts for build, typecheck, unit tests, and e2e. It does not show lint/format scripts in `package.json`. The backend pyproject shows dependencies but not obvious ruff/pyright/pytest config.

### Recommendation

Add frontend:

```json
"lint": "eslint .",
"format:check": "prettier --check ."
```

Add backend:

```toml
[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "ruff", "pyright"]
```

Add CI or local `check-all`:

```bash
frontend: npm run typecheck && npm run test && npm run build && npm run test:e2e
backend: ruff check . && pyright && pytest
```

If this is personal and CI feels annoying, make a local script. The point is not bureaucracy; the point is not letting a coding agent confidently punt a grenade into your repo.

---

## T2. Highest-value test additions

Priority order:

1. Theme contract tests.
2. Theme switch cleanup tests.
3. Permission policy table tests.
4. Confirm-token lifecycle tests.
5. Chat SSE reducer event tests.
6. Retry-risk behavior tests.
7. App lifespan smoke test with mocked integrations.
8. Playwright theme smoke/a11y tests.
9. Cosmos animation lifecycle tests.
10. Config masking/unmasking round-trip tests.

---

# U. Documentation and comments

## U1. Docs are valuable but too historical

**Status:** Mixed  
**Priority:** P2

The docs are excellent for orientation. The handoff file gives state, phases, decisions, and next steps. The architecture docs explain why things exist.

But many comments and docs now carry stale phase claims: “T0 vapor only,” “future M2,” “hideAppbar,” etc. This can confuse the next agent or future you.

### Recommendation

Split docs into:

1. **Current architecture docs** — evergreen, no phase diary.
2. **Decision records** — dated history and rationale.
3. **Handoff/status** — current work queue, allowed to be messy.
4. **Issue backlog** — specific, actionable tasks.

### Code comment rule

Keep comments that explain:

- browser quirks
- React lifecycle quirks
- security decisions
- non-obvious invariants
- why not to refactor something

Delete/shorten comments that say:

- what the next line plainly does
- old phase history
- stale TODOs
- implementation diary entries

The current comments are not bad. They are just approaching “archaeological layer cake.”

---

# V. Alternative architecture options

## V1. Keep current hybrid theme architecture — recommended

```text
ThemeDef owns Root + palette + settings + styles + assets.
DefaultRoot provides reusable Kit layout.
Bespoke themes compose DefaultRoot and override signature surfaces.
Headless controllers own behavior.
```

This is the recommended path.

### Best for

- vapor fidelity
- minimal/phosphor reuse
- cosmos/frontier structural freedom
- long-term extension

### Costs

- more discipline required
- contract tests needed
- some duplication between bespoke roots

Verdict: **keep**.

---

## V2. Move to a router-style app with one route per tab/theme

Example:

```text
/theme/vapor/fleet
/theme/cosmos/agent
```

### Pros

- URL state
- easier deep links
- browser navigation support

### Cons

- heavy refactor
- not needed for a mobile PWA dashboard
- complicates current tab shell

Verdict: **not now**.

---

## V3. State machine library for agent/chat UI

Use XState or a small custom state machine for chat turn lifecycle.

### Pros

- explicit states/transitions
- easier retry/confirm/question handling
- strong tests

### Cons

- dependency/complexity
- current reducer is understandable

Verdict: **maybe later**, especially if chat store keeps growing.

---

## V4. Schema validation shared frontend/backend

Use generated schemas from Pydantic/OpenAPI or a TS runtime validator.

### Pros

- less SSE payload risk
- fewer cast bugs
- clearer contracts

### Cons

- generation pipeline overhead
- more code

Verdict: **hand-written guards now, generated schemas later if API grows**.

---

## V5. Move theme system into CSS cascade layers only

### Pros

- less React code
- simple switching

### Cons

- fails bespoke themes
- encourages CSS hacks for structural changes

Verdict: **reject**.

---

# W. Prioritized implementation plan

## Sprint 1 — Contract and safety net

1. Add `ThemeDef.tabs?: TabDef[]`; update `tabsFor()` to read from registry.
2. Add theme contract tests for palettes/settings/loaders/tabs.
3. Add body/html cleanup tests for theme switch chains.
4. Add frontend event payload guards for critical SSE events.
5. Add permission policy table tests.

## Sprint 2 — Root cleanup and UX hardening

1. Extract shared root hooks from `VaporRoot` and `DefaultRoot`.
2. Add confirm-token stale/expired UI handling.
3. Make retry risk-aware.
4. Persist/session-log privilege changes or include privilege in action events.
5. Move `fillComposer` toward store-first draft updates.

## Sprint 3 — Security/documentation

1. Write `docs/SECURITY_MODEL.md`.
2. Add config secret masking/unmasking tests.
3. Add shell disabled/enabled tests.
4. Add MCP/OpenAPI risk/default behavior tests.
5. Add output redaction/truncation tests.

## Sprint 4 — Theme growth

1. Implement `SheetComposer` styling.
2. Finish vapor-minimal nav or hide minimal option for vapor.
3. Add phosphor using minimal as the template.
4. Add `perf: lite` behavior to cosmos.
5. Add Playwright smoke/a11y tests per active theme.

---

# X. Suggested issue backlog

## P1 issues

### 1. Add theme contract tests

**Why:** Prevent broken themes from compiling but violating runtime assumptions.  
**Acceptance:** Every registered theme validates palette defaults, settings defaults, loaders, tab definitions, and render smoke.

### 2. Move theme tabs into `ThemeDef`

**Why:** Keeps theme definition self-contained.  
**Acceptance:** `tabsFor(theme)` reads `registry[theme]?.tabs ?? STANDARD_TABS`.

### 3. Sanitize per-theme settings

**Why:** Persisted/synced settings can go stale or invalid.  
**Acceptance:** Invalid setting values fall back to defaults; unknown legacy keys do not affect UI.

### 4. Add stale confirm-token recovery

**Why:** Page reload/backend restart/token expiry can leave unusable confirm bubbles.  
**Acceptance:** Expired/missing token surfaces clear UI and lets owner dismiss or regenerate.

### 5. Make retry risk-aware

**Why:** Retrying a failed turn can re-run side effects.  
**Acceptance:** Risky/mutating failed turns do not one-click retry; request is copied/drafted instead.

### 6. Add SSE event validation

**Why:** Runtime payload shape is not guaranteed by TS.  
**Acceptance:** Critical event handlers validate required fields and fail visibly/log safely.

### 7. Write security model

**Why:** Shell/MCP/OpenAPI/agent tools need explicit threat assumptions.  
**Acceptance:** `docs/SECURITY_MODEL.md` defines trust boundaries and safe defaults.

## P2 issues

### 8. Extract shared root behavior hooks

**Why:** Avoid drift between `VaporRoot` and `DefaultRoot`.  
**Acceptance:** Lazy Conf latch, appbar height, scroll reset, and Conf prefetch use shared hooks.

### 9. Split `AgentTab.tsx` bubble components

**Why:** Easier future edits and tests.  
**Acceptance:** No behavior change; bubble components live under `tabs/agent/`.

### 10. Add query scope helper

**Why:** Inactive-tab pausing needs consistent semantics.  
**Acceptance:** Conf-only queries use `useScopedQuery` with correct resume/refetch behavior.

### 11. Add Playwright/axe theme smoke tests

**Why:** Themes are UI-heavy and easy to break.  
**Acceptance:** Each registered theme passes basic nav/render/a11y smoke.

### 12. Add output redaction/truncation tests

**Why:** Tool outputs can leak secrets.  
**Acceptance:** Fake secrets never appear in event/tool outputs.

---

# Y. Agent/coding-agent instructions for this repo

Use this as an instruction block for future agents working on `dashboard_v2`:

```md
## ctrl-b dashboard_v2 coding rules

1. Keep `App.tsx` thin. It may mount global engines and the active theme root only.
2. Do not branch on `theme` inside `DefaultRoot`. Themes customize via ThemeDef, Root composition, CSS tokens, Fleet slot, Composer variant, and composer slots.
3. Vapor is frozen visually. Do not force it into Kit. Shared behavior may be extracted into hooks only if DOM/CSS behavior stays unchanged.
4. New themes must be registered through `ThemeDef` and pass theme contract tests.
5. Theme-specific body/html attrs must be set in `useLayoutEffect` and cleaned on unmount.
6. Every privileged operation must go through `ActionService.invoke()`.
7. Do not execute shell/service/host operations directly from routers or agent code.
8. Chat reducer updates must preserve identity of non-changing messages during token streaming.
9. Do not add object-returning `useUISlice` / `useChatSlice` selectors unless a stable/equality-aware selector hook exists.
10. Do not add new tool output paths without redaction/truncation tests.
11. Prefer small headless hooks/controllers for behavior and theme components for markup.
12. If you add a setting, add migration/sanitization and contract tests.
13. If you add a confirmable/risky action, add permission-policy tests and UI confirm behavior tests.
14. If you add an animation loop, pause it when inactive, hidden, reduced-motion, or perf-lite.
```

---

# Z. Final assessment

This is a strong personal-dashboard architecture. The code is not “simple,” but the complexity mostly exists because the product is genuinely complex: multiple themes, live fleet data, chat, agent tools, confirmation gates, shell execution, integrations, memory, settings, and mobile-first UI.

The design-system direction is correct. The danger is not that you have too many helpers. The danger is that the design system currently relies too much on discipline and documentation. The next step is to make the architecture executable through tests and contracts.

The most important fixes are not glamorous:

- theme contract tests
- stale token handling
- risk-aware retry
- settings sanitization
- SSE payload guards
- shared root hooks
- security model docs

Do those, and the codebase becomes much harder for a coding agent to accidentally turn into haunted spaghetti. Still spaghetti-adjacent in places, because all software eventually becomes pasta if left unattended, but this one at least has a decent sauce.

---

## Source map

### Repository files inspected

- `dashboard_v2/docs/HANDOFF.md`
- `dashboard_v2/docs/ARCHITECTURE.md`
- `dashboard_v2/docs/DESIGN.md`
- `dashboard_v2/docs/THEME_ENGINE.md`
- `dashboard_v2/docs/UI_AUDIT.md`
- `dashboard_v2/frontend/package.json`
- `dashboard_v2/frontend/src/App.tsx`
- `dashboard_v2/frontend/src/theme-engine/types.ts`
- `dashboard_v2/frontend/src/theme-engine/registry.ts`
- `dashboard_v2/frontend/src/theme-engine/settings.ts`
- `dashboard_v2/frontend/src/theme-engine/resolve.ts`
- `dashboard_v2/frontend/src/theme-engine/lazyRoot.ts`
- `dashboard_v2/frontend/src/theme-engine/switchTheme.ts`
- `dashboard_v2/frontend/src/theme-engine/ThemeProvider.tsx`
- `dashboard_v2/frontend/src/theme-engine/tabs.ts`
- `dashboard_v2/frontend/src/theme-engine/kit/DefaultRoot.tsx`
- `dashboard_v2/frontend/src/theme-engine/kit/composer/Composer.tsx`
- `dashboard_v2/frontend/src/themes/vapor/VaporRoot.tsx`
- `dashboard_v2/frontend/src/themes/minimal/index.tsx`
- `dashboard_v2/frontend/src/themes/minimal/MinimalRoot.tsx`
- `dashboard_v2/frontend/src/themes/cosmos/index.tsx`
- `dashboard_v2/frontend/src/themes/cosmos/CosmosRoot.tsx`
- `dashboard_v2/frontend/src/store/createStore.ts`
- `dashboard_v2/frontend/src/store/ui.ts`
- `dashboard_v2/frontend/src/store/chat.ts`
- `dashboard_v2/frontend/src/hooks/useSections.ts`
- `dashboard_v2/frontend/src/hooks/useComposer.ts`
- `dashboard_v2/frontend/src/hooks/useAgentChat.ts`
- `dashboard_v2/frontend/src/hooks/useFleet.ts`
- `dashboard_v2/frontend/src/hooks/useServices.ts`
- `dashboard_v2/frontend/src/hooks/useEvents.ts`
- `dashboard_v2/frontend/src/lib/composer.ts`
- `dashboard_v2/frontend/src/tabs/AgentTab.tsx`
- `dashboard_v2/backend/pyproject.toml`
- `dashboard_v2/backend/app/main.py`
- `dashboard_v2/backend/app/config.py`
- `dashboard_v2/backend/app/db.py`
- `dashboard_v2/backend/app/core/tool.py`
- `dashboard_v2/backend/app/services/action_service.py`
- `dashboard_v2/backend/app/services/agent/session.py`
- `dashboard_v2/backend/app/api/agent.py`
- `dashboard_v2/backend/app/domain/conversation.py`

### External docs consulted

- React `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
- React `lazy`: https://react.dev/reference/react/lazy
- Vite dynamic imports / CSS code splitting: https://vite.dev/guide/features.html
- TanStack Query disabling/pausing queries: https://tanstack.com/query/latest/docs/framework/react/guides/disabling-queries
- FastAPI lifespan events: https://fastapi.tiangolo.com/advanced/events/
- FastAPI dependencies: https://fastapi.tiangolo.com/tutorial/dependencies/
- Pydantic models: https://docs.pydantic.dev/latest/concepts/models/
- MDN View Transition API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- MDN Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- SQLite WAL: https://www.sqlite.org/wal.html
- SQLite FTS5: https://www.sqlite.org/fts5.html
- Playwright assertions: https://playwright.dev/docs/test-assertions
- `@axe-core/playwright`: https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md
- OWASP Top 10: https://owasp.org/www-project-top-ten/
