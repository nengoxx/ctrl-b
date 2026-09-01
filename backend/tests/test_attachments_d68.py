"""D68 / ATTACHMENTS_PLAN S1 — the attachment store, the staging transport and the claim.

The §9 S1 obligation list, one test each: the traversal/symlink/oversize/sniff/decode refusals · the
mint-time name refusal (PRE-STREAM — a refusable name never costs a 10 MB write) · the claim races
(consumed, expired, unknown, two claimants of one id) · the claim-is-the-only-writer pin (behaviour
AND source) · the unreferenced-file-in-a-live-thread-dir reconcile (the rename-then-insert crash
window) · the sweep's age bounds (a YOUNG unclaimed staging file survives) · thread-delete retention ·
`ChatRequest`'s attachment-only validation · the steer-path claim · old message rows still loading
with the part union grown. Plus the D65 architecture guard extended over the new route: no CORS
middleware, no POST, no multipart (SECURITY_MODEL §2.7).

The S2 fix wave's READ-path fail-closed pins (LOW-3) live here too rather than beside the feed tests:
they are about `core/attachments.py`'s own store tree, and they reuse the MED-1 relocation helper
below instead of restating it.

Config/db go to a temp `CTRLB_HOME`/`CTRLB_CONFIG`/`CTRLB_DB` (the shared `home` fixture) — never the
operator's real config.yaml.

Image fixtures are HEADER BYTES, not real encodings: nothing here decodes, so a valid header is the
whole surface (the `test_media_g5` convention, whose builders this file imports rather than restates).
"""

from __future__ import annotations

import os
import shutil
import struct
import time
from pathlib import Path
from urllib.parse import quote

import pytest
from _async import run_async
from test_media_g5 import (
    declares_multipart,
    home,
    iter_live_routes,
    jpeg_bytes,
    make_client,
    png_bytes,
    webp_bytes,
)

from app.core.attachments import (
    ALLOWED_SUFFIXES,
    CLAIM_REFUSED,
    STAGING_DIRNAME,
    StoredReadError,
    attachments_root,
    candidate_of,
    claim,
    mint_id,
    read_bytes,
    read_page,
    remove_thread_attachments,
    staged_name,
    staging_dir,
    sweep,
    sweep_staging,
    sweep_thread_dirs,
    thread_dir,
)
from app.core.media import PARTS_DIRNAME, StoreWriteError

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe

URL = "/api/attachments/staging"
APP_DIR = Path(__file__).resolve().parents[1] / "app"


def gif_bytes(w: int = 6, h: int = 5) -> bytes:
    """`GIF89a` + the logical-screen descriptor the reader takes its dimensions from."""
    return b"GIF89a" + struct.pack("<HH", w, h) + b"\x00" * 3


def pdf_bytes(body: bytes = b"nothing readable") -> bytes:
    return b"%PDF-1.7\n" + body


def stage(c, name: str, body: bytes) -> dict:
    """Mint one staged file and return the row, asserting it landed."""
    r = c.put(f"{URL}/{quote(name)}", content=body)
    assert r.status_code == 201, r.text
    return r.json()


def staged(home: Path) -> list[str]:
    """What staging holds — the app's own `.parts/` scratch DIRECTORY aside (the `leftovers` idiom
    from the D65 write tests: "leaves zero bytes" is a claim about FILES)."""
    d = staging_dir(home)
    if not d.exists():
        return []
    return sorted(p.name for p in d.iterdir() if p.name != PARTS_DIRNAME)


def stored(home: Path, thread_id: str) -> list[str]:
    d = thread_dir(home, thread_id)
    return sorted(p.name for p in d.iterdir()) if d.exists() else []


def parts_of(c, thread_id: str) -> list[dict]:
    """The persisted parts of a thread's single user message, read back through the API."""
    msgs = c.get(f"/api/threads/{thread_id}/messages").json()
    users = [m for m in msgs if m["role"] == "user"]
    assert users, msgs
    return users[0]["parts"]


def send(c, **body) -> object:
    """One chat POST. Buffered — the turn errors on "no inference endpoint configured", which is
    exactly what these tests want: the user message (and therefore the claim) is persisted first."""
    return c.post("/api/agent/chat", json={"stream": False, **body})


# ── the mint ──────────────────────────────────────────────────────────────────────────────────────


def test_a_put_stages_the_bytes_and_answers_with_an_opaque_id(home: Path) -> None:
    """201 + the row the composer chip renders from, the file under `staging/{id}-{name}`, and
    NOTHING anywhere else in the store — a mint touches no thread directory (§3)."""
    with make_client() as c:
        row = stage(c, "photo.png", png_bytes(640, 854))
        assert len(row["attachment_id"]) == 32 and row["attachment_id"].isalnum()
        assert (row["name"], row["kind"], row["mime"]) == ("photo.png", "image", "image/png")
        assert (row["width"], row["height"], row["bytes"]) == (640, 854, len(png_bytes(640, 854)))
        assert row["inline_chars"] is None  # a fact about TEXT only

        name = staged_name(row["attachment_id"], "photo.png")
        assert (staging_dir(home) / name).read_bytes() == png_bytes(640, 854)
        assert candidate_of(name) == "photo.png"
        # the whole store: the staging dir and nothing else. The claim is the only writer elsewhere.
        assert sorted(p.name for p in attachments_root(home).iterdir()) == ["staging"]


@pytest.mark.parametrize(
    ("name", "body", "kind", "mime"),
    [
        ("a.png", png_bytes(), "image", "image/png"),
        ("b.jpg", jpeg_bytes(), "image", "image/jpeg"),
        ("c.webp", webp_bytes(), "image", "image/webp"),
        ("d.gif", gif_bytes(), "image", "image/gif"),
        ("e.pdf", pdf_bytes(), "pdf", "application/pdf"),
        ("f.txt", b"plain", "text", "text/plain"),
        ("g.md", b"# heading", "text", "text/markdown"),
        ("h.csv", b"a,b\n1,2\n", "text", "text/csv"),
        ("i.json", b'{"k": 1}', "text", "application/json"),
    ],
)
def test_every_admitted_kind_round_trips(home: Path, name: str, body: bytes, kind: str, mime: str) -> None:
    """The three kinds and their tiers (§2): images and PDFs bind by BYTES, text by extension + a
    strict decode. Parametrized over the shipped allowlist so a new kind cannot be added silently."""
    with make_client() as c:
        row = stage(c, name, body)
        assert (row["kind"], row["mime"]) == (kind, mime)


