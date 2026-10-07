#!/usr/bin/env python3
"""Replay captured audio through the SHIPPED VAD — the ear test (Phase 26 S6-ii, ASR_PLAN §6.2 + §3.4.1 ⑦).

Offline, never runtime. It imports the modules the relay ships — `VadSegmenter` over `VadParams`/`derive`,
`StampedFrame`, the model registry, the pre-ASR pass, the ONE bounded decode — and re-implements none of
them (ASR_PLAN §6.2), so what it prints is what the ear would have decided on that audio. The hand-authored
golden vectors are the unit tests; this tool is the EAR test, judged by the owner's hand reading on R94
§9's Pareto rule (fewer false segments, no lost short answer, no clipped onset).

Input: any file the decode reads — a debug capture (`calls/[dictation/]<call>-<leg>.wav`, a crashed
`.wav.part` included), a corpus clip (`asr-corpus/raw/…`, its `labels/` kind printed), or any webm/ogg/
mp4/wav — always through `voice_prepass.decode_to_pcm16k`, then fed as 40 ms `StampedFrame`s.

THE BASELINE (session-64 ruling H6): until S7b makes `onset_ms`/`max_segment_s` config keys, a column
starts from `LiveCfg()`'s `vad_threshold` / `silence_ms` / `prefix_padding_ms` plus the tool-local
`PRE_S7B` below (ASR_PLAN §4's defaults); a dictation capture starts at `onset_ms=0` (§3.4's Dictation
row). Note `prefix_padding_ms` is 300 today — the plan's 500 is S7b's move; sweep it with
`--set prefix_padding_ms=500`.

Usage (the venv's python; positionals FIRST — `--set` takes every following `k=v`):

    backend/.venv/bin/python tools/vad_replay.py FILE... [--model KEY] [--set k=v ...]... [--variant m1]
        [--prepass-sweep 0.3,0.5 | LO:HI:STEP] [--asr CONFIG [--door stt|live]]

* `--model` — a `VAD_MODELS` key; the header prints its name, sha256, hop, `default_act` and
  `prepass_act`, and each column its EFFECTIVE act. A model A/B = two runs side by side (§3.4.1 ⑦).
* `--set k=v ...` — one more COLUMN: the baseline with these `VadParams` fields replaced; repeatable
  (ruling H8). `--variant m1` adds the M1-confirmation twin of every column.
* `--prepass-sweep` — the §6.4 S9-gate row (§3.4.1 ⑤): per act, each FILE's pass verdict and each
  replayed segment's (first column), with the labelled-speech `no_speech` count that must stay 0.
* `--asr CONFIG` — each segment's transcript through the pass and the clip door's own chunk helper
  (`services/voice_clip.transcribe_wavs`: one 16 kHz WAV per pass chunk, in order, joined), on a
  `VoiceClient` built from that config file (e.g. `~/.ctrl-b-dev/config.yaml`) exactly as the app builds
  it (`runtime.build_voice_client` over the resolved registry) — so `language`, the stt door's
  `vad_filter`/`hotwords`/`extra_body`, the chain, its fallbacks and the D40 caps are the REAL request
  (ASR_PLAN §3.7 T-5; S9). `--door` picks the chain (`stt` = `voice.stt`, `live` = `voice.live`); to aim at
  one engine, point a COPY of the config at it. A `no_speech` segment makes no call. Keys come from the
  config (plus the app's own `.env` rule: `CTRLB_ENV`, else the project root's — never a file beside the
  config) and are never printed; the resolver's warnings (a provider it dropped) go to stderr.

Exit codes: 0 = done · 1 = an input could not be read/decoded, or an ASR call failed · 2 = usage (a bad
flag, an unknown `--set` key, a value `derive` refuses).
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

# The checkout's OWN backend (and this directory, for `asr_corpus`'s layout) first: the replay must run
# the code that sits beside it, not whatever `app` an editable venv happens to point at.
_HERE = Path(__file__).resolve().parent
for _p in (str(_HERE.parent / "backend"), str(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.config import LiveCfg  # noqa: E402
from app.services.voice_audio import MODEL_RATE, float32_to_pcm16  # noqa: E402
from app.services.voice_prepass import (  # noqa: E402
    DecodeAborted,
    UndecodableAudio,
    decode_to_pcm16k,
    prepass,
)
from app.services.voice_vad import (  # noqa: E402
    VAD_MODELS,
    Edge,
    StampedFrame,
    VadModel,
    VadParams,
    VadSegmenter,
    get_model,
)
from asr_corpus import label_path  # noqa: E402

if TYPE_CHECKING:
    from app.adapters.voice import Door

#: The pre-S7b half of the baseline (ruling H6): ASR_PLAN §4's `onset_ms` (200) and `max_segment_s`
#: (20) defaults, which are not config keys until S7b — S7b swaps this dict for its `from_live_cfg`.
PRE_S7B: dict[str, Any] = {"onset_ms": 200, "max_segment_s": 20}
#: A dictation's onset (§3.4's Dictation row: every crossing is a segment).
DICTATION_ONSET_MS = 0
#: The relay's frame (`voice.live.frame_ms`): the replay feeds what the relay would have — read from
#: `LiveCfg()`, the one source, never re-spelled.
FRAME_MS = LiveCfg().frame_ms
#: The decode's bounds for one input: the longest leg a capture can hold (`max_session_s`' 7200 s
#: ceiling) plus a minute, and a wall bound generous enough for a 2-hour webm on a slow box.
MAX_DECODED_S = 7260.0
MAX_WALL_S = 600.0
#: The `--set` keys: every `VadParams` field but `variant` (that one is `--variant`).
SET_KEYS = tuple(f.name for f in dataclasses.fields(VadParams) if f.name != "variant")

EXIT_OK, EXIT_INPUT, EXIT_USAGE = 0, 1, 2


class UsageError(Exception):
    """A flag the tool refuses — exit 2."""


@dataclasses.dataclass
class Segment:
    start_ms: int
    confirm_ms: int | None = None
    end_ms: int | None = None
    reason: str | None = None
    max_p: float | None = None
    start: int = 0  # model samples — the audio the pass / ASR slice
    end: int = 0
    transcript: str | None = None


@dataclasses.dataclass
class Column:
    name: str
    overrides: dict[str, Any]
    variant: str = "default"


def _ms(sample: int) -> int:
    return sample * 1000 // MODEL_RATE


def is_dictation(path: Path) -> bool:
    """A dictation capture (`calls/dictation/…`) or a corpus clip whose H5 name says `dictation`."""
    if path.parent.name == "dictation":
        return True
    parts = path.name.split("-")
    return path.parent.name == "raw" and len(parts) > 2 and parts[2] == "dictation"


def label_kind(path: Path) -> str:
    """The corpus label's `kind` (H9) for a clip under `asr-corpus/raw/`, else `-`."""
    lp = label_path(path)
    if lp is None or not lp.is_file():
        return "-"
    try:
        kind = json.loads(lp.read_text(encoding="utf-8")).get("kind")
    except OSError, ValueError:
        return "-"
    return kind if kind in ("positive", "negative") else "-"


