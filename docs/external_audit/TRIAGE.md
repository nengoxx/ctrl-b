# External audit — triage & response (2026-06-29)

Response to [`ctrl_b_dashboard_v2_systematic_audit.md`](./ctrl_b_dashboard_v2_systematic_audit.md) (an independent
static review). Every finding is **read, cross-checked against the code, and routed** to one of:

- **🟢 ADOPT NOW** — folded into the active Composer-Surface work (`COMPOSER_SURFACE_PLAN.md` + THEME_ENGINE §14.14).
- **🟡 BACKLOG (theme engine)** — real hardening, not the current slice; do in a follow-up theme-engine pass.
- **🔵 BACKLOG (other)** — valuable but outside the theme engine (backend/agent/security/chat); separate track.
- **⚪ DEFENSIBLE AS-IS / SOFT-REJECT** — the current design already handles it (with reasoning).

## Overall verdict on the audit

**High-signal and accurate.** It independently **validates our architecture** (theme engine 8/10) and our exact
direction — theme-owned roots + Kit + headless controllers + slots/variants — and **rejects the same alternatives we
did** (CSS-only, prop-explosion, full duplication; §V). Its central thesis — *"the design system relies too much on
discipline and documentation; make the contract executable through tests"* — is correct and **complements** the D31
Surface work rather than contradicting it.

**Important caveat:** the audit was written against the **pre-D31 code** — it describes the composer as the old
`DefaultRoot Composer=` prop ("future SheetComposer," §H3/§W). Nothing in it conflicts with D31; in fact §B4 (validate
settings) *strengthens* D31's setting-driven selection. Read every audit reference to `Composer={…}` as pre-D31.

---

## 🟢 ADOPT NOW — folded into the Composer-Surface plan + §14.14

