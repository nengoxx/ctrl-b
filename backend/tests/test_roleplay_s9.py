"""Phase 23 S9 / D79 — export (cards + books), the referenced-by line, and the post-release polish
wave (ROLEPLAY_PLAN §15).

What is load-bearing here, and therefore what is pinned:

  1. **The export is the import read backwards** (§15.2): a card imported and never edited composes
     back to its own `data`, byte for byte — the golden round trip. The SOUL rule's two branches, the
     identity rule (name vs nickname), the book SET/DELETE, and the no-sidecar required keys.
  2. **The PNG carrier** (§15.3): the validator's every rule answers 422 (415 for a non-PNG), the
     chunk writer's CRCs are real (re-walked with the importer's own `_png_chunks`), old card chunks
     are stripped, and the POST writes NOTHING.
  3. **The lorebook serializer** (§15.4): ST fixture → import → export(st) → import is lossless, the
     spec dialect round-trips, a moved entry derives while an unmoved one keeps its 0, ids never
     collide, a merged book keeps every entry.
  4. **`used_by`** (§15.5) and the polish rules (§15.6/§15.7): ISS-22/24/26/27/29/15/30.

Everything runs on a temp `$CTRLB_HOME` (S2's `home` fixture) — never the operator's config.yaml.
"""

from __future__ import annotations

import base64
import json
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest
import yaml
from _async import run_async
from fastapi.testclient import TestClient
from test_roleplay_s0 import (
    _ROSTER_CONFIG,
    _agent,
    _assemble,
    _client,
    _make_thread,
    _session,
    _systems,
    _workspace,
)
from test_roleplay_s2 import card_json, configure, home, imported, make_client, v3
from test_roleplay_s3 import ST_BOOK, _blocks, _book, _thread, _turn, import_book_ok, st_entry

from app.api.agent import _compose_agent_card
from app.config import CardImportCfg
from app.services.agent.card_export import (
    LIVE_FIELDS,
    SOUL_FIELDS,
    V3_ONLY,
    ComposedCard,
    compose_card,
)
from app.services.agent.card_import import (
    MAPPED_FIELDS,
    CardImportError,
    _png_chunks,
    _png_text_chunks,
    read_container,
    validate_png_carrier,
    write_card_chunks,
)
from app.services.agent.lorebook_export import (
    _NAMES,
    book_out,
    st_logic,
    st_position,
)
from app.services.agent.lorebook_import import _ALIASES, ST_EXTENSION_NAMES, import_book
from app.services.agent.lorebooks import Haystack, Lorebook, LorebookEntry, activate, load_book, spoken
from app.services.agent.macros import Macros

__all__ = ["home"]  # the temp-workspace fixture is imported, not redefined

NOW = 1_700_000_500

#: A complete V3 card — every key the composer writes is already present, in the order it writes
#: them, so an unedited import composes back to exactly these bytes. CRLF in the persona text on
#: purpose: that is what both dev cards carried, and the SOUL rule must fold it.
GOLDEN: dict[str, Any] = v3(
    name="Seraphina",
    description="Seraphina is a guardian.\r\nShe tends the glade.",
    personality="Gentle, fierce when needed.\r\n",
    scenario="The glade at dusk.",
    first_mes="You wake in a glade.",
    mes_example="<START>\n{{char}}: Rest now.",
    creator_notes="Made for testing.",
    system_prompt="Stay in character.",
    post_history_instructions="Keep replies short.",
    alternate_greetings=["You stir.", "Morning light."],
    tags=["fantasy", "healer"],
    creator="someone",
    character_version="1.2",
    extensions={"talkativeness": "0.5", "depth_prompt": {"prompt": "", "depth": 4}},
    group_only_greetings=[],
    creation_date=1_700_000_000,
    modification_date=NOW,
    assets=[{"type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png"}],
)


def agent_file(home: Path, slug: str) -> dict:
    return yaml.safe_load((home / "agents" / slug / "agent.yaml").read_text(encoding="utf-8")) or {}


