# R25 — Alt-fleet port SEAM MAP (internal, code-verified)

> **Not field research.** Unlike R22–R24 (how other projects do it), this dossier maps OUR OWN
> code: every seam the POSTER + COVER fleet-layout port touches, with file:line evidence.
> Commissioned 2026-08-08 (Fable main seat → Opus research subagent) as the foundation for the
> translation plan (GACHA_PLAN §12.6). Read together with the §12.5 rulings log ("DIRECTION
> STABILIZES" block) and the lab `design/prototypes/gacha/alt-fleet-finalists/`.
> Line numbers are as of `main` 2026-08-08 (post-v1.5.0); they drift — the *findings* are the
> durable part.

---

## Q1 — The wake path, busy semantics, and select-then-act feasibility

### 1a. The wake chain (verified end to end)

| Step | Location |
|---|---|
| Dossier Wake button | `frontend/src/themes/gacha/GachaHostDetail.tsx:220-228` — `<button className="gc-act primary" disabled={busy} onClick={() => run("wake", host)}>` |
| Busy is presented on the action **bar**, not the card | `GachaHostDetail.tsx:199` — `<div className="gc-acts" aria-busy={busy || undefined}>`; every button in it takes `disabled={busy}` (`:205, :214, :223`) |
| `busy`/`run` arrive as props | `GachaHostDetail.tsx:34-36` (prop doc: "A host action is in flight (`useFleet().busy`) — disables the whole bar") |
| Passed down by the fleet body | `GachaFleet.tsx:600-603` — `busy={busy.has(detail.host.id)} run={run}` |
| Body reads the headless controller | `GachaFleet.tsx:52-63` (`const { hosts, svcByHost, busy, run, … } = useFleet()`) |
| Controller wires the actions | `frontend/src/hooks/useFleet.ts:167` — `const { run, busy } = useFleetActions();`; exposed on `FleetView` at `:145-146` |
| The action hook | `frontend/src/hooks/useActions.ts:57-121` |
| Name mapping | `useActions.ts:13-20` — `wake → "wake_host"` |
| The HTTP call | `useActions.ts:93-101` — `POST /api/actions/wake_host {args:{host_id}}`, then a second POST carrying `confirm_token` **only if** the server answered `needs_confirm` |
| Reconcile | `useActions.ts:114` — `invalidateQueries(["hosts"])` in `finally` |

Optimism: **wake gets none** — `useActions.ts:53-55` states this explicitly ("`wake` doesn't
optimistically show 'online' … its optimism is the busy state, reconciled by the next poll").
`patchHostOnline` (`:45-49`) is called only for `shutdown` (`:89`).

### 1b. Busy semantics — **per-host, not per-action**

`useActions.ts:60` — `const [busy, setBusy] = useState<Set<string>>(new Set())`; `setBusyId(id, on)`
(`:62-68`) keys on `host.id` only; set at `:91`, cleared in `finally` at `:113`. So a host that is
waking and a host that is rebooting are indistinguishable in `busy`, and one in-flight action
disables *all* actions for that host. It is also **component state inside `useFleetActions`**,
therefore per-`useFleet()`-caller — but only one fleet body is mounted per theme, so this is not a
live divergence today. `run`'s identity is stable (`useCallback` deps `[qc, specs, setBusyId]`,
`:117`).

**How each view reads busy today:**

| View | Reads busy? | Presentation |
|---|---|---|
| Kit | `theme-engine/kit/Fleet.tsx:66` → `DeviceRow` | a `" busy"` class on the row (`Fleet.tsx:130`) + `disabled={busy}` on both action buttons (`:145, :167`) |
| vapor | `themes/vapor/FleetTab.tsx:75` | passed to `DeviceRow` |
| cosmos | `themes/cosmos/CosmosFleet.tsx:81` | sheet only |
| frontier | `themes/frontier/FrontierFleet.tsx:37` | sheet only |
| gacha | `GachaFleet.tsx:57` → **dossier only** | **`GachaCard` takes no `busy` prop at all** (`GachaCard.tsx:16-26`) |

⇒ **A busy-on-card presentation does not exist in gacha today.** The kit's `.kit-device.busy`
class (`kit/Fleet.tsx:130`) is the only card-level busy precedent in the tree.

### 1c. Is wake confirm-gated or privileged? **No, on both counts.**

- Registry spec: `backend/app/services/actions/wake.py:17` — `@action("wake_host", title="Wake",
  icon="zap", risk=Risk.LOW, idempotent=True)`. No `confirm=True`.
- Contrast: `backend/app/services/actions/shutdown.py:47-48` and `reboot.py:45-46` carry
  `risk=Risk.HIGH, confirm=True`.
- FE gate: `useActions.ts:73-77` — `needsConfirm = spec ? spec.confirm || spec.risk === "high" :
  action === "shutdown" || action === "reboot"`. Wake fails both terms, spec present or absent.
- Backend policy: `backend/app/core/permissions.py:7-8` — *"Phase 2 UI actions run at
  `Privilege.CONFIRM`, which yields exactly: wake/ping → ALLOW, shutdown (risk=HIGH, confirm=True)
  → CONFIRM."*
- Denial cases that surface as *data*, not errors: `wake.py:23-24` (no MAC → `RunState.DENIED`),
  `:28-29` (malformed MAC).

⇒ A one-tap wake from a card introduces **no new execution path and no new gate**. It is the same
`run("wake", host)` the dossier already calls. `useActions.ts:9-11` records the D8 ethos (the
registry decides confirm, not the UI) — the poster must not hardcode a confirm either.

### 1d. What's missing for "first tap selects, second tap wakes/opens"

Nothing in the data or action layer. Missing pieces, all presentational/policy:

1. **Selection state distinct from dossier-open.** Gacha's only selection today is
   `GachaFleet.tsx:129` — `const [selected, setSelected] = useState<string|null>(null)` — and it
   *is* the dossier: `sheetOpen = active && !!selHost` (`:338`). A poster needs a selection that
   does **not** open the sheet.
2. **A tap router** — `i !== selected ? select(i) : (online ? open : wake)`. Prototype form:
   `app.js` `tap(i)` (poster builder).
3. **Two-step aria-labels.** `themes/gacha/fleet.ts:146-148` `openLabel()` is one-step ("open X
   dossier, online/sleeping"). The prototype's `labelPoster(u, isSelected)` (`app.js:101-107`)
   names both steps and swaps once selected. `openLabel` is shared by the cards **and** the banner
   promos (`GachaCard.tsx:63`, `GachaBanner.tsx:456`), so a poster-specific label must be a
   **new** function, not an edit to `openLabel`.
4. **A busy/aria-busy channel to the card** (see 1b).
5. **The wake ceremony + a live-region announce.** No aria-live region exists in gacha today;
   `pushToast` (via `useActions.ts:104, :107`) is the current outcome channel.

### 1e. Where selection state should live — `featured` **cannot** be it

`frontend/src/store/fleet.ts` is a module-singleton `createStore` holding three values: `featured`
(index), `open` (Set of ids), `holdUntil`.

- **`featured` is an INDEX, not an id** (`:14`, `:54-56`). Every other selection store in the app
  is id-keyed precisely because indexes don't survive polls/reorders (`store/cosmosSelection.ts:3-4`,
  `store/frontierSelection.ts:2-3`).
- **`featured` is auto-cycled.** `useFleetCycle` (`hooks/useFleet.ts:84-121`) is a singleton
  mounted once at `frontend/src/App.tsx:147-148`. It runs whenever the fleet tab is active
  (`useFleet.ts:93` `useTabActive("fleet")`) — **including under gacha**, where nothing reads the
  value. It advances *only among online hosts* (`:106-110`) every `feature_cycle_seconds`
  (default 6s, `:86`).
- **The hold is only 8s** (`store/fleet.ts:11` `HOLD_MS = 8000`). `feature(i)` sets
  `holdUntil = now + 8000` (`:32-36`); after that the cycle takes the selection away. A poster
  selection that silently jumps to another machine after 8 seconds — and skips sleeping hosts
  entirely — is wrong on both counts.
- **Only vapor consumes `featured`** (`themes/vapor/FleetTab.tsx:28, 49, 72` — the Hero now-dots +
  row highlight). The kit (`kit/Fleet.tsx:26`), cosmos, frontier and gacha all omit it from their
  destructure. Repurposing it would silently change vapor's Hero.

⇒ **A sibling id-keyed selection is required.** Two viable homes:

- **(a) A new field on the shared `store/fleet.ts`** — `selectedId: string | null` +
  `setFleetSelection(id)` + `useFleetSelection()`, exposed on `FleetView` (`useFleet.ts:123-149`).
  This is what the owner's "maybe directly into the kit" points at, and it is *below* the kit (the
  store is theme-agnostic, `store/fleet.ts:2-3`). The auto-cycle **must not write it**
  (`featureAuto` at `:24-29` is the only writer of `featured` from the engine; leave it alone).
