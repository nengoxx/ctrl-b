"""Phase 23 / D70 slice S2 — card import: containers, normalization, mapping, the strip pass, the
avatar, and the agent.yaml chokepoint move (ROLEPLAY_PLAN §5 / §7 / §8.1).

What is load-bearing here, and therefore what is pinned:

  1. **The SOUL recipe is NORMATIVE** (§5.3, Emma F4) — two golden imports assert it BYTE-EXACTLY,
     because two builders producing two different SOULs from one card is the defect that rule exists
     to prevent.
  2. **Sniffing is by magic bytes** (§5.2): the container is decided by the first bytes. Since R73
     made the route a raw-body PUT there is no filename in the request at all — the strongest form
     of that rule, and the reason no fixture below carries one.
  3. **The strip pass** (§7): a concrete key denylist at ANY depth, the exact removed paths in the
     report, inert siblings untouched.
  4. **The caps are config** (§5.3, Emma F8) and answer 413 for every container.
  5. **An avatar failure degrades to a warning** (§5.4) — never a whole-card refusal.
  6. **`agent.yaml` writes go through `edit_config_yaml`** (§7, Emma F9): 0600, YAML-1.1-safe,
     comment-preserving, full-replace — for imports AND the editor's own PUT.

Card fixtures are built in-test from the format's own bytes (struct-packed PNG chunks, an in-memory
zip): the readers under test never decode an image, so a hand-built container is the whole surface
and lets a test state exactly what it is asserting on.

Everything runs on a temp `$CTRLB_HOME` with its own config + db (the `home` fixture) — never the
operator's real config.yaml.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import struct
import zipfile
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from test_media_g5 import home, jpeg_bytes, make_client, png_bytes

from app.core.media import MEDIA_NAMESPACES, MediaRole
from app.services.agent.card_import import mint_slug, strip_executable

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe


# ── fixtures: the three containers, hand-built ────────────────────────────────────────────────────


def png_chunk(ctype: bytes, data: bytes) -> bytes:
    """One PNG chunk: length, type, data, CRC. The CRC is not checked by anything under test, but a
    fixture that omits it would not be a PNG chunk — the walk navigates by the length field."""
    return struct.pack(">I", len(data)) + ctype + data + b"\x00" * 4


def png_card(card: dict | None = None, *, keys: dict[str, dict] | None = None) -> bytes:
    """A PNG carrying one or more card `tEXt` chunks, after a real IHDR (so the image itself probes
    as a usable PNG — the card PNG IS the avatar)."""
    chunks = {"chara": card} if keys is None else keys
    out = png_bytes()
    for keyword, payload in chunks.items():
        blob = base64.b64encode(json.dumps(payload).encode("utf-8"))
        out += png_chunk(b"tEXt", keyword.encode("ascii") + b"\x00" + blob)
    return out + png_chunk(b"IEND", b"")


def charx(members: dict[str, bytes]) -> bytes:
    """A zip with exactly the members given, in order (`card.json` is just another one — a fixture
    that omits it is testing the missing-card arm)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return buf.getvalue()


def v2(**fields) -> dict:
    """A V2 card: the fields under `data`, with the `spec` discriminator."""
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": fields}


def v3(**fields) -> dict:
    return {"spec": "chara_card_v3", "spec_version": "3.0", "data": fields}


def configure(home: Path, block: str) -> None:
    """Append a config block to the temp workspace — BEFORE `make_client` builds the app."""
    cfg = home / "config.yaml"
    cfg.write_text(cfg.read_text(encoding="utf-8") + block, encoding="utf-8")


def put_card(c: TestClient, body: bytes) -> object:
    """Send one card — a RAW-BODY PUT (R73 / SECURITY_MODEL §2.9: the verb is the cross-origin
    control; never multipart, never POST).

    There is NO filename anywhere in the request, which is the sniffing rule's strongest form: the
    route has no name to be misled by, so the container can only come from the bytes."""
    return c.put("/api/agents/import", content=body)


def imported(c: TestClient, body: bytes) -> dict:
    r = put_card(c, body)
    assert r.status_code == 201, r.text
    return r.json()


def agent_yaml(home: Path, slug: str) -> dict:
    return yaml.safe_load((home / "agents" / slug / "agent.yaml").read_text(encoding="utf-8")) or {}


def soul(home: Path, slug: str) -> str:
    return (home / "agents" / slug / "SOUL.md").read_text(encoding="utf-8")


def card_json(home: Path, slug: str) -> dict:
    """The imported card's provenance sidecar (R87/RP-8): `{"spec", "data"}`, the whole card."""
    return json.loads((home / "agents" / slug / "card.json").read_text(encoding="utf-8"))


# ── 1. the SOUL recipe (§5.3, Emma F4 — the golden pair) ──────────────────────────────────────────


def test_the_soul_is_description_then_personality_bare(home: Path) -> None:
    """The ordinary V2 card: no `system_prompt`, so SOUL.md is exactly the two prose fields with one
    blank line between them — no labels, no headers, nothing the author did not write."""
    card = v2(
        name="Nyx",
        description="Nyx keeps the archive under the old observatory.",
        personality="Dry, unhurried, allergic to small talk.",
    )
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
    assert soul(home, "nyx") == (
        "Nyx keeps the archive under the old observatory.\n\nDry, unhurried, allergic to small talk."
    )


def test_the_soul_is_system_prompt_then_description_then_personality(home: Path) -> None:
    """All three fields, in the recipe's order — and `{{original}}` survives VERBATIM: macros run at
    assembly, not at import (§5.3), so what lands on disk is what the author wrote."""
    card = v3(
        name="Nyx",
        system_prompt="{{original}}\n\nSpeak as Nyx and never break character.",
        description="Nyx keeps the archive.",
        personality="Dry.",
    )
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
    assert soul(home, "nyx") == (
        "{{original}}\n\nSpeak as Nyx and never break character.\n\nNyx keeps the archive.\n\nDry."
    )


# ── 1b. the route itself: shape + registration order (R73) ────────────────────────────────────────


def test_the_import_is_a_raw_body_put_and_is_not_shadowed_by_the_agent_name_route(home: Path) -> None:
    """`PUT /agents/import` and `PUT /agents/{name}` match the SAME url, and FastAPI takes the first
    REGISTERED one — so the import must be declared above its parametrized sibling or every import is
    answered as an agent write named "import". Reproduced during the R73 fix: mis-routed, it 422s on
    a body it cannot read as an `AgentBody`, which is a refusal about the wrong thing entirely.

    Both arms below are statuses only THIS handler produces — a 201 carrying an import `report`, and
    the sniffer's 415 — so a silent re-shadowing (a route inserted above it, a decorator moved back
    down) fails here rather than in whichever test happened to import a card that day.

    The multipart POST this route USED to be is gone, and stays gone: it is CORS-safelisted, so a
    hostile page could fire it with no preflight and land attacker-authored persona text in the
    owner's agent surface (R73 §2). The app-wide pin lives in `test_media_write_d65.py`; this is the
    per-route half — the old shape must not answer at all.
    """
    card = json.dumps(v2(name="Nyx", description="d")).encode("utf-8")
    with make_client() as c:
        ok = c.put("/api/agents/import", content=card)
        assert ok.status_code == 201, ok.text
        assert "report" in ok.json() and ok.json()["name"] == "nyx"

        sniffed = c.put("/api/agents/import", content=b"\x00\x01\x02 not a card at all")
        assert sniffed.status_code == 415, sniffed.text  # not a {name}-shaped 422/500

        # The retired shapes: a multipart POST is no longer a route at all (405/404, never 201), and
        # the agent named "import" is unreachable — the specific path wins every time.
        gone = c.post("/api/agents/import", files={"file": ("nyx.png", card, "image/png")})
        assert gone.status_code in (404, 405), gone.text
        assert "import" not in c.get("/api/agents").json()["agents"]