def edit_agent_file(home: Path, slug: str, **fields: Any) -> None:
    """Set (or, with `None`, remove) keys in a character's `agent.yaml` — the owner's hand edit."""
    p = home / "agents" / slug / "agent.yaml"
    doc = agent_file(home, slug)
    for k, v in fields.items():
        if v is None:
            doc.pop(k, None)
        else:
            doc[k] = v
    p.write_text(yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8")


def compose(c: TestClient, slug: str) -> ComposedCard:
    """The ROUTE's own blocking half (`_compose_agent_card`) — so every composition test also pins
    what the route reads: the agent's EFFECTIVE linked list, its sidecar, only enabled books."""
    card = _compose_agent_card(c.app.state.settings, slug)
    assert card is not None
    return card


def dated_now(data: dict) -> dict:
    """`data` with its `modification_date` (the one per-call "now") pinned to the golden's `NOW`,
    after checking it really is a fresh unix-seconds stamp — key order is untouched."""
    assert isinstance(data["modification_date"], int) and data["modification_date"] >= NOW
    return {**data, "modification_date": NOW}


def import_json(c: TestClient, card: dict) -> dict:
    return imported(c, json.dumps(card).encode("utf-8"))


# ── 1. the card composer (§15.2) ────────────────────────────────────────────────────────────────


def test_the_export_tables_cover_every_mapped_field() -> None:
    """The export maps back exactly what the import maps forward — `name`, the three SOUL fields and
    the five verbatim ones are `MAPPED_FIELDS`, no more, no fewer."""
    assert {"name", *SOUL_FIELDS, *LIVE_FIELDS} == set(MAPPED_FIELDS)


def test_an_unedited_import_composes_back_to_its_own_data_byte_for_byte(home: Path) -> None:
    """The golden round trip. The SOUL was written LF-folded (`write_text_eol`), so a raw compare with
    the CRLF composition would silently take the lossy branch — the fold is what makes this pass."""
    with make_client() as c:
        body = import_json(c, GOLDEN)
        soul_bytes = (home / "agents" / body["name"] / "SOUL.md").read_bytes()
        card = compose(c, body["name"])
    assert b"\r" not in soul_bytes  # …the premise: the file on disk really is LF-only
    assert json.dumps(dated_now(card.v3["data"])) == json.dumps(GOLDEN["data"])
    assert (card.v3["spec"], card.v3["spec_version"]) == ("chara_card_v3", "3.0")
    assert card.stem == "Seraphina"


def test_an_edited_soul_exports_as_the_description_alone(home: Path) -> None:
    """RP-8's honest loss: an edited SOUL is one text, and it cannot be split back into three."""
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        assert c.put(f"/api/agents/{slug}/soul", json={"content": "A new persona."}).status_code == 200
        data = compose(c, slug).v3["data"]
    assert (data["system_prompt"], data["description"], data["personality"]) == ("", "A new persona.", "")


def test_the_live_character_wins_and_an_emptied_field_is_written_empty(home: Path) -> None:
    """Opus F1: the importer writes an empty field as ABSENT, so an absent live field means "empty
    now" — the sidecar's old greeting must not come back."""
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        edit_agent_file(home, slug, greeting=None, scenario="A new scene.", alt_greetings=None)
        data = compose(c, slug).v3["data"]
    assert data["first_mes"] == "" and data["alternate_greetings"] == []
    assert data["scenario"] == "A new scene."


def test_a_retitle_is_the_nickname_and_the_authored_name_stays(home: Path) -> None:
    """Maya F3: `name` = the name as authored; the V3 `nickname` = the live title whenever it differs
    (the import's `nickname → title` backwards). Equal again ⇒ the nickname is DELETED."""
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        edit_agent_file(home, slug, title="Sera")
        renamed = compose(c, slug)
        edit_agent_file(home, slug, title="Seraphina")
        back = compose(c, slug)
    assert (renamed.v3["data"]["name"], renamed.v3["data"]["nickname"]) == ("Seraphina", "Sera")
    assert "nickname" not in renamed.v2["data"]  # V2 has no nickname — a V2 reader sees the authored name
    assert renamed.stem == "Sera"
    assert "nickname" not in back.v3["data"]


def test_an_imported_nickname_round_trips(home: Path) -> None:
    with make_client() as c:
        slug = import_json(c, v3(name="Nyx Vale", nickname="Nyx", description="d"))["name"]
        data = compose(c, slug).v3["data"]
    assert (data["name"], data["nickname"]) == ("Nyx Vale", "Nyx")


def test_a_linked_book_is_embedded_and_an_unlinked_one_is_deleted(home: Path) -> None:
    """The book is the LIVE link, never the sidecar's copy (Seraphina's sidecar still holds her
    original book — unlink must mean unlink): SET with `extensions.world` at 1 book, DELETE both at 0."""
    card = v3(
        name="Nyx",
        description="d",
        character_book={"name": "Nyx's own", "entries": [{"keys": ["tide"], "content": "It rises."}]},
    )
    with make_client() as c:
        slug = import_json(c, card)["name"]
        linked = compose(c, slug).v3["data"]
        edit_agent_file(home, slug, lorebooks=[])
        unlinked = compose(c, slug).v3["data"]
    assert "character_book" in card_json(home, slug)["data"]  # the sidecar still holds it…
    assert linked["character_book"]["name"] == "Nyx's own"
    assert [e["content"] for e in linked["character_book"]["entries"]] == ["It rises."]
    assert linked["extensions"]["world"] == "Nyx's own"
    assert "character_book" not in unlinked  # …and the export does not
    assert "world" not in unlinked["extensions"]


def test_several_linked_books_merge_into_one_named_after_the_character(home: Path) -> None:
    with make_client() as c:
        for slug, content in (("tides", "It rises."), ("stars", "They wheel.")):
            book = {"name": slug, "entries": [{"keys": [slug], "content": content, "uid": 7}]}
            assert c.put(f"/api/lorebooks/{slug}", json={"book": book}).status_code == 200
        slug = import_json(c, v3(name="Nyx", description="d"))["name"]
        edit_agent_file(home, slug, lorebooks=["tides", "stars"])
        data = compose(c, slug).v3["data"]
    book = data["character_book"]
    assert book["name"] == "Nyx lorebook" and data["extensions"]["world"] == "Nyx lorebook"
    assert [e["content"] for e in book["entries"]] == ["It rises.", "They wheel."]
    assert [e["id"] for e in book["entries"]] == [0, 1]  # renumbered — both stashed uid 7
    assert [e["extensions"]["display_index"] for e in book["entries"]] == [0, 1]


def test_only_the_agents_own_enabled_links_are_embedded(home: Path) -> None:
    """What the ROUTE reads (review F8): the agent's EFFECTIVE `lorebooks` list — never the install's
    global `lorebooks.books` — and of that, only readable ENABLED books (what the runtime scans)."""
    configure(home, "lorebooks:\n  books: [globalbook]\n")
    with make_client() as c:
        for slug, enabled in (("globalbook", True), ("dormant", False), ("tides", True)):
            book = {"name": slug, "enabled": enabled, "entries": [{"keys": [slug], "content": slug}]}
            assert c.put(f"/api/lorebooks/{slug}", json={"book": book}).status_code == 200
        slug = import_json(c, v3(name="Nyx", description="d"))["name"]
        edit_agent_file(home, slug, lorebooks=["dormant", "tides"])
        data = compose(c, slug).v3["data"]
    assert data["character_book"]["name"] == "tides"  # ONE book → embedded verbatim, not merged
    assert [e["content"] for e in data["character_book"]["entries"]] == ["tides"]


def test_a_card_with_no_sidecar_fills_the_required_keys_empty(home: Path) -> None:
    """The default agent and a hand-made character have no `card.json`: the spec's required keys
    are present with empty values, and the name is the title, else the slug."""
    with make_client() as c:
        assert c.put("/api/agents/helper", json={"agent": {"greeting": "Hi."}}).status_code == 200
        card = compose(c, "helper")
        root = c.app.state.settings.default_agent_def()
        default = compose_card(slug="default", agent=root, soul="", sidecar=None, books=[], now=NOW)
    data = card.v3["data"]
    for key, empty in (("creator_notes", ""), ("tags", []), ("creator", ""), ("character_version", "")):
        assert data[key] == empty
    assert data["extensions"] == {} and data["group_only_greetings"] == []
    assert (data["name"], data["first_mes"]) == ("helper", "Hi.")
    assert set(MAPPED_FIELDS) <= set(data)
    expected = root.title or "default"  # `agent.default_title`, else the root's slug
    assert default.v3["data"]["name"] == expected and default.stem == expected


def test_the_v2_projection_drops_exactly_the_v3_only_keys(home: Path) -> None:
    with make_client() as c:
        card = compose(c, import_json(c, GOLDEN)["name"])
    assert (card.v2["spec"], card.v2["spec_version"]) == ("chara_card_v2", "2.0")
    assert set(card.v2["data"]) == set(card.v3["data"]) - set(V3_ONLY)
    assert card.v3["data"]["assets"] == [{"type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png"}]


def test_the_export_strips_executable_content_from_both_halves(home: Path) -> None:
    """One strip both ways (Maya F1): a sidecar the owner hand-edited script keys INTO, on the
    envelope and inside `data`, never leaves in an export."""
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        side = home / "agents" / slug / "card.json"
        doc = json.loads(side.read_text(encoding="utf-8"))
        doc["customScripts"] = ["x"]
        doc["data"]["extensions"]["regex_scripts"] = [{"find": "a"}]
        side.write_text(json.dumps(doc), encoding="utf-8")
        card = compose(c, slug)
    assert "customScripts" not in card.v3 and "customScripts" not in card.v2
    assert "regex_scripts" not in card.v3["data"]["extensions"]
    assert card.v3["data"]["extensions"]["talkativeness"] == "0.5"  # inert data survives


# ── 2. the PNG carrier (§15.3) ──────────────────────────────────────────────────────────────────


def crc_chunk(ctype: bytes, data: bytes) -> bytes:
    """S2's `png_chunk` shape with a REAL CRC — the carrier validator checks every one, so the
    fixture has to carry the real thing (written here, not borrowed from the writer under test)."""
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data))