- **(b) A new `store/gachaSelection.ts`** cloning `frontierSelection.ts` verbatim (which itself
  clones cosmos — `frontierSelection.ts:1-2`). Cheapest, but forecloses the owner's "most shared
  level" ask.

**Reset semantics — the existing precedents to copy:**
- Host left the fleet → clear. `GachaFleet.tsx:300-308`; `CosmosFleet.tsx:87`;
  `FrontierFleet.tsx:46`.
- Tab leave / unmount → clear. `GachaFleet.tsx:314-334` (the `!active` branch clears `selected`,
  bumps generations, drops the showcase).
- **No timeout precedent exists anywhere** for a manual selection — cosmos/frontier selections
  persist indefinitely. The only timeout in the fleet layer is the carousel `HOLD_MS`.
  ⇒ recommend no timeout; reset on host-gone + tab-leave only, matching all three bespoke fleets.
  Note the prototype boots with host[0] pre-selected (`app.js` `select(0, {announceIt:false})`) —
  a `selectedId === null → hosts[0]` fallback in the *view*, not in the store, keeps the store
  honest.

### 1f. Select-then-act precedent in the themes — **there is none**

- cosmos: one tap = select **and** open; re-tap = deselect+close. `CosmosFleet.tsx:358` —
  `onClick={() => setCosmosSelection(isSel ? null : p.host.id)}`; `:243-244`
  `sheetOpen = active && !!selectedHost`.
- frontier: identical, two-way (map beacon + card). `FrontierFleet.tsx:150, :188`, `:79-80`.
- gacha: one tap = open dossier. `GachaCard.tsx:65`.
- The only "one tap, two effects" primitive is `toggleRow(id, i)` (`store/fleet.ts:39-46`):
  features + holds + toggles the expand set. That is *simultaneous*, not sequential.