def test_the_bytes_decide_an_image_not_the_extension(home: Path) -> None:
    """A phone photo saved as `.txt` is still an image (§2: the sniff wins), and the mime recorded is
    the sniffed one — which is what makes S3's inline serving safe."""
    with make_client() as c:
        row = stage(c, "screenshot.txt", png_bytes(9, 9))
        assert (row["kind"], row["mime"], row["width"]) == ("image", "image/png", 9)


def test_a_text_file_records_its_decoded_character_count(home: Path) -> None:
    """`inline_chars` is the extracted LENGTH — a fact about the file, never `min(len, cap)` (§2 /
    confirm N1): the estimator and the injection cap both price it at READ."""
    with make_client() as c:
        row = stage(c, "notes.txt", "héllo wörld".encode())
        assert row["inline_chars"] == 11 and row["bytes"] == 13  # chars, not bytes


@pytest.mark.parametrize(
    "name",
    [
        "art.svg",  # active content — never an image here, and not in any tier (§8)
        "notes.log",  # the owner ruled configs/logs OUT of scope (§0a-1)
        "conf.yaml",
        "no-extension",
        "CON.png",  # the media admission tier, shared verbatim
        ".hidden.png",
        "trailing.png ",
        "we\\ird.png",
        "x" * 260 + ".png",
    ],
)
def test_a_name_this_surface_may_not_mint_is_refused_BEFORE_A_BYTE_IS_WRITTEN(home: Path, name: str) -> None:
    """The mint-time name predicate (O-conf rider): a refusable name must never cost a 10 MB write.

    Proven by the STORE, not by a mock: the admission runs before `prepare_staging`, so a refused
    name leaves no staging directory and no `.parts/` scratch at all — nothing was opened, chmod'd or
    counted. The refusal is `admission_reason`'s own sentence, never a sanitised name (§3)."""
    with make_client() as c:
        r = c.put(f"{URL}/{quote(name)}", content=png_bytes())
        assert r.status_code == 422, f"{name} → {r.status_code}"
        assert r.json()["detail"]
        assert not attachments_root(home).exists()


@pytest.mark.parametrize("path", ["a/b.png", "..%2Fx.png", "%2e%2e%2Fx.png"])
def test_a_path_shaped_name_is_404_and_writes_nothing(home: Path, path: str) -> None:
    """A separator addresses nothing inside the staging dir, so it is the same 404 as anything else
    that is not there — the media route's rule, shared (`admit_filename`)."""
    with make_client() as c:
        assert c.put(f"{URL}/{path}", content=png_bytes()).status_code == 404
        assert not attachments_root(home).exists()


def test_an_empty_body_is_422(home: Path) -> None:
    with make_client() as c:
        r = c.put(f"{URL}/a.png", content=b"")
        assert r.status_code == 422 and "empty" in r.json()["detail"]
        assert staged(home) == []


def _cap_mb(c, mb: int) -> None:
    """Set the cap through the ordinary settings PUT — the tunable is config, so the test drives it
    the way the owner would (no magic numbers, no patched constant)."""
    r = c.put("/api/settings", json={"attachments": {"max_file_mb": mb}})
    assert r.status_code == 200, r.text


def test_an_oversize_body_is_413_and_leaves_nothing_behind(home: Path) -> None:
    with make_client() as c:
        _cap_mb(c, 1)
        r = c.put(f"{URL}/big.png", content=png_bytes(1, 1) + b"\x00" * (1024 * 1024 + 1))
        assert r.status_code == 413, r.text
        assert "attachments.max_file_mb" in r.json()["detail"]
        assert staged(home) == []


def test_a_CHUNKED_body_hits_the_same_cap(home: Path) -> None:
    """The COUNTER is the cap, never `Content-Length`: a chunked body carries no length at all
    (R55's arm, inherited whole from the media ladder)."""

    def chunks():
        yield png_bytes(1, 1)
        for _ in range(300):  # 1.2 MB, past the smallest cap the knob can express (1 MB)
            yield b"\x00" * 4096

    with make_client() as c:
        _cap_mb(c, 1)
        r = c.put(f"{URL}/big.png", content=chunks())
        assert r.status_code == 413, r.text
        assert staged(home) == []


@pytest.mark.parametrize(
    ("name", "body", "needle"),
    [
        ("evil.png", b"<html>not an image</html>", "not an accepted attachment"),
        ("truncated.png", b"\x89PNG\r\n\x1a\n", "not an accepted attachment"),
        ("doc.pdf", b"PK\x03\x04 a zip pretending", "not an accepted attachment"),
        ("notes.txt", b"\xff\xfe\x00 raw bytes", "not valid UTF-8"),
    ],
)
def test_bytes_that_are_not_an_admitted_attachment_are_415_and_leave_zero_bytes(
    home: Path, name: str, body: bytes, needle: str
) -> None:
    """The sniff + the strict decode, refusing at the door (§2). Zero bytes is the ladder's own
    guarantee: the validation happens BEFORE the file has a name anything can address."""
    with make_client() as c:
        r = c.put(f"{URL}/{name}", content=body)
        assert r.status_code == 415, r.text
        assert needle in r.json()["detail"]
        assert staged(home) == []


def test_the_extension_tier_is_the_union_of_the_three_kinds() -> None:
    """The mint's extension parameter is a REGISTRY, not a tunable — and SVG is not in it, which is
    what makes "SVG is never an image" true by construction rather than by a clause (§8)."""
    assert ".svg" not in ALLOWED_SUFFIXES
    assert {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".txt", ".md", ".csv", ".json"} == set(
        ALLOWED_SUFFIXES
    )


# ── the claim ─────────────────────────────────────────────────────────────────────────────────────


def test_the_send_claims_its_files_into_the_thread_and_persists_the_facts(home: Path) -> None:
    """The whole transport, end to end (§3): mint → send → the bytes are under the THREAD, staging is
    empty, and the user message carries server-built `AttachmentPart`s beside the text."""
    with make_client() as c:
        photo = stage(c, "photo.png", png_bytes(12, 8))
        notes = stage(c, "notes.txt", b"read me")
        r = send(c, text="look at these", attachments=[photo["attachment_id"], notes["attachment_id"]])
        assert r.status_code == 200, r.text
        tid = r.json()["threadId"]

        assert staged(home) == []  # claimed, not copied
        assert stored(home, tid) == ["notes.txt", "photo.png"]
        parts = parts_of(c, tid)
        assert [p["type"] for p in parts] == ["text", "attachment", "attachment"]
        assert parts[1] == {
            "type": "attachment",
            "kind": "image",
            "name": "photo.png",
            "mime": "image/png",
            "path": f"{tid}/photo.png",
            "bytes": len(png_bytes(12, 8)),
            "width": 12,
            "height": 8,
            "inline_chars": None,
        }
        assert parts[2]["inline_chars"] == 7 and parts[2]["kind"] == "text"