PNG_SIG = b"\x89PNG\r\n\x1a\n"
IHDR_DATA = struct.pack(">II", 4, 3) + b"\x08\x06\x00\x00\x00"


def carrier(*middle: bytes, ihdr: bytes = IHDR_DATA, tail: bytes = b"") -> bytes:
    """A structurally whole PNG: signature, IHDR, the `middle` chunks, IEND, then `tail`."""
    return PNG_SIG + crc_chunk(b"IHDR", ihdr) + b"".join(middle) + crc_chunk(b"IEND", b"") + tail


def text_chunk(keyword: bytes, payload: dict) -> bytes:
    return crc_chunk(b"tEXt", keyword + b"\x00" + base64.b64encode(json.dumps(payload).encode("utf-8")))


def test_the_chunk_writer_appends_both_card_chunks_with_real_crcs() -> None:
    """ST's own writer shape: `chara` = V2, `ccv3` = V3, both `tEXt`, just before IEND. Re-walked with
    the importer's own `_png_chunks` and every CRC recomputed — and the output is itself a carrier the
    validator accepts, and a card the importer reads (ccv3 first)."""
    v2, v3card = (
        {"spec": "chara_card_v2", "data": {"name": "A"}},
        {"spec": "chara_card_v3", "data": {"name": "B"}},
    )
    out = write_card_chunks(carrier(crc_chunk(b"IDAT", b"pixels")), v2, v3card)
    walked = list(_png_chunks(out))
    assert [t for t, *_ in walked] == [b"IHDR", b"IDAT", b"tEXt", b"tEXt", b"IEND"]
    for ctype, at, _start, end in walked:
        assert struct.unpack(">I", out[end : end + 4])[0] == zlib.crc32(out[at + 4 : end]), ctype
    validate_png_carrier(out)
    chunks = _png_text_chunks(out)
    assert json.loads(base64.b64decode(chunks["chara"])) == v2
    assert json.loads(base64.b64decode(chunks["ccv3"])) == v3card
    assert read_container(out, CardImportCfg()).card == v3card


def test_the_writer_strips_the_card_an_avatar_already_carries() -> None:
    """A re-exported avatar may still hold an old card: the carrier leaves with exactly the new two."""
    old = carrier(text_chunk(b"chara", {"old": True}), text_chunk(b"CCV3", {"old": True}))
    out = write_card_chunks(old, {"new": 2}, {"new": 3})
    keywords = [out[s:e].partition(b"\x00")[0] for t, _, s, e in _png_chunks(out) if t == b"tEXt"]
    assert keywords == [b"chara", b"ccv3"]
    assert json.loads(base64.b64decode(_png_text_chunks(out)["chara"])) == {"new": 2}


def _corrupt_crc(png: bytes) -> bytes:
    """`png` with its IHDR CRC flipped."""
    at = len(PNG_SIG) + 8 + len(IHDR_DATA)
    return png[:at] + bytes([png[at] ^ 0xFF]) + png[at + 1 :]


@pytest.mark.parametrize(
    ("body", "status", "says"),
    [
        (b"GIF89a" + b"\x00" * 32, 415, "not a PNG"),
        (PNG_SIG + crc_chunk(b"IDAT", b"x") + crc_chunk(b"IEND", b""), 422, "IHDR is not the first"),
        (carrier(ihdr=IHDR_DATA[:12]), 422, "IHDR is not 13 bytes"),
        (carrier(crc_chunk(b"ID4T", b"x")), 422, "four letters"),
        (_corrupt_crc(carrier()), 422, "CRC"),
        (carrier()[:-6], 422, "truncated or has no IEND"),  # the IEND's declared length runs past the end
        (PNG_SIG + crc_chunk(b"IHDR", IHDR_DATA) + crc_chunk(b"IDAT", b"x"), 422, "no IEND"),
        (PNG_SIG + crc_chunk(b"IHDR", IHDR_DATA) + crc_chunk(b"IEND", b"x"), 422, "IEND carries data"),
        (carrier(tail=b"PK\x03\x04glued"), 422, "follow the IEND"),
        (PNG_SIG, 422, "IHDR is not the first"),
    ],
)
def test_a_malformed_carrier_is_refused_by_the_rule_it_breaks(body: bytes, status: int, says: str) -> None:
    with pytest.raises(CardImportError) as refused:
        validate_png_carrier(body)
    assert refused.value.status == status and says in refused.value.detail


