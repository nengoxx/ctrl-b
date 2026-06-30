# CTRL-B Theme Engine Deep Audit Review 2026-06-29

Status: **current refined audit**
Scope: Deepened review of the prior coding-agent theme-engine/design-system audit against fresh CTRL/B code at `8780e99`.
Repo safety: **read-only source inspection only**. No CTRL/B source files were edited.
Vault note author: Maia.

## Executive verdict

The prior audit remains **directionally correct and high-signal**, but this refined pass makes the issues sharper:

1. **Do not redesign the theme engine.** The core model is strong: registry-driven theme descriptors, theme-owned roots, a reusable Kit scaffold, tokenized reskins, lazy root/style loading, and headless feature controllers.
2. **The biggest real risk is planned invariants remaining prose.** Several safety guarantees exist in docs and comments, but the code still relies on casts, conventions, and future contributors remembering the rules.
3. **Start with validation and transactional state before visual expansion.** `resolveThemeSetting`, registered-theme/mode guards, and “persist after successful switch” are the next highest-ROI fixes because they prevent corrupt persisted/synced state from selecting wrong components or poisoning cross-device appearance.
4. **Composer Surface is specced, not implemented.** The repo’s `COMPOSER_SURFACE_PLAN.md` is detailed and good; source code still has only the pre-Surface seams/stubs.
5. **Guardrails should be cheap and targeted first.** Prefer Vitest/node contract tests and tiny AST/grep guards before a large lint/tooling migration.

Bottom line for Claude Code: **make the documented contracts executable in behavior-preserving slices; do not invent a new architecture.**

## Baseline and method

Baseline verified before editing this vault note:

```text
CTRL/B repo: /home/emma/github/ctrl-b
Branch: main...origin/main
HEAD: 8780e99 docs(dashboard_v2): bake the reorg kickoff into HANDOFF top (for 'continue with the handoff')
Vault repo: /home/emma/Documents/Maia
Prior note: CTRL-B Theme Engine Coding-Agent Audit Comparison 2026-06-29.md
```

Systematic pass performed:

1. Read repo/vault instructions (`AGENTS.md`) and confirmed read-only source scope.
2. Mapped relevant theme engine, Kit, root, appearance, and test files.
3. Checked each prior audit claim against source lines and repo planning docs.
4. Ran read-only CSS/token/keyframe analyzer over frontend CSS files.
5. Checked current external docs/search results for Storybook React-Vite/addon-themes and W3C/DTCG design-token context.
6. Rewrote this note with: current behavior, evidence, risk, recommended fix, and acceptance criteria per issue.

## System map: what exists now

| Layer | Current implementation | Evidence |
|---|---|---|
| Theme IDs | Type union includes built and planned IDs: `vapor|minimal|phosphor|cosmos|frontier|observatory`. | `frontend/src/theme-engine/types.ts:12-14` |
| Built registry | Only `vapor`, `minimal`, and `cosmos` are registered. | `frontend/src/theme-engine/registry.ts:10-14` |
| Theme root resolution | `rootFor(theme)` falls back to vapor when `registry[theme]` is missing. | `frontend/src/theme-engine/resolve.ts:10-16` |
| App host | App renders active root through Suspense; cold non-default lazy root uses `fallback={null}`. | `frontend/src/App.tsx:28-38` |
| Style/font loading | `ThemeProvider` calls `ensureThemeLoaded(theme)` in an effect after render. | `frontend/src/theme-engine/ThemeProvider.tsx:15-26` |
| Switch path | `switchTheme()` loads styles/fonts/root first, then applies UI in `flushSync`/View Transition. On load error it toasts and returns. | `frontend/src/theme-engine/switchTheme.ts:40-98` |
| Appearance picker | `ConfTab` derives theme list, palette axes, and settings from registry. | `frontend/src/tabs/ConfTab.tsx:216-230` |
| Per-theme settings | `useThemeSetting()` returns raw override via cast, else default. | `frontend/src/theme-engine/settings.ts:20-29` |
| Current reskin root | Minimal uses `DefaultRoot`; its `density` setting writes `body[data-density]`. | `frontend/src/themes/minimal/MinimalRoot.tsx:15-29` |
| Current bespoke+Kit root | Cosmos overlays starfield and passes `CosmosFleet` into `DefaultRoot`. | `frontend/src/themes/cosmos/CosmosRoot.tsx:12-19` |
| Vapor bespoke root | Vapor renders old composer/tabbar/components directly, with theme-owned attrs/classes. | `frontend/src/themes/vapor/VaporRoot.tsx:38-139` |
| Composer variant seam | `DefaultRoot` accepts a `Composer` prop, defaulting to `KitComposer`; `SheetComposer` is a stub delegating to `KitComposer`. | `DefaultRoot.tsx:43-56,144`; `SheetComposer.tsx:4-15` |
| Tests | There are real tests, including `settings.test.ts` and `useAppearance.test.ts`, but no broad theme-contract test. | `frontend/tests/theme-engine/settings.test.ts`; `frontend/tests/hooks/useAppearance.test.ts` |