def test_a_name_collision_in_one_thread_gets_a_suffix_and_never_overwrites(home: Path) -> None:
    """The FINAL name is resolved at CLAIM, against the thread dir that only exists by then
    (confirm-round NEW 2) — and the landing is no-clobber, so the first photo survives the second."""
    with make_client() as c:
        first = stage(c, "photo.png", png_bytes(1, 1))
        second = stage(c, "photo.png", png_bytes(2, 2))
        r = send(c, text="two", attachments=[first["attachment_id"], second["attachment_id"]])
        tid = r.json()["threadId"]
        assert stored(home, tid) == ["photo-1.png", "photo.png"]
        assert (thread_dir(home, tid) / "photo.png").read_bytes() == png_bytes(1, 1)
        assert [p["name"] for p in parts_of(c, tid) if p["type"] == "attachment"] == [
            "photo.png",
            "photo-1.png",
        ]


def test_a_consumed_id_refuses_the_WHOLE_send_with_the_fix_named(home: Path) -> None:
    """A claim of a consumed id is a 409 whose copy says what to do (§3) — the lost-response retry
    class the plan records as an accepted residual, not a double-claim."""
    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        first = send(c, text="one", attachments=[row["attachment_id"]])
        tid = first.json()["threadId"]
        again = send(c, text="again", thread_id=tid, attachments=[row["attachment_id"]])
        assert again.status_code == 409, again.text
        assert again.json()["detail"] == CLAIM_REFUSED and "re-attach" in again.json()["detail"]
        # the refused send persisted no second user message, and stole no file
        assert [m["role"] for m in c.get(f"/api/threads/{tid}/messages").json()].count("user") == 1
        assert stored(home, tid) == ["photo.png"]


def test_an_unknown_id_refuses_the_send_AND_LEAVES_NO_EMPTY_THREAD(home: Path) -> None:
    """Question-10's ruling (S1 Emma round): a FIRST send creates the thread only because the claim
    needs somewhere to land. When the claim refuses there is no send, so there is no conversation —
    an empty shell would sit in the sidebar and the owner's re-attach retry would mint a second one
    beside it."""
    with make_client() as c:
        r = send(c, text="hi", attachments=[mint_id()])
        assert r.status_code == 409 and r.json()["detail"] == CLAIM_REFUSED
        assert c.get("/api/threads").json() == []


def test_an_EXISTING_thread_is_untouched_by_a_refused_claim(home: Path) -> None:
    """…and only a thread this request minted goes: an existing conversation is the owner's, and a
    refused attachment on it is a failed message, not a reason to delete their history."""
    with make_client() as c:
        tid = c.post("/api/threads").json()["id"]
        r = send(c, text="hi", thread_id=tid, attachments=[mint_id()])
        assert r.status_code == 409 and r.json()["detail"] == CLAIM_REFUSED
        assert [t["id"] for t in c.get("/api/threads").json()] == [tid]
        assert c.get(f"/api/threads/{tid}/messages").json() == []


def test_an_EXPIRED_id_refuses_even_though_the_file_is_still_there(home: Path) -> None:
    """Freshness is the CLAIM's rule, not only the sweep's: the sweep runs at boot, so a staged file
    would otherwise stay claimable for as long as the process happens to live. One number
    (`staging_orphan_hours`) decides both, so the two can never disagree about the same file."""
    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        path = staging_dir(home) / staged_name(row["attachment_id"], "photo.png")
        old = time.time() - 25 * 3600  # the default cap is 24h
        os.utime(path, (old, old))
        r = send(c, text="stale", attachments=[row["attachment_id"]])
        assert r.status_code == 409 and r.json()["detail"] == CLAIM_REFUSED
        assert path.exists()  # refused, not silently reclaimed — the sweep is the only remover


def test_ONE_bad_id_refuses_the_whole_send(home: Path) -> None:
    """All-or-nothing on the refusal (§3): a send that named a file it cannot have must not half-run.
    Nothing is persisted, the owner is told to re-attach — and on a FIRST send the thread deletion
    (Q10) reclaims the good id's already-moved bytes on the spot, through the delete hook, instead of
    leaving them to the sweep's referenced-set arm."""
    with make_client() as c:
        good = stage(c, "photo.png", png_bytes())
        r = send(c, text="mixed", attachments=[good["attachment_id"], mint_id()])
        assert r.status_code == 409
        assert c.get("/api/threads").json() == []
        assert sorted(p.name for p in attachments_root(home).iterdir()) == ["staging"]


def test_TWO_CLAIMANTS_of_one_id_leave_exactly_one_copy(home: Path, monkeypatch) -> None:
    """The claim is exclusive because of the UNLINK, not the link (§3).

    The race is made deterministic rather than hoped for: `os.link` is wrapped so the "other device"
    consumes the staging file the instant ours is linked. Our unlink then fails, and the loser must
    undo the copy it made and refuse — leaving no orphan behind in the thread dir."""
    import app.core.attachments as store

    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        real_link = store.os.link

        def racing_link(src, dst):
            real_link(src, dst)
            Path(src).unlink()  # the other claimant wins the race between our link and our unlink

        monkeypatch.setattr(store.os, "link", racing_link)
        with pytest.raises(StoreWriteError) as exc:
            claim(home, "t-race", row["attachment_id"], max_age_s=3600)
        assert exc.value.status == 409 and exc.value.detail == CLAIM_REFUSED
        assert stored(home, "t-race") == []  # the loser removed what it had linked


def test_the_OTHER_ordering_of_that_race_refuses_too(home: Path, monkeypatch) -> None:
    """The mirror case: the other claimant finishes BEFORE our link rather than after it. Both
    orderings must end in the same refusal — an unhandled `FileNotFoundError` here would surface as
    a 500 on an ordinary two-device send."""
    import app.core.attachments as store

    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        real_link = store.os.link

        def losing_link(src, dst):
            Path(src).unlink()  # the other claimant already consumed it
            real_link(src, dst)

        monkeypatch.setattr(store.os, "link", losing_link)
        with pytest.raises(StoreWriteError) as exc:
            claim(home, "t-race", row["attachment_id"], max_age_s=3600)
        assert exc.value.status == 409 and exc.value.detail == CLAIM_REFUSED
        assert stored(home, "t-race") == []