# ── 3. the routes (§15.3) ───────────────────────────────────────────────────────────────────────


def _snapshot(root: Path) -> dict[str, bytes]:
    """Every file under `root` with its bytes — minus the SQLite files, which the app's own
    background loops may touch and which no card route can reach."""
    return {
        str(p.relative_to(root)): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".db" not in p.name
    }


def _undated(card: dict) -> dict:
    """A card minus its `modification_date` — the one field that is "now" per call."""
    return {**card, "data": {k: v for k, v in card["data"].items() if k != "modification_date"}}


def test_the_json_route_is_the_composition_and_the_default_agent_is_a_character(home: Path) -> None:
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        r = c.get(f"/api/agents/{slug}/card")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
        assert _undated(r.json()) == _undated(compose(c, slug).v3)
        root = c.get("/api/agents/default/card")
        assert root.status_code == 200 and root.json()["spec"] == "chara_card_v3"
        assert c.get("/api/agents/ghost/card").status_code == 404
        assert c.get("/api/agents/Bad Name/card").status_code == 422


def test_the_png_route_writes_the_card_into_the_carrier_and_nothing_to_disk(home: Path) -> None:
    """The one POST in the agent surface: a pure derivation. The data dir is byte-identical after it
    (the SECURITY_MODEL §2.9 sentence's claim), and the answer is the carrier with both chunks."""
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        before = _snapshot(home)
        r = c.post(f"/api/agents/{slug}/card.png", content=carrier(crc_chunk(b"IDAT", b"px")))
        after = _snapshot(home)
        expected = c.get(f"/api/agents/{slug}/card").json()
    assert before == after
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    validate_png_carrier(r.content)
    chunks = _png_text_chunks(r.content)
    v3card = json.loads(base64.b64decode(chunks["ccv3"]))
    v2card = json.loads(base64.b64decode(chunks["chara"]))
    assert _undated(v3card) == _undated(expected)
    assert v2card["spec"] == "chara_card_v2" and "assets" not in v2card["data"]


def test_an_exported_png_imports_back_as_the_same_character(home: Path) -> None:
    """The loop the owner's migration rides (§15.9): our PNG through our own importer lands the same
    persona split, greeting and title — the export is readable by the door it came in through."""
    with make_client() as c:
        slug = import_json(c, GOLDEN)["name"]
        png = c.post(f"/api/agents/{slug}/card.png", content=carrier()).content
        again = imported(c, png)
        first = c.get(f"/api/agents/{slug}").json()
    assert again["name"] == f"{slug}-2"
    assert again["soul"] == first["soul"]
    for field in ("title", "greeting", "alt_greetings", "example_dialogue", "scenario", "post_history"):
        assert again["agent"][field] == first["agent"][field], field


def test_the_png_route_refuses_what_it_cannot_carry(home: Path) -> None:
    (home / "config.yaml").write_text(
        (home / "config.yaml").read_text(encoding="utf-8")
        + "roleplay:\n  card_import:\n    max_bytes: 4000\n",
        encoding="utf-8",
    )
    with make_client() as c:
        slug = import_json(c, v3(name="Nyx", description="d"))["name"]
        url = f"/api/agents/{slug}/card.png"
        assert c.post(url, content=b"GIF89a" + b"\x00" * 16).status_code == 415
        assert c.post(url, content=carrier()[:-4]).status_code == 422
        assert c.post(url, content=b"").status_code == 422
        big = c.post(url, content=carrier(crc_chunk(b"IDAT", b"x" * 5000)))
        assert big.status_code == 413 and "roleplay.card_import.max_bytes" in big.json()["detail"]
        assert c.post("/api/agents/ghost/card.png", content=carrier()).status_code == 404
        assert c.post("/api/agents/default/card.png", content=carrier()).status_code == 200


# ── 4. the lorebook serializer (§15.4) ──────────────────────────────────────────────────────────

#: S3's ST raw-export fixture with the one field ST always writes that it omits (`displayIndex`) —
#: the round trip is exact only for a book in ST's own complete shape.
ST_FULL: dict[str, Any] = {
    "name": ST_BOOK["name"],
    "entries": {k: {**v, "displayIndex": int(k)} for k, v in ST_BOOK["entries"].items()},
}


def test_an_st_book_round_trips_through_our_standalone_export_losslessly(home: Path) -> None:
    """The golden: ST fixture → import → export(st) → import again == the first import. It holds only
    because the importer records every COLLAPSED ST integer under `extensions` (position 0, 2, 4 and
    AND-ALL here) and the export returns it while it is still true."""
    with make_client() as c:
        first = import_book_ok(c, ST_FULL)
        exported = c.get(f"/api/lorebooks/{first['slug']}/export")
        assert exported.status_code == 200
        second = import_book_ok(c, exported.json())
    assert set(exported.json()) == {"entries", "name", "description"}
    assert list(exported.json()["entries"]) == ["0", "1", "2", "3", "4", "5"]
    assert second["book"] == first["book"]
    by_comment = {e["comment"]: e for e in first["book"]["entries"]}
    assert by_comment["Before"]["extensions"] == {"position": 0}  # the collapse, recorded
    assert by_comment["Harbour"]["extensions"] == {"selectiveLogic": 3}
    assert "extensions" not in by_comment["Ghostship"]  # position 1 is an exact landing — nothing to keep


