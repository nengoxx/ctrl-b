# Vapor assimilation — the complete-migration plan (vapor → kit, legacy deleted)

> **Status: DRAFT — design NOT locked.** Drafted 2026-07-31 from the owner's rulings; **council
> round DONE 2026-08-01** (Codex `gpt-5.6-sol` correctness lens + one Opus 5 architecture lens,
> both verdicts **LOCK WITH CHANGES**) — all findings reconciled by the main seat and folded into
> this v2; the ruling-by-ruling record is §7. **Before build:** (1) the owner's device round (§5),
> (2) reviewer confirm rounds on this amended draft, (3) the D-entry lock in `DECISIONS.md`.
> Build = TODO **Phase 16**. This plan AMENDS `THEME_ENGINE.md` §14.15.3 (the ladder survives; its
> end-state bar and sequencing change per §1). On conflict after the lock: DECISIONS wins.

## 1. Owner rulings (2026-07-31 — supersede the ladder's hedges)

1. **Complete migration; no permanent bespoke remainder.** The kit's purpose *was* to implement
   vapor's functionality as a modular system. Port vapor component-by-component onto the kit and
   **delete each legacy piece as its port lands**. Where the kit cannot express vapor's look,
   **extend the kit** (new variant / skin / slot capability through the sanctioned seams — D31
   3-gate, D37 axes) rather than keeping vapor-only code.
2. **Cosmos becomes `DEFAULT_THEME`.** Vapor stops being the eager default; fresh boots + the
   registry-heal target go to cosmos. Persisted choices untouched.
3. **Composer:** vapor adopts the kit **`sheet`** variant; bespoke `components/Composer.tsx` deleted.
4. **App bar:** vapor adopts the kit AppBar; the kit gains the brand-lozenge capability (shape
   council-refined → §4.1); `components/AppBar.tsx` deleted.
5. **Chat (Agent tab): migrate it too** — extend the kit *if* vapor's chat is too structurally
   different for tokens. (Council finding: the evidence says it is NOT — see §7 R3; the owner's §5
   list settles it.)

### 1.1 The pinned end state (council, 2026-08-01): **vapor takes cosmos's shape**

"No bespoke remainder" means **no bespoke duplicate of a kit capability** — not zero vapor code.
Cosmos is the precedent for the good end state: a thin Root on **DefaultRoot hosting** (kit
AppBar/TabBar/composer/Conf/chat) + a **Root-pinned bespoke Fleet** + `tokens.css` + a residual
theme sheet limited to that bespoke surface. Vapor ends the same way: **VaporFleet (hero, skyline,
waveform, device/service presentation) is bespoke-by-right** — engine-native under D31, recorded in
the D-entry — and the residual `vapor.css` styles only it. Everything else ports and its legacy
copy dies. (`tabs/FleetTab.tsx` is already vapor-only by its own comment; it and Hero/Waveform/
`heroScene.ts` move into `themes/vapor/` at V1 — vapor-only components stop squatting shared dirs.)

## 2. Verified as-is state (main-seat sweep 2026-07-31; council corrections 2026-08-01)

| Hook | Where (verified) |
|---|---|
| ① accent on `body[data-theme]` | `store/ui.ts` `applyBodyAttrs` (~:218) + `index.html:39` FOUC script |
| ② non-contract tokens | `--magenta`/`--ink*` throughout; Waveform vapor-private reads :192/:194; `--accent-rgb`/`-2` live-reads :57-58 (the V2 canary) |
| ③ unprefixed `@keyframes` | **20, not 21** (Codex): **12** real in `theme/vapor.css` (the 13th grep hit is a header comment) + **8** in `theme/extras.css`; stylelint `src/theme/` override = the tracker |
| ④ parallel chrome | `components/AppBar.tsx` / `Composer.tsx` / `TabBar.tsx`, imported by VaporRoot |
| ⑤ `isVapor` gate | `tabs/AgentTab.tsx:76/92/102` (PinnedPlan) |
| ⑥ CSS home | `theme/`: `vapor.css` (1177 ln) · `extras.css` (~3000 ln, vapor-`@scope`d styling of SHARED components — the deletion iceberg) · `vapor-fonts.css` · `heroScene.ts` |

