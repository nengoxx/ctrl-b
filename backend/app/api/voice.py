"""Voice API (Phase 6) — STT in / TTS out, thin proxies over `VoiceClient`.

The browser never holds STT/TTS keys: it posts a recorded clip / some text here, the server forwards
it to the configured OpenAI-compatible endpoint(s) with failover, and returns the transcript / audio.
`GET /voice/status` is the capability probe the PWA uses to decide whether to show the mic + auto-TTS
(without exposing whether keys exist). Thin by design (AGENTS conventions): validate + delegate.

`WS /api/voice/live` (Phase 24 / D71) is the one exception to "thin proxies over HTTP": the live-call
relay, which bridges the phone to a Speaches realtime session. Its session object lives in
`services/voice_live.py`; what is here is the route's rails — the `Origin` check, the feature gate, and
the process-wide admission slot.

`POST /api/voice/live/trail` (D77) is the browser's half of the CALL TRAIL — a debug-gated, bounded
JSON append into `$CTRLB_HOME/calls/<call_id>.jsonl` (`services/call_trail.py`); 404 while
`voice.live.debug` is off, 204 on success, and no read path anywhere.

HTTP contract: a success always returns 200 with `X-Voice-Served-By: <provider>` — the NAME of the
registry provider that actually served (A11/D48; a fallback serve carries that fallback's provider name,
a single-user diagnostic surface); TTS additionally carries `X-Voice-Target: <provider>/<model>`, the
machine-readable identity a chunked reply pins with `prefer` (D63), plus `X-Voice-Degraded: 1` ONLY
when a hop failed before the serving one answered (the client's serve flash is exception-only, so the
header exists exactly where it says something); every endpoint failing → 502 (the aggregated upstream
error); voice/service unconfigured → 503; STT with no file → 422.
"""

from __future__ import annotations

import asyncio
import json
import logging
from email.message import Message
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, UploadFile, WebSocket
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.adapters.voice import AUDIO_FORMATS, VoiceClient, VoiceError
from app.config import validation_detail
from app.services.call_trail import (
    CALL_ID_PATTERN,
    TRAIL_MAX_BODY_BYTES,
    TRAIL_MAX_ENTRIES,
    TRAIL_MAX_ENTRY_BYTES,
    CallTrail,
)
from app.services.voice_live import (
    CLOSE_BUSY,
    CLOSE_PROTOCOL,
    LiveRelaySession,
    LiveSessionSlots,
    connect_speaches,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["voice"], prefix="/voice")


def _client(request: Request) -> VoiceClient:
    return request.app.state.voice