# ── 2. sniffing (§5.2) ────────────────────────────────────────────────────────────────────────────


def test_a_png_card_is_read_from_its_chara_chunk(home: Path) -> None:
    with make_client() as c:
        body = imported(c, png_card(v2(name="Nyx", description="d")))
    assert body["report"]["container"] == "png"
    assert body["name"] == "nyx"


def test_ccv3_wins_when_a_png_carries_both_chunks(home: Path) -> None:
    """Spec-normative (SPEC_V3): `ccv3` beats `chara`, and the report SAYS the downgrade path was
    available so a stale V2 chunk is never a silent mystery."""
    both = png_card(
        keys={
            "chara": v2(name="Old", description="the backfilled V2 chunk"),
            "ccv3": v3(name="New", description="the V3 chunk"),
        }
    )
    with make_client() as c:
        body = imported(c, both)
    assert body["name"] == "new"
    assert soul(home, "new") == "the V3 chunk"
    assert any("V3 chunk was used" in w for w in body["report"]["warnings"])


def test_the_chunk_keyword_is_matched_case_insensitively(home: Path) -> None:
    """Both shipping readers lowercase the keyword before comparing; a card written by one of them
    must not be unreadable here over a capital letter."""
    with make_client() as c:
        assert imported(c, png_card(keys={"Chara": v2(name="Nyx", description="d")}))["name"] == "nyx"


def test_a_bare_v2_json_card_is_read(home: Path) -> None:
    with make_client() as c:
        body = imported(c, json.dumps(v2(name="Nyx", description="d")).encode("utf-8"))
    assert body["report"]["container"] == "json"


def test_a_v1_card_is_recognized_by_its_shape(home: Path) -> None:
    """No `spec` key at all — the flat V1 object, detected by shape (`name` plus one prose field)."""
    card = {"name": "Nyx", "description": "d", "personality": "p", "first_mes": "hello"}
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    assert body["report"]["container"] == "json"
    assert body["agent"]["greeting"] == "hello"
    assert soul(home, "nyx") == "d\n\np"


def test_a_v1_card_may_carry_only_a_scenario(home: Path) -> None:
    """The V1 sniff is content-shaped, and a card whose author wrote the SETTING instead of the
    personality is still a card (the S2 review's MED-8): `scenario`/`mes_example` count too."""
    with make_client() as c:
        body = imported(c, json.dumps({"name": "Nyx", "scenario": "only"}).encode("utf-8"))
    assert body["name"] == "nyx" and body["agent"]["scenario"] == "only"


def test_a_charx_card_is_read_from_its_card_json(home: Path) -> None:
    with make_client() as c:
        body = imported(c, charx({"card.json": json.dumps(v3(name="Nyx", description="d")).encode()}))
    assert body["report"]["container"] == "charx"


def test_a_zip_glued_behind_a_jpeg_is_read_as_a_charx(home: Path) -> None:
    """The field's "JPEG card" (R66 §1 — the cited reason sniffing is by magic bytes at all): the
    zip is appended to a JPEG, so the file opens as a picture everywhere AND carries the card. The
    central directory is what `ZipFile` navigates by, so the prepended image costs us no arithmetic."""
    glued = jpeg_bytes() + charx({"card.json": json.dumps(v3(name="Nyx", description="d")).encode()})
    with make_client() as c:
        body = imported(c, glued)
    assert body["report"]["container"] == "charx" and body["name"] == "nyx"


def test_a_jpeg_that_carries_no_zip_is_415(home: Path) -> None:
    """A picture is not a card container for being a picture — the same answer a bare PNG gets."""
    with make_client() as c:
        assert put_card(c, jpeg_bytes()).status_code == 415


def test_junk_bytes_are_415(home: Path) -> None:
    with make_client() as c:
        r = put_card(c, b"\x00\x01\x02 not a card at all")
    assert r.status_code == 415
    assert "not a recognized character card container" in r.json()["detail"]


def test_a_png_with_no_card_metadata_is_415(home: Path) -> None:
    """A real PNG is not a card container just for being a PNG."""
    with make_client() as c:
        assert put_card(c, png_bytes() + png_chunk(b"IEND", b"")).status_code == 415


def test_a_json_object_that_is_not_a_card_is_422(home: Path) -> None:
    """The container WAS read — the content is what is unusable, which is a different answer."""
    with make_client() as c:
        r = put_card(c, json.dumps({"hello": "world"}).encode("utf-8"))
    assert r.status_code == 422 and "not a character card" in r.json()["detail"]


def test_a_spec_card_with_no_data_object_is_422(home: Path) -> None:
    with make_client() as c:
        r = put_card(c, json.dumps({"spec": "chara_card_v2", "name": "Nyx"}).encode("utf-8"))
    assert r.status_code == 422 and "no `data` object" in r.json()["detail"]


def test_an_unknown_spec_is_refused(home: Path) -> None:
    """`spec` is the field that says WHAT these bytes are, so an exact match or nothing (the S2
    review's MED-2): reading an unknown format under V2/V3 rules is how a reader mangles a card."""
    card = {"spec": "chara_card_v9", "spec_version": "9.0", "data": {"name": "Nyx", "description": "d"}}
    with make_client() as c:
        r = put_card(c, json.dumps(card).encode("utf-8"))
    assert r.status_code == 422 and "unknown spec" in r.json()["detail"]


def test_an_unexpected_spec_version_warns_and_still_imports(home: Path) -> None:
    """The asymmetry the V3 spec itself asks for: the spec NAME is a discriminator, the VERSION is a
    forward-compatibility ask. A `3.1` card imports, and the report says which rules read it."""
    card = {"spec": "chara_card_v3", "spec_version": "3.1", "data": {"name": "Nyx", "description": "d"}}
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    assert body["name"] == "nyx" and soul(home, "nyx") == "d"
    assert any("3.1" in w for w in body["report"]["warnings"])


@pytest.mark.parametrize(
    "card",
    [
        pytest.param(v2(description="d", personality="p"), id="spec"),
        pytest.param({"description": "d", "personality": "p"}, id="v1"),
        pytest.param(v3(name="   ", description="d"), id="blank"),
    ],
)
def test_a_card_with_no_name_is_refused_on_every_rung(home: Path, card: dict) -> None:
    """The name is what the agent is MINTED from — slug, `{{char}}`, the folder the owner opens — so
    a card without one is unusable, not imperfect. One rule, stated at one place, for every rung."""
    with make_client() as c:
        r = put_card(c, json.dumps(card).encode("utf-8"))
    assert r.status_code == 422 and "no name" in r.json()["detail"]


