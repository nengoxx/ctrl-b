# The vapor CSS banner ledger — the classified deletion inventory (D51 · Phase 16)

> **Status: FROZEN at slice V3, 2026-08-01.** Produced by [`VAPOR_ASSIMILATION_PLAN.md`](./VAPOR_ASSIMILATION_PLAN.md)
> §3 **V3** (council findings R4 · R21), under [`DECISIONS.md`](./DECISIONS.md) **D51**. On conflict:
> **D51 wins**, then the plan, then this ledger.
>
> This is the *gate for every later deletion*. V4 and V5 delete vapor CSS; without a classification made
> **before** the deleting starts, "is this block still needed?" becomes a judgement re-made per block
> (the drift vector R21 names). Every `/* ── … ── */` banner in `frontend/src/themes/vapor/extras.css`
> and every major section of `vapor.css` is bucketed here **once**.
>
> **Enforced, not just written:** `frontend/tests/theme-engine/vaporAssimilation.test.ts` mirrors the
> extras.css banner set (shrink-only ratchet), pins the frozen **vapor-keeps** subset so no port can
> delete it, and fails loudly with the instructions for whoever is deleting. V6 flips the last assertion
> to *equality* — extras.css's residue must EQUAL the vapor-keeps list.

## Buckets

| Bucket | Meaning | Dies |
|---|---|---|
| `port-owned:V4` | Chrome the **DefaultRoot pivot** replaces (appbar · tab bar · composer · the app-shell box model). Deleted in V4's *delete* commits, separate from the port commit. | V4 |
| `port-owned:V5` | A **shared** surface (chat · Conf editors · plan · markdown · Utils/catalog · overlays) whose vapor copy dies one banner at a time behind an `rg` zero-reference gate + a port-verify eyeball. | V5 |
| `kit-duplicate` | The kit **already implements** it; the block is a second copy that only wins because vapor's `@layer theme` outranks the kit's `@layer base`. No port work — just delete once the `.kit` marker is live and eyeballed. | V4 (or V5 where flagged) |
| `vapor-keeps` | The **Root-pinned VaporFleet** decoration surface + vapor's raw palette — bespoke-by-right per plan §1.1 / owner §5 Q2. **ENUMERATED + FROZEN here**; amendable only by an explicit owner ruling recorded in D51. | never (V6 asserts it survives) |
| `owner-drop` | Dropped outright by the owner. **Empty** — the §5 round dropped nothing. | — |

**Method.** Every row was read (not guessed) and cross-checked against `kit/kit.css`: for each block the
class names it styles were extracted and looked up in the kit sheet, which is what separates
`kit-duplicate`/`port-owned` (kit has the selector) from the **kit gaps** listed in §4 (it does not).

---

## 1. `frontend/src/themes/vapor/extras.css` — 41 banners (3028 ln)

Line spans are as-of the V3 freeze; the banner TEXT (first line) is the stable key the ratchet test uses.