def test_the_standalone_export_writes_st_names_and_explicit_flags(home: Path) -> None:
    with make_client() as c:
        slug = import_book_ok(c, ST_FULL)["slug"]
        entries = c.get(f"/api/lorebooks/{slug}/export").json()["entries"]
    before, deep, off = entries["2"], entries["4"], entries["5"]
    assert (before["position"], deep["position"], deep["depth"]) == (0, 4, 4)
    assert before["caseSensitive"] is False and before["matchWholeWords"] is True  # never ST's null
    assert off["disable"] is True and off["matchWholeWords"] is False
    assert entries["1"]["selectiveLogic"] == 3 and entries["1"]["selective"] is True
    assert "extensions" not in before  # the stale import mirror is dropped in the standalone dialect
    assert before["comment"] == "Before" and before["uid"] == 2


def test_a_moved_entry_derives_its_position_and_an_unmoved_one_keeps_its_zero(home: Path) -> None:
    """Maya F5: the stashed integer is re-emitted only while it still maps onto the entry's current
    position (and the logic the same, Opus F11) — an owner's move or re-gate is what exports."""
    with make_client() as c:
        body = import_book_ok(c, ST_FULL)
        book = body["book"]
        book["entries"][3]["position"] = "head"  # the author's-note entry (ST 2), moved to the head
        book["entries"][4]["position"] = "head"  # the at-depth entry (ST 4), moved too
        book["entries"][1]["logic"] = "not_any"  # the AND-ALL entry, re-gated
        assert c.put(f"/api/lorebooks/{body['slug']}", json={"book": book}).status_code == 200
        entries = c.get(f"/api/lorebooks/{body['slug']}/export").json()["entries"]
    assert entries["2"]["position"] == 0  # unmoved: still the original
    assert entries["3"]["position"] == 1 and entries["4"]["position"] == 1  # moved: derived
    assert entries["1"]["selectiveLogic"] == 2


def test_a_tail_entry_with_no_st_provenance_derives_at_depth_zero() -> None:
    book = Lorebook(entries=[LorebookEntry(keys=["k"], content="c", position="tail")])
    (entry,) = book_out(book, dialect="st")["entries"].values()
    assert (entry["position"], entry["depth"]) == (4, 0)


def test_the_position_predicate_trusts_only_a_real_table_integer() -> None:
    """Maya confirm (c): a bool (Python's int) or a value the table does not know derives."""
    for stashed in (True, 9, "0", None, [0]):
        entry = LorebookEntry(keys=["k"], position="head", extensions={"position": stashed})
        assert st_position(entry) == 1, stashed
    assert st_position(LorebookEntry(position="head", extensions={"position": 0})) == 0
    assert (
        st_logic(LorebookEntry(secondary_keys=["s"], logic="not_any", extensions={"selectiveLogic": 1})) == 1
    )
    assert (
        st_logic(LorebookEntry(secondary_keys=["s"], logic="and_any", extensions={"selectiveLogic": 1})) == 0
    )


def test_ids_never_collide() -> None:
    """Opus F3: a stashed uid is kept only when it is a real int not already used; everything else
    takes the next free int — a new editor entry after uids 1..3 must not overwrite a dict key."""
    entries = [
        LorebookEntry(content=str(i), **extra)
        for i, extra in enumerate([{"uid": 1}, {"uid": 2}, {"uid": 3}, {}])
    ]
    assert list(book_out(Lorebook(entries=entries), dialect="st")["entries"]) == ["1", "2", "3", "4"]
    clashing = [
        LorebookEntry(content=str(i), **extra)
        for i, extra in enumerate([{"uid": 3}, {"uid": 3}, {}, {"uid": True}, {"uid": "7"}, {"id": 0}])
    ]
    out = book_out(Lorebook(entries=clashing), dialect="st")["entries"]
    assert len(out) == 6 and sorted(int(k) for k in out) == [0, 3, 4, 5, 6, 7]
    assert [e["content"] for e in out.values()] == ["0", "1", "2", "3", "4", "5"]


def test_the_spec_dialect_round_trips_through_our_importer(home: Path) -> None:
    """The card-embedded path: our truth rides `extensions` (ST's crosswalk names, where the spec puts
    app data and where ST's reader and ours look first), `use_regex` is false, and a re-import lands
    the same entries at the same ST positions."""
    with make_client() as c:
        slug = import_book_ok(c, ST_FULL)["slug"]
    book = load_book(home / "lorebooks", slug)
    assert book is not None
    book.entries[4].use_regex = True  # type: ignore[attr-defined]  # a card book's stashed flag (ST writes true)
    spec = book_out(book, dialect="spec")
    assert spec["entries"][4]["use_regex"] is False  # review F6: ONLY our top-level false…
    assert all("use_regex" not in e["extensions"] for e in spec["entries"])  # …never under extensions
    assert set(spec) == {"name", "description", "extensions", "entries"}
    deep = spec["entries"][4]
    assert (deep["position"], deep["use_regex"], deep["insertion_order"]) == ("after_char", False, 100)
    assert deep["extensions"]["position"] == 4 and deep["extensions"]["depth"] == 4
    assert deep["extensions"]["probability"] == 100 and "probability" not in deep  # app data → extensions
    assert deep["extensions"]["display_index"] == 4 and deep["id"] == 4
    back = import_book(spec).book
    canonical = (
        "keys",
        "content",
        "enabled",
        "constant",
        "secondary_keys",
        "logic",
        "case_sensitive",
        "whole_words",
        "position",
        "order",
        "priority",
    )
    for ours, again in zip(book.entries, back.entries, strict=True):
        assert {f: getattr(ours, f) for f in canonical} == {f: getattr(again, f) for f in canonical}
        assert (st_position(again), st_logic(again)) == (st_position(ours), st_logic(ours))