def test_a_deeply_nested_card_is_refused_not_a_crash(home: Path) -> None:
    """Legal JSON, hostile shape (the S2 review's MED-3, reproduced): ~2KB of nested arrays parses
    fine and then exhausts the stack in the strip walk. Depth is the one property no single reader
    owns — the parser, the strip pass and the YAML dump each have their own limit — so the route
    contains it, and the atomic write never starts (the dump serialises into a buffer first)."""
    body = b'{"name":"Nyx","description":"d","extensions":' + b"[" * 1100 + b"]" * 1100 + b"}"
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 422 and "nested too deeply" in r.json()["detail"]
    assert not (home / "agents" / "nyx").exists() or not (home / "agents" / "nyx" / "agent.yaml").exists()


def test_a_5000_digit_number_is_refused_by_each_json_arm(home: Path) -> None:
    """The other legal-but-hostile document: a number past the interpreter's int-conversion limit
    raises a plain `ValueError`, which neither `json.loads` arm used to catch. Each arm keeps its own
    status — the bare body is "not a container we read", a card chunk is "a card we cannot use"."""
    raw = b'{"name":"Nyx","description":"d","x":' + b"9" * 5000 + b"}"
    chunked = png_bytes() + png_chunk(b"tEXt", b"chara\x00" + base64.b64encode(raw))
    with make_client() as c:
        assert put_card(c, raw).status_code == 415
        r = put_card(c, chunked + png_chunk(b"IEND", b""))
    assert r.status_code == 422 and "not valid JSON" in r.json()["detail"]


def test_an_undecodable_png_payload_is_422(home: Path) -> None:
    """The chunk is there and it is a card slot — the bytes inside it are what is broken."""
    body = png_bytes() + png_chunk(b"tEXt", b"chara\x00" + base64.b64encode(b"{not json"))
    with make_client() as c:
        r = put_card(c, body + png_chunk(b"IEND", b""))
    assert r.status_code == 422 and "not valid JSON" in r.json()["detail"]


def test_an_empty_upload_is_422(home: Path) -> None:
    with make_client() as c:
        assert put_card(c, b"").status_code == 422


# ── 3. the strip pass (§7, Emma F7) ───────────────────────────────────────────────────────────────


def test_the_strip_removes_the_denylist_at_any_depth_and_reports_exact_paths() -> None:
    """A unit pin on the function itself, because it is written to be reused verbatim by a future
    export: the keys go at ANY depth, in dicts and inside lists, matched case-insensitively, and the
    reported paths are exact JSON Pointers (RFC 6901). Inert siblings survive untouched (P4)."""
    tree = {
        "extensions": {
            "risuai": {
                "customScripts": [{"in": "x", "out": "y"}],
                "lowLevelAccess": True,
                "emotions": [["happy", "a.png"]],
            },
            "depth_prompt": {"prompt": "keep me", "depth": 4},
        },
        "character_book": {"entries": [{"keys": ["a"], "TriggerScript": "evil()"}]},
        "nested": [{"deeper": {"virtualscript": "x"}}],
    }
    cleaned, removed = strip_executable(tree)
    assert removed == [
        "/extensions/risuai/customScripts",
        "/extensions/risuai/lowLevelAccess",
        "/character_book/entries/0/TriggerScript",
        "/nested/0/deeper/virtualscript",
    ]
    assert cleaned == {
        "extensions": {
            "risuai": {"emotions": [["happy", "a.png"]]},
            "depth_prompt": {"prompt": "keep me", "depth": 4},
        },
        "character_book": {"entries": [{"keys": ["a"]}]},
        "nested": [{"deeper": {}}],
    }
    assert tree["extensions"]["risuai"]["customScripts"], "the input tree is not mutated"


def test_a_stripped_path_is_a_pointer_so_a_dot_in_a_key_cannot_collide() -> None:
    """Why a POINTER and not a dotted path (the S2 review's LOW-9): a card's keys are the author's,
    dots included, so `a.b.customScripts` is two different removals under a dotted grammar and two
    distinct pointers under RFC 6901 — with `/` and `~` escaped rather than ambiguous."""
    tree = {"a.b": {"customScripts": 1}, "a": {"b": {"customScripts": 2}}, "x/y~z": {"triggerscript": 3}}
    _, removed = strip_executable(tree)
    assert removed == ["/a.b/customScripts", "/a/b/customScripts", "/x~1y~0z/triggerscript"]
    assert len(set(removed)) == 3


def test_an_imported_card_is_kept_post_strip(home: Path) -> None:
    """End to end: nothing executable reaches `card.json` (or `agent.yaml`, which carries no card at
    all now — R87/RP-8), and the report NAMES what was removed — a strip the owner cannot see is
    indistinguishable from a card that never carried anything. ST's own scoped-regex field
    `extensions.regex_scripts` is on the denylist beside Risu's (R87/RP-4)."""
    card = v3(
        name="Nyx",
        description="d",
        creator="someone",
        tags=["archivist"],
        extensions={
            "risuai": {"customScripts": ["evil"], "additionalAssets": [["a", "b", "c"]]},
            "regex_scripts": [{"findRegex": "/x/", "replaceString": "y"}],
        },
    )
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    kept = card_json(home, "nyx")["data"]
    assert kept["creator"] == "someone" and kept["tags"] == ["archivist"]
    assert kept["extensions"] == {"risuai": {"additionalAssets": [["a", "b", "c"]]}}
    # Pointers address the spot in the UPLOADED file — a V3 card's fields sit under `/data` (R89/E-4).
    assert body["report"]["stripped_paths"] == [
        "/data/extensions/risuai/customScripts",
        "/data/extensions/regex_scripts",
    ]
    # `stashed_keys` = what was kept but not acted on; the spec envelope itself is not card data.
    assert body["report"]["stashed_keys"] == ["creator", "extensions", "tags"]
    assert "card" not in agent_yaml(home, "nyx") and "card" not in body["agent"]


def test_card_json_is_the_whole_normalized_card_at_0600(home: Path) -> None:
    """R87/RP-8: the sidecar is the as-imported restore point and export source, so it holds the
    MAPPED fields too — once the owner edits the SOUL or the greeting, the card's own values still
    exist, and the three fields SOUL fuses stay separable. Written 0600 (a card can carry
    credentials, R67), beside the SOUL, through the house atomic writer."""
    card = v3(
        name="Nyx",
        system_prompt="{{original}} Stay terse.",
        description="Nyx keeps the archive.",
        personality="Dry.",
        first_mes="You found the archive.",
        post_history_instructions="Stay in character.",
        creator="someone",
    )
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
        assert c.put("/api/agents/nyx/soul", json={"content": "Edited."}).status_code == 200
        assert c.put("/api/agents/nyx", json={"agent": {"greeting": "Edited."}}).status_code == 200
    path = home / "agents" / "nyx" / "card.json"
    assert path.stat().st_mode & 0o777 == 0o600
    kept = card_json(home, "nyx")
    assert (kept["spec"], kept["spec_version"]) == ("chara_card_v3", "3.0")  # the field's own envelope
    assert kept["data"] == card["data"]  # nothing to strip here, so it is the card, whole
    assert kept["data"]["system_prompt"] == "{{original}} Stay terse."
    assert kept["data"]["first_mes"] == "You found the archive."  # the owner's edit did not reach it


