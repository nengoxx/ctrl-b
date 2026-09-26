"""Phase 24 / D71 slice S1 — the live-voice BE relay (`WS /api/voice/live`).

House pattern: a hand-built FastAPI app + `app.state` stubs + `TestClient.websocket_connect` for the
phone's leg, and a **scripted fake Speaches** for the upstream leg (`app.state.voice_live_connect`,
the one injection seam). No sockets, no live servers, no Speaches — the contract the fake mirrors is
the LIVE-VERIFIED one recorded in `LIVE_VOICE_PLAN.md` §7-S0 ② plus the two R70 amendments, and
`tools/speaches_realtime_smoke.py` is where that contract was measured against the real server.

The arms, by what they defend:

* **protocol** — every way a client can break the wire contract closes 1008, and a compliant client
  does not. Including the three uplink caps and what each one bounds: bytes per frame, MILLISECONDS
  per frame, and both frames and milliseconds over a rolling window (the S1 review's F4 — a byte cap
  alone lets a compliant client ship ~100x realtime).
* **origin** — the ONLY defence a WebSocket has in a CORS-less app (SECURITY_MODEL §2.7).
* **gates** — `enabled` / no chain / no TTS / busy, and the `live` capability bit's truth table.
* **wire** — the five-field `turn_detection`, the language rule, TEXT-framed base64 appends whose
  bytes are the resampled 24 kHz audio, and the one spurious error that must be swallowed.
* **COMMIT-SAFETY** — a full session never sends `input_audio_buffer.commit` (R70 §1.2 arm A: a
  commit with speech open kills the session and loses the words).
* **flush** — the CONSTANT worst-case pad `max(3000, silence_ms) + 200` (F3, two confirm rounds: a
  per-buffer count goes stale in BOTH directions — a processed stale `committed` erased the next
  phrase's count, an UNPROCESSED one left it high and shrank the burst below the 3 s floor — so no
  count exists at all), in both `max()` branches and the never-fed no-op case; the burst's DELIVERY
  barrier against the mic that resumes behind it (F2); and the never-cleared `_audio_seen` latch —
  burst-when-uncertain.
* **backpressure / taxonomy / secrets** — oldest-dropped + one `degraded`; the three upstream failure
  classes; and the bearer appearing in NO log record and NO downlink frame.
* **the call trail (D77)** — `start.call_id`/`start.leg` validated with `sample_rate`'s strictness
  (both or neither); a debug leg with an id writes `leg_start` (the exact `session.update`), every
  `down` frame and `leg_end`, each carrying its `leg`; debug off, or no id, writes nothing.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anyio
import pytest
import yaml
from _reg import registry as inference_registry
from _reg import target
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosedError, InvalidStatus
from websockets.frames import Close
from websockets.http11 import Response

from app.adapters.voice import VoiceClient
from app.api import voice as voice_api
from app.config import LiveCfg, Settings, VoiceServiceCfg
from app.core.audio import SPEACHES_WIRE_RATE, Pcm16Resampler
from app.core.provider_registry import resolve_lenient
from app.domain.provider import LivePolicy, SttPolicy, TtsPolicy
from app.services.call_trail import CallTrail
from app.services.voice_live import LiveSessionSlots, realtime_url

ORIGIN = {"Origin": "http://testserver"}
SECRET = "sk-LIVE-VOICE-CANARY"


# ── the scripted fake Speaches ────────────────────────────────────────────────────────────────────


@dataclass
class Say:
    """One scripted upstream event, optionally GATED on the relay's own progress — which is how a test
    places an event after a specific point in the stream without any cross-thread coordination (the
    app runs on the TestClient's portal thread, so the script cannot be appended to from here).

    `after_appends` gates on how many appends the relay has made; `after_silence_ms` gates on how much
    ZEROED audio it has appended, i.e. on the flush having run. The latter is deliberately the gate for
    the post-flush arm: gating that one on an exact append count would couple it to the flush's
    arithmetic (which has its own arms) and, worse, would HANG rather than fail if that arithmetic ever
    shrank.
    """

    event: dict[str, Any] | BaseException
    after_appends: int = 0
    after_silence_ms: float = 0.0
    #: Seconds the ear takes to say it, once due — a SLOW upstream (R86: a late `session.created`).
    delay_s: float = 0.0


def created(**session: Any) -> Say:
    return Say({"type": "session.created", "session": session})


def transcribed(text: str, **gate: Any) -> Say:
    """One completed transcription — the event the relay turns into a `transcript` downlink. Spelled
    once because the event type is long enough that a fourth hand-written copy would be a typo risk."""
    return Say({"type": "conversation.item.input_audio_transcription.completed", "transcript": text}, **gate)


PAD_ERROR = {
    "type": "error",
    "error": {
        "type": "invalid_request_error",
        # `session_event_router.py:36` verbatim — the ONE error the relay must swallow.
        "message": (
            "Specifying `session.turn_detection.prefix_padding_ms` is not supported. "
            "The server either does not support this field or it is not configurable."
        ),
    },
}


class FakeSpeaches:
    """An async-send/recv/close stand-in for a `websockets` client connection.

    Records everything the relay sends (parsed) and replays a scripted event list. When the script is
    exhausted it parks — a live-but-quiet ear, which is what a real session looks like between
    utterances.
    """

    def __init__(self, script: list[Say], *, stall_appends: bool = False, latency: float = 0.0) -> None:
        self.script = script
        self.stall_appends = stall_appends
        #: Seconds each append costs. `stall_appends` is a WEDGED ear (never accepts another append);
        #: this is a SLOW one, which is the interesting case for the queue: a real upstream that lags
        #: keeps the bounded queue full, so the producer's drop-oldest path actually runs and the
        #: interleaving between the relay's two producer paths (mic frames and the flush burst) becomes
        #: observable instead of theoretical.
        self.latency = latency
        self.sent: list[dict[str, Any]] = []
        self.appends: list[bytes] = []
        self.closed = False
        self._i = 0
        self._progress = asyncio.Event()

    # -- the LiveUpstream protocol ------------------------------------------------------------
    async def send(self, message: str) -> None:
        event = json.loads(message)
        if event.get("type") == "input_audio_buffer.append":
            if self.stall_appends:
                await asyncio.Event().wait()  # a wedged ear: never accepts another append
            if self.latency:
                await asyncio.sleep(self.latency)  # a slow ear: the queue fills behind it
            self.appends.append(base64.b64decode(event["audio"]))
            self.sent.append({"type": event["type"]})  # audio elided, like the smoke's Recorder
        else:
            self.sent.append(event)
        self._progress.set()

    async def recv(self) -> str:
        while True:
            if self._i >= len(self.script):
                await asyncio.Event().wait()  # park: quiet, not closed
            entry = self.script[self._i]
            if len(self.appends) >= entry.after_appends and self.silence_ms >= entry.after_silence_ms:
                self._i += 1
                if entry.delay_s:
                    await asyncio.sleep(entry.delay_s)
                if isinstance(entry.event, BaseException):
                    raise entry.event
                return json.dumps(entry.event)
            self._progress.clear()
            await self._progress.wait()

    async def close(self) -> None:
        self.closed = True

    # -- assertions helpers -------------------------------------------------------------------
    @property
    def types(self) -> list[str]:
        return [e.get("type", "") for e in self.sent]

    def one(self, kind: str) -> dict[str, Any]:
        hits = [e for e in self.sent if e.get("type") == kind]
        assert len(hits) == 1, f"expected exactly one {kind}, got {len(hits)}"
        return hits[0]

    @property
    def silence_ms(self) -> float:
        """Milliseconds of all-zero audio appended — the observable trace of a relay-side flush."""
        return sum(len(a) / 2 / SPEACHES_WIRE_RATE * 1000 for a in self.appends if not any(a))


def abrupt_close() -> ConnectionClosedError:
    """The §7-S0 bare-1006 class: the socket dies with no close frame."""
    return ConnectionClosedError(None, None)


def refusal(status: int = 403) -> InvalidStatus:
    """The §7-S0 handshake-refusal class: Speaches answers HTTP 403 for a bad key / unknown model."""
    return InvalidStatus(Response(status, "Forbidden", Headers()))


# ── app builders ──────────────────────────────────────────────────────────────────────────────────


def _voice_client(
    *, stt: bool = True, tts: bool = True, live: bool = True, enabled: bool = True, key: str | None = None
) -> VoiceClient:
    ear = target("speaches", "http://ear:9000/v1", model="parakeet", api_key=key)
    mouth = target("speaches", "http://ear:9000/v1", model="kokoro")
    return VoiceClient(
        (ear,) if stt else (),
        SttPolicy(language="en"),
        (mouth,) if tts else (),
        TtsPolicy(),
        enabled=enabled,
        live=(ear,) if live else (),
        live_policy=LivePolicy(language="en") if live else None,
    )


def _app(
    *,
    client: VoiceClient | None = None,
    live_cfg: dict[str, Any] | None = None,
    connector: Any = None,
    slots: LiveSessionSlots | None = None,
    trail: CallTrail | None = None,
) -> TestClient:
    app = FastAPI()
    app.state.voice = client if client is not None else _voice_client()
    app.state.settings = Settings.model_validate({"voice": {"live": {"enabled": True, **(live_cfg or {})}}})
    app.state.voice_live_slots = slots if slots is not None else LiveSessionSlots()
    if trail is not None:  # D77 — absent, like the connector seam: the relay then writes no trail
        app.state.call_trail = trail
    if connector is not None:
        app.state.voice_live_connect = connector
    app.include_router(voice_api.router, prefix="/api")
    return TestClient(app)


def _fake_app(fake: FakeSpeaches, **kw: Any) -> TestClient:
    async def connect(url: str, headers: dict[str, str], **_kw: Any) -> FakeSpeaches:
        fake.url, fake.headers = url, headers  # type: ignore[attr-defined]
        return fake

    return _app(connector=connect, **kw)


def _ready(ws: Any, rate: int = 48000) -> None:
    """Drive the client handshake to `state: ready` — the preamble of nearly every arm."""
    ws.send_json({"type": "start", "sample_rate": rate})
    assert _json(ws) == {"type": "state", "state": "ready"}


def _pcm(samples: int, value: int = 1000) -> bytes:
    return struct.pack(f"<{samples}h", *([value] * samples))


def _recv(ws: Any, timeout: float = 5.0) -> dict[str, Any]:
    """One raw ASGI message from the server, with a HARD deadline.

    Starlette's own `WebSocketTestSession.receive()` blocks forever. A relay bug — or a deliberately
    broken variant during a red-proof — then HANGS the suite instead of failing it, which is strictly
    worse: CI cannot tell a wedged test from a slow one. Same portal, same stream, plus a deadline.
    """

    async def read() -> dict[str, Any]:
        with anyio.fail_after(timeout):
            return await ws._send_rx.receive()  # noqa: SLF001 — the only bounded read available

    return ws.portal.call(read)


def _json(ws: Any) -> dict[str, Any]:
    """One JSON downlink frame, on the bounded read above; a close arrives as `WebSocketDisconnect`."""
    msg = _recv(ws)
    if msg["type"] == "websocket.close":
        raise WebSocketDisconnect(code=msg.get("code", 1000), reason=msg.get("reason", ""))
    return json.loads(msg["text"])


def _closed(ws: Any) -> tuple[int, str]:
    """Read frames until the server's close, returning `(code, reason)`."""
    for _ in range(200):
        msg = _recv(ws)
        if msg["type"] == "websocket.close":
            return msg.get("code", 0), msg.get("reason", "")
    raise AssertionError("the server never closed")  # pragma: no cover


def _drain_until(ws: Any, kind: str, *, limit: int = 40) -> dict[str, Any]:
    """The next downlink frame of type `kind` (ignoring the ones a test doesn't care about)."""
    for _ in range(limit):
        frame = _json(ws)
        if frame.get("type") == kind:
            return frame
    raise AssertionError(f"no {kind!r} frame within {limit} frames")


# ── 1. protocol ───────────────────────────────────────────────────────────────────────────────────


def test_binary_before_start_is_a_protocol_close() -> None:
    with _fake_app(FakeSpeaches([created()])).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_bytes(_pcm(100))
        assert _json(ws)["code"] == "protocol"
        assert _closed(ws)[0] == 1008


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "hello"},  # not a start
        {"type": "start"},  # no rate
        {"type": "start", "sample_rate": "48000"},  # rate as a string
        {"type": "start", "sample_rate": True},  # a bool is not 1 Hz
        {"type": "start", "sample_rate": 4000},  # under the 8 kHz floor
        {"type": "start", "sample_rate": 192000},  # over the 96 kHz ceiling
    ],
)
def test_malformed_start_is_a_protocol_close(payload: dict[str, Any]) -> None:
    with _fake_app(FakeSpeaches([created()])).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json(payload)
        assert _json(ws)["code"] == "protocol"
        assert _closed(ws)[0] == 1008


