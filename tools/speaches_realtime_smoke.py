#!/usr/bin/env python3
"""Speaches `/v1/realtime` ear-contract smoke — Phase 24 slice S0 (docs/LIVE_VOICE_PLAN.md §7).

Proves emma -> Speaches `ws://.../v1/realtime?intent=transcription` end to end against the
**resident** Parakeet model, and pins the wire contract the S1 relay will be written against.

**This script's LIVE RUN is its proof — there is deliberately no pytest coverage.** It is dev
tooling that talks to a real server on the tailnet; a mocked version would only re-assert the
assumptions it exists to check. The S1 relay is where mock-Speaches unit tests belong.

What it establishes, per arm (`--arm`):

* `speech`   — stream a real spoken clip at realtime pace and observe the full server-VAD +
               endpointing + transcription event chain, ending in a real transcript.
* `silence`  — stream zeroed frames: the server VAD must stay quiet. Then force a commit so the
               transcription path runs on silence, exercising the fork's local `e093d8b`
               ("skip Parakeet when VAD finds no speech") patch: an EMPTY transcript, no error.
* `fields`   — probe which query params and `session.update` fields the fork actually honors,
               by comparing what we send against the `session.created` / `session.updated` echo.
               Also probes a BINARY uplink frame (the fork reads text only — see below).

When a realtime arm cannot reach a transcript, it runs an **isolation leg**: the identical audio is
sent through the ordinary HTTP `/v1/audio/transcriptions` door, which says whether the model/VAD/STT
stack is healthy and only the realtime *wiring* is at fault. See `transcribe_http`.

Protocol notes, all read out of the fork source at `~/github/speaches` @ `e093d8b` (NOT from the
OpenAI docs — where they differ, the fork wins):

* `model` is a REQUIRED query param; `intent` defaults to `conversation`. With
  `intent=transcription`, `model` IS the transcription model and `turn_detection.create_response`
  is forced False (`realtime/session.py`).
* Auth (`realtime/utils.verify_websocket_api_key`): `?api_key=`, `Authorization: Bearer`, or
  `X-API-Key` — enforced only when the server has `API_KEY` set. We use the header and never log it.
* Audio rides `input_audio_buffer.append` as **base64 of raw PCM16 LE mono at 24000 Hz** — the rate
  is hardcoded in `realtime/input_audio_buffer_event_router.py`, there is no negotiation, and the
  server resamples 24k -> 16k itself for VAD + STT.
* The uplink is **text frames only** (`WsServerMessageManager.receiver` calls `receive_text()`).

Usage (from anywhere; run with the backend venv so `websockets`/`httpx` resolve):

    backend/.venv/bin/python tools/speaches_realtime_smoke.py --arm all --out /tmp/s0-smoke

The API key comes ONLY from `SPEACHES_API_KEY` (empty = unauthenticated attempt). It is never
printed, logged or written to the event dumps.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import struct
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
import websockets
from websockets.asyncio.client import connect

#: The fork hardcodes 24 kHz as the wire rate of `input_audio_buffer.append`
#: (`realtime/input_audio_buffer_event_router.py:handle_input_audio_buffer_append`).
SPEACHES_WIRE_RATE = 24000

#: Default uplink frame duration — LIVE_VOICE_PLAN §3.1's `frame_ms` default.
DEFAULT_FRAME_MS = 40

#: The resident Parakeet **alias** from the fork's `model_aliases.json`. Deliberately the alias and
#: not the full repo id: part of what this smoke pins is WHERE alias resolution happens (it does not
#: happen at the WS layer — the query param is a plain `str` — but does at the loopback STT call).
DEFAULT_MODEL = "parakeet"

DEFAULT_SENTENCE = "The quick brown fox jumps over the lazy dog near the riverbank."

#: ctrl-b's own DEV backend TTS (rung (b) of the clip ladder). Kokoro synthesizes at 24 kHz mono,
#: which is exactly the realtime wire rate, so the happy path needs no resampling at all.
DEFAULT_TTS_URL = "http://127.0.0.1:5434/api/voice/tts"


# --------------------------------------------------------------------------------------- audio io


@dataclass
class Pcm:
    """Mono 16-bit PCM held as a plain list of ints — no numpy in the backend venv, and a smoke
    clip is a few seconds long, so a pure-stdlib representation is cheaper than a dependency."""

    rate: int
    samples: list[int]

    @property
    def duration_s(self) -> float:
        return len(self.samples) / self.rate if self.rate else 0.0


def read_wav(path: Path) -> Pcm:
    """Minimal RIFF/WAVE reader for PCM16.

    Written by hand rather than with `wave` because the clips this script consumes come off a
    STREAMING synth: Speaches/Kokoro emits a header whose `data` size is a placeholder
    (0xFFFFFFFF), which makes `wave.getnframes()` return 2147483647 and `readframes()` misbehave.
    Clamping the declared chunk size to what is actually on disk handles both shapes.
    """
    raw = path.read_bytes()
    if len(raw) < 12 or raw[0:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError(f"{path}: not a RIFF/WAVE file")
    pos = 12
    channels = 0
    rate = 0
    bits = 0
    data: bytes | None = None
    while pos + 8 <= len(raw):
        chunk_id = raw[pos : pos + 4]
        (chunk_size,) = struct.unpack_from("<I", raw, pos + 4)
        body = pos + 8
        avail = len(raw) - body
        size = min(chunk_size, avail)  # the streaming-header clamp
        if chunk_id == b"fmt ":
            fmt, channels, rate, _brate, _align, bits = struct.unpack_from("<HHIIHH", raw, body)
            if fmt != 1:
                raise ValueError(f"{path}: only PCM (fmt 1) is supported, got fmt {fmt}")
        elif chunk_id == b"data":
            data = raw[body : body + size]
        pos = body + size + (size % 2)
    if data is None or not rate or bits != 16:
        raise ValueError(f"{path}: expected a 16-bit PCM WAVE (rate={rate}, bits={bits})")
    frames = len(data) // (2 * channels)
    interleaved = struct.unpack_from(f"<{frames * channels}h", data)
    if channels == 1:
        mono = list(interleaved)
    else:
        mono = [sum(interleaved[i * channels : (i + 1) * channels]) // channels for i in range(frames)]
    return Pcm(rate=rate, samples=mono)


def resample(pcm: Pcm, target_rate: int) -> Pcm:
    """Linear-interpolation resample. Crude on purpose — this is a smoke rig, and the fork's own
    resampler (`speaches.audio.resample_audio_data`) is `np.interp`, i.e. exactly this."""
    if pcm.rate == target_rate or not pcm.samples:
        return Pcm(rate=target_rate, samples=list(pcm.samples))
    src = pcm.samples
    n_out = int(len(src) * target_rate / pcm.rate)
    step = (len(src) - 1) / max(n_out - 1, 1)
    out: list[int] = []
    for i in range(n_out):
        x = i * step
        lo = int(x)
        hi = min(lo + 1, len(src) - 1)
        frac = x - lo
        out.append(int(src[lo] + (src[hi] - src[lo]) * frac))
    return Pcm(rate=target_rate, samples=out)


def frames_of(pcm: Pcm, frame_ms: int) -> list[bytes]:
    """Slice PCM into fixed-duration frames, zero-padding the tail so every frame is full-length."""
    per = int(pcm.rate * frame_ms / 1000)
    out: list[bytes] = []
    for start in range(0, len(pcm.samples), per):
        chunk = pcm.samples[start : start + per]
        if len(chunk) < per:
            chunk = chunk + [0] * (per - len(chunk))
        out.append(struct.pack(f"<{per}h", *chunk))
    return out


def silence_frames(ms: int, frame_ms: int) -> list[bytes]:
    per = int(SPEACHES_WIRE_RATE * frame_ms / 1000)
    return [b"\x00" * (per * 2)] * max(ms // frame_ms, 0)


def wav_bytes(pcm: Pcm) -> bytes:
    """Wrap PCM16 mono in a canonical RIFF header (used by the out-of-band isolation leg)."""
    data = struct.pack(f"<{len(pcm.samples)}h", *pcm.samples)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        pcm.rate,
        pcm.rate * 2,
        2,
        16,
        b"data",
        len(data),
    )
    return header + data


# ------------------------------------------------------------------------------------ clip source


def make_clip(sentence: str, out_path: Path, tts_url: str) -> tuple[Path, str]:
    """Produce a spoken-English clip by LOCAL means only — no model downloads anywhere.

    Ladder (LIVE_VOICE_PLAN §7-S0 build brief): (a) `espeak-ng`, (b) ctrl-b's dev-backend TTS
    endpoint, (c) stop. Returns the path and a human label of which rung was used.
    """
    espeak = _which("espeak-ng") or _which("espeak")
    if espeak:
        subprocess.run(  # noqa: S603
            [espeak, "-w", str(out_path), "-s", "150", sentence], check=True, capture_output=True
        )
        return out_path, f"espeak-ng ({espeak})"
    try:
        resp = httpx.post(tts_url, json={"text": sentence, "format": "wav"}, timeout=60.0)
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"clip ladder exhausted: no espeak-ng on PATH and the dev TTS at {tts_url} is unreachable ({exc})"
        ) from exc
    if resp.status_code != 200:
        raise RuntimeError(
            f"clip ladder exhausted: no espeak-ng on PATH and {tts_url} answered {resp.status_code}"
        )
    out_path.write_bytes(resp.content)
    served = resp.headers.get("x-voice-target", "?")
    return out_path, f"ctrl-b dev TTS {tts_url} (served by {served})"


def _which(name: str) -> str | None:
    from shutil import which

    return which(name)


def transcribe_http(args: argparse.Namespace, pcm: Pcm, label: str) -> dict[str, Any]:
    """ISOLATION LEG — transcribe the same audio over ORDINARY HTTP `/v1/audio/transcriptions`.

    This exists because the realtime path's transcription step is BROKEN on a Speaches deployed
    without `LOOPBACK_HOST_URL` (see the §Findings note in the run output): the realtime session's
    transcription client is wired to `ASGITransport(stt_router)`, a BARE `APIRouter`, so FastAPI's
    `AsyncExitStackMiddleware` never runs and every form/file route asserts. Sending the identical
    audio down the real HTTP door proves which half is at fault: if this returns a transcript, the
    model + VAD + STT stack is healthy and only the realtime loopback wiring is broken.

    It is READ-ONLY use of an already-running server against an ALREADY-RESIDENT model — no config
    change, no restart, no download.
    """
    url = f"{http_base(args.base)}/v1/audio/transcriptions"
    files = {"file": (f"{label}.wav", wav_bytes(pcm), "audio/wav")}
    data = {"model": args.model, "response_format": "json"}
    start = time.perf_counter()
    resp = httpx.post(url, headers=auth_headers(args.api_key), files=files, data=data, timeout=120.0)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
    body: Any
    try:
        body = resp.json()
    except ValueError:
        body = resp.text[:400]
    return {
        "status": resp.status_code,
        "elapsed_ms": elapsed_ms,
        "text": body.get("text") if isinstance(body, dict) else body,
    }


# ------------------------------------------------------------------------------------- ws session


def http_base(ws_base: str) -> str:
    parts = urlsplit(ws_base)
    scheme = {"ws": "http", "wss": "https"}.get(parts.scheme, parts.scheme)
    return urlunsplit((scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def realtime_url(ws_base: str, params: dict[str, str]) -> str:
    return f"{ws_base.rstrip('/')}/v1/realtime?{urlencode(params)}"


def auth_headers(api_key: str) -> dict[str, str]:
    """Bearer header. The value NEVER reaches stdout or the dumps — only this dict."""
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


@dataclass
class Recorder:
    """Timestamped event log for one WS session. Audio payloads are elided from the dump: a
    base64 frame is noise, and the redaction habit is the same one that keeps the bearer out."""

    label: str
    t0: float = field(default_factory=time.perf_counter)
    lines: list[dict[str, Any]] = field(default_factory=list)
    quiet: bool = False

    def ms(self) -> float:
        return (time.perf_counter() - self.t0) * 1000.0

    def note(self, direction: str, payload: dict[str, Any], *, summary: str = "") -> None:
        dumped = dict(payload)
        if isinstance(dumped.get("audio"), str):
            dumped["audio"] = f"<{len(dumped['audio'])} b64 chars elided>"
        entry = {"t_ms": round(self.ms(), 1), "dir": direction, "event": dumped}
        self.lines.append(entry)
        if not self.quiet:
            arrow = "->" if direction == "send" else "<-"
            print(f"  [{entry['t_ms']:8.1f} ms] {arrow} {dumped.get('type', '?')}{summary}")

    def write(self, out_dir: Path | None) -> Path | None:
        if out_dir is None:
            return None
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{self.label}.jsonl"
        path.write_text("\n".join(json.dumps(entry) for entry in self.lines) + "\n", encoding="utf-8")
        return path


def summarize(event: dict[str, Any]) -> str:
    """One-line, human-readable tail for the live console trace."""
    kind = event.get("type", "")
    if kind == "session.created" or kind == "session.updated":
        sess = event.get("session", {})
        iat = sess.get("input_audio_transcription") or {}
        turn = sess.get("turn_detection") or {}
        return (
            f"  model={sess.get('model')!r} stt={iat.get('model')!r} lang={iat.get('language')!r}"
            f" vad(threshold={turn.get('threshold')}, silence_ms={turn.get('silence_duration_ms')},"
            f" pad_ms={turn.get('prefix_padding_ms')}, create_response={turn.get('create_response')})"
        )
    if kind == "input_audio_buffer.speech_started":
        return f"  audio_start_ms={event.get('audio_start_ms')}"
    if kind == "input_audio_buffer.speech_stopped":
        return f"  audio_end_ms={event.get('audio_end_ms')}"
    if kind == "conversation.item.input_audio_transcription.completed":
        return f"  transcript={event.get('transcript')!r}"
    if kind == "error":
        err = event.get("error", {})
        return f"  {err.get('type')}: {err.get('message')}"
    return ""


class Session:
    """One realtime WS session: a background reader plus helpers to send + await events."""

    def __init__(self, ws: Any, rec: Recorder) -> None:
        self.ws = ws
        self.rec = rec
        self.events: list[dict[str, Any]] = []
        self._queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._task = asyncio.create_task(self._read())

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                if isinstance(raw, bytes):
                    event = {"type": "<binary frame>", "bytes": len(raw)}
                else:
                    event = json.loads(raw)
                self.events.append(event)
                self.rec.note("recv", event, summary=summarize(event))
                await self._queue.put(event)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self._queue.put(None)

    async def send(self, event: dict[str, Any]) -> None:
        self.rec.note("send", event)
        await self.ws.send(json.dumps(event))

    async def send_audio(self, frame: bytes) -> None:
        # Deliberately NOT routed through `send()`: 25 append lines per second would bury the trace.
        payload = {"type": "input_audio_buffer.append", "audio": base64.b64encode(frame).decode()}
        await self.ws.send(json.dumps(payload))

    async def wait_for(self, types: set[str], within_s: float) -> dict[str, Any] | None:
        deadline = time.perf_counter() + within_s
        while True:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                return None
            try:
                event = await asyncio.wait_for(self._queue.get(), remaining)
            except TimeoutError:
                return None
            if event is None:
                return None
            if event.get("type") in types:
                return event

    async def drain(self, seconds: float) -> None:
        """Keep reading (so events are printed) for a fixed settle window."""
        await self.wait_for({"__never__"}, seconds)

    def time_of(self, kind: str) -> float | None:
        for line in self.rec.lines:
            if line["dir"] == "recv" and line["event"].get("type") == kind:
                return float(line["t_ms"])
        return None

    async def close(self) -> None:
        await self.ws.close()
        self._task.cancel()


# ------------------------------------------------------------------------------------------- arms


async def arm_speech(args: argparse.Namespace, pcm: Pcm, out_dir: Path | None) -> dict[str, Any]:
    print("\n=== ARM: speech ===")
    rec = Recorder("arm-speech")
    url = realtime_url(args.base, {"model": args.model, "intent": "transcription"})
    frames = frames_of(pcm, args.frame_ms) + silence_frames(args.tail_silence_ms, args.frame_ms)
    print(f"  url: {url}")
    print(
        f"  clip: {pcm.duration_s:.2f}s @ {pcm.rate} Hz -> {len(frames)} frames "
        f"({args.frame_ms} ms each, incl. {args.tail_silence_ms} ms trailing silence)"
    )
    stream_end = 0.0
    disconnect: dict[str, Any] | None = None
    transcript_event: dict[str, Any] | None = None
    async with connect(url, additional_headers=auth_headers(args.api_key), max_size=None) as ws:
        sess = Session(ws, rec)
        created = await sess.wait_for({"session.created"}, 10.0)
        if created is None:
            return {"ok": False, "why": "no session.created"}
        stream_start = rec.ms()
        pace = args.frame_ms / 1000.0
        try:
            for i, frame in enumerate(frames):
                await sess.send_audio(frame)
                target = stream_start / 1000.0 + (i + 1) * pace
                delay = target - (rec.ms() / 1000.0)
                if delay > 0:
                    await asyncio.sleep(delay)
            stream_end = rec.ms()
            print(f"  -- stream done at {stream_end:.0f} ms (realtime pace) --")
            transcript_event = await sess.wait_for(
                {"conversation.item.input_audio_transcription.completed"}, args.wait_s
            )
            await sess.drain(0.5)
        except websockets.exceptions.ConnectionClosed as exc:
            # NOT a client bug: the server drops the socket mid-stream when its transcription task
            # raises. Captured as evidence (close code + when) rather than crashing the run.
            stream_end = rec.ms()
            disconnect = {
                "at_ms": round(stream_end, 1),
                "frames_sent": i + 1,
                "of_frames": len(frames),
                "exception": type(exc).__name__,
                "close_code": ws.close_code,
                "close_reason": ws.close_reason,
            }
            print(f"  !! server dropped the socket at {stream_end:.0f} ms: {disconnect}")
        await sess.close()

    started = sess.time_of("input_audio_buffer.speech_started")
    stopped = sess.time_of("input_audio_buffer.speech_stopped")
    done = sess.time_of("conversation.item.input_audio_transcription.completed")
    transcript = (transcript_event or {}).get("transcript")
    result: dict[str, Any] = {
        "ok": bool(started and stopped and transcript and transcript.strip()),
        "transcript": transcript,
        "events": [e.get("type") for e in sess.events],
        "stream_start_ms": round(stream_start, 1),
        "stream_end_ms": round(stream_end, 1),
        "speech_started_ms": started,
        "speech_stopped_ms": stopped,
        "transcript_ms": done,
        "vad_ok": bool(started and stopped),
        "disconnect": disconnect,
        "vad_first_event_latency_ms": None if started is None else round(started - stream_start, 1),
        "transcript_after_stream_end_ms": None if done is None else round(done - stream_end, 1),
        "transcript_after_speech_stopped_ms": (
            None if (done is None or stopped is None) else round(done - stopped, 1)
        ),
    }
    if not result["ok"]:
        print("\n  -- ISOLATION LEG: same audio through plain HTTP /v1/audio/transcriptions --")
        oob = transcribe_http(args, pcm, "s0-speech")
        result["http_isolation"] = oob
        print(f"     HTTP {oob['status']} in {oob['elapsed_ms']} ms -> {oob['text']!r}")
    result["log"] = str(rec.write(out_dir) or "")
    print(f"\n  REALTIME TRANSCRIPT: {transcript!r}")
    return result


async def arm_silence(args: argparse.Namespace, out_dir: Path | None) -> dict[str, Any]:
    print("\n=== ARM: silence (exercises the fork's e093d8b no-speech patch) ===")
    rec = Recorder("arm-silence")
    url = realtime_url(args.base, {"model": args.model, "intent": "transcription"})
    frames = silence_frames(args.silence_ms, args.frame_ms)
    print(f"  streaming {args.silence_ms} ms of zeroed pcm16 in {len(frames)} frames")
    forced: dict[str, Any] | None = None
    disconnect: dict[str, Any] | None = None
    async with connect(url, additional_headers=auth_headers(args.api_key), max_size=None) as ws:
        sess = Session(ws, rec)
        if await sess.wait_for({"session.created"}, 10.0) is None:
            return {"ok": False, "why": "no session.created"}
        stream_start = rec.ms()
        try:
            for i, frame in enumerate(frames):
                await sess.send_audio(frame)
                delay = stream_start / 1000.0 + (i + 1) * (args.frame_ms / 1000.0) - rec.ms() / 1000.0
                if delay > 0:
                    await asyncio.sleep(delay)
            await sess.drain(1.0)
            vad_events = [e for e in sess.events if e.get("type", "").startswith("input_audio_buffer.speech")]
            # Pure silence never trips the server VAD, so the transcription path is never reached and
            # `e093d8b` would go untested. Force the commit ourselves: that runs the SAME
            # `commit_and_transcribe` the VAD path runs, on a silent buffer -> the loopback
            # /v1/audio/transcriptions finds no speech segments -> Parakeet is skipped -> "".
            print("  -- forcing input_audio_buffer.commit to drive the transcription path on silence --")
            await sess.send({"type": "input_audio_buffer.commit"})
            forced = await sess.wait_for(
                {"conversation.item.input_audio_transcription.completed", "error"}, args.wait_s
            )
            await sess.drain(0.5)
            if ws.close_code is not None:
                # The server can die WITHOUT us noticing through a send — we stop sending after the
                # commit, so the drop only shows up as a closed socket. Record it either way.
                disconnect = {
                    "at_ms": round(rec.ms(), 1),
                    "exception": None,
                    "close_code": ws.close_code,
                    "close_reason": ws.close_reason,
                }
                print(f"  !! socket closed by the server while waiting: {disconnect}")
        except websockets.exceptions.ConnectionClosed as exc:
            vad_events = [e for e in sess.events if e.get("type", "").startswith("input_audio_buffer.speech")]
            disconnect = {
                "at_ms": round(rec.ms(), 1),
                "exception": type(exc).__name__,
                "close_code": ws.close_code,
                "close_reason": ws.close_reason,
            }
            print(f"  !! server dropped the socket: {disconnect}")
        await sess.close()

    transcript = (forced or {}).get("transcript")
    errors = [e for e in sess.events if e.get("type") == "error"]
    result: dict[str, Any] = {
        "ok": (
            (not vad_events)
            and (not errors)
            and disconnect is None
            and forced is not None
            and not (transcript or "").strip()
        ),
        "vad_stayed_quiet_during_silence": not vad_events,
        "vad_events_during_silence": [e.get("type") for e in vad_events],
        "forced_commit_result": (forced or {}).get("type"),
        "forced_commit_transcript": transcript,
        "errors": errors,
        "disconnect": disconnect,
        "events": [e.get("type") for e in sess.events],
    }
    if not result["ok"]:
        # Same isolation move as the speech arm: drive `e093d8b` through the HTTP door instead, where
        # the loopback-wiring defect cannot reach it. An empty transcript here IS the patch working.
        print("\n  -- ISOLATION LEG: the same silence through plain HTTP /v1/audio/transcriptions --")
        silent = Pcm(rate=SPEACHES_WIRE_RATE, samples=[0] * int(SPEACHES_WIRE_RATE * args.silence_ms / 1000))
        oob = transcribe_http(args, silent, "s0-silence")
        result["http_isolation"] = oob
        result["e093d8b_proven_via_http"] = oob["status"] == 200 and not (oob["text"] or "").strip()
        print(f"     HTTP {oob['status']} in {oob['elapsed_ms']} ms -> {oob['text']!r}")
    result["log"] = str(rec.write(out_dir) or "")
    return result


async def _probe_update(sess: Session, patch: dict[str, Any], wait: float = 5.0) -> dict[str, Any]:
    """Send one `session.update` and collect BOTH the ack and any error it produced."""
    before = len(sess.events)
    await sess.send({"type": "session.update", "session": patch})
    ack = await sess.wait_for({"session.updated"}, wait)
    await sess.drain(0.25)
    errors = [e for e in sess.events[before:] if e.get("type") == "error"]
    return {"patch": patch, "ack": ack, "errors": [e.get("error", {}).get("message") for e in errors]}


async def arm_fields(args: argparse.Namespace, out_dir: Path | None) -> dict[str, Any]:
    print("\n=== ARM: fields (query params + session.update honored/ignored) ===")
    findings: dict[str, Any] = {"query_params": {}, "session_update": {}, "handshake": {}}

    # --- (1) query params: one short session each, read straight off `session.created`. ---
    param_cases: dict[str, dict[str, str]] = {
        "alias_model_transcription_intent": {"model": args.model, "intent": "transcription"},
        "explicit_language": {"model": args.model, "intent": "transcription", "language": "de"},
        "transcription_model_override": {
            "model": args.model,
            "intent": "transcription",
            "transcription_model": "Systran/faster-whisper-tiny",
        },
        "default_intent_conversation": {"model": args.model},
    }
    for name, params in param_cases.items():
        rec = Recorder(f"fields-qp-{name}", quiet=True)
        url = realtime_url(args.base, params)
        try:
            async with connect(url, additional_headers=auth_headers(args.api_key), max_size=None) as ws:
                sess = Session(ws, rec)
                created = await sess.wait_for({"session.created"}, 10.0)
                await sess.close()
        except Exception as exc:  # noqa: BLE001 — a handshake refusal IS the finding here
            findings["query_params"][name] = {"params": params, "error": f"{type(exc).__name__}: {exc}"}
            print(f"  {name}: REFUSED -> {type(exc).__name__}: {exc}")
            continue
        session_obj = (created or {}).get("session", {})
        iat = session_obj.get("input_audio_transcription") or {}
        turn = session_obj.get("turn_detection") or {}
        observed = {
            "session.model": session_obj.get("model"),
            "input_audio_transcription.model": iat.get("model"),
            "input_audio_transcription.language": iat.get("language"),
            "turn_detection.create_response": turn.get("create_response"),
        }
        findings["query_params"][name] = {"params": params, "observed": observed}
        print(f"  {name}: {observed}")
        rec.write(out_dir)

    # --- (2) missing required `model` + (3) a bad bearer: both are handshake-level answers. ---
    for name, url, headers in (
        (
            "missing_model_param",
            realtime_url(args.base, {"intent": "transcription"}),
            auth_headers(args.api_key),
        ),
        (
            "bad_api_key",
            realtime_url(args.base, {"model": args.model, "intent": "transcription"}),
            {"Authorization": "Bearer definitely-not-the-key"},
        ),
    ):
        try:
            async with connect(url, additional_headers=headers, max_size=None) as ws:
                await ws.close()
            findings["handshake"][name] = "ACCEPTED (no refusal)"
        except Exception as exc:  # noqa: BLE001 — the refusal shape is the finding
            findings["handshake"][name] = f"{type(exc).__name__}: {exc}"
        print(f"  handshake {name}: {findings['handshake'][name]}")

    # --- (4) session.update fields, on one long-lived session. ---
    rec = Recorder("fields-session-update")
    url = realtime_url(args.base, {"model": args.model, "intent": "transcription"})
    async with connect(url, additional_headers=auth_headers(args.api_key), max_size=None) as ws:
        sess = Session(ws, rec)
        created = await sess.wait_for({"session.created"}, 10.0)
        baseline = (created or {}).get("session", {})
        probes: dict[str, dict[str, Any]] = {
            "model": {"model": "gpt-4o-realtime-preview-CHANGED"},
            "input_audio_transcription.model+language": {
                "input_audio_transcription": {"model": "Systran/faster-whisper-tiny", "language": "de"}
            },
            "input_audio_transcription.language_reset_to_null": {
                "input_audio_transcription": {"model": "Systran/faster-whisper-tiny", "language": None}
            },
            "turn_detection_full": {
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.6,
                    "prefix_padding_ms": 0,
                    "silence_duration_ms": 800,
                    "create_response": False,
                }
            },
            "turn_detection_partial": {"turn_detection": {"threshold": 0.4}},
            "input_audio_format": {"input_audio_format": "pcm16"},
            "temperature": {"temperature": 0.31},
            "voice": {"voice": "af_sky"},
            "instructions": {"instructions": "S0 smoke probe."},
            "unknown_field": {"definitely_not_a_field": 1},
        }
        for name, patch in probes.items():
            findings["session_update"][name] = await _probe_update(sess, patch)
        final = await _probe_update(sess, {"temperature": 0.32})

        # --- (5) a BINARY uplink frame. The fork's receiver is `receive_text()` only; what it does
        #         with a binary frame decides whether S1's relay may forward raw PCM. Last, so a
        #         torn session cannot pollute the probes above.
        print("  -- binary uplink frame probe --")
        try:
            await sess.ws.send(b"\x00" * 1920)
            await sess.drain(1.5)
            binary_verdict = {
                "sent": True,
                "close_code": sess.ws.close_code,
                "close_reason": sess.ws.close_reason,
                "events_after": [e.get("type") for e in sess.events[-3:]],
            }
        except Exception as exc:  # noqa: BLE001
            binary_verdict = {"sent": False, "error": f"{type(exc).__name__}: {exc}"}
        findings["binary_uplink_frame"] = binary_verdict
        print(f"  binary frame: {binary_verdict}")
        await sess.close()

    findings["baseline_session"] = baseline
    findings["session_update_final_still_acked"] = final["ack"] is not None
    findings["log"] = str(rec.write(out_dir) or "")

    # Verdict per field: honored (the ack echoes what we asked) vs ignored/rejected.
    verdicts: dict[str, str] = {}
    for name, probe in findings["session_update"].items():
        ack_session = (probe["ack"] or {}).get("session", {})
        verdicts[name] = _verdict(probe["patch"], ack_session, probe["errors"])
    findings["verdicts"] = verdicts
    print("\n  session.update verdicts:")
    for name, verdict in verdicts.items():
        print(f"    {name:48s} {verdict}")
    return findings


def _verdict(patch: dict[str, Any], ack_session: dict[str, Any], errors: list[str | None]) -> str:
    if not ack_session and errors:
        return f"REJECTED — {errors[0]}"
    if not ack_session:
        return "NO ACK"
    mismatched: list[str] = []
    for key, want in patch.items():
        got = ack_session.get(key)
        if isinstance(want, dict) and isinstance(got, dict):
            for sub, sub_want in want.items():
                if got.get(sub) != sub_want:
                    mismatched.append(f"{key}.{sub}: asked {sub_want!r}, got {got.get(sub)!r}")
        elif got != want:
            mismatched.append(f"{key}: asked {want!r}, got {got!r}")
    prefix = f"(also errored: {errors[0]}) " if errors else ""
    if not mismatched:
        return f"{prefix}HONORED"
    return f"{prefix}IGNORED — " + "; ".join(mismatched)


# ------------------------------------------------------------------------------- residency + main


def check_residency(args: argparse.Namespace) -> str:
    """Refuse to open a session against a model that is not ALREADY local.

    `GET /v1/models/{id}` lists local models only and resolves aliases through the same
    `ModelId` validator the rest of the API uses — so this is the cheapest honest residency
    question, and it can never trigger a download (that is `POST`, which we never call).
    """
    url = f"{http_base(args.base)}/v1/models/{args.model}"
    resp = httpx.get(url, headers=auth_headers(args.api_key), timeout=15.0)
    if resp.status_code == 200:
        body = resp.json()
        return str(body.get("id", args.model))
    if resp.status_code in (401, 403):
        raise SystemExit(
            f"ABORT: {url} answered {resp.status_code} — the server requires an API key and "
            f"SPEACHES_API_KEY is {'empty' if not args.api_key else 'wrong'}."
        )
    if resp.status_code == 404:
        raise SystemExit(
            f"ABORT: model {args.model!r} is NOT resident on {http_base(args.base)} (404 from /v1/models). "
            f"Refusing to open a realtime session — that would trigger a download. "
            f"Run `GET /v1/models` to see what is local."
        )
    raise SystemExit(f"ABORT: unexpected {resp.status_code} from {url}: {resp.text[:200]}")


async def run(args: argparse.Namespace, out_dir: Path | None) -> int:
    results: dict[str, Any] = {}
    if args.arm in ("speech", "all"):
        clip = Path(args.clip) if args.clip else None
        if clip is None:
            clip_dir = out_dir or Path.cwd()
            clip_dir.mkdir(parents=True, exist_ok=True)
            clip, how = make_clip(args.sentence, clip_dir / "s0-clip.wav", args.tts_url)
            print(f"  clip source: {how}")
            print(f"  sentence:    {args.sentence!r}")
        else:
            print(f"  clip source: --clip {clip}")
        pcm = resample(read_wav(clip), SPEACHES_WIRE_RATE)
        results["speech"] = await arm_speech(args, pcm, out_dir)
    if args.arm in ("silence", "all"):
        results["silence"] = await arm_silence(args, out_dir)
    if args.arm in ("fields", "all"):
        results["fields"] = await arm_fields(args, out_dir)

    if out_dir is not None:
        (out_dir / "summary.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print("\n" + "=" * 78)
    for arm, res in results.items():
        if arm == "fields":
            print("[INFO] fields  — see the verdict table above")
            continue
        print(f"[{'PASS' if res.get('ok') else 'FAIL'}] {arm}")
        if arm == "speech":
            print(f"       server VAD + endpointing: {'OK' if res.get('vad_ok') else 'NOT OBSERVED'}")
            print(f"       first VAD event: +{res.get('vad_first_event_latency_ms')} ms after stream start")
            print(f"       realtime transcript: {res.get('transcript')!r}")
            print(f"       transcript: +{res.get('transcript_after_stream_end_ms')} ms after stream end")
        if arm == "silence":
            print(f"       VAD during silence: {res.get('vad_events_during_silence') or 'none (expected)'}")
            print(f"       forced-commit transcript: {res.get('forced_commit_transcript')!r} (expected '')")
        if res.get("disconnect"):
            print(f"       SERVER DROPPED THE SOCKET: {res['disconnect']}")
        if res.get("http_isolation"):
            oob = res["http_isolation"]
            print(f"       isolation (plain HTTP STT): {oob['status']} -> {oob['text']!r}")
    if out_dir is not None:
        print(f"\nevent dumps: {out_dir}")
    failed = [a for a, r in results.items() if a != "fields" and not r.get("ok")]
    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="ws://127.0.0.1:9000", help="Speaches WS base (default: %(default)s)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="transcription model/alias (default: %(default)s)")
    ap.add_argument("--clip", default=None, help="path to a spoken wav; synthesized locally if omitted")
    ap.add_argument("--sentence", default=DEFAULT_SENTENCE, help="what to synthesize when --clip is absent")
    ap.add_argument("--tts-url", default=DEFAULT_TTS_URL, help="rung (b) of the clip ladder")
    ap.add_argument("--arm", default="all", choices=["speech", "silence", "fields", "all"])
    ap.add_argument("--frame-ms", type=int, default=DEFAULT_FRAME_MS, help="uplink frame duration")
    ap.add_argument("--tail-silence-ms", type=int, default=1500, help="silence appended after the clip")
    ap.add_argument("--silence-ms", type=int, default=4000, help="the silence arm's stream length")
    ap.add_argument("--wait-s", type=float, default=45.0, help="how long to wait for a final transcript")
    ap.add_argument("--out", default=None, help="directory for the raw event dumps")
    args = ap.parse_args()
    args.api_key = os.environ.get("SPEACHES_API_KEY", "")

    out_dir = Path(args.out).expanduser().resolve() if args.out else None
    print(f"Speaches realtime smoke — base={args.base} model={args.model!r} arm={args.arm}")
    print(f"  api key: {'present (redacted)' if args.api_key else 'ABSENT (SPEACHES_API_KEY unset)'}")
    resolved = check_residency(args)
    print(f"  residency: OK — {args.model!r} resolves to {resolved!r} and is LOCAL")
    return asyncio.run(run(args, out_dir))


if __name__ == "__main__":
    sys.exit(main())