def test_a_symlink_in_staging_is_never_dereferenced(home: Path, tmp_path) -> None:
    """The store opens REGULAR FILES only (§2, E9) — the media dereference rule, reused. A link
    planted under a valid staged name is not a file this claim will follow, whatever it points at."""
    secret = tmp_path / "secret.png"
    secret.write_bytes(png_bytes(3, 3))
    with make_client() as c:
        stage(c, "real.png", png_bytes())  # so the staging dir exists
        aid = mint_id()
        (staging_dir(home) / staged_name(aid, "evil.png")).symlink_to(secret)
        r = send(c, text="try", attachments=[aid])
        assert r.status_code == 409 and r.json()["detail"] == CLAIM_REFUSED


def test_the_per_message_ceiling_is_refused_before_anything_is_claimed(home: Path) -> None:
    with make_client() as c:
        assert c.put("/api/settings", json={"attachments": {"max_files_per_message": 2}}).status_code == 200
        ids = [stage(c, f"p{i}.png", png_bytes())["attachment_id"] for i in range(3)]
        r = send(c, text="too many", attachments=ids)
        assert r.status_code == 422 and "max_files_per_message" in r.json()["detail"]
        assert len(staged(home)) == 3  # nothing claimed


# ── attachment-only sends (§7) ────────────────────────────────────────────────────────────────────


def test_an_attachment_only_send_is_legal_and_persists_with_no_text_part(home: Path) -> None:
    """ "Send a photo with no caption" was a 422 at the door before D68 (`text` min_length=1). For S1
    the message simply persists with no `TextPart`; the model-facing wire text is S2's."""
    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        r = send(c, attachments=[row["attachment_id"]])
        assert r.status_code == 200, r.text
        tid = r.json()["threadId"]
        assert [p["type"] for p in parts_of(c, tid)] == ["attachment"]
        assert c.get("/api/threads").json()[0]["title"] is None  # not an empty-string name


def test_a_send_with_neither_text_nor_attachments_is_still_422(home: Path) -> None:
    with make_client() as c:
        assert send(c, text="").status_code == 422
        assert send(c).status_code == 422


# ── the steer path (E7) ───────────────────────────────────────────────────────────────────────────


def test_a_steer_carries_its_attachment_ids_unclaimed(home: Path) -> None:
    """Send-while-streaming is a supported path, so the ids ride the queued entry (§3/E7). They stay
    UNCLAIMED there — the drain claims them, because only it knows the thread is now writable."""
    from app.services.agent.turns import reserve

    with make_client() as c:
        tid = c.post("/api/threads").json()["id"]
        reserve(c.app.state.turns, tid, "chat")  # a live chat turn owns the thread
        row = stage(c, "photo.png", png_bytes())
        r = send(c, text="and this", thread_id=tid, attachments=[row["attachment_id"]])
        assert r.status_code == 202, r.text
        entry = c.app.state.steer_queues[tid].peek()[0]
        assert entry.attachments == [row["attachment_id"]]
        assert staged(home) == [staged_name(row["attachment_id"], "photo.png")]


def test_the_drain_claims_a_steer_s_attachments_onto_its_message(home: Path) -> None:
    """Drain A persists the steer's files exactly as the main path does — never a silent drop (E7)."""
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession
    from app.services.agent.steering import SteerEntry, SteerQueue, SteerSource

    with make_client() as c:
        row = stage(c, "photo.png", png_bytes(5, 5))
        state = c.app.state
        thread = run_async(state.threads.create(Thread()))
        queues = {thread.id: SteerQueue()}
        queues[thread.id].append(
            SteerEntry(kind="message", text="also this", attachments=[row["attachment_id"]])
        )
        session = AgentSession(
            state.threads,
            state.messages,
            None,
            state.settings,
            None,
            steer_source=SteerSource(queues, thread.id),
        )

        async def drain():
            return [ev.event async for ev in session._drain_steers(thread)]

        assert run_async(drain()) == ["steer.applied"]
        assert stored(home, thread.id) == ["photo.png"]
        parts = parts_of(c, thread.id)
        assert [p["type"] for p in parts] == ["text", "attachment"]
        assert parts[1]["path"] == f"{thread.id}/photo.png"


def test_a_steer_whose_id_expired_keeps_its_TEXT_and_says_so(home: Path) -> None:
    """The drain has no response to refuse into, so the honest equivalent of the POST's 409 is a
    `notice` beside a message that still carries what the owner typed — never a silent drop."""
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession
    from app.services.agent.steering import SteerEntry, SteerQueue, SteerSource

    with make_client() as c:
        state = c.app.state
        thread = run_async(state.threads.create(Thread()))
        queues = {thread.id: SteerQueue()}
        queues[thread.id].append(SteerEntry(kind="message", text="typed this", attachments=[mint_id()]))
        session = AgentSession(
            state.threads,
            state.messages,
            None,
            state.settings,
            None,
            steer_source=SteerSource(queues, thread.id),
        )

        async def drain():
            return [(ev.event, ev.data) for ev in [e async for e in session._drain_steers(thread)]]

        events = run_async(drain())
        assert [e for e, _ in events] == ["notice", "steer.applied"]
        assert "re-attach" in events[0][1]["text"]
        assert [p["type"] for p in parts_of(c, thread.id)] == ["text"]


def test_a_steer_that_was_ONLY_a_refused_attachment_persists_no_empty_bubble(home: Path) -> None:
    """…and when there is no text either, there is nothing to persist: an empty user row would
    render an empty bubble AND add an empty turn to the model's context. The notice is the whole
    truth, and the entry still leaves the queue (it is consumed either way)."""
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession
    from app.services.agent.steering import SteerEntry, SteerQueue, SteerSource

    with make_client() as c:
        state = c.app.state
        thread = run_async(state.threads.create(Thread()))
        queues = {thread.id: SteerQueue()}
        queues[thread.id].append(SteerEntry(kind="message", text="", attachments=[mint_id()]))
        session = AgentSession(
            state.threads,
            state.messages,
            None,
            state.settings,
            None,
            steer_source=SteerSource(queues, thread.id),
        )

        async def drain():
            return [ev.event async for ev in session._drain_steers(thread)]

        assert run_async(drain()) == ["notice"]
        assert c.get(f"/api/threads/{thread.id}/messages").json() == []
        assert thread.id not in queues  # committed off, and the emptied queue's key pruned (D41 FIX 5)