@router.get("/status")
async def voice_status(request: Request) -> dict[str, object]:
    """Capability probe: which voice services are configured + enabled, the STT auto-send flag, the R51
    Tier-0 auto-stop policy, the D63 TTS chunk policy, and the D71 live-call policy (`{stt, tts, live,
    live_ear, stt_auto_send, stt_auto_stop, tts_chunking, live_call}`). Everything past the capability
    bits is CLIENT BEHAVIOR composed HERE from live settings (A11/R2) — the frozen resolved chain the
    `VoiceClient` holds deliberately doesn't carry it — and this probe is the always-on endpoint the PWA
    already polls, so neither the chunker nor the mic's silence detector nor the call overlay needs a
    query of its own.

    `stt_auto_stop`, `tts_chunking` and `live_call` are shape-only: a toggle + thresholds, the split
    mode + size floors/caps + container + the read-along flag, and the call's client-side pacing /
    interruption / presentation knobs. No endpoint, no key, no model id — nothing here says whether a
    secret exists."""
    status: dict[str, object] = dict(_client(request).status())
    stt = request.app.state.settings.voice.stt
    tts = request.app.state.settings.voice.tts
    status["stt_auto_send"] = stt.auto_send
    status["stt_auto_stop"] = {
        "enabled": stt.auto_stop,
        "silence_s": stt.auto_stop_silence_s,
        "threshold": stt.auto_stop_threshold,
    }
    status["tts_chunking"] = {
        "mode": tts.chunking,
        "min_words": tts.chunk_min_words,
        "min_chars": tts.chunk_min_chars,
        "max_chars": tts.chunk_max_chars,
        "lookahead": tts.chunk_lookahead,
        "max_text_chars": tts.max_text_chars,
        "format": tts.chunk_format,
        "read_along": tts.chunk_read_along,
        # D74 — whether roleplay ACTIONS are spoken. A text-shaping rule, so it rides the object the
        # client's text pipeline already reads (`lib/toSpeech` is what applies it); nothing on this
        # side of the wire ever sees the prose.
        "speak_actions": tts.speak_actions,
    }
    # LIVE VOICE / call mode (D71 §5.1). The BIT is composed of three things, because the call needs
    # both ears and a mouth: a resolvable realtime target (the frozen client's chain), TTS configured
    # (the §5.1 refinement 2026-09-12 — a call with nothing to say back is not a call), and the
    # feature's own toggle. `voice.enabled` MASTER outranks all of it, already, inside `configured()`.
    live = request.app.state.settings.voice.live
    client = _client(request)
    status["live"] = client.configured("live") and client.configured("tts") and live.enabled
    # THE EAR ALONE (S2.5). Streaming dictation needs no mouth — it fills the composer — so it cannot
    # ride the bit above, whose TTS term is the call's own §5.1 refinement. This one MIRRORS THE WS
    # ROUTE GATE EXACTLY (`voice_live` below: `(cfg.enabled or cfg.dictation) and
    # client.configured("live")`), because it answers exactly the route's question: would this
    # client's socket be admitted? Any drift between the two is a mic that opens a leg the route
    # refuses (or refuses to open one it would have taken). The OR (S3.5): the ear opens when EITHER
    # feature wants it — dictation is an STT-facing feature (the R70 field norm: composer dictation
    # and voice mode are separate features everywhere) and must not require the CALL toggle.
    status["live_ear"] = client.configured("live") and (live.enabled or live.dictation)
    # …and the CLIENT-side call knobs, same split as `stt_auto_stop`/`tts_chunking`: shape only — no
    # endpoint, no key, no model id, nothing that says whether a secret exists. Speaches' own
    # `TurnDetection` accepts exactly five fields (§4.1), so every interruption/pacing knob a call
    # needs is necessarily browser-side and has to arrive here. Since S2.5 the same object carries the
    # four dictation knobs — one ear, one set of client knobs (`LiveCfg`'s own split). ONLY knobs the
    # browser READS (R88): `vad_threshold` and `max_session_s` rode here once and nothing read them
    # (the in-call slider went with D76 §D; no overlay ever showed the cap) — they are SERVER knobs,
    # and a delivered-but-unread field is one a later reader trusts without anyone having tested it.
    # Pinned both ways by `test_every_delivered_live_call_field_has_a_browser_reader`.
    status["live_call"] = {
        "frame_ms": live.frame_ms,
        "buffered_ceiling_ms": live.buffered_ceiling_ms,
        "call_backlog_ms": live.call_backlog_ms,
        "min_speech_ms": live.min_speech_ms,
        # D74 (evidence docs/research/R76) — the near-speech gate on a COMMITTED turn, and the
        # calibration readout beside it. Client knobs like their neighbours, and necessarily so: the
        # energy they gate on is measured in the browser, and the server-side VAD has no field left
        # that would express either of them.
        "min_final_ms": live.min_final_ms,
        # …and the NOISE VERDICT beside it (the owner's 2026-09-26 ruling): how long an open segment
        # runs before the browser may judge it by that same gate and stop holding the reply for it.
        "noise_verdict_ms": live.noise_verdict_ms,
        "debug": live.debug,
        "barge_in": live.barge_in,
        "ring": live.ring,
        # The reply as CAPTIONS on the call screen (owner ask 2026-09-22). A presentation knob like
        # `ring` beside it: the words it draws are already in the browser's own chat store, so this
        # end is only ever asked whether to draw them.
        "captions": live.captions,
        # D76 §B — the mic hold while the reply plays (`auto` = the leak probe, D76 S2).
        "mic_hold": live.mic_hold,
        # D76 §C (evidence R83) — the relative gate: the bootstrap ceiling, the three margins, the two
        # clamp bounds. Client knobs for the reason `min_final_ms` is: the level they gate on is
        # measured in the browser.
        "floor_dbfs": live.floor_dbfs,
        "noise_margin_db": live.noise_margin_db,
        "voice_margin_db": live.voice_margin_db,
        "playback_margin_db": live.playback_margin_db,
        "min_dbfs": live.min_dbfs,
        "max_dbfs": live.max_dbfs,
        # D73 S5 — the capture pair. It reaches the browser for the same reason its neighbours do: the
        # constraints and the device are `getUserMedia` arguments, and every capture this app opens
        # (call and dictation alike) reads them from here rather than defaulting them locally.
        "route": live.route,
        "input_device": live.input_device,
        # D73 S6 — the background three, here for the same reason: every one of them governs what the
        # BROWSER does with a hidden page (keep the call, keep the graph audible, bound the idle
        # stretch), and nothing below it can observe a page going away.
        "background": live.background,
        "background_keepalive": live.background_keepalive,
        "background_idle_s": live.background_idle_s,
        "dictation": live.dictation,
        "tail_wait_ms": live.tail_wait_ms,
        "dictation_idle_s": live.dictation_idle_s,
        "dictation_max_s": live.dictation_max_s,
    }
    return status