def test_card_json_keeps_the_declared_version_and_upgrades_v1_to_the_v2_envelope(home: Path) -> None:
    """The R87 review's O-8: `card.json` is the spec's own `{spec, spec_version, data}` envelope, so the
    declared version survives (a `3.1` card says `3.1`) and a V1 card — which has no envelope — is
    written as V2, ST's own upgrade of it."""
    declared = {"spec": "chara_card_v3", "spec_version": "3.1", "data": {"name": "Nyx", "description": "d"}}
    with make_client() as c:
        imported(c, json.dumps(declared).encode("utf-8"))
        imported(c, json.dumps({"name": "Old", "description": "d"}).encode("utf-8"))
    kept = card_json(home, "nyx")
    assert (kept["spec"], kept["spec_version"]) == ("chara_card_v3", "3.1")
    old = card_json(home, "old")
    assert (old["spec"], old["spec_version"]) == ("chara_card_v2", "2.0")
    assert old["data"] == {"name": "Old", "description": "d"}


def test_a_lone_surrogate_imports_and_round_trips_through_card_json(home: Path) -> None:
    """The R87 review's O-1: JS tools emit lone UTF-16 surrogates (`\\ud83d`), `json.loads` accepts
    them, and a UTF-8 encode cannot — written with `ensure_ascii=False` the sidecar raised AFTER the
    SOUL landed (a 500 and a half-agent resolving to the defaults). ASCII-escaped, the file is pure
    ASCII and the escape round-trips exactly."""
    body = json.dumps(v2(name="Nyx", description="d", creator_notes="\ud83d")).encode("ascii")
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 201, r.text
    text = (home / "agents" / "nyx" / "card.json").read_text(encoding="utf-8")
    assert "\\ud83d" in text  # the escaped form, on disk
    assert json.loads(text)["data"]["creator_notes"] == "\ud83d"
    assert (home / "agents" / "nyx" / "agent.yaml").is_file()  # the whole agent, not half of one


def test_a_lone_surrogate_in_the_persona_text_is_refused_before_anything_lands(home: Path) -> None:
    """The O-1 sibling the confirm round named: SOUL.md is the one raw-text write, so a lone
    surrogate in `description`/`personality`/`system_prompt` failed its UTF-8 encode mid-hop (a 500
    and an empty, unlisted folder). Refused at compose time with the ordinary 422."""
    body = json.dumps(v2(name="Nyx", description="d\ud83d")).encode("ascii")
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 422, r.text
    assert "lone surrogate" in r.json()["detail"]
    assert not (home / "agents" / "nyx").exists()


@pytest.mark.parametrize("container", ["json", "png"])
def test_nan_and_infinity_are_refused_so_card_json_stays_strict(home: Path, container: str) -> None:
    """The R87 review's O-7: `NaN`/`Infinity` are Python's JSON extension, not JSON — accepted, they
    would be written straight back into `card.json` as non-JSON tokens. Refused at parse, every arm."""
    raw = b'{"spec": "chara_card_v2", "data": {"name": "Nyx", "description": "d", "talkativeness": NaN}}'
    body = (
        raw if container == "json" else png_bytes() + png_chunk(b"tEXt", b"chara\x00" + base64.b64encode(raw))
    )
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 422 and "NaN" in r.json()["detail"], r.text
    assert not (home / "agents" / "nyx").exists()


def test_a_cancelled_import_keeps_its_lock_until_the_worker_thread_ends() -> None:
    """R89/E-2 confirm round: a request cancelled mid-import (a client disconnect) must not release the
    import lock while its worker thread is still minting and writing — a thread cannot be stopped, so
    `async with lock: await to_thread(…)` handed the lock to the next import mid-write. Asserted at the
    helper both routes share: after the cancel the lock is STILL held, a second entrant WAITS, and only
    when the worker ends does the lock free, the second run, and the cancellation surface."""
    import threading

    import app.api.agent as api

    async def scenario() -> None:
        lock = asyncio.Lock()
        release, finished, ran = threading.Event(), threading.Event(), []

        def slow_worker() -> str:
            release.wait(5)
            finished.set()
            return "first"

        first = asyncio.create_task(api._import_locked((lock,), slow_worker))
        await asyncio.sleep(0.05)
        assert lock.locked()
        first.cancel()
        await asyncio.sleep(0.05)
        assert lock.locked() and not finished.is_set()  # the lock outlived the cancel

        second = asyncio.create_task(api._import_locked((lock,), lambda: ran.append("second") or "second"))
        await asyncio.sleep(0.05)
        assert ran == []  # …so the second entrant is waiting, not writing beside the first

        release.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert finished.is_set()
        assert await second == "second" and ran == ["second"]
        assert not lock.locked()

    asyncio.run(scenario())


def test_envelope_level_unknowns_stay_at_the_envelope_level(home: Path) -> None:
    """R89/E-4: a key that sat BESIDE `data` (a vendor signature, a provenance id) is kept beside
    `data` in `card.json`, never folded into it — a future export must be able to put it back where
    it arrived. Card-level unknowns stay under `data`; both are reported as stashed."""
    card = {
        "spec": "chara_card_v3",
        "spec_version": "3.0",
        "vendor_signature": "sig",
        "data": {"name": "Nyx", "description": "d", "source": ["hub"]},
    }
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    kept = card_json(home, "nyx")
    assert kept["vendor_signature"] == "sig" and "vendor_signature" not in kept["data"]
    assert kept["data"]["source"] == ["hub"] and "source" not in kept
    assert list(kept) == ["spec", "spec_version", "vendor_signature", "data"]
    assert {"vendor_signature", "source"} <= set(body["report"]["stashed_keys"])


def test_the_report_maps_what_was_acted_on(home: Path) -> None:
    """R89/E-5: `fields_mapped` follows what the import DID. V3's `nickname` became the title, so it is
    mapped, not stashed; a mapped field that is present but lands nothing (a blank description) is
    not listed as mapped."""
    card = v3(name="Nyx the Archivist", nickname="Nyx", description="   ", personality="Dry.")
    with make_client() as c:
        report = imported(c, json.dumps(card).encode("utf-8"))["report"]
    assert "nickname" in report["fields_mapped"] and "nickname" not in report["stashed_keys"]
    assert "description" not in report["fields_mapped"]
    assert report["fields_mapped"][:2] == ["name", "personality"]


def test_a_card_with_no_persona_gets_its_own_character_soul_not_the_assistant(home: Path) -> None:
    """R89/E-1: a valid card that defines no persona (only a first message) used to get no SOUL at
    all, so the scaffold laid the baked ctrl-b identity over it — the greeting opened as Echo and
    every later turn said the speaker was the homelab assistant. It now gets the registry's
    `card_blank_soul`, `{{char}}` kept literal on disk and rendered at assembly."""
    from test_roleplay_s0 import _assemble, _make_thread, _systems, head

    from app.services.agent.prompts import REGISTRY
    from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

    card = v2(name="Echo", description="", personality="", system_prompt="", first_mes="Hello.")
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
        block = _systems(_assemble(c, _make_thread(c), "echo"))[0]
    assert soul(home, "echo") == REGISTRY["card_blank_soul"].default == "You are {{char}}."
    assert block == head("You are Echo.", "duties_conversational")
    assert DEFAULT_SYSTEM_PROMPT not in block