def _drain_session(c, thread, queues):
    """An `AgentSession` wired to nothing but the thread's steer queue — the drain's own harness."""
    from app.services.agent.session import AgentSession
    from app.services.agent.steering import SteerSource

    return AgentSession(
        c.app.state.threads,
        c.app.state.messages,
        None,
        c.app.state.settings,
        None,
        steer_source=SteerSource(queues, thread.id),
    )


def _drain(session, thread) -> list:
    async def go():
        return [(ev.event, ev.data) async for ev in session._drain_steers(thread)]

    return run_async(go())


def test_a_steer_DELETED_while_its_files_are_claimed_persists_NOTHING(home: Path, monkeypatch) -> None:
    """S1 MED-2: the claims are AWAITED — directory scans, an fsync and a strict whole-file decode per
    file — so an "unsend" (`DELETE …/steer/{id}`) or a Stop-harvest has a real window to land on an
    entry the drain already peeked. Persisting it anyway would resurrect a message the owner took
    back, so ownership is re-checked immediately before the transaction.

    The race is made deterministic rather than hoped for: the claim seam removes the entry from the
    queue itself, exactly as the DELETE endpoint would."""
    from app.domain.conversation import Thread
    from app.services.agent import session as session_mod
    from app.services.agent.steering import SteerEntry, SteerQueue

    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        thread = run_async(c.app.state.threads.create(Thread()))
        entry = SteerEntry(kind="message", text="unsent this", attachments=[row["attachment_id"]])
        queue = SteerQueue()
        queue.append(entry)
        queues = {thread.id: queue}
        real = session_mod.claim_attachments

        async def racing_claim(settings, thread_id, ids):
            parts = await real(settings, thread_id, ids)
            queue.remove(entry.entry_id)  # the DELETE lands while the claim is awaited
            return parts

        monkeypatch.setattr(session_mod, "claim_attachments", racing_claim)
        assert _drain(_drain_session(c, thread, queues), thread) == []
        assert c.get(f"/api/threads/{thread.id}/messages").json() == []
        assert thread.id not in queues  # the run still cleared the queue (and pruned its key)
        # …and the files it had already claimed stay put: the accepted unreferenced-file class the
        # sweep's referenced-set arm reclaims (§10), never a rollback machine.
        assert stored(home, thread.id) == ["photo.png"]


def test_only_the_DELETED_entry_of_a_run_is_dropped(home: Path, monkeypatch) -> None:
    """The re-check is per ENTRY, not per run: a steer the owner unsent must not take its neighbour
    with it. The first entry persists exactly as it always did."""
    from app.domain.conversation import Thread
    from app.services.agent import session as session_mod
    from app.services.agent.steering import SteerEntry, SteerQueue

    with make_client() as c:
        kept = stage(c, "kept.png", png_bytes(3, 3))
        gone = stage(c, "gone.png", png_bytes(4, 4))
        thread = run_async(c.app.state.threads.create(Thread()))
        e1 = SteerEntry(kind="message", text="keep me", attachments=[kept["attachment_id"]])
        e2 = SteerEntry(kind="message", text="unsent", attachments=[gone["attachment_id"]])
        queue = SteerQueue()
        queue.append(e1)
        queue.append(e2)
        queues = {thread.id: queue}
        real = session_mod.claim_attachments

        async def racing_claim(settings, thread_id, ids):
            parts = await real(settings, thread_id, ids)
            if ids == e2.attachments:
                queue.remove(e2.entry_id)
            return parts

        monkeypatch.setattr(session_mod, "claim_attachments", racing_claim)
        events = _drain(_drain_session(c, thread, queues), thread)
        assert [(e, d["entryId"]) for e, d in events] == [("steer.applied", e1.entry_id)]
        parts = parts_of(c, thread.id)
        assert [p["type"] for p in parts] == ["text", "attachment"]
        assert parts[1]["name"] == "kept.png"


# ── retention: the delete hook + the boot sweep ───────────────────────────────────────────────────


def test_deleting_a_thread_deletes_its_attachments(home: Path) -> None:
    """The cascade cannot reach the filesystem, so the repo takes the bytes with the row (§2)."""
    with make_client() as c:
        row = stage(c, "photo.png", png_bytes())
        tid = send(c, text="keep", attachments=[row["attachment_id"]]).json()["threadId"]
        assert thread_dir(home, tid).exists()
        assert run_async(c.app.state.threads.delete(tid)) is True
        assert not thread_dir(home, tid).exists()


def test_the_sweep_keeps_a_YOUNG_unclaimed_staging_file_and_reclaims_an_AGED_one(home: Path) -> None:
    """The age bound is the point (E-sound): a first chat POST may not have arrived yet, so a fresh
    upload must survive a restart. Only what no send can claim any more is reclaimed."""
    with make_client() as c:
        young = stage(c, "young.png", png_bytes())
        old = stage(c, "old.png", png_bytes())
        old_path = staging_dir(home) / staged_name(old["attachment_id"], "old.png")
        stamp = time.time() - 48 * 3600
        os.utime(old_path, (stamp, stamp))

    assert sweep(home, live_thread_ids=[], referenced=set(), max_age_s=24 * 3600) == 1
    assert staged(home) == [staged_name(young["attachment_id"], "young.png")]


def test_the_sweep_reclaims_an_UNREFERENCED_file_in_a_LIVE_thread_dir(home: Path) -> None:
    """The rename-then-insert crash window (confirm-round NEW 1): the claim landed the file, the
    process died before the message row, and the retry correctly refused the consumed id — so
    nothing else will ever pick this file up. Referenced files in the same directory are untouched."""
    with make_client() as c:
        row = stage(c, "kept.png", png_bytes())
        tid = send(c, text="keep", attachments=[row["attachment_id"]]).json()["threadId"]
        orphan = thread_dir(home, tid) / "orphan.png"
        orphan.write_bytes(png_bytes())
        stamp = time.time() - 48 * 3600
        os.utime(orphan, (stamp, stamp))
        os.utime(thread_dir(home, tid) / "kept.png", (stamp, stamp))  # aged, but REFERENCED

        live = [t.id for t in run_async(c.app.state.threads.list(include_archived=True))]
        referenced = run_async(c.app.state.messages.attachment_paths())
        assert referenced == {f"{tid}/kept.png"}
        assert sweep(home, live_thread_ids=live, referenced=referenced, max_age_s=24 * 3600) == 1
        assert stored(home, tid) == ["kept.png"]