def _origin_allowed(origin: str | None, host: str | None, allowed: list[str]) -> bool:
    """The WS `Origin` rail (D71 §5.2/F9), pure so it can be reasoned about and tested directly.

    **Browser CORS does not protect WebSockets** — there is no preflight on an upgrade, and this app
    deliberately mounts no CORS middleware at all (SECURITY_MODEL §2.7, where the *absence* of CORS is
    the load-bearing defence for the media write path). For the HTTP surface that absence is the
    defence; for a WebSocket it buys nothing, so this explicit check is the ONLY thing standing between
    a hostile page opened on a tailnet device and the owner's relay.

    The rule: an origin must be PRESENT (a browser always sends one; absent means a non-browser client,
    which is exactly what the tailnet trust boundary does not extend to on this route), and its
    `host:port` must match the request's own `Host` header — or the whole origin string must appear
    verbatim in `voice.live.allowed_origins` (the escape hatch for a second Serve name). Exact strings,
    never patterns: a pattern is how an allowlist grows a bypass.

    **What this does NOT defend against: DNS rebinding.** The same-host rule compares two values the
    ATTACKER chose — a page served from `http://evil.example:5433` whose name is rebound to a tailnet
    IP sends a matching `Origin` and `Host`, and passes. That is the app's existing posture, not a new
    hole: rebinding equally defeats the absence-of-CORS defence on every plain-HTTP route here. The
    real fix is app-wide **`Host` header validation** (`TrustedHostMiddleware`), built at D72
    (`main._mount_trusted_hosts`; ships with `server.trusted_hosts` EMPTY = off, owner opt-in —
    SECURITY_MODEL §2.9/§2.10); the rule stays because it still stops the ordinary hostile page
    and costs no configuration.
    """
    if not origin:
        return False
    if origin in allowed:
        return True
    if not host:
        return False
    return urlsplit(origin).netloc == host


