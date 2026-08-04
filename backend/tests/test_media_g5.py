"""G5 — the owner media surface: the hardened read-only mount + the JSON index (D52, GACHA_PLAN §10.4).

The §10.4 obligation list, one test each: missing dir at boot, traversal attempts, the extension
allowlist + `nosniff`, HEAD + 304 revalidation, route ordering vs the SPA fallback, index sort
determinism (natural, so `2.png` precedes `10.png`), and the magic-byte reader catching a mislabeled
extension. Plus the config half: `themes.gacha` defaults cleanly on a config that predates it, refuses
a role typo, and round-trips through the ordinary `PUT /api/settings`.

Config writes go to a temp `CTRLB_CONFIG`/`CTRLB_DB` — never the operator's real config.yaml.

Image fixtures are built from HEADER BYTES, not real encodings: the reader under test never decodes,
so a valid header is the whole surface and a hand-built one lets a test state the exact dimensions
it is asserting on.
"""

from __future__ import annotations

import os
import struct
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.media import MediaFiles
from app.config import GachaThemeCfg, Settings
from app.core.media import ensure_media_dirs, ns_dir, probe_image, sort_key

# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

_SEED = "server:\n  port: 5433\ncomputers:\n  alpha:\n    ip: 192.168.1.10\n"


def png_bytes(w: int = 4, h: int = 3) -> bytes:
    """PNG signature + a well-formed IHDR — everything the reader looks at."""
    ihdr = b"IHDR" + struct.pack(">II", w, h) + b"\x08\x06\x00\x00\x00"
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + ihdr + b"\x00" * 4


def jpeg_bytes(w: int = 8, h: int = 6) -> bytes:
    """SOI + a JFIF APP0 the reader must SKIP + the SOF0 that actually carries the size."""
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 11
    sof0 = b"\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", h, w) + b"\x03" + b"\x00" * 9
    return b"\xff\xd8" + app0 + sof0


def webp_bytes(w: int = 12, h: int = 10) -> bytes:
    """RIFF/WEBP with a VP8X chunk (the extended flavor: canvas size as two 3-byte LE minus-ones)."""
    chunk = b"VP8X" + struct.pack("<I", 10)
    chunk += b"\x00" * 4 + (w - 1).to_bytes(3, "little") + (h - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


@pytest.fixture
def home(tmp_path, monkeypatch) -> Path:
    """A temp `$CTRLB_HOME` with its own config + db, so nothing touches the real ones."""
    h = tmp_path / "home"
    h.mkdir()
    cfg = h / "config.yaml"
    cfg.write_text(_SEED, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(h))
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(h / "t.db"))
    return h


def make_client(spa_dist: Path | None = None) -> TestClient:
    """The app, optionally WITH the prod SPA fallback registered (the route-ordering test needs it)."""
    import app.main as main

    if spa_dist is not None:
        (spa_dist / "assets").mkdir(parents=True, exist_ok=True)
        (spa_dist / "index.html").write_text("<!doctype html><title>ctrl-b</title>", encoding="utf-8")
        main._FRONTEND_DIST = spa_dist  # restored by the monkeypatch in `spa_client`
    return TestClient(main.create_app())


def role(home: Path, name: str) -> Path:
    return ns_dir(home, "gacha") / name


# ── ① the ensure-dir (§10.4 detail ①) ─────────────────────────────────────────────────────────────


def test_staticfiles_refuses_a_missing_directory(tmp_path) -> None:
    """The reason the ensure-dir exists, stated as a test: `check_dir=True` raises at CONSTRUCTION,
    so without the startup ensure a fresh install could not even build the app."""
    with pytest.raises(RuntimeError):
        MediaFiles(directory=tmp_path / "not-there", roles=("characters",))


def test_role_dirs_are_created_at_app_construction(home: Path) -> None:
    """A boot with no `media/` at all creates every role folder and serves an empty index."""
    assert not (home / "media").exists()
    with make_client() as c:
        assert sorted(p.name for p in ns_dir(home, "gacha").iterdir()) == [
            "banner",
            "characters",
            "oracle",
            "reel",
            "wallpaper",
        ]
        body = c.get("/api/media/gacha").json()
        assert body["ns"] == "gacha"
        assert body["collation"] == "casefold-natural"
        assert body["roles"] == {r: [] for r in ("characters", "banner", "wallpaper", "reel", "oracle")}
        assert body["slots"] == {}