def test_non_json_start_is_a_protocol_close() -> None:
    with _fake_app(FakeSpeaches([created()])).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_text("not json at all")
        assert _json(ws)["code"] == "protocol"
        assert _closed(ws)[0] == 1008


def test_unknown_control_and_second_start_are_protocol_closes() -> None:
    for control in ({"type": "commit"}, {"type": "start", "sample_rate": 48000}):
        with _fake_app(FakeSpeaches([created()])).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
            _ready(ws)
            ws.send_json(control)
            assert _json(ws)["code"] == "protocol"
            assert _closed(ws)[0] == 1008


def test_oversized_frame_is_a_protocol_close() -> None:
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"max_frame_bytes": 640})
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        ws.send_bytes(_pcm(400))  # 800 bytes > 640
        frame = _json(ws)
        assert frame["code"] == "protocol" and "max_frame_bytes" in frame["message"]
        assert _closed(ws)[0] == 1008


def test_frame_rate_ceiling_closes_a_flood_but_not_a_compliant_client() -> None:
    """§3.1's ENFORCED ceiling: > 2x the nominal `1000/frame_ms` per second over a 2 s window.

    With `frame_ms: 40` the nominal is 25/s, so the burst budget is 100 frames in 2 s. 60 frames back
    to back is inside it (a jitter catch-up must not be punished); 130 is not.
    """
    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(60):
            ws.send_bytes(_pcm(960))
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
        assert _closed(ws)[0] == 1000

    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(130):
            ws.send_bytes(_pcm(960))
        frame = _drain_until(ws, "error")
        assert frame["code"] == "protocol" and "frame rate" in frame["message"]
        assert _closed(ws)[0] == 1008


def test_a_frame_carrying_too_much_audio_is_a_protocol_close() -> None:
    """The per-frame DURATION cap (S1 review F4). `max_frame_bytes` is a BYTE cap and bounds no amount
    of audio at all: 32 KiB at the 8 kHz floor is 2048 ms in ONE frame, so a fully compliant client
    could ship ~100x realtime and the relay's frame-COUNTED queue depth would be a fiction ("2000 ms"
    of queue holding ~100 s). `FRAME_MS_TOLERANCE x frame_ms` is what makes the depth truthful in
    milliseconds; 2x admits a client that coalesces two frames after a scheduler hiccup, nothing more.
    """
    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        ws.send_bytes(_pcm(12000))  # 500 ms @ 24 kHz = 24 000 bytes: far inside max_frame_bytes
        frame = _drain_until(ws, "error")
        assert frame["code"] == "protocol" and "per-frame ceiling" in frame["message"]
        assert _closed(ws)[0] == 1008


def test_the_audio_rate_ceiling_closes_a_few_huge_frames_but_not_a_realtime_client() -> None:
    """The second budget on the same rolling window (F4): the COUNT budget bounds per-message CPU, the
    MS budget bounds audio THROUGHPUT, and each alone is trivially evaded.

    With `frame_ms` 40 the count budget is 100 frames per 2 s and the ms budget is 4000 ms per 2 s. A
    client sending 80 ms frames (exactly the per-frame ceiling) mounts a 2x-realtime flood with 51
    messages — half the count budget — so counting frames would wave it through.
    """
    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(50):
            ws.send_bytes(_pcm(960))  # 50 x 40 ms = 2000 ms in the window: exactly realtime
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
        assert _closed(ws)[0] == 1000

    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(51):
            ws.send_bytes(_pcm(1920))  # 51 x 80 ms = 4080 ms, in 51 messages
        frame = _drain_until(ws, "error")
        assert frame["code"] == "protocol" and "audio rate" in frame["message"]
        assert _closed(ws)[0] == 1008


# ── 2. origin ─────────────────────────────────────────────────────────────────────────────────────


def test_origin_rules() -> None:
    assert voice_api._origin_allowed(None, "testserver", []) is False  # absent
    assert voice_api._origin_allowed("", "testserver", []) is False
    assert voice_api._origin_allowed("http://evil.example", "testserver", []) is False
    assert voice_api._origin_allowed("http://testserver", "testserver", []) is True
    assert voice_api._origin_allowed("https://emma.ts.net:8443", "emma.ts.net:8443", []) is True
    # the escape hatch is an EXACT string match, never a pattern
    assert voice_api._origin_allowed("https://phone.ts.net", "emma", ["https://phone.ts.net"]) is True
    assert voice_api._origin_allowed("https://phone.ts.net", "emma", ["https://phone.ts.net/"]) is False


def test_absent_and_foreign_origins_are_refused_at_the_handshake() -> None:
    app = _fake_app(FakeSpeaches([created()]))
    for headers in ({}, {"Origin": "http://evil.example"}):
        with pytest.raises(WebSocketDisconnect) as caught:
            with app.websocket_connect("/api/voice/live", headers=headers):
                pass  # pragma: no cover — the handshake must not be accepted
        assert caught.value.code == 1008


def test_a_configured_extra_origin_is_accepted() -> None:
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"allowed_origins": ["https://phone.ts.net"]})
    with app.websocket_connect("/api/voice/live", headers={"Origin": "https://phone.ts.net"}) as ws:
        _ready(ws)


# ── 3. gates ──────────────────────────────────────────────────────────────────────────────────────


def test_feature_disabled_and_no_chain_refuse_the_handshake() -> None:
    for kwargs in (
        {"live_cfg": {"enabled": False}},  # dictation defaults False too — BOTH toggles down (S3.5)
        {"client": _voice_client(live=False)},
        {"client": _voice_client(enabled=False)},  # the voice.enabled MASTER outranks live.enabled
    ):
        app = _fake_app(FakeSpeaches([created()]), **kwargs)  # type: ignore[arg-type]
        with pytest.raises(WebSocketDisconnect) as caught:
            with app.websocket_connect("/api/voice/live", headers=ORIGIN):
                pass  # pragma: no cover
        assert caught.value.code == 1008


def test_tts_unconfigured_drops_the_status_bit_but_not_the_route() -> None:
    """The §5.1 refinement lives on the BIT, not on the route: a call needs the mouth, so the PWA must
    not offer the button — but the relay itself only needs an ear, so the route's gate stays
    `configured("live")`. Two different questions, deliberately answered in two places."""
    app = _fake_app(FakeSpeaches([created()]), client=_voice_client(tts=False))
    assert app.get("/api/voice/status").json()["live"] is False
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)  # the route still admits it


