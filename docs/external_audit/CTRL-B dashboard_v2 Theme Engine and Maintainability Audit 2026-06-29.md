# CTRL/B `dashboard_v2` Theme Engine and Maintainability Audit — 2026-06-29

Status: `expanded product-grade audit / ready for Claude Code handoff`  
Scope: read-only audit of `/home/emma/github/ctrl-b/dashboard_v2` plus two web-research passes and second-pass product-readiness review.  
Repo safety: **no source files were intentionally modified, committed, or pushed.** A temporary generated `backend/uv.lock` from test execution was removed after cleanup.  
Baseline commit inspected: `4f277b5` — `docs(dashboard_v2): triage external audit + fold theme-engine fixes into the Composer Surface plan`

## Executive summary

The current `dashboard_v2` approach is directionally good: the project already has a theme registry, theme modules, token CSS, a shared Kit root, theme-specific roots/surfaces, and docs that correctly describe a three-band architecture:

1. **Tokens** for cosmetic differences.
2. **Surfaces** for repeated structural differences sharing a headless controller.
3. **Bespoke roots** for one-off/frozen theme experiences.

That is the right model for a dashboard/chat UI that needs to grow themes without becoming rigid.

The main gap is that the **docs are ahead of implementation**. The Composer Surface and settings-validation model are described well, but the current code still trusts persisted/server values, casts invalid IDs into narrow frontend types, and lacks enough contract tests around theme settings, slots, and invalid-value fallback.

The Python backend test issue is **not a reason to stay pinned to Python 3.11**. I reran tests under Python 3.11 after removing the local `.venv`; the same broad failure pattern remained: **76 failed / 153 passed**. The root problem is repeated test helpers using `asyncio.get_event_loop().run_until_complete(...)`, which is brittle under modern Python/pytest loop behavior. The better fix is to modernize the async test harness, not accept Python 3.11 as the long-term ceiling.

## Second-pass product-readiness summary

A second pass found that the original audit had the right core findings, but needed a deeper finished-product layer. Additional high-value concerns now documented below:

- **Theme-load failure consistency:** `ConfTab.pickTheme` can persist the selected theme before confirming `switchTheme(...)` successfully loaded that theme. A failed lazy theme chunk/CSS load can leave UI and server appearance out of sync.
- **Cold-load polish:** persisted non-default themes can suspend with `fallback=null`, producing a blank/background-only moment on slow devices unless a themed skeleton or preload path is added.
- **Mobile/safe-area/keyboard edge cases:** the app uses `viewport-fit=cover` and `visualViewport.height`; this needs explicit iOS/Android keyboard, toolbar, safe-area, orientation, and PWA standalone acceptance checks across every theme.
- **Accessibility depth:** existing axe coverage intentionally disables `color-contrast`; final-product readiness needs token-level contrast tests for non-vapor themes and deliberate documented exceptions if Vapor remains intentionally low-contrast.
- **Composer UX edge cases:** blank sends currently no-op while the send button can appear enabled; Enter-to-send should guard IME composition (`isComposing`) to avoid accidental sends for CJK/IME users.
- **BottomSheet focus management:** Cosmos-style non-modal sheets can be valid, but opening sheets still need predictable focus placement, Escape behavior, and focus return.
- **Performance/fluidity budgets:** final-product quality needs INP/CWV targets, React render profiling, long-list virtualization policy, containment/content-visibility rules, motion tokens, and real device/mobile acceptance criteria.
- **Claude Code safety:** the audit now includes source-of-truth ordering, risk register, acceptance criteria, stop conditions, and a test matrix so coding-agent work stays bounded and reviewable.

## Highest-priority Claude Code tasks

### P0 — Fix backend async test harness, do not treat Python 3.11 as the solution

**Problem**

Multiple tests use local helpers like:

```py
asyncio.get_event_loop().run_until_complete(coro)
```

This fails when no current loop is set in the main thread. It is brittle across Python 3.11+ and becomes stricter in newer Python versions.

**Observed verification**

Command run in `/home/emma/github/ctrl-b/dashboard_v2/backend` after permission to retry:

```bash
rm -rf .venv && uv run --python 3.11 --with pytest --with pytest-asyncio pytest -q
```

Result: **76 failed / 153 passed**, with `RuntimeError: There is no current event loop in thread 'MainThread'` still present. So this is not only a Python 3.12 incompatibility.

**Evidence**

Occurrences found in tests:

- `backend/tests/test_skill_manage_7e.py:54-55`
- `backend/tests/test_dual_mode_d17.py:53-54`
- `backend/tests/test_memory_7e.py:81`, `:94`
- `backend/tests/test_memory_state_d27.py:63-64`
- `backend/tests/test_session_search_7e.py:53-54`
- `backend/tests/test_memory_panel_7e.py:31-32`
- `backend/tests/test_apply_proposal_7e.py:55-56`
- `backend/tests/test_messages_agent_7e.py:51-52`
- `backend/tests/test_shell_5.py:62-63`
- `backend/tests/test_question_a2.py:50-51`
- `backend/tests/test_memory_tool_7e.py:58-59`
- `backend/tests/test_reflection_d27.py:55-56`
- `backend/tests/test_prompt_append_7e.py:99`, `:114`, `:282`

Some tests already use `asyncio.run(...)`, showing style drift:

- `backend/tests/test_voice_6a.py:42-43`
- `backend/tests/test_memory_concurrency_d27.py:83`
- `backend/tests/test_memory_git_backup_d26.py` multiple calls

**Best fix**

Preferred options, in order:

1. Convert async tests to `pytest.mark.asyncio` / `pytest_asyncio` and `await` directly.
2. If sync tests must drive coroutines, centralize a helper in `tests/conftest.py`:

   ```py
   import asyncio

   def run_async(coro):
       return asyncio.run(coro)
   ```

   Use this only when the coroutine does not need a long-lived shared loop.
3. For rare tests requiring a shared loop, create an explicit fixture with `asyncio.new_event_loop()`, `asyncio.set_event_loop(loop)`, and guaranteed cleanup.

Avoid copying per-file `_run()` helpers. This is exactly how the current suite drifted.

**Why this is future-proof**

