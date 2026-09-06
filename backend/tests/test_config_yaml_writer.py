"""The comment-preserving config writer that stayed in `config.py` (UPDATE_PLAN slice 2 split).

`delete_path`/`sync_mapping` and the ruamel comment-rescue recipe behind them, plus the 0600 write
contract. Formerly the back half of `test_provider_migration_a11.py`; the fold it shared a file with
now lives in `test_config_migration_steps_a11.py`.
"""

from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path

import app.config as config
from app.config import walk_model_refs


def test_walk_model_refs_visits_the_closed_list() -> None:
    seen: list[dict] = []
    doc = {
        "agent": {
            "defaults": {
                "model": {"provider": "a"},
                "compaction": {"summarizer": {"provider": "b"}},
                "routing": {"lead": {"provider": "c"}},
            },
            "compaction": {"summarizer": {"provider": "d"}},
        }
    }
    walk_model_refs(doc, seen.append)
    assert sorted(r["provider"] for r in seen) == ["a", "b", "c", "d"]


def test_agent_from_pointer_half_atomic_merge() -> None:
    # FX8 (audit L2): a `ModelRef.model` clean name is provider-relative. When agent.yaml points
    # `model.provider` at a DIFFERENT provider than the default and does NOT set its own model, the
    # inherited model must be DROPPED (never carried across providers as a raw wire id).
    from app.config import Settings

    s = Settings(agent={"defaults": {"model": {"provider": "a", "model": "m1"}}})
    folder = Path(tempfile.mkdtemp())
    diff = s.agent_from("x", folder, {"model": {"provider": "b"}})
    assert diff.model.provider == "b" and diff.model.model is None  # inherited m1 dropped
    same = s.agent_from("x", folder, {"model": {"reasoning_effort": "high"}})
    assert same.model.provider == "a" and same.model.model == "m1"  # provider unchanged → keep
    own = s.agent_from("x", folder, {"model": {"provider": "b", "model": "m2"}})
    assert own.model.provider == "b" and own.model.model == "m2"  # override sets its own → keep


# ══════════════════════════ Slice-2 review fixes (FX-A..FX-D) ══════════════════════════
def test_fx_a_config_write_lands_0600_via_patch_and_selfheals() -> None:
    # FX-A: a plain patch write (no migration) must leave config.yaml at 0600, self-healing a file a
    # past umask-affected write left at 0664 — the secret-bearing file's deployment contract.
    config._PENDING_MIGRATION = None  # ensure no stale write-back leaks from a prior test
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  poll_seconds: 5\n", encoding="utf-8")
    os.chmod(cfg, 0o664)  # degrade it, as a `write_bytes`-at-umask write would
    config.apply_patch_to_yaml({"server": {"poll_seconds": 7}}, path=cfg)
    assert stat.S_IMODE(cfg.stat().st_mode) == 0o600
    assert "poll_seconds: 7" in cfg.read_text(encoding="utf-8")


def test_fx_a_save_settings_lands_0600() -> None:
    from app.config import Settings, save_settings_comment_stripping_for_tests

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    save_settings_comment_stripping_for_tests(
        Settings(), path=cfg
    )  # the temp+replace writer must also land 0600
    assert stat.S_IMODE(cfg.stat().st_mode) == 0o600


# ── YAML 1.1/1.2 resolver split: new strings the loader would misread must land quoted ────────────
# The live regression (2026-09-04): the Conf editor saved quiet-hours "23:00" as a plain scalar
# (ruamel, YAML 1.2 — a string), which `load_settings`' PyYAML 1.1 read took back as sexagesimal
# int 1380, and the config preflight refused every boot until the file was hand-quoted.


def test_new_ambiguous_strings_land_quoted_and_read_back_verbatim() -> None:
    import yaml as pyyaml

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  poll_seconds: 5\n", encoding="utf-8")
    config.apply_patch_to_yaml(
        {
            "wake": {
                "quiet_hours": {"start": "23:00", "end": "08:00"},
                "presence_devices": [{"name": "no", "lan_ip": "192.168.1.143"}],
            },
            "note": "on",
        },
        path=cfg,
    )
    loaded = pyyaml.safe_load(cfg.read_text(encoding="utf-8"))
    assert loaded["wake"]["quiet_hours"] == {"start": "23:00", "end": "08:00"}
    assert loaded["wake"]["presence_devices"][0] == {"name": "no", "lan_ip": "192.168.1.143"}
    assert loaded["note"] == "on"


def test_sync_mapping_quotes_ambiguous_strings_too() -> None:
    import yaml as pyyaml

    out = _rewrite(
        "host:\n  a: 1\n",
        lambda doc: config.sync_mapping(doc["host"], {"a": 1, "window": "12:30"}),
    )
    assert pyyaml.safe_load(out)["host"]["window"] == "12:30"