## Issue 1 — Per-theme settings are cast, not validated

### Current behavior

`useThemeSetting()` reads `ui.themeSettings[themeId]?.[key]` and returns it as `T` if present:

```ts
const override = useUISlice((s) => s.themeSettings[themeId]?.[key]);
if (override !== undefined) return override as T;
return registry[themeId]?.settings?.[key]?.default as unknown as T;
```

Evidence: `frontend/src/theme-engine/settings.ts:20-29`.

Theme schemas already contain enough information to validate:

- switch settings require boolean defaults/values (`types.ts:71-72`);
- seg settings require string values from `options[].val` (`types.ts:73-79`);
- theme settings live in an open map by design (`types.ts:81-86`).

Current tests prove defaults and valid overrides only:

- default fallback: `settings.test.ts:14-20`;
- valid override: `settings.test.ts:22-26`;
- unknown key without override: `settings.test.ts:28-31`.

### Why this matters

Today many settings are cosmetic, so a bad value often just produces a wrong attr or downstream local fallback. But the Composer Surface plan explicitly uses a setting to choose which component renders. Once a persisted/synced setting can select a component variant, a blind cast becomes load-bearing.

Concrete examples:

- `MinimalRoot` writes `document.body.dataset.density = density`; a stale value like `"tiny"` would leak to DOM (`MinimalRoot.tsx:17-26`).
- `CosmosFleet` casts/derives several settings: `orbitStyle`, `motionSpeed`, `liveness`, `serviceCue` (`CosmosFleet.tsx:88-93`). It has local fallback for `serviceCue`, but not a central guarantee.
- Future `composer` setting must not allow a stale/unknown variant ID to resolve an undeclared component.

### Recommended fix

Implement and export `resolveThemeSetting(themeId, key, raw)` in `theme-engine/settings.ts`, then route `useThemeSetting()` through it.

Rules:

```ts
unknown key          -> undefined
switch + boolean raw -> raw
switch + bad raw     -> spec.default
seg + raw in options -> raw
seg + bad raw        -> spec.default
missing raw          -> spec.default
```

### Acceptance criteria

- [ ] `resolveThemeSetting()` pure unit tests for valid values, missing raw, wrong primitive type, stale seg values, and unknown key.
- [ ] Existing behavior for valid settings remains unchanged.
- [ ] `useThemeSetting()` no longer returns unchecked overrides.
- [ ] Future composer setting cannot select a variant unless the active theme declares that option.

Priority: **P0 before Composer Surface A1**.

## Issue 2 — Appearance hydration casts server strings into `ThemeId`/`Mode`

### Current behavior

`AppearanceDoc` carries raw strings from the server:

- `theme: string`
- `mode: string`
- `accent: string`

Evidence: `frontend/src/hooks/useAppearance.ts:23-32`.

`reconcileAppearance()` returns:

```ts
theme: server.theme as ThemeId,
mode: server.mode as Mode,
accent: server.accent,
motion: motion as Motion,
perf: perf as Perf,
```

Evidence: `frontend/src/hooks/useAppearance.ts:95-102`.

