# External audit #3 — triage, consolidation & plan revision (2026-06-30)

Response to the two audits added 2026-06-29 and reviewed 2026-06-30:
- **`CTRL-B Theme Engine Coding-Agent Audit Comparison 2026-06-29.md`** — a **refined third pass** (a "Deep Audit
  Review") that re-verifies audits #1 + #2 against fresh code at HEAD `8780e99` and sharpens them into 11 issues.
- **`CTRL-B Corsair Shutdown Audit 2026-06-29.md`** — a **separate, non-theme-engine** issue (LAN SSH to the Windows
  hosts times out; Tailscale MagicDNS works). Routed at the bottom → ROADMAP **D3**.

Same routing discipline as TRIAGE / TRIAGE-2: every finding **read, cross-checked against the code, and routed**.

## Verdict on audit #3

**Third independent pass, strongly corroborating — adopt, don't redesign.** Its thesis — *"the architecture is good;
the safety guarantees are still prose, casts, and conventions — make the documented contracts EXECUTABLE in
behavior-preserving slices"* — is correct and is exactly where the plan already points. Three independent audits now
converge on the same direction (theme-owned Roots + Kit + headless controllers + the Tokens/Surface/Bespoke 3-band).
**Almost every issue is already triaged + specced;** the value of this pass is (a) fresh code verification at HEAD, and
(b) a small set of genuine deltas. I verified every load-bearing claim against the code before routing.

## Code verification (every claim confirmed at HEAD `8780e99`)

| Audit claim | Code | Status |
|---|---|---|
| `useThemeSetting` casts `override as T`, no validation | `settings.ts:26-28` | ✅ confirmed gap |
| `reconcileAppearance` casts `server.theme as ThemeId`/`mode as Mode` unchecked | `useAppearance.ts:96-100` | ✅ confirmed |
| `switchTheme` returns `void` (no success signal); toasts + returns on load fail | `switchTheme.ts:70-98` | ✅ confirmed |
| `pickTheme` persists to server **before** awaiting switch success | `ConfTab.tsx:245-247` | ✅ confirmed |
| Composer Surface unbuilt — no `resolveThemeSetting`/`composerVariants`/`ThemedComposer` | grep: 0 hits | ✅ confirmed |
| Cosmos queries private Kit DOM (`.kit-appbar`/`.kit-composer`) | `CosmosFleet.tsx:137,155,157` | ✅ confirmed |
| Cold-load non-default theme → `fallback={null}` blank | `App.tsx:36` | ✅ confirmed (comment accepts it) |
| §14.13 #4 lists `inside` as a vapor keyframe — it's a **comment** false-positive | `vapor.css:3` | ✅ **doc bug confirmed** |

## 🟢 Corroborated — already triaged + specced (audit #3 just re-verifies; no NEW action)

| Audit #3 issue | = prior finding | Where it lives |
|---|---|---|
| 1 — `resolveThemeSetting` validation | B4 / R2 | `COMPOSER_SURFACE_PLAN §2.0`, `§14.14` invariant 2 |
| 2 — validate appearance theme/mode/accent IDs | R3 | plan §2.0 theme-safety note |
| 3 — transactional theme switch | R4 | plan §2.0 theme-safety note |
| 4 — Composer Surface specced, not built | R5 | the whole `COMPOSER_SURFACE_PLAN` (parked) |
| 5 — contract tests too thin | B2 | plan §7 `themeContract.test.ts` |
| 8 — Cosmos→Kit DOM coupling | R7 | TRIAGE-2 backlog (do with the Surface work) |
| 9 — cold-load blank | R6 / C1 | TRIAGE-2 / TRIAGE backlog |
| 11 — Storybook later | TRIAGE-2 decision | defer to the 4th theme / Composer Surface |

## 🟡 GENUINE DELTAS — new or sharper than the prior triage (folded into the plan this session)

- **Δ1 — Executable keyframe-prefix guard (issue 6).** §14.13 #4 documents the rule (`@keyframes` are
  document-global; `@scope` does **not** isolate animation names — verified as authoritative current CSS) but
  **nothing enforces it**, and it was not in the backlog. → Adopt **stylelint** (decision below). Maps directly to the
  built-in [`keyframes-name-pattern`](https://stylelint.io/user-guide/rules/keyframes-name-pattern/) rule + per-dir
  [`overrides`](https://stylelint.io/user-guide/configure/).
- **Δ2 — Doc bug (issue 6 corollary).** §14.13 #4 immortalized a regex false-positive: `inside` is **not** a vapor
  keyframe — `vapor.css:3` has the words "keeps @keyframes inside @scope" in a *comment*. **Fixed** in §14.13 #4. A
  concrete argument for an *executable* keyframe inventory over a hand-maintained prose list.
- **Δ3 — Token-contract test, sharpened (issue 7).** Backlog B5 was just "required-Kit-token smoke." Audit #3 adds the
  needed three-way distinction the test must encode: **semantic tokens** (each non-vapor theme must provide) vs **base
  fallbacks** (Kit's safety net, `kit/tokens.css`) vs **runtime vars** (`--app-h`/`--appbar-h`/`--composer-h`, set by
  JS — documented exceptions, must NOT be flagged missing) + a light/dark contrast smoke once a 2nd light theme lands.
  Refinement to B5, folded into the `themeContract` token-list assertion.
- **Δ4 — Registry eager-import bundle-creep (issue 10).** New, correctly rated **P3 / monitor-only**. Backlog note;
  no action until a descriptor imports heavy assets.
- **Δ5 (our own catch, adjacent to issue 3 — audit #3 missed it).** The `T1 follow-up` comment at
  `useAppearance.ts:125-130` says the cross-device skin-mismatch re-reconcile is *"latent, unreachable today — vapor is
  the only registered theme."* **That comment is now STALE** — `minimal` + `cosmos` are registered and selectable
  (`switchTheme.ts:12-13`), so the double-View-Transition path is **reachable today**. It lives in the same
  reconcile/switch code as the transactional-switch fix (R4) → **fix it in the same change** (gate the reconcile on
  `useIsMutating` so a self-initiated optimistic write isn't re-reconciled).

## 🔒 Decisions locked this session (2026-06-30)

1. **Sequencing — a standalone "Theme-Engine Hardening" slice ships FIRST**, ahead of the Composer Surface (owner
   choice). The validation that `COMPOSER_SURFACE_PLAN §2.0` folded into the composer's A1 is **lifted out** into this
   slice; the composer plan then assumes it's already in place (don't do it twice).
2. **stylelint is adopted as the CSS-contract enforcement layer** (owner asked for the long-term-reliable choice given
   the system will grow many themes + structural variants). Rationale: off-the-shelf stylelint plugins map **one-to-one**
   onto contracts already maintained as prose, so it's the executable home for the CSS side of the audit's thesis and it
   scales per-directory per-theme — a hand-rolled node script covers one rule and becomes throwaway (and TRIAGE-T1 wants
   a linter eventually anyway). **Scope: minimal + warn-first** (CSS-only, one `npm run lint:css`, `warn` not `error`,
   never blocks a build), three high-value rules to start, grown via the governance loop:
   - [`keyframes-name-pattern`](https://stylelint.io/user-guide/rules/keyframes-name-pattern/) (built-in) — `kit-*` in
     `kit/**`, `<theme>-*` in `themes/<theme>/**`; **allowlist** legacy `theme/vapor.css` + `theme/extras.css` (= §14.13 #4).
   - [`stylelint-high-performance-animation`](https://github.com/kristerkari/stylelint-high-performance-animation) —
     warn on animating anything but `transform`/`opacity` (= the §14.11 "composite, don't repaint" budget; *the rule
     that would have caught vapor's Firefox jank*).
   - [`stylelint-declaration-strict-value`](https://stylelint.io/user-guide/customize/) — colors must come from `var()`
     tokens (= §14.13 #1 "no hardcoded theme colors in Kit"; makes the manual 2026-06-27 check permanent).
3. **The reliability model is FOUR complementary layers** (each catches what the others can't — they are NOT
   substitutes): **TS `ThemeDef`** (shape) · **runtime guards** `resolveThemeSetting`/`isRegisteredThemeId`/resolver
   fallback (resilience — never crash the user) · **`themeContract.test.ts`** (conformance — fail the build; the only
   layer that can check behavioral invariants like attr-cleanup + loader-resolution, which require mount+switch) ·
   **stylelint** (CSS contracts). `themeContract.test.ts` is the standard **interface-contract / conformance-suite
   pattern** — one reusable suite run against every implementation via `it.each(registeredThemes())`, so a new theme is
   covered with zero new test code.
4. **The "grow the ruleset" governance loop** (so executable guards never lag the prose contracts) — documented in
   `THEME_ENGINE.md §14.13`: (a) **auto-iterating guards** (`it.each(registeredThemes())` + glob `overrides`) so new
   themes are covered for free; (b) **doc-as-coverage-map** — each enforceable §14.11/§14.13 item carries an
   `enforced by:` marker (stylelint rule / `test:themeContract` / `eyeball-only`) so a new prose rule without a guard is
   a visible hole; (c) **definition-of-done** — a slice that adds/hardens a contract adds its guard in the same slice
   (covered by the standing audit discipline). Optional P2 meta-guard: a test asserting every theme has a `tokens.css`,
   every theme folder matches a stylelint override, every checklist item has a marker.

## The Theme-Engine Hardening slice (ships first, behavior-preserving)

In order, each verified by `npm run typecheck` · `npx vitest run` · `npm run build` (+ a 390px eyeball where visual):

1. **`resolveThemeSetting(themeId, key, raw)`** (B4) in `theme-engine/settings.ts`; route `useThemeSetting` through it.
   Pure, exported, unit-tested (valid · missing · wrong-type · stale-seg · unknown-key).
2. **Appearance-ID validation** (R3): `isRegisteredThemeId` / `isMode` (+ `isModeForTheme` / `isAccentForTheme`) guards
   in `hooks/useAppearance.ts`; a bad synced value falls back to current local, never overwrites it nor sets
   `html[data-skin]` to an unregistered theme.
3. **Transactional switch** (R4): `switchTheme` returns `{ ok: true } | { ok: false; reason }`; `ConfTab.pickTheme`
   awaits it and persists **only on success** — **and fix the stale T1 reconcile (Δ5)** in the same change
   (gate on `useIsMutating`).
4. **`themeContract.test.ts`** (B2): `it.each(registeredThemes())` — palette defaults valid (conditional on declared
   axes), settings defaults typed/∈options, `loadStyles/loadFonts/loadRoot` resolve, `tabsFor` non-empty/unique; PLUS
   the **switch-chain attr-cleanup** test (vapor→minimal→cosmos→vapor: root-owned attrs cleared when inactive
   [`data-density`, `data-skyline`/`data-loz`/`.no-composer`, `data-sheet`]; global attrs reflect active) and the Δ3
   token-list assertion (semantic vs base vs runtime-var exceptions).
5. **stylelint micro-slice** (decision 2): config + `lint:css` script + the three warn-first rules, scoped by
   `overrides`; allowlist legacy vapor/extras.

Then the **Composer Surface** plan runs as the next slice (its §2.0 validation is now done by this slice).

## Separate audit — Corsair shutdown → ROADMAP D3 (backend, not theme engine)

Well-diagnosed and verified, then **designed deeper with the owner (2026-06-30)** into a proper **multi-homed host
addressing** feature. **Not a code bug:** Corsair's LAN SSH (`192.168.1.128:22`) times out (Windows Firewall almost
certainly allows sshd on the Tailscale interface but blocks the LAN profile), while `corsair:22` over MagicDNS works —
the existing shutdown path then succeeds end-to-end (238 ms vs a 10 s timeout). Same pattern on G5; Vault was off. Root
cause: `ip` is **overloaded** (5 uses — SSH/URLs/probe/ping/display), and service links built from `ip` break when
browsing over MagicDNS / TS Serve (a **client-vantage** problem no static config can fix).

**Locked design** (full spec + research links in **ROADMAP D3**): two address fields on the unified `Host` —
`ip` (LAN) + **`vpn_host`** (VPN/overlay; a name [MagicDNS, preferred] or IP; **generic** — Tailscale not hardcoded) —
plus a per-host **`ssh_prefer_vpn: bool`** toggle (default `False` = general **LAN > VPN** order). One chokepoint helper
`host_addresses(host, prefer_vpn)` orders the candidates; **SSH fails over** between them on connection errors only;
**service links are vantage-aware** (browser on a VPN origin → the host's `vpn_host` name, else `ip`); ping/probe stay
LAN; the sheet shows both. **Discovery** (`tailscale status --json` peer auto-fill) deferred. **Hardcoding check (owner
asked):** the only `tailscale` coupling today is the Serve/HTTPS-access integration (legit, product-specific); the
host-addressing path has none — built generic. `vpn_host`/`ssh_prefer_vpn` confirmed absent (grep: 0 hits). Slice 1
(backend) unblocks Corsair on its own; soon-ish (blocks controlling Windows hosts from emma).

## What changed in the docs from this triage
- **`THEME_ENGINE.md §14.13`** — fixed the `inside` doc bug (#4); added an **Enforcement & coverage** subsection (the
  4-layer model, the stylelint rule map, the governance loop + `enforced by:` markers).
- **`HANDOFF.md`** — the parked-theme-engine block now lists the **Hardening slice first**, then the Composer Surface,
  pointing here.
- **`COMPOSER_SURFACE_PLAN.md §2.0`** — validation marked as moved to the Hardening slice (the composer assumes it).
- **`ROADMAP.md D3`** — the backend `ssh_host` control-plane item (Corsair).