def test_busy_gets_a_typed_error_and_the_slot_is_returned() -> None:
    slots = LiveSessionSlots()
    first = _fake_app(FakeSpeaches([created()]), slots=slots)
    second = _fake_app(FakeSpeaches([created()]), slots=slots)
    with first.websocket_connect("/api/voice/live", headers=ORIGIN) as held:
        _ready(held)
        assert slots.held == 1
        with second.websocket_connect("/api/voice/live", headers=ORIGIN) as busy:
            frame = _json(busy)
            assert (frame["type"], frame["code"]) == ("error", "busy")
            assert _closed(busy)[0] == 1013
        assert slots.held == 1  # the refused connection never took one
        held.send_json({"type": "stop"})
        assert _drain_until(held, "state")["state"] == "ended"
    # …and the slot comes back, so a third call connects
    third = _fake_app(FakeSpeaches([created()]), slots=slots)
    with third.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
    assert slots.held == 0


def test_slots_are_a_synchronous_check_and_set() -> None:
    """The D38 discipline, asserted on the primitive: `acquire` reads the cap passed at call time (so a
    Conf edit applies to the next call) and floors its release at zero."""
    slots = LiveSessionSlots()
    assert slots.acquire(2) and slots.acquire(2)
    assert slots.acquire(2) is False
    slots.release()
    assert slots.acquire(2) is True
    slots.release()
    slots.release()
    slots.release()  # a stray extra release cannot mint capacity
    assert slots.held == 0
    assert slots.acquire(1) and slots.acquire(1) is False


# ── 4. the Speaches wire ──────────────────────────────────────────────────────────────────────────


def test_session_update_carries_the_full_turn_detection_and_the_language() -> None:
    fake = FakeSpeaches([created()])
    app = _fake_app(fake, live_cfg={"vad_threshold": 0.55, "silence_ms": 900})
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
    update = fake.one("session.update")
    # ALL FIVE fields — a partial `turn_detection` validates as NotGiven and is silently dropped
    # (§7-S0 ②), so the threshold would simply never apply.
    assert update["session"]["turn_detection"] == {
        "type": "server_vad",
        "threshold": 0.55,
        "prefix_padding_ms": 0,
        "silence_duration_ms": 900,
        "create_response": False,
    }
    assert update["session"]["input_audio_transcription"] == {"language": "en"}
    assert fake.url.endswith("/v1/realtime?model=parakeet&intent=transcription")
    assert fake.url.startswith("ws://ear:9000/")


@pytest.mark.parametrize("vad", [0.35, "0.5", True, None, 1.5])
def test_a_start_vad_threshold_is_ignored_like_any_unknown_key(vad: Any) -> None:
    """D76 §D — the in-call Silero override is GONE: `start` carries `sample_rate` alone, and a
    `vad_threshold` beside it is treated exactly like every other key `start` does not know — ignored,
    never a protocol close. The one `session.update` sends the CONFIG value whatever the client said
    (a stale client from before the deletion keeps working; it just no longer steers the threshold)."""
    fake = FakeSpeaches([created()])
    app = _fake_app(fake, live_cfg={"vad_threshold": 0.55, "silence_ms": 900})
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "start", "sample_rate": 48000, "vad_threshold": vad})
        assert _json(ws) == {"type": "state", "state": "ready"}
    assert fake.one("session.update")["session"]["turn_detection"]["threshold"] == 0.55


def test_blank_language_omits_the_field_entirely() -> None:
    """Never `null`: Speaches dumps the session with `exclude_defaults`, so a null can neither reset a
    language nor be usefully sent (§7-S0 ②)."""
    fake = FakeSpeaches([created()])
    client = VoiceClient(
        (target("speaches", "http://ear:9000/v1", model="parakeet"),),
        SttPolicy(language=""),
        (target("speaches", "http://ear:9000/v1", model="kokoro"),),
        TtsPolicy(),
        live=(target("speaches", "http://ear:9000/v1", model="parakeet"),),
        live_policy=LivePolicy(language=""),
    )
    with _fake_app(fake, client=client).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
    assert "input_audio_transcription" not in fake.one("session.update")["session"]


def test_appends_are_text_frames_of_base64_resampled_24k_audio() -> None:
    """One binary frame kills a Speaches session (§7-S0 ②), which is why the relay re-encodes; and the
    bytes upstream must be the RESAMPLED ones, matching `Pcm16Resampler` exactly."""
    fake = FakeSpeaches([created()])
    frames = [_pcm(1920, value=v) for v in (1000, -1000, 500)]  # 40 ms @ 48 kHz each
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=48000)
        for frame in frames:
            ws.send_bytes(frame)
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    reference = Pcm16Resampler(48000, SPEACHES_WIRE_RATE)
    assert fake.appends == [reference.feed(f) for f in frames]
    assert fake.types.count("input_audio_buffer.append") == 3


def test_the_spurious_prefix_padding_error_is_swallowed_and_others_are_not() -> None:
    fake = FakeSpeaches(
        [
            created(),
            Say(PAD_ERROR),
            Say({"type": "session.updated", "session": {}}),
            Say({"type": "error", "error": {"type": "server_error", "message": "the ear fell over"}}),
        ]
    )
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        frame = _json(ws)
        # the FIRST error down is the real one — the prefix_padding_ms one never arrives
        assert (frame["code"], frame["message"]) == ("upstream_error", "the ear fell over")
        # …and the session CONTINUES: an upstream error event is not a dead socket
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
        assert _closed(ws)[0] == 1000


def test_speech_events_and_transcripts_flow_down() -> None:
    fake = FakeSpeaches(
        [
            created(),
            Say({"type": "input_audio_buffer.speech_started", "audio_start_ms": 40}, after_appends=1),
            Say({"type": "input_audio_buffer.speech_stopped", "audio_end_ms": 900}, after_appends=2),
            Say({"type": "input_audio_buffer.committed", "item_id": "x"}, after_appends=2),
            transcribed("Wake up corsair.", after_appends=2),
        ]
    )
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        ws.send_bytes(_pcm(960))
        assert _json(ws) == {"type": "speech_started"}
        ws.send_bytes(_pcm(960))
        assert _json(ws) == {"type": "speech_stopped"}
        assert _json(ws) == {
            "type": "transcript",
            "text": "Wake up corsair.",
            "final": True,  # the R70 §9.2 seam — always true in v1 (this ear has no partials)
        }


def test_realtime_url_shapes() -> None:
    assert realtime_url("http://ear:9000/v1", "parakeet") == (
        "ws://ear:9000/v1/realtime?model=parakeet&intent=transcription"
    )
    assert realtime_url("https://ear/v1/", "p").startswith("wss://ear/v1/realtime?")
    # a base without the OpenAI-convention /v1 still just gets /realtime appended
    assert realtime_url("http://ear:9000", "p") == "ws://ear:9000/realtime?model=p&intent=transcription"


# ── 5. COMMIT-SAFETY (the load-bearing invariant) ─────────────────────────────────────────────────


def test_a_full_session_never_commits() -> None:
    """R70 §1.2 arm A / §7-S0 amendment (i): `input_audio_buffer.commit` while a speech segment is open
    trips `assert audio_end_ms is not None` in Speaches, the AssertionError escapes an
    `except openai.APIStatusError`-only catch, and the session dies at a bare 1006 WITH THE WORDS LOST
    (reproduced 2/2 on emma). The relay therefore never commits — not on flush, not on stop, not on
    teardown. Exercised across the whole surface: frames, an open speech segment, a flush, then stop.
    """
    fake = FakeSpeaches(
        [created(), Say({"type": "input_audio_buffer.speech_started", "audio_start_ms": 0}, after_appends=1)]
    )
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(5):
            ws.send_bytes(_pcm(960))
        assert _json(ws) == {"type": "speech_started"}
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    assert "input_audio_buffer.commit" not in fake.types
    assert set(fake.types) == {"session.update", "input_audio_buffer.append"}
    assert fake.closed is True


# ── 6. the flush (R70 §4) ─────────────────────────────────────────────────────────────────────────


def _flush_silence_ms(fed_frames: int, **live_cfg: Any) -> float:
    """Run one session that feeds `fed_frames` of 40 ms audio then flushes, and return how many ms of
    ZEROED audio the flush injected (the mic frames are non-zero, so they are separable)."""
    fake = FakeSpeaches([created()])
    with _fake_app(fake, live_cfg=live_cfg).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(fed_frames):
            ws.send_bytes(_pcm(960, value=2000))
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    quiet = sum(1 for a in fake.appends if not any(a))
    assert len(fake.appends) - quiet == fed_frames, "a mic frame was lost or zeroed"
    return fake.silence_ms


def test_the_flush_burst_is_the_constant_worst_case_pad() -> None:
    """The burst is `max(3000, silence_ms) + 200` REGARDLESS of what was fed (F3, confirm round №2).

    Silero only inspects the trailing 3 s of the buffer and cannot emit `speech_stopped` before the
    buffer exceeds 3000 ms (R70 §1.1), so padding past that line is the only legal way to end a short
    phrase — a commit would kill the session instead. R70's `3000 − fed_ms` shortening is deliberately
    NOT built: the relay cannot keep a per-buffer count (see the mirror arm below), and a constant pad
    costs nothing in latency — Silero endpoints the moment the threshold is crossed mid-burst.
    """
    assert _flush_silence_ms(30, silence_ms=700) == pytest.approx(3200, abs=40)