def test_unknown_namespace_is_404(home: Path) -> None:
    with make_client() as c:
        assert c.get("/api/media/frontier").status_code == 404


# ── ② traversal ───────────────────────────────────────────────────────────────────────────────────


def test_traversal_attempts_never_escape_the_role_root(home: Path) -> None:
    """Starlette normalises + realpath-contains, and the allowlist 404s anything that is not an
    allowed image extension — so every shape of "give me the config" is a 404, not a leak."""
    with make_client() as c:
        (role(home, "characters") / "a.png").write_bytes(png_bytes())
        for attack in (
            "/api/media/gacha/files/../../config.yaml",
            "/api/media/gacha/files/%2e%2e%2f%2e%2e%2fconfig.yaml",
            "/api/media/gacha/files/....//....//config.yaml",
            "/api/media/gacha/files/characters/../../../config.yaml",
            "/api/media/gacha/files//etc/passwd",
        ):
            r = c.get(attack)
            assert r.status_code == 404, f"{attack} → {r.status_code}"
            assert "computers" not in r.text
        # the sanity control: the legitimate file right beside those attempts does serve
        assert c.get("/api/media/gacha/files/characters/a.png").status_code == 200


def test_only_registered_role_paths_are_served(home: Path) -> None:
    """Codex F1 — the SHAPE gate. Containment says the path stayed under the namespace root; it says
    nothing about where. Anything the owner parked BESIDE the role folders was servable while appearing
    in no listing, which is the worst combination: public and invisible."""
    ns = ns_dir(home, "gacha")
    with make_client() as c:
        (ns / "loose.png").write_bytes(png_bytes())  # dropped at the namespace root
        (ns / "private").mkdir()
        (ns / "private" / "secret.png").write_bytes(png_bytes())
        (role(home, "characters") / "nested").mkdir()
        (role(home, "characters") / "nested" / "deep.png").write_bytes(png_bytes())
        for path in ("loose.png", "private/secret.png", "characters/nested/deep.png"):
            assert c.get(f"/api/media/gacha/files/{path}").status_code == 404, path
        # …and none of them is advertised either
        body = c.get("/api/media/gacha").json()
        assert body["roles"]["characters"] == []
        assert "private" not in body["roles"]
        # the control: a file in a REGISTERED role still serves
        (role(home, "characters") / "ok.png").write_bytes(png_bytes())
        assert c.get("/api/media/gacha/files/characters/ok.png").status_code == 200


@pytest.mark.parametrize("level", ["root", "namespace", "role"])
def test_a_symlinked_media_path_DISABLES_the_namespace_without_bricking_the_app(
    home: Path, tmp_path, level: str
) -> None:
    """Codex F1 + W2. A symlink on the media spine RELOCATES the serving root rather than escaping it,
    so every containment check downstream then approves the link's target — it must not be served.

    But it must not take the PANEL down either: this runs after the exit-78 config preflight, so
    raising would surface as an ordinary uvicorn failure that `Restart=on-failure` retries every 5s.
    The namespace is disabled, the app boots, and the reason is available where it can be acted on.
    """
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "secret.png").write_bytes(png_bytes())

    link = {
        "root": home / "media",
        "namespace": ns_dir(home, "gacha"),
        "role": role(home, "characters"),
    }[level]
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(elsewhere, target_is_directory=True)

    assert ensure_media_dirs(home)["gacha"].ok is False
    with make_client() as c:
        body = c.get("/api/media/gacha").json()
        assert body["disabled"] is True
        assert "symlink" in body["reason"] and str(link) in body["reason"]
        assert body["roles"] == {}
        # NOT MOUNTED: the link's target is unreachable, and so is everything else under it
        assert c.get("/api/media/gacha/files/characters/secret.png").status_code == 404
        # …and the rest of the app is fine
        assert c.get("/api/health").status_code == 200


