# Vapor assimilation — the complete-migration plan (vapor → kit, legacy deleted)

> **Status: ✏️ LOCKED 2026-08-01 as [D51](./DECISIONS.md)** (owner-signed in conversation; push +
> lock + build go-ahead same day). Drafted 2026-07-31 from the owner's rulings; council round
> DONE 2026-08-01 (Codex `gpt-5.6-sol` correctness lens + one Opus 5 architecture lens, both
> **LOCK WITH CHANGES**; both confirm rounds clean) — reconciliation record §7 (R1–R24). Owner's
> §5 round ANSWERED + code-verified 2026-08-01 (chat = kit look; Fleet stays bespoke; the prod
> logo 404 found + fixed). Build = TODO **Phase 16**, slices V0–V6 below. This plan AMENDS
> `THEME_ENGINE.md` §14.15.3 (the ladder survives; its end-state bar and sequencing change per
> §1). On conflict: **D51/DECISIONS wins**, then this plan.

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

## 2. Verified as-is state — **the PRE-V0 BASELINE** (main-seat sweep 2026-07-31; council corrections 2026-08-01)

> Frozen as the starting inventory — rows retire as slices land, tracked here: hook ③ keyframes
> **DEAD at V1** · hook ⑥ CSS-home **DEAD at V1** (all files in `themes/vapor/`) · hook ① accent
> axis **DEAD at V2** (shared `data-accent`; `applyBodyAttrs` has ONE arm now) · hook ② non-contract
> tokens **DEAD at V3** (`themes/vapor/tokens.css`; the `semantic-tokens` waiver retired). Live
> remainder: hooks ④ (parallel chrome, → V4) · ⑤ (isVapor PinnedPlan gate, → V4).

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
  default / corrupt-storage fallback · `ui.ts` first-boot triple (derived from cosmos's declared
  ThemeDef defaults — dark/violet, §5 Q4) · backend `AppearanceCfg` default · e2e fixture defaults
  · **the PWA color surfaces** (`index.html` `theme-color` meta + the manifest
  `theme_color`/`background_color` in vite.config.ts — static mirrors of the default theme's
  `--bg`; added to the matrix at build after Codex found the list omitted them). The §14.15.3 "no theme literal
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
- **No eager/lazy changes**: vapor stays eager (unchanged); cosmos keeps its lazy Root and lazy
  CSS — a fresh boot behaves exactly like today's cosmos-by-choice boot. **Stated accurately**
  (Codex confirm — the FOUC script stamps attributes only; cosmos's background lives in its lazy
  CSS): a cold fresh boot can show browser canvas → kit-base styling → cosmos style + content
  when the chunks land — a background/style flash PLUS the content pop, not a correctly-painted
  wait. Accepted trade on a single-user box where fresh boots are rare; **owner eyeballs a cold
  fresh boot at V0** (§5 Q6) and we escalate only if it offends (the escalation — an inline
  critical bg/text token block keyed off `data-skin`, theme-agnostic — is recorded, not built).
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

