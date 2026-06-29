# External audit #2 — triage & comparison (2026-06-29)

Response to **`CTRL-B dashboard_v2 Theme Engine and Maintainability Audit 2026-06-29.md`** (the 2nd external audit,
run read-only **on emma** at baseline `4f277b5`). Same routing as TRIAGE.md: each finding is read, **cross-checked
against the code**, and routed (adopt / parked-theme-engine / backlog / defensible). Where it overlaps audit #1, that's
noted — two independent audits converging is a strong signal.

## Verdict

**High-quality and code-grounded.** It **independently confirms audit #1's theme-engine direction** (3-band model,
`resolveThemeSetting`, contract tests, no-theme-branching, slot semantics, security model) — all of which are **already
folded into the parked `COMPOSER_SURFACE_PLAN` + TRIAGE.md**. It correctly observes *"docs are ahead of
implementation"* — which is **accurate and intentional**: we wrote the plan, then **parked** the theme engine to do the
emma deploy. So nothing here is a surprise on the theme-engine side.

Its standout contribution is the **backend test-harness finding (R1)** — new, and **verified**.

## 🔴 R1 (P0) — Backend async test harness is broken — VERIFIED, REPRODUCED

- **Claim:** 13 test files use `asyncio.get_event_loop().run_until_complete(...)`; under modern pytest/pytest-asyncio
  this raises `RuntimeError: There is no current event loop` → **76 failed / 153 passed**.
- **Verified on this machine (2026-06-29):** Python 3.11 venv + current `pytest`/`pytest-asyncio` →
  **`76 failed, 153 passed`**, identical failure class (`test_shell_5`, `test_skill_manage_7e`, … all `RuntimeError`).
  The 13 files are real (`grep` confirms). **This is NOT a Python-3.12 issue — it fails on 3.11 too.**
- **Why it happens:** pytest-asyncio opens/closes loops around async tests; a later *sync* test calling
  `get_event_loop()` finds no current loop → raises. Order-dependent, so a fresh `pip install pytest && pytest` fails.