Python docs say application developers should usually use high-level functions like `asyncio.run()`, and prefer `get_running_loop()` inside coroutines/callbacks. `get_event_loop()` has complex policy behavior, and Python 3.14+ raises when no current loop exists; the policy system is deprecated for removal in Python 3.16.

Source: https://docs.python.org/3/library/asyncio-eventloop.html

---

### P0 — Implement validated theme setting resolution before user-selectable Composer variants

**Problem**

The docs require validated per-theme settings, but the implementation currently returns raw overrides if present.

**Evidence**

- `frontend/src/theme-engine/settings.ts:26-28` returns the override if not `undefined`, otherwise default.
- `docs/THEME_ENGINE.md:1304-1310` requires `resolveThemeSetting(themeId, key, raw)` with validation for `seg` options and boolean switches.
- `frontend/tests/theme-engine/settings.test.ts:14-31` covers default/override/unknown key, but not invalid stale values.

**Best fix**

Add a resolver with behavior like:

```ts
export function resolveThemeSetting(themeId: ThemeId, key: string, raw: unknown): ThemeSettingValue {
  const spec = themeSettingsSpec(themeId).find((item) => item.key === key)
  if (!spec) return undefined

  if (spec.kind === "seg") {
    const allowed = spec.options.map((option) => option.value)
    return typeof raw === "string" && allowed.includes(raw) ? raw : spec.default
  }

  if (spec.kind === "switch") {
    return typeof raw === "boolean" ? raw : spec.default
  }

  return spec.default
}
```

Then route all reads through it:

- `useThemeSetting(...)`
- server/local appearance reconciliation
- Composer variant resolution
- tests for stale/invalid values

**Acceptance tests**

- Invalid `seg` value falls back to default.
- Wrong primitive type falls back to default.
- Unknown setting key is ignored.
- Stale server setting cannot crash the UI or select an unavailable variant.

---

### P0 — Finish the Composer Surface as a real contract, not just comments/types

**Problem**

The current Composer slot model exists, and the docs specify the correct architecture, but the source has not fully reached the documented user-selectable surface resolver.

**Evidence**

- `frontend/src/theme-engine/kit/composer/types.ts:25` defines composer variant component concept.
- `frontend/src/theme-engine/kit/composer/Composer.tsx:12-14` documents `controlsStart` and `overlay` placement semantics.
- `docs/THEME_ENGINE.md:1251-1257` says Composer should be user-selectable via registry + per-theme `seg` setting + resolver.
- `docs/THEME_ENGINE.md:1297-1317` requires validated settings and fixed slot semantics.

**Best fix**

Implement:

1. A stable Composer variant registry.
2. Per-theme allowed variants through `seg.options`.
3. A fallback-safe resolver:
   - no theme ID conditionals in shared root code;
   - invalid/stale setting falls back to theme default;
   - missing variant falls back to Kit default.
4. Slot contract tests:
   - `.kit-composer` root class remains present;
   - `controlsStart` renders before the text input/action lane;
   - `overlay` renders as overlay/sibling, not inside the input field;
   - future slots can be added without breaking existing variants.

---

## Frontend/design-system audit

### What is already good

- Theme modules are simple and inspectable.
- `ThemeDef`, registry, palettes, settings, and root selection are a solid foundation.
- Kit CSS uses `.kit-*` class names, which is a good isolation namespace.
- `useSections` is a headless navigation controller, allowing themes to render navigation differently without changing app logic.
- Cosmos Starfield is explicitly performance-aware: DPR cap, ~30fps throttle, visibility handling, and cleanup.
- Conf Appearance UI is registry-driven, so theme settings can become self-describing controls.

### Gap: static registry vs future plugin-like themes

**Evidence**

- `frontend/src/theme-engine/registry.ts:10-13` defines a static object for `vapor`, `minimal`, and `cosmos`.
- `frontend/src/theme-engine/types.ts:12-14` includes future IDs: `phosphor`, `frontier`, `observatory`.

**Risk**

`ThemeId` can contain values not actually built/registered. Persisted/server appearance can reference an unavailable theme, then frontend casts it as valid.

**Recommendation**

Short term:

- Keep the static registry; it is fine at this scale.
- Add `isRegisteredThemeId(value): value is RegisteredThemeId`.
- Validate all server/local theme values before applying.

Medium term:

- Split `PlannedThemeId` from `RegisteredThemeId` or derive the built theme union from the registry.
- Move toward manifest/contribution style only when theme count grows.

### Gap: server appearance is cast into frontend types without validation

**Evidence**

- `frontend/src/hooks/useAppearance.ts:95-102` casts `server.theme as ThemeId`, `server.mode as Mode`.
- `frontend/src/hooks/useAppearance.ts:124-137` then calls `switchTheme(next.theme, ...)` when server theme differs.
- Backend config uses plain strings for appearance fields: `backend/app/config.py:579-584`.

**Recommendation**

Add frontend guard before applying server values:

```ts
const safeTheme = isRegisteredThemeId(server.theme) ? server.theme : current.theme
const safeMode = isMode(server.mode) ? server.mode : current.mode
```

Also consider backend validation for `mode`, and either open-but-validated or registry-aware validation for `theme`.

### Gap: CSS/global state leakage risk

**Evidence**

- `frontend/src/themes/vapor/VaporRoot.tsx:90-100` writes/clears body hooks like `.no-composer`, `body[data-skyline]`, `body[data-loz]`.
- `frontend/src/themes/cosmos/CosmosFleet.tsx:228-235` writes `document.body.dataset.sheet = "open"` and deletes it on cleanup.
- `frontend/src/themes/vapor/VaporRoot.tsx:64-88` writes `--appbar-h` onto `document.documentElement`.

**Recommendation**

- Keep global hooks only for truly viewport-level state.
- Centralize global attribute ownership in a `ThemeHost`/layout effect layer.
- Prefer theme-root-scoped data attributes when possible.
- Add cleanup tests for theme switching so old body/root attrs do not leak.

### Gap: Cosmos Fleet reaches into Kit DOM by global selectors

**Evidence**

- `frontend/src/themes/cosmos/CosmosFleet.tsx:135-140` queries `.kit-appbar` and `.kit-composer`.
- `frontend/src/themes/cosmos/CosmosFleet.tsx:153-158` observes those elements with `ResizeObserver`.

**Risk**

This couples theme-specific surfaces to Kit class names and document structure.

**Recommendation**

