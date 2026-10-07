#!/usr/bin/env python3
"""The ASR reference corpus — promote debug captures into it, label them, list them, prune them
(Phase 26 S6-ii, ASR_PLAN §6.3; SECURITY_MODEL §2.12). Offline, never runtime: no code path in the app
reads the corpus.

Layout under `<home>/asr-corpus/` (dirs 0700, files 0600):

* `raw/<YYYYmmdd-HHMMSS>-<mode>-<route>-<lang>-<call8>-<leg>.wav` — 16 kHz pcm16 mono (ruling H5: the
  plan's name plus the call id's first 8 hex, so two calls with the same second, mode, route, language
  and leg cannot collide; and NO-CLOBBER on top — an existing clip is never replaced);
* `labels/<clip>.json` — the superset label (ruling H9): `{kind, tags, lang, route, route_key: null,
  intervals: []}`; D85-S2 fills `route_key` and `intervals`, the replay reads `kind`;
* `manifest.jsonl` — one line per promotion (the source, the sha256, the duration).

THE ROOT (ruling H10): `--home` or env `CTRLB_HOME`, REQUIRED — never the app's project-root fallback,
which would put the owner's audio inside the git workspace — and a destination inside a git work tree is
refused. The source of a promotion is `--from` (another instance's root, e.g. `~/.ctrl-b-dev`), default
the home itself. Audio is read ONLY through the shipped decode (`voice_prepass.decode_to_pcm16k`), which
also imports a crashed capture's `.wav.part` (all-ones sizes, a torn odd byte dropped); the clip is
written with the ONE WAV header helper (`core/audio.pcm16_wav_header`).

CONSENT (ruling H11, ASR_PLAN §6.3): the owner's own voice only — a clip that carries another person's
voice is deleted, never promoted. The tool cannot check that, so `promote` prints the rule and refuses to
run without `--owner-only`, the owner's acknowledgement. (D85-S2 adds `--broadcast` for the one admitted
class, broadcast media labelled `background` as a negative.) Push-to-talk clips are out of scope here
(ruling H13 — S9's `promote --file`).

Usage (the venv's python):

    backend/.venv/bin/python tools/asr_corpus.py [--home H] promote <call_id>-<leg> --owner-only
        [--label TAG]... [--kind positive|negative] [--from ROOT] [--lang xx]
    backend/.venv/bin/python tools/asr_corpus.py [--home H] label <clip> [--kind K] [--label TAG]...
    backend/.venv/bin/python tools/asr_corpus.py [--home H] list
    backend/.venv/bin/python tools/asr_corpus.py [--home H] prune --older-than DAYS

Exit codes: 0 = done · 1 = refused or failed (no such capture, an existing clip, a git work tree, an
undecodable file) · 2 = usage (no home, no `--owner-only`, no language, a malformed id).
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

# The checkout's OWN backend first (the `vad_replay.py` rule): the corpus is written by the code beside it.
_BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.core.audio import WAV_HEADER_BYTES, pcm16_wav_header  # noqa: E402
from app.core.fsutil import atomic_write_text, fsync_dir  # noqa: E402
from app.services.call_trail import CAPTURE_PART_SUFFIX, capture_name, valid_call_id  # noqa: E402
from app.services.voice_audio import MODEL_RATE, float32_to_pcm16  # noqa: E402

CORPUS_DIR = "asr-corpus"
RAW_DIR = "raw"
LABELS_DIR = "labels"
MANIFEST = "manifest.jsonl"
#: The decode's bounds for one capture: the longest leg (`max_session_s`' 7200 s ceiling) plus a minute.
MAX_DECODED_S = 7260.0
MAX_WALL_S = 600.0
KINDS = ("positive", "negative")
#: What a trail-sourced name part may hold (route, language): the trail is client-written, so anything
#: else becomes `unknown` rather than part of a file name.
_NAME_PART = re.compile(r"[A-Za-z0-9_]{1,32}")
_LANG = re.compile(r"[a-z]{2,3}")

CONSENT = (
    "ASR corpus consent (ASR_PLAN §6.3): the OWNER'S OWN VOICE ONLY. A capture that carries another\n"
    "person's voice (a passenger, a call on speaker) is deleted, never promoted. Broadcast media as a\n"
    "labelled `background` negative is D85-S2's `--broadcast`, not yet. Pass --owner-only to confirm."
)

EXIT_OK, EXIT_REFUSED, EXIT_USAGE = 0, 1, 2


class Refused(Exception):
    """An operation the tool will not perform — exit 1."""


class UsageError(Exception):
    """A missing or malformed argument — exit 2."""


def label_path(clip: Path) -> Path | None:
    """The label beside a corpus clip (`raw/<clip>.wav` → `labels/<clip>.json`), `None` outside `raw/` —
    the ONE spelling of the layout, read by `vad_replay.py` too."""
    return clip.parent.parent / LABELS_DIR / f"{clip.stem}.json" if clip.parent.name == RAW_DIR else None


def resolve_home(arg: str | None) -> Path:
    raw = arg or os.environ.get("CTRLB_HOME")
    if not raw:
        raise UsageError("no corpus root: pass --home or set CTRLB_HOME")
    return Path(raw).expanduser().resolve()


def _read_label(path: Path) -> dict[str, Any]:
    """A label JSON object — anything else (unparseable, not an object) is a one-line refusal naming the
    file, never a traceback (S6-ii wave 1)."""
    try:
        label = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        raise Refused(f"{path}: corrupt label (not JSON)") from None
    if not isinstance(label, dict):
        raise Refused(f"{path}: corrupt label (not an object)")
    return label


def _read_manifest(path: Path) -> list[tuple[str, dt.datetime, str]]:
    """`(line, promoted_at, clip)` per manifest line — a corrupt line is a one-line refusal naming the
    file and the line number, before anything is deleted."""
    out: list[tuple[str, dt.datetime, str]] = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            entry = json.loads(line)
            when = dt.datetime.fromisoformat(entry["promoted_at"])
            if when.tzinfo is None:  # the tool writes UTC-aware stamps; a naive one cannot be compared
                raise ValueError
            out.append((line, when, str(entry["clip"])))
        except ValueError, TypeError, KeyError:
            raise Refused(f"{path}:{n}: corrupt manifest line") from None
    return out


def refuse_git_tree(path: Path) -> None:
    """Refuse a destination inside a git work tree (ruling H10): the corpus is never committed."""
    for parent in (path, *path.parents):
        if (parent / ".git").exists():
            raise Refused(f"{path} is inside a git work tree ({parent})")


def _mkdirs(corpus: Path) -> None:
    # Owner-only at EVERY level, each in its own step (`mkdir(parents=True)` modes only the leaf).
    for d in (corpus, corpus / RAW_DIR, corpus / LABELS_DIR):
        d.mkdir(mode=0o700, parents=True, exist_ok=True)
        if os.name != "nt":
            d.chmod(0o700)


def _trail_meta(trail: Path, leg: int) -> dict[str, Any]:
    """What the leg's trail says: its `leg_start` time + language (relay) and its route (client
    `capture` for a call, `rec` for a dictation). Absent fields stay absent."""
    meta: dict[str, Any] = {}
    if not trail.is_file():
        return meta
    for line in trail.read_text(encoding="utf-8").splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict) or d.get("leg") != leg:
            continue
        if d.get("src") == "relay" and d.get("ev") == "leg_start" and "t" not in meta:
            meta["t"] = d.get("t")
            session = d.get("session") if isinstance(d.get("session"), dict) else {}
            iat = session.get("input_audio_transcription")
            if isinstance(iat, dict) and isinstance(iat.get("language"), str):
                meta["lang"] = iat["language"]
        elif d.get("src") == "client" and d.get("ev") in ("capture", "rec") and "route" not in meta:
            meta["route"] = d.get("route")
    return meta


def find_capture(source: Path, call_id: str, leg: int) -> tuple[Path, str]:
    """`<source>/calls/[dictation/]<call>-<leg>.wav`, else its `.part` — and the mode its directory says."""
    for mode, directory in (("call", source / "calls"), ("dictation", source / "calls" / "dictation")):
        final = directory / capture_name(call_id, leg)
        for candidate in (final, final.with_name(final.name + CAPTURE_PART_SUFFIX)):
            if candidate.is_file():
                return candidate, mode
    raise Refused(f"no capture {call_id}-{leg} under {source / 'calls'}")


def _write_no_clobber(path: Path, data: bytes) -> None:
    """Durable, no-clobber create (the attachments idiom): a same-dir temp (mkstemp ⇒ 0600) → fsync →
    `os.link` onto the final name (fails if it exists — never a replace) → dir fsync."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".wav")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(tmp, path)
        except FileExistsError:
            raise Refused(f"{path.name} already exists — never overwritten") from None
    finally:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
    fsync_dir(path.parent)