This matters because `ThemeId` includes planned IDs (`phosphor`, `frontier`, `observatory`) that are not registered yet (`types.ts:12-14`; `registry.ts:10-14`).

### Existing mitigating behavior

`rootFor(theme)` falls back to vapor if `registry[theme]` is missing (`resolve.ts:10-16`). But `setUI()` still writes the invalid/planned theme into UI state and onto `html[data-skin]` (`store/ui.ts:193-210`). That can create mixed state: root fallback is vapor, while global attrs claim another skin.

`ensureThemeLoaded(next)` also silently resolves if `registry[next]` is undefined because `def?.loadStyles()` becomes `Promise.resolve()` (`switchTheme.ts:40-53`). That means “registeredness” is not enforced by the load path.

### Risk

A stale server/local value can poison state even if the app visually falls back. Potential symptoms:

- `html[data-skin=frontier]` while rendering vapor root;
- palette/mode attrs for a theme that is not built;
- repeated reconcile/switch attempts from cross-device sync;
- confusing Appearance picker because `registry[theme]` is undefined and options arrays become empty (`ConfTab.tsx:220-230`).

### Recommended fix

Add guards before applying server appearance:

- `isRegisteredThemeId(value): value is ThemeId` checks `registry[value] != null`.
- `isMode(value): value is Mode` checks `dark|light`.
- `isModeForTheme(theme, mode)` validates the mode is declared by the registered theme, or falls back to that theme’s default mode.
- `isAccentForTheme(theme, accent)` validates accent against `palettes.accents[].id`, or falls back to default accent.

Bad server values should not overwrite local state. Prefer fallback to current local for invalid synced fields; only apply valid deltas.

### Acceptance criteria

- [ ] Unit tests in `useAppearance.test.ts` for unknown/unregistered theme string.
- [ ] Tests for planned-but-unregistered IDs (`frontier`) specifically.
- [ ] Tests for invalid mode/accent against the target theme’s declared palette.
- [ ] Invalid server values do not set `html[data-skin]` to an unregistered theme.

Priority: **P0 / sibling of settings validation**.

## Issue 3 — Theme switching persistence is non-transactional

### Current behavior

`ConfTab.pickTheme()` starts the async switch, then immediately persists the new appearance:

```ts
void switchTheme(id, target);
saveAppearance.mutate({ ...currentAppearancePatch(), theme: id, ...target });
```

Evidence: `frontend/src/tabs/ConfTab.tsx:238-248`.

`switchTheme()` catches style/font/root load failures, shows a toast, and returns without applying UI (`switchTheme.ts:70-76`). But because `pickTheme()` does not await a success/failure signal, the server can be updated to a theme that the UI did not activate.

### Risk

If a lazy CSS/root chunk fails:

1. UI stays on old theme.
2. Server appearance says new theme.
3. Reload or another device sees the new theme and tries again.
4. User gets a retry/poison loop until server/local appearance is manually changed.

The risk grows as more themes and lazy roots are added.

### Recommended fix

Make `switchTheme()` return a result:

```ts
type SwitchThemeResult = { ok: true } | { ok: false; reason: "load-failed" };
```

Then in `pickTheme()`:

```ts
const result = await switchTheme(id, target);
if (!result.ok) return;
saveAppearance.mutate({ ...currentAppearancePatch(), theme: id, ...target });
```

Alternative: split a lower-level `activateTheme()` that throws on load failure and keep UI toast at caller, but the key invariant is **do not persist until activation succeeds**.

### Acceptance criteria

- [ ] Test/fake `ensureThemeLoaded` failure: no `saveAppearance.mutate()` call.
- [ ] Successful switch still persists the explicit target.
- [ ] Within-theme mode/accent/settings changes keep their current instant behavior.
- [ ] Cross-device `useAppearanceSync()` handles failed remote theme gracefully and does not loop forever.

Priority: **P0/P1 before expanding lazy themes**.

## Issue 4 — Composer Surface is specced, but source still has only seams/stubs

### Current behavior

The code has a variant seam:

- `DefaultRoot` has `Composer?: ComposerVariant`, defaulting to `KitComposer` (`DefaultRoot.tsx:43-56`).
- `DefaultRoot` renders `{showComposer && <Composer {...(composerSlots ?? {})} />}` (`DefaultRoot.tsx:144`).
- `SheetComposer` exists but delegates directly to `KitComposer` (`SheetComposer.tsx:4-15`).

The source does **not** contain concrete Composer Surface pieces searched for in the prior pass:

- `composerVariants`
- `ThemedComposer`
- `composerLayoutSetting`
- `createSurface`

The plan does exist and is strong: `docs/COMPOSER_SURFACE_PLAN.md` specifies A1/A2/A3, including `resolveThemeSetting` first, variant registry, resolver, and behavior-preserving verification (`COMPOSER_SURFACE_PLAN.md:50-172`).

### Risk

Docs may imply the surface is built/hardened when it is not. A coding agent could skip validation or wire visuals first, creating exactly the extensibility/performance footguns the architecture is trying to avoid.

### Recommended fix

Follow `COMPOSER_SURFACE_PLAN.md` literally, but start with validation from Issue 1.

Implementation order:

1. `resolveThemeSetting()` and invalid-value tests.
2. `kit/composer/variants.ts` with stable module-level refs.
3. `kit/composer/setting.ts` with shared `composerLayoutSetting()`.
4. `kit/composer/ThemedComposer.tsx` resolver.
5. `DefaultRoot` uses `ThemedComposer`; preserve `composerSlots`.
6. Only then replace `SheetComposer` stub with real markup/CSS.

### Acceptance criteria

- [ ] No visual diff after A1 mechanism slice; all themes resolve to current `KitComposer`.
- [ ] Vapor untouched; it renders its own `components/Composer.tsx` directly (`VaporRoot.tsx:132`).
- [ ] Cosmos plan slots still work (`CosmosRoot.tsx:18`).
- [ ] Live composer layout swap preserves draft and re-measures `--composer-h`.
- [ ] `SheetComposer` reuses `useComposer()`; no duplicate chat/composer behavior logic.

Priority: **P0/P1 after validation foundation**.

## Issue 5 — Contract tests are too thin for the design-system load they now carry

### Current state

There are frontend tests, including:

- `frontend/tests/theme-engine/settings.test.ts` — basic settings behavior.
- `frontend/tests/hooks/useAppearance.test.ts` — reconcile behavior for normal values.
- Theme-specific tests for cosmos/liveness/orbit/present/service cues.
- Playwright e2e specs under `frontend/e2e`.

But there is no broad `themeContract.test.ts` covering registry, theme defaults, lazy loaders, body attr cleanup, token contract, or no-branch invariants.

### Risk

The architecture is good, but it depends on conventions:

- every registered theme’s default mode/accent must be valid;
- every setting default must match its type/options;
- style/font/root loaders must resolve;
- theme-owned attrs/classes must be cleaned on unmount;
- shared Kit/theme-engine code should not branch on specific theme IDs;
- new theme CSS should not introduce global keyframe collisions.

Without tests, future theme additions can regress these cheaply.

### Recommended guardrail suite

Add a focused contract suite rather than a broad lint migration first.

Suggested files:

1. `frontend/tests/theme-engine/themeContract.test.ts`
   - every `registeredThemes()` entry has matching `id`, `label`, `Root`, `loadStyles`;
   - `palettes.defaultMode` is in `palettes.modes` when modes are declared;
   - `palettes.defaultAccent` is in `palettes.accents`;
   - every setting default has correct type and seg default is in options;
   - `loadStyles`, `loadFonts`, `loadRoot` resolve or are intentionally omitted.
2. `frontend/tests/theme-engine/appearanceValidation.test.ts`
   - invalid server theme/mode/accent handling.
3. `frontend/tests/theme-engine/themeSettingsValidation.test.ts`
   - invalid/stale `themeSettings` values.
4. Small Node test/script for CSS invariants:
   - Kit CSS keyframes start with `kit-`;
   - new theme CSS keyframes start with `<theme>-`;
   - legacy vapor/extras are allowlisted or migrated.
