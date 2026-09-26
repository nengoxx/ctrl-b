"""Config migration step 5 — D78's persona library (`config_version` 4 → 5; ROLEPLAY_PLAN §14.1 A5,
amended by Emma A-1/A-2).

* `roleplay.persona` with a non-empty field → a library entry minted from its name (or "me") +
  `default_persona`; consumed in any shape (an empty one mints nothing).
* `user_name` renamed IN PLACE to `persona` in `agent.defaults` AND every `agents/*/agent.yaml`: a
  name → the persona with that exact name, else a minted one; an explicit blank stays blank.
* Two names that collapse to one slug never overwrite each other (the `mint_slug` walk).

The pure arms drive `applies`/`apply` over a hand-built `Context`; the runner arms go through
`cm.apply` on a temp `$CTRLB_HOME` (never the real config).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from app import config_migration as cm
from app.config import CONFIG_VERSION_KEY, load_settings
from app.config_migration import Context, MigrationRefused
from app.config_migration.steps import PERSONAS_D78, personas_applies, personas_apply

AGENTS = Path("/nonexistent/agents")


def _ctx(config: dict[str, Any], agents: dict[str, dict[str, Any]] | None = None) -> Context:
    return Context(
        config_path=Path("/nonexistent/config.yaml"),
        agents_dir=AGENTS,
        config=config,
        agents={AGENTS / name / "agent.yaml": doc for name, doc in (agents or {}).items()},
    )


def _agent_out(plan: cm.Plan, name: str) -> dict[str, Any]:
    return plan.agent_files[AGENTS / name / "agent.yaml"]


# ── the pure step ────────────────────────────────────────────────────────────────────────────────


def test_the_step_is_version_5_and_the_last_in_the_chain() -> None:
    assert PERSONAS_D78.version == 5 and cm.STEPS[-1] is PERSONAS_D78
    assert cm.CONFIG_VERSION == 5
    # `roleplay.persona` is one level deep — addressable by `CTRLB_ROLEPLAY__PERSONA` — and gone from
    # the schema, so a stale variable is refused at the attended gate.
    assert PERSONAS_D78.retires == (("roleplay", "persona"),)


def test_the_global_persona_becomes_the_default() -> None:
    ctx = _ctx({"roleplay": {"enabled": True, "persona": {"name": "Ari", "description": "Tall."}}})
    assert personas_applies(ctx) is True
    plan = personas_apply(ctx)
    assert plan.config["roleplay"] == {
        "enabled": True,
        "personas": {"ari": {"name": "Ari", "description": "Tall."}},
        "default_persona": "ari",
    }
    assert [tuple(c) for c in plan.consumes] == [("roleplay", "persona")]


def test_a_nameless_global_persona_is_minted_as_me() -> None:
    plan = personas_apply(_ctx({"roleplay": {"persona": {"description": "Just a description."}}}))
    assert plan.config["roleplay"]["personas"] == {"me": {"name": "me", "description": "Just a description."}}
    assert plan.config["roleplay"]["default_persona"] == "me"


@pytest.mark.parametrize("legacy", [None, {}, "", "  ", {"name": "", "description": ""}, {"name": "  "}])
def test_an_empty_global_persona_is_consumed_and_mints_nothing(legacy: Any) -> None:
    ctx = _ctx({"roleplay": {"enabled": False, "persona": legacy}})
    assert personas_applies(ctx) is True
    plan = personas_apply(ctx)
    assert plan.config["roleplay"] == {"enabled": False}
    assert [tuple(c) for c in plan.consumes] == [("roleplay", "persona")]


def test_agent_defaults_user_name_is_renamed_in_place() -> None:
    """Emma A-1: `agent.defaults` is an `AgentDef`-shaped base, so `user_name` can live there too —
    and a name matching the migrated global reuses it rather than minting a twin."""
    ctx = _ctx(
        {"roleplay": {"persona": {"name": "Ari"}}, "agent": {"defaults": {"user_name": "Ari", "tools": "*"}}}
    )
    assert personas_applies(_ctx({"agent": {"defaults": {"user_name": ""}}})) is True
    plan = personas_apply(ctx)
    assert plan.config["agent"]["defaults"] == {"persona": "ari", "tools": "*"}
    assert set(plan.config["roleplay"]["personas"]) == {"ari"}
    assert ("agent", "defaults", "user_name") in [tuple(c) for c in plan.consumes]


def test_an_explicit_blank_override_stays_an_explicit_blank() -> None:
    """In an agent file a blank overrides the inherited default — it must go on doing so."""
    ctx = _ctx(
        {"roleplay": {"persona": {"name": "Ari"}}, "agent": {"defaults": {"user_name": "The DM"}}},
        {"lynette": {"title": "Lynette", "user_name": ""}},
    )
    plan = personas_apply(ctx)
    assert plan.config["agent"]["defaults"] == {"persona": "the-dm"}
    assert _agent_out(plan, "lynette") == {"title": "Lynette", "persona": ""}
    assert plan.config["roleplay"]["personas"] == {
        "ari": {"name": "Ari", "description": ""},
        "the-dm": {"name": "The DM", "description": ""},
    }


def test_agent_files_reuse_an_exact_name_else_mint() -> None:
    ctx = _ctx(
        {"roleplay": {"persona": {"name": "Ari", "description": "Tall."}}},
        {"nyx": {"user_name": "Ari"}, "sera": {"user_name": "traveller"}, "plain": {"title": "Plain"}},
    )
    plan = personas_apply(ctx)
    assert _agent_out(plan, "nyx") == {"persona": "ari"}
    assert _agent_out(plan, "sera") == {"persona": "traveller"}
    assert AGENTS / "plain" / "agent.yaml" not in plan.agent_files  # untouched files are not rewritten
    assert plan.config["roleplay"]["personas"]["traveller"] == {"name": "traveller", "description": ""}


def test_name_reuse_is_case_sensitive() -> None:
    ctx = _ctx({"roleplay": {"persona": {"name": "Ari"}}}, {"nyx": {"user_name": "ari"}})
    plan = personas_apply(ctx)
    assert _agent_out(plan, "nyx") == {"persona": "ari-2"}


def test_a_slug_collision_never_overwrites() -> None:
    """Emma A-2: two names that collapse to one slug are suffix-walked by the one mint."""
    ctx = _ctx({}, {"a": {"user_name": "The DM"}, "b": {"user_name": "the dm"}, "c": {"user_name": "THE-DM"}})
    plan = personas_apply(ctx)
    lib = plan.config["roleplay"]["personas"]
    assert lib == {
        "the-dm": {"name": "The DM", "description": ""},
        "the-dm-2": {"name": "the dm", "description": ""},
        "the-dm-3": {"name": "THE-DM", "description": ""},
    }
    assert [_agent_out(plan, n)["persona"] for n in "abc"] == ["the-dm", "the-dm-2", "the-dm-3"]


def test_no_roleplay_block_with_an_agent_user_name_creates_the_library() -> None:
    ctx = _ctx({"server": {"port": 5433}}, {"nyx": {"user_name": "patron"}})
    plan = personas_apply(ctx)
    assert plan.config == {
        "server": {"port": 5433},
        "roleplay": {"personas": {"patron": {"name": "patron", "description": ""}}},
    }
    assert plan.consumes == []  # agent-file removals are not declared; no config key was removed


def test_both_fields_empty_consume_everything_and_mint_nothing() -> None:
    ctx = _ctx(
        {"roleplay": {"persona": {"name": "", "description": ""}}, "agent": {"defaults": {"user_name": ""}}},
        {"lynette": {"user_name": ""}},
    )
    plan = personas_apply(ctx)
    assert plan.config == {"roleplay": {}, "agent": {"defaults": {"persona": ""}}}
    assert _agent_out(plan, "lynette") == {"persona": ""}


def test_new_wins_where_both_shapes_exist() -> None:
    """A half-migrated file converges: an existing link or default is kept, the legacy key consumed."""
    ctx = _ctx(
        {
            "roleplay": {
                "personas": {"dm": {"name": "The DM"}},
                "default_persona": "dm",
                "persona": {"name": "Ari"},
            }
        },
        {"nyx": {"persona": "dm", "user_name": "Ari"}, "kai": {"persona": "", "user_name": "Bob"}},
    )
    plan = personas_apply(ctx)
    assert plan.config["roleplay"]["default_persona"] == "dm"
    # The global's text is data and is kept in the library; a bare legacy NAME behind an existing
    # link (even an explicit blank one) is dropped, never minted as an unlinked entry.
    assert set(plan.config["roleplay"]["personas"]) == {"dm", "ari"}
    assert _agent_out(plan, "nyx") == {"persona": "dm"}
    assert _agent_out(plan, "kai") == {"persona": ""}


def test_an_explicit_blank_default_is_kept_over_the_migrated_global() -> None:
    """`default_persona: ""` is the owner's "none" — key PRESENCE decides, not truthiness (Emma F2)."""
    ctx = _ctx({"roleplay": {"default_persona": "", "persona": {"name": "Ari"}}}, {})
    plan = personas_apply(ctx)
    assert plan.config["roleplay"]["default_persona"] == ""
    assert set(plan.config["roleplay"]["personas"]) == {"ari"}  # the text is still kept