def test_the_spec_dialect_overlays_our_truth_on_a_stale_mirror() -> None:
    """A card book's entry keeps ST's `extensions` mirror as stash; once the owner moves or retunes
    it, a reader that trusts `extensions` first must read the entry as it is NOW."""
    mirror = {
        "position": 4,
        "selectiveLogic": 2,
        "case_sensitive": True,
        "match_whole_words": False,
        "depth": 6,
        "use_regex": True,  # an owned name a source planted here — never survives (confirm-round nit)
    }
    entry = LorebookEntry(
        keys=["k"],
        secondary_keys=["s"],
        logic="and_any",
        position="head",
        case_sensitive=False,
        whole_words=True,
        extensions=mirror,
    )
    (out,) = book_out(Lorebook(entries=[entry]), dialect="spec")["entries"]
    assert out["extensions"]["position"] == 1 and out["extensions"]["selectiveLogic"] == 0
    assert out["extensions"]["case_sensitive"] is False and out["extensions"]["match_whole_words"] is True
    assert out["extensions"]["depth"] == 6  # not ours to decide — carried
    assert "use_regex" not in out["extensions"] and out["use_regex"] is False  # only our top-level false


def test_a_card_books_extended_model_is_lifted_to_st_names_in_the_standalone_export(home: Path) -> None:
    """Review F1: a CARD-origin entry keeps ST's extended model ONLY under `extensions` (ST's
    crosswalk names). The standalone export lifts each key back to ST's own top-level name (what ST's
    `convertCharacterBook` reads), and a re-import of that file keeps every one of them."""
    ext = {
        "position": 4,
        "depth": 3,
        "role": 1,
        "probability": 50,
        "useProbability": True,
        "group": "trees",
        "exclude_recursion": True,
        "scan_depth": 5,
        "sticky": 2,
    }
    card = v3(
        name="Nyx",
        description="d",
        character_book={
            "name": "Grove",
            "entries": [
                {"keys": ["oak"], "content": "Old oaks.", "position": "after_char", "extensions": ext}
            ],
        },
    )
    lifted = {
        "role": 1,
        "probability": 50,
        "useProbability": True,
        "group": "trees",
        "excludeRecursion": True,
        "scanDepth": 5,
        "sticky": 2,
    }
    with make_client() as c:
        import_json(c, card)
        (entry,) = c.get("/api/lorebooks/nyx-book/export").json()["entries"].values()
        again = import_book_ok(c, {"name": "Grove", "entries": {str(entry["uid"]): entry}})
    assert {k: entry[k] for k in lifted} == lifted
    assert (entry["position"], entry["depth"]) == (4, 3)
    assert "extensions" not in entry and "exclude_recursion" not in entry  # ST names only
    (back,) = again["book"]["entries"]
    assert {k: back[k] for k in lifted} == lifted  # the re-import keeps them (as ST-named stash)
    assert back["position"] == "tail" and back["depth"] == 3


def test_the_export_names_are_the_ones_the_importer_reads() -> None:
    """No second alias table: every per-dialect name the serializer writes is one the importer reads —
    an `_ALIASES` spelling, or (the spec dialect's whole-words flag, which lives under `extensions`)
    the `extensions` key its `take_ext` reads first, which is ST's crosswalk name."""
    readable = {field: set(names) for field, names in _ALIASES.items()}
    readable["whole_words"].add(ST_EXTENSION_NAMES["matchWholeWords"])
    for field, names in _NAMES.items():
        assert set(names) <= readable[field], (field, names)


def test_the_lorebook_export_route_refuses_what_it_cannot_serve(home: Path) -> None:
    with make_client() as c:
        assert c.get("/api/lorebooks/ghost/export").status_code == 404
        assert c.get("/api/lorebooks/Bad Name/export").status_code == 422


# ── 5. referenced-by (§15.5) ────────────────────────────────────────────────────────────────────


def test_every_book_row_says_who_links_it(home: Path) -> None:
    """`used_by` reads each agent's EFFECTIVE list through `load_agent` — so a specialist with no list
    of its own inherits `agent.defaults.lorebooks`, exactly as it does at runtime — plus the root as
    `default` and the install's global set. Books are never deleted by a cascade; this is the line
    that tells the owner what a delete would orphan."""
    configure(home, "agent:\n  defaults:\n    lorebooks: [beta]\nlorebooks:\n  books: [gamma]\n")
    with make_client() as c:
        for slug in ("alpha", "beta", "gamma"):
            assert c.put(f"/api/lorebooks/{slug}", json={"book": {"name": slug}}).status_code == 200
        for name, links in (("xena", ["alpha", "beta"]), ("yuri", ["alpha", "ghost"]), ("zed", None)):
            fields = {} if links is None else {"lorebooks": links}
            assert c.put(f"/api/agents/{name}", json={"agent": fields}).status_code == 200
        rows = {r["slug"]: r["used_by"] for r in c.get("/api/lorebooks").json()["lorebooks"]}
    assert rows == {
        "alpha": {"agents": ["xena", "yuri"], "global": False},
        "beta": {"agents": ["default", "xena", "zed"], "global": False},
        "gamma": {"agents": [], "global": True},
    }


def test_used_by_survives_an_agent_that_will_not_load(home: Path) -> None:
    with make_client() as c:
        assert c.put("/api/lorebooks/alpha", json={"book": {"name": "alpha"}}).status_code == 200
        assert c.put("/api/agents/good", json={"agent": {"lorebooks": ["alpha"]}}).status_code == 200
        assert c.put("/api/agents/bad", json={"agent": {}}).status_code == 200
        (home / "agents" / "bad" / "agent.yaml").write_text("duties: nonsense\n", encoding="utf-8")
        r = c.get("/api/lorebooks")
    assert r.status_code == 200
    assert r.json()["lorebooks"][0]["used_by"] == {"agents": ["good"], "global": False}


# ── 6. ISS-24: what a delete removes, keeps and breaks (§15.6) ──────────────────────────────────


def _automation(c: TestClient, name: str, agent: str | None) -> None:
    body = {"name": name, "schedule": "0 3 * * *", "prompt": "check in", "tz": "UTC", "agent": agent}
    assert c.post("/api/automations", json=body).status_code == 201


