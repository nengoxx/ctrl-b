"""Phase 8b — the unified per-tool override layer (D22): `Settings.tool_overrides` +
`runtime.apply_tool_overrides` (description + tri-state `agent_mode`) + the `default_agent_mode` DTO.

What's exercised:
  1. migrate      — legacy `tool_descriptions` folds into `tool_overrides[name].description`; the old key
                    is dropped (never round-trips); an explicit override wins; a blank legacy entry is skipped.
  2. overlay      — apply_tool_overrides maps agent_mode core/enabled/disabled → (agent_exposed, core);
                    absent → restores the captured compile-time default; a blank description restores too.
  3. for_agent    — a `core` override survives an empty allowlist *and* skill narrowing; demoting a
                    default-core tool to `enabled` drops it from for_agent([]); `disabled` leaves agent_tools().
  4. dto          — GET /api/actions reports `default_agent_mode` from the *originals* even while overridden.
  5. clear        — clearing an override (None fields) restores the built-in description + mode.
  6. gate         — `agent_mode` is availability only: making `run_shell` core leaves its HIGH risk and the
                    `decide(shell.agent_exec_enabled)` execution gate untouched (membership ≠ privilege; the
                    gate itself is covered by test_shell_5).

Each test boots the app on an isolated temp config/db; the real config is never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "computers: {}\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


#: The registry is a module-level singleton, so `apply_tool_overrides` mutations to a spec leak across
#: the multiple `create_app()` apps a test run builds (in production there's one app per process, so
#: the originals capture is always pristine). `_app` snapshots the compile-time defaults on the first
#: boot and restores every spec's (description, agent_exposed, core) on exit, keeping tests order-free.
_DEFAULTS: dict[str, tuple] = {}


@contextlib.contextmanager
def _app(config_text: str = "computers: {}\n"):
    with _workspace(config_text), _client() as c:
        reg = c.app.state.actions.registry
        if not _DEFAULTS:
            for t in reg.all():
                _DEFAULTS[t.spec.name] = (t.spec.description, t.spec.agent_exposed, t.spec.core)
        try:
            yield c
        finally:
            for t in reg.all():
                d = _DEFAULTS.get(t.spec.name)
                if d:
                    t.spec.description, t.spec.agent_exposed, t.spec.core = d


# --- 1. legacy migration (pure, no app) ------------------------------------------------------


def test_legacy_tool_descriptions_fold_into_overrides() -> None:
    from app.config import Settings

    s = Settings.model_validate({"computers": {}, "tool_descriptions": {"wake_host": "Wake a machine"}})
    assert s.tool_overrides["wake_host"].description == "Wake a machine"
    assert s.tool_overrides["wake_host"].agent_mode is None
    # The legacy key is dropped — it must not survive (extra="allow" would otherwise round-trip it).
    dumped = s.model_dump()
    assert "tool_descriptions" not in dumped


def test_explicit_override_wins_over_legacy_and_blank_skipped() -> None:
    from app.config import Settings

    s = Settings.model_validate(
        {
            "computers": {},
            "tool_descriptions": {"wake_host": "legacy", "ping_host": "   "},
            "tool_overrides": {"wake_host": {"description": "explicit"}},
        }
    )
    assert s.tool_overrides["wake_host"].description == "explicit"  # explicit wins
    assert "ping_host" not in s.tool_overrides  # blank legacy entry skipped


def test_explicit_blank_override_beats_lingering_legacy() -> None:
    """A legacy `tool_descriptions` key can linger on disk next to `tool_overrides` (the write path
    never deletes keys). An explicit `description: ""` (the catalog's restore-to-built-in) must win
    over the legacy text — not get re-applied on the next load."""
    from app.config import Settings

    s = Settings.model_validate(
        {
            "computers": {},
            "tool_descriptions": {"wake_host": "legacy text"},
            "tool_overrides": {"wake_host": {"description": ""}},
        }
    )
    assert s.tool_overrides["wake_host"].description == ""  # restore-intent preserved, legacy ignored


# --- 2. overlay truth table ------------------------------------------------------------------


def test_overlay_agent_mode_truth_table() -> None:
    from app.config import ToolOverride
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        reg = app.state.actions.registry
        settings = app.state.settings

        for mode, (exp_exposed, exp_core) in {
            "core": (True, True),
            "enabled": (True, False),
            "disabled": (False, False),
        }.items():
            settings.tool_overrides = {"wake_host": ToolOverride(agent_mode=mode)}
            apply_tool_overrides(app)
            spec = reg.get("wake_host").spec
            assert (spec.agent_exposed, spec.core) == (exp_exposed, exp_core), mode

        # absent → restores the compile-time default (wake_host ships agent_exposed, non-core).
        settings.tool_overrides = {}
        apply_tool_overrides(app)
        spec = reg.get("wake_host").spec
        assert (spec.agent_exposed, spec.core) == (True, False)


def test_overlay_description_blank_restores_builtin() -> None:
    from app.config import ToolOverride
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        reg = app.state.actions.registry
        builtin = reg.get("wake_host").spec.description

        app.state.settings.tool_overrides = {"wake_host": ToolOverride(description="Sharper wording")}
        apply_tool_overrides(app)
        assert reg.get("wake_host").spec.description == "Sharper wording"

        app.state.settings.tool_overrides = {"wake_host": ToolOverride(description="   ")}
        apply_tool_overrides(app)
        assert reg.get("wake_host").spec.description == builtin  # blank → built-in


# --- 3. for_agent semantics ------------------------------------------------------------------


def test_core_survives_empty_allowlist_and_demotion_drops() -> None:
    from app.config import ToolOverride
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        reg = app.state.actions.registry

        # Promote an ordinarily-narrowable action to core → it survives an empty allowlist (skill
        # narrowing feeds the narrowed list back through for_agent, so core survives that too).
        app.state.settings.tool_overrides = {"ping_host": ToolOverride(agent_mode="core")}
        apply_tool_overrides(app)
        assert "ping_host" in {t.spec.name for t in reg.for_agent([])}

        # Demote a default-core builtin (task_plan) to enabled → it no longer survives for_agent([]).
        assert reg.get("task_plan").spec.core is True  # default is core
        app.state.settings.tool_overrides = {"task_plan": ToolOverride(agent_mode="enabled")}
        apply_tool_overrides(app)
        assert "task_plan" not in {t.spec.name for t in reg.for_agent([])}


def test_disabled_leaves_agent_tools() -> None:
    from app.config import ToolOverride
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        reg = app.state.actions.registry
        assert "wake_host" in {t.spec.name for t in reg.agent_tools()}

        app.state.settings.tool_overrides = {"wake_host": ToolOverride(agent_mode="disabled")}
        apply_tool_overrides(app)
        assert "wake_host" not in {t.spec.name for t in reg.agent_tools()}
        assert "wake_host" not in {t.spec.name for t in reg.for_agent("*")}


# --- 4. default_agent_mode DTO ---------------------------------------------------------------


def test_dto_reports_default_mode_even_when_overridden() -> None:
    from app.config import ToolOverride
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        # Override wake_host (default enabled) to disabled; the DTO must still report the *default*.
        app.state.settings.tool_overrides = {"wake_host": ToolOverride(agent_mode="disabled")}
        apply_tool_overrides(app)

        actions = {a["name"]: a for a in c.get("/api/actions").json()}
        assert actions["wake_host"]["default_agent_mode"] == "enabled"
        assert actions["task_plan"]["default_agent_mode"] == "core"
        assert actions["wake_host"]["agent_exposed"] is False  # the live (overridden) state
        assert actions["wake_host"]["core"] is False


def test_dto_carries_approvals_from_live_overrides() -> None:
    """D44 W3: `GET /api/actions` enriches each DTO with the tool's live persisted 'always allow' rules
    (`tool_overrides[name].approvals`) — `[]` when none — so the Tools-tab catalog can list/revoke them
    from the SAME always-active `["actions"]` query (approvals are settings state, not a spec property)."""
    from app.config import ApprovalRule, ToolOverride

    with _app() as c:
        # No override → empty approvals list on every DTO.
        actions = {a["name"]: a for a in c.get("/api/actions").json()}
        assert actions["wake_host"]["approvals"] == []

        # A rule persisted on the live settings surfaces on the DTO (args-map round-trips).
        c.app.state.settings.tool_overrides = {
            "wake_host": ToolOverride(approvals=[ApprovalRule(args={"host_id": "vault"})])
        }
        actions = {a["name"]: a for a in c.get("/api/actions").json()}
        assert actions["wake_host"]["approvals"] == [{"args": {"host_id": "vault"}}]
        assert actions["ping_host"]["approvals"] == []  # untouched tools stay empty


def test_disabled_utility_still_user_runnable() -> None:
    """A Section-A run card stays **user-runnable regardless of the agent-access toggle**: disabling a
    utility's `agent_mode` flips `agent_exposed` (the agent can't call it) but never `ui_exposed`, so
    the card is still listed by `GET /api/tools` and still invokable via `POST /api/tools/{name}`
    (USER). The toggle governs the agent only — the user can always run the tool."""
    with _app() as c:
        assert (
            c.put(
                "/api/settings", json={"tool_overrides": {"dns_trace": {"agent_mode": "disabled"}}}
            ).status_code
            == 200
        )
        # The agent no longer sees it...
        assert "dns_trace" not in {t.spec.name for t in c.app.state.actions.registry.agent_tools()}
        # ...but it's still a run card, and still runs for the user.
        assert "dns_trace" in {t["name"] for t in c.get("/api/tools").json()}
        r = c.post("/api/tools/dns_trace", json={"args": {"host": "localhost"}})
        assert r.status_code == 200 and r.json()["result"]["state"] == "ok"


def test_tools_dto_carries_default_agent_mode() -> None:
    """The run-card endpoint (`GET /api/tools`) is enriched with `default_agent_mode` too (shared
    `runtime.spec_dto`), so each card can render the tri-state toggle — utilities default to enabled."""
    with _app() as c:
        tools = {t["name"]: t for t in c.get("/api/tools").json()}
        assert tools, "expected utility cards"
        for name, t in tools.items():
            assert t["default_agent_mode"] == "enabled", name  # @tool presets agent_exposed, non-core


# --- 5. clear restores ------------------------------------------------------------------------


def test_clear_override_restores_builtin() -> None:
    from app.config import ToolOverride
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        reg = app.state.actions.registry
        orig_desc = reg.get("wake_host").spec.description

        app.state.settings.tool_overrides = {
            "wake_host": ToolOverride(description="X", agent_mode="disabled")
        }
        apply_tool_overrides(app)
        # A cleared row is persisted as an all-None override (deep_merge can't delete a map key).
        app.state.settings.tool_overrides = {"wake_host": ToolOverride()}
        apply_tool_overrides(app)
        spec = reg.get("wake_host").spec
        assert spec.description == orig_desc
        assert (spec.agent_exposed, spec.core) == (True, False)


# --- 6. membership ≠ privilege ----------------------------------------------------------------


def test_agent_mode_does_not_touch_execution_gating() -> None:
    from app.config import ToolOverride
    from app.domain.enums import Risk
    from app.runtime import apply_tool_overrides

    with _app() as c:
        app = c.app
        reg = app.state.actions.registry
        # Making run_shell `core` makes it *available* but must not alter its HIGH risk nor flip the
        # separate `shell.agent_exec_enabled` execution gate (that gate is exercised by test_shell_5).
        app.state.settings.tool_overrides = {"run_shell": ToolOverride(agent_mode="core")}
        apply_tool_overrides(app)
        spec = reg.get("run_shell").spec
        assert spec.core is True and spec.agent_exposed is True  # available
        assert spec.risk == Risk.HIGH  # execution risk untouched
        assert app.state.settings.shell.agent_exec_enabled is False  # the gate is a separate axis


# --- 7. end-to-end PUT round-trip + on-disk legacy migration ---------------------------------


def test_api_put_overrides_round_trip() -> None:
    """PUT /api/settings {tool_overrides: …} applies live (registry spec + GET /api/actions reflect
    it, no restart), persists to disk, and a cleared (all-None) override restores the built-in."""
    with _app() as c:
        cfg = Path(os.environ["CTRLB_CONFIG"])
        builtin = {a["name"]: a for a in c.get("/api/actions").json()}["ping_host"]["description"]

        r = c.put(
            "/api/settings",
            json={
                "tool_overrides": {"ping_host": {"description": "Custom probe.", "agent_mode": "disabled"}}
            },
        )
        assert r.status_code == 200, r.text
        spec = c.app.state.actions.registry.get("ping_host").spec
        assert spec.description == "Custom probe." and spec.agent_exposed is False  # live overlay
        dto = {a["name"]: a for a in c.get("/api/actions").json()}["ping_host"]
        assert dto["description"] == "Custom probe." and dto["default_agent_mode"] == "enabled"
        assert "Custom probe." in cfg.read_text(encoding="utf-8")  # persisted

        # Clear it (an all-None override — deep_merge can't delete a map key) → built-in restored.
        r2 = c.put(
            "/api/settings", json={"tool_overrides": {"ping_host": {"description": "", "agent_mode": None}}}
        )
        assert r2.status_code == 200, r2.text
        spec = c.app.state.actions.registry.get("ping_host").spec
        assert spec.description == builtin and spec.agent_exposed is True


def test_api_put_partial_axis_preserves_other() -> None:
    """The frontend writes one axis at a time (the run card sends description-only; the catalog can
    send mode-only). deep_merge must preserve the untouched axis — a mode-only PUT keeps the existing
    description override and vice-versa."""
    with _app() as c:
        reg = c.app.state.actions.registry
        # 1) set a description override.
        assert (
            c.put(
                "/api/settings", json={"tool_overrides": {"ping_host": {"description": "Probe a host."}}}
            ).status_code
            == 200
        )
        # 2) a MODE-only PUT (no description key) must keep the description.
        assert (
            c.put(
                "/api/settings", json={"tool_overrides": {"ping_host": {"agent_mode": "disabled"}}}
            ).status_code
            == 200
        )
        spec = reg.get("ping_host").spec
        assert spec.description == "Probe a host." and spec.agent_exposed is False
        # 3) a DESCRIPTION-only PUT must keep the mode.
        assert (
            c.put(
                "/api/settings", json={"tool_overrides": {"ping_host": {"description": "Sharper."}}}
            ).status_code
            == 200
        )
        spec = reg.get("ping_host").spec
        assert spec.description == "Sharper." and spec.agent_exposed is False  # mode preserved


def test_legacy_tool_descriptions_config_on_disk_applies() -> None:
    """A pre-8b config.yaml with `tool_descriptions:` still loads end-to-end: the before-validator
    folds it into tool_overrides and lifespan's apply_tool_overrides reaches the live spec."""
    legacy_cfg = "computers: {}\ntool_descriptions:\n  ping_host: Probe a host's reachability.\n"
    with _app(legacy_cfg) as c:
        dto = {a["name"]: a for a in c.get("/api/actions").json()}["ping_host"]
        assert dto["description"] == "Probe a host's reachability."


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