def test_new_ambiguous_map_keys_land_quoted_too() -> None:
    """The same split one level up (D70 S2 review, MED-6): the guard quoted VALUES but not KEYS, so a
    written-in map like `{"no": {"on": "23:00"}}` came back `{False: {True: …}}` — a mangled TREE, not
    a mangled scalar. Reached through the whole-value path (`_yaml11_safe`'s dict branch)."""
    import yaml as pyyaml

    out = _rewrite(
        "host:\n  a: 1\n",
        lambda doc: config.sync_mapping(doc["host"], {"a": 1, "stash": {"no": {"on": "23:00"}}}),
    )
    assert pyyaml.safe_load(out)["host"]["stash"] == {"no": {"on": "23:00"}}


def test_a_new_ambiguous_key_lands_quoted_on_the_set_path() -> None:
    """The other key-writing site: a key NEW to a node that already exists in the file. (A key the
    file already carries keeps its own form — it is the operator's line, not ours.)"""
    import yaml as pyyaml

    out = _rewrite("host:\n  a: 1\n", lambda doc: config.sync_mapping(doc["host"], {"a": 1, "on": "x"}))
    assert pyyaml.safe_load(out)["host"] == {"a": 1, "on": "x"}


def test_plain_safe_strings_stay_unquoted() -> None:
    out = _rewrite("x: 1\n", lambda doc: config.deep_set(doc, {"name": "corsair"}))
    assert "name: corsair\n" in out


# ── comment-preserving key removal (the orphaned-comment bug) ─────────────────────────────────────
# ruamel parks a key's trailing comment on the PRECEDING entry, so a bare `del` destroys the
# operator's prose for whatever came after the deleted region. Verified live before the fix: the
# migration's `inference.cloud` delete took the whole `# Voice …` section header with it.


def _rewrite(src: str, mutate) -> str:
    """Round-trip `src` through the real write chokepoint (`edit_config_yaml`) and return the file."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(src, encoding="utf-8")
    config.edit_config_yaml(mutate, path=cfg)
    return cfg.read_text(encoding="utf-8")


def _delete(*dotted: str):
    return lambda doc: [config.delete_path(doc, d.split(".")) for d in dotted]


def test_delete_keeps_the_following_sections_comment() -> None:
    """The live regression: the deleted key is LAST in its map and its value is a subtree, so the
    next section's header is parked on the deepest-last leaf inside the region being removed."""
    out = _rewrite(
        "inference:\n"
        "  request_timeout_s: 600\n"
        "  cloud:\n    base_url: https://x/v1\n    api_mode: openrouter\n"
        "# Voice (Phase 6, D18 failover). STT on VAULT.\n"
        "# A blank fallback is dropped from the chain.\n"
        "voice:\n  enabled: true\n",
        _delete("inference.cloud"),
    )
    assert "# Voice (Phase 6, D18 failover). STT on VAULT." in out
    assert "# A blank fallback is dropped from the chain." in out
    assert "cloud:" not in out
    # re-homed at its original position: still directly above `voice:`, still at column 0
    assert out.index("# Voice") < out.index("voice:") < out.index("enabled")


def test_delete_takes_the_deleted_keys_own_comments_with_it() -> None:
    """The symmetric rule: the block ABOVE the key documents that key and dies with it (owner ruling),
    as does its end-of-line comment; only the block trailing the region is re-homed."""
    out = _rewrite(
        "inference:\n"
        "  keep: 1   # eol on keep\n"
        "  # doc for legacy\n"
        "  legacy: 2   # eol on legacy\n"
        "  # doc for max_steps\n"
        "  max_steps: 3\n",
        _delete("inference.legacy"),
    )
    assert "# eol on legacy" not in out  # dies with the line it annotated
    assert "# doc for legacy" not in out  # dies with the key it documented
    assert "# eol on keep" in out  # the surviving neighbour keeps its own
    assert "  # doc for max_steps\n  max_steps: 3\n" in out  # re-homed, indentation intact


def test_delete_of_the_first_key_drops_its_leading_block_and_rehomes_the_trailing_one() -> None:
    out = _rewrite(
        "inference:\n  # doc for legacy\n  legacy: 1\n  # doc for max_steps\n  max_steps: 12\n",
        _delete("inference.legacy"),
    )
    assert out == "inference:\n  # doc for max_steps\n  max_steps: 12\n"


def test_delete_of_the_first_root_key_drops_its_leading_block() -> None:
    """At the document root the leading block lives on the doc itself, not on a parent entry."""
    out = _rewrite(
        "# doc for legacy\nlegacy: 1\n# doc for server\nserver:\n  poll_seconds: 5\n",
        _delete("legacy"),
    )
    assert out == "# doc for server\nserver:\n  poll_seconds: 5\n"


def test_consecutive_deletes_each_drop_their_own_block() -> None:
    """Deleting a run of documented keys leaves only the surviving key's own documentation — the block
    re-homed by one delete is recognised as the next key's and dropped when that key goes too."""
    out = _rewrite(
        "inference:\n"
        "  # doc for default_mode\n"
        "  default_mode: local\n"
        "  # doc for local\n"
        "  local:\n    base_url: http://l/v1\n"
        "  # doc for max_steps\n"
        "  max_steps: 12\n",
        _delete("inference.default_mode", "inference.local"),
    )
    assert out == "inference:\n  # doc for max_steps\n  max_steps: 12\n"