def test_the_sweep_cannot_race_a_claim_in_flight(home: Path) -> None:
    """Both arms are age-bounded, so a file whose message row is milliseconds away is never a
    candidate — the freshly claimed file below is unreferenced AND untouched."""
    with make_client() as c:
        row = stage(c, "fresh.png", png_bytes())
        part = claim(home, "t-live", row["attachment_id"], max_age_s=3600)
        assert part.path == "t-live/fresh.png"
        assert sweep(home, live_thread_ids=["t-live"], referenced=set(), max_age_s=24 * 3600) == 0
        assert stored(home, "t-live") == ["fresh.png"]


def test_the_sweep_removes_a_dead_thread_s_directory(home: Path) -> None:
    """A directory whose thread row is gone holds files nothing can reach (§2 retention arm (a))."""
    with make_client() as c:
        row = stage(c, "gone.png", png_bytes())
        claim(home, "t-dead", row["attachment_id"], max_age_s=3600)
        stamp = time.time() - 48 * 3600
        os.utime(thread_dir(home, "t-dead") / "gone.png", (stamp, stamp))
        assert sweep(home, live_thread_ids=[], referenced=set(), max_age_s=24 * 3600) == 1
        assert not thread_dir(home, "t-dead").exists()


def test_the_boot_sweep_runs_in_the_lifespan(home: Path) -> None:
    """Wired, not merely written: an aged staged file is gone after the next start-up."""
    with make_client() as c:
        row = stage(c, "old.png", png_bytes())
        path = staging_dir(home) / staged_name(row["attachment_id"], "old.png")
        stamp = time.time() - 48 * 3600
        os.utime(path, (stamp, stamp))
    with make_client():
        assert staged(home) == []


def test_remove_thread_attachments_is_a_no_op_for_a_thread_with_none(home: Path) -> None:
    assert remove_thread_attachments(home, "never-used") == 0


# ── housekeeping fails CLOSED on a store root that is not ours (S1 MED-1) ─────────────────────────


def _relocate_root(home: Path, target: Path) -> None:
    """Replace the store root with a SYMLINK to `target` — the reviewer's MED-1 repro.

    The retention walks below all start at the root, so a link there silently re-points every one of
    them at someone else's directory: the dead-thread arm then reads its children, recognises none of
    them as threads, and deletes the aged files it finds (`removed=1` on an outside victim)."""
    root = attachments_root(home)
    if root.exists():
        shutil.rmtree(root)
    root.symlink_to(target, target_is_directory=True)


def _age(path: Path) -> None:
    stamp = time.time() - 48 * 3600  # past any cap the sweep can be given
    os.utime(path, (stamp, stamp))


def test_a_SYMLINKED_root_makes_the_thread_dir_sweep_a_no_op(home: Path, tmp_path) -> None:
    """The reproduced case: an unrecognised child directory of the link target holds an aged regular
    file laid out exactly like a dead thread's leftovers. Nothing outside the workspace is ours."""
    outside = tmp_path / "elsewhere"
    (outside / "not-a-thread").mkdir(parents=True)
    victim = outside / "not-a-thread" / "holiday.png"
    victim.write_bytes(png_bytes())
    _age(victim)
    _relocate_root(home, outside)

    assert sweep_thread_dirs(home, live_thread_ids=set(), referenced=set(), max_age_s=3600) == 0
    assert victim.read_bytes() == png_bytes()


def test_a_SYMLINKED_root_makes_the_staging_sweep_a_no_op(home: Path, tmp_path) -> None:
    """…and the same for the staging arm: an aged file under a staged-looking name inside the link
    target is not a staged upload, it is somebody's file that happens to be reachable."""
    outside = tmp_path / "elsewhere"
    (outside / STAGING_DIRNAME).mkdir(parents=True)
    victim = outside / STAGING_DIRNAME / staged_name(mint_id(), "holiday.png")
    victim.write_bytes(png_bytes())
    _age(victim)
    _relocate_root(home, outside)

    assert sweep_staging(home, max_age_s=3600) == 0
    assert victim.read_bytes() == png_bytes()


def test_a_SYMLINKED_root_makes_the_thread_delete_hook_a_no_op(home: Path, tmp_path) -> None:
    """The delete hook takes a THREAD ID and builds a path from it — so a relocated root turns an
    ordinary conversation delete into an unlink of whatever answers to that name over there."""
    outside = tmp_path / "elsewhere"
    (outside / "t-victim").mkdir(parents=True)
    victim = outside / "t-victim" / "holiday.png"
    victim.write_bytes(png_bytes())
    _relocate_root(home, outside)

    assert remove_thread_attachments(home, "t-victim") == 0
    assert victim.read_bytes() == png_bytes()


def test_a_store_root_that_is_a_FILE_fails_every_arm_closed_without_raising(home: Path) -> None:
    """The other shape `require_real_dir` rejects. Housekeeping never raises — a boot sweep and a
    thread delete may not fail over a tree only an operator can fix — so all three answer 0."""
    root = attachments_root(home)
    root.write_bytes(b"not a directory")

    assert sweep_staging(home, max_age_s=3600) == 0
    assert sweep_thread_dirs(home, live_thread_ids=set(), referenced=set(), max_age_s=3600) == 0
    assert remove_thread_attachments(home, "t-anything") == 0
    assert root.read_bytes() == b"not a directory"  # and the operator's file is untouched


# ── the READ path fails closed on the same shapes (S2 LOW-3) ──────────────────────────────────────


def _plant(directory: Path) -> Path:
    """One outside file laid out exactly as a stored attachment would be — the victim of both reads."""
    directory.mkdir(parents=True, exist_ok=True)
    victim = directory / "notes.txt"
    victim.write_text("private\n", encoding="utf-8")
    return victim


def test_a_SYMLINKED_root_makes_every_stored_READ_answer_nothing(home: Path, tmp_path) -> None:
    """The read half of the housekeeping rule above: `_stored_file`'s per-file checks all hang off the
    thread dir, so a relocated ROOT points them at somebody else's directory — where a regular file
    under the right name passes every one of them."""
    victim = _plant(tmp_path / "elsewhere" / "t-victim")
    _relocate_root(home, tmp_path / "elsewhere")

    assert read_bytes(home, "t-victim", "notes.txt") is None
    with pytest.raises(StoredReadError):
        read_page(home, "t-victim", "notes.txt", max_chars=1000)
    assert victim.read_text(encoding="utf-8") == "private\n"  # never opened, never touched