def _slow(real, delay: float = 0.3):
    """`real`, then a pause — widens the read-names → mint → write window so two unserialized
    imports would BOTH mint before either writes. With the route lock the second waits instead."""
    import time

    def wrapped(*args, **kwargs):
        out = real(*args, **kwargs)
        time.sleep(delay)
        return out

    return wrapped


def _fresh_import_locks(monkeypatch, api) -> None:
    """Per-test lock objects: a contended `asyncio.Lock` binds to the loop it first waited on, and
    each TestClient runs its own loop — so the module's locks must not carry one test's binding into
    the next. The route reads the module globals at call time, so this swaps what it holds."""
    import asyncio

    monkeypatch.setattr(api, "_agent_import_lock", asyncio.Lock())
    monkeypatch.setattr(api, "_book_import_lock", asyncio.Lock())


def test_two_concurrent_same_name_card_imports_mint_two_slugs(home: Path, monkeypatch) -> None:
    """R89/E-2: minting is "read the taken names → pick a slug → write", run in a worker thread, so
    two same-name imports at once (two tabs, a double tap) could both mint `nyx` and interleave their
    files into one folder, both answering 201. Run TRULY concurrently here — two threads over one
    TestClient, whose portal loop serves both requests at once — with the mint→write window widened
    so the unserialized race is deterministic, not lucky."""
    from concurrent.futures import ThreadPoolExecutor

    import app.api.agent as api

    monkeypatch.setattr(api, "import_card", _slow(api.import_card))
    _fresh_import_locks(monkeypatch, api)
    bodies = [json.dumps(v2(name="Nyx", description=d)).encode("utf-8") for d in ("first", "second")]
    with make_client() as c, ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda b: put_card(c, b), bodies))
    assert [r.status_code for r in responses] == [201, 201], [r.text for r in responses]
    assert sorted(r.json()["name"] for r in responses) == ["nyx", "nyx-2"]
    for r in responses:
        slug = r.json()["name"]
        folder = home / "agents" / slug
        assert {"agent.yaml", "SOUL.md", "card.json"} <= {f.name for f in folder.iterdir()}
        # …and each folder is ONE card, not an interleaving of two.
        assert soul(home, slug) == card_json(home, slug)["data"]["description"]


def test_two_concurrent_same_name_book_imports_mint_two_slugs(home: Path, monkeypatch) -> None:
    """The book half of R89/E-2 — the same check-then-write, the same lock pattern. The pause sits
    right AFTER the route mints the book's slug (and before it writes the file): that is the window
    two unserialized imports would both land in with the same slug."""
    from concurrent.futures import ThreadPoolExecutor

    import app.api.agent as api

    monkeypatch.setattr(api, "mint_slug", _slow(api.mint_slug))
    _fresh_import_locks(monkeypatch, api)
    books = [{"name": "Tides", "entries": [{"keys": ["k"], "content": c}]} for c in ("first", "second")]
    with make_client() as c, ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda b: c.put("/api/lorebooks/import", content=json.dumps(b).encode()), books)
        )
    assert [r.status_code for r in responses] == [201, 201], [r.text for r in responses]
    assert sorted(r.json()["slug"] for r in responses) == ["tides", "tides-2"]


def test_a_refused_card_writes_no_card_json(home: Path) -> None:
    """The sidecar lands in the same hop as the SOUL, AFTER the agent validates: a card the loader
    would refuse leaves no half-agent folder behind."""
    configure(home, "agent:\n  defaults:\n    max_repeat_calls: 0\n")
    with make_client() as c:
        r = put_card(c, json.dumps(v2(name="Nyx", description="d")).encode("utf-8"))
    assert r.status_code == 422, r.text
    assert not (home / "agents" / "nyx").exists()


# ── 4. the CHARX container's own bounds (§7) ──────────────────────────────────────────────────────


def _charx_config(**caps: int) -> str:
    body = "".join(f"    {k}: {v}\n" for k, v in caps.items())
    return f"roleplay:\n  card_import:\n{body}"


def test_a_charx_with_a_traversal_entry_is_refused(home: Path) -> None:
    """We extract nothing, so the name cannot escape anywhere — it is refused because an archive
    carrying one is hostile or broken, and reading a card out of it anyway would be the wrong answer."""
    body = charx({"card.json": json.dumps(v3(name="Nyx", description="d")).encode(), "../evil.txt": b"x"})
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 422 and "unsafe entry path" in r.json()["detail"]


def test_the_charx_entry_count_cap_is_config(home: Path) -> None:
    configure(home, _charx_config(charx_max_entries=2))
    members = {"card.json": json.dumps(v3(name="Nyx", description="d")).encode()}
    members |= {f"assets/{i}.txt": b"x" for i in range(3)}
    with make_client() as c:
        r = put_card(c, charx(members))
    assert r.status_code == 413 and "charx_max_entries" in r.json()["detail"]


def test_the_charx_per_entry_cap_is_config(home: Path) -> None:
    """Over EVERY member, read or not: what is bounded is the archive, not our appetite for it."""
    configure(home, _charx_config(charx_max_entry_bytes=64))
    body = charx({"card.json": json.dumps(v3(name="Nyx", description="d")).encode(), "big.bin": b"x" * 200})
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 413 and "charx_max_entry_bytes" in r.json()["detail"]


def test_the_charx_total_uncompressed_cap_is_config(home: Path) -> None:
    """The zip-bomb guard: checked against the DECLARED sizes, so it refuses before a byte is
    decompressed (each member here is well under the per-entry cap; together they are not)."""
    configure(home, _charx_config(charx_max_entry_bytes=1000, charx_max_total_bytes=1500))
    members = {"card.json": json.dumps(v3(name="Nyx", description="d")).encode()}
    members |= {f"a{i}.bin": b"x" * 900 for i in range(2)}
    with make_client() as c:
        r = put_card(c, charx(members))
    assert r.status_code == 413 and "charx_max_total_bytes" in r.json()["detail"]


def test_a_charx_module_member_is_never_read_or_stashed(home: Path) -> None:
    """§7's structural handling of CHARX code (the confirm-round F7 correction): the reader opens
    `card.json` and the icon asset and NOTHING else, so Risu's module member — where its importer
    finds the scripts it folds into `triggerscript`/`customScripts` — is never read at all. Nothing
    is stripped here because nothing was ever taken in."""
    module = json.dumps({"trigger": [{"code": "alert(1)"}], "customScripts": ["evil"]}).encode()
    body = charx(
        {
            "card.json": json.dumps(v3(name="Nyx", description="d")).encode(),
            "module.risum": module,
        }
    )
    with make_client() as c:
        payload = imported(c, body)
    assert payload["report"]["stripped_paths"] == []
    assert "alert(1)" not in (home / "agents" / "nyx" / "agent.yaml").read_text(encoding="utf-8")


def test_a_charx_without_a_card_json_is_422(home: Path) -> None:
    with make_client() as c:
        r = put_card(c, charx({"assets/x.png": png_bytes()}))
    assert r.status_code == 422 and "card.json" in r.json()["detail"]


# ── 5. the body + card-JSON caps (§5.3, Emma F8) ──────────────────────────────────────────────────