def test_an_unprocessed_committed_cannot_shorten_the_burst() -> None:
    """The confirm round's MIRROR ordering: Speaches has already committed phrase 1 server-side, but
    the relay's downlink leg has not processed the `committed` event when `flush` arrives. Any
    per-buffer count is then stale HIGH — it still includes phrase 1 — and R70's `3000 − fed_ms`
    collapses toward `silence_ms`: with ~3520 ms counted the burst would be 900 ms against an ear
    buffer holding almost nothing, below the 3 s floor, and the phrase would never endpoint (words
    lost). The constant pad is immune: 88 frames fed, NO `committed` ever delivered, burst still
    max(3000, 700) + 200 = 3200 ms."""
    assert _flush_silence_ms(88, silence_ms=700, relay_queue_ms=8000) == pytest.approx(3200, abs=40)


def test_the_silence_ceiling_keeps_the_burst_at_the_window_pad() -> None:
    """D76 §D bounds `silence_ms` to 500–1200, so even its CEILING sits under Silero's 3 s window and the
    `max()` always lands on the window: the burst stays `3000 + 200` at the longest legal silence. (The
    relay keeps the `max()` — the endpoint needs `silence_ms` of trailing silence, whatever the bound.)"""
    assert _flush_silence_ms(5, silence_ms=1200) == pytest.approx(3200, abs=40)


def test_flush_with_nothing_fed_injects_nothing() -> None:
    assert _flush_silence_ms(0) == 0


def test_a_post_flush_endpoint_flows_down_as_a_final_transcript() -> None:
    """The flush produces no ack of its own: the ordinary downlink carries what the ear then says."""
    fake = FakeSpeaches(
        [
            created(),
            Say(
                {"type": "input_audio_buffer.speech_stopped", "audio_end_ms": 1200},
                after_silence_ms=200,
            ),
            transcribed("I want the text to appear in the composer while I talk.", after_silence_ms=200),
        ]
    )
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(10):
            ws.send_bytes(_pcm(960, value=2000))
        ws.send_json({"type": "flush"})
        assert _drain_until(ws, "speech_stopped")["type"] == "speech_stopped"
        final = _drain_until(ws, "transcript")
        assert final["final"] is True and final["text"].startswith("I want the text")
    assert "input_audio_buffer.commit" not in fake.types


def test_a_flush_burst_is_delivered_in_full_before_mic_audio_resumes() -> None:
    """F2: flush completion is a DELIVERY barrier, not an enqueue barrier.

    The burst and the mic share the one bounded queue, and the mic path drops the OLDEST item when it
    is full. So a flush that returned as soon as its frames were QUEUED would hand the reader straight
    back to the mic, whose next frames evict the burst's own tail: the silence lands upstream SHORT of
    the 3 s VAD floor, no `speech_stopped` ever fires and the phrase is never transcribed (the
    reviewer's repro delivered 2760 of 3000 ms). `Queue.join()` is the barrier, and the reader being
    parked on it is also what stops a mic frame from even being READ while the burst drains.

    The rig: a SLOW ear (1 ms per append) so the queue really is full behind the burst, a 400 ms
    (depth 10) queue so eviction is cheap to reach, and 30 mic frames sent with no pause after the
    flush control — i.e. exactly what a phone in call mode does.
    """
    fake = FakeSpeaches([created()], latency=0.001)
    app = _fake_app(fake, live_cfg={"relay_queue_ms": 400, "frame_ms": 40})  # depth 10
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(2):
            ws.send_bytes(_pcm(960, value=2000))  # 80 ms fed
        ws.send_json({"type": "flush"})
        for _ in range(30):
            ws.send_bytes(_pcm(960, value=3000))  # the mic does not wait for the flush
        ws.send_json({"type": "stop"})
        assert _closed(ws)[0] == 1000
    # max(3000, 700) + 200 = 3200 ms — the constant pad — every millisecond of it DELIVERED…
    assert fake.silence_ms == pytest.approx(3200, abs=1)
    # …as one uninterrupted run right behind the two mic frames, which is the observable form of "the
    # flush had not returned yet": 2 mic frames, then 80 x 40 ms of silence, and only then anything.
    assert len(fake.appends) >= 82
    assert [any(a) for a in fake.appends[:82]] == [True, True] + [False] * 80


def test_a_flush_after_an_overflow_still_completes() -> None:
    """The eviction path's half of the barrier's bookkeeping. An item the mic path drops is one the
    uplink leg will never mark done, so `_enqueue` marks it there. Miss that call and `Queue.join()`
    waits on a counter that can never reach zero: the next flush parks forever, `stop` is never read
    and the call hangs to `max_session_s`. Add an extra one and a later join returns early or raises.
    So: overflow first, then a flush, then a clean end — the arm is the ORDER, not the burst size
    (which `fed_ms`'s give-back makes eviction-dependent by design)."""
    fake = FakeSpeaches([created()], latency=0.001)
    app = _fake_app(fake, live_cfg={"relay_queue_ms": 200, "frame_ms": 40})  # depth 5
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(40):
            ws.send_bytes(_pcm(960, value=2000))
        assert _drain_until(ws, "state")["state"] == "degraded"
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        # Straight to the close: a SLOW ear overflows in several bursts, so more `degraded` frames may
        # follow, and what is under test is that the session reaches a clean end at all.
        assert _closed(ws)[0] == 1000
    assert fake.silence_ms > 0


def test_a_stale_committed_does_not_suppress_the_next_phrases_flush() -> None:
    """F3, the reviewer's PURE repro: phrase 2's frames are accepted, THEN phrase 1's `committed`
    lands (Speaches' own post-`speech_stopped` buffer rotation racing the uplink), then `flush` —
    with NO mic frame in between, which is exactly the release ordering (capture stops, then flush).
    The stale commit zeroes `_fed_ms`; under any guard that a commit can clear, this flush was a
    NO-OP: nothing injected, no endpoint, the words never transcribed. The never-cleared
    `_audio_seen` latch is what keeps the burst going.

    The transcript is the barrier: receiving it downstream proves the `committed` queued ahead of it
    was handled, so the flush below genuinely lands after the reset with no `speech_started` and no
    further frame between.
    """
    fake = FakeSpeaches(
        [
            created(),
            Say({"type": "input_audio_buffer.committed", "item_id": "p1"}, after_appends=2),
            transcribed("phrase one", after_appends=2),
        ]
    )
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(2):
            ws.send_bytes(_pcm(960, value=2000))
        assert _drain_until(ws, "transcript")["text"] == "phrase one"
        ws.send_json({"type": "flush"})  # straight after the stale commit — nothing re-arms anything
        ws.send_json({"type": "stop"})
        assert _closed(ws)[0] == 1000
    # The constant pad: max(3000, 700) + 200 — a long burst costs ~1 s of loopback work, a short
    # (or suppressed) one costs the words.
    assert fake.silence_ms == pytest.approx(3200, abs=1)
    assert "input_audio_buffer.commit" not in fake.types


def test_a_frame_too_short_to_resample_still_counts_as_audio_fed() -> None:
    """The latch's own ground, and why it is armed at ACCEPT rather than derived from what was
    enqueued: a frame can be accepted without producing any output. One sample at a downsampling
    ratio resamples to nothing — `Pcm16Resampler` CARRIES it as phase rather than discarding it — so
    any enqueued-bytes view reads 0 over audio that is really in flight, and a guard built on it
    turned the flush behind it into a no-op."""
    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=48000)  # 48 k -> 24 k: one sample has no right neighbour to interpolate to
        ws.send_bytes(_pcm(1))
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        assert _closed(ws)[0] == 1000
    assert all(not any(a) for a in fake.appends)  # the carried sample produced no append of its own
    assert fake.silence_ms == pytest.approx(3200, abs=1)  # max(3000 - 0, 700) + 200


def test_a_flush_after_a_commit_still_bursts() -> None:
    """Burst-when-uncertain (F3 micro-wave): a commit does NOT re-arm the no-op — the relay cannot
    tell a covering commit (nothing pending; a burst is wasted work) from a stale one (phrase-2 audio
    pending; a no-op loses the words), so it always bursts once any audio was ever fed. The wasted
    case costs ~80 sub-ms loopback appends into a silent buffer and raises no VAD event downstream;
    the suppressed case would violate never-lose-speech. The only relay-side no-op left is the
    never-fed session (`test_flush_with_nothing_fed_injects_nothing`)."""
    fake = FakeSpeaches(
        [
            created(),
            Say({"type": "input_audio_buffer.committed", "item_id": "p1"}, after_appends=1),
            transcribed("phrase one", after_appends=1),
        ]
    )
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        ws.send_bytes(_pcm(960, value=2000))
        assert _drain_until(ws, "transcript")["text"] == "phrase one"
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        assert _closed(ws)[0] == 1000
    assert fake.silence_ms == pytest.approx(3200, abs=1)  # the constant pad: max(3000, 700) + 200


def test_multiple_flushes_are_legal() -> None:
    fake = FakeSpeaches([created()])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        ws.send_bytes(_pcm(960, value=2000))
        ws.send_json({"type": "flush"})
        ws.send_bytes(_pcm(960, value=2000))
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    assert "input_audio_buffer.commit" not in fake.types
    assert len(fake.appends) > 2


# ── 7. backpressure ───────────────────────────────────────────────────────────────────────────────


def test_a_stalled_upstream_drops_the_oldest_and_says_so_once() -> None:
    """§3.1/F6: the bounded relay queue is the ONLY backpressure in the chain (Speaches' pubsub queues
    are unbounded and the browser's `send()` has no awaitable backpressure), so it must drop the
    OLDEST audio and surface a `degraded` state — never stall, and never go quiet about it."""
    fake = FakeSpeaches([created()], stall_appends=True)
    app = _fake_app(fake, live_cfg={"relay_queue_ms": 200, "frame_ms": 40})  # depth 5
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(20):
            ws.send_bytes(_pcm(960))
        degraded = _drain_until(ws, "state")
        assert degraded == {"type": "state", "state": "degraded", "reason": "overflow"}
        # ONE per burst, not one per dropped frame: the session is still alive and still ends cleanly
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
        assert _closed(ws)[0] == 1000