⇒ select-then-act is a **genuinely new interaction policy** in this codebase.

---

## Q2 — The Fleet Surface / variant registry (D31)

### 2a. How Fleet variants are selected today: **Root-pinned prop injection, no registry, no setting**

- `docs/THEME_ENGINE.md:1500-1520` defines exactly two selection mechanisms: **(1) Root-pinned
  (prop injection)** — "Use when a theme has exactly ONE variant for that surface and the user
  shouldn't choose… **This is Fleet today**"; **(2) User-selectable (registry + per-theme `seg`
  setting + resolver)** — "**This is Composer**".
- `docs/THEME_ENGINE.md:1522-1528` — the graduation path: *"**Fleet stays Root-pinned** … until a
  theme genuinely offers a fleet choice. Don't pre-graduate a surface that only has one variant
  per theme."*
- Mechanism in code: `theme-engine/kit/DefaultRoot.tsx:103-108` (`DEFAULT_BODIES` =
  `{fleet: KitFleet, agent: AgentTab, utils: UtilsTab, conf: ConfTabLazy}`), merged at `:157`
  (`const bodyMap = { ...DEFAULT_BODIES, ...bodies }`), prop documented at `:65-69`.
- Gacha slots in: `themes/gacha/GachaRoot.tsx:43` — `const BODIES = { fleet: GachaFleet, agent:
  GachaAgent };` (module-level, with the comment at `:40-42` explaining that a fresh literal per
  render would remount the body) → `:121` `bodies={BODIES}`.
- There is **no `fleetVariants` map and no fleet setting anywhere** (grep for `Surface|variant`
  across `theme-engine/` returns only composer/plan hits).

### 2b. The user-selectable precedent, in full (the `composer` layout Surface)

Four parts, all small:

1. **Registry** — `theme-engine/kit/composer/variants.ts:15-22`: `export const composerVariants:
   Record<string, ComposerVariant> = { stacked: KitComposer, sheet: SheetComposer, line:
   LineComposer }` + `DEFAULT_COMPOSER_LAYOUT`. Comment `:6-14`: "STABLE module-level refs — never
   built in render… Add a layout by adding a row here (+ listing its id in a theme's `composer`
   setting options)."
2. **Setting spec FACTORY** — `theme-engine/kit/composer/setting.ts:10-24` `composerLayoutSetting(def)`
   returns a `seg` `ThemeSettingField`; the theme spreads it in with its own default
   (`themes/gacha/index.tsx:221` — `composer: composerLayoutSetting("stacked")`).
3. **Resolver hook + component** — `theme-engine/kit/composer/ThemedComposer.tsx:10-17`:
   `useComposerLayout()` reads `useThemeSetting<string>(theme, "composer")` and returns
   `id && id in composerVariants ? id : DEFAULT_COMPOSER_LAYOUT` — object lookup + default
   fallback, so an unknown/removed id degrades. `:28-32` renders
   `composerVariants[layout ?? resolved] ?? KitComposer`.
4. **Zero Conf change** — the row auto-renders from `ThemeDef.settings` (see Q3).

### 2c. The *other* precedent — the `composerSkin` **axis** (setting-driven, NOT a component registry)

`theme-engine/kit/axes.ts:41-87`. Same three-part shape (factory `composerSkinSetting` at
`:62-76`, resolver `useComposerSkin` at `:85-87` coercing `undefined → "outline"`), but the
resolved value is **projected onto `body[data-composer-skin]`** and consumed by CSS — the stamp
lives at `frontend/src/App.tsx:165-179` (`<AppEngines/>`, `useLayoutEffect`, cleared on unmount;
the comment at `:161-164` explains why it's here and not in `store/ui#applyBodyAttrs`: the store
must never import the registry). `axes.ts:1-13` names the invariant: *"so the Kit's shared chrome
can honor it uniformly WITHOUT any theme-id branching (THEME_ENGINE §14.14 invariant: no
`if (theme === …)` in the engine)"*. Note `axes.ts:43-48`: skins are *not* the axes.css strip
layer, they are first-class kit.css chrome, "because a skin carries fills/shadows and the axes
layer forbids fills".

Also relevant as an explicit **anti**-precedent: `theme-engine/kit/composer/plan/placement.ts:12-13`
— *"this stays two explicit branches at the call sites, NOT a variant registry (the composer STYLE
axis is a registry because every variant is one interchangeable composer component; placements are
not)"*.

### 2d. Verdict for poster/cover: **an internal switch inside gacha, driven by a gacha `seg` setting**

Run the 3-gate (`docs/THEME_ENGINE.md:1476-1484`) on "Fleet as a user-selectable Surface":

- Gate 1 (structural divergence) — ✅ passes.
- Gate 2 (≥2 real divergent impls, prefer 3) — ✅ passes *inside gacha* (capsule/poster/cover),
  but the **variants are not portable**: §14.14's Surface contract says "Variants read **only**
  the semantic contract, so they're portable across any contract-providing theme." A poster built
  on `--gc-*` tokens, gacha's shear geometry and gacha's rarity hues is not renderable under
  cosmos or minimal. Registering it in a *kit* registry would put a theme-private component in kit
  space — precisely the "registry-of-one-theme" failure the gate guards against.
- Gate 3 (shared headless controller) — ✅ `useFleet` already backs all five fleets.