def test_a_file_where_a_role_folder_belongs_DISABLES_the_namespace(home: Path) -> None:
    """Codex W2(a) — `mkdir` raised an uncaught `FileExistsError` on this, which is how a single stray
    file could crash-loop the panel. It is now one disabled namespace with a sentence about it."""
    ns_dir(home, "gacha").mkdir(parents=True)
    (ns_dir(home, "gacha") / "reel").write_text("not a folder", encoding="utf-8")

    assert ensure_media_dirs(home)["gacha"].ok is False
    with make_client() as c:
        body = c.get("/api/media/gacha").json()
        assert body["disabled"] is True
        assert "reel" in body["reason"] and "directory" in body["reason"]
        assert c.get("/api/health").status_code == 200


def test_a_healthy_namespace_is_unaffected_and_says_so(home: Path) -> None:
    """The other half of the rule: an ordinary tree boots, reports healthy, and carries no disabled
    flag — including on the second boot, when everything already exists."""
    assert ensure_media_dirs(home)["gacha"].ok is True
    assert ensure_media_dirs(home)["gacha"].reason == ""
    with make_client() as c:
        (role(home, "characters") / "a.png").write_bytes(png_bytes())
        body = c.get("/api/media/gacha").json()
        assert body["disabled"] is False
        assert body["reason"] == ""
        assert [f["file"] for f in body["roles"]["characters"]] == ["a.png"]
        assert c.get("/api/media/gacha/files/characters/a.png").status_code == 200


def test_symlinked_FILES_inside_a_role_are_neither_listed_nor_served(home: Path, tmp_path) -> None:
    """Codex W1 — the hole the namespace-root containment could not see: a link INSIDE a role whose
    target is also inside the namespace passed both `follow_symlink=False` and the two-segment shape
    gate. Owner drops are real files; a link is not a supported shape at any level.

    Index and mount are asserted TOGETHER, in one test, because the only thing worse than either being
    wrong is the two disagreeing: a listing that promises what the mount refuses (or hides what it
    serves) is a bug in whichever one you did not read.
    """
    outside = tmp_path / "outside.png"
    outside.write_bytes(png_bytes())
    with make_client() as c:
        chars, reel = role(home, "characters"), role(home, "reel")
        (chars / "real.png").write_bytes(png_bytes())
        (reel / "cut.png").write_bytes(png_bytes())
        (ns_dir(home, "gacha") / "loose.png").write_bytes(png_bytes())

        (chars / "to-other-role.png").symlink_to(reel / "cut.png")  # another role's file
        (chars / "to-namespace.png").symlink_to(ns_dir(home, "gacha") / "loose.png")  # beside the roles
        (chars / "to-outside.png").symlink_to(outside)  # right out of the tree
        (chars / "to-nowhere.png").symlink_to(chars / "gone.png")  # dangling

        listed = [f["file"] for f in c.get("/api/media/gacha").json()["roles"]["characters"]]
        assert listed == ["real.png"]
        for name in ("to-other-role.png", "to-namespace.png", "to-outside.png", "to-nowhere.png"):
            assert c.get(f"/api/media/gacha/files/characters/{name}").status_code == 404, name
        # the agreement, stated as such: everything the index lists is servable, and nothing else is
        assert c.get("/api/media/gacha/files/characters/real.png").status_code == 200


# ── ③ the Content-Type allowlist + nosniff ────────────────────────────────────────────────────────


def test_disallowed_extensions_404_and_are_never_listed(home: Path) -> None:
    """The §10.4 hole: an owner-dropped `evil.html` served as same-origin text/html would be stored
    XSS on a boundary with no auth. It is neither served nor advertised."""
    chars = role(home, "characters")
    with make_client() as c:
        chars.mkdir(parents=True, exist_ok=True)
        (chars / "evil.html").write_text("<script>fetch('/api/settings')</script>", encoding="utf-8")
        (chars / "evil.svg").write_text("<svg onload='alert(1)'/>", encoding="utf-8")
        (chars / "notes.txt").write_text("not art", encoding="utf-8")
        (chars / "ok.png").write_bytes(png_bytes())
        for name in ("evil.html", "evil.svg", "notes.txt"):
            assert c.get(f"/api/media/gacha/files/characters/{name}").status_code == 404
        listed = [f["file"] for f in c.get("/api/media/gacha").json()["roles"]["characters"]]
        assert listed == ["ok.png"]