# ── 8. the error taxonomy ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("failure", "fragment"),
    [(refusal(403), "HTTP 403"), (OSError("Connection refused"), "unreachable")],
)
def test_handshake_failures_are_upstream_refused(failure: BaseException, fragment: str) -> None:
    """§7-S0 ②: a 403 upgrade rejection (bad key / unknown model) and an unreachable box are two
    operator problems under one code — the client's move is the same either way (push-to-talk)."""

    async def connect(*_a: Any, **_kw: Any) -> Any:
        raise failure

    with _app(connector=connect).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "start", "sample_rate": 48000})
        frame = _json(ws)
        assert frame["code"] == "upstream_refused" and fragment in frame["message"]
        assert "speaches" in frame["message"]  # the provider NAME, never the key or the exception text
        assert _closed(ws)[0] == 1011


def test_an_abrupt_upstream_close_is_upstream_lost() -> None:
    fake = FakeSpeaches([created(), Say(abrupt_close())])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        frame = _drain_until(ws, "error")
        assert frame["code"] == "upstream_lost" and "1006" in frame["message"]
        assert _closed(ws)[0] == 1011


def test_a_coded_upstream_close_reports_its_code() -> None:
    closed = ConnectionClosedError(Close(1011, "internal"), None)
    fake = FakeSpeaches([created(), Say(closed)])
    with _fake_app(fake).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        assert "1011" in _drain_until(ws, "error")["message"]


def test_the_session_deadline_ends_the_call_with_session_limit() -> None:
    """`max_session_s` bounds the whole session. Assigned past the config floor (`ge=10`) on purpose:
    the FLOOR is a Conf-surface guard against a wedged value, while what is under test is the deadline
    mechanism, which a 10 s test would only make slow."""
    fake = FakeSpeaches([created()])
    app = _fake_app(fake)
    app.app.state.settings.voice.live.max_session_s = 1  # past the ge=10 floor — see the docstring
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        frame = _drain_until(ws, "error")
        assert (frame["code"], frame["message"]) == ("session_limit", "call time limit reached")
        assert _closed(ws)[0] == 1000


def test_a_leg_whose_uplink_goes_silent_is_reaped_not_held_to_the_session_limit() -> None:
    """R86 LC-8 — the client ships a frame every `frame_ms` (held and muted frames go up as silence),
    so a leg with NO binary frame for `uplink_idle_s` is a frozen page or a dead ear. It used to hold
    the single slot to `max_session_s`. Assigned past the `ge=5` floor, as the deadline arm above does:
    the floor guards Conf, the mechanism is what is under test."""
    fake = FakeSpeaches([created()])
    app = _fake_app(fake)
    app.app.state.settings.voice.live.uplink_idle_s = 0.3  # past the ge=5 floor — see the docstring
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)
        for _ in range(3):
            ws.send_bytes(_pcm(960))  # a live page for a moment…
        frame = _drain_until(ws, "error")  # …then nothing: the page froze
        assert frame == {
            "type": "error",
            "code": "session_limit",
            "message": "no audio from the phone for 0.3s — the call was ended",
        }
        assert _closed(ws) == (1000, "uplink idle")
    assert len(fake.appends) >= 1  # the audio it DID send went up; this is a reaper, not a refusal


def test_a_leg_that_keeps_sending_is_never_reaped_and_the_clock_starts_at_the_pump() -> None:
    """…and the other side of the same bound, with the auditor's slow-upstream case folded in (R86
    test 5): `session.created` 2.5 s late — the handshake window the client now sits out (LC-5's
    latch, pinned FE-side) — neither counts against the phone nor bursts anything: the clock starts
    when the relay starts READING, and a client that streams from `ready` stays inside every budget."""
    fake = FakeSpeaches([Say({"type": "session.created", "session": {}}, delay_s=2.5)])
    app = _fake_app(fake)
    app.app.state.settings.voice.live.uplink_idle_s = 1  # far under the 2.5 s handshake
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws, rate=SPEACHES_WIRE_RATE)  # 2.5 s — no audio sent before it, as the latch rules
        for _ in range(50):
            ws.send_bytes(_pcm(960))  # 2000 ms of audio at once: inside the 4000 ms/2 s budget
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
        assert _closed(ws)[0] == 1000


def test_uplink_idle_s_is_a_bounded_server_knob_that_outlasts_the_tail_wait() -> None:
    assert LiveCfg().uplink_idle_s == 15
    for bad in (4, 121):
        with pytest.raises(ValidationError):
            LiveCfg(uplink_idle_s=bad)
    # A dictation release sends `flush` and then no audio until its tail — a reaper inside that wait
    # would end the leg the last phrase is due on, so the pair is refused at load (a Conf 422).
    with pytest.raises(ValidationError, match="must outlast tail_wait_ms"):
        LiveCfg(uplink_idle_s=5, tail_wait_ms=5000)
    assert LiveCfg(uplink_idle_s=5, tail_wait_ms=4999).uplink_idle_s == 5
    # a SERVER knob — never delivered to the client
    assert "uplink_idle_s" not in _app().get("/api/voice/status").json()["live_call"]


#: The frontend tree the parity arm below reads. The status payload is delivered TO it, so it is the
#: only place a reader can be.
_FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
#: THE LIVE-CALL CONSUMERS — the only files a `.<key>` hit counts in (R88 confirm round: a scan of the
#: whole tree let any same-named property anywhere, e.g. an art `.background`, stand in for a reader).
#: Each is here because `live_call` (or a value lifted off it) flows into it:
_LIVE_CALL_READERS = (
    "hooks/useLiveCall.ts",  # the call machine — reads the knobs object itself
    "hooks/useDictation.ts",  # streaming dictation — `useComposer` hands it `live_call`
    "lib/audioController.ts",  # the mouth the call drives (setCallVoice & co.)
    "lib/levelGate.ts",  # the D76 §C gate — handed the gate knobs as a cfg object
    "lib/liveSocket.ts",  # the socket leg — handed the uplink knobs
    "lib/callTrail.ts",  # the D77 trail — gated on `debug`
    "lib/callCue.ts",  # the drop cue the transcript gate plays
    "lib/pcmCapture.ts",  # the capture — handed `frame_ms` and the route pair
    "theme-engine/kit/CallOverlay.tsx",  # the call screen — `ring`, `captions`, the deck's readouts
    "theme-engine/kit/composer/useMicGesture.ts",  # the mic gesture — the call's entry
    "theme-engine/kit/composer/MicGestureChrome.tsx",  # …and its chrome
)
# NOT readers, deliberately absent from the list: `hooks/useVoiceStatus.ts` (the wire TYPE declaring
# every key), and `hooks/useSettings.ts` + `tabs/ConfTab.tsx` (they read `voice.live` from the whole
# config document, `GET /settings`, never from `/voice/status`).
#: `LiveCfg`'s SERVER-only knobs (its docstring's split): the relay's caps and the two that ride
#: `session.update`. `frame_ms` is a server cap the client ALSO paces by, so it is not listed.
_SERVER_ONLY = {
    "vad_threshold",
    "silence_ms",
    "max_frame_bytes",
    "max_session_s",
    "max_sessions",
    "relay_queue_ms",
    "start_timeout_s",
    "uplink_idle_s",
    "allowed_origins",
    "trail_keep",
}


def test_every_delivered_live_call_field_has_a_browser_reader() -> None:
    """R88 — `/voice/status.live_call` is a CONTRACT with the browser: every field it delivers is one
    something in `frontend/src` reads as a property (`.<key>`), and no server-only knob rides it. A
    delivered-but-unread field is one a later reader trusts without anyone having tested it (the
    route once carried `max_session_s` and `vad_threshold`, which nothing read). Textual on purpose —
    the cheapest honest check that runs in the backend gate — and SCOPED to the live-call consumers,
    so a same-named property elsewhere in the app cannot stand in for a reader."""
    delivered = set(_app().get("/api/voice/status").json()["live_call"])
    assert not delivered & _SERVER_ONLY, f"server-only knobs delivered: {sorted(delivered & _SERVER_ONLY)}"
    readers = "\n".join((_FRONTEND_SRC / rel).read_text(encoding="utf-8") for rel in _LIVE_CALL_READERS)
    unread = sorted(k for k in delivered if not re.search(rf"\.{re.escape(k)}\b", readers))
    assert not unread, f"delivered in live_call with no reader among the live-call consumers: {unread}"


def test_the_example_configs_live_block_is_an_inventory_of_livecfg() -> None:
    """R88 — `config.example.yaml` is the owner's bootstrap, and a config SAMPLE is an inventory (the
    plan's §5.1 rule): its `voice.live` block carries EXACTLY `LiveCfg`'s own fields. Both directions:
    `LiveCfg` ALLOWS extra keys (the house `extra="allow"`), so a stale or misspelt key would load
    silently and do nothing; and a knob missing from the sample is one the owner never learns exists.
    The inherited pointer + transport fields (`VoiceServiceCfg`'s — computed, not hand-listed) are
    shown commented or optional like stt/tts, so they are neither required nor refused. The whole
    file's validation is QH-8's (`test_config_example_qh8.py`)."""
    example = Path(__file__).resolve().parents[2] / "config.example.yaml"
    raw = yaml.safe_load(example.read_text(encoding="utf-8"))
    live = raw["voice"]["live"]
    Settings.model_validate({"voice": {"live": live}})  # raises on a bad value
    inherited = set(VoiceServiceCfg.model_fields)
    own = set(LiveCfg.model_fields) - inherited
    keys = set(live) - inherited
    assert not keys - own, (
        f"config.example.yaml voice.live carries keys LiveCfg does not declare: {sorted(keys - own)}"
    )
    assert not own - keys, f"config.example.yaml voice.live is missing LiveCfg fields: {sorted(own - keys)}"