| # | Banner (key) | Lines | Bucket | Dies | Notes |
|---|---|---|---|---|---|
| 1 | Net-new v2 components (Phase 2): activity toasts + confirm dialog. | 4–8 | `port-owned:V5` | V5 | **Comment-only** — a preamble for the toast/confirm CSS that actually lives in row 12. Delete with it. |
| 2 | F23 — Root error boundary fallback… | 9–32 | `port-owned:V5` | V5 | **Not a kit gap** — `lib/crashScreen.tsx` is self-contained by design: every element carries an inline style object (`crashShell`/`crashMessage`/`crashBtn`, contract tokens with hard fallbacks), because the screen renders when the app tree is dead. This block only DECORATES it under vapor → plain delete, nothing to add. |
| 3 | F14 — Hero now-dots are `<button>`s now… | 33–52 | **`vapor-keeps`** | — | Hero NowPanel dots (`.now-dots button`) — Fleet decoration. |
| 4 | F25 — Global keyboard focus indicator (WCAG 2.4.7)… | 53–87 | `kit-duplicate` | V5 | Kit has the same ring at `kit.css` `.kit :focus-visible` (+ the input/select/textarea suppression). **Ownership:** delete ONLY after the marker is live and the ring is verified on the kept Fleet — vapor's version is scope-wide, the kit's is `.kit`-descendant. **Carve-out:** the trailing `::-webkit-scrollbar`/`-corner` rules in this block are NOT a kit duplicate (vapor's own thin magenta scrollbar) → re-home them under a keeps banner before deleting. |
| 5 | F15 / Appearance · Motion — ambient-animation gate. | 88–119 | **`vapor-keeps`** | — | One shared selector LIST spanning both worlds (hero sun/sky/grid, lozenge, `.dev` led/eq **keep**; `.plan-step`, `.mini-player`, `.composer .send/.mic`, `.conn-badge`, `.tts-btn` **go**). **Each port removes only its own selectors** — never the banner. |
| 6 | Performance (lite) mode — Conf → Appearance → Blur… | ~~120–134~~ | `kit-duplicate` | ✅ **DELETED at V4** | Targets `.appbar`/`.tabbar`/`.composer` — all three become kit chrome at V4, and kit.css already has `body[data-perf="lite"] .kit-appbar` & co. |
| 7 | Firefox smoothness, full effects ON — containment/layer hints… | 135–150 | **`vapor-keeps`** | — | `.eq` containment + `.dev.on .led` layer hint — Fleet perf. |
| 8 | Phase 6b-1 — mic "unavailable" state… | ~~151–175~~ | `port-owned:V4` | ✅ **DELETED at V4** | Composer mic (`.unavail` / the Fennec `:active`-wedge `.press` fix). ✅ **CHECKED at the V4 port:** `SheetComposer` emits both classes and kit.css carries both states (`.kit-cbtn.mic.press{transform:scale(.92)}` :476 · `.kit-cbtn.mic.unavail{opacity:.4}` :479) — safe to delete. The block is already INERT (it is `.composer`-scoped and no `.composer` renders). |
| 9 | Phase 6b-2 — TTS read-aloud (bubble trigger + mini-player) | 176–312 | `port-owned:V5` | V5 | Chat trigger + the App-level MiniPlayer overlay; kit styles both (`kit.css .mini-player`). Owns `@keyframes vapor-mp-bar` (single consumer). ⚠️ **V4 CO-APPLICATION — THREE defeated kit rules.** vapor's flat `.mini-player { top / left / transform }` (extras.css ~:207) sits in `@layer theme` and therefore outranks EVERY contextual kit repositioner, which all key off `:has()` in `@layer base`: (1) `.kit:has(.tab.active .plan-pin-panel) .mini-player { top }` (kit.css ~:1984 — yield below the pinned plan) → the player does not yield and lands ON the plan header; (2) `.kit:has(.navmenu:not(.docked)) .mini-player { left/right/width/transform }` (~:1972 — clear the floating launcher) → the player stays centered under the launcher; (3) `.kit:has(.navhome):has(.navmenu:not(.docked)) .mini-player { left }` (~:5023 — clear the top-left NavHome too) → also defeated by the same `left: 50%`. **Concrete failure for (2)+(3):** `appbarMode: minimal` + TTS playing on a non-primary section — NavHome buries the player's play control on the left while the NavMenu launcher buries its ✕ on the right, i.e. BOTH controls unreachable. All three are conditional (TTS playing × a live plan / a non-default chrome mode), and **the V5 deletion of this block is the functional fix** — do not patch the kit rules to out-specify vapor. |
| 10 | Phase 6c-2 — HTTPS access card (Tailscale Serve)… | 313–346 | `port-owned:V5` | V5 | Conf › Server. |
| 11 | D18 — inference fallbacks list editor… | 347–380 | `port-owned:V5` | V5 | Conf › Inference. |
| 12 | F16 — Live SSE connection badge in the appbar. | 381–633 | `port-owned:V5` | V5 (carve-out ✅ **DELETED at V4**) | **Mixed block (253 ln)**: `.conn-badge` is APPBAR chrome (V4's port makes it kit-styled) while `.toasts`/`.toast`/`.modal-backdrop`/`.modal` are App-level overlays (V5). Split the deletion; owns `@keyframes vapor-conn-pulse`, `vapor-toast-in` and **`vapor-modal-fade` (SHARED — see §3)**. |
| 13 | Agent chat (Phase 4a)… | 634–817 | `port-owned:V5` | V5 (carve-out ✅ **DELETED at V4**) | **Mixed block**: L638–677 is the **app-shell box model** (`:scope,body{overflow}`, `#root`, `.app-shell`, `.app-scroll`, `.composer/.tabbar{position:static}`) → that sub-block is `port-owned:V4`, DefaultRoot owns it. The rest (think-disclosure, caret, chat error) is V5. Owns `@keyframes vapor-caret-blink` + **`vapor-tag-pulse` (SHARED — §3)**. |
| 14 | Command/action bubbles (Phase 4b)… | 818–1014 | `port-owned:V5` | V5 | Consumes `vapor-tag-pulse`. |
| 15 | Plan panel (Phase 4d)… | 1015–1174 | `port-owned:V5` | V5 (carve-out ✅ **DELETED at V4**) | V4 switches vapor to `planPlacement:"pinned"` (kit `PinnedPlanPanel`); this CSS dies at V5. Owns `vapor-plan-drop-in`; consumes `vapor-tag-pulse`. **Sub-block `.plan-pin-wrap` (:1034) is `port-owned:V4`** — it styles the vapor-only in-tab `PinnedPlan` (`tabs/AgentTab.tsx:36`) that the V4 pivot DELETES; the kit panel has different markup, so it is dead CSS after the pivot, not a kit gap. ⚠️ **V4 CO-APPLICATION (found at the port):** the kit's `PinnedPlanPanel` DOES share three class names with this block — `.plan-pin-head` · `.plan-title` · `.plan-count` — so vapor's `@layer theme` paint (the magenta hanging tab, `border-radius: 0 0 13px 13px`, `border-top: 0`) currently wins on the kit's LEFT-INSET sticky panel: a flat-topped tab floating 8px below the bar instead of hanging off it. **⛔ SUPERSEDED by the owner's V4 device round (2026-08-01) — this row is now SPLIT, and the V5 "delete it all" plan is WRONG.** The owner rejected the pinned plan ("not well pinned to the top/app bar; on the left instead of in the middle; a small gap"), and the main seat verified the offending geometry is **the KIT'S OWN** (`.kit .plan-pin-panel`: `top: calc(--appbar-h + 8px)`, `margin: 0 14px`, block box → the inline-flex head lands left, 8px low) — so deleting vapor's rules would NOT have satisfied him. What he wants is vapor's ORIGINAL look: a CENTERED tab hanging FLUSH off the bar. That is now theme CSS on the SHARED kit hooks (the §15 reskin route), so this banner splits three ways:
· **KEEPS-adjacent FIDELITY (survives V5 + V6):** the new `.plan-pin-panel` geometry block (`top: var(--appbar-h)`, `display:flex`, `justify-content:center`) **and** the existing `.plan-pin-head` paint (`all:unset` inline-flex, `0 0 13px 13px`, `border-top: 0`, accent gradient + frost + shadow) with its `.chev`/`.chev` rotation and the `.plan-title`/`.plan-count` type. These are vapor's look on kit markup — the brand-mark precedent — not a duplicate of a kit capability.
· **DEAD NOW, dies at V5 with the banner:** `.plan-pin` (the old vapor container — the kit renders `.plan-pin-panel`), `.plan-drop` (the kit renders `.plan-pin-drop`) and `@keyframes vapor-plan-drop-in` (its only consumer). Annotated in-file.
· **Still `port-owned:V5`:** the plan-steps/tick/`.plan-note` styling (shared chat DOM — the owner's §5 Q1 "kit look" ruling governs it).
The drop was DELIBERATELY left on the kit's anchoring (`left:0; right:0`, panel-wide, 6px under the head); vapor's old `min(86vw,360px)` centered drop was NOT recreated. `.plan-pin`/`.plan-drop` do NOT collide (kit uses `.plan-pin-panel`/`.plan-pin-drop`). |
| 16 | Markdown bot replies (Phase 4c)… | 1175–1364 | `port-owned:V5` | V5 | Owns `@keyframes vapor-dot-bounce`. |
| 17 | Reboot button (Phase: reboot action)… | 1365–1376 | **`vapor-keeps`** | — | `.dev .act.reboot` — device-row action. |
| 18 | Interactive plan dots (plan-edit)… | 1377–1387 | `port-owned:V5` | V5 | Plan (row 15's sibling). |
| 19 | Device-row action area… | 1388–1400 | **`vapor-keeps`** | — | `.dev .acts` / `.dev.on .top`. |
| 20 | Conf section collapse (Phase 7c polish) | 1401–1436 | `port-owned:V5` | V5 | |
| 21 | Conf tab — settings forms (Phase 7a) | 1437–1501 | `port-owned:V5` | V5 | |
| 22 | Conf → Computers · services sub-editor (Phase 7b) | 1502–1656 | `port-owned:V5` | V5 | |
| 23 | Conf → Integrations · MCP/OpenAPI server editor (7c-b) | 1657–1723 | `port-owned:V5` | V5 | |
| 24 | Conf → Computers · VPN-discovery results (D3 s3) | 1724–1762 | `port-owned:V5` | V5 | **KIT GAP (§4)** — `.vpn-discover-*`/`.vpn-ds` exist only in vapor CSS. |
| 25 | Conf → Agent tools · per-tool description overrides (7d-a) | 1763–1788 | `port-owned:V5` | V5 | |
| 26 | Conf → Agents · definitions editor (7d-b) | 1789–1926 | `port-owned:V5` | V5 | |
| 27 | Conf → Skills · SKILL.md editor (7d-c) | 1927–1959 | `port-owned:V5` | V5 | |
| 28 | PromptModal · full-page prompt/markdown editor (7e-b) | 1960–2184 | `port-owned:V5` | V5 | App-level overlay. **Consumes `vapor-modal-fade`, which row 12 DEFINES — last one out takes the keyframe (§3).** |
| 29 | Memory panel (7e-d-3) | 2185–2204 | `port-owned:V5` | V5 | |
| 30 | Conf sizing refine (7e-b) | 2205–2234 | `port-owned:V5` | V5 | |
| 31 | Wide-control wrap (the kit.css :2203-2224 pattern, mirrored…) | 2235–2265 | `kit-duplicate` | ⚠️ **V5 (was V4 — CORRECTED 2026-08-01)** | **Self-declared mirror of kit.css**, but NOT yet safe to delete — the V4 phase-2 deletion pass caught it. The mirror's load-bearing half is `.confrow .k { min-width: min(140px, 45%) }` ("the label min-width is what makes the wrap actually trigger"), and vapor.css's SETTINGS block (§2, `port-owned:V5`) declares `.confrow .k { min-width: 0 }` in the SAME `@layer theme` — so with the mirror gone the winner is vapor's `0`, not the kit's `min(140px,45%)` in `@layer base`. **Measured in the browser: removing the mirror drops the computed min-width from `min(140px, 45%)` to `0px`**, i.e. it would resurrect the v1.4.x label-crush bug this block fixed. It dies WITH the vapor.css SETTINGS block at V5 — exactly what the block's own in-file comment always said ("Dies with this block at D51 V5"); the `Dies` column here was wrong. |
| 32 | Session privilege chip (A1/D16) | 2266–2354 | `port-owned:V5` | V5 | Appbar-adjacent popover; kit styles `.priv-*`. |
| 33 | Question bubble (A2) | 2355–2411 | `port-owned:V5` | V5 | Chat. |
| 34 | Tools tab (Phase 8) — owner-directed font fix | 2412–2464 | `port-owned:V5` | V5 | Utils. |
| 35 | Tools tab · Section B — the agent-tool catalog (8b, D22) | 2465–2575 | `port-owned:V5` | V5 | Utils. |
| 36 | Approvals ('always allow') editor (Phase 8 / D44 W3) | 2576–2696 | `port-owned:V5` | V5 | **KIT GAP (§4)** — `.tcat-appr-*` exists only in vapor CSS. |
| 37 | DeviceRow chevron toggle as a real `<button>` (D25, a11y) | 2697–2717 | **`vapor-keeps`** | — | `.dev button.chev`. |
| 38 | Add-row +/− glyph centering (override of vapor.css's text glyph) | 2718–2733 | `port-owned:V5` | V5 | Dies with the Conf add-row port (row 21/§2 SETTINGS). |
| 39 | A11 / D48 — Providers registry + the provider→model picker | 2734–2956 | `port-owned:V5` | V5 | Conf. |
| 40 | A3 (14c) — Conf › Automations | 2957–3011 | `port-owned:V5` | V5 | Conf. |
| 41 | A3 (14d) — the created-automation card in the CHAT log | 3012–3029 | `port-owned:V5` | V5 | Chat. |

**Counts (banner-level):** `vapor-keeps` **6** · `kit-duplicate` **3** · `port-owned:V4` **1** · `port-owned:V5` **31** · `owner-drop` **0**.
**AS OF V4 phase 2 (2026-08-01): 41 → 39 banners in the file.** Deleted: row 6 (`kit-duplicate`) + row 8 (the single `port-owned:V4`). The remaining `kit-duplicate` pair is row 4 (always V5) and row 31 (**moved to V5**, see its row). Live buckets left: `vapor-keeps` **6** · `kit-duplicate` **2** · `port-owned:V5` **31**.
**Sub-block carve-outs** (a banner whose bucket differs for part of its body — 4): row 12's `.conn-badge` (V4 appbar) · row 13's L638–677 app-shell box model (V4) · row 15's `.plan-pin-wrap` :1034 (V4) · **row 15's KEPT-FIDELITY carve-out (V4 close-out): the `.plan-pin-panel` geometry override + the `.plan-pin-head`/`.chev`/`.plan-title`/`.plan-count` paint survive V5+V6 (vapor's centered flush hanging-tab on kit markup — see the row).** Plus row 4's `::-webkit-scrollbar*` tail (keeps).
**Genuine kit gaps: 2** (rows 24, 36 — see §4).

## 2. `frontend/src/themes/vapor/vapor.css` — major sections (1178 ln)

The sheet has no `── ` banners (its headers are plain `/* Title */`), so it is classified by SECTION, not
ratcheted by the test. V6's target: only the `vapor-keeps` rows below survive.

> ⚠️ **Line spans below are as-of the V3 freeze and have SHIFTED**: V4 inserted the kept §KIT CHROME block
> (~39 ln) just above §Top bar. Locate a section by its TITLE, never by the number in this table.

| Lines | Section | Bucket | Dies | Notes |
|---|---|---|---|---|
| 1–161 | Palette blocks — `:scope` + `[data-accent=aqua\|ember]` (+ the two `.hero` palette overrides) | **`vapor-keeps`** | — | vapor's raw/global token tier. `themes/vapor/tokens.css` (V3) maps it onto the contract; the contract NAMES (`--bg`/`--line`/`--line-2`) moved out at V3 and `--accent-glow` was renamed `--vapor-glow-filter`. |
| 163–171 | Global reset + page paint (`*{box-sizing}`, `:scope,body{background/color/font}`) | **`vapor-keeps`** | — | **Carve-out ✅ DELETED at V4** — `body{padding-bottom:116px}` + `body.no-composer`, atomically with their extras.css row-13 override (§3.1 #1). The rest of the section (incl. `body{overflow-x:hidden; position:relative}`) is KEPT. |
| *(new at V4)* | **KIT CHROME · vapor's brand mark** — `.kit-brand .vapor-mark`(+`[data-loz=ring]`) · the `.kit-appbar .kit-brand` display face + `.meta` caption · `@keyframes vapor-spin` (MOVED here, §3) | **`vapor-keeps`** | — | Added by the V4 port, not ported from anywhere: the kit has no lozenge (and by R15 must not know about one), so the `brandMark` slot's CONTENT is vapor's by right. Two rules of it are the wordmark's display face — a `--font-display`-token'd identity restore, listed as a V4 delta for the owner's eyeball. |
| ~~172–264~~ | Top bar — `.appbar` (+ transparent variant), `.brand`/`.lozenge`/`.mark`/`.meta`, `.tts-btn`, `.tts-toast` | `port-owned:V4` | ✅ **DELETED at V4** | The kit AppBar + the new `brandMark` slot (plan §4.1) replace it. ✅ **INERT since the V4 port** (nothing renders `.appbar`/`.brand`/`.tts-btn`); the delete commit takes it. **`@keyframes vapor-spin` already MOVED OUT** to the kept KIT CHROME block above (§3) — it is no longer in this range. The `.tts-toast` "auto-tts on/muted" flash has NO kit counterpart and dies with it (a V4 delta). |
| ~~266–291~~ | Bottom tab bar + sliding indicator (+ `.tab`/`.tab.active` panel visibility, :289) | `port-owned:V4` | ✅ **DELETED at V4** | kit TabBar + DefaultRoot's panel switching. |
| 293–475 | HERO — sun, retrowave stripes, HORIZON SCENE (`body[data-skyline]`: mountains + city), neon grid | **`vapor-keeps`** | — | **The `data-skyline` ruling (plan §3.1, due here): `data-skyline` is Fleet decoration → `vapor-keeps`.** The Root-pinned VaporFleet keeps writing it; the ledger row retires as "kept", not as "executed at V5/V6". |
| 476–535 | Now-monitoring panel, live waveform canvas, now-dots morph | **`vapor-keeps`** | — | |
| 536–542 | Section header `.sec` | `kit-duplicate` | V5 | kit styles `.sec` too — but the KEPT `VaporFleet` renders `.sec` as well, so this deletion is Fleet-visible: verify the Fleet's headers under kit's `.sec` in the same eyeball. |
| 543–733 | Compact device rows, busy spinner, machine-details dropdown, services list, kvgrid, mini equalizer | **`vapor-keeps`** | — | The "device/service presentation" §1.1 names. |
| 734–750 | Fleet summary | **`vapor-keeps`** | — | |
| ~~751–849~~ | Shared chat composer — `.composer`, `.field`, `.send`/`.stop`, `.mic` (+ STT spinner) | `port-owned:V4` | ✅ **DELETED at V4** | kit `sheet` composer. |
| 850–954 | CHAT — `.b` bubbles, queued steer (D41), command bubble | `port-owned:V5` | V5 | Owner §5 Q1: the fidelity bar is **the kit look + vapor tokens**, so these classify delete, not port-verbatim. |
| 955–1038 | UTILS — tool cards | `port-owned:V5` | V5 | |
| 1039–1177 | SETTINGS — `.confrow`, `.switch`, `.seg`, `.mconf`, add-machine row | `port-owned:V5` | V5 | ⚠️ **CO-APPLICATION FIX at V4:** `.switch.on .knob::after` moved from `left: 22px` to `transform: translateX(20px)` (and the small `.svc-auto` variant, extras row 22, to `translateX(17px)`) because kit.css slides the same knob with `transform` — vapor won `left`, the kit's `transform` ALSO applied, and the knob moved twice, out of its track. See THEME_ENGINE §14.4.1's amended two-trees box. |

## 3. Shared ownership — what a deletion may NOT take with it

A `@keyframes` or cross-cutting selector used by more than one block belongs to **none** of them: the
first port to leave must NOT take it. Verified by grep at the V3 freeze.

| Shared thing | Defined in | Also used by | Rule |
|---|---|---|---|
| `@keyframes vapor-modal-fade` | extras row 12 (`.modal-backdrop`, :592) | extras row 28 `.pm-backdrop` (:1975) | **Last one out** takes the keyframe. If row 12 goes first, MOVE the `@keyframes` into row 28's block. |
| `@keyframes vapor-tag-pulse` | extras row 13 (:812) | extras row 14 `.b.cmd` status tags (:888) · row 15 plan (:1137) | Three owners — keyframe leaves with the LAST of the three. |
| `@keyframes vapor-spin` | ✅ **MOVED at V4** into the new kept §KIT CHROME block (it drives the `data-loz="ring"` mark there) | vapor.css §Device rows busy spinner — a **kept** surface | RESOLVED: the definition now lives in a kept section, so the V4 appbar delete commit cannot take it. |
| `:focus-visible` global ring | extras row 4 | every vapor surface incl. the kept Fleet | Delete only once the kit ring is live under `.kit` AND the Fleet is inside it (V4's marker), never earlier. |
| `body[data-motion="reduced"]` selector list | extras row 5 (**kept**) | hero/**mark**/dev-led/eq (kept) + plan/mini-player/composer/conn-badge/tts (ported) | Ports remove THEIR selectors from the list. The banner + the kept selectors stay to V6. **V4 ADDED one kept selector** (`.vapor-mark[data-loz="ring"]`, the ring's spin gate); **V4 phase 2 then REMOVED the five ported ones** (`.brand .lozenge` · `.tts-btn` · `.composer .send.brewing` · `.composer .mic.rec` · `.conn-badge.reconnecting .dot`) — banner and kept selectors untouched, per this rule. |
| `body[data-perf="lite"]` bar list | ~~extras row 6~~ | — | ✅ **RESOLVED — whole block deleted at V4 phase 2**; kit.css gates `.kit-appbar`/`.kit-tabbar`/`.kit-composer`. |
| `::-webkit-scrollbar*` | extras row 4's tail | vapor page scroller (kept) | Re-home under a keeps banner before row 4 dies. |
| `.sec` | vapor.css §536 | shared DOM: App, AgentTab, UtilsTab, DefaultRoot **and the kept VaporFleet** | See §2 — Fleet-visible deletion. |

### 3.1 PHASE-2 ATOMICITY — the carve-outs are VERIFIED HANDOFFS, not inert blocks

The rows-12/13 (and §2 reset) carve-outs are marked `port-owned:V4` because DefaultRoot supersedes them. That
is a claim about the *replacement*, not a licence to delete half of one. **Before deleting any carve-out sub-block,
confirm in `kit/kit.css` + `kit/tokens.css` what actually takes over — and delete the pair that depends on each
other in ONE commit.** The two live cases, code-verified at the V4 port and **both DISCHARGED in V4 phase 2**:

1. **The body padding pair — DELETE ATOMICALLY.** `vapor.css:169` `body { padding-bottom: 116px }`
   (+ `:170` `body.no-composer { padding-bottom: 80px }`) is the LEGACY fixed-bar model; `extras.css:655`
   `body { padding-bottom: 0 }` is the OVERRIDE that neutralises it. Deleting the override alone **brings the
   116px back**: the kit's own reset (`kit/tokens.css` `html, body { margin: 0; padding: 0 }`) is `@layer base`
   and loses to vapor.css's `@layer theme`. Both go in the same commit, or neither.
   ✅ **DONE at V4 phase 2 — both halves in the one commit** (vapor.css keeps the rest of that `body` rule:
   `overflow-x: hidden; position: relative`).
2. **The page-scroll reset is NOT supplied by the kit — verify, don't assume.** The rest of row 13's L638–677
   sub-block (`:scope, body { height: 100%; overflow: hidden }` + `#root { height: 100% }`) has **no kit
   counterpart**: `.kit` sizes ITSELF (`height: var(--app-h, 100dvh); overflow: hidden`) and kit/tokens.css
   resets only margin/padding. Nothing else stops the WINDOW from scrolling. Deleting that half wholesale
   alongside (1) leaves a scrollable page under a fixed-height shell. Either keep those three declarations
   (re-homing them under a keeps banner) or add them to the kit reset first — a decision the deleter must make
   explicitly, with an eyeball, not by assuming the block is dead because its `.app-shell`/`.app-scroll`
   siblings are.
   ✅ **RESOLVED at V4 phase 2 by MEASUREMENT — deleted, not re-homed.** cosmos/frontier ship with no
   html/body height/overflow rule at all (computed `overflow: visible` on both) and still cannot
   window-scroll, because `.kit` is exactly one viewport tall and clips its own overflow. Probed on the
   dev instance: cosmos `documentElement.scrollHeight === clientHeight === 851`, `scrollable: false`; vapor
   AFTER the deletion measures the same (`html` now `visible`, `body` `hidden auto` from the KEPT
   `overflow-x: hidden`, `scrollHeight === clientHeight === 851`). vapor took cosmos's shape.

The same test applies to every other carve-out: `.conn-badge` (row 12 — ✅ deleted at V4, kit renders
`.kit-conn`), `.plan-pin-wrap` (row 15 — ✅ deleted at V4, the component that emitted it is gone), the row-4
scrollbar tail (still pending, row 4 is V5). Ask *"which live rule takes over, and is it in a layer that can
win?"* — then delete.

**The V4 phase-2 pass proved the question is not rhetorical.** It stopped one deletion cold: extras row 31
(the wide-control wrap) is a genuine `kit-duplicate`, but the kit's twin rule sits in `@layer base` UNDER a
surviving vapor rule (`.confrow .k { min-width: 0 }`, `@layer theme`), so "the kit has the same rule" was
true and still not sufficient. The row moved to V5. A `kit-duplicate` bucket means *the kit implements it* —
never, on its own, *the kit will win it*.

## 4. Kit gaps found while classifying (V5 = *add kit CSS*, then delete)

These vapor blocks style class names **no kit stylesheet implements** — the kit themes render them
unstyled today. Their V5 row is not "port-verify → delete" but "**write the kit CSS → verify → delete**".

- `.vpn-discover-results` / `.vpn-discover-line` / `.vpn-dh` / `.vpn-ds` (extras row 24).
- `.tcat-appr-*` — the whole approvals editor (extras row 36).

*Ruled OUT as gaps by the Codex V3 round (R29):* `.root-error` (row 2 — `lib/crashScreen.tsx` is
self-contained via inline styles, by design; the vapor rules only decorate) and `.plan-pin-wrap`
(row 15 — it styles the vapor `PinnedPlan` that V4 deletes outright, so it is dead CSS after the
pivot, not a surface anything must reimplement).

## 5. The frozen `vapor-keeps` list (extras.css) — R21

Exactly these six banner keys. `vaporAssimilation.test.ts` asserts they still exist after every slice;
**V6 flips that to equality** (the extras.css residue must be exactly this list).

1. `F14 — Hero now-dots are <button>s now (so keyboard tab reaches them).`
2. `F15 / Appearance · Motion — user-controlled ambient-animation gate.`
3. `Firefox smoothness, full effects ON — containment/layer hints (NO visual change). The goal is to`
4. `Reboot button (Phase: reboot action). Net-new device-row action: a restart sibling of the`
5. `Device-row action area: when a host is ONLINE it shows two buttons (reboot + shutdown). They`
6. `DeviceRow chevron toggle as a real <button> (D25, a11y)`

Plus, in `vapor.css` (section-level, not ratcheted): the palette blocks · the global reset/page paint ·
HERO + horizon/`data-skyline` · now-monitoring/waveform · device rows + services + kvgrid + eq · Fleet
summary.

## 6. How to use this when deleting (V4/V5)

1. Find the banner's row. If it is `vapor-keeps`, **stop** — it does not die.
2. Check §3: does the block define something another block still uses? Move it first. Then check **§3.1**:
   is this a carve-out whose replacement you have actually VERIFIED, and does it have an atomic partner?
3. Port + verify (separate commit), then delete (separate commit) — plan §3 V5.
4. Delete it, then tick the row here. **Do NOT touch
   `V3_BASELINE_BANNERS`/`VAPOR_KEEPS` in `frontend/tests/theme-engine/vaporAssimilation.test.ts`** —
   they are immutable frozen constants, and the ratchet asserts `baseline ⊇ current ⊇ vapor-keeps`.
   Deleting always passes; **adding or renaming** a banner fails with the reason (a rename reads as an
   add, because the first line IS the ledger key here, in the baseline, and in the file — all three must
   read the same string). Amending either constant needs an explicit ruling in D51.
5. Ask the co-application question (THEME_ENGINE §14.4.1's amended two-trees box): **what does the kit rule
   underneath set that vapor does not?** The layers win per PROPERTY, so a deletion can change a state that
   looked untouched. Known-accepted leftovers are §7; anything else is a finding.

## 7. Accepted co-application deltas (owner-reviewed at the V4 eyeball)

Cosmetic differences that appeared when the kit sheet started co-applying to vapor's DOM, **ruled ACCEPTED by
the main seat** — recorded so a later reader doesn't "fix" them, and deliberately NOT suppressed with
compensating vapor rules (each is either self-resolving as the V5 ladder deletes vapor's copy, or harmless):

- **`kit-fade` on tab activation** — `.kit .tab.active` runs the kit's 0.25 s opacity/translate entrance,
  which vapor's own bar never had. Motion-gated (`body[data-motion="reduced"]` kills it), transform/opacity
  only (§14.11). Reads as polish; it stays after V5 (it is kit chrome, not a vapor duplicate).
- **`kit-navmenu-in` on the privilege menu** — the shared popover shell animation now applies to
  `.priv-menu`. Same gating, same verdict.
- **Combined press states** — `.conf-save`/`.pm-save` take the kit's opacity `:active` (`opacity: .85`,
  kit.css :2536/:1861) AND vapor's own transform (`translateY(1px)` / `scale(.97) + brightness`,
  extras.css :1492/:2129) at once: different properties, so both apply — the per-property rule again. The
  result is a slightly richer press; it self-resolves when the V5 Conf/overlay deletions remove vapor's copy.

Anything NOT on this list that looks wrong is a finding, not an accepted delta — the two that were NOT accepted
(the double-moved `.switch` knob, the defeated mini-player repositioners) are recorded in §2/§1 row 9.