Expose layout measurements through one of:

- `LayoutMetricsContext`
- refs passed by `DefaultRoot`
- CSS custom properties published by Kit
- shared `useChromeMetrics()` hook

The theme should consume a layout contract, not query arbitrary DOM.

### Gap: performance is okay now, but layout work should be centralized before more themes

**Evidence**

- `frontend/src/themes/cosmos/CosmosFleet.tsx:132-162` uses `useLayoutEffect`, `getBoundingClientRect`, global queries, and `ResizeObserver`.
- `frontend/src/themes/cosmos/CosmosFleet.tsx:164-213` recomputes placements/ring targets.

**Recommendation**

- Current fleet size is probably fine.
- If fleet grows, memoize placement/target computations.
- Move measurement ownership into Kit/root-level contract first.

---

## Backend/API audit

### What is already good

- FastAPI app factory mounts routers cleanly under `/api`: `backend/app/main.py:204-217`.
- Frontend uses single-origin relative `/api/*` fetches: `frontend/src/api/client.ts:1-15`.
- Host DTO avoids returning secrets; it exposes `has_password`, not password content: `backend/app/api/hosts.py:68-82`.
- Action service has confirm-token and audit concepts for riskier actions: `backend/app/services/action_service.py:86-117`, `:180-203`.
- Fleet/service status has bounded concurrent polling and cache patterns: `backend/app/services/fleet.py`, `backend/app/services/svc.py`.

### Gap: handwritten backend/frontend API contract can drift

**Evidence**

- Backend host DTO: `backend/app/api/hosts.py:68-82`
- Frontend host type: `frontend/src/types.ts:14-27`
- Backend service DTO: `backend/app/api/services.py:37-56`
- Frontend service type: `frontend/src/types.ts:56-67`

**Recommendation**

Add one of:

- OpenAPI → TypeScript generation step.
- Contract tests comparing OpenAPI schema to frontend assumptions.
- Shared schema package if generation is too heavy.

### Gap: action response shaping is duplicated

**Evidence**

- `backend/app/api/actions.py:35-57`
- `backend/app/api/services.py:72-106`
- `backend/app/api/tools.py:45-65`

**Recommendation**

Extract shared response mappers or formal Pydantic response models for confirm/result/event shape.

### Gap: appearance writes use heavyweight settings path

**Evidence**

- Lightweight read endpoint: `backend/app/api/settings.py:61-70`
- Full settings write path with global lock/reconfigure: `backend/app/api/settings.py:73-107`
- Runtime reconfigure path: `backend/app/runtime.py:220-248`
- Frontend writes appearance on picker changes: `frontend/src/hooks/useAppearance.ts:173-191`

**Recommendation**

Add dedicated `PUT /api/appearance`:

- validate only `AppearanceCfg`;
- stamp `updated_at`;
- persist only appearance block;
- avoid full adapter reconfigure unless necessary.

Keep `/api/settings` for bulk Conf tab edits.

### Gap: SSE disconnect persistence needs verification

**Evidence**

- `backend/app/api/agent.py:3-7` says turn keeps running if client disconnects.
- `backend/app/api/agent.py:202-207` directly yields event generator in `EventSourceResponse`.
- No obvious `request.is_disconnected()`, task spawning, or `asyncio.shield` in `backend/app/api/agent.py:173-207`.

**Recommendation**

Add integration test:

1. Start a streaming turn.
2. Disconnect client mid-stream.
3. Assert assistant result/event persistence still completes.

If it fails, run turns through a background task/queue and stream from that task.

### Gap: safety relies heavily on trusted local/tailnet deployment

**Evidence**

- Default bind is local-only and debug off: `backend/app/config.py:82-88`.
- Frontend fetches same-origin with no auth/CSRF headers: `frontend/src/api/client.ts:3-15`.
- User shell exec enabled by default: `backend/app/config.py:393-412`, especially `user_exec_enabled: bool = True`.
- `/api/exec` runs shell at `Privilege.FULL`: `backend/app/api/agent.py:263-306`.

**Recommendation**

- Keep the “owner-only localhost/tailnet” deployment assumption explicit.
- If exposed beyond localhost/tailnet, add session/bearer auth and CSRF protections for mutating endpoints.
- Consider defaulting `shell.user_exec_enabled` to false for new installs, with opt-in.

### Gap: OpenAPI tool registration is broad by default

**Evidence**

- Registers operations from OpenAPI servers: `backend/app/adapters/openapi_tools.py:161-209`.
- Mutating verbs default medium risk, GET/HEAD low/auto-run: `backend/app/adapters/openapi_tools.py:15-17`, `:144-146`.
- Registered OpenAPI tools are agent-exposed by default: `backend/app/adapters/openapi_tools.py:189-199`.
- Path params are string-replaced without URL encoding: `backend/app/adapters/openapi_tools.py:211-230`.

**Recommendation**

- Prefer include allowlists by default.
- Consider `agent_exposed=false` until explicitly enabled.
- URL-encode path substitutions.
- Do not assume every GET is safe.

---

## Web research: best-practice target architecture

### 1. Token model

Use layered tokens:

1. Primitive tokens: raw palette, spacing, radius, typography, motion.
2. Semantic tokens: UI meaning (`bg.app`, `text.muted`, `chat.user.bg`).
3. Component/slot tokens: local component semantics (`composer.input.border`, `messageBubble.assistant.bg`).

Sources:

- Design Tokens Format Module: https://tr.designtokens.org/format/
- Style Dictionary: https://styledictionary.com/getting-started/installation/
- Chakra theming overview: https://chakra-ui.com/docs/theming/overview

### 2. Runtime theme substrate

Use CSS custom properties and data attributes for runtime switching:

```html
<html data-theme="cosmos" data-mode="dark" data-density="comfortable">
```

Components should consume semantic variables, not hardcoded colors.

Sources:

- MDN CSS custom properties: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties
- MUI CSS theme variables: https://mui.com/material-ui/customization/css-theme-variables/overview/

### 3. Styling strategy

For this app, prefer:

- CSS variables for tokens/themes;
- CSS Modules or build-time CSS such as vanilla-extract for components;
- slot recipes for multipart components;
- runtime CSS-in-JS only where genuinely needed.

Source:

- vanilla-extract recipes: https://vanilla-extract.style/documentation/packages/recipes/