def test_no_start_within_the_timeout_is_a_protocol_close() -> None:
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"start_timeout_s": 0.05})
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        frame = _json(ws)
        assert frame["code"] == "protocol" and "start" in frame["message"]
        assert _closed(ws)[0] == 1008


# ── 9. secrets ────────────────────────────────────────────────────────────────────────────────────


def _assert_no_canary(caplog: pytest.LogCaptureFixture, frames: list[dict[str, Any]]) -> None:
    logged = "\n".join(r.getMessage() for r in caplog.records) + "\n".join(
        str(r.args) for r in caplog.records
    )
    assert SECRET not in logged, "the bearer reached a log record"
    assert SECRET not in json.dumps(frames), "the bearer reached a downlink frame"


def test_the_bearer_never_reaches_a_log_or_a_downlink_frame(caplog: pytest.LogCaptureFixture) -> None:
    """The A11 rule, forced through every failure class the relay has. The key is unwrapped exactly
    once at the connect call; nothing below may quote an exception's TEXT, which is why the taxonomy
    reports a provider name and an exception TYPE instead."""
    caplog.set_level(logging.DEBUG)
    client = _voice_client(key=SECRET)
    frames: list[dict[str, Any]] = []

    # (a) the handshake refusal + (b) unreachable — both carry the target, so both are the risky ones
    for failure in (refusal(403), OSError(f"cannot reach {SECRET}@ear")):

        async def connect(*_a: Any, __f: BaseException = failure, **_kw: Any) -> Any:
            raise __f

        with _app(client=client, connector=connect).websocket_connect(
            "/api/voice/live", headers=ORIGIN
        ) as ws:
            ws.send_json({"type": "start", "sample_rate": 48000})
            frames.append(_json(ws))
            _closed(ws)

    # (c) a live session that dies, (d) an upstream error event, (e) a protocol error
    fake = FakeSpeaches(
        [created(), Say({"type": "error", "error": {"message": "nope"}}), Say(abrupt_close())]
    )
    with _fake_app(fake, client=client).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        frames.append(_json(ws))
        frames.append(_drain_until(ws, "error"))
        _closed(ws)
    with _fake_app(FakeSpeaches([created()]), client=client).websocket_connect(
        "/api/voice/live", headers=ORIGIN
    ) as ws:
        ws.send_bytes(b"\x00\x00")
        frames.append(_json(ws))
        _closed(ws)

    _assert_no_canary(caplog, frames)
    # …and the header the relay DID build carried it, so the assertion above is not vacuous
    assert fake.headers == {"Authorization": f"Bearer {SECRET}"}  # type: ignore[attr-defined]


# ── 10. /voice/status ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("kwargs", "live_enabled", "expected"),
    [
        ({}, True, True),
        ({"enabled": False}, True, False),  # the voice.enabled MASTER
        ({}, False, False),  # the feature toggle
        ({"live": False}, True, False),  # no realtime chain
        ({"tts": False}, True, False),  # no mouth (§5.1 refinement)
        ({"stt": False}, True, True),  # push-to-talk STT is irrelevant to the call
    ],
)
def test_the_live_bit_truth_table(kwargs: dict[str, Any], live_enabled: bool, expected: bool) -> None:
    app = _app(client=_voice_client(**kwargs), live_cfg={"enabled": live_enabled})
    body = app.get("/api/voice/status").json()
    assert body["live"] is expected
    # the older bits are untouched by any of this
    assert body["stt"] is (kwargs.get("stt", True) and kwargs.get("enabled", True))
    assert body["tts"] is (kwargs.get("tts", True) and kwargs.get("enabled", True))


def test_status_carries_the_client_side_call_knobs() -> None:
    app = _app(
        live_cfg={
            "frame_ms": 100,
            "buffered_ceiling_ms": 1500,
            "call_backlog_ms": 1200,
            "min_speech_ms": 250,
            "barge_in": False,
            "vad_threshold": 0.7,
            "min_final_ms": 350,
            "noise_verdict_ms": 1500,
            "debug": True,
            "ring": False,
            "captions": False,
            "mic_hold": "on",
            "floor_dbfs": -40.0,
            "noise_margin_db": 12.0,
            "voice_margin_db": 8.0,
            "playback_margin_db": 6.0,
            "min_dbfs": -70.0,
            "max_dbfs": -25.0,
            "route": "call",
            "input_device": "dev-42",
            "background": False,
            "background_keepalive": False,
            "background_idle_s": 0,
            "max_session_s": 900,
            "dictation": True,
            "tail_wait_ms": 2500,
            "dictation_idle_s": 20,
            "dictation_max_s": 300,
        }
    )
    body = app.get("/api/voice/status").json()
    assert body["live_call"] == {
        "frame_ms": 100,
        "buffered_ceiling_ms": 1500,
        # A-F2 — the call pacer's backlog bound. A CLIENT knob like its neighbours: the pacer runs in
        # the browser, so nothing below it reads this and it has to arrive here or be defaulted twice.
        "call_backlog_ms": 1200,
        "min_speech_ms": 250,
        "barge_in": False,
        # D74 (evidence docs/research/R76) — the near-speech gate on a committed turn and the
        # calibration readout beside it. CLIENT knobs like every neighbour: the energy they judge is
        # measured in the browser, and the server VAD has no field that could express either.
        "min_final_ms": 350,
        # …and the NOISE VERDICT beside it (the owner's 2026-09-26 ruling): how long an open segment
        # runs before the browser judges it by that same gate — a CLIENT knob for the same reason.
        "noise_verdict_ms": 1500,
        "debug": True,
        "ring": False,
        # The call screen's two PRESENTATION knobs travel together (owner ask 2026-09-22): what the
        # overlay draws over the art, and whether it draws the reply the browser already holds.
        "captions": False,
        # D76 §B — the mic hold while the reply plays.
        "mic_hold": "on",
        # D76 §C (R83) — the relative gate: bootstrap ceiling, three margins, two clamp bounds. CLIENT
        # knobs: the level they gate on is measured in the browser.
        "floor_dbfs": -40.0,
        "noise_margin_db": 12.0,
        "voice_margin_db": 8.0,
        "playback_margin_db": 6.0,
        "min_dbfs": -70.0,
        "max_dbfs": -25.0,
        # D73 S5 — the capture pair. CLIENT knobs like their neighbours: they are `getUserMedia`
        # arguments, so nothing below the browser reads them and they have to arrive here or be
        # defaulted twice (the call's ear and dictation's open with the SAME two).
        "route": "call",
        "input_device": "dev-42",
        # D73 S6 — the background three. CLIENT knobs again: only the browser can see a page go
        # hidden, keep its audio graph audible, or time out a call nobody is talking to.
        "background": False,
        "background_keepalive": False,
        "background_idle_s": 0,
        # S2.5 — the dictation four ride the SAME object (one ear, one set of client knobs). Nothing
        # in `useDictation`'s streaming branch may default one of these; they all arrive here.
        "dictation": True,
        "tail_wait_ms": 2500,
        "dictation_idle_s": 20,
        "dictation_max_s": 300,
    }
    # shape only: nothing here names an endpoint, a model or a key (the `stt_auto_stop` precedent)
    assert not {"provider", "model", "base_url", "api_key"} & set(body["live_call"])


@pytest.mark.parametrize(
    ("kwargs", "live_cfg", "ear", "call"),
    [
        ({}, {"enabled": True}, True, True),
        ({"enabled": False}, {"enabled": True}, False, False),  # the voice.enabled MASTER outranks both
        ({}, {"enabled": False}, False, False),  # both feature toggles off
        ({"live": False}, {"enabled": True}, False, False),  # no realtime chain = no ear at all
        # THE ARM THAT MAKES THE TWO BITS DIFFERENT (S2.5): with TTS unconfigured the CALL bit falls
        # (§5.1 — a call with nothing to say back is not a call) while the EAR bit stands, because
        # dictation fills the composer and needs no mouth. A `live_ear` that merely aliased `live`
        # would leave streaming dictation unreachable on a TTS-less install; this is the red-proof.
        ({"tts": False}, {"enabled": True}, True, False),
        ({"stt": False}, {"enabled": True}, True, True),  # push-to-talk STT is irrelevant to the realtime leg
        # THE S3.5 ARMS: `dictation` ALONE opens the ear (the route gate's OR) while the CALL bit
        # stays down — streaming dictation is an STT-facing feature and must not require the call
        # toggle. The MASTER and the missing-chain refusals outrank it exactly as they do `enabled`.
        ({}, {"enabled": False, "dictation": True}, True, False),
        ({"enabled": False}, {"enabled": False, "dictation": True}, False, False),
        ({"live": False}, {"enabled": False, "dictation": True}, False, False),
    ],
)
def test_the_live_ear_bit_mirrors_the_route_gate(
    kwargs: dict[str, Any], live_cfg: dict[str, Any], ear: bool, call: bool
) -> None:
    """`live_ear` answers the WS route's own question — "would this socket be admitted?" — and so it
    carries the route's terms and NOT the call bit's third (TTS). Both bits are asserted in every
    arm so a future edit cannot quietly collapse one into the other."""
    app = _app(client=_voice_client(**kwargs), live_cfg=live_cfg)
    body = app.get("/api/voice/status").json()
    assert body["live_ear"] is ear
    assert body["live"] is call