def test_the_body_cap_is_config_and_answers_413(home: Path) -> None:
    configure(home, "roleplay:\n  card_import:\n    max_bytes: 200\n")
    card = v2(name="Nyx", description="d" * 500)
    with make_client() as c:
        r = put_card(c, json.dumps(card).encode("utf-8"))
    assert r.status_code == 413 and "max_bytes" in r.json()["detail"]


@pytest.mark.parametrize("container", ["json", "png"])
def test_the_decoded_card_json_cap_applies_to_every_container(home: Path, container: str) -> None:
    """One cap on the DECODED card, whatever carried it — the PNG arm is the one a body cap alone
    would miss, because base64 hides a third of the size."""
    configure(home, "roleplay:\n  card_import:\n    max_card_json_bytes: 300\n")
    card = v2(name="Nyx", description="d" * 500)
    body = json.dumps(card).encode("utf-8") if container == "json" else png_card(card)
    with make_client() as c:
        r = put_card(c, body)
    assert r.status_code == 413 and "max_card_json_bytes" in r.json()["detail"]


# ── 6. mapping (§3.1 / §5.3 / §5.5) ───────────────────────────────────────────────────────────────


def test_the_full_mapping_lands_on_the_agent(home: Path) -> None:
    card = v3(
        name="Nyx the Archivist",
        description="d",
        personality="p",
        first_mes="You found the archive.",
        alternate_greetings=["Back again?", "  ", 7],
        mes_example="<START>\n{{user}}: hi\n{{char}}: mm.",
        scenario="A drowned observatory.",
        post_history_instructions="Stay in character.",
        character_book={"entries": [{"keys": ["archive"], "content": "It floods."}]},
    )
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    agent = body["agent"]
    assert body["name"] == "nyx-the-archivist"
    assert agent["title"] == "Nyx the Archivist"  # the card's name VERBATIM, since it differs
    assert agent["duties"] == "conversational"  # ruling 2/16 — cards start on the talking text
    assert agent["greeting"] == "You found the archive."
    assert agent["alt_greetings"] == ["Back again?", "7"]  # blanks dropped, scalars coerced
    assert agent["example_dialogue"] == "<START>\n{{user}}: hi\n{{char}}: mm."  # VERBATIM, marker kept
    assert agent["scenario"] == "A drowned observatory."
    assert agent["post_history"] == "Stay in character."
    # …and the auto-router's copy stays EMPTY (§5.3): a card's description is persona prose, not
    # "when to pick me", so an imported character is reached by an explicit pick until the owner
    # writes a routing line themselves.
    assert agent["description"] == ""
    # The embedded lorebook is kept in `card.json` verbatim — its permanent provenance home — AND
    # landed as a real attached book (S3 §6.5; the end-to-end hook is pinned in test_roleplay_s3).
    assert card_json(home, "nyx-the-archivist")["data"]["character_book"]["entries"][0]["keys"] == ["archive"]
    assert agent["lorebooks"] == ["nyx-the-archivist-book"]
    assert any("lorebook was imported as" in w for w in body["report"]["warnings"])
    assert body["report"]["post_history"] == "Stay in character."  # verbatim in the report (§7)
    assert body["report"]["fields_mapped"] == [
        "name",
        "description",
        "personality",
        "first_mes",
        "alternate_greetings",
        "mes_example",
        "scenario",
        "post_history_instructions",
        "character_book",  # acted on: it became an attached book (R89/E-5)
    ]


def test_the_report_names_the_macros_that_will_render_literally(home: Path) -> None:
    """R87/RP-3: ONE line, naming every macro in the card's prompt-facing text that this build does
    not render — sniffed over every mapped field (the alternate greetings included) — so a card
    built on `{{time}}` says so at the door instead of in its opening message. The vocabulary in any
    case and the stripped `{{// …}}` comment are never named, and a card that uses neither kind gets
    no line at all."""
    card = v2(
        name="Meiko",
        system_prompt="{{original}} {{// a note to myself}}",
        description="{{Char}} works nights.",
        first_mes="It is {{time}} on {{date}}.",
        alternate_greetings=["Pick one: {{random:tea,coffee}}"],
        post_history_instructions="{{idle_duration}} have passed.",
    )
    with make_client() as c:
        warnings = imported(c, json.dumps(card).encode("utf-8"))["report"]["warnings"]
        (line,) = [w for w in warnings if "does not render" in w]
        assert "the card's text" in line
        assert line.endswith("{{date}}, {{idle_duration}}, {{random}}, {{time}}")

        clean = imported(c, json.dumps(v2(name="Plain", description="{{User}} meets {{char}}.")).encode())
        assert not any("does not render" in w for w in clean["report"]["warnings"])


def test_a_character_note_is_reported_not_silently_dropped(home: Path) -> None:
    """R87/RP-6: ST's Character's Note (`extensions.depth_prompt`) is a real per-turn prompt field
    v1 has no slot for — one report line says so, and an empty note says nothing."""
    note = {"prompt": "Always answer in two sentences.", "depth": 0, "role": "system"}
    with make_client() as c:
        body = imported(
            c, json.dumps(v2(name="Keqing", description="d", extensions={"depth_prompt": note})).encode()
        )
        assert any("Character's Note" in w and "depth 0" in w for w in body["report"]["warnings"])

        empty = {"depth_prompt": {"prompt": "  ", "depth": 4}}
        body = imported(c, json.dumps(v2(name="Plain", description="d", extensions=empty)).encode())
        assert not any("Character's Note" in w for w in body["report"]["warnings"])


def test_a_v3_nickname_becomes_the_char_name(home: Path) -> None:
    """V3: a non-empty `nickname` "replaces the name in {{char}}" — and `title` IS `{{char}}` here
    (`macros_for`), so that is where it lands (the S2 review's MED-5). The slug still mints from
    `name` (a folder is an identifier, not a display) and the nickname stays in `card.json` verbatim."""
    card = v3(name="Nyx the Archivist", nickname="Nyx", description="d")
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    assert body["name"] == "nyx-the-archivist"
    assert body["agent"]["title"] == "Nyx"
    assert card_json(home, "nyx-the-archivist")["data"]["nickname"] == "Nyx"


def test_a_v2_nickname_is_provenance_only(home: Path) -> None:
    """The rule is V3's, so a V2 card carrying the same key keeps the name↔title rule it has today —
    the field is still kept in `card.json`, because the whole card is."""
    card = v2(name="Nyx the Archivist", nickname="Nyx", description="d")
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    assert body["agent"]["title"] == "Nyx the Archivist"
    assert card_json(home, "nyx-the-archivist")["data"]["nickname"] == "Nyx"


def test_the_tools_allowlist_is_written_explicitly(home: Path) -> None:
    """§5.5: the literal value of `roleplay.default_tools` lands IN the file — never the `"*"`
    default, which is the WIDEST value and would invert ruling 8's minimal-tools posture."""
    configure(home, "roleplay:\n  default_tools: [web_search, ping_host]\n")
    with make_client() as c:
        imported(c, json.dumps(v2(name="Nyx", description="d")).encode("utf-8"))
    on_disk = agent_yaml(home, "nyx")
    assert on_disk["tools"] == ["web_search", "ping_host"]
    assert on_disk["duties"] == "conversational"
    assert "privilege" not in on_disk  # CONFIRM is the default — nothing is written for it