@pytest.mark.parametrize(
    "config, agents",
    [
        ({"roleplay": {"persona": "Ari"}}, {}),
        ({"agent": {"defaults": {"user_name": 5}}}, {}),
        ({}, {"nyx": {"user_name": ["Ari"]}}),
    ],
)
def test_a_value_that_could_never_have_loaded_is_refused(config: dict, agents: dict) -> None:
    with pytest.raises(MigrationRefused):
        personas_apply(_ctx(config, agents))


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"roleplay": None},
        {"roleplay": {"enabled": True, "personas": {"ari": {"name": "Ari"}}, "default_persona": "ari"}},
        {"agent": {"defaults": {"persona": "ari"}}},
    ],
)
def test_a_fresh_config_does_not_apply(config: dict[str, Any]) -> None:
    assert personas_applies(_ctx(config, {"nyx": {"persona": "ari"}})) is False


def test_the_fold_is_idempotent_and_never_mutates_its_input() -> None:
    config = {"roleplay": {"persona": {"name": "Ari"}}, "agent": {"defaults": {"user_name": "Ari"}}}
    ctx = _ctx(config, {"nyx": {"user_name": "x"}})
    plan = personas_apply(ctx)
    assert config == {"roleplay": {"persona": {"name": "Ari"}}, "agent": {"defaults": {"user_name": "Ari"}}}
    assert ctx.agents[AGENTS / "nyx" / "agent.yaml"] == {"user_name": "x"}
    again = Context(
        config_path=ctx.config_path,
        agents_dir=AGENTS,
        config=plan.config,
        agents={**ctx.agents, **plan.agent_files},
    )
    assert personas_applies(again) is False