5. Small grep/AST test scoped to shared engine code:
   - no `theme === "vapor"` / `theme === "cosmos"` inside `theme-engine/kit/**` or generic resolvers.

### Nuance: do not ban every theme branch globally

There is an intentional app-level branch in `AgentTab`:

- `const isVapor = useUISlice((s) => s.theme === "vapor");`
- Pinned plan renders only for vapor (`AgentTab.tsx:522-592`).

So the no-theme-branch guard should be scoped to shared Kit/theme-engine/resolver code, not the entire app.

Priority: **P1 after validation; P0 before adding many more themes/surfaces**.

## Issue 6 — Keyframe prefix claim needs correction and enforcement plan

### Read-only analyzer result

CSS scan found 32 keyframes across 9 CSS files.

Clean/newer areas:

- `theme-engine/kit/kit.css`: `kit-fade`, `kit-modal-fade`, `kit-toast-in`, `kit-mp-bar`, `kit-caret-blink`, `kit-dot-bounce`, `kit-tag-pulse`, `kit-navmenu-in`, etc.
- `themes/cosmos/cosmos.css`: `cosmos-pulse`, `cosmos-halo`, `cosmos-moon-spin`.

Legacy/global areas:

- `theme/extras.css`: `mp-bar`, `conn-pulse`, `toast-in`, `modal-fade`, `caret-blink`, `tag-pulse`, `plan-drop-in`, `dot-bounce`.
- `theme/vapor.css`: `spin`, `ttsGlow`, `float`, `sun-stripes-static`, `twinkle`, `gridmove`, `shimmer`, `heartbeat`, `eq`, `brew`, `micrec`.

Important analyzer caveat: it also matched `@keyframes inside` from a comment line in `vapor.css:3`; ignore that false positive.

### Risk

CSS `@keyframes` names are global in practice. New unprefixed animations can collide silently across themes/components even if selectors are scoped.

### Recommended fix

Do **not** blindly fail the current repo on all legacy names. Choose one:

1. **Migration path:** rename vapor/extras keyframes to `vapor-*`/legacy aliases carefully.
2. **Allowlist path:** enforce prefix guard only for:
   - `frontend/src/theme-engine/kit/**` -> `kit-*`;
   - `frontend/src/themes/<theme>/**` -> `<theme>-*`;
   - allowlist existing `theme/vapor.css` and `theme/extras.css` globals until vapor is deliberately modernized.

### Acceptance criteria

- [ ] Guard fails on new unprefixed keyframes in Kit/new theme CSS.
- [ ] Guard does not block current legacy vapor unless migration is part of the same slice.
- [ ] If migrating, update animation-name uses and run visual smoke tests for vapor.

Priority: **P1 guardrail**.

## Issue 7 — Token fallbacks are useful, but can hide incomplete theme contracts

### Current state

Read-only CSS analyzer found:

- `theme-engine/kit/tokens.css` defines 22 base tokens.
- `themes/minimal/tokens.css` defines 24 theme tokens.
- `themes/cosmos/tokens.css` defines 23 theme tokens.
- Kit CSS uses runtime layout vars not in tokens: `--app-h`, `--appbar-h`, `--composer-h`. These are expected runtime-measured variables, not missing theme tokens.

The base Kit tokens are good for resilience: missing theme tokens don’t instantly break the UI.

### Risk

Fallbacks can hide bad design-system state: a partial light theme may render “acceptable but wrong” instead of failing loudly. This is especially relevant for contrast and semantic color roles.

### Recommended fix

Add token contract checks that distinguish:

- **semantic tokens** each non-vapor Kit-consuming theme should provide;
- **base fallbacks** required by Kit;
- **runtime vars** intentionally set by JS/layout (`--app-h`, `--appbar-h`, `--composer-h`).

Also add Playwright/computed-style smoke for light/dark/accent combinations once a second light-capable theme lands.

### Acceptance criteria

- [ ] Contract test lists required semantic Kit tokens.
- [ ] Runtime variables are documented exceptions.
- [ ] Light theme contrast smoke catches invisible/wrong foreground/background pairings.

Priority: **P1/P2**.

