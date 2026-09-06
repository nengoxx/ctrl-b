"""Phase 18 Slice 2 — `GET /api/prompts` + the `PUT /api/settings` prompt-entry hook.

Two halves:

1. **The read (§6 C-23, C-18 as amended by §7 L-3/L-7).** One row per registered prompt, in registry
   order, carrying the default, the owner's customization, the EFFECTIVE unrendered template, and the
   placeholders derived from the default. Unknown ids in `config.yaml` are preserved but are not rows
   — they surface as a warning instead.
2. **The write hook (§7 L-4/L-5).** `prompts` is the one section that does NOT deep-merge: an entry
   is replaced whole, `null` deletes it, blank fields normalize to absent, and an entry left with no
   fields is dropped — because restore-by-delete is the restore mechanism and a merge cannot delete.

Every write goes to a TEMP config.yaml (`CTRLB_CONFIG`), never the real one; the on-disk YAML is
re-read to prove the deletion actually landed rather than only living in memory.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

import yaml

from app.services.agent.prompts import REGISTRY, placeholders


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield cfg
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _rows(c) -> list[dict]:
    r = c.get("/api/prompts")
    assert r.status_code == 200, r.text
    return r.json()["prompts"]


def _row(c, prompt_id: str) -> dict:
    return next(row for row in _rows(c) if row["id"] == prompt_id)


def _on_disk(cfg: Path) -> dict:
    return yaml.safe_load(cfg.read_text(encoding="utf-8")) or {}


def _save(c, entries: dict) -> dict:
    r = c.put("/api/settings", json={"prompts": entries})
    assert r.status_code == 200, r.text
    return r.json()


# ── 1. the read ─────────────────────────────────────────────────────────────────────────────────


def test_rows_are_the_registry_in_registry_order() -> None:
    with _workspace(), _client() as c:
        assert [row["id"] for row in _rows(c)] == list(REGISTRY)


def test_an_untouched_row_serves_the_default_as_current() -> None:
    with _workspace(), _client() as c:
        row = _row(c, "summarizer")
        assert row["default_text"] == REGISTRY["summarizer"].default
        assert row["current"] == REGISTRY["summarizer"].default
        assert row["override"] is None and row["append"] is None
        assert row["is_customized"] is False
        assert row["label"] == "Summarizer"
        assert row["description"] == REGISTRY["summarizer"].description


def test_every_row_carries_its_registry_group() -> None:
    """D70 §9a-3 — the editor's sections ride the rows, so the client needs no grouping map of its own
    (which is also what keeps registry order the order WITHIN each section)."""
    with _workspace(), _client() as c:
        for row in _rows(c):
            assert row["group"] == REGISTRY[row["id"]].group
            assert row["group"]


def test_placeholders_are_derived_from_the_default() -> None:
    """L-7: the editor lists them beside the text (no omission warnings anywhere), and they come from
    the DEFAULT — an override that drops one still shows what the code supplies."""
    with _workspace(), _client() as c:
        assert _row(c, "summarizer")["placeholders"] == ["sections", "focus"]
        assert _row(c, "fleet_roster")["placeholders"] == []
        for row in _rows(c):
            assert row["placeholders"] == placeholders(REGISTRY[row["id"]].default)


def test_current_is_the_effective_unrendered_template() -> None:
    with _workspace(), _client() as c:
        _save(c, {"per_tool_cap": {"override": "Stop using {{tool}}.", "append": "Answer now."}})
        row = _row(c, "per_tool_cap")
        assert row["current"] == "Stop using {{tool}}.\n\nAnswer now."  # placeholders NOT rendered
        assert row["is_customized"] is True
        assert row["default_text"] == REGISTRY["per_tool_cap"].default  # the default is still shown


def test_an_append_only_customization_shows_the_live_default_plus_the_append() -> None:
    with _workspace(), _client() as c:
        _save(c, {"wrapup_nudge": {"append": "Keep it to two lines."}})
        row = _row(c, "wrapup_nudge")
        assert row["override"] is None and row["append"] == "Keep it to two lines."
        assert row["current"] == REGISTRY["wrapup_nudge"].default + "\n\nKeep it to two lines."
        assert row["is_customized"] is True


def test_an_unknown_config_id_is_preserved_and_warned_never_a_row() -> None:
    """C-18: the text stays on disk (a typo or a rename is not a reason to delete the owner's
    writing), but nothing reads it — so the endpoint says so instead of showing an inert editor."""
    with _workspace("server:\n  port: 5433\nprompts:\n  summarize:\n    override: oops\n") as cfg:
        with _client() as c:
            body = c.get("/api/prompts").json()
            assert all(row["id"] != "summarize" for row in body["prompts"])
            assert len(body["warnings"]) == 1 and "summarize" in body["warnings"][0]
            assert _on_disk(cfg)["prompts"] == {"summarize": {"override": "oops"}}


def test_no_row_for_the_main_system_prompt() -> None:
    """C-23: the Class-A chain keeps its own endpoint + richer UI; a duplicate read-only row here
    would invite the owner to edit the one that isn't wired."""
    with _workspace(), _client() as c:
        ids = [row["id"] for row in _rows(c)]
        assert "system_prompt" not in ids and "default_prompt" not in ids
        assert c.get("/api/agent/default-prompt").status_code == 200  # …and it still exists


# ── 2. the write hook ───────────────────────────────────────────────────────────────────────────