def test_a_delete_removes_the_default_memory_dir_and_reports_the_rest(home: Path) -> None:
    """The memory dir goes (a re-import of the same card re-mints the same slug, and must not inherit
    the dead character's MEMORY.md); the linked book and the art STAY (no delete ever cascades to a
    library item — owner); an automation pinned to the slug is NAMED, since it would otherwise fail
    silently at its next fire."""
    card = v3(name="Nyx", description="d", character_book={"entries": [{"keys": ["a"], "content": "c"}]})
    with make_client() as c:
        slug = import_json(c, card)["name"]
        edit_agent_file(home, slug, avatar="nyx.webp", background="glade.png")
        assert c.put(f"/api/agents/{slug}/memory", json={"content": "- met the owner"}).status_code == 200
        memory = home / "memories" / "agents" / slug
        assert (memory / "MEMORY.md").is_file()
        _automation(c, "nightly nyx", slug)
        _automation(c, "fleet sweep", None)
        r = c.delete(f"/api/agents/{slug}")
        books = [b["slug"] for b in c.get("/api/lorebooks").json()["lorebooks"]]
    assert r.status_code == 200, r.text
    assert r.json() == {
        "name": slug,
        "deleted": True,
        "removed": [f"agents/{slug}", f"memories/agents/{slug}"],
        "kept": {"books": ["nyx-book"], "art": ["nyx.webp", "glade.png"], "memory": []},
        "broken": {"automations": ["nightly nyx"]},
    }
    assert not memory.exists() and not (home / "agents" / slug).exists()
    assert books == ["nyx-book"]


def test_a_custom_memory_dir_is_left_and_reported(home: Path) -> None:
    """The resolver's own semantics: a custom `memory_dir` may be shared or hand-placed, so only the
    default `memories/agents/<slug>` is ever removed."""
    with make_client() as c:
        assert c.put("/api/agents/scribe", json={"agent": {"memory_dir": "shared/scribe"}}).status_code == 200
        assert c.put("/api/agents/scribe/memory", json={"content": "- a note"}).status_code == 200
        custom = home / "memories" / "shared" / "scribe"
        assert (custom / "MEMORY.md").is_file()
        body = c.delete("/api/agents/scribe").json()
    assert custom.is_dir()
    assert body["removed"] == ["agents/scribe"]
    assert body["kept"]["memory"] == ["memories/shared/scribe"]


def test_an_escaping_memory_dir_resolves_to_the_default_and_is_removed(home: Path) -> None:
    """`..` is refused by the resolver (the default is used instead) — so the default is what the agent
    really wrote to, and what the delete removes; nothing outside the memory root is touched."""
    with make_client() as c:
        assert c.put("/api/agents/rogue", json={"agent": {"memory_dir": "../outside"}}).status_code == 200
        assert c.put("/api/agents/rogue/memory", json={"content": "- x"}).status_code == 200
        assert (home / "memories" / "agents" / "rogue" / "MEMORY.md").is_file()
        body = c.delete("/api/agents/rogue").json()
    assert body["removed"] == ["agents/rogue", "memories/agents/rogue"]
    assert not (home / "outside").exists()


# ── 7. the polish rules (§15.6 / §15.7) ─────────────────────────────────────────────────────────


def test_iss22_the_book_report_is_one_count_line_per_class(home: Path) -> None:
    """ISS-22: an exact landing says nothing, each downgrade class is ONE line per book, and every
    silently-inert feature gets its own count line — a 218-line report for one book is gone."""
    entries = {
        "0": st_entry(0, key=["a"], content="c", position=0),
        "1": st_entry(1, key=["b"], content="c", position=0),
        "2": st_entry(2, key=["c"], content="c", position=0, probability=40),
        "3": st_entry(3, key=["d"], content="c", position=4, group="rivals"),
        "4": st_entry(4, key=["e"], content="c", position=4, keysecondary=["x"], selectiveLogic=3),
        "5": st_entry(5, key=["/fo+/i"], content="c", position=1, excludeRecursion=True, scanDepth=6),
        "6": st_entry(6, key=["g"], content="c", position=1, selective=False, keysecondary=["y"]),
        "7": st_entry(7, key=["h"], content="c", position=1, probability=40, useProbability=False),
    }
    with make_client() as c:
        warnings = import_book_ok(c, {"name": "Counted", "entries": entries})["report"]["warnings"]
    assert warnings == [
        "3 entries sat BEFORE the character definitions, and our head block sits after them — landed at the head",
        "1 entry rolled a probability below 100 — v1 does not roll, so a key hit always activates them",
        "2 entries sat at a fixed depth and role in the history, both of which collapse — landed at the tail",
        "1 entry belonged to an inclusion group — v1 has no groups, so every member can activate together",
        "1 entry used AND-ALL (every secondary key had to hit), approximated as AND-ANY",
        "1 entry carried a recursion flag — v1 does not scan recursively, so the flag does nothing",
        "1 entry set their own scan depth — v1 scans `lorebooks.scan_depth` for every entry",
        "1 entry had a regex-looking key — v1 matches keys as literal text",
        "1 entry carried secondary keys the source marks non-selective — kept as provenance only, they do "
        "not gate activation",
    ]


def test_iss22_a_card_books_inert_features_are_read_under_extensions(home: Path) -> None:
    """ST writes a card book's extended model under `extensions` (its crosswalk names) — the count
    lines read it there too."""
    entry = {
        "keys": ["k"],
        "content": "c",
        "position": "after_char",
        "extensions": {"probability": 10, "useProbability": True, "group": "g", "prevent_recursion": True},
    }
    book = import_book({"entries": [entry]})
    assert [w.split(" — ")[0] for w in book.warnings] == [
        "1 entry rolled a probability below 100",
        "1 entry belonged to an inclusion group",
        "1 entry carried a recursion flag",
    ]


def test_iss26_an_imported_character_holds_no_skills(home: Path) -> None:
    with make_client() as c:
        slug = import_json(c, v3(name="Nyx", description="d"))["name"]
    assert agent_file(home, slug)["skills"] == []