@router.websocket("/live")
async def voice_live(websocket: WebSocket) -> None:
    """`WS /api/voice/live` — the live-voice relay (D71 §3; the FIRST WebSocket in this codebase,
    admitted for continuous media ingress only, §3.2).

    Thin by design, like every other handler here: the pre-accept rails, the admission slot, then
    delegate to `LiveRelaySession`. The three refusals, in order and for a reason:

    1. **Origin** first — it is the security rail, and a rejected origin must learn nothing about
       whether the feature exists.
    2. **The feature gate** (either feature toggle — `voice.live.enabled` for the call,
       `voice.live.dictation` for the streaming mic (S3.5) — plus a resolvable realtime target) —
       refused pre-`accept()`, which a browser sees as a failed handshake (HTTP 403), matching how
       the mic simply is not offered when `stt` is unconfigured.
    3. **Busy** — post-`accept()`, deliberately: the cap is a transient condition, so the client gets
       a TYPED `{"error","busy"}` + close 1013 ("try again later") it can render, not an opaque
       handshake failure indistinguishable from a misconfiguration.

    The upstream connector is injectable through `app.state.voice_live_connect` — the one test seam,
    the same shape as `app.state.voice` being a stub in the voice-API tests. Absent in production.
    """
    app = websocket.app
    settings = app.state.settings
    cfg = settings.voice.live
    client: VoiceClient = app.state.voice

    if not _origin_allowed(
        websocket.headers.get("origin"), websocket.headers.get("host"), cfg.allowed_origins
    ):
        log.warning("live voice: refused a websocket with a foreign/absent Origin")
        await websocket.close(code=CLOSE_PROTOCOL, reason="origin not allowed")
        return
    target = client.live_target()
    policy = client.live_policy()
    if not ((cfg.enabled or cfg.dictation) and client.configured("live")) or target is None or policy is None:
        await websocket.close(code=CLOSE_PROTOCOL, reason="live voice unavailable")
        return

    slots: LiveSessionSlots = app.state.voice_live_slots
    await websocket.accept()
    if not slots.acquire(cfg.max_sessions):
        await websocket.send_json(
            {
                "type": "error",
                "code": "busy",
                "message": f"a live call is already running (max_sessions {cfg.max_sessions})",
            }
        )
        await websocket.close(code=CLOSE_BUSY, reason="busy")
        return
    try:
        await LiveRelaySession(
            websocket,
            cfg=cfg,
            target=target,
            policy=policy,
            connect=getattr(app.state, "voice_live_connect", None) or connect_speaches,
            # D77 — the relay's half of the call trail. Optional on `app.state` for the same reason the
            # connector seam is: a hand-built test app that never mounts the store writes no trail.
            trail=getattr(app.state, "call_trail", None),
        ).run()
    finally:
        # The ONE release. Latched by being the single `finally` on the single acquire — a failing
        # upstream close inside the session can never leak the slot, because the session swallows its
        # own teardown failures and this block runs regardless.
        slots.release()


class TrailEntry(BaseModel):
    """One CLIENT trail line (D77): a millisecond timestamp, an event name, and whatever the browser
    measured beside it, kept VERBATIM (`extra="allow"`) — the trail is a diagnostic record, so this
    end does not second-guess the fields. Bounded instead: `ev` by length, the whole entry by its
    serialized size (`TRAIL_MAX_ENTRY_BYTES`, checked in the handler, which knows the index)."""

    model_config = ConfigDict(extra="allow")
    t: int
    ev: str = Field(min_length=1, max_length=48)


class TrailBatch(BaseModel):
    call_id: str = Field(pattern=CALL_ID_PATTERN)
    entries: list[TrailEntry] = Field(min_length=1, max_length=TRAIL_MAX_ENTRIES)


def _is_json(content_type: str | None) -> bool:
    """`application/json` (or a `+json` suffix), parameters ignored — FastAPI's own strict-content-type
    reading, which this handler has to restate because it parses the body itself (to bound it first)."""
    if not content_type:
        return False
    msg = Message()
    msg["content-type"] = content_type
    subtype = msg.get_content_subtype()
    return msg.get_content_maintype() == "application" and (subtype == "json" or subtype.endswith("+json"))