def test_an_entry_is_replaced_whole_not_field_merged() -> None:
    """The editor always PUTs the complete pair, so dropping the append means dropping it — a
    deep-merge would make "I cleared this field" mean "keep the old value"."""
    with _workspace() as cfg, _client() as c:
        _save(c, {"denial_echo": {"override": "Nope.", "append": "Really."}})
        assert _row(c, "denial_echo")["append"] == "Really."

        _save(c, {"denial_echo": {"override": "Nope."}})
        row = _row(c, "denial_echo")
        assert row["override"] == "Nope." and row["append"] is None
        assert _on_disk(cfg)["prompts"] == {"denial_echo": {"override": "Nope."}}


def test_null_deletes_the_entry_and_the_key_leaves_the_file() -> None:
    """Restore = deletion (L-4/L-5), never a stored copy of the default."""
    with _workspace() as cfg, _client() as c:
        _save(c, {"denial_echo": {"override": "Nope."}})
        assert _on_disk(cfg)["prompts"] == {"denial_echo": {"override": "Nope."}}

        _save(c, {"denial_echo": None})
        assert _row(c, "denial_echo")["is_customized"] is False
        assert _row(c, "denial_echo")["current"] == REGISTRY["denial_echo"].default
        assert "prompts" not in _on_disk(cfg)  # the emptied map goes, not `prompts: {}`


def test_deleting_one_entry_leaves_its_siblings() -> None:
    with _workspace() as cfg, _client() as c:
        _save(c, {"denial_echo": {"override": "A"}, "wrapup_nudge": {"append": "B"}})
        _save(c, {"denial_echo": None})
        assert _on_disk(cfg)["prompts"] == {"wrapup_nudge": {"append": "B"}}


def test_a_blank_field_normalizes_to_absent() -> None:
    """Blank IS unset everywhere (L-5) — so it must never persist as a stored empty string that a
    later reader has to re-interpret."""
    with _workspace() as cfg, _client() as c:
        _save(c, {"denial_echo": {"override": "Nope.", "append": "   \n\t "}})
        assert _on_disk(cfg)["prompts"] == {"denial_echo": {"override": "Nope."}}
        assert _row(c, "denial_echo")["append"] is None


def test_an_entry_with_no_remaining_fields_is_dropped() -> None:
    with _workspace() as cfg, _client() as c:
        _save(c, {"denial_echo": {"override": "Nope."}})
        _save(c, {"denial_echo": {"override": "", "append": ""}})
        assert "prompts" not in _on_disk(cfg)
        assert _row(c, "denial_echo")["is_customized"] is False


def test_deleting_an_unknown_id_is_accepted_and_clears_it() -> None:
    """The owner's escape hatch for the ids `GET /api/prompts` warns about."""
    with _workspace("server:\n  port: 5433\nprompts:\n  summarize:\n    override: oops\n") as cfg:
        with _client() as c:
            _save(c, {"summarize": None})
            assert "prompts" not in _on_disk(cfg)
            assert c.get("/api/prompts").json()["warnings"] == []


def test_an_override_round_trips_into_resolution() -> None:
    """The save is not just a file write: `resolve()` reads the SHARED live Settings, so the next
    model call gets the new text with no restart and no cache to invalidate (C-17)."""
    from app.services.agent.prompts import resolve

    with _workspace(), _client() as c:
        _save(c, {"per_tool_cap": {"override": "Enough of {{tool}}."}})
        rendered = resolve("per_tool_cap", c.app.state.settings, {"tool": "ping", "count": "3"})
        assert rendered == "Enough of ping."


def test_a_prompts_save_leaves_the_rest_of_the_config_alone() -> None:
    with _workspace("server:\n  port: 5433\ninference:\n  system_prompt: KEEP\n") as cfg:
        with _client() as c:
            _save(c, {"denial_echo": {"override": "Nope."}})
            doc = _on_disk(cfg)
            assert doc["inference"]["system_prompt"] == "KEEP" and doc["server"]["port"] == 5433


def test_a_non_entry_shape_is_a_422() -> None:
    """Validation is unchanged for everything the hook does not speak: pydantic 422s as everywhere."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"prompts": {"denial_echo": "just a string"}}).status_code == 422


def test_a_prompts_section_that_is_not_a_map_is_a_422_never_a_silent_no_op() -> None:
    """The hook CONSUMES `prompts` before the merge, so a malformed section it merely ignored would be
    answered 200 with nothing written — the worst failure shape for a save. Top-level `null` is in the
    list deliberately: deleting every customization is expressed by nulling the IDS, not the section."""
    with _workspace() as cfg, _client() as c:
        _save(c, {"denial_echo": {"override": "Nope."}})
        for bad in ("garbage", 7, ["denial_echo"], None):
            r = c.put("/api/settings", json={"prompts": bad})
            assert r.status_code == 422, (bad, r.text)
            assert "prompts" in str(r.json()["detail"]), bad
        assert _on_disk(cfg)["prompts"] == {"denial_echo": {"override": "Nope."}}  # nothing written


def test_a_hand_edited_null_entry_still_fails_to_load() -> None:
    """The null sentinel is PUT-TRANSPORT vocabulary only (main-seat ruling, mirroring
    `tool_overrides`): `id: null` in config.yaml is a malformed entry, not a delete instruction."""
    from pydantic import ValidationError

    from app.config import Settings

    try:
        Settings.model_validate({"prompts": {"denial_echo": None}})
    except ValidationError:
        return
    raise AssertionError("a null prompts entry must not validate from disk")
