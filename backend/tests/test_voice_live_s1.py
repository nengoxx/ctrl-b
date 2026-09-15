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
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
from dataclasses import dataclass
from typing import Any

import anyio
import pytest
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
from app.config import LiveCfg, Settings
from app.core.audio import SPEACHES_WIRE_RATE, Pcm16Resampler
from app.core.provider_registry import resolve_lenient
from app.domain.provider import LivePolicy, SttPolicy, TtsPolicy
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
) -> TestClient:
    app = FastAPI()
    app.state.voice = client if client is not None else _voice_client()
    app.state.settings = Settings.model_validate({"voice": {"live": {"enabled": True, **(live_cfg or {})}}})
    app.state.voice_live_slots = slots if slots is not None else LiveSessionSlots()
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


def test_a_dominant_silence_ms_widens_the_burst() -> None:
    """The `max()`'s other branch: `silence_ms` above the 3 s window (legal up to 10 s) must widen the
    burst — the endpoint needs `silence_ms` of TRAILING silence, however long the buffer is."""
    assert _flush_silence_ms(5, silence_ms=5000) == pytest.approx(5200, abs=40)


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
            "barge_threshold": 0.02,
            "barge_in": False,
            "ring": False,
            "echo_workaround": "on",
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
        "barge_threshold": 0.02,
        "barge_in": False,
        "ring": False,
        "echo_workaround": "on",
        "max_session_s": 900,
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
    assert cfg.enabled is False  # ships OFF until S4 (the whole-feature-toggle rule)
    assert (cfg.vad_threshold, cfg.silence_ms) == (0.9, 700)  # the two session.update knobs
    assert (cfg.frame_ms, cfg.max_frame_bytes, cfg.max_sessions) == (40, 32768, 1)
    assert cfg.max_session_s == 1800  # aligned with Speaches' own 30-min hard expiry
    assert (cfg.min_speech_ms, cfg.buffered_ceiling_ms, cfg.barge_threshold) == (300, 1000, 0.0)
    assert (cfg.barge_in, cfg.ring, cfg.echo_workaround) == (True, True, "auto")
    assert (cfg.relay_queue_ms, cfg.start_timeout_s, cfg.allowed_origins) == (2000, 5.0, [])
    assert cfg.provider is None and cfg.fallbacks == []  # blank ⇒ resolve like stt
    # S2.5 — the dictation four. `dictation` ships OFF beside `enabled` (its own whole-feature toggle),
    # and the three numbers are R70 §4/§9.3's measured defaults.
    assert cfg.dictation is False
    assert (cfg.tail_wait_ms, cfg.dictation_idle_s, cfg.dictation_max_s) == (2000, 15, 120)


@pytest.mark.parametrize(
    "bad",
    [
        {"vad_threshold": 1.5},
        {"vad_threshold": -0.1},
        {"silence_ms": 0},
        {"silence_ms": 60000},
        {"frame_ms": 1},
        {"max_frame_bytes": 0},
        {"max_sessions": 0},
        {"max_sessions": 99},
        {"barge_threshold": 0.9},
        {"relay_queue_ms": 10},
        {"start_timeout_s": 0},
        {"echo_workaround": "sometimes"},
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
    ],
)
def test_live_config_bounds_reject_wedging_values(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        LiveCfg(**bad)


def test_voice_cfg_mounts_live() -> None:
    s = Settings.model_validate({"voice": {"live": {"enabled": True, "silence_ms": 850}}})
    assert (s.voice.live.enabled, s.voice.live.silence_ms) == (True, 850)
    assert Settings().voice.live.enabled is False