def test_a_SYMLINKED_THREAD_DIR_makes_every_stored_READ_answer_nothing(home: Path, tmp_path) -> None:
    """The subtler shape (LOW-3): the root is ours and ONE thread's directory is a link. The
    resolved-parent equality cannot catch it — both sides resolve through the same link, so the check
    compares the outside directory with itself and passes. The link is refused before it is followed."""
    victim = _plant(tmp_path / "elsewhere")
    attachments_root(home).mkdir(parents=True, exist_ok=True)
    thread_dir(home, "t-linked").symlink_to(tmp_path / "elsewhere", target_is_directory=True)

    assert read_bytes(home, "t-linked", "notes.txt") is None
    with pytest.raises(StoredReadError):
        read_page(home, "t-linked", "notes.txt", max_chars=1000)
    assert victim.read_text(encoding="utf-8") == "private\n"


@pytest.mark.parametrize("bad", ["../elsewhere", "a/b", "", ".", "..", "back\\slash", "C:x"])
def test_a_thread_id_that_is_not_a_BARE_NAME_cannot_address_the_store(home: Path, bad: str) -> None:
    """Defence in depth at the one path builder: the id is server-owned, but confinement is a RULE
    (§10) and a rule stated once is a rule that cannot be forgotten by a future caller."""
    with pytest.raises(StoreWriteError):
        thread_dir(home, bad)


# ── the claim is the ONLY writer into a thread dir (§3) ───────────────────────────────────────────


#: Every NAMED seam that yields a path inside the store — the builders and the one directory name
#: they are all built from. Grepping only `thread_dir(` left the door open (S1 LOW-4):
#: `attachments_root(home) / thread_id` reaches the same directory without ever naming the builder.
_PATH_SEAMS = ("thread_dir(", "attachments_root(", "staging_dir(", "ATTACHMENTS_DIRNAME")


def test_only_the_store_module_can_address_a_thread_directory() -> None:
    """The source half of the claim-only-writer pin (O-conf rider).

    "The claim is the only writer" is a rule about a PATH nobody else may build — claim-time
    confinement is not a property of the directory (§10), so it holds only while exactly one module
    can name it. `core/attachments.py` owns every builder; anything that wants a thread's files goes
    through the functions beside them.

    The residue is stated rather than hidden: a hand-built `home / "attachments" / tid` literal names
    no seam at all and no source grep can catch it. What this pin buys is that every path a reader
    would REACH FOR is a single module's, so an alternate writer has to be written deliberately and
    unidiomatically — and review owns that last step."""
    offenders = sorted(
        (p.relative_to(APP_DIR).as_posix(), seam)
        for p in APP_DIR.rglob("*.py")
        if p.name != "attachments.py"
        for seam in _PATH_SEAMS
        if seam in p.read_text(encoding="utf-8")
    )
    assert not offenders, (
        f"the attachment store's paths are built outside core/attachments.py in {offenders} — "
        "the claim is the only writer into a thread dir (D68 §3)"
    )


def test_the_staging_route_writes_nothing_outside_staging(home: Path) -> None:
    """…and the behavioural half: whatever the mint is given, the store grows exactly one directory
    until a send claims something."""
    with make_client() as c:
        stage(c, "a.png", png_bytes())
        c.put(f"{URL}/CON.png", content=png_bytes())
        c.put(f"{URL}/b.png", content=b"not an image")
        c.put(f"{URL}/../escape.png", content=png_bytes())
        assert sorted(p.name for p in attachments_root(home).iterdir()) == ["staging"]


# ── the READ mount (S3 §8): what is served, how, and what is 404 ──────────────────────────────────


def _claim_one(c, name: str, body: bytes, text: str = "look") -> tuple[str, str]:
    """Stage one file and SEND it, returning `(thread_id, stored_name)` — the only way bytes ever
    reach a thread dir, so every read test starts from a real claim."""
    row = stage(c, name, body)
    tid = send(c, text=text, attachments=[row["attachment_id"]]).json()["threadId"]
    return tid, row["name"]


def test_a_claimed_image_serves_INLINE_with_the_SNIFFED_type(home: Path) -> None:
    """The bubble's `<img>` source (§7). The Content-Type is the part's sniffed `mime`, which is why
    a photo the picker named `.txt` still paints — and why an HTML file named `.png` never could."""
    with make_client() as c:
        tid, name = _claim_one(c, "screenshot.txt", png_bytes(9, 9))
        r = c.get(f"/api/attachments/{tid}/{name}")
        assert r.status_code == 200, r.text
        assert r.content == png_bytes(9, 9)
        assert r.headers["content-type"] == "image/png"  # NOT text/plain from the extension
        assert r.headers["x-content-type-options"] == "nosniff"
        assert "immutable" in r.headers["cache-control"]
        assert "content-disposition" not in {k.lower() for k in r.headers}  # inline: paintable


@pytest.mark.parametrize(
    ("name", "body", "mime"),
    [("notes.txt", b"private notes", "text/plain"), ("paper.pdf", pdf_bytes(), "application/pdf")],
)
def test_a_text_or_pdf_attachment_serves_as_an_INERT_download(
    home: Path, name: str, body: bytes, mime: str
) -> None:
    """§8: stored bytes are never ACTIVE content in this origin. Everything that is not a sniffed
    image carries `Content-Disposition: attachment` beside `nosniff`, so the browser saves it."""
    with make_client() as c:
        tid, stored_name = _claim_one(c, name, body)
        r = c.get(f"/api/attachments/{tid}/{stored_name}")
        assert r.status_code == 200, r.text
        assert r.content == body
        # `startswith`: Starlette appends `; charset=utf-8` to a `text/*` type, which is exactly
        # right here — the store admits text only through a STRICT UTF-8 decode (§2).
        assert r.headers["content-type"].startswith(mime)
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["content-disposition"].startswith("attachment;")


def test_the_read_route_serves_only_what_a_PART_of_THAT_THREAD_references(home: Path) -> None:
    """The part is the authority (§8). Four ways a file can exist and still be 404: no part names it
    (the claim's crash-window leftover), the part belongs to another thread, the thread is unknown,
    the name is not there at all."""
    with make_client() as c:
        tid, name = _claim_one(c, "kept.png", png_bytes())
        other = send(c, text="elsewhere").json()["threadId"]
        orphan = thread_dir(home, tid) / "orphan.png"
        orphan.write_bytes(png_bytes())

        assert c.get(f"/api/attachments/{tid}/{name}").status_code == 200
        assert c.get(f"/api/attachments/{tid}/orphan.png").status_code == 404  # unreferenced
        assert c.get(f"/api/attachments/{other}/{name}").status_code == 404  # another thread's part
        assert c.get(f"/api/attachments/t-nope/{name}").status_code == 404  # no such thread
        assert c.get(f"/api/attachments/{tid}/absent.png").status_code == 404
        assert orphan.exists()  # a 404 is a refusal, never a cleanup