def test_an_empty_card_field_is_absent_from_the_file(home: Path) -> None:
    """Ruling 10's zero-cost coexistence, on disk: `agent.yaml` says only what the card actually set.

    A bare V1 card, deliberately — a V2/V3 one always stashes its own `spec`/`spec_version`, which is
    provenance the export seam needs and therefore not "nothing"."""
    with make_client() as c:
        imported(c, json.dumps({"name": "nyx", "description": "d"}).encode("utf-8"))
    assert set(agent_yaml(home, "nyx")) == {"duties", "tools"}
    assert "title" not in agent_yaml(home, "nyx")  # the name IS the slug here


def test_the_slug_walks_past_a_collision_including_the_default_agent(home: Path) -> None:
    """The default agent is not a folder, but its name is not free either: a `default` card must not
    be able to shadow the agent every bare thread resolves to."""
    with make_client() as c:
        assert imported(c, json.dumps(v2(name="Nyx", description="d")).encode())["name"] == "nyx"
        assert imported(c, json.dumps(v2(name="NYX!", description="d")).encode())["name"] == "nyx-2"
        assert imported(c, json.dumps(v2(name="nyx", description="d")).encode())["name"] == "nyx-3"
        body = imported(c, json.dumps(v2(name="Default", description="d")).encode())
    assert body["name"] == "default-2"


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("Nyx", "nyx"),
        ("Nyx the Archivist", "nyx-the-archivist"),
        ("  ---Nyx---  ", "nyx"),
        ("Mr. O'Brien & Co.", "mr-o-brien-co"),
        ("エマ", "character"),  # nothing of the grammar survives → the fallback, never a refusal
        ("x" * 200, "x" * 64),  # the slug grammar's own 64-byte budget
    ],
)
def test_the_slug_mint(name: str, slug: str) -> None:
    assert mint_slug(name, set()) == slug


# ── 7. the avatar (§5.4) ──────────────────────────────────────────────────────────────────────────


def avatars(home: Path) -> list[str]:
    d = home / "media" / "agents" / "avatars"
    return sorted(p.name for p in d.iterdir() if p.is_file())


def test_the_png_card_lands_in_the_avatars_library_and_is_bound(home: Path) -> None:
    """The card PNG IS the avatar — landed through the media ladder, into the ordinary D65 library,
    and bound by FILENAME (the gacha deal pattern: the pool is registry, the binding is agent data)."""
    with make_client() as c:
        body = imported(c, png_card(v2(name="Nyx", description="d")))
        assert body["agent"]["avatar"] == "nyx.png"
        assert avatars(home) == ["nyx.png"]
        # …and it is an ordinary library entry: the namespace index lists it and the mount serves it.
        index = c.get("/api/media/agents").json()
        # …by FILENAME — `MediaFile.file`, which is what a config `files` entry addresses too; the
        # row's `name` is the display STEM, and binding to that would be the ambiguity "W9" removed.
        assert [f["file"] for f in index["roles"]["avatars"]] == ["nyx.png"]
        assert c.get("/api/media/agents/files/avatars/nyx.png").status_code == 200


def test_the_served_avatar_carries_no_card(home: Path) -> None:
    """R87/RP-4: the card PNG IS the avatar, and its `chara`/`ccv3` chunks are the WHOLE card as
    uploaded — unstripped. They are removed (whole chunks, any text-chunk type, keyword casefolded)
    before the image lands, so the scripts the strip pass removed are not sitting in a served media
    file. Every other chunk survives byte-for-byte, and the file is still a PNG: signature, IHDR
    first, IEND last."""
    note = png_chunk(b"tEXt", b"Comment\x00made by hand")
    risu = {"customScripts": ["evil"], "lowLevelAccess": True}
    body = png_card(keys={"ccv3": v3(name="Nyx", description="d", extensions={"risuai": risu})})
    body = body[: -len(png_chunk(b"IEND", b""))]  # re-open the file to add the other text types
    body += png_chunk(b"zTXt", b"CHARA\x00\x00compressed-card") + png_chunk(
        b"iTXt", b"chara\x00\x00\x00\x00\x00card"
    )
    body += note + png_chunk(b"IEND", b"")
    with make_client() as c:
        result = imported(c, body)
        assert result["report"]["stripped_paths"] == [
            "/data/extensions/risuai/customScripts",
            "/data/extensions/risuai/lowLevelAccess",
        ]
        served = c.get("/api/media/agents/files/avatars/nyx.png")
    assert served.status_code == 200
    avatar = served.content
    assert avatar == (home / "media" / "agents" / "avatars" / "nyx.png").read_bytes()
    assert avatar.startswith(png_bytes()) and avatar.endswith(png_chunk(b"IEND", b""))
    assert b"customScripts" not in avatar and b"ccv3" not in avatar and b"compressed-card" not in avatar
    assert b"\x00\x00card" not in avatar
    assert note in avatar  # a text chunk that is not a card survives untouched


def test_nothing_after_iend_reaches_the_avatar(home: Path) -> None:
    """The R87 review's O-2: the chunk walk stops at IEND, so a card chunk (or a glued zip) parked
    AFTER it used to be copied into the served avatar verbatim. Nothing past IEND belongs to the
    image: the output ends at IEND's chunk."""
    body = (
        png_card(v2(name="Nyx", description="d")) + png_chunk(b"tEXt", b"ccv3\x00SECRET") + b"PK\x03\x04zip"
    )
    with make_client() as c:
        imported(c, body)
        avatar = c.get("/api/media/agents/files/avatars/nyx.png").content
    assert avatar.endswith(png_chunk(b"IEND", b""))
    assert b"SECRET" not in avatar and b"PK\x03\x04" not in avatar


def test_strip_card_chunks_leaves_a_non_png_and_a_cardless_png_alone() -> None:
    from app.services.agent.card_import import strip_card_chunks

    plain = png_bytes() + png_chunk(b"tEXt", b"Title\x00x") + png_chunk(b"IEND", b"")
    assert strip_card_chunks(plain) == plain
    assert strip_card_chunks(jpeg_bytes()) == jpeg_bytes()
    # A truncated tail ends the walk and is copied as-is — nothing past it is guessed at.
    torn = png_bytes() + png_chunk(b"tEXt", b"chara\x00e30=") + b"\x00\x00\x01\x00tEXt"
    assert strip_card_chunks(torn) == png_bytes() + b"\x00\x00\x01\x00tEXt"


def test_a_second_card_of_the_same_name_walks_the_avatar_suffix(home: Path) -> None:
    with make_client() as c:
        assert imported(c, png_card(v2(name="Nyx", description="d")))["agent"]["avatar"] == "nyx.png"
        second = imported(c, png_card(v2(name="Nyx", description="d")))
    assert second["name"] == "nyx-2" and second["agent"]["avatar"] == "nyx-2.png"