def test_the_live_ear_bit_and_the_route_agree_on_the_same_install() -> None:
    """The mirror, exercised rather than asserted: the bit says yes and the route takes the socket."""
    app = _fake_app(FakeSpeaches([created()]), client=_voice_client(tts=False))
    assert app.get("/api/voice/status").json()["live_ear"] is True
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)


def test_dictation_alone_admits_the_socket_with_the_call_disabled() -> None:
    """The S3.5 red-proof, exercised end to end: `enabled: false, dictation: true` and the route
    still takes the socket (the OR is load-bearing — revert the route gate to `cfg.enabled and …`
    and this hangs up pre-accept). The call bit stays down, so no call door appears."""
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"enabled": False, "dictation": True})
    body = app.get("/api/voice/status").json()
    assert body["live_ear"] is True
    assert body["live"] is False
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)


# ── 11. the registry ──────────────────────────────────────────────────────────────────────────────


def _settings(live: dict[str, Any]) -> Settings:
    return Settings.model_validate(
        {
            "providers": {
                "ear": {"base_url": "http://ear:9000/v1", "models": {"parakeet": {}}},
                "spare": {"base_url": "http://spare:9000/v1", "models": {"whisper": {}}},
            },
            "voice": {
                "stt": {"provider": "ear", "model": "parakeet", "language": "de", "timeout_s": 45},
                "live": live,
            },
        }
    )


def test_a_blank_live_provider_rides_the_stt_section() -> None:
    reg, warnings = resolve_lenient(_settings({}))
    assert reg.live_chain == reg.stt_chain
    assert reg.live_chain[0].provider == "ear"
    assert reg.live_policy is not None
    # the policy follows the section that actually resolved — stt's language AND its transport pair
    assert (reg.live_policy.language, reg.live_policy.timeout_s) == ("de", 45.0)
    assert not warnings


def test_an_explicit_live_provider_builds_its_own_chain() -> None:
    reg, _ = resolve_lenient(_settings({"provider": "spare", "model": "whisper", "timeout_s": 12}))
    assert [t.provider for t in reg.live_chain] == ["spare"]
    assert reg.live_chain != reg.stt_chain
    assert reg.live_policy is not None
    # `LiveCfg` has no language of its own, so the ear keeps ONE language knob: voice.stt's
    assert (reg.live_policy.language, reg.live_policy.timeout_s) == ("de", 12.0)


def test_live_fallbacks_without_a_primary_are_still_judged() -> None:
    """Reusing stt's chain for a blank primary must not swallow the C5 blank-primary-with-fallbacks
    verdict — so a live section that declares only fallbacks is built (and promoted/warned) as its own."""
    reg, warnings = resolve_lenient(_settings({"fallbacks": [{"provider": "spare", "model": "whisper"}]}))
    assert [t.provider for t in reg.live_chain] == ["spare"]
    assert any("voice.live primary blank" in w for w in warnings)


def test_a_broken_live_ref_is_reported_against_voice_live() -> None:
    reg, warnings = resolve_lenient(_settings({"provider": "ghost"}))
    assert reg.live_chain == ()
    assert any("voice.live primary provider 'ghost'" in w for w in warnings)


def test_reg_helper_registries_stay_valid() -> None:
    """`tests/_reg.py` builds inference-only registries; the new fields must default, not break it."""
    reg = inference_registry([target("local", "http://local/v1")])
    assert reg.live_chain == () and reg.live_policy is None
    assert VoiceClient((), SttPolicy(), (), TtsPolicy()).configured("live") is False


# ── 12. config ────────────────────────────────────────────────────────────────────────────────────


def test_live_config_defaults() -> None:
    cfg = LiveCfg()
    assert cfg.enabled is True  # ON since v1.7.8 (S4 closed 2026-09-26); the toggle itself stays
    # the two session.update knobs — D76 §D: 0.6 (R84; the old 0.9 put Silero's END threshold at the cliff)
    assert (cfg.vad_threshold, cfg.silence_ms) == (0.6, 700)
    assert (cfg.frame_ms, cfg.max_frame_bytes, cfg.max_sessions) == (40, 32768, 1)
    assert cfg.max_session_s == 1800  # aligned with Speaches' own 30-min hard expiry
    assert (cfg.min_speech_ms, cfg.buffered_ceiling_ms) == (300, 1000)
    # `barge_in` ships OFF since the 2026-09-22 owner re-ruling (voice interrupt verified at the
    # calibration, then ruled an opt-in rather than the resting state).
    assert (cfg.barge_in, cfg.ring, cfg.mic_hold) == (False, True, "auto")
    # D76 §C (R83) — the relative gate's six, all dB: the bootstrap ceiling, three margins, two bounds.
    assert (cfg.floor_dbfs, cfg.min_dbfs, cfg.max_dbfs) == (-45.0, -60.0, -20.0)
    assert (cfg.noise_margin_db, cfg.voice_margin_db, cfg.playback_margin_db) == (10.0, 10.0, 10.0)
    # D74 — the gate ships ON at 200 ms (a real default, not 0: R76 measured speech-like interference
    # passing the server VAD outright), and the debug readout ships OFF like every diagnostic here.
    assert (cfg.min_final_ms, cfg.debug) == (200, False)
    # The noise verdict ships at 1 s: a segment still sounding a second in, with less than
    # `min_final_ms` of accrual, is noise and stops holding the reply (the owner's 2026-09-26 ruling).
    assert cfg.noise_verdict_ms == 1000
    # D76 §A — the capture pair ships as `media` on the system default device: EC off ⇒ media-path
    # audio following the system's own routing (the 2026-09-23 device probe's verdict). `call`
    # (platform AEC, comm mode) is the owner's pick.
    assert (cfg.route, cfg.input_device) == ("media", "")
    # D73 S6 — a hidden page KEEPS the call by default (R75: nothing in the platform ends it, and
    # 5/5 field projects keep it), with the freeze defeat on and the owner's 10-minute idle bound.
    assert (cfg.background, cfg.background_keepalive, cfg.background_idle_s) == (True, True, 600)
    assert (cfg.relay_queue_ms, cfg.start_timeout_s, cfg.allowed_origins) == (2000, 5.0, [])
    assert cfg.provider is None and cfg.fallbacks == []  # blank ⇒ resolve like stt
    # S2.5 — the dictation four. `dictation` ships OFF beside `enabled` (its own whole-feature toggle),
    # and the three numbers are R70 §4/§9.3's measured defaults.
    assert cfg.dictation is False
    assert (cfg.tail_wait_ms, cfg.dictation_idle_s, cfg.dictation_max_s) == (2000, 15, 120)


