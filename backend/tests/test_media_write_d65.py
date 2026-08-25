"""D65 / MEDIA_MANAGER_PLAN S1 — the typed media WRITE path: `PUT`/`DELETE
/api/media/{ns}/files/{role}/{filename}`, raw body, never multipart, never POST.

The obligation list (plan §11), one test each: R55's pins (delete-vs-config · symlink 404 · double
delete · traversal/encoded-separator 404 · `.part` invisible to index AND mount) · the streamed cap
on both body kinds · 415 leaving zero bytes · `os.link`'s 409 · mode 0644 · the admission predicate
(`%FF`, DOS device names, NFC, edge dots, the 255-byte budget) · the boot sweep · **and the
architecture guard that makes the whole reversal safe: no CORS middleware, no POST/multipart upload
route** — the two changes that would silently remove the defence D65 rests on (SECURITY_MODEL §2.7).

Config writes go to a temp `CTRLB_CONFIG`/`CTRLB_DB` — never the operator's real config.yaml.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote

import pytest
from test_media_g5 import disk, home, jpeg_bytes, make_client, png_bytes, role, webp_bytes

from app.core.media import PART_PREFIX, PART_SUFFIX, admission_reason, sweep_part_files

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe

URL = "/api/media/gacha/files/characters"


# ── the happy path ────────────────────────────────────────────────────────────────────────────────


def test_a_put_stores_the_bytes_and_answers_with_the_index_row(home: Path) -> None:
    """201 + the same `MediaFile` shape the index emits, the file on disk, and the mount serving it.

    Asserted together on purpose: a write that lands but is not listed (or not servable) is the same
    class of bug as one that does not land — the three views must agree from the first request."""
    with make_client() as c:
        r = c.put(f"{URL}/lyra-2.png", content=png_bytes(640, 854))
        assert r.status_code == 201, r.text
        row = r.json()
        assert (row["name"], row["file"], row["format"]) == ("lyra-2", "lyra-2.png", "png")
        assert (row["width"], row["height"]) == (640, 854)
        assert (row["unusable"], row["bundled"], row["listed"], row["hidden"]) == (
            False,
            None,
            False,
            False,
        )
        assert row["revision"] and row["url"] == f"{URL}/lyra-2.png"

        path = role(home, "characters") / "lyra-2.png"
        assert path.read_bytes() == png_bytes(640, 854)
        assert disk(c.get("/api/media/gacha").json()["roles"]["characters"]) == ["lyra-2.png"]
        assert c.get(row["url"]).status_code == 200


@pytest.mark.skipif(os.name == "nt", reason="POSIX mode bits")
def test_the_stored_file_is_0644_not_the_mkstemp_0600(home: Path) -> None:
    """`mkstemp` creates at 0600 — right for a secret, wrong for art the mount reads back (and for the
    owner's own SSH session, which is how every other file in these folders arrives)."""
    with make_client() as c:
        assert c.put(f"{URL}/a.png", content=png_bytes()).status_code == 201
        assert (role(home, "characters") / "a.png").stat().st_mode & 0o777 == 0o644


@pytest.mark.parametrize(
    ("name", "body", "fmt"),
    [("a.png", png_bytes(), "png"), ("b.jpg", jpeg_bytes(), "jpeg"), ("c.webp", webp_bytes(), "webp")],
)
def test_every_allowlisted_format_round_trips(home: Path, name: str, body: bytes, fmt: str) -> None:
    with make_client() as c:
        r = c.put(f"{URL}/{name}", content=body)
        assert r.status_code == 201, r.text
        assert r.json()["format"] == fmt


# ── the cap (413), on both body kinds ─────────────────────────────────────────────────────────────


def _tiny_cap(c, limit: int) -> None:
    """Set `media.write.max_bytes` through the ordinary settings PUT — the tunable is config, so the
    test drives it the way the owner would rather than patching a constant (no magic numbers)."""
    r = c.put("/api/settings", json={"media": {"write": {"max_bytes": limit}}})
    assert r.status_code == 200, r.text


def test_an_oversize_body_is_413_and_leaves_nothing_behind(home: Path) -> None:
    with make_client() as c:
        _tiny_cap(c, 64)
        r = c.put(f"{URL}/big.png", content=png_bytes(1, 1) + b"\x00" * 4096)
        assert r.status_code == 413, r.text
        assert "max_bytes" in r.json()["detail"]
        assert list(role(home, "characters").iterdir()) == []  # no file, and no `.part` either


def test_a_CHUNKED_body_hits_the_same_cap(home: Path) -> None:
    """The counter is the cap, never `Content-Length`: a chunked upload sends no length at all, so a
    header-based check would wave this straight through (R55's arm, both body kinds)."""

    def chunks():
        yield png_bytes(1, 1)
        for _ in range(64):
            yield b"\x00" * 1024

    with make_client() as c:
        _tiny_cap(c, 64)
        r = c.put(f"{URL}/big.png", content=chunks())
        assert r.status_code == 413, r.text
        assert list(role(home, "characters").iterdir()) == []


def test_a_body_exactly_at_the_cap_is_accepted(home: Path) -> None:
    """The boundary, stated: the cap is a maximum, not a "less than". A file the owner was told is
    allowed must not fail on the byte that makes it exactly that size."""
    body = png_bytes(4, 3)
    with make_client() as c:
        _tiny_cap(c, len(body))
        assert c.put(f"{URL}/exact.png", content=body).status_code == 201


# ── the bytes gate (415) and the name gates (422 / 404) ───────────────────────────────────────────


def test_bytes_that_disagree_with_the_extension_are_415_and_leave_zero_bytes(home: Path) -> None:
    """The probe runs BEFORE the file has its final name (the persist ladder's whole point): the
    mount serves the Content-Type the EXTENSION claims under `nosniff`, so this file would have been
    a guaranteed broken image — and refusing it after writing it would be no refusal at all."""
    with make_client() as c:
        r = c.put(f"{URL}/liar.png", content=jpeg_bytes(10, 10))
        assert r.status_code == 415, r.text
        assert "jpeg" in r.json()["detail"]
        assert list(role(home, "characters").iterdir()) == []

        # …and so is a body that is not an image at all.
        assert c.put(f"{URL}/nope.png", content=b"<!doctype html>").status_code == 415
        assert list(role(home, "characters").iterdir()) == []


def test_an_empty_body_is_422(home: Path) -> None:
    with make_client() as c:
        assert c.put(f"{URL}/empty.png", content=b"").status_code == 422
        assert list(role(home, "characters").iterdir()) == []


def test_a_duplicate_name_is_409_and_never_overwrites(home: Path) -> None:
    """`os.link` is the no-clobber primitive AND the race guard (§2.5): the client mints unique names
    and retries with its next suffix, so this answer is a collision report, never a dialog — and the
    file that was already there is untouched."""
    with make_client() as c:
        first = png_bytes(4, 3)
        assert c.put(f"{URL}/a.png", content=first).status_code == 201
        r = c.put(f"{URL}/a.png", content=png_bytes(9, 9))
        assert r.status_code == 409, r.text
        assert (role(home, "characters") / "a.png").read_bytes() == first
        assert [p.name for p in role(home, "characters").iterdir()] == ["a.png"]


@pytest.mark.parametrize(
    "name",
    [
        "CON.png",  # a Windows device name, with any extension
        "nul.png",
        "no-extension",
        "art.gif",  # readable, and not on this surface's allowlist
        "art.svg",  # active content — refused on the read side too
        ".hidden.png",
        "trailing.png ",  # a trailing space is the shape Windows silently strips
        "trailing.png.",
        "we\\ird.png",  # a separator on the OTHER platform: admitted names must be portable
        'quote".png',
        "star*.png",
        "pipe|.png",
        "ctrl\x01.png",
        "décomposed.png",  # NFD — the same name a client would compute as NFC, spelled apart
        "x" * 260 + ".png",
    ],
)
def test_a_name_this_surface_may_not_mint_is_422_with_a_reason(home: Path, name: str) -> None:
    """Rejected WITH THE REASON, never sanitised (§3): the client's minter can act on "that name is
    reserved" and cannot act on a silently different filename coming back."""
    with make_client() as c:
        # Percent-encoded per segment, because some of these names cannot ride a URL literally (a
        # control character is not printable ASCII) — the server decodes the path before routing, so
        # this is the same request a real client makes.
        r = c.put(f"{URL}/{quote(name)}", content=png_bytes())
        assert r.status_code == 422, f"{name} → {r.status_code}"
        assert r.json()["detail"] == admission_reason(name)
        assert list(role(home, "characters").iterdir()) == []


def test_a_raw_undecodable_byte_in_the_name_is_422(home: Path) -> None:
    """`%FF` is not valid UTF-8, and the server decodes a request path with replacement — so the name
    that reaches the handler carries U+FFFD. That is why the replacement character is in the forbidden
    set: accepting it would persist a filename whose real bytes were already lost upstream, under a
    name no client could ever address again (the R55 pin)."""
    with make_client() as c:
        r = c.put(f"{URL}/a%FFb.png", content=png_bytes())
        assert r.status_code == 422, r.text
        assert "not allowed" in r.json()["detail"]
        assert list(role(home, "characters").iterdir()) == []


@pytest.mark.parametrize(
    "path",
    [
        # Percent-encoded separators: the server decodes the path BEFORE routing, so these arrive as
        # one segment carrying a `/` — which is exactly what the route refuses. (The un-encoded
        # `../../` form never reaches a server at all: every HTTP client normalises it away first,
        # and a raw one is this same string after decoding.)
        f"{URL}/%2e%2e%2f%2e%2e%2fconfig.yaml",
        f"{URL}/sub%2Fa.png",
        f"{URL}/%2e%2e",
        f"{URL}/nested/deep.png",
        "/api/media/gacha/files/characters/",
        "/api/media/gacha/files/nope/a.png",  # a role the registry does not know
        "/api/media/cosmos/files/characters/a.png",  # …nor the namespace
    ],
)
def test_a_path_shaped_or_unregistered_target_is_404(home: Path, path: str) -> None:
    """Containment is by REGISTRY, not by string handling: anything that does not resolve to
    `<known ns>/<known role>/<bare name>` is "not there" — the same answer a probe gets for a file
    that simply does not exist, and never a 405 from the static mount underneath."""
    with make_client() as c:
        r = c.put(path, content=png_bytes())
        assert r.status_code == 404, f"{path} → {r.status_code}"
        assert not (home / "config.yaml").read_text(encoding="utf-8").startswith("\x89PNG")


def test_a_disabled_namespace_refuses_writes(home: Path, tmp_path) -> None:
    """A namespace whose tree failed the boot shape check is NOT MOUNTED (W2), so a file written into
    it could never be served — the write is refused rather than left as an invisible orphan."""
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (home / "media" / "gacha").parent.mkdir(parents=True, exist_ok=True)
    (home / "media" / "gacha").symlink_to(elsewhere, target_is_directory=True)
    with make_client() as c:
        r = c.put(f"{URL}/a.png", content=png_bytes())
        assert r.status_code == 404
        assert "disabled" in r.json()["detail"]
        assert list(elsewhere.iterdir()) == []


# ── DELETE ────────────────────────────────────────────────────────────────────────────────────────


def test_delete_removes_the_file_and_a_second_delete_is_404(home: Path) -> None:
    with make_client() as c:
        assert c.put(f"{URL}/a.png", content=png_bytes()).status_code == 201
        r = c.delete(f"{URL}/a.png")
        assert r.status_code == 204 and r.content == b""
        assert not (role(home, "characters") / "a.png").exists()
        assert c.delete(f"{URL}/a.png").status_code == 404
        assert c.get(f"{URL}/a.png").status_code == 404


def test_delete_touches_no_config_and_the_dangling_entry_self_heals(home: Path) -> None:
    """R55's pin + §3's degrade path. DELETE is FILE-only: the client composes delete-then-config, and
    a cleanup that never happens (the app closed, the phone slept) must be harmless — the listing
    drops the dangling entry and the owner's remaining order is intact."""
    with make_client() as c:
        for name in ("a.png", "b.png"):
            assert c.put(f"{URL}/{name}", content=png_bytes()).status_code == 201
        c.put(
            "/api/settings",
            json={
                "media": {
                    "namespaces": {
                        "gacha": {"roles": {"characters": {"files": [{"name": "b.png"}, {"name": "a.png"}]}}}
                    }
                }
            },
        )
        assert c.delete(f"{URL}/b.png").status_code == 204

        cfg = c.get("/api/settings").json()["media"]["namespaces"]["gacha"]
        assert [i["name"] for i in cfg["roles"]["characters"]["files"]] == ["b.png", "a.png"]
        assert disk(c.get("/api/media/gacha").json()["roles"]["characters"]) == ["a.png"]


def test_delete_refuses_a_symlink_and_anything_the_index_would_not_serve(home: Path, tmp_path) -> None:
    """The delete gate is `is_served_file`, the SAME predicate the index and the mount use: a symlink
    inside a role is not a supported shape at any level of this tree, so it is not a thing this API
    can be aimed at — which also means the API cannot be used to unlink a link's target."""
    outside = tmp_path / "outside.png"
    outside.write_bytes(png_bytes())
    with make_client() as c:
        chars = role(home, "characters")
        (chars / "link.png").symlink_to(outside)
        (chars / "notes.txt").write_text("not art", encoding="utf-8")
        assert c.delete(f"{URL}/link.png").status_code == 404
        assert c.delete(f"{URL}/notes.txt").status_code == 404
        assert outside.exists() and (chars / "link.png").is_symlink()
        assert (chars / "notes.txt").exists()


# ── the `.part` temp file ─────────────────────────────────────────────────────────────────────────


def test_a_stranded_part_file_is_invisible_and_swept_at_boot(home: Path) -> None:
    """A crash mid-upload is the only way one of these survives (the route unlinks its own temp in a
    `finally`). It must be invisible while it is there — `.part` is not an allowlisted extension, so
    neither the index nor the mount can see it — and gone at the next boot."""
    chars = role(home, "characters")
    chars.mkdir(parents=True, exist_ok=True)
    stranded = chars / f"{PART_PREFIX}dead{PART_SUFFIX}"
    stranded.write_bytes(png_bytes())
    keep = chars / "real.png"
    keep.write_bytes(png_bytes())
    decoy = chars / "notes.part"  # an owner file that merely ENDS the same way — never swept
    decoy.write_text("mine", encoding="utf-8")

    with make_client() as c:
        assert disk(c.get("/api/media/gacha").json()["roles"]["characters"]) == ["real.png"]
        assert c.get(f"{URL}/{stranded.name}").status_code == 404
    assert not stranded.exists()
    assert keep.exists() and decoy.exists()


def test_the_sweep_skips_a_namespace_whose_tree_was_refused(home: Path, tmp_path) -> None:
    """It must never follow a symlink: a refused tree's "role dirs" may point anywhere, and a sweep
    that walked one would be deleting files outside `$CTRLB_HOME` entirely."""
    elsewhere = tmp_path / "elsewhere"
    (elsewhere / "characters").mkdir(parents=True)
    bait = elsewhere / "characters" / f"{PART_PREFIX}x{PART_SUFFIX}"
    bait.write_bytes(b"x")
    (home / "media").mkdir(parents=True, exist_ok=True)
    (home / "media" / "gacha").symlink_to(elsewhere, target_is_directory=True)

    with make_client():
        pass
    assert bait.exists()
    # …and the direct call agrees when the namespace is not in the healthy list it is given
    assert sweep_part_files(home, []) == 0


# ── the shared URL space: the write route must not shadow the read mount ──────────────────────────


def test_a_get_on_a_write_path_still_reaches_the_static_mount(home: Path) -> None:
    """The `Match.PARTIAL` property, pinned (§3). The router is registered BEFORE the mounts and its
    write route matches this path by PATH but not by METHOD; Starlette only falls back to a partial
    match when nothing FULLY matches. If that ever changes, every media image starts 405-ing."""
    with make_client() as c:
        assert c.put(f"{URL}/a.png", content=png_bytes()).status_code == 201
        got = c.get(f"{URL}/a.png")
        assert got.status_code == 200
        assert got.headers["content-type"] == "image/png"
        assert c.head(f"{URL}/a.png").status_code == 200
        # …and the mount's own 404 shape survives for a name that is not there
        assert c.get(f"{URL}/missing.png").status_code == 404


# ── the architecture guard: what must never appear (SECURITY_MODEL §2.7) ──────────────────────────


def test_no_cors_middleware_is_mounted_anywhere(home: Path) -> None:
    """**The defence D65 rests on is a NEGATIVE**: a non-safelisted verb forces a preflight, and the
    preflight dies because this app answers no `Access-Control-Allow-Origin`. Adding CORS middleware
    would remove that silently — no test would fail, no behaviour would look wrong, and a page on any
    origin could write files. So the absence is asserted, in the app's own middleware stack and in
    the source."""
    with make_client() as c:
        stack = [m.cls.__name__ for m in c.app.user_middleware]
        assert not any("CORS" in name for name in stack), stack
        # An OPTIONS preflight for a PUT must get no ACAO from us (Starlette answers 405; what matters
        # is the header that is absent).
        pre = c.options(
            f"{URL}/a.png",
            headers={"origin": "https://evil.example", "access-control-request-method": "PUT"},
        )
        assert "access-control-allow-origin" not in {k.lower() for k in pre.headers}

    app_dir = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        p.relative_to(app_dir).as_posix()
        for p in app_dir.rglob("*.py")
        if "CORSMiddleware" in p.read_text(encoding="utf-8")
    ]
    assert not offenders, (
        f"CORS middleware appeared in {offenders} — D65's write path is defended by the CORS "
        "PREFLIGHT, so this may not land without revisiting D65 + SECURITY_MODEL §2.7"
    )


def test_the_media_surface_accepts_no_post_and_no_multipart(home: Path) -> None:
    """The other half of the same negative: a cross-origin form CAN send a safelisted `POST` (CORS
    withholds the read-back, not the send), and `multipart/form-data` is safelisted — so an upload
    route in either shape would be reachable from any page on the internet. Neither exists."""
    with make_client() as c:
        for r in c.app.routes:
            path = getattr(r, "path", "")
            methods = getattr(r, "methods", None)  # a Mount has none — it is the read-only surface
            if path.startswith("/api/media") and methods is not None:
                assert set(methods) <= {"GET", "HEAD", "PUT", "DELETE"}, (path, methods)
        assert c.post(f"{URL}/a.png", content=png_bytes()).status_code in (404, 405)
        assert c.post(
            "/api/media/gacha/files/characters",
            files={"file": ("a.png", png_bytes(), "image/png")},
        ).status_code in (404, 405)

    src = (Path(__file__).resolve().parents[1] / "app" / "api" / "media.py").read_text(encoding="utf-8")
    for token in ("UploadFile", "File(", "Form(", "router.post"):
        assert token not in src, f"{token} in api/media.py — uploads are raw-body PUT only (D65)"