- **Impact:** the **app runs fine** (uvicorn serves; deps healthy) — this does **not block the deploy**. But there is
  **no reliable backend test signal**, which is a real maintainability gap (caught only because audit #2 actually ran
  the suite; the docs' "tests green per phase" was true under the *older* pinned pytest).
- **Fix (audit-recommended, sound):** centralize one async strategy — `pytest.mark.asyncio` + `await`, or a single
  `conftest.py` `run_async(coro) = asyncio.run(coro)` — **never** per-file `get_event_loop()` helpers. Future-proof
  (works on 3.11 + 3.12 + 3.14; `get_event_loop()` policy is deprecated for removal in 3.16).
- **Routing:** **P0 maintainability — INDEPENDENT of the parked theme engine.** A contained ~13-file change. Not a
  deploy blocker, but the highest-value non-deploy fix. Owner decides: do it now (restores test confidence before more
  work) or right after the deploy lands. **Recommend: a dedicated small slice soon, with characterization first.**

## 🟢 Corroborates audit #1 / already in the parked plan (no new action)

| Audit #2 finding | = audit #1 / plan | Status |
|---|---|---|
| R2 — `resolveThemeSetting` validation (P0) | B4 / `COMPOSER_SURFACE_PLAN` §2.0 | already specced |
| R5 — finish Composer Surface (registry + resolver + slot tests) | the whole `COMPOSER_SURFACE_PLAN` | parked, specced |
| Theme contract tests (switch-chain, invalid-value fallback) | B2 / plan §7 | already specced |
| No theme-id branching in shared root | D1 / §14.14 invariant | already locked |
| Fixed slot semantics (`controlsStart`/`overlay`, reserve `controlsEnd`/`below`) | H3 / §14.14 | already locked |
| Security model + shell-default + OpenAPI/MCP hardening | TRIAGE 🔵 (S1, etc.) | already backlogged |
| Cosmos starfield perf-aware (DPR/30fps/visibility) — *"already good"* | — | confirms our perf posture |

## 🟡 NEW findings to fold into the PARKED theme-engine work (when it resumes)

These extend the theme-safety story beyond `resolveThemeSetting`; add them to `COMPOSER_SURFACE_PLAN` / the theme
backlog:
- **R3 (P0) — validate theme IDs, not just settings.** `useAppearance.ts` casts `server.theme as ThemeId` /
  `server.mode as Mode` without checking the value is *registered*. Add `isRegisteredThemeId` / `isMode` guards before
  `switchTheme`. (`ThemeId` includes unbuilt ids `phosphor/frontier/observatory` → a stale/synced value can poison the
  UI.) — *the natural sibling of B4; pairs with the contract tests.*
- **R4 (P0/P1) — transactional theme switch.** `ConfTab.pickTheme` persists the server appearance to the new theme
  *before* confirming `switchTheme` loaded it — a failed lazy chunk leaves UI on the old theme but server on the broken
  one (reload/other-device keeps retrying). Fix: persist only **after** successful activation (await the switch result).
- **R7 (P1) — Cosmos→Kit DOM coupling.** `CosmosFleet` does `document.querySelector('.kit-appbar'/'.kit-composer')`
  + `ResizeObserver`. Expose layout metrics via a Kit contract (`useChromeMetrics()` / CSS vars / refs) instead of
  global DOM queries — do this **with the Surface work** (it's the same "themes consume a contract, not private DOM").
- **R6 (P1) — cold-load blank.** Persisted non-default theme can suspend `fallback=null`. Themed skeleton or preload.
- Token **contrast tests** for non-vapor themes (vapor exception documented) + the **switch-chain attr-cleanup** test
  (already in plan §7 as B2 — audit #2 reinforces it).

## 🔵 NEW backlog (backend / product-edge / API — not theme engine)

- **R11 — Composer Enter-to-send lacks IME guard** (`isComposing`) → accidental sends for CJK/IME. Cheap, real.
- **R10 — BottomSheet focus** (focus title/close on open, return on close) — refine the non-modal model.
- **R12 — API DTO drift** (handwritten backend↔frontend types) → OpenAPI→TS generation *or* contract tests.
- **R13 — SSE disconnect persistence** unverified → add the integration test (disconnect mid-stream, assert persisted).
- **R14 — OpenAPI tool hardening** (URL-encode path params, allowlist default, `agent_exposed=false` default, don't
  assume GET is safe) — security-relevant, pull toward the deploy review.
- **Dedicated `PUT /api/appearance`** (validate only `AppearanceCfg`, stamp `updated_at`, skip the full settings
  reconfigure) — ergonomics + avoids a heavyweight path on every picker change.
- **Action response mapper** duplication (`actions.py`/`services.py`/`tools.py`) → extract shared Pydantic models.

## ⚪ The audit's open questions → recommendations (owner decides)
1. **Target Python 3.12 now?** → **Fix the harness first** (it makes 3.11 *and* 3.12/3.14 pass); the venv stays 3.11
   for the deploy. Bumping the target is then a low-risk config choice, not urgent. (emma's *system* python is 3.14;
   the venv is deliberately 3.11.)
2. **Default `shell.user_exec_enabled` false?** → For *this* owner-local tailnet tool, **leave true** (it's the point);
   but **document it loudly** in `SECURITY_MODEL.md` as an accepted RCE-by-owner default. Flip to opt-in only if the
   threat model ever widens beyond the tailnet.
3. **Storybook now?** → **No — defer** (rule of three; over-tooling for 3 themes). Revisit once the Composer Surface
   lands + a 4th theme is real. Contract tests give most of the safety net cheaply.

## What changed in the docs from this triage
- `HANDOFF.md` priority block: added the **R1 test-harness** finding as a flagged P0-maintainability item (independent
  of the parked theme engine) + pointers to both audits/triages.
- `COMPOSER_SURFACE_PLAN.md`: folded **R3** (theme-ID validation) + **R4** (transactional switch) into the theme-safety
  scope alongside B4 (so when the theme engine un-parks, they're captured).
- Everything else (R5/contract tests/slot/security) was already routed by TRIAGE.md / the plan; this file is the
  systematic record for reviewing audit-#2 items against the code later.
