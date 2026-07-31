# Vapor assimilation — the complete-migration plan (vapor → kit, legacy deleted)

> **Status: DRAFT — design NOT locked.** Drafted 2026-07-31 from the owner's rulings in that
> session. **Before build:** (1) the owner's device round over vapor (esp. the Agent tab — the
> port-vs-switch list, §5), (2) the council round (Codex + review) on this plan, (3) the D-entry
> lock in `DECISIONS.md`. Build = TODO **Phase 16**. This plan AMENDS `THEME_ENGINE.md` §14.15.3
> (the ladder survives; its end-state bar and sequencing change per §1). On conflict after the
> lock: DECISIONS wins.

## 1. Owner rulings (2026-07-31 — supersede the ladder's hedges)

1. **Complete migration; no permanent bespoke remainder.** The kit's purpose *was* to implement
   vapor's functionality as a modular system. Port vapor component-by-component onto the kit and
   **delete each legacy piece as its port lands**. Where the kit cannot express vapor's look,
   **extend the kit** (new variant / skin / slot capability through the sanctioned seams — D31
   3-gate, D37 axes) rather than keeping vapor-only code. This resolves the ladder's V4/V5 tension
   ("forcing vapor into a Kit mold is the anti-pattern") the other way around: don't force into
   *existing* molds — grow the mold, then delete the bespoke copy.
2. **Cosmos becomes `DEFAULT_THEME`.** Vapor stops being the eager default; the moon-and-planets
   theme is the default from now on. (This fires the trigger §14.15.4 recorded for exactly this:
   "per-theme-eager-CSS rework — revisit only if the owner permanently settles on another theme".)
3. **Composer:** vapor adopts the kit **`sheet`** (docked bottom-sheet) composer variant — the one
   vapor's own composer already resembles. Expected migration = tokens/colors (+ a vapor
   `composerSkin` block if needed); vapor's bespoke `components/Composer.tsx` is then deleted.
4. **App bar:** vapor adopts the kit AppBar, and the kit gains vapor's one distinctive: the **brand
   lozenge** — an optional icon slot that can hold an image (logo) or a spinning ring
   (today: `body[data-loz]`, written by VaporRoot from theme settings). Extend the kit AppBar with
   that capability; delete `components/AppBar.tsx`.
5. **Chat (Agent tab): migrate it too.** If vapor's chat is too structurally different for tokens,
   **extend the kit to render the vapor chat look** (a ChatSurface variant per the D31 3-gate /
   §15 rule 2 — that IS the sanctioned extension seam). The owner is re-checking vapor's chat on
   device and will bring a port-vs-switch list (§5) before this slice locks.

## 2. Verified as-is state (main-seat sweep, 2026-07-31 — all six §14.15.3 hooks live)