⇒ **Recommendation: do NOT graduate the Fleet Surface. Keep gacha's fleet Root-pinned (one
`bodies={{fleet: GachaFleet}}` entry) and put a `fleetLayout` seg setting on the gacha `ThemeDef`,
resolved inside `GachaFleet` to one of three gacha-private body components.**

Reuse argument, concretely:
- The **setting + resolver half** of the composer mechanism is reused verbatim: a
  `fleetLayoutSetting`-shaped `seg` in `themes/gacha/index.tsx` settings, and a
  `resolveGachaFleetLayout`-style lookup that mirrors `ThemedComposer.tsx:16`
  (`id && id in map ? id : DEFAULT`) — including the module-level stable-ref rule
  (`variants.ts:6-8`), which matters here for the same reason: a fresh component identity per
  render remounts the subtree and would reset `selected`, the morph `prep` refs and the sheet.
- The **registry half** stays *local to `themes/gacha/`* (a `gachaFleetLayouts` map in gacha
  space), which is the §14.14 "bespoke snowflake" band — and gacha is already the escape hatch
  (`§14.4.1`, `THEME_ENGINE.md:995`: "A bespoke theme is still entitled to structural CSS").
- If a second theme ever wants layouts, the graduation path (`THEME_ENGINE.md:1530-1540`) says
  extract the generic `createSurface(name, fallback)` then, by factoring the two concretes.
  Nothing in this design blocks that.

**Sizing note (the split boundary):** `GachaFleet.tsx` is 632 lines, of which roughly `:125-453`
(dossier open/close, the View-Transition morph generations, the art showcase, `prep`/`artPrep`
ownership) and `:495-522` (the slide set) are **layout-independent**. All three layouts need them.
So the clean split is: `GachaFleet` keeps the derivations + dossier + showcase + banner + the tap
seam, and delegates only the **track body** (`:543-577` today) to one of `GachaTrack` /
`GachaPoster` / `GachaCover`. This matches the owner's inherit-chrome mandate literally ("the
variants replace ONLY the track body + how the banner presents").

---

## Q3 — ThemeDef settings: shape, storage, rendering, and conditional visibility

### 3a. The pipeline, end to end

| Stage | Location |
|---|---|
| Field schema | `theme-engine/types.ts:95-109` — a closed 2-member union: `{type:"switch"; label; desc?; default:boolean}` \| `{type:"seg"; label; desc?; options:{val,label,swatch?}[]; default:string}` |
| Spec shape | `types.ts:111-113` — `ThemeSettingsSpec = Record<string, ThemeSettingField>` ("Open… so a theme adds an option additively") |
| Declaration | `ThemeDef.settings?` at `types.ts:151`; gacha's at `themes/gacha/index.tsx:139-260` |
| Value type | `types.ts:116` — `ThemeSettingValue = string \| boolean` |
| Storage | `store/ui.ts:41-43` `ThemeSettingsMap = Record<string, Record<string, ThemeSettingValue>>`; field `:71`; default `{}` `:111`; writer `setThemeSetting(themeId, key, value)` `:269-275` |
| Sync | `hooks/useAppearance.ts:45` wire field `theme_settings` (snake); reconcile `:116`, `:132`; backend `backend/app/config.py:840` (`dict[str, dict[str, Any]] \| None`) with the docstring at `:818-822`: *"the theme owns the schema, so the server is a pass-through (no per-theme Pydantic union…)"* |
| Read | `theme-engine/settings.ts:59-65` `useThemeSetting<T>(themeId, key)` → `useUISlice(s => s.themeSettings[themeId]?.[key])` → `resolveThemeSetting` |
| Validation | `settings.ts:26-36` — unknown key → `undefined`; `switch` → boolean or default; `seg` → the raw string **only if** `spec.options.some(o => o.val === raw)`, else default |
| Conf display value | `settings.ts:46-53` `themeRowValue(themeId, key, raw, field)` = `resolveThemeSetting(...) ?? field.default` |

### 3b. Where the gacha settings rows render

`frontend/src/tabs/ConfTab.tsx`:
- `:846` — `const settingsSpec = Object.entries(activeDef?.settings ?? {});`
- `:2388` — the `<ConfGroup id="appearance" …>` wrapper; Theme/Mode/Palette rows at `:2392-2415`.
- `:2420-2449` — **the auto-render loop**: `settingsSpec.map(([key, field]) => …)` →
  `<SettingRow label={field.label} desc={field.desc}>` containing a `<Switch>` or a `<Seg>` (with
  `swatch` spread through at `:2443`).
- `:904-907` — `pickSetting(key, value)` → `setThemeSetting(theme, key, value)` +
  `saveAppearance.mutate(currentAppearancePatch())`.