def _parse_value(key: str, raw: str) -> Any:
    try:
        return float(raw) if key in ("act", "max_segment_s", "ema_tau_ms") else int(raw)
    except ValueError:
        raise UsageError(f"--set {key}: not a number: {raw!r}") from None


def parse_group(items: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for item in items:
        key, sep, raw = item.partition("=")
        if not sep or key not in SET_KEYS:
            raise UsageError(f"--set: unknown key {key!r} (keys: {', '.join(SET_KEYS)})")
        out[key] = _parse_value(key, raw)
    return out


def params_for(column: Column, *, dictation: bool) -> VadParams:
    """The column's `VadParams`: the H6 baseline, the file's mode, then the column's overrides."""
    cfg = LiveCfg()
    base: dict[str, Any] = {
        "act": cfg.vad_threshold,
        "silence_ms": cfg.silence_ms,
        "prefix_padding_ms": cfg.prefix_padding_ms,
        **PRE_S7B,
    }
    if dictation:
        base["onset_ms"] = DICTATION_ONSET_MS
    return VadParams(**{**base, **column.overrides}, variant=column.variant)  # type: ignore[arg-type]


def parse_acts(spec: str) -> list[float]:
    """`0.3,0.5` or `LO:HI:STEP` (inclusive) → the act list."""
    try:
        if ":" in spec:
            lo, hi, step = (float(x) for x in spec.split(":"))
            if step <= 0 or hi < lo:
                raise ValueError
            n = int(round((hi - lo) / step))
            acts = [round(lo + i * step, 4) for i in range(n + 1)]
        else:
            acts = [float(x) for x in spec.split(",") if x.strip()]
    except ValueError:
        raise UsageError(f"--prepass-sweep: bad spec {spec!r}") from None
    if not acts or any(not 0 < a < 1 for a in acts):
        raise UsageError("--prepass-sweep: every act must be inside (0, 1)")
    return acts


def segments_of(edges: list[Edge]) -> list[Segment]:
    """Pair the policy's edges (`start` → optional `confirm` → `stop`) into segments, in order. A
    START's pre-roll may reach before the previous stop — printed as-is."""
    out: list[Segment] = []
    open_seg: Segment | None = None
    for e in edges:
        at = e.leg_sample if e.leg_sample is not None else e.model_sample
        if e.kind == "start":
            open_seg = Segment(start_ms=_ms(at), start=e.model_sample)
            out.append(open_seg)
        elif e.kind == "confirm" and open_seg is not None:
            open_seg.confirm_ms = _ms(at)
        elif e.kind == "stop" and open_seg is not None:
            open_seg.end_ms, open_seg.end = _ms(at), e.model_sample
            open_seg.reason, open_seg.max_p = e.reason, e.max_p
            open_seg = None
    return out


def replay(pcm16: bytes, model: VadModel, params: VadParams) -> tuple[VadSegmenter, list[Segment]]:
    """Feed the audio as 40 ms frames on the 16 kHz leg clock (a capture's own), then flush."""
    seg = VadSegmenter(model, params, client_rate=MODEL_RATE)
    step = MODEL_RATE * FRAME_MS // 1000 * 2
    edges: list[Edge] = []
    for i in range(0, len(pcm16), step):
        chunk = pcm16[i : i + step]
        edges += seg.feed(StampedFrame(i // 2, len(chunk) // 2, chunk))
    edges += seg.flush()
    return seg, segments_of(edges)


def asr_client(config: Path) -> Any:
    """The app's own `VoiceClient` for `config` (T-5): load → resolve → `runtime.build_voice_client`."""
    from app.config import load_settings
    from app.core.provider_registry import resolve_lenient
    from app.runtime import build_voice_client

    if not config.is_file():  # `load_settings` reads a missing file as all-defaults — refuse it instead
        raise UsageError(f"--asr: no config file {config}")
    settings = load_settings(config)
    registry, warnings = resolve_lenient(settings)
    # A broken provider in a bake-off copy would otherwise surface only as `<asr error: VoiceError>` on
    # every segment — say why, once (the S9 review's L5).
    for warning in warnings:
        print(f"vad_replay: config: {warning}", file=sys.stderr)
    return build_voice_client(registry, settings, None)


async def transcribe_all(client: Any, door: Door, jobs: list[tuple[Segment, Any]]) -> int:
    """Each segment's pass chunks through the ONE shared chunk helper (the clip door's); returns how many
    segments failed. The client is closed here."""
    from app.adapters.voice import VoiceError
    from app.services.voice_clip import chunk_wavs, transcribe_wavs

    failed = 0
    try:
        for segment, result in jobs:
            if result.outcome == "no_speech":
                segment.transcript = "<no_speech>"
                continue
            try:
                segment.transcript = (await transcribe_wavs(client, chunk_wavs(result), door=door)).text
            except VoiceError as exc:
                failed += 1
                segment.transcript = f"<asr error: {type(exc).__name__}>"
    finally:
        await client.aclose()
    return failed


def _fmt(value: int | None) -> str:
    return "" if value is None else str(value)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="vad_replay.py",
        description="Replay audio through the shipped VAD (ASR_PLAN §6.2). Positionals first.",
        epilog="exit codes: 0 done · 1 an input unreadable/undecodable or an ASR call failed · 2 usage",
    )
    ap.add_argument("files", nargs="+", type=Path, help="captures, corpus clips or any decodable audio")
    ap.add_argument("--model", choices=list(VAD_MODELS), default=LiveCfg().vad_model, help="registry key")
    ap.add_argument("--set", dest="groups", nargs="+", action="append", default=[], metavar="K=V")
    ap.add_argument("--variant", choices=["m1"], help="add the M1-confirmation twin of every column")
    ap.add_argument("--prepass-sweep", metavar="ACTS", help="'0.3,0.5' or 'LO:HI:STEP'")
    ap.add_argument("--asr", metavar="CONFIG", type=Path, help="a config.yaml whose voice chains to call")
    ap.add_argument("--door", choices=["stt", "live"], default="stt", help="which chain (with --asr)")
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    try:
        args = ap.parse_args(argv)
    except SystemExit as exc:  # argparse's own usage error (or --help, which exits 0)
        return EXIT_OK if exc.code in (0, None) else EXIT_USAGE
    try:
        columns = [Column("A", {})]
        for i, group in enumerate(args.groups):
            columns.append(Column(chr(ord("B") + i), parse_group(group)))
        if args.variant:
            columns += [Column(f"{c.name}+m1", c.overrides, "m1") for c in list(columns)]
        acts = parse_acts(args.prepass_sweep) if args.prepass_sweep else []
        client = asr_client(args.asr) if args.asr else None
        # `derive` refuses an impossible cap here, before any audio is read (exit 2, not 1).
        model = get_model(args.model)
        for c in columns:
            for dictation in (False, True):
                VadSegmenter(model, params_for(c, dictation=dictation), client_rate=MODEL_RATE)
    except (UsageError, ValueError, TypeError, OSError) as exc:
        # A config that will not load (`ConfigValidationError` is a `ValueError`) is a usage error too —
        # caught before any audio is read.
        print(f"vad_replay: {exc}", file=sys.stderr)
        return EXIT_USAGE

    cls = VAD_MODELS[args.model]
    print(
        f"model {cls.name} · sha256 {cls.sha256} · {cls.asset} · hop {cls.hop} "
        f"({cls.hop * 1000 / cls.sample_rate:g} ms) · default_act {cls.default_act} · prepass_act {cls.prepass_act}"
    )
    status = EXIT_OK
    summary: list[tuple[str, str, int, int, int, float, str]] = []
    sweep_rows: list[tuple[float, str, str, str, int, int]] = []
    asr_jobs: list[tuple[Segment, Any]] = []
    reports: list[tuple[Path, float, str, list[tuple[Column, VadParams, VadSegmenter, list[Segment]]]]] = []
    for path in args.files:
        try:
            pcm = decode_to_pcm16k(path.read_bytes(), max_decoded_s=MAX_DECODED_S, max_wall_s=MAX_WALL_S)
        except (OSError, UndecodableAudio, DecodeAborted) as exc:
            print(f"vad_replay: {path}: cannot read ({type(exc).__name__})", file=sys.stderr)
            status = EXIT_INPUT
            continue
        pcm16 = float32_to_pcm16(pcm)
        dictation = is_dictation(path)
        kind = label_kind(path)
        duration = len(pcm) / MODEL_RATE
        runs = []
        for c in columns:
            params = params_for(c, dictation=dictation)
            seg, segs = replay(pcm16, model, params)
            runs.append((c, params, seg, segs))
            confirmed = sum(1 for s in segs if s.confirm_ms is not None)
            retracted = sum(1 for s in segs if s.reason == "short")
            per_min = len(segs) / duration * 60 if duration else 0.0
            summary.append((path.name, c.name, len(segs), confirmed, retracted, per_min, kind))
        reports.append((path, duration, "dictation" if dictation else "call", runs))
        if client is not None:
            for s in runs[0][3]:
                asr_jobs.append((s, prepass(pcm[s.start : max(s.end, s.start)], model)))
        for act in acts:
            file_verdict = prepass(pcm, model, act=act).outcome
            outcomes = [
                prepass(pcm[s.start : max(s.end, s.start)], model, act=act).outcome for s in runs[0][3]
            ]
            sweep_rows.append(
                (act, path.name, kind, file_verdict, outcomes.count("ok"), outcomes.count("no_speech"))
            )

    if client is not None and asyncio.run(transcribe_all(client, args.door, asr_jobs)):
        status = EXIT_INPUT

    for path, duration, mode, runs in reports:
        print(f"\n== {path}  ({duration:.2f} s · {mode})")
        for c, params, seg, segs in runs:
            k = seg.counts
            shown = ("act", "onset_ms", "silence_ms", "prefix_padding_ms", "max_segment_s", "variant")
            fields = " ".join(f"{f}={getattr(params, f)}" for f in shown)
            print(
                f"-- [{c.name}] {fields} · act {k.act} deact {k.deact:g} · "
                f"k_onset {k.k_onset} k_end {k.k_end} alpha {k.alpha:.3f} preroll {k.preroll}"
            )
            print(f"  {'#':>3} {'start_ms':>9} {'confirm_ms':>10} {'end_ms':>8}  {'reason':<11} {'max_p':>5}")
            for i, s in enumerate(segs, 1):
                max_p = "" if s.max_p is None else f"{s.max_p:.3f}"
                line = (
                    f"  {i:>3} {s.start_ms:>9} {_fmt(s.confirm_ms):>10} {_fmt(s.end_ms):>8}  "
                    f"{s.reason or '':<11} {max_p:>5}"
                )
                if s.transcript is not None and c is runs[0][0]:
                    line += f"  {s.transcript}"
                print(line)

    print("\nsummary:")
    print(f"  {'file':<40} {'col':<6} {'segs':>5} {'conf':>5} {'retr':>5} {'segs/min':>9}  kind")
    for name, col, n, conf, retr, per_min, kind in summary:
        print(f"  {name:<40} {col:<6} {n:>5} {conf:>5} {retr:>5} {per_min:>9.1f}  {kind}")

    if acts:
        print(f"\npre-pass sweep ({cls.name}; segments = column A):")
        print(f"  {'act':>5}  {'file':<40} {'kind':<9} {'file':<10} {'segs ok':>7} {'no_speech':>9}")
        for act, name, kind, verdict, ok, none in sweep_rows:
            print(f"  {act:>5g}  {name:<40} {kind:<9} {verdict:<10} {ok:>7} {none:>9}")
        for act in acts:
            rows = [r for r in sweep_rows if r[0] == act]
            lost = sum(1 for r in rows if r[2] == "positive" and r[3] == "no_speech")
            negs = [r for r in rows if r[2] == "negative"]
            hits = sum(1 for r in negs if r[3] == "ok")
            print(
                f"  act {act:g}: labelled speech answered no_speech = {lost} (must be 0) · negatives ok {hits}/{len(negs)}"
            )
    return status


if __name__ == "__main__":
    sys.exit(main())
