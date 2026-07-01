"""Phase 7e-f-2 — core-builtin reachability (`ToolSpec.core` + `ToolRegistry.for_agent`).

The cognitive builtins (`task_plan`/`memory`/`session_search`) are marked `core=True`, so an agent
with an explicit `tools` allowlist that *omits* them can still reach them — and so can an agent whose
toolset a skill has narrowed (the narrowed allowlist is fed back through `for_agent`). Non-core tools
(actions, and the explicit-grant builtins like `skill_manage`/`spawn_subagents`) are only present when
the allowlist matches them.

What's exercised:
  1. core set       — exactly task_plan/memory/session_search carry `core=True`.
  2. survives allow — `for_agent(['ping_host'])` still includes all core tools + ping_host.
  3. survives narrow— a skill-narrowed allowlist (e.g. ['web_search']) keeps the core tools.
  4. non-core gated — skill_manage/spawn_subagents are absent unless explicitly allowed.
  5. star unchanged — `for_agent('*')` is every agent tool (core flag is a no-op there).
"""

from __future__ import annotations


def _registry():
    from app.services.actions import build_registry

    return build_registry()


_CORE = {"task_plan", "memory", "session_search", "question"}  # `question` joined the core set (A2)


def test_core_set_is_the_cognitive_set() -> None:
    reg = _registry()
    assert {t.spec.name for t in reg.all() if t.spec.core} == _CORE


def test_core_survives_a_narrow_allowlist() -> None:
    reg = _registry()
    names = {t.spec.name for t in reg.for_agent(["ping_host"])}
    assert _CORE <= names  # all core builtins reachable
    assert "ping_host" in names  # the explicit allow still applies


def test_core_survives_skill_narrowing() -> None:
    # narrow_tools returns a concrete name list (the skill's allowed_tools ∩ agent allow); feeding it
    # back through for_agent must still surface the core set.
    reg = _registry()
    names = {t.spec.name for t in reg.for_agent(["web_search"])}
    assert _CORE <= names
    assert "wake_host" not in names  # an unrelated action stays excluded


def test_non_core_builtins_need_an_explicit_grant() -> None:
    reg = _registry()
    names = {t.spec.name for t in reg.for_agent(["ping_host"])}
    assert "skill_manage" not in names
    assert "spawn_subagents" not in names
    # …but they appear when the allowlist names them.
    granted = {t.spec.name for t in reg.for_agent(["skill_manage", "spawn_subagents"])}
    assert {"skill_manage", "spawn_subagents"} <= granted


def test_star_allowlist_is_unchanged_by_core() -> None:
    reg = _registry()
    assert {t.spec.name for t in reg.for_agent("*")} == {t.spec.name for t in reg.agent_tools()}


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