### 4. Slots and composition

Model complex UI as explicit slots:

- `MessageBubble`: `root`, `avatar`, `content`, `header`, `body`, `actions`, `timestamp`, `status`.
- `Composer`: `root`, `controlsStart`, `input`, `controlsEnd`, `overlay`, future reserved slots.
- `SidebarItem`: `root`, `icon`, `label`, `badge`, `shortcut`.

Use Radix-style `asChild` only for low-level primitives where accessibility roles are clear.

Sources:

- Chakra slot recipes / `sva`: https://chakra-ui.com/docs/theming/overview
- Radix Slot utility: https://www.radix-ui.com/primitives/docs/utilities/slot

### 5. Lazy loading and performance

Initial bundle should include only base/reset CSS, default variables, critical layout primitives, and system fonts or one critical font. Lazy-load:

- rare theme packs;
- heavy widgets/charts;
- markdown/code rendering;
- emoji picker;
- file previewers;
- theme-specific assets/fonts.

Sources:

- webpack code splitting: https://webpack.js.org/guides/code-splitting/
- web.dev font best practices: https://web.dev/articles/font-best-practices

### 6. Animation and reduced motion

Keep animation compositor-friendly:

- Prefer `transform` and `opacity`.
- Avoid `height`, `width`, `top`, `left`, heavy blur, and layout-triggering properties.
- Respect `prefers-reduced-motion` globally and per component.

Sources:

- web.dev high-performance CSS animations: https://web.dev/articles/animations-guide
- MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

### 7. Prototype-to-module workflow

Use a promotion path:

1. Prototype the theme/component.
2. Extract tokens/slot contract.
3. Build isolated Storybook stories.
4. Add mobile, dark/light, compact, loading/error, long-content, reduced-motion cases.
5. Add visual/accessibility/interaction tests.
6. Promote to registry/theme pack.

Sources:

- Storybook workflow: https://storybook.js.org/docs/get-started/why-storybook
- Figma variables: https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
- shadcn registry docs: https://ui.shadcn.com/docs/registry

---

## Product-grade expansion: architecture, edge cases, and final-app readiness

This section is the second-pass expansion Ari asked for: not just “what is wrong today,” but what has to be true for CTRL/B to become a polished, flexible, extensible, fluid final product.

### Audit methodology and evidence boundaries

**Inputs inspected**

- Source repo: `/home/emma/github/ctrl-b/dashboard_v2`, baseline commit `4f277b5`.
- Frontend: `theme-engine`, theme roots, Kit components, Vapor/Cosmos/Minimal paths, composer hooks/components, appearance UI, e2e tests, bootstrap HTML.
- Backend: settings/config, agent/SSE/exec routes, action service, OpenAPI tools, service/fleet polling, tests.
- Docs: handoff/theme-engine/composer-surface/architecture material.
- External research: INP/Core Web Vitals, React performance, virtualization, CSS containment, View Transitions, reduced motion, WCAG contrast, design tokens, CSS variables, lazy theme assets, mobile safe-area, component contract testing.

**Evidence confidence levels**

| Level | Meaning | Examples |
|---|---|---|
| Verified by command | Tool output/test command observed | frontend `npm test` pass in second pass; backend Python 3.11 retry still failing 76/153 |
| Verified by source inspection | File behavior directly inspected | `ConfTab.pickTheme`, `switchTheme`, `BottomSheet`, Composer keydown, theme registry/settings |
| Source/docs mismatch | Docs describe architecture ahead of code | Composer Surface resolver/settings validation |
| Needs live-device QA | Browser/device-specific behavior | mobile keyboard, safe-area, PWA standalone, perceived cold-load polish |
| Product decision | Ari must choose tradeoff | Vapor contrast exception, Storybook adoption, shell/OpenAPI defaults |

**Explicit limits**

This audit did not perform real iPhone/Android hardware testing, full WebKit/Chromium/Firefox screenshot matrix, production Tailscale/HTTPS deployment tests, destructive remote-host actions, or visual regression baselines. Those should be added before calling the app product-ready.

---

### Source-of-truth reconciliation for Claude Code

The repo has current docs plus historical architecture notes. A coding agent should not silently mix stale design text with current source.

**Recommended read order**

1. `docs/HANDOFF.md` — current orientation/current-state context.
2. `docs/DECISIONS.md` — durable decisions if present/current.
3. `docs/THEME_ENGINE.md` — theme-engine architecture and Composer Surface direction.
4. `docs/COMPOSER_SURFACE_PLAN.md` — concrete Composer Surface implementation plan if present/current.
5. Source code — final arbiter of what exists today.
6. Older architecture docs/sketches — background only when not contradicted by current docs/source.

**Conflict rule**

```text
current handoff/state > decisions > focused implementation plan > source reality > older architecture sketch
```

Before touching architecture-sensitive files, Claude Code should state which docs it is following and whether it found contradictions.

---

### Architecture map

**Runtime topology**

```text
Browser / PWA
  ├─ Vite-built React SPA
  │   ├─ theme engine + theme modules
  │   ├─ chat/dashboard tabs
  │   ├─ local UI state / appearance persistence
  │   └─ SSE/fetch API client
  │
  └─ FastAPI backend
      ├─ /api routers
      ├─ YAML settings/config
      ├─ SQLite/chat/event/memory state
      ├─ action/tool registries
      ├─ OpenAPI/MCP integrations
      ├─ local shell/service controls
      └─ model/inference adapters
```

**Frontend module risks**

| Area | Responsibility | Main risk |
|---|---|---|
| `theme-engine/registry.ts` | built theme registry | planned IDs vs registered IDs mismatch |
| `theme-engine/settings.ts` | defaults/overrides | missing invalid-value validation |
| `theme-engine/switchTheme.ts` | lazy theme loading + transitions | failure result not reflected to save path |
| `theme-engine/kit/*` | reusable Kit root/chrome/components | must stay theme-neutral and contract-tested |
| `themes/vapor/*` | frozen/bespoke original theme | should not be broken by Kit refactors |
| `themes/minimal/*` | first Kit reskin | good baseline for token-only themes |
| `themes/cosmos/*` | bespoke visual theme/custom surfaces | DOM-query coupling, layout/focus/mobile edge cases |
| `hooks/useAppearance.ts` | local/server appearance reconciliation | casts server strings into frontend types |
| `hooks/useComposer.ts` | headless composer behavior | blank send/IME/streaming edge cases |
| `tabs/ConfTab.tsx` | appearance UI and writes | can persist failed theme switch |
| `e2e/*` | product flow/a11y tests | default-theme heavy; contrast disabled |