## Issue 8 — Cosmos consumes private Kit DOM for layout metrics

### Current behavior

`CosmosFleet` measures live zone by querying Kit DOM directly:

```ts
const appbar = document.querySelector(".kit-appbar");
const composer = document.querySelector(".kit-composer");
```

Evidence: `frontend/src/themes/cosmos/CosmosFleet.tsx:132-159`.

The code is careful: it observes stage/appbar/composer, re-runs when `appbarMode` changes, and gates animation on motion/tab/visibility (`CosmosFleet.tsx:80-112`). So this is not a sloppy implementation.

### Risk

It couples a bespoke theme surface to Kit’s private class names. If a future Composer Surface changes `.kit-composer` markup/classes, Cosmos layout can break even if the public Kit contract was intended to stay stable.

### Recommended fix

During Composer Surface work, expose a formal Kit chrome metrics contract:

- CSS vars are already part of the contract: `--appbar-h`, `--composer-h`.
- Consider `useChromeMetrics()` or a context/ref-based contract if Cosmos truly needs rects, not just heights.
- At minimum, document `.kit-appbar`/`.kit-composer` as public layout hooks if keeping the current approach.

### Acceptance criteria

- [ ] Cosmos no longer hardcodes private class queries, or those class names are explicitly public/tested.
- [ ] Composer layout swap triggers Cosmos re-measure.
- [ ] Host sheet + composer hiding still work (`body[data-sheet=open]` cleanup remains tested).

Priority: **P1 with Composer Surface**.

## Issue 9 — Cold-load non-default theme can temporarily blank

### Current behavior

App renders active root through:

```tsx
<Suspense fallback={null}>
  <ActiveRoot />
</Suspense>
```

Evidence: `frontend/src/App.tsx:32-38`.

`ThemeProvider` ensures active theme styles/fonts in an effect (`ThemeProvider.tsx:15-26`), so a cold load with persisted `minimal` or `cosmos` may briefly show page background / no root until the lazy root resolves.

The code comments explicitly acknowledge this as accepted currently.

### Risk

As bespoke themes get heavier, the blank can become noticeable and feel like jank, especially on mobile/PWA cold starts.

### Recommended fix

Not urgent before validation. When polishing:

- add a minimal themed shell/skeleton fallback keyed off `html[data-skin]`;
- or preload persisted active theme earlier before first React render;
- add root-level error boundary for failed cold lazy root, with fallback to vapor or reload action.

### Acceptance criteria

- [ ] Cold persisted `minimal`/`cosmos` shows skeleton, not blank.
- [ ] Failed lazy root gives recoverable UI.
- [ ] Default vapor remains eager/no regression.

Priority: **P2 unless users notice blanking**.

## Issue 10 — Registry descriptor eager imports are acceptable now, but monitor bundle creep

### Current behavior

`registry.ts` eagerly imports all built descriptors:

```ts
import { cosmos } from "../themes/cosmos";
import { minimal } from "../themes/minimal";
import { vapor } from "../themes/vapor";
```

Evidence: `frontend/src/theme-engine/registry.ts:5-14`.

`cosmos/index.tsx` imports `present` and `loadFonts` at descriptor module load (`themes/cosmos/index.tsx:9-13`). Heavy root/CSS/starfield still lazy-load via `preloadableRoot()` and `loadStyles()` (`themes/cosmos/index.tsx:14-43`).

### Risk

Descriptor-adjacent helpers can creep into the initial bundle as themes grow, even while roots/styles remain lazy.

### Recommendation

Do not optimize prematurely. Add bundle-size awareness later if descriptors start importing heavy data/assets. Keep descriptor modules tiny and avoid importing theme-heavy code except stable pure metadata/presenters.

### Acceptance criteria

- [ ] Future theme descriptors avoid eager large asset imports.
- [ ] Bundle analysis only if startup bundle growth becomes visible.

Priority: **P3 / monitor**.

## Issue 11 — Storybook is useful soon, not first

External check:

- Storybook has first-class React+Vite docs: `https://storybook.js.org/docs/get-started/frameworks/react-vite`.
- Storybook themes addon exposes decorators for rendering components under theme contexts/classes: `https://storybook.js.org/docs/essentials/themes`.
- This aligns with CTRL/B’s `html[data-skin]` / `.kit` theming approach.

Repo triage already says defer Storybook until the next theme / Composer Surface slice (`TRIAGE-2.md:129-140`). I agree.

### Recommended use

Adopt Storybook when there is enough component/design-system surface to justify it:

- Composer Surface variants;
- at least one additional theme or meaningful theme variant matrix;
- visual review for Kit components under `minimal`, `cosmos`, and future themes.

Before that, contract tests are cheaper and more directly protective.

Priority: **P2 after Composer Surface starts producing reusable UI variants**.

## Refined Claude Code handoff

Use this as the coding-agent instruction block.

> Work in `/home/emma/github/ctrl-b/dashboard_v2`. Preserve current architecture. Do not redesign the theme engine. Implement hardening in behavior-preserving slices. Keep vapor unchanged unless a task explicitly says otherwise. Verify with typecheck/tests/build after each slice.

### Slice A — validation foundation, no visual changes

- [ ] Implement `resolveThemeSetting(themeId, key, raw)` in `frontend/src/theme-engine/settings.ts`.
- [ ] Route `useThemeSetting()` through it.
- [ ] Extend `frontend/tests/theme-engine/settings.test.ts` with invalid/stale/wrong-type cases.
- [ ] Add registered theme/mode/accent validation for appearance hydration (`frontend/src/hooks/useAppearance.ts`).
- [ ] Extend `frontend/tests/hooks/useAppearance.test.ts` for unregistered planned IDs and invalid palette values.
- [ ] Make `switchTheme()` return success/failure and make `ConfTab.pickTheme()` persist only after successful activation.
- [ ] Verify: frontend typecheck, test suite, build.

### Slice B — Composer Surface mechanism, still no visual change

Follow `docs/COMPOSER_SURFACE_PLAN.md`:

- [ ] Add concrete `kit/composer/variants.ts`.
- [ ] Add shared `kit/composer/setting.ts` / `composerLayoutSetting()`.
- [ ] Add `kit/composer/ThemedComposer.tsx` resolver.
- [ ] Wire `DefaultRoot` through `ThemedComposer` while preserving current `KitComposer` output.
- [ ] Keep `composerSlots` intact for Cosmos plan pill.
- [ ] Ensure `--composer-h` re-measures on layout changes.
- [ ] Verify no vapor behavior changed.

### Slice C — SheetComposer visual variant

- [ ] Extract shared presentational hook from `KitComposer` only if it prevents duplicated behavior.
- [ ] Replace `SheetComposer` stub with real docked markup reusing `useComposer()`.
- [ ] Add `.kit-composer.sheet` CSS using semantic Kit tokens only.
- [ ] Gate blur/motion under existing perf/motion levers.
- [ ] 390px/mobile eyeball QA for minimal/cosmos.

### Slice D — executable design-system contracts

- [ ] Add `themeContract.test.ts` for registry/theme defaults/loaders/settings defaults.
- [ ] Add token contract test with runtime-var exceptions.
- [ ] Add keyframe prefix guard with legacy vapor/extras allowlist or migration.
- [ ] Add no-theme-ID-branch guard scoped to shared `theme-engine/kit/**` and generic resolvers.
- [ ] Add/extend Playwright smoke only where it catches real UI risks.

## Final assessment

The foundation is genuinely good. The audit should not push CTRL/B toward a new design system architecture; it should push the existing one from **well-documented** to **executable and safe under growth**.

Highest priority sequence:

1. Validate theme settings.
2. Validate synced appearance theme/mode/accent.
3. Make theme switch persistence transactional.
4. Implement Composer Surface mechanism without visual change.
5. Add the docked SheetComposer.
6. Add contract/keyframe/token/no-branch guardrails.
7. Add Storybook when the visual matrix justifies it.

That gives Ari the flexibility he wants — swappable/composable surfaces and reusable assets — without sacrificing maintainability, performance, or the current fluid feel.