| Hook | Where (verified) |
|---|---|
| ① accent on `body[data-theme]` | `store/ui.ts` `applyBodyAttrs` (~:218; doc's :198 drifted) + `index.html:39` FOUC script |
| ② non-contract tokens | `--magenta`/`--ink*` throughout; Waveform vapor-private reads at :192/:194; `--accent-rgb`/`-2` live-reads at :57-58 (the V2 canary) |
| ③ unprefixed `@keyframes` | 13 in `theme/vapor.css` + 8 in `theme/extras.css`; stylelint disables the prefix rule for `src/theme/` ("THIS ALLOWLIST ENTRY IS THE §14.15.3 TRACKER") |
| ④ parallel chrome | `components/AppBar.tsx` / `Composer.tsx` / `TabBar.tsx`, imported by VaporRoot |
| ⑤ `isVapor` gate | `tabs/AgentTab.tsx:76/92/102` (PinnedPlan) |
| ⑥ CSS home | `theme/`: `vapor.css` (1177 ln) · `extras.css` (~3000 ln, vapor-`@scope`d styling of the SHARED components — the deletion iceberg) · `vapor-fonts.css` · `heroScene.ts`; `themes/vapor/` holds only VaporRoot + index |

Other verified anchors: `DEFAULT_THEME = "vapor"` at `theme-engine/resolve.ts:16` (heal target
`resolve.ts:55`, switch defaults via `defaultSwitchTarget`) · vapor is EAGER (static `@import` of
`vapor.css`/`extras.css` in `theme/index.css:38-39`; `vapor-fonts.css` from `main.tsx`; kit
tokens/kit.css/axes.css are ALSO already eager at `layer(base)`/`layer(axes)`) · vapor.css
`[data-theme]` selectors at exactly **58/107/113/162** (the §14.15.3 refs are current) · e2e
`flows.spec.ts` asserts a VAPOR boot (bg `rgb(10,3,22)`) at ~:130 and the accent flip at ~:139 ·
B2 waiver constant = `tests/theme-engine/themeContract.test.ts:53`
`vapor: ["semantic-tokens", "keyframe-prefix", "accent-axis", "kit-structure"]`, each annotated
with its retiring rung · kit composer variants = `KitComposer` (stacked) / `SheetComposer` /
`LineComposer` (`theme-engine/kit/composer/`) · cosmos = lazy bespoke-Fleet + kit-chrome theme
(`themes/cosmos/index.tsx`).

## 3. Slices (each independently shippable, D7-eyeball-gated, paused between per the cadence)

### V0 — cosmos becomes the default (NEW slice, first: it de-flagships vapor so every later slice is lower-stakes)
- Flip `DEFAULT_THEME` to `"cosmos"` (resolve.ts — the one chokepoint; heal path +
  `defaultSwitchTarget` follow). Persisted choices are UNTOUCHED — existing devices keep whatever
  theme they picked; the default governs fresh boots + the registry-heal target.
- **Eager-CSS rework:** cosmos's `tokens.css` + `cosmos.css` join the eager path (static import;
  kit.css is already eager) so a fresh cosmos boot has no FOUC; verify the FOUC script stamps
  `data-skin`/`data-mode`/`data-accent` for a cosmos boot pre-paint (it already handles non-vapor
  attrs — verify, don't assume). Vapor's CSS goes LAZY here or in V1 (build-time call; §14.15.4's
  kit.css `@layer`-wrap precondition does NOT apply — kit.css stays eager).
- `ui.ts` DEFAULTS + first-boot defaults for cosmos (mode/accent); `migrateLegacyTheme` and the
  FOUC twin keep their current meaning (they migrate OLD persisted shapes, not the default).
- e2e: `flows.spec.ts` boot assertions re-target a cosmos boot (bg token, `data-skin`); a vapor
  spec section keeps covering vapor-by-choice (switch first, then assert :139's accent flip).
- Sanity: SW precache picks up the changed chunk graph; cold-boot into BOTH defaults-path and
  persisted-vapor-path eyeballed on device.

### V1 — file + keyframe hygiene (unchanged from §14.15.3, plus the lazy flip if not in V0)
- Move `theme/{vapor.css, extras.css, vapor-fonts.css, heroScene.ts}` → `themes/vapor/`; re-point
  the imports (`theme/index.css` @imports; `main.tsx` fonts import — these become vapor-lazy
  imports if V0 didn't already flip them).
- Prefix all 21 keyframes `vapor-*` (13 vapor.css + 8 extras.css) + their `animation:` call sites;
  delete the `src/theme/` stylelint override (the tracker entry) — the `themes/vapor/` dir then
  falls under the standard per-theme `vapor-` prefix rule (add its override block like the other
  themes'). B2 waiver retires `keyframe-prefix`.
- `theme/index.css` survives as the global entry (kit tokens/kit/axes + reset) — only vapor's
  lines leave it.

### V2 — accent axis (`data-theme` → `data-accent`), ONE atomic commit (unchanged from §14.15.3)
- Five touchpoints, refs re-verified 2026-07-31: `applyBodyAttrs` (~ui.ts:218 — the vapor branch
  collapses into the shared mode/accent stamping) · `index.html` FOUC vapor branch (:39) ·
  vapor.css 58/107/113/162 → `[data-accent="aqua"|"ember"]` · flows.spec (~:139) ·
  THEME_ENGINE §13.1 frozen-attr table refresh. Canary: the Waveform bar color must still shift on
  a palette pick (each palette block defines `--accent-rgb`). Accent VALUES unchanged →
  `migrateLegacyTheme` + FOUC twin stay. B2 waiver retires `accent-axis`; hooks ①⑤→① dead.

### V3 — semantic-token mapping (unchanged from §14.15.3)
- Map vapor's vocabulary onto the contract at the top of its sheet (`--accent: var(--magenta)` etc.
  — aqua remaps `--magenta` to cyan, so it IS "the primary accent"); `--accent-fill` carries
  vapor's gradients (the two-channel seam, §14.15.1 ⑨ — already wired at every kit fill site).
  @layer order must hold. B2 waiver retires `semantic-tokens`. Re-point Waveform's vapor-private
  reads (`--magenta` :192, `--ink-faint` :194) at contract tokens (pulled forward from the old V4
  rider — it's a 2-line leaf once the mapping exists).

### V4 — per-component graduation, LOW-divergence first; each port DELETES its legacy block from extras.css/vapor.css
Order (amend after the owner's device list): Conf editors → shared overlays (precondition: re-scope
the overlay CSS out of `.kit` descendant selectors FIRST — §14.15.4, both prior review agents
missed it) → **TabBar** → **AppBar** (kit gains the brand-lozenge capability: an optional icon slot
taking a logo image or a spinning ring; `data-loz` becomes a theme setting driving the KIT slot,
not a vapor body attr) → **Composer** (vapor registers the kit `sheet` variant + tokens/skin;
bespoke Composer.tsx deleted; PinnedPlan relocates to the kit plan family, killing hook ⑤ if V2
didn't) → **chat LAST via the D31 3-gate:** tokens/theme-CSS on the §15 hooks first; where vapor's
chat is structurally divergent (pulse, `▸/▾` disclosure, terminal gestalt), a **ChatSurface
variant** rendered from the shared `useAgentChat` state (the §15 rule-2 birth condition — this IS
the "extend the kit" ruling applied to chat). V4 rider kept: promote `--accent-rgb`/`-2` into the
contract as canvas channels when a shared canvas graduates (derive from `--accent` in JS per
readColors tick).

### V5 — the deletion sweep (tail)
- Delete `components/AppBar.tsx`/`Composer.tsx`/`TabBar.tsx` (once no VaporRoot import remains),
  the emptied extras.css blocks, and any dead `theme/` remnants; VaporRoot shrinks toward a thin
  Root over kit surfaces (it may remain as vapor's Root shell — a *registered* Root is engine-native,
  not legacy). B2 waiver retires `kit-structure`; the vapor waiver list hits `[]`; the §14.15.3
  banner in THEME_ENGINE flips to DONE. Vapor's `sections` waiver (4-tab-only, `themes/vapor/
  index.tsx:28`) is re-examined here: on kit surfaces the 3/2-tab presets may Just Work.

## 4. Kit extensions this plan creates (the "grow the mold" list — each lands with its V4 port)
1. **AppBar brand-lozenge slot** (logo image | spinning ring | none; per-theme setting). New kit
   capability, usable by any theme (gacha will likely want a logo slot too).
2. **A vapor `composerSkin`** if the existing four (outline/glass/bezel/sleek) can't carry vapor's
   composer chrome — else just tokens. Decide at the composer port.
3. **ChatSurface variant seam** (if chat needs it): the §15 rule-2 birth — kit chat-element
   presenters + a view shell split out of AgentTab. This is the plan's largest single work item and
   benefits every future theme (gacha again).

## 5. Open questions → the owner's device round (bring answers to the design-lock session)
1. **Agent tab:** which vapor-chat elements must survive verbatim (pulse? `▸/▾` disclosure?
   terminal gestalt? the in-tab pinned plan?) vs adopt the kit chat look? This decides
   tokens-vs-ChatSurface at the chat slice.
2. **Per-component port-vs-switch list** for the rest (the owner is compiling while checking the
   theme): anything vapor-only that should simply DROP rather than port (e.g. skyline? hero scene?
   lozenge spin?) — deletion is cheaper than extension.
3. **Lozenge:** confirm the spin behavior is wanted in the kit slot (owner: "maybe, I forgot").
4. **Cosmos first-boot defaults:** which mode/accent should a fresh cosmos boot show?
5. **Existing devices:** OK that persisted vapor choices stay until manually switched (no forced
   migration)?

## 6. Method (unchanged): per slice — pinned Opus build brief → main-seat audit → Codex round →
waves to WAVE CLEAN → owner D7 eyeball on device → pause. Council round on THIS PLAN before the
D-entry lock; the lock records the §1 rulings + any §5 answers. Standing guarantees (§14.15.3)
hold every slice: nothing new depends on a legacy hook; waiver lists only shrink; `DEFAULT_THEME`
never a `"vapor"`/`"cosmos"` literal outside resolve.ts.