**Backend module risks**

| Area | Responsibility | Main risk |
|---|---|---|
| `app/api/settings.py` | settings/appearance read-write | appearance writes use heavyweight settings path |
| `app/config.py` | typed config/YAML persistence | appearance values are broad strings |
| `app/api/agent.py` | chat/SSE/exec endpoints | disconnect persistence needs verification; exec is high-risk |
| `app/services/action_service.py` | action risk/confirm/audit | good concept; response mapping duplicated elsewhere |
| `app/adapters/openapi_tools.py` | OpenAPI import/exposure | broad exposure, unsafe GET assumption, path encoding |
| `backend/tests/*` | backend confidence layer | async loop helper drift blocks reliable signal |

**Cross-boundary contracts requiring explicit tests**

| Contract | Producer | Consumer | Risk | Required guard |
|---|---|---|---|---|
| Appearance theme/mode | backend config/API | frontend `useAppearance` | invalid/stale strings | runtime validation + fallback |
| Theme settings | local/server storage | theme engine/settings UI | impossible variant selection | `resolveThemeSetting` + tests |
| Composer variant | theme setting/spec | Kit Composer resolver | missing variant/slot drift | registry + slot contract tests |
| API DTOs | FastAPI/Pydantic/dicts | TS interfaces | handwritten drift | OpenAPI generation or contract tests |
| SSE events | backend stream | frontend chat state | disconnect/cancel/data loss | integration test |
| Action confirm token | backend service | frontend action UI | stale/replay/shape drift | typed DTO + expiry/replay tests |
| Theme assets/CSS | lazy modules | `switchTheme` | load failure / blank / partial state | awaitable success/failure contract |

---

### Risk register

| ID | Area | Finding | Severity | Likelihood | Blast radius | Confidence | Priority |
|---|---|---|---|---|---|---|---|
| R1 | Backend tests | repeated `get_event_loop().run_until_complete` breaks modern test runs | High | High | blocks backend confidence | verified | P0 |
| R2 | Theme settings | persisted invalid values can select impossible UI states | High | Medium | crash/bad theme state | source/docs | P0 |
| R3 | Appearance IDs | server/local theme IDs cast without registry validation | High | Medium | stale config poisons UI | source | P0 |
| R4 | Theme switch save | failed lazy theme load can still be persisted | Medium/High | Medium | reload/cross-device mismatch | source | P0/P1 |
| R5 | Composer Surface | slot/variant model partial vs docs | High | High if adding themes | theme sprawl/regressions | source/docs | P0 |
| R6 | Cold lazy theme load | persisted non-default theme can show blank fallback | Medium | Medium | perceived polish | source | P1 |
| R7 | Cosmos DOM queries | theme surface queries `.kit-*` globally | Medium | Medium | fragile coupling | source | P1 |
| R8 | Mobile safe-area | keyboard/safe-area not fully matrix-tested | Medium/High | Medium | mobile usability | inferred | P1 |
| R9 | Contrast | axe disables `color-contrast`; token contrast not enforced | Medium/High | Medium | unreadable future themes | source/research | P1 |
| R10 | BottomSheet focus | non-modal sheet lacks strong focus management | Medium | Medium | keyboard/AT usability | source | P1 |
| R11 | Composer IME | Enter-to-send lacks composition guard | Medium | Medium for IME users | accidental sends | source | P1 |
| R12 | API contract | backend/frontend DTOs duplicated by hand | Medium | Medium | silent runtime drift | source | P1 |
| R13 | SSE disconnect | persistence-on-disconnect claim unverified | Medium/High | Unknown | lost chat turns | source | P1 verify |
| R14 | OpenAPI tools | broad exposure/GET-safe assumption/path substitution | High if exposed | Medium | tool safety | source | P1 |
| R15 | Public exposure | no auth/CSRF assumes trusted localhost/tailnet | High if exposed | Low/Medium | shell/action compromise | source | P1 decision |
| R16 | Long lists | virtualization/budgets not specified for growth | Medium | Medium | INP/memory degradation | research/inferred | P2/P1 when data grows |

---

### Final product design-system invariants

These should become review rules and, where practical, tests.

**Theme invariants**

- Every registered theme has a stable ID, display metadata, root/Kit compatibility, token CSS, valid defaults, and fallback behavior if optional assets fail.
- A planned theme ID is not the same as a built/registered theme ID.
- Invalid persisted `theme`, `mode`, `accent`, or settings never crash the UI.
- Theme switching should be transactional: load assets → apply DOM attrs/classes → update local state → persist server setting only after successful activation, or persist a clearly marked requested state with fallback semantics.
- Switching `vapor -> minimal -> cosmos -> vapor` leaves no stale body/html attrs from previous themes.

**Token invariants**

- Components consume semantic/component tokens, not raw palette values.
- Tokens cover color, typography, spacing/density, radius, elevation, z-index, focus rings, motion, status, chat roles, and composer surfaces.
- Non-vapor themes should meet WCAG contrast expectations unless Ari explicitly marks a theme as artistic/experimental.
- Token aliases must not be circular.
- Deprecated tokens need migration/aliasing instead of silent deletion.

**Surface/reuse invariants**

- Shared surfaces exist only when at least two real themes need structural variation with shared behavior.
- Token-only differences do not become separate surfaces.
- Bespoke roots are allowed, but should not fork headless behavior unnecessarily.
- Every Surface has a stable slot contract, default variant, fallback behavior, registry/spec entry, and contract tests.
- Headless hooks own behavior; themes own presentation.
- A theme should reuse another theme’s asset/component only through an explicit exported contract, not deep imports into internals.

---

### Newly found product-edge findings

#### P0/P1 — failed lazy theme switch can be persisted

**Evidence**

- `frontend/src/tabs/ConfTab.tsx:238-247` calls `void switchTheme(id, target)` and immediately mutates server appearance to `theme: id`.
- `frontend/src/theme-engine/switchTheme.ts:70-76` aborts and shows toast when theme load fails.

