# Composer Surface — implementation spec (clean-session handoff)

> **Status: ⏸ PARKED (resume post-emma-deploy).** Still the current executable plan for the Composer
> Surface — not superseded. Sequencing is locked by **D34 / `THEME_ENGINE.md` §14.15**: the theme
> **Hardening slice v2 ships first**, then this. Note: D34 renumbered the old TRIAGE-3 hardening
> vocabulary this doc's §2.0 references (R3/R4/B2 → §14.15.1 items); read §14.15 for the current
> hardening plan of record.

**Read first:** `THEME_ENGINE.md §14.14` (the Swappable-Surfaces contract) + `DECISIONS.md D31` (the locked
decision). This doc is the **executable build plan** for the first user-selectable Surface — the composer — with
every edge case pinned. It is self-contained: a fresh session needs only this + §14.14 + D31.

> **One-line summary.** Build a **docked** composer variant (`SheetComposer`, vapor's composer look, Kit-tokened)
> and make the composer layout a **user-selectable Surface** (registry + per-theme `composer` setting + resolver),
> reusing `useComposer()`. **vapor is untouched; cosmos's orbit is untouched; Fleet stays Root-pinned.**

---

## 0. Scope & non-goals

**In scope (this feature):**
- A1 — the composer Surface mechanism (registry + setting spec + resolver), wired into `DefaultRoot`. No visual change.
- A2 — `SheetComposer` (the docked variant) markup + `.kit-composer.sheet` CSS, reusing `useComposer()` + a shared
  presentational hook.
- A3 — declare the `composer` setting on `minimal` + `cosmos` (default `stacked`); the picker + live swap.
- C — characterization tests + final verify + 390px eyeball.

**Explicitly OUT of scope (deferred, do NOT do here):**
- **Fleet migration** to a registry — Fleet stays **Root-pinned** via the `Fleet=` prop (cosmos untouched). It
  graduates only when a theme offers a fleet *choice* (§14.14 graduation path). Not now.
- **The generic `createSurface` factory** — concrete-first (rule of three). Build the composer registry/resolver
  concretely; extract the factory on the 2nd user-selectable surface.
- **vapor wiring** — vapor does NOT get the `composer` setting here; `VaporRoot` is untouched. (Phase D, opt-in,
  byte-identical when done — see §6.)
- **View-Transition on swap** — optional fluidity polish (Phase D).

---

## 1. The non-breaking guarantee (verified against the code 2026-06-29)

| Theme | Touched in this feature? | Why it's preserved |
|---|---|---|
| **vapor** | **NO** — zero files | `VaporRoot` is bespoke; renders `components/Composer.tsx` directly (`VaporRoot.tsx:132`), never `DefaultRoot`/Kit composer. Not in the change set. Does **not** get the `composer` setting. |
| **cosmos** | composer only; **orbit untouched** | `CosmosRoot` renders `<DefaultRoot Fleet={CosmosFleet} composerSlots={kitPlanComposerSlots} />` — no `Composer=` prop. Resolver returns `KitComposer` for cosmos (default `stacked`) → identical render; plan slots still flow through. `Fleet=`/`present()`/starfield/host-sheet all out of scope. Only addition: one new "Composer" row in its picker, defaulting to current. |
| **minimal** | composer only | Uses `DefaultRoot` defaults → resolver returns `KitComposer` (default `stacked`). Identical. |

**Safe at every intermediate slice:**
- After **A1** (resolver in, no setting on themes yet): `useThemeSetting(theme,"composer")` → `undefined` → resolver
  **fallback** = `KitComposer`. Same as today, all themes.
- After **A3** (setting added, default `stacked`): resolves `KitComposer`. Same. No window renders the wrong composer.
- **No persistence migration**: existing `themeSettings.{cosmos,minimal}` (moonStyle/density/…) keep working; the new
  `composer` key simply resolves to its declared default.

---

## 2. File-by-file build — A1 (mechanism, NO visual change)

All new files live in `frontend/src/theme-engine/kit/composer/`. The registry holds **eager** Kit variants
(KitComposer, SheetComposer are both in the kit bundle → no lazy-registration timing issue; that only arises for
bespoke variants, which is the deferred Fleet case).

### 2.0 `theme-engine/settings.ts` (EDIT) — validate the setting at read (audit B4)
> **⚠️ MOVED (audit #3 consolidation, 2026-06-30).** This validation — plus appearance-ID validation (R3), the
> transactional switch (R4), and the `themeContract.test.ts` suite (B2/§7) — is now owned by the **standalone
> Theme-Engine Hardening slice that ships BEFORE this composer work** (the owner's locked sequencing; routing in
> [`external_audit/TRIAGE-3.md`](./external_audit/TRIAGE-3.md)). By the time A1 runs, `resolveThemeSetting` + the
> contract suite already exist — **A1 assumes them, does not re-implement them.** The spec below is kept as the
> reference for what the Hardening slice builds; the §7 test strategy likewise moves into that slice.

The Surface resolver reads a per-theme setting to decide *which component renders*, so the value must be validated, not
cast. Add a pure, exported `resolveThemeSetting` and route `useThemeSetting` through it. This hardens **all** theme
settings (not just composer) and **enforces D31's capability list for free** (a value can only resolve to a variant the
theme declared in its `options`).
```ts
export function resolveThemeSetting(
  themeId: ThemeId, key: string, raw: ThemeSettingValue | undefined,
): ThemeSettingValue | undefined {
  const spec = registry[themeId]?.settings?.[key];
  if (!spec) return undefined;                                    // unknown key
  if (spec.type === "switch") return typeof raw === "boolean" ? raw : spec.default;
  return typeof raw === "string" && spec.options.some((o) => o.val === raw) ? raw : spec.default; // seg
}
// useThemeSetting: const raw = useUISlice(s => s.themeSettings[themeId]?.[key]);
//                  return resolveThemeSetting(themeId, key, raw) as T;
```
**Safe:** all 14 existing call sites (vapor heroOn/waveformOn/skyline/loz, cosmos moonStyle/motionSpeed/orbitStyle/
liveness/serviceCue, minimal density) read settings that HAVE specs → validation is a no-op for valid values and only
coerces corrupt/stale ones (it also makes cosmos's existing `as OrbitStyle` casts sound). Unit-test in 2.5.

> **Theme-safety scope extension (external_audit #2 — TRIAGE-2 R3/R4, fold in here when the theme engine un-parks):**
> the same validation discipline applies to the **theme/mode IDs**, not just settings. (R3) `hooks/useAppearance.ts`
> currently casts `server.theme as ThemeId` / `server.mode as Mode` without checking the value is *registered* (the
> `ThemeId` union includes unbuilt `phosphor/frontier/observatory`) — add `isRegisteredThemeId` / `isMode` guards
> before `switchTheme`, fall back to current on a bad value. (R4) `ConfTab.pickTheme` persists the server appearance to
> the new theme **before** confirming `switchTheme` succeeded — make it **transactional**: persist only *after*
> successful activation, so a failed lazy chunk can't leave UI/server diverged (reload-loop on a broken theme). Both
> are the natural siblings of `resolveThemeSetting` + the B2 contract tests; add their cases to the §7 suite.

### 2.1 `kit/composer/variants.ts` (NEW)
```ts
import type { ComposerVariant } from "./types";
import { KitComposer } from "./Composer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer registry (D31/§14.14). STABLE module-level refs — never built in render.
// "stacked" = the default KitComposer; "sheet" = the docked SheetComposer. Add a variant by adding a row
// here (+ listing its id in a theme's `composer` setting options). A bespoke per-theme composer would
// register from its theme module; today both variants are Kit-eager.
export const composerVariants: Record<string, ComposerVariant> = {
  stacked: KitComposer,
  sheet: SheetComposer,
};
export type ComposerLayout = keyof typeof composerVariants; // "stacked" | "sheet"
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = "stacked";
```

### 2.2 `kit/composer/setting.ts` (NEW)
```ts
import type { ThemeSettingField } from "../../types";

// The SHARED composer-layout setting spec (D31). Themes spread it into `ThemeDef.settings` with their own
// default — one source of the option list, no per-theme duplication. Value = the variant id (registry key);
// the user-facing label is display-only ("Docked" for the "sheet" variant).
export function composerLayoutSetting(def: "stacked" | "sheet" = "stacked"): ThemeSettingField {
  return {
    type: "seg",
    label: "Composer",
    desc: "input bar layout",
    options: [
      { val: "stacked", label: "Stacked" },
      { val: "sheet", label: "Docked" },
    ],
    default: def,
  };
}
```

### 2.3 `kit/composer/ThemedComposer.tsx` (NEW) — the resolver
```ts
import { useUISlice } from "../../../store/ui";
import { useThemeSetting } from "../../settings";
import { KitComposer } from "./Composer";
import { composerVariants, type ComposerLayout } from "./variants";
import type { ComposerSlots } from "./types";

// Resolve the active theme's chosen composer layout → its variant component. Reads the per-theme `composer`
// setting (undefined when the theme doesn't declare it → fallback). Exposed as a hook so DefaultRoot can ALSO
// key its `--composer-h` measurement on the layout (re-measure on a live swap). Usable by any Root.
export function useComposerLayout(): ComposerLayout {
  const theme = useUISlice((s) => s.theme);
  const id = useThemeSetting<string | undefined>(theme, "composer");
  return (id && id in composerVariants ? id : "stacked") as ComposerLayout;
}

// `layout` may be passed (DefaultRoot reads it once for its effect dep + passes it down to avoid a double
// subscription); bespoke Roots can omit it and let the hook read.
export function ThemedComposer({ layout, ...slots }: ComposerSlots & { layout?: ComposerLayout }) {
  const resolved = useComposerLayout();
  const Variant = composerVariants[layout ?? resolved] ?? KitComposer; // fallback-safe
  return <Variant {...slots} />;
}
```
**Import-cycle note (benign):** `ThemedComposer → settings → registry → themes/* → DefaultRoot → ThemedComposer`.
ESM-safe because nothing is *called* at module top-level during the cycle (`useThemeSetting` is only invoked at
render); this mirrors the documented benign cycle in `settings.ts`. `variants.ts` imports only Kit components (no
theme imports), so the registry seeds cleanly.

### 2.4 `kit/composer/DefaultRoot.tsx` (EDIT)
- **Remove** the `Composer?: ComposerVariant` prop from `Props` + the `Composer = KitComposer` default + its import.
  (No theme passes it — verified.)
- Read the layout once and resolve via the resolver; **key the `--composer-h` effect on the layout** so a live swap
  re-measures the new composer node:
```ts
import { ThemedComposer, useComposerLayout } from "./composer/ThemedComposer";
// …
const layout = useComposerLayout();
// …in the --composer-h effect deps: [showComposer, layout]   // ← add `layout` (EDGE #10)
// …render:
{showComposer && <ThemedComposer layout={layout} {...(composerSlots ?? {})} />}
```
- `composerSlots` prop **stays** (the addon axis is orthogonal, theme-decided).

### 2.5 Verify A1
`npm run typecheck` · `npx vitest run` (198 green) · `npm run build`. **No visual change** — `sheet` still delegates
to `KitComposer` (the stub) and all themes default to `stacked`. Live: vapor/cosmos/minimal composers identical.

---

## 3. A2 — `SheetComposer` (the docked variant) + shared presentational hook

### 3.1 Extract the shared presentational hook `kit/composer/useComposerChrome.ts` (NEW)
`KitComposer` and `SheetComposer` share three pure-presentational concerns (NOT behavior — behavior is `useComposer`):
the **mic-press JS-toggle** (Fennec `:active`-wedge fix), the **textarea auto-grow** (max 96px), and
**Enter-to-send**. Extract them so `SheetComposer` doesn't copy-paste:
```ts
export function useComposerChrome(taRef, draft, send) {
  // micPressed + pressMic/releaseMic (200ms safety timeout, cleanup on unmount)
  // auto-grow effect on [draft]
  // onKeyDown (Enter && !shift → preventDefault + send)
  return { micPressed, pressMic, releaseMic, onKeyDown };
}
```
Then **refactor `KitComposer` to use it** (pure extraction — behavior byte-identical; characterization-test it).
vapor's `components/Composer.tsx` keeps its own copy (frozen, D7 — do NOT touch).

### 3.2 `kit/composer/SheetComposer.tsx` (REPLACE the stub)
Own markup — vapor's inline rounded-dock arrangement, Kit-tokened, reusing `useComposer()` + `useComposerChrome()` +
the `ComposerSlots`. Structure:
```tsx
export function SheetComposer({ controlsStart, overlay }: ComposerSlots = {}) {
  const { draft, setDraft, send, isStreaming, mic, sttReady } = useComposer();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { micPressed, pressMic, releaseMic, onKeyDown } = useComposerChrome(taRef, draft, send);
  return (
    <>
      {overlay}                                              {/* plan sheet — sibling above, tucks behind */}
      <div className="kit-composer sheet" id="composer">     {/* KEEP .kit-composer (EDGE #7: --composer-h query) */}
        {controlsStart && <div className="sheet-controls">{controlsStart}</div>}  {/* slim strip ONLY when present */}
        <div className="sheet-row">
          <div className="field">
            <textarea ref={taRef} … value={draft} onChange={…} onKeyDown={onKeyDown} />
            {sttReady && <button className="kit-cbtn mic …" …>{/* embedded in field, right */}</button>}
          </div>
          <button className="kit-send tall" … disabled={isStreaming} onClick={send}>{/* tall, beside field */}</button>
        </div>
      </div>
    </>
  );
}
```
Mic/send icons + the full a11y attribute set are copied from `KitComposer` (same labels/aria/disabled logic).

### 3.3 `kit/kit.css` (EDIT) — `.kit-composer.sheet` (semantic tokens ONLY; portable)
Port vapor's `.composer` LOOK using the contract (NOT vapor's `--magenta`/`--ink`/`--bg-2`):
- `.kit-composer.sheet` — docked at bottom, **rounded top** (`var(--radius) var(--radius) 0 0`), frosted
  (`backdrop-filter: blur(…)` **perf-gated** under `body[data-perf="lite"]` → opaque), top border + top shadow,
  `display:flex; flex-direction:column`.
- `.sheet-controls` — the slim strip (plan pill); only rendered when populated. Subtle top padding; left-aligned.
- `.sheet-row` — `display:flex; align-items:stretch`.
- `.field` — flex:1, row, `background: var(--surface-2)`, rounded top-left; `:focus-within` ring via `--accent`.
- `textarea` — transparent, `color: var(--text)`, auto-grow max 96px.
- `.kit-cbtn.mic` (in `.sheet .field`) — embedded right of textarea, `--accent-fill`.
- `.kit-send.tall` — full-height block beside the field, rounded top-right, `background: var(--accent-fill)`
  (contract token — flat OR gradient per theme), the paper-plane icon.
- **§14.11 budget:** transform/opacity transitions only; gate blur on `data-perf`, any motion on `data-motion`.
- **§14.13 #1:** every token read here already has a base fallback — confirm; if a NEW token is introduced, add its
  base fallback to `kit/tokens.css` in the same change.

### 3.4 Verify A2
typecheck · suite · build · **390px eyeball on cosmos with `composer` temporarily set to `sheet`**: the docked look,
the embedded mic, the tall send, the plan pill in the slim strip, the plan sheet tucking behind the rounded top.
Confirm `--composer-h` correct (content clears the composer) after a live stacked↔docked swap.

---

## 4. A3 — wire the themes

### 4.1 `themes/minimal/index.tsx` + `themes/cosmos/index.tsx` (EDIT)
Add the `composer` setting (default `stacked` — no behavior change). Place it FIRST in the `settings` object so
"Composer" reads above the theme-specific rows (object key order drives picker order):
```ts
import { composerLayoutSetting } from "../../theme-engine/kit/composer/setting";
// …
settings: {
  composer: composerLayoutSetting("stacked"),
  // …existing (density / moonStyle / motionSpeed / …) unchanged…
},
```

### 4.2 Verify A3
typecheck · suite · build · **390px eyeball**: the "Composer: Stacked · Docked" row appears in minimal + cosmos
Appearance; default `stacked` = current; toggling to `docked` live-swaps with the **draft preserved**; vapor's picker
is **unchanged** (no composer row). Switch themes and back — no FOUC, no stale `--composer-h`.

---

## 5. Edge cases & nuances (each must hold)

1. **Resolver fallback** — unknown/undefined layout id → `KitComposer`. A theme without the `composer` setting →
   `KitComposer`. (Tested.)
2. **Stable identity** — `composerVariants` are module-level refs; the resolver does object-lookup, never builds a
   component in render → switching id remounts (intended; draft survives via the store), same id keeps identity.
3. **Draft survives a swap** — `useComposer` draft lives in `store/composer.ts` (persisted), so a stacked↔docked
   remount preserves it. (Fluidity requirement.)
4. **EDGE #10 — `--composer-h` re-measure on swap** — `DefaultRoot`'s ResizeObserver effect MUST include `layout` in
   its deps; otherwise after a live swap it observes the unmounted old node and the scroller padding goes stale. (§2.4.)
5. **EDGE #7 — `.kit-composer` class kept** — `SheetComposer`'s root is `.kit-composer.sheet`, so `DefaultRoot`'s
   `querySelector(".kit-composer")` (the `--composer-h` measurement) still finds it.
6. **`composerSlots` flow** — cosmos's `kitPlanComposerSlots` → `DefaultRoot` → `ThemedComposer({...slots})` →
   variant. `SheetComposer` renders `controlsStart` (slim strip) + `overlay` (plan sheet sibling). KitComposer
   unchanged.
7. **Plan sheet under the docked composer** — `overlay` (`.plan-sheet`) stays a sibling rendered BEFORE
   `.kit-composer` so the rounded top tucks its bottom edge; its position keys off `--composer-h` (kept correct by
   #4). Eyeball with a live plan.
8. **Import cycle** — benign (§2.3); mirrors `settings.ts`. Seed registry from Kit-only imports.
9. **No persistence migration** — additive `composer` key resolves to default for existing users; syncs via the open
   `themeSettings` map.
10. **vapor isolation** — vapor gets no `composer` setting + `VaporRoot` untouched → no composer row, no behavior
    change.
11. **a11y/perf parity** — `SheetComposer` copies KitComposer's aria/labels/disabled; the docked CSS obeys §14.11
    (transform/opacity, perf-gated blur, motion-gated transitions) and §14.13 #1 (token fallbacks).
12. **Setting value vs label** — persisted value is the variant id (`stacked`/`sheet`); "Docked" is display-only. An
    unknown stored value coerces to `stacked` (fallback in `useComposerLayout`).
13. **`Composer=` prop removal** — no theme uses it (verified); the §14.13 #12 doc note is reconciled to the registry.
14. **Capability enforcement via validation (audit B4)** — because `useThemeSetting` now validates against the theme's
    declared `composer` `options`, a theme can NEVER resolve to a variant it didn't offer (a stale/synced `sheet` under
    a stacked-only theme coerces to `stacked`). The resolver's `registry[id] ?? KitComposer` is the second safety net.
    So D31's per-theme capability list is self-enforcing — no extra guard code.
15. **Slot semantics fixed (audit H3)** — `controlsStart` (controls-row leading edge) + `overlay` (sibling above,
    tucks behind the rounded top, rendered BEFORE the bar) are the only two slots; `controlsEnd`/`below` are reserved
    but NOT added (no consumer yet). `SheetComposer` must honor the same placement contract as `KitComposer`.

> **Audit alignment.** This plan folds external_audit **B4** (settings validation — §2.0), **B2** (theme contract
> tests — §7), **D1** (no theme-id branching — invariant in §14.14 + the resolver reads a setting, not the theme id),
> and **H3** (slot semantics — #15). The remaining audit findings (theme-engine backlog + out-of-scope) are routed in
> [`external_audit/TRIAGE.md`](./external_audit/TRIAGE.md) — do them in the follow-up hardening pass, not this slice.

---

## 6. Phase D (deferred, opt-in) — vapor & frontier participation
- **vapor** (when wanted): register `components/Composer.tsx` as variant `"vapor"` in `composerVariants`; `VaporRoot`
  renders `<ThemedComposer/>` instead of `<Composer/>`; add `composer: composerLayoutSetting` to vapor's `settings`
  with options starting at just `["vapor"]` (a 1-option setting shows no picker — keep vapor clean) and add the Kit
  ids only once vapor maps its vocabulary onto the semantic contract (`--accent: var(--magenta)`, … — additive, marks
  the subtree `.kit`). `<Composer/>` vs `<Composer {...{}}/>` is byte-identical → add a regression test asserting the
  resolver returns vapor's Composer for `theme==="vapor"` before flipping `VaporRoot`.
- **frontier** (T5): registers its bespoke composer/fleet variants from its lazy chunk; lists them in its settings.
- **Fleet graduation**: when a theme offers ≥2 fleet views, build the fleet registry/resolver by **factoring** the
  composer concretes into the generic `createSurface` (the rule-of-three extraction).

---

## 7. Verification strategy (every slice)
- **Characterization tests** (`tests/theme-engine/composerSurface.test.ts`, write in A1 BEFORE refactoring): resolver
  returns the expected component per theme default; falls back when the setting is unset; falls back on unknown id;
  `composerLayoutSetting` shape; `resolveThemeSetting` validates (seg∈options else default · switch→bool · unknown
  key→undefined). Lock current behavior so the refactor is provably non-breaking.
- **Theme contract suite** (`tests/theme-engine/themeContract.test.ts` — audit B2, "best ROI in the theme engine";
  write alongside A1). `it.each(registeredThemes())` asserting, for EVERY registered theme: (a) `defaultAccent` ∈
  `palettes.accents` ids and `defaultMode` ∈ `palettes.modes`; (b) every `settings` entry's `default` is valid
  (switch→boolean, seg→∈options); (c) `loadStyles()/loadFonts?()/loadRoot?()` resolve; (d) `tabsFor(theme)` returns a
  non-empty set with unique ids. Plus a **switch-cleanup** test (vapor→minimal→cosmos→vapor): assert the **root-owned**
  attrs are cleared when their theme isn't active — `data-density` (MinimalRoot), `data-skyline`/`data-loz`/
  `.no-composer` (VaporRoot), `data-sheet` (CosmosFleet) — while the **global** attrs (`data-skin/theme/mode/accent/
  motion/perf/tab`, rebuilt by `applyBodyAttrs`) reflect the active theme. This turns "remember the architecture" into
  "the test fails when you violate it" — it guards every future theme, not just the composer.
- **Per slice:** `npm run typecheck` clean · `npx vitest run` (≥198 + new) green · `npm run build` green.
- **Per-theme live 390px eyeball** after A2 and A3: vapor (unchanged), cosmos (orbit + composer + plan), minimal —
  pixel + behavior parity, draft-preserving swap, no stale `--composer-h`, no FOUC.
- **Pause for the owner's eyeball between A1 → A2 → A3** (standing review cadence).

---

## 8. Definition of done
SheetComposer is a real docked variant; the composer is a user-selectable Surface on minimal + cosmos (default
stacked); vapor + cosmos-orbit provably unchanged; tests + build green; docs (§14.14, D31, this plan) consistent.
Commit per slice; push on owner confirmation.