def test_delete_preserves_blank_lines_and_nonstandard_comment_spacing() -> None:
    out = _rewrite(
        "inference:\n  keep: 0\n  legacy: 1\n\n  # line one\n  #no-space line\n  #   aligned    trailer\n  max_steps: 12\n",
        _delete("inference.legacy"),
    )
    assert (
        out
        == "inference:\n  keep: 0\n\n  # line one\n  #no-space line\n  #   aligned    trailer\n  max_steps: 12\n"
    )


def test_delete_that_empties_a_map_rehomes_one_level_up_and_stays_valid_yaml() -> None:
    """An emptied mapping renders as `{}` and has no entry left to hang a comment on — attaching to it
    anyway would emit the comment BETWEEN the key and its `{}`, which no longer parses."""
    out = _rewrite(
        "voice:\n  stt:\n    primary: a\n# trailing doc\nother: 1\n",
        _delete("voice.stt.primary"),
    )
    assert "# trailing doc" in out
    assert config.yaml_rt().load(out)["other"] == 1  # still parses, and the comment didn't move inside
    assert out.index("stt: {}") < out.index("# trailing doc") < out.index("other: 1")


def test_repeated_deletes_are_idempotent_and_keep_rescuing() -> None:
    """The migration deletes several keys from one map; each delete re-runs the rescue, so the block
    hops along the survivors regardless of order — and a second pass over gone keys is a no-op."""
    src = (
        "inference:\n"
        "  request_timeout_s: 600\n"
        "  default_mode: local\n"
        "  local:\n    base_url: http://l/v1\n"
        "  cloud:\n    base_url: http://c/v1\n"
        "# next section\n"
        "voice:\n  enabled: true\n"
    )
    dotted = ("inference.default_mode", "inference.local", "inference.cloud")
    once = _rewrite(src, _delete(*dotted))
    assert once == "inference:\n  request_timeout_s: 600\n# next section\nvoice:\n  enabled: true\n"
    assert _rewrite(once, _delete(*dotted)) == once  # idempotent
    assert _rewrite(src, _delete(*reversed(dotted))) == once  # order-independent


def test_sync_mapping_rescues_comments_when_it_removes_keys() -> None:
    """The same deleter serves the hosts/integrations CRUD, where a removed service really disappears."""
    out = _rewrite(
        "computers:\n"
        "  corsair:\n"
        "    services:\n      web: {port: 80}\n      old: {port: 99}\n"
        "# fleet-wide notes\n"
        "server:\n  poll_seconds: 5\n",
        lambda doc: config.sync_mapping(doc["computers"]["corsair"]["services"], {"web": {"port": 80}}),
    )
    assert "# fleet-wide notes" in out and "old:" not in out and "web:" in out


def test_sync_mapping_emptying_a_child_rehomes_the_comment() -> None:
    out = _rewrite(
        "computers:\n"
        "  corsair:\n"
        "    services:\n      old: {port: 99}\n"
        "# fleet-wide notes\n"
        "server:\n  poll_seconds: 5\n",
        lambda doc: config.sync_mapping(doc["computers"]["corsair"], {"services": {}}),
    )
    assert "# fleet-wide notes" in out and "old:" not in out
    assert config.yaml_rt().load(out)["server"]["poll_seconds"] == 5


def test_delete_on_a_plain_dict_config_is_a_no_op_not_a_crash() -> None:
    """A fresh/empty config file yields plain dicts, which carry no ruamel comment structure."""
    doc = {"inference": {"legacy": 1, "max_steps": 2}}
    config.delete_path(doc, ("inference", "legacy"))
    assert doc == {"inference": {"max_steps": 2}}


def test_delete_rehomes_across_a_sequence_valued_sibling() -> None:
    """The anchor search walks into lists too (`inference.fallbacks` is one), where entries are
    addressed positionally rather than by key."""
    out = _rewrite(
        "inference:\n  fallbacks:\n    - a\n    - b\n  legacy: 1\n  # doc for max_steps\n  max_steps: 2\n",
        _delete("inference.legacy"),
    )
    assert "# doc for max_steps" in out and "legacy" not in out
    assert config.yaml_rt().load(out)["inference"]["fallbacks"] == ["a", "b"]
    assert out.index("- b") < out.index("# doc for max_steps") < out.index("max_steps: 2")


def test_delete_rehomes_when_the_sequence_ends_in_an_empty_entry() -> None:
    out = _rewrite(
        "inference:\n  fallbacks:\n    - {}\n  legacy: 1\n  # doc for max_steps\n  max_steps: 2\n",
        _delete("inference.legacy"),
    )
    assert "# doc for max_steps" in out
    assert config.yaml_rt().load(out)["inference"]["max_steps"] == 2
    assert out.index("# doc for max_steps") < out.index("max_steps: 2")