**Risk**

If `ensureThemeLoaded` fails, the UI stays on the old theme but the server may persist the failed theme. Reloads or other devices can repeatedly try the broken theme.

**Acceptance tests**

- Mock `ensureThemeLoaded` rejection.
- Assert no server appearance write to the failed theme.
- Assert UI remains on previous theme.
- Assert user sees a toast/error.

#### P1 — cold persisted non-default theme can show blank fallback

**Evidence**

- `frontend/src/App.tsx:32-37` comments that persisted non-default theme cold-load can suspend with `fallback=null`.
- `frontend/index.html:22-47` bootstraps html attrs from localStorage but does not preload all lazy CSS/root chunks.

**Acceptance tests**

- Playwright cold-load with `ctrlb.ui.theme="cosmos"`.
- CPU/network throttle.
- Assert no blank screen beyond a small threshold or provide a themed skeleton.

#### P1 — mobile viewport/safe-area/keyboard matrix is incomplete

**Evidence**

- `frontend/index.html:8` uses `viewport-fit=cover`.
- `frontend/src/App.tsx:54-69` sets `--app-h` from `visualViewport.height`.
- Kit has explicit bottom safe-area handling; Vapor appears more reliant on normal flow/zero bottom body padding.

**Acceptance tests/manual QA**

For every theme: iPhone-ish viewport, Android-ish viewport, landscape, keyboard open/close, toolbar collapse/expand, PWA standalone, and safe-area assertions for send/mic/tabbar/sheet controls.

#### P1 — color contrast is not protected enough

**Evidence**

- `frontend/e2e/a11y.spec.ts:25-33` disables `color-contrast`.

**Recommendation**

Add token-level contrast tests for semantic pairs. Keep any deliberate Vapor exception explicit. Targets: normal text 4.5:1, large text 3:1, meaningful UI boundary/non-text 3:1.

Sources:

- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Understanding Contrast Minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Non-text Contrast: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html

#### P1 — BottomSheet focus management needs polish

**Evidence**

- `frontend/src/components/BottomSheet.tsx:19-24` documents non-modal/no focus trap.
- `frontend/src/components/BottomSheet.tsx:273` uses `role="dialog"`.
- `frontend/src/components/BottomSheet.tsx:261-269` handles Escape on `.bs-root`.

**Acceptance behavior**

- Focus title or close button on open.
- Escape closes reliably when focus is in sheet.
- Focus returns to trigger/selected planet on close.
- Background interactivity is documented if non-modal remains intentional.

#### P1 — Composer send UX needs blank/IME protections

**Evidence**

- `frontend/src/hooks/useComposer.ts:39-43` no-ops on blank/streaming.
- Kit/Vapor send buttons disable only during streaming.
- Kit/Vapor composers submit on Enter without checking composition state.

**Acceptance tests**

- Blank and whitespace-only draft disable send.
- Enter during IME composition does not send.
- Shift+Enter inserts newline.
- Enter sends only when not composing and draft is non-empty.

---

### Performance and fluidity strategy

Final-product CTRL/B should be judged by interaction smoothness on real devices, not just “tests pass.”

**Core Web Vitals / INP targets**

Sources:

- INP: https://web.dev/articles/inp
- Optimize INP: https://web.dev/articles/optimize-inp

| Metric | Target |
|---|---|
| INP p75 mobile/desktop | ≤ 200 ms |
| Needs improvement | 200–500 ms |
| Poor | > 500 ms |
| Long task smell | > 50 ms |

Measure these high-risk interactions:

- send message;
- type in composer while streaming;
- switch theme;
- open settings/appearance;
- open Cosmos bottom sheet;
- switch tabs;
- scroll long chat history;
- status polling while UI is busy;
- service action confirmation.

**React rendering rules**

Sources:

- React `memo`: https://react.dev/reference/react/memo
- React `lazy`: https://react.dev/reference/react/lazy
- Virtualization: https://legacy.reactjs.org/docs/optimizing-performance.html#virtualize-long-lists
- Code splitting: https://web.dev/articles/code-splitting-suspense

Rules:

- Profile production builds before memoizing.
- Split context by volatility: theme, auth/session, streaming chat, layout metrics, settings.
- Keep transient UI state local where possible.
- Stabilize props passed to expensive memoized children.
- Virtualize long chat history, tables, feeds, command palettes, and logs when they grow.

Chat virtualization edge cases:

- variable-height messages;
- streaming message growth;
- prepending older messages without scroll jump;
- jump-to-latest;
- search highlights;
- keyboard/screen-reader behavior;
- code blocks/markdown that load after measurement.

**CSS containment/offscreen rendering**

Sources:

- CSS `contain`: https://developer.mozilla.org/en-US/docs/Web/CSS/contain
- `content-visibility`: https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

Use carefully:

```css
.widget-card { contain: content; }
.dashboard-section {
  content-visibility: auto;
  contain-intrinsic-size: 800px;
}
```

Good candidates: dashboard cards, inactive panels, long settings sections, chat message groups, heavy widgets. Avoid applying blindly to dropdown/popover parents, sticky regions, focus-ring-heavy controls, or anything needing overflow escape.

**Motion**

Sources:

- High-performance CSS animations: https://web.dev/articles/animations-guide
- `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

Rules:

- Prefer `transform` and `opacity`.
- Avoid animating `height`, `width`, `top`, `left`, heavy blur, and large shadows.
- Tokenize duration/easing.
- Reduced motion should replace decorative motion with instant/fade/state feedback, not remove feedback entirely.
- Skeleton shimmer becomes static under reduced motion.
- Chat auto-scroll respects user intent and reduced motion.

**View Transitions**

Sources:

- View Transition API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- `document.startViewTransition`: https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition

Use only progressively:

```ts
if (document.startViewTransition) {
  document.startViewTransition(() => updateUI())
} else {
  updateUI()
}
```

Watch for live chat/canvas snapshots, fixed headers, overlays, focus restoration, reduced motion, and transitions hiding slow work.

---

### Token/theme architecture for expandable final product

Sources:

- Design Tokens Format Module: https://tr.designtokens.org/format/
- Style Dictionary: https://styledictionary.com/getting-started/installation/
- Chakra theming overview: https://chakra-ui.com/docs/theming/overview
- MDN CSS custom properties: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties
- MUI CSS theme variables: https://mui.com/material-ui/customization/css-theme-variables/overview/

Recommended layers:

```text
primitive tokens
  -> semantic tokens
    -> component/slot tokens
      -> theme overrides