def test_a_charx_icon_asset_becomes_the_avatar_under_its_own_extension(home: Path) -> None:
    """ST's pick order: `type == "icon"` named `main`, else the first icon. The extension comes from
    what the bytes claim, not from what the card called the file."""
    card = v3(
        name="Nyx",
        description="d",
        assets=[
            {"type": "background", "uri": "embeded://assets/bg.png", "name": "bg", "ext": "png"},
            {"type": "icon", "uri": "embeded://assets/other.png", "name": "alt", "ext": "png"},
            {"type": "icon", "uri": "embeded://assets/main.png", "name": "main", "ext": "png"},
        ],
    )
    body = charx(
        {
            "card.json": json.dumps(card).encode(),
            "assets/bg.png": png_bytes(),
            "assets/other.png": png_bytes(),
            "assets/main.png": jpeg_bytes(),  # the bytes decide the extension, not `ext`
        }
    )
    with make_client() as c:
        payload = imported(c, body)
    assert payload["agent"]["avatar"] == "nyx.jpg"
    assert avatars(home) == ["nyx.jpg"]
    assert any("further card asset" in w for w in payload["report"]["warnings"])
    # The icon was ACTED ON — it is the avatar — so `assets` is reported mapped (R89/E-5).
    assert "assets" in payload["report"]["fields_mapped"]
    assert "assets" not in payload["report"]["stashed_keys"]


def test_a_broken_image_degrades_to_a_warning_and_the_import_still_succeeds(home: Path) -> None:
    """§5.4: the character is the text. A card whose icon is not an image we store loses the picture
    and nothing else — never a whole-card refusal."""
    card = v3(
        name="Nyx",
        description="d",
        assets=[{"type": "icon", "uri": "embeded://icon.bin", "name": "main", "ext": "png"}],
    )
    body = charx({"card.json": json.dumps(card).encode(), "icon.bin": b"GIF89a-not-allowed-here"})
    with make_client() as c:
        payload = imported(c, body)
    assert payload["agent"]["avatar"] == ""
    assert avatars(home) == []
    assert any("image was not imported" in w for w in payload["report"]["warnings"])


def test_a_json_card_carries_no_avatar(home: Path) -> None:
    with make_client() as c:
        payload = imported(c, json.dumps(v2(name="Nyx", description="d")).encode("utf-8"))
    assert payload["agent"]["avatar"] == "" and avatars(home) == []


# ── 8. the agent.yaml chokepoint (§7, Emma F9) ────────────────────────────────────────────────────


def test_agent_yaml_is_written_at_0600(home: Path) -> None:
    """A card's stash can carry credentials (R67 found character objects holding provider API keys),
    so this file answers to the same 0600 contract `config.yaml` does — through the same writer, for
    the import path AND the editor's own PUT."""
    with make_client() as c:
        imported(c, json.dumps(v2(name="Nyx", description="d")).encode("utf-8"))
        assert c.put("/api/agents/ops", json={"agent": {"scenario": "x"}}).status_code == 200
    for slug in ("nyx", "ops"):
        mode = (home / "agents" / slug / "agent.yaml").stat().st_mode & 0o777
        assert mode == 0o600, slug


def test_an_edit_preserves_the_owners_comments(home: Path) -> None:
    """The whole reason the write moved: `safe_dump` rewrote the file wholesale, so an operator's
    notes died on the next save from the UI."""
    folder = home / "agents" / "ops"
    folder.mkdir(parents=True)
    (folder / "agent.yaml").write_text(
        "# the ops specialist — do not widen its tools\nscenario: old\nmax_iterations: 8\n",
        encoding="utf-8",
    )
    with make_client() as c:
        assert (
            c.put("/api/agents/ops", json={"agent": {"scenario": "new", "max_iterations": 8}}).status_code
            == 200
        )
    text = (folder / "agent.yaml").read_text(encoding="utf-8")
    assert "# the ops specialist — do not widen its tools" in text
    assert "scenario: new" in text


def test_a_full_replace_deletes_the_keys_the_submission_dropped(home: Path) -> None:
    """PUT semantics are a full replace of the fields dict — a stale key must not survive an edit."""
    with make_client() as c:
        c.put("/api/agents/ops", json={"agent": {"scenario": "x", "greeting": "hi"}})
        assert c.put("/api/agents/ops", json={"agent": {"scenario": "x"}}).status_code == 200
    assert agent_yaml(home, "ops") == {"scenario": "x"}


def test_yaml_11_ambiguous_values_round_trip_as_strings(home: Path) -> None:
    """`load_settings` reads with PyYAML's YAML-1.1 resolver, where `23:00` is 1380 and `no` is
    False. The chokepoint's `_yaml11_safe` is what keeps a greeting a greeting."""
    card = v2(name="Nyx", description="d", first_mes="23:00", scenario="no")
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
        agent = c.get("/api/agents/nyx").json()["agent"]
    assert agent["greeting"] == "23:00" and agent["scenario"] == "no"
    assert agent_yaml(home, "nyx")["greeting"] == "23:00"


def test_yaml_11_ambiguous_card_KEYS_survive_as_strings(home: Path) -> None:
    """The S2 review's MED-6, re-pinned where the card now lives: a card's extensions are arbitrary
    author-chosen keys, and `no`/`on` must come back as the strings they were. `card.json` is JSON,
    so no YAML-1.1 resolver ever sees them — which is part of why the provenance left `agent.yaml`."""
    card = v2(name="Nyx", description="d", extensions={"no": {"on": "23:00"}})
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
    assert card_json(home, "nyx")["data"]["extensions"] == {"no": {"on": "23:00"}}


def test_an_anchor_in_agent_yaml_does_not_smear_one_edit_across_two_keys(home: Path) -> None:
    """ruamel loads `lead: *m` as the SAME object `model: &m …` is, so syncing one used to write both
    (the S2 review's MED-7). `dealias_mapping` gives every alias occurrence its own node first — the
    anchor is expanded on save, which is the acceptable cost for a file this full-replace PUT owns."""
    folder = home / "agents" / "ops"
    folder.mkdir(parents=True)
    (folder / "agent.yaml").write_text(
        "model: &m\n  provider: local\n  model: worker\nrouting:\n  lead: *m\n", encoding="utf-8"
    )
    edit = {
        "model": {"provider": "local", "model": "worker"},
        "routing": {"lead": {"provider": "local", "model": "boss"}},
    }
    with make_client() as c:
        assert c.put("/api/agents/ops", json={"agent": edit}).status_code == 200
    on_disk = agent_yaml(home, "ops")
    assert on_disk["model"]["model"] == "worker"  # the key the edit did NOT touch
    assert on_disk["routing"]["lead"]["model"] == "boss"


# ── 9. the `agents` media namespace (§8.1) ────────────────────────────────────────────────────────


def test_the_agents_namespace_is_two_ordinary_roles() -> None:
    """One additive registry row (§8.1) — everything downstream walks the dict, which is what the
    per-namespace ensure/mount/index tests in `test_media_g5.py` already cover for every row here.
    No bundled ids (the app ships no character art) and no `slots`: the binding lives on the AGENT."""
    row = MEDIA_NAMESPACES["agents"]
    assert list(row.roles) == ["avatars", "backgrounds"]
    assert row.slots == {}
    assert all(cfg == MediaRole() for cfg in row.roles.values())


def test_both_agent_roles_are_ensured_and_indexed(home: Path) -> None:
    with make_client() as c:
        body = c.get("/api/media/agents").json()
    assert sorted(body["roles"]) == ["avatars", "backgrounds"]
    for role_name in ("avatars", "backgrounds"):
        assert (home / "media" / "agents" / role_name).is_dir()