### V3 — semantic-token mapping (council-hardened) — **✅ BUILT 2026-08-01** (ledger: [`VAPOR_BANNER_LEDGER.md`](./VAPOR_BANNER_LEDGER.md))
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
- **AS-BUILT (2026-08-01):** `themes/vapor/tokens.css` maps the full contract — statics + the three
  contract-NAMED palette values (`--bg`/`--line`/`--line-2`, MOVED out of vapor.css so each name has one
  home) on `:scope`, every palette-derived alias on `body`. `--accent-glow` (a filter) renamed
  `--vapor-glow-filter`; the contract token now carries `var(--m-glow)`. `--accent-fill` = each accent's
  **swatch** two-stop gradient, not the 4-stop `--accent-grad` (no ink can clear 4.5:1 against BOTH ends
  of that ramp — the ⑧ gate would be unsatisfiable by construction; the frontier K2 "fill mirrors the
  swatch" precedent). Waveform's two vapor-private reads → `--accent`/`--text-3`. Guards:
  `tests/theme-engine/vaporAssimilation.test.ts` (banner ratchet + static trap placement + one-home-per-
  contract-name) and `e2e/vapor-tokens.spec.ts` (the real-browser split-palette probe — jsdom replays
  neither `@scope` nor `@layer` nor the body-formula substitution, so the "computed-style unit test" had
  to be a browser spec). vapor joined `CONTRAST_MATRIX` (3 rows, every pair passes with margin;
  `kitShell:false` keeps it out of the kit-render sweep until V4). **`data-skyline` → `vapor-keeps`.**
  `--danger` maps from the **`--danger-rgb` channel** (which encodes the owner's Aqua-is-purple ruling),
  `--accent-ink` = vapor's documented `#1a0428` on-gradient ink (R26/R27).
  Two accepted deltas, both palette-CORRECTING: `color-scheme: dark` on `<html>` (UA scrollbars/controls,
  what every other theme declares), and the 7 defensive `var(--danger, …)`/`var(--warn, …)` reads in
  extras.css that were silently resolving to the KIT's neutral `#e07a6b`/`#e8c069` — the six always-red
  STATUS ones now read `var(--red)` directly (R26) and the one warn read resolves to vapor's amber, so
  both finally track aqua/ember.

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
  plan, tools menu, Stop, the no-composer-tab case (Codex #6's list); **all THREE vapor accents**
  (`dark`/`aqua`/`ember` — vapor has no mode axis) plus the applicable appbar/perf/motion cases.

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
- **`kit-structure` retires at V4, NOT here (R25).** A waiver retires the moment its capability
  lands, so the DefaultRoot pivot takes it: the vapor waiver list hits `[]` **at V4** and the
  structural + Fleet-a11y group runs vapor through the riskiest slice instead of skipping it.
  V6 ASSERTS the list is still `[]` (its third leg above) and flips the §14.15.3 banner DONE.
  `e2e/contrast-matrix.ts`'s `kitShell:false` is drift-guarded to that same waiver → both flip in
  the V4 commit or the guard fails. The `sections` waiver retires ONLY once vapor consumes the shared body/layout partition,
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
| `data-theme` (accent) | ✅ **RETIRED at V2** (`5f70a16`, 2026-08-01) |
| `data-loz` | V4 (becomes a theme setting driving the kit `brandMark` slot) |
| `data-skyline` | ✅ **RULED at V3: `vapor-keeps`** — Fleet decoration, the Root-pinned VaporFleet owns it; nothing to execute (ledger §2) |
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

## 5. The owner's round — ANSWERED 2026-08-01 (verified in code by the main seat same day)
1. **Agent tab → the kit look, full stop.** Owner: "I think they are already covered by the kit"
   — verified TRUE for every named element: the *pulse* (= `tag-pulse`, a 1.3 s opacity pulse on
   chat status tags, extras.css :810/:888/:1137) is matched by the kit's own streaming/working
   indicators (kit.css ~:2595); the `▸/▾` *disclosures* are SHARED DOM (`<details>/<summary>` in
   ChatThread) that kit.css already styles with the same chevron idiom (:2721/:3038/:3161); the
   *pinned plan* is `planPlacement:"pinned"` + `PinnedPlanPanel` (§2). **V5's chat fidelity bar =
   the kit look + vapor tokens; vapor's chat CSS blocks classify port-none/delete** — no verbatim
   ports, no per-element escalation expected.
2. **Fleet → stays as-is, bespoke.** Owner wants the Fleet tab essentially unchanged — exactly
   §1.1's Root-pinned VaporFleet (the cosmos/frontier shape). Hero scene, skyline, waveform are
   Fleet's decoration → the vapor-keeps bucket at V3's classification.
3. **Lozenge:** the spin DOES exist — the "ring" variant of vapor's "App mark" seg setting
   (`loz: logo | ring`, default `logo`; ring spins 8 s, vapor.css :216). Keep the seg as-is (it
   ports through `theme_settings` untouched). **And the owner's report "the logo isn't visible in
   production" was a REAL BUG, found + fixed on main:** vapor.css used a relative
   `url("logo.png")`, which the built stylesheet resolves to `/assets/logo.png` → 404 (the file
   is `public/logo.png` → `/logo.png`, 200 — verified live against prod); dev masks it because
   Vite injects CSS at document base. Fixed to a root-absolute url; the V4 `brandMark` port then
   implements the logo PROPERLY (a Vite-imported `src/assets/` asset — hashed + precached — not a
   bare public file).
4. **Cosmos first-boot defaults → the theme's own declaration.** Cosmos declares
   `modes: ["dark"]` / `defaultMode: "dark"` / `defaultAccent: "violet"` — the V0 first-boot
   values DERIVE from the registered ThemeDef (no new choice, no hardcoded triple).
5. **Existing devices → DISSOLVED.** Appearance is backend-synced (`AppearanceCfg`,
   server-authoritative last-write-wins, `GET /api/appearance` — config.py :805): there is ONE
   synced selection for all the owner's browsers, and the default flip touches only the
   unseeded/fresh state + the heal target. The owner's live selection is untouched by V0.
6. **Fresh-boot flash → ACCEPTED.** Owner: "just the default changed to cosmos, no new weird
   code or seams." The R5 lean ruling stands; the critical-token escalation stays recorded-only.

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

**Codex confirm round (2026-08-01): R7 deferral + the R9 V4 pivot CONFIRMED against code**
(DefaultRoot supplies the full #6 shell contract; no current VaporRoot behavior lost — scroll
handoff, `body[data-tab]`, keep-mounted Fleet, four-tab coercion all survive). Two objections,
both verified and folded:

| # | Finding | Ruling |
|---|---|---|
| R23 | MED: the V0 trade was misstated — the FOUC script stamps attributes only; a fresh cosmos boot flashes browser canvas → kit base before cosmos lands | **ACCEPT** → V0 + §5 Q6 restated accurately; R5's ruling stands, on true facts |
| R24 | MED: V4's device matrix said "both accents × light/dark" — vapor has THREE accents and no mode axis | **ACCEPT** → V4 matrix corrected |

**Codex round on the V3 diff (2026-08-01): FIX FIRST, 4 MED + 1 LOW — all applied in the V3 wave.**

| # | Finding | Ruling |
|---|---|---|
| R25 | **MAIN-SEAT RULING** (raised by the `kitShell` flag's lifecycle): `kit-structure` retirement moved **V6 → V4** — coherence with the `kitShell` drift guard, and a waiver retires when the capability lands, never later. V6 keeps only the ASSERTION that the list stays `[]` | **ACCEPT** → V4/V6 bullets + the waiver annotation + the matrix comment |
| R26 | MED: `--danger` mapped from `--red`, breaking the owner's Aqua rule (destructive = PURPLE under Aqua, VAPOR_PATTERNS) | **ACCEPT** → `--danger: rgb(var(--danger-rgb))`, the channel that already encodes the ruling; the six always-red legacy STATUS reads point at `--red` directly |
| R27 | MED: `--accent-ink: var(--bg)` ignored vapor's documented on-gradient ink | **ACCEPT** → `#1a0428` (VAPOR_PATTERNS §2's sanctioned constant), worst case 5.11:1 |
| R28 | MED: the banner ratchet's editable mirror list wasn't genuinely shrink-only (a rename could be "fixed" in the same commit) | **ACCEPT** → an IMMUTABLE `V3_BASELINE_BANNERS` + `baseline ⊇ current ⊇ vapor-keeps`; the mirror + count constant deleted as redundant |
| R29 | MED: ledger mis-called two kit gaps | **ACCEPT** → `.root-error` is owned by `lib/crashScreen.tsx`'s inline styles (plain V5 delete); `.plan-pin-wrap` styles the vapor `PinnedPlan` V4 deletes (→ port-owned:V4). VPN-discovery + approvals remain the genuine gaps |
| R30 | LOW: the static trap guard derived overridable inputs from vapor.css only | **ACCEPT** → unioned with every `body`-rooted declaration in tokens.css, so a contract-token formula moved to `:scope` is caught too |