```

Examples:

- primitive: raw palette, spacing, radius, typography, elevation, motion;
- semantic: `color.bg.surface`, `color.text.primary`, `color.border.focus`, `color.status.danger`;
- component/slot: `composer.input.bg`, `messageBubble.user.bg`, `nav.item.active.bg`, `sheet.handle.color`;
- theme overrides: Vapor, Minimal, Cosmos, future packs.

Reuse policy:

1. Theme-local implementation first.
2. If a second real theme needs the same structure, extract headless behavior or Kit component.
3. Define slot/token contract.
4. Add cross-theme tests.
5. Update docs.

Avoid: hardcoded colors in reusable components, shared components branching on `themeId`, themes deep-importing other theme internals, unvalidated raw variant strings, CSS selectors depending on private DOM, and runtime JS theme context re-rendering the whole app for visual-only changes.

---

### UX, accessibility, mobile, and browser matrix

For every theme and major surface:

- keyboard navigation works without mouse;
- focus visible and contrast-appropriate;
- focus returns after dialog/sheet/menu closes;
- icon-only buttons have accessible names;
- nav uses correct tab/list semantics;
- streaming/status/toasts have appropriate live-region behavior;
- loading/empty/error states are discoverable;
- color is not the only status indicator;
- reduced motion works;
- text zoom/large font does not break layout;
- semantic contrast pairs are checked.

Mobile matrix per theme:

- 390x844 / 393x852 iPhone-ish viewport;
- 412x915 Android-ish viewport;
- landscape phone;
- keyboard open/close in composer;
- toolbar collapse/expand;
- PWA standalone if enabled;
- safe-area bottom/top/left/right;
- long composer growth;
- comfortable touch targets;
- bottom sheet/drawer scroll behavior;
- overscroll/scroll-chaining.

Cross-theme states:

- initial cold load;
- switch into/out of theme;
- active chat streaming;
- empty chat;
- long chat history;
- settings open;
- plan overlay open;
- service action confirmation;
- error toast;
- reduced motion;
- invalid/stale persisted setting fallback.

---

### State, persistence, and migration audit

| State | Location | Risk | Required behavior |
|---|---|---|---|
| theme/mode/accent | local UI store + server appearance | conflict/stale values | validate + timestamp reconciliation |
| per-theme settings | local/server appearance settings | invalid option after deploy | fallback to spec default |
| theme assets | browser module/CSS cache | failed load/partial state | transactional activation |
| chat/session state | backend DB/SSE | disconnect/cancel | persistence integration test |
| config/settings | YAML/backend models | corruption/secret leak | backup + validation + masking |
| service worker cache | browser | stale deploy assets | update/recovery path |
| media permissions | browser | denied mic/audio | explicit error states |

Migration rules:

- unknown theme ID → fallback to default or previous valid theme;
- unknown setting key → ignore/preserve only if forward compatibility needs it;
- invalid setting value → fallback to current spec default;
- removed variant → fallback to default and optionally clean persisted value on next save;
- renamed token → alias/deprecate for at least one migration window.

---

### Security and trust-boundary expansion

Current safety posture makes sense only if CTRL/B remains owner-operated, localhost/tailnet-only, same-origin, and not exposed to arbitrary LAN/internet browsers. If that changes, auth/CSRF/session hardening becomes product-critical.

Trust boundaries:

- browser UI;
- backend API process;
- local shell;
- remote hosts/services;
- YAML config and SQLite DB;
- model/provider responses;
- MCP servers;
- OpenAPI schemas/tools;
- web/search/crawled content.

High-risk edge cases:

- malicious OpenAPI schema expands tool surface unexpectedly;
- GET endpoint mutates despite low-risk classification;
- path substitution without URL encoding changes target;
- prompt injection arrives through search/crawl/tool output;
- stale confirmation token replay;
- disabled shell indirectly exposed through another tool/action;
- secrets returned by settings/logging;
- CSRF/local-network browser attack if exposed beyond trusted origin.

Recommended controls:

- explicit action/tool risk classification;
- OpenAPI/MCP allowlists;
- single-use short-TTL confirmation tokens;
- audit log for high-risk actions;
- URL-encode path params;
- never assume GET is safe for third-party APIs;
- auth/CSRF plan before LAN/public exposure;
- secret masking tests.

---

### Test and verification matrix

**Frontend quality gate**

```bash
cd /home/emma/github/ctrl-b/dashboard_v2/frontend
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Add/expand tests for:

- `vapor -> minimal -> cosmos -> vapor` switching;
- failed lazy theme load does not persist failed theme;
- cold persisted `cosmos`/`minimal` load does not blank excessively;
- invalid server/local theme ID fallback;
- invalid theme setting fallback;
- Composer slot contract;
- blank send disabled;
- IME composition guard;
- BottomSheet focus open/Escape/return;
- mobile safe-area screenshot/manual matrix;
- reduced-motion behavior;
- token contrast for non-vapor themes;
- no stale body/html attrs after switching.

**Backend quality gate**

```bash
cd /home/emma/github/ctrl-b/dashboard_v2/backend
uv run --python 3.11 --with pytest --with pytest-asyncio pytest -q
```

After harness modernization, if Python 3.12 is a target:

```bash
uv run --python 3.12 --with pytest --with pytest-asyncio pytest -q
```

Add/expand tests for:

- no implicit current-loop dependency;
- API contract schema/snapshots;
- appearance config validation;
- SSE disconnect persistence;
- temp config/db only for settings tests;
- action confirm token expiry/replay;
- OpenAPI path URL encoding;
- no secret leakage in settings responses.

Cross-stack verification:

- appearance round-trip and reload;
- invalid YAML appearance fallback;
- theme switch while backend save fails;
- offline/server-unavailable appearance behavior;
- streaming chat disconnect/reconnect;
- PWA update/stale asset recovery.

---

### Claude Code execution rules and stop conditions

Working rules:

- Do not push.
- Do not rewrite history.
- Work in small slices.
- Keep Vapor frozen unless explicitly touching it.
- Prefer characterization tests before refactors.
- Do not mix formatting/lint churn with architecture changes.
- Use temp config/db for backend tests.
- Run slice-specific verification after each slice.