def test_served_headers_are_the_allowlisted_type_plus_nosniff_and_no_cache(home: Path) -> None:
    with make_client() as c:
        (role(home, "characters") / "a.png").write_bytes(png_bytes())
        (role(home, "banner") / "b.webp").write_bytes(webp_bytes())
        (role(home, "reel") / "c.jpg").write_bytes(jpeg_bytes())
        for url, ctype in (
            ("/api/media/gacha/files/characters/a.png", "image/png"),
            ("/api/media/gacha/files/banner/b.webp", "image/webp"),
            ("/api/media/gacha/files/reel/c.jpg", "image/jpeg"),
        ):
            r = c.get(url)
            assert r.status_code == 200
            assert r.headers["content-type"] == ctype
            assert r.headers["x-content-type-options"] == "nosniff"
            assert r.headers["cache-control"] == "no-cache"


# ── ④ HEAD + 304 revalidation ─────────────────────────────────────────────────────────────────────


def test_head_and_conditional_get_revalidate_cheaply(home: Path) -> None:
    """`no-cache` means REVALIDATE, not "never cache": the second request must be a ~200-byte 304 that
    still carries the cache directive (the client's SW `StaleWhileRevalidate` posture depends on it)."""
    with make_client() as c:
        (role(home, "characters") / "a.png").write_bytes(png_bytes())
        url = "/api/media/gacha/files/characters/a.png"
        head = c.head(url)
        assert head.status_code == 200
        assert head.content == b""
        assert head.headers["content-type"] == "image/png"

        first = c.get(url)
        etag = first.headers["etag"]
        again = c.get(url, headers={"if-none-match": etag})
        assert again.status_code == 304
        assert again.content == b""
        assert again.headers["cache-control"] == "no-cache"
        assert again.headers["x-content-type-options"] == "nosniff"
        assert "content-type" not in again.headers  # a 304 has no body to type
        stamped = c.get(url, headers={"if-modified-since": first.headers["last-modified"]})
        assert stamped.status_code == 304


# ── ⑤ route ordering vs the SPA fallback ──────────────────────────────────────────────────────────


@pytest.fixture
def spa_client(home: Path, tmp_path, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "_FRONTEND_DIST", tmp_path / "dist")
    return make_client(spa_dist=tmp_path / "dist")


def test_media_routes_win_over_the_spa_catch_all(spa_client: TestClient, home: Path) -> None:
    """With the prod fallback registered, `/{full_path:path}` would happily answer every media URL
    with index.html (200) if the ordering ever regressed. Both halves must beat it."""
    with spa_client as c:
        (role(home, "characters") / "a.png").write_bytes(png_bytes())
        img = c.get("/api/media/gacha/files/characters/a.png")
        assert img.headers["content-type"] == "image/png"
        assert not img.text.startswith("<!doctype")
        idx = c.get("/api/media/gacha")
        assert idx.headers["content-type"].startswith("application/json")
        # …and a media URL that does NOT resolve is still a 404, never the SPA shell
        miss = c.get("/api/media/gacha/files/characters/missing.png")
        assert miss.status_code == 404
        assert "ctrl-b" not in miss.text
        assert c.get("/somepage").status_code == 200  # the fallback itself is untouched


# ── ⑥ the collation ───────────────────────────────────────────────────────────────────────────────


def test_sort_key_is_casefold_natural() -> None:
    """Digit runs compare numerically and sort before text runs; case is folded, with the exact
    filename as the tie-break so `a.png`/`A.png` have a fixed order rather than a filesystem one."""
    names = ["10.png", "2.png", "B.png", "a.png", "1-b.png", "1-a.png", "a1.png", "A.png"]
    assert sorted(names, key=sort_key) == [
        "1-a.png",
        "1-b.png",
        "2.png",
        "10.png",
        # the documented consequence of numbers-before-text: at the position where these two differ in
        # KIND (`1` vs `.png`), the digit run wins
        "a1.png",
        "A.png",
        "a.png",
        "B.png",
    ]


