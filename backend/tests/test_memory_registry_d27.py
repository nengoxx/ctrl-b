"""D27 slice A — the store registry (`StoreSpec` + `FileMemoryProvider` registry-driven resolution).

A pure, behaviour-preserving refactor: the two hardcoded stores became registry entries. The existing
`test_memory_7e` / `test_memory_tool_7e` / `test_memory_panel_7e` / `test_memory_git_backup_d26`
suites are the real safety net (they must pass unchanged); this file pins the *new* surface — the
registry's structural facts and that path/cap/spec resolution matches the old `_memory_file`/
`_user_file`/`_target` mapping exactly.

What's exercised:
  1. registry shape   — two stores, correct structural facts (scope/filename/semantics/position).
  2. spec lookup      — `user`→USER_STORE, `memory`→MEMORY_STORE, an unknown key → MEMORY_STORE.
  3. path resolution  — root agent → root MEMORY.md/USER.md; specialist → agents/<slug>/MEMORY.md;
                        USER.md is global (same file for any agent).
  4. cap resolution   — `_cap_for` returns the live MemoryCfg caps per store.
  5. inject order     — PERSONA-first then FACTS (both stores FACTS → registration order preserved).

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
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


def _provider():
    """A bare provider over the live temp settings (no git backup — NoopBackup keeps the lock)."""
    from app.config import load_settings
    from app.services.agent.memory import FileMemoryProvider

    settings = load_settings()
    return settings, FileMemoryProvider(settings), settings.resolve_agent(None)


def test_registry_has_all_stores_with_structural_facts() -> None:
    from app.core.memory import MEMORY_STORE, STATE_STORE, USER_STORE, StorePosition, StoreScope, StoreSemantics

    with _workspace():
        _s, prov, _agent = _provider()
        keys = [s.key for s in prov._stores()]
        assert keys == ["memory", "user", "state"]  # registration order; all present regardless of enablement

        assert MEMORY_STORE.scope is StoreScope.AGENT
        assert MEMORY_STORE.filename == "MEMORY.md"
        assert MEMORY_STORE.semantics is StoreSemantics.APPEND
        assert MEMORY_STORE.position is StorePosition.FACTS
        assert MEMORY_STORE.injected and MEMORY_STORE.writable and MEMORY_STORE.backed_up

        assert USER_STORE.scope is StoreScope.GLOBAL
        assert USER_STORE.filename == "USER.md"
        assert USER_STORE.semantics is StoreSemantics.APPEND
        assert USER_STORE.position is StorePosition.FACTS

        # state.md (D27-B): per-agent, SET, persona-positioned
        assert STATE_STORE.scope is StoreScope.AGENT
        assert STATE_STORE.filename == "STATE.md"
        assert STATE_STORE.semantics is StoreSemantics.SET
        assert STATE_STORE.position is StorePosition.PERSONA


def test_spec_lookup_maps_keys_with_legacy_fallback() -> None:
    from app.core.memory import MEMORY_STORE, STATE_STORE, USER_STORE

    with _workspace():
        _s, prov, _agent = _provider()
        assert prov._spec_for("memory") is MEMORY_STORE
        assert prov._spec_for("user") is USER_STORE
        assert prov._spec_for("state") is STATE_STORE  # resolves even though state_enabled defaults off
        assert prov._spec_for("does-not-exist") is MEMORY_STORE  # legacy "anything else → MEMORY.md"


def test_path_resolution_matches_legacy_layout() -> None:
    with _workspace() as tmp:
        settings, prov, agent = _provider()
        root = settings.memories_dir_path()
        assert root == tmp / "memories"

        # root agent: MEMORY.md + USER.md both at the memory-dir root
        mpath, mspec = prov._target(agent, "memory")
        upath, uspec = prov._target(agent, "user")
        assert mpath == root / "MEMORY.md"
        assert upath == root / "USER.md"

        # a specialist's MEMORY.md is namespaced; its USER.md is still the shared global file. Build the
        # AgentDef directly — `resolve_agent("coder")` would fall back to the default with no folder.
        from app.domain.agent import AgentDef

        coder = AgentDef(name="coder")
        assert prov._store_file(coder, mspec) == root / "agents" / "coder" / "MEMORY.md"
        assert prov._store_file(coder, uspec) == root / "USER.md"


def test_cap_resolution_reads_live_caps() -> None:
    from app.core.memory import MEMORY_STORE, STATE_STORE, USER_STORE

    with _workspace():
        settings, prov, _agent = _provider()
        settings.memory.memory_char_limit = 1234
        settings.memory.user_char_limit = 567
        settings.memory.state_char_limit = 89
        assert prov._cap_for(MEMORY_STORE) == 1234
        assert prov._cap_for(USER_STORE) == 567
        assert prov._cap_for(STATE_STORE) == 89


def test_every_store_is_explicitly_wired_no_silent_fallback() -> None:
    """Drift-guard (audit): every store in STORES must be explicitly mapped in `_cap_for` /
    `_store_enabled`, not fall through to memory's cap / always-on. A future store added to the
    registry but forgotten in those maps trips this test instead of silently misbehaving."""
    from app.core.memory import STORES

    with _workspace():
        settings, prov, _agent = _provider()
        # Sentinel on memory's cap: any store that falls through to the memory default returns it.
        settings.memory.memory_char_limit = 999_999
        settings.memory.user_char_limit = 111
        settings.memory.state_char_limit = 222
        for spec in STORES:
            cap = prov._cap_for(spec)
            if spec.key == "memory":
                assert cap == 999_999
            else:
                assert cap != 999_999, f"store '{spec.key}' falls through to the memory cap (unwired)"

        # `_store_enabled` responds to each known store's own switch (memory always-on under master).
        settings.memory.user_profile_enabled = False
        settings.memory.state_enabled = False
        by_key = {s.key: s for s in STORES}
        assert prov._store_enabled(by_key["memory"]) is True
        assert prov._store_enabled(by_key["user"]) is False
        assert prov._store_enabled(by_key["state"]) is False
        settings.memory.user_profile_enabled = True
        settings.memory.state_enabled = True
        assert prov._store_enabled(by_key["user"]) is True
        assert prov._store_enabled(by_key["state"]) is True


def test_inject_order_is_persona_first_then_facts() -> None:
    """Both current stores are FACTS, so the stable sort must preserve registration order (memory →
    user) — the property the `## Agent memory` < `## User profile` section ordering relies on."""
    from app.services.agent.memory import _POSITION_RANK
    from app.core.memory import StorePosition

    assert _POSITION_RANK[StorePosition.PERSONA] < _POSITION_RANK[StorePosition.FACTS]

    with _workspace() as tmp:
        _s, prov, agent = _provider()
        (tmp / "memories").mkdir(parents=True, exist_ok=True)
        (tmp / "memories" / "MEMORY.md").write_text("agent note", encoding="utf-8")
        (tmp / "memories" / "USER.md").write_text("owner note", encoding="utf-8")
        block = prov.load_context(agent)
        assert block.index("## Agent memory") < block.index("## User profile")


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