# ── through the runner ───────────────────────────────────────────────────────────────────────────

V4_YAML = """config_version: 4
server:
  port: 5433
roleplay:
  # the owner's own note inside the roleplay block
  enabled: true
  persona:
    name: Ari
    description: "{{user}} runs a small homelab."
agent:
  defaults:
    user_name: ''
"""


def _workspace(tmp_path: Path, monkeypatch, text: str, agents: dict[str, str] | None = None) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(text, encoding="utf-8")
    for name, body in (agents or {}).items():
        (home / "agents" / name).mkdir(parents=True)
        (home / "agents" / name / "agent.yaml").write_text(body, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_the_runner_folds_writes_back_and_the_app_loads_it(tmp_path, monkeypatch) -> None:
    home = _workspace(
        tmp_path,
        monkeypatch,
        V4_YAML,
        {
            "lynette": "title: Lynette\nuser_name: ''\n",
            "nyx": "# nyx's note\ntitle: Nyx\nuser_name: patron\n",
        },
    )
    status = cm.detect(cm.context_from_env())
    assert status.pending == (5,)
    assert status.legacy_keys == ("roleplay.persona", "agent.defaults.user_name")
    assert cm.apply(cm.context_from_env()).wrote is True

    text = (home / "config.yaml").read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
    assert doc["roleplay"] == {
        "enabled": True,
        "personas": {
            "ari": {"name": "Ari", "description": "{{user}} runs a small homelab."},
            "patron": {"name": "patron", "description": ""},
        },
        "default_persona": "ari",
    }
    assert doc["agent"]["defaults"] == {"persona": ""}
    assert "user_name" not in text and "  persona:\n    name" not in text  # no legacy seam
    assert "# the owner's own note" in text
    assert doc[CONFIG_VERSION_KEY] == cm.CONFIG_VERSION
    nyx_text = (home / "agents" / "nyx" / "agent.yaml").read_text(encoding="utf-8")
    assert yaml.safe_load(nyx_text) == {"title": "Nyx", "persona": "patron"} and "# nyx's note" in nyx_text
    assert yaml.safe_load((home / "agents" / "lynette" / "agent.yaml").read_text(encoding="utf-8")) == {
        "title": "Lynette",
        "persona": "",
    }

    s = load_settings(home / "config.yaml")
    from app.services.agent.macros import macros_for

    assert macros_for(s.resolve_agent("nyx"), s).user == "patron"
    assert macros_for(s.resolve_agent("lynette"), s).user == "Ari"  # the blank falls to the default


def test_the_runner_is_idempotent_and_stamps_the_marker(tmp_path, monkeypatch) -> None:
    home = _workspace(tmp_path, monkeypatch, V4_YAML)
    cm.apply(cm.context_from_env())
    before = (home / "config.yaml").read_bytes()
    fresh = cm.context_from_env()
    assert cm.needs_migration(fresh) is False
    assert cm.read_marker(fresh.config) == cm.CONFIG_VERSION
    assert cm.apply(cm.context_from_env()).wrote is False
    assert (home / "config.yaml").read_bytes() == before


def test_a_v4_config_without_personas_only_gets_the_stamp(tmp_path, monkeypatch) -> None:
    """Prod's shape (v1.7.7 → v1.7.8): no roleplay block, no agents — step 5 is a no-op there."""
    home = _workspace(tmp_path, monkeypatch, "config_version: 4\nserver:\n  port: 5433\n")
    assert cm.detect(cm.context_from_env()).pending == ()
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert doc == {CONFIG_VERSION_KEY: 5, "server": {"port": 5433}}