def test_index_default_order_is_the_collation(home: Path) -> None:
    with make_client() as c:
        for name in ("10.png", "2.png", "banner-b.png", "Banner-a.png"):
            (role(home, "characters") / name).write_bytes(png_bytes())
        listed = [f["file"] for f in c.get("/api/media/gacha").json()["roles"]["characters"]]
        assert listed == ["2.png", "10.png", "Banner-a.png", "banner-b.png"]


# ── ⑦ the magic-byte reader ───────────────────────────────────────────────────────────────────────


def test_probe_reads_dimensions_from_each_allowed_format(tmp_path) -> None:
    p = tmp_path / "x"
    p.write_bytes(png_bytes(640, 854))
    assert (probe_image(p).fmt, probe_image(p).width, probe_image(p).height) == ("png", 640, 854)
    p.write_bytes(jpeg_bytes(1240, 700))
    assert (probe_image(p).fmt, probe_image(p).width, probe_image(p).height) == ("jpeg", 1240, 700)
    p.write_bytes(webp_bytes(720, 1000))
    assert (probe_image(p).fmt, probe_image(p).width, probe_image(p).height) == ("webp", 720, 1000)
    p.write_bytes(b"<!doctype html><p>not art")
    assert probe_image(p).fmt is None


def test_a_malformed_jpeg_gives_up_instead_of_walking_the_whole_file(tmp_path) -> None:
    """The scan is bounded AND chunked (Codex F8): a malformed multi-megabyte file must not be walked
    end to end, and never a byte at a time, on every index request. Giving up means no format claim
    (Codex F3) — a file whose markers never reach an SOF is not a JPEG any browser will render."""
    p = tmp_path / "x.jpg"
    p.write_bytes(b"\xff\xd8\xff" + b"\xff" * (4 << 20))
    started = time.perf_counter()
    probe = probe_image(p)
    elapsed = time.perf_counter() - started
    assert (probe.fmt, probe.width, probe.height) == (None, None, None)
    # Generous by two orders of magnitude — it is the SHAPE of the cost being pinned (bounded + chunked),
    # not a benchmark. The byte-at-a-time version took ~1M single-byte reads to reach the same answer.
    assert elapsed < 1.0


@pytest.mark.parametrize(
    ("label", "data"),
    [
        ("png signature only", b"\x89PNG\r\n\x1a\n"),
        ("png truncated ihdr", b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + b"\x00\x00"),
        ("png missing ihdr", b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"tEXt" + b"\x00" * 12),
        ("jpeg soi only", b"\xff\xd8\xff"),
        ("jpeg no sof", b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 11),
        ("jpeg truncated sof", b"\xff\xd8" + b"\xff\xc0" + struct.pack(">H", 17) + b"\x08\x00"),
        ("jpeg bad length", b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 1) + b"junk"),
        ("webp riff only", b"RIFF" + struct.pack("<I", 4) + b"WEBP"),
        ("webp unknown chunk", b"RIFF" + struct.pack("<I", 20) + b"WEBP" + b"XXXX" + b"\x00" * 12),
        ("webp truncated vp8x", b"RIFF" + struct.pack("<I", 14) + b"WEBP" + b"VP8X" + struct.pack("<I", 10)),
        ("webp vp8 no sync", b"RIFF" + struct.pack("<I", 20) + b"WEBP" + b"VP8 " + b"\x00" * 12),
        # ── W3: MID-truncation. Each of these has a plausible-looking start and then stops inside the
        # structure it declared — the shape a half-finished `scp` leaves behind.
        (
            "png ihdr without its crc",
            b"\x89PNG\r\n\x1a\n"
            + struct.pack(">I", 13)
            + b"IHDR"
            + struct.pack(">II", 640, 854)
            + b"\x08\x06\x00\x00\x00",  # 29 bytes: data complete, CRC missing
        ),
        (
            "jpeg sof shorter than its declared length",
            b"\xff\xd8" + b"\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", 700, 1240),
        ),
        (
            "webp riff size larger than the file",
            b"RIFF"
            + struct.pack("<I", 9999)
            + b"WEBP"
            + b"VP8X"
            + struct.pack("<I", 10)
            + b"\x00" * 4
            + (719).to_bytes(3, "little")
            + (999).to_bytes(3, "little"),
        ),
        (
            "webp chunk larger than its riff",
            b"RIFF" + struct.pack("<I", 22) + b"WEBP" + b"VP8X" + struct.pack("<I", 9999) + b"\x00" * 10,
        ),
        # ── R1: DEGENERATE lengths. Not truncation — the file is long enough — but the header declares
        # a segment/chunk too small to hold the fields the parser would then read past the end of.
        (
            "jpeg sof declaring a 2-byte segment",
            b"\xff\xd8"
            + b"\xff\xc0"
            + struct.pack(">H", 2)  # the length field and nothing else
            + b"\x08"
            + struct.pack(">HH", 700, 1240)  # …so these bytes are NOT part of the frame header
            + b"\x03"
            + b"\x00" * 9,
        ),
        (
            "webp vp8x declaring an empty chunk",
            b"RIFF"
            + struct.pack("<I", 12)
            + b"WEBP"
            + b"VP8X"
            + struct.pack("<I", 0)  # …so the canvas bytes below are not the chunk's payload
            + b"\x00" * 4
            + (719).to_bytes(3, "little")
            + (999).to_bytes(3, "little"),
        ),
        (
            "webp vp8l declaring an empty chunk",
            b"RIFF"
            + struct.pack("<I", 12)
            + b"WEBP"
            + b"VP8L"
            + struct.pack("<I", 0)
            + b"\x2f"
            + b"\x00" * 4,
        ),
    ],
)
def test_a_signature_is_not_a_format(tmp_path, label: str, data: bytes) -> None:
    """Codex F3 — a format claim requires the COMPLETE required header. A signature with nothing behind
    it is a truncated file no browser will render; calling it usable would put a permanently broken
    image in the roster with nothing to explain it. Unusable + a warning is the only actionable answer."""
    p = tmp_path / "x"
    p.write_bytes(data)
    assert probe_image(p).fmt is None, label