@router.post("/live/trail", status_code=204)
async def live_trail(request: Request) -> Response:
    """Append a batch of the BROWSER's call-trail lines (D77) — `204`, or: `404` while
    `voice.live.debug` is off (the feature does not exist then), `415` for a body that is not JSON,
    `413` past `TRAIL_MAX_BODY_BYTES`, `422` for a bad shape, a malformed `call_id`, more than
    `TRAIL_MAX_ENTRIES` entries or one entry past `TRAIL_MAX_ENTRY_BYTES` (the detail names its index).

    **The CONTENT TYPE is the CSRF control here** (SECURITY_MODEL §2.7's rule, §2.11): the app has no
    application-layer auth, so the attacker worth designing against is the owner's own browser on
    another origin — and a cross-origin `POST` escapes the CORS preflight only with a SAFELISTED body
    (a form, `text/plain`, or no type at all). `application/json` is not safelisted, so a hostile page's
    write dies at the preflight this app never answers. That rail is only real if this route REFUSES
    everything else, which is why the body is parsed here — FastAPI's own no-content-type guard applies
    to declared body params, and this handler reads the stream itself so the cap is a bound, not a
    claim: counted as it arrives and refused the moment it passes (the `_import_body` posture), never
    `await request.body()` and never the `Content-Length` header alone.

    Stored lines are `{"src": "client", **entry}` — the client's `t`/`ev` and extras verbatim, minus
    any `src` of its own, so a client line can never pass itself off as the relay's. No read endpoint
    exists: the trail is read on the host, from the file."""
    live = request.app.state.settings.voice.live
    if not live.debug:
        raise HTTPException(status_code=404, detail="call trail is off")
    if not _is_json(request.headers.get("content-type")):
        raise HTTPException(status_code=415, detail="the call trail takes application/json")
    body = bytearray()
    async for chunk in request.stream():
        # Refused BEFORE the concatenation (the S3 code round, F2): one oversized ASGI chunk must not
        # be allocated into the body only to be thrown away.
        if len(body) + len(chunk) > TRAIL_MAX_BODY_BYTES:
            raise HTTPException(
                status_code=413, detail=f"the trail batch is larger than {TRAIL_MAX_BODY_BYTES} bytes"
            )
        body += chunk
    try:
        batch = TrailBatch.model_validate_json(bytes(body))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=validation_detail(exc)) from None
    lines: list[dict[str, Any]] = []
    for i, entry in enumerate(batch.entries):
        data = entry.model_dump()
        if len(json.dumps(data, separators=(",", ":"), ensure_ascii=False)) > TRAIL_MAX_ENTRY_BYTES:
            raise HTTPException(
                status_code=422, detail=f"trail entry {i} is larger than {TRAIL_MAX_ENTRY_BYTES} bytes"
            )
        data.pop("src", None)
        lines.append({"src": "client", **data})
    trail: CallTrail = request.app.state.call_trail
    await asyncio.to_thread(trail.append, batch.call_id, lines, keep=live.trail_keep)
    return Response(status_code=204)


@router.post("/stt")
async def stt(request: Request, file: UploadFile) -> Response:
    """Transcribe an uploaded audio clip → `{text}`. The clip's filename + content-type are forwarded
    as-is (Whisper servers often route by extension)."""
    voice = _client(request)
    if not voice.configured("stt"):
        raise HTTPException(status_code=503, detail="speech-to-text is not configured")
    max_bytes = request.app.state.settings.voice.stt.max_upload_bytes
    # Read at most cap+1 bytes: that is the least that still proves "over the cap", so an oversized
    # clip is refused without ever materializing more than the cap in memory (v1.3.1 Codex review).
    content = await file.read(max_bytes + 1)
    if not content:
        raise HTTPException(status_code=422, detail="empty audio upload")
    if len(content) > max_bytes:
        # The true size is deliberately NOT reported — we stopped reading at cap+1.
        raise HTTPException(
            status_code=413,
            detail=f"audio upload too large (limit {max_bytes} bytes)",
        )
    try:
        text, served = await voice.transcribe(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type,
        )
    except VoiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(
        content=json.dumps({"text": text}),
        media_type="application/json",
        headers={"X-Voice-Served-By": served.served},
    )


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    #: D70 §8.5 (ruling 21) — WHOSE turn is being read. The agent identity of the message/thread this
    #: speech belongs to; the server turns it into that agent's `AgentDef.voice`. The NAME rather than
    #: a message/thread id on purpose: read-along speaks a reply that is not persisted yet (there is no
    #: row to look up mid-stream), and a chunked reply would otherwise pay a DB read per chunk. `None`
    #: (every pre-D70 client) ⇒ the global `voice.tts` chain, exactly as before.
    agent: str | None = None
    #: D63 — the container this call wants (chunked playback asks for `chunk_format`). Bounded by the
    #: closed `AUDIO_FORMATS` allowlist (adapters/voice); precedence at the wire is request > model >
    #: service.
    format: str | None = None
    #: D63 failover pin — `provider/model` (the `X-Voice-Target` of an earlier chunk) tried FIRST. An
    #: unknown value is a silent miss, not an error: the pinned target may have vanished mid-reply.
    prefer: str | None = None