def test_a_STAGED_but_unclaimed_file_is_not_readable(home: Path) -> None:
    """Staging is not a served surface: until a send claims it, a staged file has no thread, no part
    and therefore no URL (§3 — the id is the whole credential, and it is not an address)."""
    with make_client() as c:
        row = stage(c, "secret.png", png_bytes())
        staged_file = staged_name(row["attachment_id"], "secret.png")
        assert c.get(f"/api/attachments/{STAGING_DIRNAME}/{staged_file}").status_code == 404
        assert c.get(f"/api/attachments/{STAGING_DIRNAME}/{row['attachment_id']}").status_code == 404
        assert staged(home) == [staged_file]


@pytest.mark.parametrize("name", ["../../config.yaml", "..%2F..%2Fconfig.yaml", "sub/dir.png", "."])
def test_the_read_route_refuses_a_name_that_is_not_a_BARE_FILE(home: Path, name: str) -> None:
    """Traversal and shape, answered with the SAME 404 as "not there" — the store's own dereference
    rules (`stored_file`), never a second sanitizer here (E9)."""
    with make_client() as c:
        tid, _ = _claim_one(c, "kept.png", png_bytes())
        assert c.get(f"/api/attachments/{tid}/{name}").status_code == 404


def test_a_SYMLINK_planted_in_a_thread_dir_is_never_followed_by_the_route(home: Path, tmp_path) -> None:
    """The per-file half of the read rules, end to end: a part is persisted, and the file under its
    name is then replaced with a link to somebody else's file. `is_served_file` refuses it."""
    outside = tmp_path / "elsewhere.txt"
    outside.write_text("private\n", encoding="utf-8")
    with make_client() as c:
        tid, name = _claim_one(c, "notes.txt", b"mine")
        target = thread_dir(home, tid) / name
        target.unlink()
        target.symlink_to(outside)
        assert c.get(f"/api/attachments/{tid}/{name}").status_code == 404
        assert outside.read_text(encoding="utf-8") == "private\n"


def test_the_read_route_changes_NO_state(home: Path) -> None:
    """Read-only, pinned as a property rather than asserted by inspection: the store's contents and
    the thread's persisted parts are byte-identical across a read, a refused read and a HEAD."""
    with make_client() as c:
        tid, name = _claim_one(c, "kept.png", png_bytes())
        before = (stored(home, tid), staged(home), parts_of(c, tid))
        c.get(f"/api/attachments/{tid}/{name}")
        c.get(f"/api/attachments/{tid}/absent.png")
        c.head(f"/api/attachments/{tid}/{name}")
        assert (stored(home, tid), staged(home), parts_of(c, tid)) == before


# ── the part union stayed ADDITIVE ────────────────────────────────────────────────────────────────


def test_an_old_message_row_still_loads_with_the_union_grown(home: Path) -> None:
    """Adding a member to a DISCRIMINATED union is additive by construction — pinned anyway, because
    a message row that stops loading is a conversation the owner loses."""
    from app.domain.conversation import AttachmentPart, Message, TextPart, Thread

    with make_client() as c:
        state = c.app.state
        thread = run_async(state.threads.create(Thread()))
        legacy = Message(thread_id=thread.id, role="user", parts=[TextPart(text="from before")])
        run_async(state.messages.add(legacy))
        modern = Message(
            thread_id=thread.id,
            role="user",
            parts=[
                AttachmentPart(kind="pdf", name="a.pdf", mime="application/pdf", path=f"{thread.id}/a.pdf")
            ],
        )
        run_async(state.messages.add(modern))
        rows = run_async(state.messages.list(thread.id))
        assert [type(p).__name__ for m in rows for p in m.parts] == ["TextPart", "AttachmentPart"]
        assert rows[1].attachments()[0].bytes == 0  # the defaults survive a round trip


# ── the architecture guard, extended over the new route (SECURITY_MODEL §2.7) ─────────────────────


def test_the_attachment_surface_accepts_no_post_and_no_multipart(home: Path) -> None:
    """The D65 negative, extended (O-M9): a cross-origin form CAN send a safelisted `POST`, and
    `multipart/form-data` is safelisted — so an upload route in either shape would be reachable from
    any page on the internet. Neither exists here.

    The OpenAPI schema enumerates every DECLARED method; the LIVE route walk (recursive — the table
    is a tree of include wrappers) sees the `include_in_schema=False` routes the schema cannot, and
    its harvest is asserted NON-EMPTY because a pin matching no routes is the very defect being
    repaired (S1 LOW-3).

    `get` joins the allowed set at S3 (the read mount, §8) and changes nothing about the property:
    a `GET` is safelisted and therefore carries no CSRF weight either way — what must never appear
    is a POST or a multipart body, which is what a cross-origin page can actually send."""
    with make_client() as c:
        paths = c.app.openapi()["paths"]
        for path, ops in paths.items():
            if path.startswith("/api/attachments"):
                assert set(ops) <= {"put", "get"}, (path, sorted(ops))
        guarded = [r for r in iter_live_routes(c.app.router) if r[0].startswith("/api/attachments")]
        assert guarded, "the live route walk found NO /api/attachments routes — the pin tests nothing"
        for path, methods, route in guarded:
            assert "POST" not in methods, (path, sorted(methods))
            assert not declares_multipart(route), path
        assert c.post(f"{URL}/a.png", content=png_bytes()).status_code in (404, 405)
        assert c.post(f"{URL}/a.png", files={"file": ("a.png", png_bytes(), "image/png")}).status_code in (
            404,
            405,
        )
        # …and no preflight is answered: the non-safelisted PUT is a control only because it dies.
        pre = c.options(
            f"{URL}/a.png",
            headers={"origin": "https://evil.example", "access-control-request-method": "PUT"},
        )
        assert "access-control-allow-origin" not in {k.lower() for k in pre.headers}

    src = (APP_DIR / "api" / "attachments.py").read_text(encoding="utf-8")
    for token in ("UploadFile", "File(", "Form(", "router.post"):
        assert token not in src, f"{token} in api/attachments.py — uploads are raw-body PUT only (D68)"