| # | Finding | Why it's right + how we fold it | Verified |
|---|---|---|---|
| **B4** | Per-theme settings need **runtime validation** (P1) | `useThemeSetting` returns `override as T` with no schema check (settings.ts:27). A central `resolveThemeSetting(themeId, key, raw)` (seg→must be in `options`, switch→boolean, else `default`) makes **every Surface resolver robust by construction** AND **enforces D31's per-theme capability list** (a theme resolves only to variants it declared). Adopt in **A1**. | ✅ confirmed gap |
| **B2** | **`themeContract.test.ts`** ("best ROI in the entire theme engine", P1) | Only `settings.test.ts` exists — no contract test. Expand the plan's characterization tests into a full per-theme contract: palette defaults valid, settings defaults ∈ options / typed, `loadStyles/loadFonts/loadRoot` resolve, **body-attr cleanup across switch chains**. | ✅ confirmed missing |
| **D1** | `DefaultRoot`/resolver **must never branch on theme id** (Keep; Y-rule #2) | Verified: DefaultRoot has zero `theme===` branches; the `ThemedComposer` resolver reads a *setting*, not the theme id. Make it an **explicit stated invariant** in §14.14 so it stays true as Surfaces grow. | ✅ confirmed honored |
| **H3** | Formalize **composer slot semantics** (Keep) | Validates the variant+slots model; document placement of `controlsStart`/`overlay` and reserve `controlsEnd`/`below` as additive future slots (don't add until needed). Fold into the SheetComposer spec. | ✅ matches `types.ts` |

The body-attr cleanup test (B2) must assert the **root-owned** attrs are cleared on theme switch — `data-density`
(MinimalRoot), `data-skyline`/`data-loz`/`.no-composer` (VaporRoot), `data-sheet` (CosmosFleet) — while the
**global** attrs (`data-skin/theme/mode/accent/motion/perf/tab`) are rebuilt by `applyBodyAttrs` each `setUI`.

---

## 🟡 BACKLOG (theme engine) — a follow-up hardening pass, not the composer slice

| # | Finding | Priority | Note |
|---|---|---|---|
| **F2/F3** | `sanitizeThemeSettings` on persistence load + body-attr cleanup **contract** (beyond the test) | P1 | Companion to B4; centralizes persistence hygiene. The cleanup test (B2) is the cheap first half; the `sanitize` pass is the second. |
| **D2** | Extract shared `VaporRoot`/`DefaultRoot` hooks (`useLazyConfMounted`, `useScrollReset`, `useMeasuredAppbarHeight`, `useIdleConfPrefetch`, `ConfSuspenseBoundary`) | P1 | Real anti-drift win — fix a layout bug once, not twice. Do NOT force vapor through DefaultRoot (audit agrees). Pure extraction, vapor DOM unchanged. |
| **C1** | Theme-load **error boundary** → fall back to vapor on a cold chunk failure | P2 | `ensureThemeLoaded` already toasts on switch failure; add a root `ErrorBoundary` for the cold-load path. |
| **E2** | Cosmos `perf:lite` behavior + **pause every rAF loop** on inactive/hidden/reduced-motion/perf-lite + `visibilitychange` | P1 (mobile) | The biggest *future* perf risk (cosmos/frontier are animation-heavy). Already partly gated; make it a per-theme contract (§14.11 extension). |
| **G1** | `coerceActiveSection(theme, active)` when a theme's tab set omits the active tab | P2 | Latent until a theme drops a tab (frontier might). Cheap guard in `useSections`. |
| **B5** | Required-Kit-token **Playwright smoke** (computed-style check per theme) | P2 | Catches a missing semantic var before it becomes "invisible UI crimes." Pairs with the §14.13 #1 fallback rule. |
| **G2/R1** | Playwright + axe per-theme (NavMenu keyboard/close, composer enter, confirm/question bubbles, sheet+composer, mobile viewport) | P1 | This is the existing **F24** deferral (UI_AUDIT) — the one remaining a11y item → Phase 9. |
| **B3** | Move tabs into `ThemeDef.tabs?` | — | See DEFENSIBLE below. |

---

## 🔵 BACKLOG (other — outside the theme engine)

Strong findings, separate track (note them so they're not lost):

- **J3** stale **confirm-token recovery** (P1) — reload/restart/expiry leaves an unusable `AWAITING_CONFIRM` bubble; re-mint endpoint or "confirmation expired — ask again/dismiss".
- **I4** **risk-aware retry** (P1) — never one-click-retry a side-effectful failed turn; add `side_effect`/`mutates` to `ToolSpec`, copy-to-draft instead.
- **J2** **SSE payload guards** (P1) — hand-written field validators for `thread`/`message.start`/`part.added`/`tool.permission`/`tool.result`/`done`/`error`.
- **S1/L3** **`docs/SECURITY_MODEL.md`** (P1) — write the trust boundary (single-user tailnet, confirm-tokens = UX gate not auth, shell = opt-in RCE) + the safe-defaults checklist.
- **K4** centralized `safe_output()` + secret-leak tests (P1); **L2** permission-policy table tests (P1); **N1** config mask/unmask round-trip tests; **K3** persist privilege-raise to the transcript; **P1-classify** core-vs-optional query errors so one bad optional query doesn't read as "disconnected."
- **A1/A2** dev-only singleton guards for `useFleetCycle`/SSE; **I1/J1/K1** large-file splits (`AgentTab.tsx`, `store/chat.ts`, `AgentSession`) — do **when next editing those files**, not speculatively.
- **T1** add `lint`/`format` scripts + a local `check-all`; **O1** DB backup/export + migration-from-each-version tests.

---

## ⚪ DEFENSIBLE AS-IS / SOFT-REJECT (with reasoning)

- **B3 — move tabs into `ThemeDef`.** `tabs.ts` keeps `TAB_SETS` *deliberately component-free* to avoid a runtime
  import cycle (the file is read by `useSections`/TabBar; pulling it into `ThemeDef` risks the cycle the file's header
  warns about). The audit half-concedes this ("keep `tabs.ts` as a separate pure data registry… if cycles become an
  issue, place tab definitions in theme modules"). **Keep as-is** unless a cycle-free path is needed; the contract
  test (B2) can still validate `tabsFor(theme)` per theme.
- **V2 router / V3 XState / V5 CSS-only-themes** — the audit itself rejects/defers these; we agree (tab-state not
  routes; the reducer is understandable; CSS-only fails bespoke themes). No action.
- **fillComposer DOM write (H1)** — flagged; minor; route to the D2/composer-cleanup pass if touched.

---

## What changed in the docs from this triage
- **`COMPOSER_SURFACE_PLAN.md`** — A1 now includes the **B4** `resolveThemeSetting` validation; the test section is
  the full **B2** `themeContract.test.ts`; edge cases note the capability-enforcement synergy; H3 slot semantics added.
- **`THEME_ENGINE.md §14.14`** — adds the **runtime-validation requirement** (B4, with the capability-enforcement
  note), the **no-theme-branching invariant** (D1), and the **slot-semantics** note (H3).
- This file routes everything else; the theme-engine backlog (🟡) is the next hardening pass after the composer.