def _voice_id(request: Request, body: TtsRequest) -> str | None:
    """The voice this call speaks in (D70 §8.5, ruling 21, F6-corrected): an explicit request `voice`
    (the pre-D70 override, the most specific thing a caller can say) → the named agent's
    `AgentDef.voice` when it set one → `None`, i.e. the global `voice.tts` chain's own voice.

    ABSENT ⇒ the global default is the WHOLE fallback contract. A non-empty-but-invalid id is passed
    through and reports via the existing TTS error path (a 502 off the upstream reject) exactly as a
    bad global voice does — nothing here validates: no registry can enumerate a voice server's ids, so
    an unknown→default promise would be an allowlist we cannot build (Emma F6).

    Resolution is graceful like every other agent lookup: a since-deleted name lands on the default
    agent — the same agent the session would have run as."""
    if body.voice:
        return body.voice
    if not body.agent:
        return None
    # As-is, never repaired (S1 Emma round, MED-3): `.strip() or None` silently mapped a whitespace
    # voice to the global chain — exactly the unknown→default promise F6 rules out — and quietly
    # fixed padded ids. "" is absent; anything else reaches the upstream and errors like any bad id.
    return request.app.state.settings.resolve_agent(body.agent).voice or None


@router.post("/tts")
async def tts(body: TtsRequest, request: Request) -> Response:
    """Synthesize speech for `text` → the full audio clip (buffered, seekable). Optional `agent` names
    whose voice to read in (D70 §8.5); optional `voice`
    overrides the configured endpoint voice; optional `format` overrides the container; optional
    `prefer` pins which target the failover chain tries first. `X-Voice-Served-By` names the provider
    that served (display); `X-Voice-Target` is its full `provider/model` identity — the value the
    client echoes back as `prefer` on the rest of a chunked reply; `X-Voice-Degraded` appears only on
    a degraded serve, which is the one case the client announces who read the reply."""
    voice = _client(request)
    if not voice.configured("tts"):
        raise HTTPException(status_code=503, detail="text-to-speech is not configured")
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="empty text")
    if body.format is not None and body.format not in AUDIO_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"unsupported format {body.format!r} (allowed: {', '.join(sorted(AUDIO_FORMATS))})",
        )
    max_chars = request.app.state.settings.voice.tts.max_text_chars
    if len(body.text) > max_chars:
        raise HTTPException(
            status_code=422,
            detail=f"text too long ({len(body.text)} chars; limit {max_chars})",
        )
    try:
        audio, media_type, served = await voice.synthesize(
            text=body.text,
            voice=_voice_id(request, body),
            audio_format=body.format,
            prefer=body.prefer,
        )
    except VoiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    headers = {
        "X-Voice-Served-By": served.served,
        "X-Voice-Target": served.target,
        "Content-Length": str(len(audio)),
        "Cache-Control": "no-store",
    }
    if served.degraded:
        headers["X-Voice-Degraded"] = "1"  # absent on the happy path — see the module docstring
    return Response(content=audio, media_type=media_type, headers=headers)