Stop and ask Ari before changing:

- shell default enablement;
- OpenAPI/MCP default exposure policy;
- Vapor visual behavior;
- public/tailnet security assumptions;
- Python version support policy;
- design direction that changes theme identity.

Stop and report if:

- backend tests still fail after centralized async harness change;
- a Composer change touches Vapor unexpectedly;
- invalid persisted settings can still select missing variants;
- live theme swap leaves stale body/html attrs;
- e2e/a11y tests regress;
- a fix requires changing owner deployment/security model;
- a performance fix degrades accessibility/focus/keyboard behavior.

---

### Expanded implementation order

#### P0.1 — Restore backend test confidence

Done when per-file implicit-loop helpers are removed/centralized safely, backend tests pass on documented baseline Python, and Python 3.12 support is either passing or explicitly deferred.

#### P0.2 — Theme/appearance validation layer

Done when `isRegisteredThemeId`, `isMode`, and `resolveThemeSetting` exist; all server/local appearance values are validated before applying; invalid values fall back without crash; tests cover bad theme ID, bad mode, bad `seg`, wrong primitive type, and unknown setting.

#### P0.3 — Transactional theme switching

Done when failed lazy theme load cannot be persisted as active appearance, UI/server state cannot silently diverge after failed switch, user gets feedback, and tests mock failed import/CSS load.

#### P0.4 — Composer Surface contract

Done when a stable variant registry exists, per-theme variants come from validated settings, missing/invalid variants fall back to Kit default, slot contract tests cover `controlsStart`/`overlay`/root class/DOM order, and no theme-ID branching leaks into shared root code.

#### P1 — Final-product hardening

Mobile safe-area/keyboard matrix, BottomSheet focus management, IME/blank composer behavior, token contrast tests, Cosmos layout metrics contract, API contract tests/generation, SSE disconnect verification, and OpenAPI/MCP safety hardening.

#### P2 — Scale/workflow

Storybook or equivalent component/theme harness, visual regression snapshots, token build pipeline if CSS tokens outgrow hand-written files, RUM/web-vitals instrumentation, service-worker/PWA update polish, and virtualization when data volume warrants it.

---

## Recommended implementation order

### Phase 1 — Test harness unblock

- [ ] Add centralized async test strategy.
- [ ] Replace per-file `get_event_loop().run_until_complete(...)` helpers.
- [ ] Run backend tests on current target Python.
- [ ] Decide whether backend should officially support Python 3.12 now.

### Phase 2 — Theme safety hardening

- [ ] Add `isRegisteredThemeId` / `isMode` guards.
- [ ] Add `resolveThemeSetting` validation.
- [ ] Add invalid/stale server appearance tests.
- [ ] Add invalid theme setting tests.

### Phase 3 — Composer Surface completion

- [ ] Implement Composer variant registry.
- [ ] Wire variants through per-theme `seg` options.
- [ ] Add fallback-safe resolver.
- [ ] Add slot contract tests.

### Phase 4 — Layout contract cleanup

- [ ] Add Kit layout metrics contract/context/hook.
- [ ] Move Cosmos Fleet away from `document.querySelector(".kit-...")`.
- [ ] Add cleanup tests for global body/root attrs.

### Phase 5 — API contract and settings ergonomics

- [ ] Add OpenAPI → TS generation or contract tests.
- [ ] Extract action response DTO/mappers.
- [ ] Add dedicated `PUT /api/appearance`.
- [ ] Verify SSE disconnect persistence.

### Phase 6 — Performance/design-system workflow

- [ ] Add Storybook or equivalent isolated component/theme harness.
- [ ] Add reduced-motion theme stories/tests.
- [ ] Lazy-load heavy theme assets/widgets.
- [ ] Add token schema/build step only when tokens outgrow hand-written CSS.

---

## Claude Code prompt

```text
You are working on CTRL/B dashboard_v2.

Repository path:
/home/emma/github/ctrl-b/dashboard_v2

Do not push. Do not rewrite history. Work incrementally and keep changes reviewable.

Audit priorities:

0. Read the product-grade expansion section first. Treat the risk register, source-of-truth ordering, acceptance criteria, and stop conditions as binding for the implementation plan.

1. Fix backend async test harness. Do not solve this by pinning old Python. Replace repeated asyncio.get_event_loop().run_until_complete helpers with a modern centralized strategy using pytest-asyncio / async tests / asyncio.run where appropriate. Verify backend tests afterward.

2. Harden the theme engine before adding more theme variants:
   - validate server/local appearance theme/mode values before applying;
   - implement resolveThemeSetting(themeId, key, raw);
   - reject/fallback invalid seg/switch values;
   - add tests for stale/invalid settings.

3. Finish the Composer Surface architecture described in docs/THEME_ENGINE.md:
   - stable variant registry;
   - per-theme allowed variants through settings spec;
   - fallback-safe resolver;
   - slot contract tests for controlsStart and overlay.

4. Reduce CSS/layout leakage:
   - centralize global body/root attrs;
   - avoid CosmosFleet querying .kit-appbar/.kit-composer directly;
   - expose layout metrics through a root/Kit contract.

5. Improve API maintainability:
   - add OpenAPI/TypeScript contract generation or contract tests;
   - extract duplicated action response mapping;
   - consider dedicated PUT /api/appearance;
   - test SSE disconnect persistence.

Use this audit note as the source of priorities:
/home/emma/Documents/Maia/Audits/CTRL-B dashboard_v2 Theme Engine and Maintainability Audit 2026-06-29.md
```

## Verification notes from this audit

- Frontend tests were previously observed passing: **198/198**.
- Backend retry under Python 3.11 still failed: **76 failed / 153 passed**.
- Failure class is test harness event-loop handling, not simply Python 3.12 age.
- Source repo cleanup removed generated `dashboard_v2/backend/uv.lock`; no source repo commit/push was made.

## Open questions for Ari

- Should `dashboard_v2` officially target Python 3.12 now, once the test harness is modernized?
- Should `shell.user_exec_enabled` default false for new installs, or remain true because this is owner-local tooling?
- Do you want Storybook added as part of the design-system workflow, or should this stay lightweight until the Composer Surface lands?