@pytest.mark.parametrize(
    "bad",
    [
        # D76 §D (R84) — Silero re-bounded 0.5–0.8, the silence run 500–1200.
        {"vad_threshold": 0.49},
        {"vad_threshold": 0.81},
        {"vad_threshold": 0.9},
        {"silence_ms": 499},
        {"silence_ms": 1201},
        {"frame_ms": 1},
        {"max_frame_bytes": 0},
        {"max_sessions": 0},
        {"max_sessions": 99},
        {"relay_queue_ms": 10},
        {"start_timeout_s": 0},
        {"mic_hold": "sometimes"},
        # D73 S5 — the route is a CLOSED SET, not free text: the client branches on it, and an
        # unlisted spelling would silently resolve to one branch while Conf showed something else.
        # D76 §A narrowed it to media/call; the pre-D76 spellings are the migration's, never the model's.
        {"route": "earpiece"},
        {"route": "speaker"},
        {"route": "speaker-hifi"},
        {"route": "headphones"},
        # D76 §C — the gate's dB knobs: margins 0–40 dB, levels within −90..0 dBFS.
        {"noise_margin_db": -1},
        {"voice_margin_db": 41},
        {"playback_margin_db": -0.5},
        {"floor_dbfs": 1},
        {"min_dbfs": -91},
        {"max_dbfs": 0.5},
        {"max_session_s": 5},
        # S2.5 — the dictation knobs are bounded for the same reason their neighbours are: a value
        # outside them wedges the mic (a 0 ms tail wait discards every trailing phrase; a 1 s idle
        # stop ends a session between two words; a 0 s cap opens a socket that closes immediately).
        {"tail_wait_ms": 0},
        {"tail_wait_ms": 60000},
        {"dictation_idle_s": 0},
        {"dictation_idle_s": 3600},
        {"dictation_max_s": 1},
        {"dictation_max_s": 7200},
        # D73 S6 — the background idle window. 0 is a REAL value (off), so only a negative one is
        # rejected at the floor; the ceiling is `max_session_s`'s, past which it could never fire.
        {"background_idle_s": -1},
        {"background_idle_s": 7201},
        # D74 — the near-speech gate is bounded like `min_speech_ms`, whose family it joins: 0 is a
        # REAL value (no gate at all), so only a negative one is rejected at the floor, and a
        # multi-second hold would swallow whole sentences instead of gating them.
        {"min_final_ms": -1},
        {"min_final_ms": 5001},
        # …and the noise verdict beside it: 0 is REAL (never judge — always wait for the stop).
        {"noise_verdict_ms": -1},
        {"noise_verdict_ms": 5001},
        # D76 §C.4 — the relative floor's clamp: its two bounds are each bounded to dBFS, and ORDERED
        # by the model validator (inverted or equal bounds pin every automatic floor to one number).
        {"min_dbfs": -95.0},
        {"max_dbfs": 1.0},
        {"min_dbfs": -20.0, "max_dbfs": -60.0},
        {"min_dbfs": -40.0, "max_dbfs": -40.0},
    ],
)
def test_live_config_bounds_reject_wedging_values(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        LiveCfg(**bad)


def test_barge_threshold_is_no_longer_a_knob_d76() -> None:
    """D76 S0b deleted the absolute linear interruption floor (migration step 4 drops the key). The
    section keeps its house `extra="allow"` posture, so a stale key that somehow survived is an inert
    extra — never validated, never a field, and never delivered to the client as a call knob."""
    assert "barge_threshold" not in LiveCfg.model_fields
    cfg = LiveCfg.model_validate({"barge_threshold": 0.9})  # out of the old 0–0.5 bounds: still inert
    assert cfg.model_extra == {"barge_threshold": 0.9}
    app = _app(live_cfg={"barge_threshold": 0.06})
    assert "barge_threshold" not in app.get("/api/voice/status").json()["live_call"]


@pytest.mark.parametrize("route", ["media", "call"])
def test_the_route_admits_media_and_call_d76(route: str) -> None:
    """D76 §A — the axis is media/call (the mic's echo-cancellation ask), pinned as a set: the client
    branches on exactly these two (`wantsAec(route) ≡ route === "call"`)."""
    assert LiveCfg.model_validate({"route": route}).route == route


def test_voice_cfg_mounts_live() -> None:
    s = Settings.model_validate({"voice": {"live": {"enabled": False, "silence_ms": 850}}})
    assert (s.voice.live.enabled, s.voice.live.silence_ms) == (False, 850)  # an explicit off still wins
    assert Settings().voice.live.enabled is True  # ON since v1.7.8 (S4 closed)


# ── 13. the call trail (D77) ──────────────────────────────────────────────────────────────────────

CALL = "0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b"


def _trail_lines(root: Any, call: str = CALL) -> list[dict[str, Any]]:
    path = root / f"{call}.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _traced(ws: Any, *, leg: int = 3, rate: int = 48000) -> None:
    """`_ready`, for a debug call: `start` names the call and its leg (D77)."""
    ws.send_json({"type": "start", "sample_rate": rate, "call_id": CALL, "leg": leg})
    assert _json(ws) == {"type": "state", "state": "ready"}


@pytest.mark.parametrize(
    "extra",
    [
        {"call_id": "../../etc/passwd", "leg": 0},  # the filename guard
        {"call_id": CALL.upper(), "leg": 0},  # canonical LOWERCASE only — one spelling, one file
        {"call_id": CALL + "\n", "leg": 0},  # `$` would admit a trailing newline; fullmatch does not
        {"call_id": 42, "leg": 0},
        {"call_id": None, "leg": 0},
        {"call_id": CALL, "leg": -1},
        {"call_id": CALL, "leg": 1_000_001},
        {"call_id": CALL, "leg": "3"},
        {"call_id": CALL, "leg": True},  # a bool is not leg 1
        {"call_id": CALL},  # an id without its leg…
        {"leg": 0},  # …and a leg without its id
    ],
)
def test_a_malformed_trail_identity_is_a_protocol_close(extra: dict[str, Any], tmp_path: Any) -> None:
    trail = CallTrail(tmp_path / "calls")
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"debug": True}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "start", "sample_rate": 48000, **extra})
        assert _json(ws)["code"] == "protocol"
        assert _closed(ws)[0] == 1008
    assert not (tmp_path / "calls").exists()  # a refused identity never becomes a path


def test_a_debug_leg_writes_its_trail_every_line_carrying_the_leg(tmp_path: Any) -> None:
    fake = FakeSpeaches(
        [
            created(),
            Say(PAD_ERROR),
            Say({"type": "input_audio_buffer.speech_started"}, after_appends=1),
            Say({"type": "input_audio_buffer.speech_stopped"}, after_appends=1),
            transcribed("Wake up corsair.", after_appends=1),
        ]
    )
    trail = CallTrail(tmp_path / "calls")
    app = _fake_app(fake, live_cfg={"debug": True, "silence_ms": 900}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, leg=3)
        ws.send_bytes(_pcm(960))
        assert _json(ws) == {"type": "speech_started"}
        assert _json(ws) == {"type": "speech_stopped"}
        assert _json(ws)["type"] == "transcript"
        ws.send_json({"type": "flush"})
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
        assert _closed(ws)[0] == 1000
    lines = _trail_lines(tmp_path / "calls")
    assert {line["src"] for line in lines} == {"relay"}
    assert {line["leg"] for line in lines} == {3}  # Maya F4 — one call, many legs; each line says which
    assert all(isinstance(line["t"], int) for line in lines)
    evs = [line["ev"] for line in lines]
    assert evs[0] == "leg_start" and evs[-1] == "leg_end"
    # the header line IS the one `session.update` — the exact knobs this leg ran
    assert lines[0]["rate"] == 48000
    assert lines[0]["session"] == fake.one("session.update")["session"]
    assert lines[0]["session"]["turn_detection"]["silence_duration_ms"] == 900
    # every downlink frame, verbatim and in order — the owner's words appear here, once
    downs = [line["frame"] for line in lines if line["ev"] == "down"]
    assert downs == [
        {"type": "state", "state": "ready"},
        {"type": "speech_started"},
        {"type": "speech_stopped"},
        {"type": "transcript", "text": "Wake up corsair.", "final": True},
        {"type": "state", "state": "ended"},
    ]
    # the swallowed spurious error is still RECORDED, flagged — the trail sees what the phone does not
    swallowed = [line for line in lines if line["ev"] == "up_error"]
    assert len(swallowed) == 1 and swallowed[0]["swallowed"] is True
    assert "prefix_padding_ms" in swallowed[0]["error"]["message"]
    assert [line["pad_ms"] for line in lines if line["ev"] == "flush"] == [3200]
    assert "stop" in evs
    assert lines[-1] == {**lines[-1], "code": 1000, "reason": "ended"}


def test_a_failed_leg_and_a_vanished_phone_still_say_how_they_ended(tmp_path: Any) -> None:
    trail = CallTrail(tmp_path / "calls")
    # (a) a protocol failure after a good `start`: the typed error goes down, then `leg_end` 1008
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"debug": True}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, leg=0)
        ws.send_json({"type": "hello"})
        assert _json(ws)["code"] == "protocol"
        _closed(ws)
    lines = _trail_lines(tmp_path / "calls")
    assert lines[-2]["ev"] == "down" and lines[-2]["frame"]["code"] == "protocol"
    assert (lines[-1]["ev"], lines[-1]["code"], lines[-1]["reason"]) == ("leg_end", 1008, "protocol error")
    # (b) the phone simply goes away: no `_close` ever runs, and the teardown still writes the end
    other = "1f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b"
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"debug": True}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "start", "sample_rate": 48000, "call_id": other, "leg": 1})
        assert _json(ws) == {"type": "state", "state": "ready"}
    tail = _trail_lines(tmp_path / "calls", other)[-1]
    assert (tail["ev"], tail["code"], tail["reason"], tail["leg"]) == ("leg_end", None, "client gone", 1)


def test_a_long_leg_batches_its_lines_and_loses_none(tmp_path: Any) -> None:
    """The relay batches (20 lines) rather than writing per line — and the batches land in ORDER, with
    the teardown's flush taking the tail."""
    script = [created()]
    for i in range(1, 26):
        script.append(Say({"type": "input_audio_buffer.speech_started"}, after_appends=i))
        script.append(Say({"type": "input_audio_buffer.speech_stopped"}, after_appends=i))
    trail = CallTrail(tmp_path / "calls")
    app = _fake_app(FakeSpeaches(script), live_cfg={"debug": True}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws)
        for _ in range(25):
            ws.send_bytes(_pcm(960))
            assert _json(ws) == {"type": "speech_started"}
            assert _json(ws) == {"type": "speech_stopped"}
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    frames = [line["frame"]["type"] for line in _trail_lines(tmp_path / "calls") if line["ev"] == "down"]
    assert frames == ["state"] + ["speech_started", "speech_stopped"] * 25 + ["state"]


def test_debug_off_writes_nothing_even_with_a_call_id(tmp_path: Any) -> None:
    trail = CallTrail(tmp_path / "calls")
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"debug": False}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws)  # the identity is still VALIDATED and accepted…
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    assert not (tmp_path / "calls").exists()  # …and nothing is written


def test_a_leg_without_a_call_id_writes_nothing(tmp_path: Any) -> None:
    """Dictation's legs (and every call with the knob off client-side) send no id: no trail."""
    trail = CallTrail(tmp_path / "calls")
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"debug": True}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _ready(ws)
        ws.send_json({"type": "stop"})
        assert _drain_until(ws, "state")["state"] == "ended"
    assert not (tmp_path / "calls").exists()


def test_the_bearer_never_reaches_the_trail(tmp_path: Any) -> None:
    """The A11 rule, extended to the new sink: the trail records the session the relay SENT and every
    frame it sent DOWN — never the connect call's headers."""
    trail = CallTrail(tmp_path / "calls")
    fake = FakeSpeaches(
        [created(), Say({"type": "error", "error": {"message": "nope"}}), Say(abrupt_close())]
    )
    app = _fake_app(fake, client=_voice_client(key=SECRET), live_cfg={"debug": True}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws)
        _drain_until(ws, "error")
        _closed(ws)
    assert fake.headers == {"Authorization": f"Bearer {SECRET}"}  # type: ignore[attr-defined]
    assert SECRET not in (tmp_path / "calls" / f"{CALL}.jsonl").read_text(encoding="utf-8")


def test_trail_keep_is_a_bounded_server_knob() -> None:
    assert LiveCfg().trail_keep == 20
    for bad in (0, 501):
        with pytest.raises(ValidationError):
            LiveCfg(trail_keep=bad)
    # a SERVER knob — never delivered to the client
    assert "trail_keep" not in _app().get("/api/voice/status").json()["live_call"]