def _append_manifest(corpus: Path, entry: dict[str, Any]) -> None:
    fd = os.open(
        corpus / MANIFEST, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_BINARY", 0), 0o600
    )
    with os.fdopen(fd, "ab") as f:
        f.write((json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8"))
        f.flush()
        os.fsync(f.fileno())


def _write_label(path: Path, label: dict[str, Any]) -> None:
    atomic_write_text(path, json.dumps(label, indent=2, ensure_ascii=False) + "\n")


def cmd_promote(home: Path, args: argparse.Namespace) -> int:
    print(CONSENT)
    if not args.owner_only:
        raise UsageError("promote needs --owner-only (the consent rule above)")
    stem, _, leg_s = args.capture.rpartition("-")
    if not valid_call_id(stem) or not leg_s.isdigit():
        raise UsageError(f"not a <call_id>-<leg>: {args.capture!r}")
    leg = int(leg_s)
    corpus = home / CORPUS_DIR
    source = Path(args.source).expanduser().resolve() if args.source else home
    src, mode = find_capture(source, stem, leg)
    meta = _trail_meta(src.parent / f"{stem}.jsonl", leg)
    lang = args.lang or meta.get("lang") or ""
    if not _LANG.fullmatch(lang):
        raise UsageError("the trail names no language: pass --lang xx")
    route = meta.get("route")
    route = route if isinstance(route, str) and _NAME_PART.fullmatch(route) else "unknown"
    t = meta.get("t")
    when = (
        dt.datetime.fromtimestamp(t / 1000, dt.UTC)
        if isinstance(t, int) and not isinstance(t, bool)
        else dt.datetime.fromtimestamp(src.stat().st_mtime, dt.UTC)
    )
    clip = f"{when:%Y%m%d-%H%M%S}-{mode}-{route}-{lang}-{stem[:8]}-{leg}.wav"
    _mkdirs(corpus)
    dest = corpus / RAW_DIR / clip
    if dest.exists():
        raise Refused(f"{clip} already exists — never overwritten")

    # Imported here, not at the top: the decode pulls PyAV, which `list`/`label`/`prune` never need.
    from app.services.voice_prepass import DecodeAborted, UndecodableAudio, decode_to_pcm16k

    try:
        pcm = decode_to_pcm16k(src.read_bytes(), max_decoded_s=MAX_DECODED_S, max_wall_s=MAX_WALL_S)
    except (UndecodableAudio, DecodeAborted) as exc:
        raise Refused(f"{src.name}: cannot decode ({type(exc).__name__})") from None
    body = float32_to_pcm16(pcm)
    wav = pcm16_wav_header(len(body) // 2, MODEL_RATE) + body
    _write_no_clobber(dest, wav)
    lp = label_path(dest)
    assert lp is not None
    label = {
        "kind": args.kind,
        "tags": args.label,
        "lang": lang,
        "route": route,
        "route_key": None,
        "intervals": [],
    }
    _write_label(lp, label)
    _append_manifest(
        corpus,
        {
            "clip": clip,
            "promoted_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "source": {"root": str(source), "mode": mode, "call_id": stem, "leg": leg, "file": src.name},
            "sha256": hashlib.sha256(wav).hexdigest(),
            "duration_ms": len(body) // 2 * 1000 // MODEL_RATE,
            "rate": MODEL_RATE,
            "label": args.label,
            "kind": args.kind,
            "route": route,
            "lang": lang,
        },
    )
    print(f"promoted {src.name} → {dest}")
    return EXIT_OK


def _clip_path(corpus: Path, name: str) -> Path:
    clip = name if name.endswith(".wav") else f"{name}.wav"
    if Path(clip).name != clip or clip.startswith("."):
        raise UsageError(f"not a clip name: {name!r}")
    path = corpus / RAW_DIR / clip
    if not path.is_file():
        raise Refused(f"no clip {clip} in {corpus / RAW_DIR}")
    return path


def cmd_label(home: Path, args: argparse.Namespace) -> int:
    corpus = home / CORPUS_DIR
    path = _clip_path(corpus, args.clip)
    lp = label_path(path)
    assert lp is not None
    label: dict[str, Any] = {
        "kind": None,
        "tags": [],
        "lang": None,
        "route": None,
        "route_key": None,
        "intervals": [],
    }
    if lp.is_file():
        label |= _read_label(lp)
    if args.kind:
        label["kind"] = args.kind
    if args.label:
        label["tags"] = sorted(set(label.get("tags") or []) | set(args.label))
    _write_label(lp, label)
    print(json.dumps(label, ensure_ascii=False))
    return EXIT_OK


def cmd_list(home: Path, _args: argparse.Namespace) -> int:
    raw = home / CORPUS_DIR / RAW_DIR
    clips = sorted(raw.glob("*.wav")) if raw.is_dir() else []
    for clip in clips:
        lp = label_path(clip)
        label = _read_label(lp) if lp is not None and lp.is_file() else {}
        seconds = max(clip.stat().st_size - WAV_HEADER_BYTES, 0) / 2 / MODEL_RATE
        tags = ",".join(label.get("tags") or [])
        print(f"{clip.name}  {seconds:7.1f}s  {label.get('kind') or '-':<8}  {tags}")
    print(f"{len(clips)} clip(s) in {raw}")
    return EXIT_OK


def cmd_prune(home: Path, args: argparse.Namespace) -> int:
    """Delete clips (+ labels) promoted more than `--older-than` days ago and rewrite the manifest
    atomically (§6.3's deletion; `rm -r` of the directory is the other)."""
    corpus = home / CORPUS_DIR
    manifest = corpus / MANIFEST
    if not manifest.is_file():
        print("nothing to prune")
        return EXIT_OK
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(days=args.older_than)
    keep: list[str] = []
    gone = 0
    for line, promoted_at, name in _read_manifest(manifest):
        if promoted_at >= cutoff:
            keep.append(line)
            continue
        clip = corpus / RAW_DIR / Path(name).name
        for victim in (clip, label_path(clip)):
            if victim is not None:
                with contextlib.suppress(FileNotFoundError):
                    victim.unlink()
        gone += 1
    atomic_write_text(manifest, "".join(f"{line}\n" for line in keep))
    print(f"pruned {gone} clip(s); {len(keep)} kept")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="asr_corpus.py",
        description="The ASR reference corpus (ASR_PLAN §6.3) — owner's voice only.",
        epilog="exit codes: 0 done · 1 refused/failed · 2 usage",
    )
    ap.add_argument("--home", help="the corpus root's CTRLB_HOME (else env CTRLB_HOME; required)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("promote", help="copy a debug capture into the corpus")
    p.add_argument("capture", help="<call_id>-<leg>")
    p.add_argument("--owner-only", action="store_true", help="confirm: the owner's own voice only")
    p.add_argument("--label", action="append", default=[], metavar="TAG", help="a free tag (repeatable)")
    p.add_argument("--kind", choices=KINDS, default="positive")
    p.add_argument("--from", dest="source", metavar="ROOT", help="the capturing instance's CTRLB_HOME")
    p.add_argument("--lang", help="the spoken language (when the trail names none)")
    p = sub.add_parser("label", help="set a clip's kind / add tags")
    p.add_argument("clip")
    p.add_argument("--kind", choices=KINDS)
    p.add_argument("--label", action="append", default=[], metavar="TAG")
    sub.add_parser("list", help="list the clips")
    p = sub.add_parser("prune", help="delete clips promoted more than N days ago")
    p.add_argument("--older-than", type=float, required=True, metavar="DAYS")
    return ap


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as exc:
        return EXIT_OK if exc.code in (0, None) else EXIT_USAGE
    commands = {"promote": cmd_promote, "label": cmd_label, "list": cmd_list, "prune": cmd_prune}
    try:
        home = resolve_home(args.home)
        # EVERY operation refuses a corpus inside a git work tree (ruling H10; S6-ii wave 1) — reading
        # one there is as wrong as writing it, and `prune`/`label` would mutate it.
        refuse_git_tree(home / CORPUS_DIR)
        return commands[args.cmd](home, args)
    except UsageError as exc:
        print(f"asr_corpus: {exc}", file=sys.stderr)
        return EXIT_USAGE
    except Refused as exc:
        print(f"asr_corpus: {exc}", file=sys.stderr)
        return EXIT_REFUSED
    except OSError as exc:
        print(f"asr_corpus: {type(exc).__name__}: {exc.filename or ''}", file=sys.stderr)
        return EXIT_REFUSED


if __name__ == "__main__":
    sys.exit(main())