Council-verified additions that reshape the plan:
- **The `.kit` marker**: kit.css has ~564 `.kit`-descendant selectors and VaporRoot renders
  `app-shell`, no marker — **nothing of kit.css applies under vapor today**. Any first port of a
  shared component needs the marker, and the marker lights up kit.css+axes.css everywhere at once
  (Opus A2 ≡ Codex #8) → the shell graduation is its own slice (V4).
- **Chat is already unified**: `components/ChatThread.tsx` (683 ln) renders ONE DOM for every
  theme; vapor's chat divergence = CSS + the 35-ln `PinnedPlan`. The kit already has
  `planPlacement: "pinned"` + `PinnedPlanPanel` — vapor declaring that default deletes PinnedPlan
  outright (Opus A3).
- **The kit AppBar already has a slot precedent**: `brandMeta?: ReactNode` (DefaultRoot.tsx:76).
- **Default mirrors beyond resolve.ts** (Codex #2): `index.html` static stamp (:2) + bootstrap
  default (:28) + corrupt-storage fallback (:45); backend `AppearanceCfg` default
  (`backend/app/config.py:827`); e2e fixtures; reset/heal unit tests.
- **V3 traps** (Codex #4/#5): aqua/ember override `--magenta`/`--ink*` on `body` while base tokens
  live on `<html>` — aliases must be declared on `body` at/below the accent overrides (the §14.4.1
  formula-token trap). Vapor's `--accent-glow` is a `drop-shadow()` *filter* value while kit.css:338
  consumes `--accent-glow` as *box-shadow* — rename the vapor filter token. `themeContract.test.ts`
  reads exactly `src/themes/<id>/tokens.css` (`TOKENS_RAW`, :25/:198) — retiring the
  `semantic-tokens` waiver REQUIRES a real `themes/vapor/tokens.css`.
- Other anchors re-confirmed exact: vapor.css `[data-theme]` at 58/107/113/162 · `isVapor` :76/92/102 ·
  waiver list `themeContract.test.ts:53` · eager imports (`theme/index.css:38-39`, fonts in
  `main.tsx`) · **no runtime `[data-theme]` readers beyond the four selectors + two writers**
  (Codex — V2's production list is complete; the missing touchpoints are tests/docs) · Workbox
  default glob precaches the chunk graph.

## 3. Slices (each independently shippable, D7-eyeball-gated, paused between per the cadence)

### V0 — cosmos becomes the default: **the flip only** (no CSS pipeline rework)
- Flip `DEFAULT_THEME` to `"cosmos"` in resolve.ts (+ heal + `defaultSwitchTarget` follow), plus
  the **default-mirror matrix** (Codex #2): `index.html` static `data-skin` stamp / bootstrap
  default / corrupt-storage fallback · `ui.ts` first-boot triple (mode/accent per the owner's §5
  answer) · backend `AppearanceCfg` default · e2e fixture defaults. The §14.15.3 "no theme literal
  outside resolve.ts" guarantee is AMENDED to a **documented-mirror allowlist** (those exact spots —
  the FOUC twin was always one).
- **Test retarget table** (Codex #10): `flows.spec.ts` implicitly boots vapor throughout — seed
  vapor explicitly for vapor-specific cases (`.dev`, composer textarea, shutdown-on-Fleet,
  Waveform, the :139 accent flip), add a dedicated fresh-cosmos-default boot test; retarget
  `a11y.spec.ts`'s default arm, `App.test.tsx` reset expectations, heal tests.
- **Flake guard on the new default-boot tests** (Opus confirm, MED): the fresh-default boot is now
  the only path whose CONTENT is gated on a lazy chunk — the fresh-cosmos test and the retargeted
  a11y arm must await a *content* selector (never bg/`data-skin`, which the FOUC script paints
  before the Root mounts) and must not use fixed waits. e2e only runs at the tag gate and v1.4.5
  burned on exactly this flake class — name this in the V0 brief.
- `migrateLegacyTheme` + the FOUC twin keep their meaning (old `dark/aqua/ember` → vapor, NOT cosmos).
- **No eager/lazy changes**: vapor stays eager (unchanged); cosmos keeps its lazy Root — a fresh
  boot behaves exactly like today's cosmos-by-choice boot (FOUC script paints correct bg/skin
  pre-paint; content appears when the chunk lands). Accepted trade on a single-user box where
  fresh boots are rare; **owner eyeballs a cold fresh boot at V0** and we escalate only if it
  offends (the escalation path — inline critical tokens, theme-agnostic — is recorded, not built).
- Sanity: SW precache manifest inspected; cold-boot into BOTH fresh-default and persisted-vapor
  paths eyeballed on device.

### V1 — file + component hygiene, keyframes
- Move `theme/{vapor.css, extras.css, vapor-fonts.css, heroScene.ts}` → `themes/vapor/`, re-point
  imports **keeping them eager** (the lazy flip is DEFERRED to the tail — see V6; preconditions
  recorded there per Codex #3).
- **Move the vapor-only components too** (Opus Q7): `tabs/FleetTab.tsx` + Hero/Waveform components
  → `themes/vapor/` (they read `useThemeSetting("vapor", …)` and serve no other theme).
- Prefix all **20** keyframes `vapor-*` (12 + 8; kebab names, e.g. `vapor-tts-glow`) + their CSS
  call sites (Codex verified: no JS/TSX `animationName`/`getAnimations` references exist); delete
  the `src/theme/` stylelint override, add the standard `themes/vapor/` block. B2 waiver retires
  `keyframe-prefix`.

### V2 — accent axis (`data-theme` → `data-accent`), ONE atomic commit
- Five production touchpoints (complete per Codex): `applyBodyAttrs` (~ui.ts:218) · `index.html`
  FOUC vapor branch · vapor.css 58/107/113/162 → `[data-accent="aqua"|"ember"]` · flows.spec ~:139 ·
  THEME_ENGINE §13.1 refresh. PLUS the test touchpoints Codex found: `tests/store/ui.test.ts:37` +
  the attribute switch-chain `themeContract.test.ts:274`.
- Canary: Waveform bar color still shifts on a palette pick. Accent VALUES unchanged →
  `migrateLegacyTheme` + FOUC twin stay. B2 waiver retires `accent-axis`; **hook ① dies here**
  (the old "①⑤" was a typo — ⑤ dies at V4's plan port).

### V3 — semantic-token mapping (council-hardened)
- Create **`themes/vapor/tokens.css`** (loaded with vapor + a `TOKENS_RAW.vapor` entry — required
  by the conformance-test contract, Codex #5) carrying the COMPLETE contract token set, not just
  accent/text aliases.
- **Palette-derived aliases declared on `body`, at/below the aqua/ember overrides** — never on
  `:root`/`:scope` above them (the §14.4.1 formula-token trap; kit components would stay pink under
  aqua/ember while legacy rules recolor, Codex #4). Computed-style tests probe kit elements under
  all THREE vapor accents.
- **Rename vapor's `--accent-glow`** (a filter value) so it cannot collide with the kit's
  box-shadow-valued contract token (kit.css:338); define the contract value properly.
- `--accent-fill` carries vapor's gradients (§14.15.1 ⑨). @layer order asserted. B2 waiver retires
  `semantic-tokens`. Re-point Waveform's vapor-private reads (:192/:194) at contract tokens.
- **The extras.css banner classification lands here, before any deletion starts** (Opus A4 ≡ Codex
  #12): every `/* ── … ── */` banner classified {port-owned → which slice · kit-duplicate → delete
  at V4 · vapor-keeps (Fleet/decoration) · owner-approved drop}, with a **shrink-only banner-set
  test** in the existing waiver idiom (themeContract.test.ts holds the precedent) that must reach
  ∅-minus-vapor-keeps by V6. Shared keyframes/selectors (`modal-fade`, `tag-pulse`, motion/perf
  globals) get explicit ownership so no port deletes behavior another component still uses.
  **The vapor-keeps bucket is an ENUMERATED banner list frozen here** (Opus confirm — "decoration"
  as a re-made category judgement is the drift vector); it is amendable only by an explicit
  ruling, and V6 asserts the residue EQUALS the list. The `data-skyline` ledger row is resolved
  here too (it lands in vapor-keeps or it doesn't — not decided at the tail).

### V4 — the shell graduation (the pivot slice): VaporRoot → DefaultRoot hosting
ONE slice, the cosmos-proven shape (this replaces the old per-component TabBar/AppBar/Composer
ports — three separate swaps inside `app-shell` would each hit the kit shell contract Codex #6
documents: `.kit-main` containing block, `.kit-scroll` padding, `--composer-h` measurement, slot
composition; DefaultRoot provides all of it natively, and building that scaffolding inside
VaporRoot only to delete it again would violate fix-in-the-owning-phase):
- VaporRoot becomes a thin Root over **DefaultRoot** — kit AppBar (+ **`brandMark` slot**, §4.1),
  kit TabBar, kit **`sheet`** composer (tokens first; a new skin only if needed, §4.2),
  **Root-pinned VaporFleet** body (the §1.1 bespoke-by-right surface), `planPlacement: "pinned"`
  (deletes `PinnedPlan` + the `isVapor` gate — hook ⑤ dies).
- **Vapor DECLARES the kit axis/seg settings — no silent resolver defaults** (Opus confirm,
  HIGH): its `ThemeDef.settings` gains the four descriptors cosmos already declares
  (`composerLayoutSetting("sheet")` · `composerSkinSetting(…)` · `planPlacementSetting("pinned")` ·
  `outlinesSetting(…)`, cosmos precedent `themes/cosmos/index.tsx:67-76`) with explicit defaults
  chosen at the port and their Appearance rows eyeballed in the same round. Undeclared, the
  resolvers default vapor to kit-native (outlines ON, skin `outline`) with no picker rows to
  change it. Also update the `layouts: ["4-tab"]` waiver comment (`themes/vapor/index.tsx:28`) —
  "VaporRoot never consumes the section registry" becomes false at this slice; the waiver turns
  from structural into plain forced-coercion until its V6 retirement (ledger row).
- The `.kit` marker arrives here **once**, and the owner's D7 eyeball covers the ENTIRE kit
  co-application surface (chat, Conf, overlays, plan, markdown light up together — bounded to this
  slice by design, Opus A2). Vapor's extras.css `@scope` blocks still override via the theme layer,
  so the visual delta is kit-fills-what-vapor-never-set.
- Delete commits (separate from the port commit, Opus A8): `components/AppBar.tsx`,
  `Composer.tsx`, `TabBar.tsx`, `PinnedPlan` once unreferenced; their kit-duplicate extras.css
  banners (per the V3 classification).
- Device checks pinned in the brief: Fennec keyboard/visualViewport, long-draft, autocomplete,
  plan, tools menu, Stop, the no-composer-tab case (Codex #6's list); both vapor accents ×
  light/dark.

### V5 — the deletion ladder (per-banner, port-verify → delete)
- Work through the classified banners: chat (tokens/theme-CSS fidelity per the owner's §5 list —
  pulse, `▸/▾`, terminal gestalt survive as vapor theme-CSS on the §15 hooks) · Conf editors ·
  plan · markdown · Utils/Tool Catalog · root/global cross-cutting rules (focus ring, motion/perf
  gates — kit-duplicates die, per classification).
- Every deletion passes an `rg` zero-reference gate; **port and delete are separate commits** so a
  failed eyeball reverts the delete alone. The banner-set test enforces monotonic shrink.
- The **overlay hoist** (App-level mounts, §14.15.4) is INDEPENDENT cleanup, not a precondition:
  under DefaultRoot vapor sits inside `.kit`, so kit overlay styling applies. If/when hoisted,
  Codex #9's constraint list governs (contextual `:has()` chains, body-mode/perf selectors,
  re-scope→verify-nested→hoist ordering; MiniPlayer/Toasts/Confirm/Prompt/`.auto-pm` never
  silently dropped).

### V6 — the tail: residue, waivers, ledgers, lazy
- `vapor.css` shrinks to the frozen vapor-keeps residue; dead `theme/` remnants die. The end
  state is ENFORCED, not just reviewed (Opus confirm): the banner-set test asserts the residue
  **equals** the V3-frozen vapor-keeps list, and a mechanical source assertion pins "VaporRoot
  renders `DefaultRoot` and imports none of `components/{AppBar,Composer,TabBar}`" (the waiver
  list hitting `[]` is the third leg).
- B2 waiver retires `kit-structure` → the vapor waiver list hits `[]`; the §14.15.3 banner flips
  DONE. The `sections` waiver retires ONLY once vapor consumes the shared body/layout partition,
  with real 2/3-tab navigation tests replacing the forced-four-tab assertions (Codex #11 — kit
  chrome alone does not make it "just work").
- **The vapor lazy flip happens here (or is dropped if the residue is trivial)** — preconditions
  per Codex #3: internal `@layer theme` wrap in the sheets (a dynamically-imported sheet loses the
  `@import … layer(theme)` wrapper and its rules become UNLAYERED = stronger), a font loader that
  awaits faces, a first-paint test on the persisted-vapor path.
- Close the ledgers (§3.1) and the doc retirements; `VAPOR_PATTERNS.md` gains a banner pointing
  net-new-UI guidance at the kit/THEME_ENGINE (it is written in vapor's idiom — Opus Q7).

### 3.1 The retirement ledgers (kept current every slice; close at V6)
| Vapor body attr | Retires at |
|---|---|
| `data-theme` (accent) | V2 |
| `data-loz` | V4 (becomes a theme setting driving the kit `brandMark` slot) |
| `data-skyline` | ruled at V3's classification (vapor-keeps or not); executed V5/V6 |
| `data-tab` | V4 (DefaultRoot's mechanism; the `layouts` waiver comment updates here too) |

Doc retirements: §13.1 frozen-attr table (V2, V4) · §14.4.1 two-trees invariant (V4) · §15 rule 3
(V4) · §14.14 / D31 / D36 vapor-frozen phrasing (V6). Each slice's brief names its rows.

## 4. Kit extensions this plan creates (council-tightened)
1. **AppBar `brandMark?: ReactNode` slot** — following the existing `brandMeta` precedent two
   lines away. **No `loz` enum, no ring knowledge in the kit**: vapor passes its spinning ring (or
   logo) in as a node; gacha gets a logo slot free (Opus A6).
2. **A new composer skin ONLY if `sheet` + tokens genuinely can't carry vapor's chrome** — and if
   born it is **look-named** (never `vapor`), offered to every theme, justified by what it does
   (Opus A7; D37's authority rule makes theme-named skins the trap).
3. **ChatSurface: STRUCK — not authorized by this plan** (Opus A3). ChatThread already renders one
   shared DOM; a Surface today would be a registry-of-one enshrining vapor's markup, failing D31's
   own ≥2-implementations gate. Chat = tokens + theme-scoped CSS on the §15 hooks; if a specific
   element can't reach fidelity it escalates **per-element**; a whole-surface variant requires its
   own design + council round.

## 5. Open questions → the owner's device round (bring answers to the design-lock session)
1. **Agent tab:** which vapor-chat elements must survive verbatim (pulse? `▸/▾` disclosure?
   terminal gestalt? in-tab pinned plan?) vs adopt the kit chat look? (Decides the V5 chat-CSS
   fidelity bar — NOT a ChatSurface, per §4.3.)
2. **Port-vs-drop list:** anything vapor-only that should simply DROP (skyline? hero scene?
   lozenge spin?) — deletion is cheaper than porting.
3. **Lozenge:** is the spinning-ring behavior wanted (as vapor's `brandMark` content)?
4. **Cosmos first-boot defaults:** which mode/accent should a fresh cosmos boot show?
5. **Existing devices:** confirm persisted vapor choices stay until manually switched.
6. **NEW — the fresh-boot trade (V0):** a fresh cosmos-default boot paints the right background
   instantly but content pops in when the lazy Root chunk lands (identical to picking cosmos
   today). Acceptable, or should the escalation path (inline critical tokens) be built?

## 6. Method (unchanged) + the confirm step
Per slice: pinned Opus build brief → main-seat audit → Codex round → waves to WAVE CLEAN → owner
D7 eyeball on device → pause. **Council round on this plan: DONE 2026-08-01** (verdicts above);
the reconciliation is §7; reviewer confirm rounds run on this amended draft before the lock. The
lock records the §1/§1.1 rulings + the §5 answers + the §7 overrules. Standing guarantees hold
every slice: nothing new depends on a legacy hook; waiver lists only shrink; theme literals only
in resolve.ts **plus the documented-mirror allowlist** (V0).

## 7. Council reconciliation record (main seat, 2026-08-01)
Codex lens = correctness/failure-modes (13 findings); Opus lens = architecture/maintainability
(8 findings + Q7). Both: LOCK WITH CHANGES. Rulings:

| # | Finding | Ruling |
|---|---|---|
| R1 | Opus A1 ≡ Codex #7: no defined end state; Fleet/Utils/root never graduate | **ACCEPT** → §1.1 pinned end state; V5 covers the full classified inventory |
| R2 | Opus A2 ≡ Codex #8: `.kit` marker is a big-bang no slice owns | **ACCEPT** → V4 shell-graduation slice owns it once |
| R3 | Opus A3: ChatSurface fails D31's own gate; PinnedPlanPanel already exists | **ACCEPT** → §4.3 struck; `planPlacement:"pinned"` at V4. Not a reversal of owner ruling §1.5 — the owner said extend *if* needed; the evidence says not |
| R4 | Opus A4 ≡ Codex #12: deletion unownable without classification + ratchet | **ACCEPT** → V3 classification + shrink-only banner test + rg gates |
| R5 | Codex #1: cosmos not truly eager (lazy Root, Suspense null, fonts) | **FINDING ACCEPTED, PRESCRIPTION OVERRULED** — eager-izing the Root/fonts restructures the loading pipeline for the rare fresh boot; we accept today's cosmos-by-choice boot behavior, owner eyeballs at V0 (§5 Q6), escalation path recorded not built |
| R6 | Codex #2: default-mirror matrix beyond resolve.ts | **ACCEPT** → V0; guarantee amended to the documented-mirror allowlist |
| R7 | Codex #3: lazy vapor = cold flash + unlayered-CSS bug | **FINDING ACCEPTED, LEANER FIX** — vapor stays eager until V6; preconditions recorded there; no cold-load gate built |
| R8 | Codex #4/#5: alias placement trap · `--accent-glow` collision · tokens.css required by test contract | **ACCEPT** → V3 hardened |
| R9 | Codex #6: composer swap breaks without the kit shell contract | **ACCEPT, RESHAPED** — per-component chrome swaps replaced by the V4 DefaultRoot pivot (cosmos precedent); scaffolding-then-delete rejected per fix-in-the-owning-phase |
| R10 | Opus A5: V0 bundled CSS rework pessimizes the owner's device | **ACCEPT** → V0 is flip-only; Codex #1/#3 strengthened this |
| R11 | Codex #9: overlay re-scope real but understated (`:has()` chains) | **ACCEPT** → V5; hoist demoted to independent cleanup (DefaultRoot puts vapor inside `.kit`, so overlays style correctly without it) |
| R12 | Codex #10: V0/V2 test touchpoints incomplete | **ACCEPT** → retarget tables in V0/V2 |
| R13 | Codex #11: sections waiver won't "just work" | **ACCEPT** → V6 conditions + real 2/3-tab tests |
| R14 | Codex #13: 20 keyframes, not 21 | **ACCEPT** → §2/V1 corrected |
| R15 | Opus A6/A7: `brandMark` slot, look-named skins | **ACCEPT** → §4.1/§4.2 |
| R16 | Opus A8: attribute/doc ledgers; port≠delete commits | **ACCEPT** → §3.1 + V4/V5 |
| R17 | Opus Q7: vapor-only components in shared dirs; VAPOR_PATTERNS idiom | **ACCEPT** → V1 moves; V6 doc handover |
| R18 | Codex sound-point: "hooks ①⑤" typo | **ACCEPT** → V2 retires ①; ⑤ dies at V4 |

**Opus confirm round (2026-08-01): all three reshapes (V4 pivot · V0 flip-only-with-neither ·
§1.1 end state) CONFIRMED**; four new items, all verified in code and folded:

| # | Finding | Ruling |
|---|---|---|
| R19 | HIGH: vapor must declare the four kit axis/seg setting descriptors at V4 (cosmos precedent) or it silently inherits resolver defaults with no picker rows | **ACCEPT** → V4 |
| R20 | MED: the new default-boot e2e must await content selectors, never bg/`data-skin` (the v1.4.5 flake class) | **ACCEPT** → V0 |
| R21 | MED: vapor-keeps = enumerated list frozen at V3, V6 asserts residue EQUALS it; `data-skyline` resolved at V3 | **ACCEPT** → V3/V6/§3.1 |
| R22 | LOW: V6 end state enforced mechanically (DefaultRoot render + no bespoke-chrome imports); `layouts:["4-tab"]` comment updated at V4 | **ACCEPT** → V4/V6 |