- **Declaration order IS render order** — `Object.entries`, and `themes/gacha/index.tsx:133-138`
  states the ordering is deliberate ("declaring `dossierPalette` first is what puts the two colour
  pickers ADJACENT").

### 3c. Conditionally-visible settings: **NO precedent exists**

- `ThemeSettingField` (`types.ts:95-109`) has no `when`/`visibleIf`/`dependsOn`/`enabled` slot.
  Grep for those names across `theme-engine/` and the two row components returns nothing relevant.
- The ConfTab loop (`:2420`) is unconditional — every declared key renders.
- `components/Seg.tsx:16-46` has **no per-option `disabled`** and no group-level disable.
- `components/SettingRow.tsx` has no gating input at all.
- The nearest analogs are all **hand-written conditionals over non-settings data**, one row at a
  time: `ConfTab.tsx:2398` (`modeOptions.length > 1 &&` — the Mode row), `:2403`
  (`accentOptions.length > 0 &&` — the Palette row), `:2382` (`hostsUtils &&` — the hosted Tools
  group). All are *inside the JSX*, keyed on registry/layout facts, never on another setting's
  value.

### 3d. Smallest clean mechanism for the plate/blade row

Two candidates, in ascending cost:

**Option A (recommended) — one additive optional field on `ThemeSettingField`, honored in exactly
one place.**
```
showWhen?: { key: string; is: ThemeSettingValue | ThemeSettingValue[] }
```
- Declared once in `types.ts` alongside `swatch` (which is the exact precedent for an additive
  slot on this union — `types.ts:101-107` documents `swatch` as "the ADDITIVE slot the D52 §4.9
  ledger committed", and the ConfTab spread at `:2443` exists because *re-listing* fields silently
  stripped it).
- Consumed once in the ConfTab loop: skip the row when `themeRowValue(theme, showWhen.key, …)`
  doesn't match. The resolution must go through `themeRowValue`/`resolveThemeSetting`, not the raw
  store value, or the row can be gated on a value the app has already coerced away (that is
  precisely the bug `themeRowValue` was extracted to fix — `ConfTab.tsx:2421-2425`).
- Contract test extension is trivial and belongs beside `themeContract.test.ts:540-553`: assert
  every `showWhen.key` names a *declared sibling* setting and that `is` is one of that sibling's
  declared options.
- Cost: ~10 lines of app code, zero store/backend/sync change, and it generalizes for free.

**Option B — a `disabled`/dimmed row rather than a hidden one.** Cheaper conceptually (no
visibility logic, the row is always discoverable) but needs a real `disabled` path through
`Seg`/`Switch`/`SettingRow`, which none of them have. The owner's wording was "that setting would
pop up right below" ⇒ **hidden, not dimmed**. Option A matches the ruling.

**Non-option:** a poster-only *value* folded into `fleetLayout` (e.g. `poster-plate` /
`poster-blade` as two of four seg options). It collapses two orthogonal questions into one
control, would make the picker read as four layouts when there are two, and contradicts the
owner's "maximum three… I don't wanna clutter the app" cap plus the explicit "layout-scoped"
ruling.

### 3e. Does the pipeline survive a setting disappearing? **Yes, but the value is never pruned.**

- `resolveThemeSetting` returns `undefined` for an undeclared key (`settings.ts:32`), and
  `useThemeSetting` hands that back — consumers must (and all do) coerce: `useOutlines` `?? true`
  (`axes.ts:38`), `useComposerSkin` `?? "outline"` (`axes.ts:86`), `useComposerLayout`'s
  `id in composerVariants` guard (`ThemedComposer.tsx:16`), `toStarMode`
  (`themes/gacha/stars.ts:31-33`).
- A **stale value in a seg that still exists** degrades to the declared default (`settings.ts:35`).
- **The stored value persists.** `setThemeSetting` (`store/ui.ts:272-275`) only patches; nothing
  walks the map against the registry. `hooks/useAppearance.ts:100-101` confirms the intent:
  *"unknown `theme_settings` keys stay inert"*. The **only** prune in the tree is the hand-written
  `stripLegacyAppbar` (`store/ui.ts:163-176`), applied on load via `migrateAppbarMode` (`:186`)
  **and** on every server reconcile (`useAppearance.ts:116`) — the comment at `store/ui.ts:161-162`
  explains why both: *"The old key was SYNCED in the appearance doc, so it keeps coming back."*
- ⇒ Practical consequence: name stable setting keys ONCE now; a later rename needs a
  `stripLegacyAppbar`-shaped one-time fold per the no-legacy-seams directive.

---

## Q4 — GachaBanner tri-state (`on` / `minimal` / `off`)

### 4a. Current props and anatomy

Props — `GachaBanner.tsx:78-90`: `slides: BannerSlide[]`, `active: boolean`, `rate: string`,
`pity: string`, `onOpenHost: (hostId: string) => void`. Slide union at `:64-67`
(`hero` | `scene` | `promo`; only `promo` is interactive).

DOM, top to bottom:
| Part | Line | Notes |
|---|---|---|
| `.gc-banner` root | `:332-393` | `role="group"`, `aria-roledescription="carousel"`, `aria-label="Pickup banner"`, `inert={reeling}`, all six pointer handlers + `onClickCapture` drag-click suppressor |
| `.gc-banner-track` | `:394` | transform written imperatively (`applyOffset`, `:162-165`); rationale at `:39-44` |
| `.gc-slide` (per slide) | `:425-467` | `inert={inactive}` + `aria-hidden` for offscreen slides (`:438-439`); art `<img>` `:441-451`; `.gc-slide-hit` is a `<button>` for promos, a `<div>` otherwise (`:452-465`) |
| `.gc-banner-copy` | `:405-423` | `.tag` pill, `<b>` display line (two-line for hero/scene), `<small>` caption |
| `.gc-banner-glow` | `:473` | one ambient opacity loop, CSS-gated on motion+perf (`gacha.css:956-961`) |
| `.gc-banner-rate` | `:475-478` | two `<span>`s: `rate` then `pity` |
| dots **or** counter+chevrons | `:480-510` | dots while `count <= MAX_DOTS` (8, `carousel.ts:30`), else `.gc-banner-nav` with an `aria-live="polite"` `i/N` |

CSS: `themes/gacha/gacha.css:820-830` — `.gc-banner { position: relative; height: 232px;
overflow: hidden; box-shadow: var(--gc-banner-shadow); touch-action: pan-y; user-select: none }`;
`:832-834` a wallpaper-on shadow variant; `:837-845` the track's `transition-duration: 0ms`
first-paint guard. Timing constants: `carousel.ts:17` `SNAP_MS = 620`, `:22` `AUTOPLAY_MS = 5200`,
`:29` `ADVANCE_FRACTION = 0.22`, `:30` `MAX_DOTS = 8`.

### 4b. Where the setting plugs in

The natural read site is **`GachaFleet.tsx`** (mounts the banner at `:535-541`, resolves
`starMode` at `:64` via `useThemeSetting<string>("gacha","starMode")` — the exact shape the owner
named).

⚠️ **`off` must be a conditional render, not a CSS hide.** The autoplay one-shot lives inside the
component (`:302-310`) and its `paused` gate (`:301`) does **not** include a "hidden" term — a
`display:none` banner would keep re-rendering slides every 5.2s. Unmounting it is free and also
drops the visibility listener (`:291-295`) and the rAF loop (`:271-276`). Consequence: `off`
**loses the promo-slide opener** (`:452-460`) — acceptable, because the cards are the other half
of the same seam (`GachaCard.tsx:65` / `GachaFleet.tsx:245` `openHostDossier`, deliberately one
shared handler per `GachaCard.tsx:12-14`), and nothing branches on which surface opened.

### 4c. `minimal` — cost and shape

The lab's ruling (README: "MIN is not a third component") maps to production as a **CSS-only
variant keyed off one attribute** — the `composerSkin` band (`axes.ts:43-48`).

Three cheap forms, ascending coupling:
1. A `data-*` on the `.gc-banner` root, scoped `gacha.css` rules overriding `height: 232px` and
   hiding the caption `<small>` (`:422`).
2. **A `body[data-gc-banner]` stamp in `GachaRoot`** (the existing five-attr pattern,
   `GachaRoot.tsx:81-105`). Correct when any *other* surface needs to know — and one does (4d) —
   so this is the better home.
3. A prop on `GachaBanner`. Rejected: `GachaRoot.tsx:26-29` — cosmetic settings go to body attrs,
   structural ones become props. `off` is structural (unmount); `minimal` is cosmetic.

What compresses: the **caption line only**. Tag pill, display line, rate/pity pills and dots all
stay — all independent DOM nodes, so the compression is pure CSS. **No new component, no props
change, no carousel change.**

### 4d. Downstream assumptions

| Consumer | Assumes the banner? | Evidence |
|---|---|---|
| `store/gachaReel.ts` | **No.** `reeling` is read independently by the banner (`GachaBanner.tsx:100`), the track (`GachaFleet.tsx:564` `inert={reeling}`) and `openHostDossier` (`:247`). Removing the banner does not weaken the reel gate. |
| JS scroll math | **No.** `DefaultRoot.tsx:187-212` scroll restoration is pixel-generic. |
| **CSS layout** | **YES — one real coupling.** `gacha.css:813-816`: the banner being the Fleet tab's full-bleed FIRST child is what makes the appbar→content seam land at zero. The `:first-child` nulls (`gacha.css:167-176`) cover `.kit-sec`/`.sec`/`.confgroup`, **not** `.gc-track-head` (`padding: 22px 14px 10px`, `gacha.css:1068-1073`) → with the banner off, ~36px dead air. **The `off` state needs a top-space null on whatever becomes the first block.** (`GachaStarDefs` — `GachaStar.tsx:115`, a 0×0 svg — is the literal first element child, so `:first-child` selectors are already inapplicable; use the attribute.) |
| The two pills | `rate`/`pity` (`GachaFleet.tsx:538-539` via `fleet.ts:81-92`) consume derivations (`onlineCount` `:75`, `onlineServices` `:83-86`, `resolved`/`svcResolved` `:89-93`) that exist only to feed the banner — dead computation under `off`; cheap, but don't "clean them up". |

---

## Q5 — Appbar modes

### 5a. The real mechanism: a **global, device-local user lever** — not a theme property

- Type: `store/ui.ts:28` — `AppbarMode = "visible" | "transparent" | "off" | "minimal"`; semantics
  `:20-27` (*"Every registered theme honors all four"* since D51 V4).
- Helper: `store/ui.ts:34-36` `appbarShown(m)` — "the single source for 'is a bar present'".
- State: field `:77`, default `"visible"` `:112`, and `:73` marks it **device-local, not synced**
  — confirmed by the ConfTab writer using bare `setUI` rather than `setGlobal` (`ConfTab.tsx:2498`
  vs `:2455`).
- UI: `ConfTab.tsx:2485-2500` — a 4-option `Seg`.
- Honored: `GachaRoot.tsx:46` → `:110`; `DefaultRoot.tsx:315` (`appbar-clear` class), `:320`
  (`appbarShown(appbarMode) && <KitAppBar/>`), `:362` (`appbarMode !== "minimal" && <KitNavBar/>`);
  section partitioning `hooks/useSections.ts:52-61`.
- Prop-vs-attr rationale: `DefaultRoot.tsx:55-58` — structural toggle ⇒ explicit prop.

### 5b. Can a fleet layout *recommend* or *require* no-app-bar cleanly?

**Require: no.** The only theme→lever seam is the section-layout pair (`ThemeDef.defaultLayout` /
`layouts`, `types.ts:164-165`; `theme-engine/layout.ts:74-93` with warn-once coercion `:37-48`).
Cloning it for the appbar = ~90 lines, a fourth Conf lever axis, and it would let a *synced* theme
setting drive a *device-local* lever — the one thing `store/ui.ts:73` refuses.

**Recommend: yes, essentially free.** (1) a sentence in the `fleetLayout` seg's `desc`
(`types.ts:99`, rendered by `SettingRow` `.desc`; truthful-copy precedent `ConfTab.tsx:2472-2481`,
`:2504-2507`); (2) a GACHA_COPY hint; (3) nothing — the owner flips `App bar: Off` themselves;
layouts already reflow because `--appbar-h` is measured (`DefaultRoot.tsx:261`).

⇒ **Least-coupled: a recommended-pairing note in the setting's `desc`. No coupling.**
Regardless: gacha still owes the "pin across appbar modes" device check (GACHA_PLAN:779) — the
poster's in-flow data block and the cover's raised stack both live against the appbar seam.

---

## Q6 — Kit vs theme placement

Governing patterns: §14.4.1 (`THEME_ENGINE.md:975-1020`, reskin=tokens-only, bespoke gets
structural CSS, layers win per property); §14.14 (`:1454-1546`, cheapest band wins, no
`if (theme === …)` in engine); the axis band (`:1905-1918` + `kit/axes.ts:1-13`, "promote when a
second consumer wants it"); the headless-controller law (`useFleet.ts:74-76`, `:151-155`).

| # | Feature | Layer | Why (precedent) |
|---|---|---|---|
| 1 | **Select-then-act POLICY** (tap router) | Shared headless (`hooks/useFleet.ts`) as an optional helper — or gacha-local if ruled concrete-first | Behaviour over the controller's own data + `run`; `toggleRow` (`store/fleet.ts:39-46`) is the existing multi-effect tap; §14.14 gate 3. **Risk: rule-of-three unmet (one consumer) — owner/main-seat call.** |
| 2 | **Selection STATE** (`selectedId`) | **Shared store — `store/fleet.ts`**, sibling to `featured`/`open` | `store/fleet.ts:1-6` (theme-agnostic home); id-keyed like `cosmosSelection.ts:13` / `frontierSelection.ts:14` (already duplicated twice — the third consumer). **NOT `featured`** (index + auto-cycle + 8s hold). |
| 3 | **Busy-on-card** | Theme markup + gacha CSS over the shared `busy` fact | `useFleet.ts:145`; kit's class+disabled (`kit/Fleet.tsx:130,145,167`); gacha's `aria-busy` (`GachaHostDetail.tsx:199`). No new busy channel. |
| 4 | **`fleetLayout` axis** | Theme (gacha): `ThemeDef.settings` seg + gacha-private stable-ref variant map + fallback-safe resolver switching only the **track body** | Setting+resolver half of composer (`setting.ts:10-24`, `ThemedComposer.tsx:10-17`, `variants.ts:6-22`); registry stays theme-local per §14.14 gate 2 + "Fleet stays Root-pinned" (`THEME_ENGINE.md:1522-1528`). |
| 5 | **Banner tri-state** | Theme (gacha) seg; `off` = conditional render in `GachaFleet`; `minimal` = body attr + `gacha.css` | `starMode` shape (`index.tsx:237-246`); attr-for-cosmetic vs prop-for-structural (`GachaRoot.tsx:26-29`); theme-wide, read once above the layout switch. |
| 6 | **Poster data block** | Theme (gacha) component, shared formatters | `hostDetailFacts` (`GachaHostDetail.tsx:58`), `pingText` (`fleet.ts:121-124` — "the ONE formatter"), `dossierSub`, `roleLabel`, `relativeTime`; uptime prints the ruled dash (`GachaHostDetail.tsx:74-76`). |
| 7 | **Rarity-hue (star→hue)** | Theme (gacha): extend `themes/gacha/stars.ts`; values are **tokens** | `stars.ts:1-10` (single source, pure), `:49-50` (tokens never literals); future kit share = `ThemeDef.present`/`VisualEncoding.color` (`types.ts:70-88`) — **do not build now.** |

Corollaries: chrome inheritance is structural by construction (`GachaRoot.tsx:109-122` overrides
only two `bodies` entries); the clip-path-erases-box-shadow trap is already paid for by the
shipped capsule card (`GachaCard.tsx:50-58`, `gacha.css` ~1121) — reuse the shipped idiom for the
poster's three-box slice.

---

## Q7 — The port's test surface

**Where fleet tests live:** `frontend/tests/themes/gachaFleet.test.tsx` (1803) ·
`gachaFleetDerive.test.ts` (287) · `gachaStars.test.ts` (77) · `gachaCarousel.test.ts` (213) ·
`gachaRoster.test.ts` (529) · `gachaChrome.test.ts` (985; seg-axis contract precedents `:374-378`,
`:555-596`) · `gachaDossier.test.tsx` (727) · `theme-engine/themeContract.test.ts` (Fleet a11y
invariant `:261-305`; setting defaults `:540-553`; contrast drift guard `:352-450`) ·
`settings.test.ts` · `axes.test.ts` · `composerSurface.test.ts` · `store/fleet.test.ts` (49) ·
e2e: `a11y.spec.ts:73, :134-150` · `layout.spec.ts:158-168` · `contrast.spec.ts` +
`contrast-matrix.ts:83-115` · `flows.spec.ts:59-110` · `fixtures.ts:299` `mockApi`, `:352` `seedUI`.

**Minimum pins for the port** (list, not written):

*Pure/unit:* ① `hueFor(stars)` every rung + ★1 floor + both starModes + sleeping suppression;
② new geometry helpers at N=0/1/2/4/many; ③ layout resolver unknown-id → default (mirror
`composerSurface.test.ts`); ④ the tap-router as a pure reducer incl. vanished-host;
⑤ two-step aria-label builder (4 strings) with `openLabel` byte-identical.
*Store:* ⑥ `selectedId` idempotent emit · cleared on host-gone · NOT written by `featureAuto` ·
`featured`/`HOLD_MS` unchanged.
*Render:* ⑦ first tap selects (no sheet), second opens dossier; ⑧ second tap on sleeping calls
`run("wake")` — assert POST shape AND **no ConfirmDialog** (`wake.py:17` + `permissions.py:7-8`);
⑨ tapping a different slice re-selects, no request; ⑩ busy reaches the slice
(`aria-busy`/`disabled`); ⑪ data block follows the live host through a poll + uptime dash;
⑫ selection survives poll reorder, drops on host-gone; ⑬ cover promote + four-buttons invariant +
sleeping-hero two-step; ⑭ one accessibly-named host control per machine PER LAYOUT (extend
`themeContract.test.ts:277-282` beyond the default); ⑮ reel gate holds per layout (mirror
`gachaFleet.test.tsx:1615-1643`); ⑯ layout switch does not remount dossier/morph (stable refs);
⑰ banner `off` = no `.gc-banner` AND no timer left (`gachaFleet.test.tsx:1752` pattern);
`minimal` keeps tag/display/pills/dots, drops caption; ⑱ banner-off top-space attribute asserted
(`gachaChrome.test.ts` text-reading style).
*Contract:* ⑲ seg key/order/labels/defaults for `fleetLayout` + the name-position setting; the
`showWhen` sibling-validity assertion; ⑳ `themeContract.test.ts:540-553` covers defaults free once
declared.
*e2e:* ㉑ poster axe scan (seed `themeSettings.gacha.fleetLayout` via `seedUI`); ㉒ a real
select-then-wake flow with routed `**/api/actions/wake_host` + the no-confirm-dialog negative;
㉓ contrast-matrix: layouts are NOT palettes so no new rows expected — **verify, don't assume**
(`contrast-matrix.ts:29`); rarity-hue-on-art contrast is a §14.11 device-round item.

---

## RISKS / UNKNOWNS (flagged, not guessed)

1. **Rule-of-three vs "put it in the kit"** — select-then-act has ONE consumer; `store/fleet.ts`
   selection is a defensible middle (data, already duplicated twice); the tap-router's home is a
   judgement call. → main-seat ruling.
2. **`busy` is per-host, not per-action** (`useActions.ts:60-68`) — a poster wake ceremony keyed
   off `busy` also lights during a dossier-fired reboot. May be desirable; unruled. Splitting busy
   touches four other fleets — flag only.
3. **`useFleetCycle` runs under gacha for nothing** (`useFleet.ts:84-121`, `App.tsx:148`) —
   harmless today; if a poster subscribes to the store it re-renders per 6s tick. Deliberate
   decision needed (gate on a consumer, or leave).
4. **The `off`-banner top-space gap** (`gacha.css:813-816` vs `:1068-1073`; `:first-child`
   inapplicable because of `GachaStarDefs`) — CSS-authoring call.
5. **`minimal` height unspecified in production terms** — lab is 88px `--u`-relative; shipped
   banner is flat 232px. Flat px vs clamp vs token: unruled.
6. **`showWhen` is net-new engine surface** — small but new settings-pipeline behaviour, covered
   by `themeContract.test.ts` + `settings.test.ts` extensions.
7. **Stale setting values never pruned** — pick stable keys once; a rename later needs a
   `stripLegacyAppbar`-shaped fold (no-legacy-seams directive).
8. **`GachaFleet.tsx` split boundary is hard** — 632 lines, 8 interlocking refs (`:125-453` must
   not move); a variant switch that remounts the body resets all of it (`variants.ts:6-8` hazard).
9. **COVER's N-scaling** — the lab nests a scroller inside the stack; production shares one
   `#app-scroll` (`DefaultRoot.tsx:187-192` + `useScrollKeep`) — a nested scroller is a new
   pattern here. Unproven.
10. **No mobile-engine cost numbers for N clip-path polygons on a scroller** — §12.4 E3's stated
    hole; the Fennec+Chrome device round is the real acceptance.
11. **Rarity-hue collision on real fleets** — ruled-recorded, unresolved; device-round call.
12. **No wake e2e exists today** (`flows.spec.ts:59-110` covers shutdown only) — one-tap wake
    raises the stakes; add the explicit no-confirm negative.
13. **C is PARKED, not killed** — the `fleetLayout` seg's three-value set is what enforces the
    "maximum three" cap; make that explicit so no future slice quietly adds a fourth.