def test_truncated_drops_are_listed_as_unusable(home: Path) -> None:
    """…and that verdict reaches the gallery: still listed (the owner has to SEE the file to fix it),
    flagged, with the warning that says why."""
    with make_client() as c:
        (role(home, "characters") / "stub.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        entry = c.get("/api/media/gacha").json()["roles"]["characters"][0]
        assert (entry["format"], entry["unusable"], entry["warnings"]) == (None, True, ["unreadable"])


def test_mislabeled_extension_is_flagged_unusable(home: Path) -> None:
    """A JPEG named `.png` is served as image/png under `nosniff` ⇒ a guaranteed broken image. The
    index is the only place that can notice, because the mount trusts the extension by design."""
    with make_client() as c:
        (role(home, "characters") / "liar.png").write_bytes(jpeg_bytes(10, 10))
        (role(home, "characters") / "empty.webp").write_bytes(b"")
        by_name = {f["file"]: f for f in c.get("/api/media/gacha").json()["roles"]["characters"]}
        liar = by_name["liar.png"]
        assert (liar["format"], liar["unusable"], liar["warnings"]) == ("jpeg", True, ["format-mismatch"])
        empty = by_name["empty.webp"]
        assert (empty["format"], empty["unusable"], empty["warnings"]) == (None, True, ["unreadable"])


def test_oversize_files_carry_gallery_warnings(home: Path) -> None:
    """The §10.4 gallery hint ("3000x4257, 3.6 MB — consider resizing"). Advisory only: the file is
    still listed and still served."""
    with make_client() as c:
        big = png_bytes(3000, 4257) + b"\x00" * 1_600_000
        (role(home, "characters") / "atlas.png").write_bytes(big)
        entry = c.get("/api/media/gacha").json()["roles"]["characters"][0]
        assert entry["unusable"] is False
        assert sorted(entry["warnings"]) == ["dimensions", "oversize"]
        assert (entry["width"], entry["height"]) == (3000, 4257)
        assert c.get(entry["url"]).status_code == 200


def test_a_replaced_file_changes_its_revision_but_not_its_url(home: Path) -> None:
    """Codex F6 — owner files are mutable IN PLACE, so the URL cannot be their identity. The URL must
    stay stable (the SW's media cache is keyed on it); `revision` is what says the bytes changed, so a
    consumer that latched something about the old file can tell it is looking at a new one."""
    with make_client() as c:
        art = role(home, "reel") / "cut.png"
        art.write_bytes(png_bytes(10, 10))
        first = c.get("/api/media/gacha").json()["roles"]["reel"][0]
        assert first["revision"]

        os.utime(art, ns=(1_000_000_000, 2_000_000_000))  # a deterministic "later" mtime
        art.write_bytes(png_bytes(20, 20) + b"\x00")  # same NAME, different bytes
        os.utime(art, ns=(3_000_000_000, 4_000_000_000))
        second = c.get("/api/media/gacha").json()["roles"]["reel"][0]

        assert second["url"] == first["url"]
        assert second["revision"] != first["revision"]


def test_urls_are_percent_encoded(home: Path) -> None:
    """Owner filenames really do carry spaces (their own drops live in `banner images/`)."""
    with make_client() as c:
        (role(home, "banner") / "b 2#a.png").write_bytes(png_bytes())
        entry = c.get("/api/media/gacha").json()["roles"]["banner"][0]
        assert entry["url"] == "/api/media/gacha/files/banner/b%202%23a.png"
        assert c.get(entry["url"]).status_code == 200


# ── ⑧ the config block ────────────────────────────────────────────────────────────────────────────


def test_absent_themes_section_loads_as_defaults() -> None:
    """The house gotcha: `Settings` is extra-tolerant, so a config written before G5 must default
    cleanly rather than 422 — that is what keeps the theme byte-identical until the gallery is used."""
    s = Settings.model_validate({"server": {"port": 5433}})
    assert s.themes.gacha.roles == {}
    assert s.themes.gacha.slots.reel_figure is None
    assert s.themes.overrides("gacha") == ({}, {})


def test_unknown_theme_blocks_round_trip_untyped() -> None:
    """`extra="allow"`: a theme this build has no model for survives a load/save cycle, and asking for
    its overrides is empty rather than an error."""
    s = Settings.model_validate({"themes": {"frontier": {"rigs": ["a.png"]}}})
    assert s.model_dump()["themes"]["frontier"] == {"rigs": ["a.png"]}
    assert s.themes.overrides("frontier") == ({}, {})


def test_role_typos_and_path_shaped_order_entries_are_refused() -> None:
    for bad in (
        {"roles": {"charcters": {"order": ["a.png"]}}},
        {"roles": {"characters": {"order": ["../../config.yaml"]}}},
        {"roles": {"characters": {"order": [".."]}}},
        {"roles": {"characters": {"order": ["sub\\a.png"]}}},
        {"roles": {"characters": {"order": ["  "]}}},
    ):
        with pytest.raises(ValueError):
            GachaThemeCfg.model_validate(bad)


def test_configured_order_and_slots_drive_the_index(home: Path) -> None:
    """The gallery's override, end to end through the ordinary settings PUT: named files come first in
    the owner's order, everything else follows in the collation, a name whose file is gone is ignored,
    and the slot pins are echoed for the client resolver."""
    with make_client() as c:
        for name in ("a.png", "b.png", "c.png"):
            (role(home, "characters") / name).write_bytes(png_bytes())
        r = c.put(
            "/api/settings",
            json={
                "themes": {
                    "gacha": {
                        "roles": {"characters": {"order": ["c.png", "gone.png", "a.png"]}},
                        "slots": {"reel_figure": "lyra", "wallpaper": ""},
                    }
                }
            },
        )
        assert r.status_code == 200, r.text
        body = c.get("/api/media/gacha").json()
        assert [f["file"] for f in body["roles"]["characters"]] == ["c.png", "a.png", "b.png"]
        # blank pins are not pins — only the real one reaches the client
        assert body["slots"] == {"reel_figure": "lyra"}
        # …and it survives a reload from disk
        assert "gacha" in Settings.model_validate({}).model_dump()["themes"]
        reloaded = c.get("/api/settings").json()["themes"]["gacha"]
        assert reloaded["roles"]["characters"]["order"] == ["c.png", "gone.png", "a.png"]


def test_a_bad_theme_patch_is_a_422_not_a_500(home: Path) -> None:
    with make_client() as c:
        r = c.put("/api/settings", json={"themes": {"gacha": {"roles": {"nope": {"order": []}}}}})
        assert r.status_code == 422, r.text