def test_iss26_the_roster_rides_only_a_toolset_that_takes_a_fleet_id() -> None:
    """ISS-26 (ii), against the REAL registry: the roster maps names to the `host_id`/`service_id` a
    tool needs, so it rides a turn only when a tool in that turn's effective set takes one. A
    character on `web_search` holds none; `ping_host` takes a `host_id`; `"*"` holds them all."""
    with _workspace(_ROSTER_CONFIG), _client() as c:
        _agent(c, "talker", tools=["web_search"])
        _agent(c, "pinger", tools=["ping_host"])
        _agent(c, "servant", tools=["check_service"])
        _agent(c, "everything")
        thread = _make_thread(c)
        heads = {
            name: "\n".join(_systems(_assemble(c, thread, name)))
            for name in ("talker", "pinger", "servant", "everything")
        }
        assert _session(c, "talker")._takes_a_fleet_id() is False
    assert "testbox" not in heads["talker"]
    assert all("testbox" in heads[name] for name in ("pinger", "servant", "everything"))


def test_iss27_whole_words_uses_ascii_boundaries_so_a_cjk_key_matches() -> None:
    """(a): ST's `(?:^|\\W)key(?:$|\\W)` with JS's ASCII `\\W` — under Unicode `\\w` every neighbouring
    ideograph is a word character and a CJK key could never match whole-word."""
    hay = Haystack.of(["我在東京住了三年"])
    assert hay.hit("東京", case_sensitive=False, whole_words=True)
    latin = Haystack.of(["the cartographers met"])
    assert not latin.hit("cartographer", case_sensitive=False, whole_words=True)  # ASCII words still bound
    assert Haystack.of(["wow!!!"]).hit("!!", case_sensitive=False, whole_words=True)


def test_iss27_a_multi_word_key_is_a_substring_match() -> None:
    """(d): a key with whitespace in it falls back to `includes()`, as in ST."""
    hay = Haystack.of(["xthe captainy"])
    assert hay.hit("the captain", case_sensitive=False, whole_words=True)
    assert not hay.hit("captain", case_sensitive=False, whole_words=True)


def test_iss27_a_constant_entry_skips_the_secondary_gate() -> None:
    """(c): `constant → activate` sits above every key check in ST's precedence (R65 §1.5)."""
    entry = LorebookEntry(constant=True, secondary_keys=["daylight"], logic="not_any", content="Always.")
    keyed = LorebookEntry(keys=["tide"], secondary_keys=["daylight"], logic="not_any", content="Gated.")
    hay = Haystack.of(["the tide in daylight"])
    active = activate([Lorebook(entries=[entry, keyed])], hay, Macros(char="Nyx", user="Ari"))
    assert [a.content for a in active] == ["Always."]


def test_iss27_the_speaker_rows_carry_names_in_both_haystack_branches() -> None:
    """(b): each chat row is scanned as `"<name>: <text>"` (ST's `world_info_include_names`, default
    on) — in the turn-start haystack AND the resume one, through the one helper. Off scans bare text."""
    book = {"name": "Names", "entries": [{"keys": ["Seraphina"], "content": "SERA-LORE"}]}
    with _workspace(), _client() as c:
        _book(c, "names", book)
        _agent(c, "sera", title="Seraphina", lorebooks=["names"])
        thread = _thread(c, ("user", "hello"), ("assistant", "greetings"))
        assert any("SERA-LORE" in b for b in _blocks(_turn(c, thread, "sera", "how are you")))
        resumed = _session(c, "sera")
        run_async(
            resumed._activate_lorebooks(_thread(c, ("assistant", "hi"), ("user", "go")), "", resume=True)
        )
        assert resumed._lorebook_head is not None and "SERA-LORE" in resumed._lorebook_head
        assert c.put("/api/settings", json={"lorebooks": {"include_names": False}}).status_code == 200
        assert not any("SERA-LORE" in b for b in _blocks(_turn(c, thread, "sera", "how are you")))


def test_iss27_an_empty_row_stays_empty_and_the_user_is_the_persona() -> None:
    macros = Macros(char="Nyx", user="Ari")
    assert spoken("user", "", macros, include_names=True) == ""
    assert spoken("user", "hi", macros, include_names=True) == "Ari: hi"
    assert spoken("assistant", "mm", macros, include_names=True) == "Nyx: mm"
    assert spoken("user", "hi", macros, include_names=False) == "hi"


def test_iss29_an_agent_minted_with_an_underscore_is_listed(home: Path) -> None:
    """The folder grammar the import mints under admits `_`; the list must too."""
    with make_client() as c:
        slug = import_json(c, v3(name="a_b", description="d"))["name"]
        listed = c.get("/api/agents").json()["agents"]
    assert slug == "a_b" and "a_b" in listed


def test_iss15_the_ping_deadline_is_owned_by_the_command(monkeypatch) -> None:
    """Windows paces ~1 s between echoes, so its deadline carries `n - 1` more seconds; Linux and
    macOS keep the measured `n * timeout + 1`."""
    from app.services import fleet

    for system, expected in (("Linux", 4.0), ("Darwin", 4.0), ("Windows", 6.0)):
        monkeypatch.setattr(fleet.platform, "system", lambda s=system: s)
        _, deadline = fleet._ping_cmd("10.0.0.1", 3, 1.0)
        assert deadline == expected, system
    monkeypatch.setattr(fleet.platform, "system", lambda: "Windows")
    assert fleet._ping_cmd("10.0.0.1", 0, 2.0)[1] == 3.0  # count normalizes to 1, like the command


def test_iss30_the_settings_patch_refuses_every_router_owned_map(home: Path) -> None:
    with make_client() as c:
        hosts = c.put("/api/settings", json={"computers": {"ghost": {"ip": "10.0.0.9"}}})
        personas = c.put("/api/settings", json={"roleplay": {"personas": {}}})
        computers = set(c.app.state.settings.computers)
    assert hosts.status_code == 422 and "/api/hosts" in hosts.json()["detail"]
    assert personas.status_code == 422 and "/api/personas" in personas.json()["detail"]
    assert computers == {"alpha"}  # nothing was merged in
