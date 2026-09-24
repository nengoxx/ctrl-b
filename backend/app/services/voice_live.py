"""The live-voice relay — phone WS ↔ Speaches realtime WS (Phase 24 / D71 §3, slice S1).

`WS /api/voice/live` is **the first WebSocket in this codebase**, admitted by D71 for continuous media
ingress ONLY (§3.2): the turn machinery, chat text and every non-media channel stay SSE/HTTP. This
module is the session object behind that route — asyncio only, no threads (RVC's eleven-`Event`
teardown is the counter-example, R51 §2.6), one object per call, nothing shared but the admission
counter.

**What crosses the wire**

* **Uplink (phone → relay):** one JSON `start` (`{"type":"start","sample_rate":<Hz>}` — unknown
  keys are ignored), then raw binary pcm16 LE mono frames at the declared rate, plus the JSON
  controls `flush` and `stop`. The server-VAD knobs come from config alone (D76 §D).
* **Uplink (relay → Speaches):** `input_audio_buffer.append` with base64 pcm16 @ **24 kHz**, as TEXT
  frames — one binary frame kills the session (§7-S0 ②), which is why the plan's binary uplink stops
  at the relay and pays ~33 % base64 overhead on the loopback leg.
* **Downlink (relay → phone):** JSON only — `state` / `speech_started` / `speech_stopped` /
  `transcript` / `error`. **No audio ever rides this socket** (C3 owns reply audio over HTTP).

**The four invariants worth naming**

1. **COMMIT-SAFETY (R70 §1.2 arm A).** The relay NEVER sends `input_audio_buffer.commit`, on any code
   path. A commit while a speech segment is open hits
   `assert self.vad_state.audio_end_ms is not None` in Speaches' `input_audio_buffer.py:85`, the
   AssertionError escapes an `except openai.APIStatusError`-only catch, the event TaskGroup tears the
   session down at a bare 1006 — **and the words are lost.** Reproduced 2/2 on emma.
2. **The flush is a silence burst, relay-side** (R70 §4). "End the phrase now" is
   `max(3000, silence_ms) + 200` ms of zero-frames appended as fast as the loopback takes them: Silero
   only looks at the trailing 3 s of the buffer and cannot emit `speech_stopped` before the buffer
   exceeds 3000 ms, so padding the buffer is the only legal way to force an endpoint. The pad is a
   CONSTANT worst case — R70's `3000 − fed_ms` shortening assumed a per-buffer count the relay cannot
   actually keep (F3, two review rounds; see `_flush`). It lives HERE and not on the phone because an
   88-frame burst in 3 ms would violate this relay's own §3.1 message-rate ceiling. The burst is also
   a **delivery barrier** (S1 review F2): the flush does not return until every one of its frames has
   actually gone upstream, or the mic audio that follows it would evict the tail of the burst out of
   the same bounded queue and the endpoint would never fire.
3. **Backpressure is ours alone.** Speaches has no server-side backpressure (unbounded pubsub
   queues, §7-S0 ②) and `WebSocket.send()` has no awaitable backpressure in the browser, so the
   bounded queue here is the only one in the chain: on overflow it drops the OLDEST frames and says
   so once, and never stalls (§3.1/F6). Its depth is counted in FRAMES, which is only truthful in
   milliseconds because the uplink caps bound a frame's DURATION as well as its bytes (F4).
4. **The bearer never leaves the backend.** The key rides an `Authorization` header the relay injects,
   is unwrapped from its `SecretStr` exactly once at the connect call (the A11 rule), and no log line
   or downlink frame ever carries it — connect failures are reported by the target's PROVIDER NAME and
   the exception TYPE, never its text.

**No failover.** A stateful realtime session cannot be re-dialled mid-stream, so the relay dials
`Registry.live_chain` hop 1 only; the client's degrade is push-to-talk, which shares no runtime with
the call (§5.3). Config is snapshotted at session start (§4.5 — a Conf edit applies to the NEXT call),
which is free: `apply_settings_inplace` rebinds `settings.voice`, so the `LiveCfg` object captured
here is immutable in practice.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from collections import deque
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import urlencode, urlsplit, urlunsplit

import anyio

from app.core.audio import SPEACHES_WIRE_RATE, Pcm16Resampler, silence

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.websockets import WebSocket

    from app.config import LiveCfg
    from app.domain.provider import LivePolicy, ResolvedTarget

log = logging.getLogger(__name__)

# ── wire vocabulary (the S2a/S2.5 contract; one spelling, one place) ──────────────────────────────

#: Accepted `start.sample_rate` bounds — the plan §3.1 declared numeric bounds.
MIN_SAMPLE_RATE = 8000
MAX_SAMPLE_RATE = 96000

#: Milliseconds of silence added past the endpointing requirement by a flush, so the burst clears the
#: threshold rather than landing exactly on it (R70 §4's `+ 200`; measured tails 530–830 ms).
FLUSH_MARGIN_MS = 200

#: Silero's window: it cannot emit `speech_stopped` before the buffer exceeds this (R70 §1.1 — the
#: `MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * MS_SAMPLE_RATE` read at source).
VAD_WINDOW_MS = 3000

#: The rate-ceiling window (§3.1: "sustained excess over ~2× the nominal 1000/frame_ms per second").
#: A rolling burst budget rather than an instantaneous rate, so a legitimate jitter catch-up passes
#: and only a sustained flood closes. Two budgets ride this one window — see `_note_frame`.
RATE_WINDOW_S = 2.0
RATE_MULTIPLIER = 2

#: The per-frame DURATION ceiling, as a multiple of the configured `frame_ms` (S1 review F4). ×2
#: admits a client that occasionally coalesces two frames after a scheduler hiccup; anything larger is
#: not jitter, it is a protocol violation. This cap is also what makes the frame-COUNT queue depth
#: truthful in milliseconds: `max_frame_bytes` (32 KiB) at the 8 kHz floor is 2048 ms of audio in ONE
#: frame, so without it a "2000 ms" relay queue could hold ~100 s and a fully compliant client could
#: ship ~100× realtime.
FRAME_MS_TOLERANCE = 2.0

#: WebSocket close codes used by this route. 1008 = policy violation (protocol errors + the pre-accept
#: refusals), 1011 = internal/upstream failure, 1013 = try again later (busy), 1000 = clean end.
CLOSE_PROTOCOL = 1008
CLOSE_UPSTREAM = 1011
CLOSE_BUSY = 1013
CLOSE_OK = 1000


# ── admission (the D38 no-await check-and-set, process-wide) ──────────────────────────────────────


class LiveSessionSlots:
    """The process-wide live-session cap (`voice.live.max_sessions`, plan §5.2/F9).

    `acquire` is a **synchronous check-and-set with no `await` anywhere inside**, exactly like
    `turns.reserve()`: under the single-threaded loop the comparison and the increment are one atomic
    step, so two simultaneous handshakes cannot both slip past a cap of 1 (the D38 TOCTOU discipline).
    The cap is passed IN rather than read from a held `Settings` reference, so every acquire sees the
    live value and this object stays a pure counter (created once in the lifespan, the
    `endpoint_gates` precedent).

    `release` floors at zero so a stray extra call cannot mint capacity; the route additionally latches
    its own release, so the one `finally` can never double-free its slot.
    """

    def __init__(self) -> None:
        self._held = 0

    @property
    def held(self) -> int:
        return self._held

    def acquire(self, cap: int) -> bool:
        if self._held >= cap:
            return False
        self._held += 1
        return True

    def release(self) -> None:
        self._held = max(self._held - 1, 0)


# ── the upstream leg ──────────────────────────────────────────────────────────────────────────────


class LiveUpstream(Protocol):
    """The slice of a `websockets` client connection the relay uses. Narrow on purpose: it is also the
    seam the tests script a fake Speaches through, so nothing here may leak library types."""

    async def send(self, message: str) -> None: ...
    async def recv(self) -> str | bytes: ...
    async def close(self) -> None: ...


if TYPE_CHECKING:
    #: `(url, headers, open_timeout, close_timeout) -> connection`. The relay's ONE injection point.
    LiveConnector = Callable[..., Awaitable[LiveUpstream]]


def realtime_url(base_url: str, model: str) -> str:
    """The Speaches realtime URL for a resolved target: `http(s)` → `ws(s)`, `/realtime` appended to
    the provider's base path, `model` + `intent=transcription` as query params.

    `model` is a REQUIRED query param and `intent=transcription` is what makes `model` the
    TRANSCRIPTION model with `create_response` forced off (§7-S0 ②). The base is assumed to be the
    OpenAI-convention `…/v1` every other consumer of this provider uses — but nothing here enforces
    that: a base without `/v1` simply gets `/realtime` appended to whatever path it has, which is the
    same passthrough posture the HTTP voice doors take toward a non-standard mount.
    """
    parts = urlsplit(base_url)
    scheme = {"http": "ws", "https": "wss"}.get(parts.scheme, parts.scheme)
    path = parts.path.rstrip("/") + "/realtime"
    query = urlencode({"model": model, "intent": "transcription"})
    return urlunsplit((scheme, parts.netloc, path, query, ""))


async def connect_speaches(
    url: str, headers: dict[str, str], *, open_timeout: float, close_timeout: float
) -> LiveUpstream:
    """The production connector: one `websockets` client per live session.

    `max_size=None` because a realtime event carrying a long transcript has no useful bound, and
    `compression=None` because every frame is either base64 pcm16 (incompressible) or a tiny JSON
    event on a loopback socket — permessage-deflate would only add CPU per append, and Silero already
    runs synchronously on Speaches' event loop per append (§7-S0 ②).
    """
    from websockets.asyncio.client import connect

    return await connect(  # type: ignore[return-value]  # ClientConnection satisfies LiveUpstream
        url,
        additional_headers=headers,
        open_timeout=open_timeout,
        close_timeout=close_timeout,
        max_size=None,
        compression=None,
    )


# ── typed session failures (each one maps to exactly one downlink code + close code) ──────────────


class _ProtocolError(Exception):
    """The client broke the wire contract — bad framing, an unknown control, a cap violation."""


class _UpstreamRefused(Exception):
    """Speaches refused or could not be reached at handshake time (403/4xx, or unreachable)."""


class _UpstreamLost(Exception):
    """The realtime session died after it was established (the bare-1006 class, §7-S0 ②)."""


class _ClientGone(Exception):
    """The phone's socket closed. Nothing left to send and nothing to close — teardown only."""


class LiveRelaySession:
    """One live call: the phone's WebSocket on one side, a Speaches realtime session on the other.

    The caller (`api/voice.py`) owns the pre-accept gates and the admission slot; this object owns
    everything after `accept()` and has exactly ONE teardown path.
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        cfg: LiveCfg,
        target: ResolvedTarget,
        policy: LivePolicy,
        connect: LiveConnector = connect_speaches,
    ) -> None:
        self._ws = websocket
        self._cfg = cfg
        self._target = target
        self._policy = policy
        self._connect = connect

        self._up: LiveUpstream | None = None
        self._resampler: Pcm16Resampler | None = None
        #: The rate the client DECLARED in `start`, kept beside the resampler it built rather than read
        #: back off it: the caps below reason about the client's own wire, not about the 24 kHz one.
        self._client_rate: int | None = None
        #: Downlink writes come from two tasks (the client pump's protocol errors and the upstream
        #: pump's events), so they are serialized — an ASGI `send` is not re-entrant.
        self._send_lock = asyncio.Lock()
        self._client_gone = False
        self._closed = False

        #: The bounded relay queue of append-event JSON payloads. Sized in `_pump`.
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        #: True between a `speech_started` and its `speech_stopped`. Tracked for the commit-safety
        #: invariant (§7-S0's amendment (i)) and to keep a no-op flush from padding a silent buffer.
        self._speech_open = False
        #: True once ANY client frame has been accepted this session — NEVER cleared (S1 review F3,
        #: two rounds). There is deliberately NO per-buffer audio accounting here at all: a `committed`
        #: from Speaches cannot be correlated with what the relay has fed — it may be STALE (processed
        #: after the next phrase's frames were accepted; resetting on it once suppressed a needed
        #: burst) or simply UNPROCESSED at flush time (the mirror ordering: a stale-HIGH count shrank
        #: the burst below the 3 s floor and the phrase never endpointed). Both directions of trusting
        #: such a count lose words, so the flush bursts a CONSTANT worst-case pad instead (see
        #: `_flush`) and the only state kept is this one bit: has this session ever fed audio.
        self._audio_seen = False
        #: One `degraded` frame per overflow BURST, not per dropped frame.
        self._overflow_flagged = False
        #: `(monotonic timestamp, ms of audio)` for the recent client binary frames — the rolling
        #: rate ceiling's two budgets read the same deque.
        self._recent_frames: deque[tuple[float, float]] = deque()
        #: Latched after `session.update` so the ONE unavoidable spurious `prefix_padding_ms` error
        #: event is swallowed and every other upstream error still forwards (§7-S0 ②).
        self._swallow_pad_error = False

    # ── public entry ──────────────────────────────────────────────────────────────────────────────

    async def run(self) -> None:
        """The whole session, and the ONE place a failure becomes a typed downlink + close code.

        The `max_session_s` deadline wraps everything after `accept()`: Speaches hard-expires a session
        at 30 min via its own `asyncio.timeout` (§7-S0 ②), so ours exists to end the call *knowingly*
        (a typed `session_limit` the overlay can render) rather than as a surprise 1006.
        """
        try:
            async with asyncio.timeout(self._cfg.max_session_s):
                await self._handshake_client()
                await self._dial_upstream()
                await self._configure_upstream()
                await self._send_down({"type": "state", "state": "ready"})
                await self._pump()
                await self._send_down({"type": "state", "state": "ended"})
                await self._close(CLOSE_OK, "ended")
        except _ProtocolError as exc:
            await self._fail("protocol", str(exc), CLOSE_PROTOCOL, "protocol error")
        except _UpstreamRefused as exc:
            await self._fail("upstream_refused", str(exc), CLOSE_UPSTREAM, "upstream refused")
        except _UpstreamLost as exc:
            await self._fail("upstream_lost", str(exc), CLOSE_UPSTREAM, "upstream lost")
        except TimeoutError:
            await self._fail("session_limit", "call time limit reached", CLOSE_OK, "session limit")
        except _ClientGone:
            pass  # the phone hung up: nothing to tell it, nothing to close
        finally:
            await self._close_upstream()

    # ── phase 1: the client handshake ─────────────────────────────────────────────────────────────

    async def _handshake_client(self) -> None:
        """Await the ONE `start` control message and build the session's resampler from it.

        The client measures its real `AudioContext.sampleRate` and declares it (§3.1) — a browser gives
        44.1 k or 48 k depending on the device and there is no way to ask for 24 k reliably, so the
        declared rate plus one stateful resampler is the whole rate contract.
        """
        try:
            async with asyncio.timeout(self._cfg.start_timeout_s):
                msg = await self._recv_client()
        except TimeoutError:
            raise _ProtocolError(f"no start message within {self._cfg.start_timeout_s}s") from None
        rate = self._parse_start(msg)
        self._client_rate = rate
        self._resampler = Pcm16Resampler(rate, SPEACHES_WIRE_RATE)

    def _parse_start(self, msg: dict[str, Any]) -> int:
        text = msg.get("text")
        if text is None:
            raise _ProtocolError("the first frame must be a text `start` message, not binary audio")
        data = self._parse_json(text)
        if data.get("type") != "start":
            raise _ProtocolError(f"expected a `start` control message, got {data.get('type')!r}")
        rate = data.get("sample_rate")
        # `isinstance(True, int)` is True in Python — a bool here is a malformed rate, not 1 Hz.
        if not isinstance(rate, int) or isinstance(rate, bool):
            raise _ProtocolError("start.sample_rate must be an integer number of Hz")
        if not MIN_SAMPLE_RATE <= rate <= MAX_SAMPLE_RATE:
            raise _ProtocolError(
                f"start.sample_rate {rate} outside the accepted {MIN_SAMPLE_RATE}–{MAX_SAMPLE_RATE} Hz"
            )
        return rate

    @staticmethod
    def _parse_json(text: str) -> dict[str, Any]:
        try:
            data = json.loads(text)
        except ValueError:
            raise _ProtocolError("control message is not valid JSON") from None
        if not isinstance(data, dict):
            raise _ProtocolError("control message must be a JSON object")
        return data

    # ── phase 2: the Speaches leg ─────────────────────────────────────────────────────────────────

    async def _dial_upstream(self) -> None:
        """Dial hop 1 of the live chain, injecting the bearer server-side.

        The `SecretStr` is unwrapped exactly once, here, at the call site (the A11 rule), and NOTHING
        below reports the exception's text: a connect failure is described by the target's provider
        name and the exception's TYPE only, so no stray library message can carry a credential into a
        log line or a downlink frame.
        """
        url = realtime_url(self._target.base_url, self._target.model)
        headers: dict[str, str] = {}
        if self._target.api_key is not None:
            key = self._target.api_key.get_secret_value()
            if key:
                headers["Authorization"] = f"Bearer {key}"
        try:
            self._up = await self._connect(
                url,
                headers,
                open_timeout=self._policy.connect_timeout_s,
                close_timeout=self._policy.timeout_s,
            )
        except Exception as exc:
            raise self._classify_connect_failure(exc) from None

    def _classify_connect_failure(self, exc: BaseException) -> _UpstreamRefused:
        """The §7-S0 error taxonomy at handshake time: an HTTP **403/4xx** upgrade rejection (bad key,
        missing/unknown model) and an unreachable box are two different operator problems, so they get
        two different messages under the one `upstream_refused` code — there is no next hop to fall
        over to either way, so the client's action (degrade to push-to-talk) is the same."""
        provider = self._target.provider
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if isinstance(status, int):
            detail = f"the realtime endpoint refused the handshake (HTTP {status})"
        elif isinstance(exc, TimeoutError | OSError):
            detail = "the realtime endpoint is unreachable"
        else:
            detail = "the realtime handshake failed"
        log.warning("live voice: %s for provider %r (%s)", detail, provider, type(exc).__name__)
        return _UpstreamRefused(f"{provider}: {detail}")

    async def _configure_upstream(self) -> None:
        """Wait for `session.created`, then send the ONE `session.update` this relay ever sends.

        Two §7-S0 pins are load-bearing here and both look like over-specification until they bite:

        * the `turn_detection` object must carry **all five fields** — a partial one validates as
          `NotGiven` and is SILENTLY DROPPED, so a threshold sent alone simply never applies;
        * `input_audio_transcription.language` is **omitted when blank, never sent as null** — Speaches
          dumps the session with `exclude_defaults`, so a null can never reset a language, and sending
          one only risks a validation error for no gain.

        `create_response: false` is what `intent=transcription` already forces; sending it explicitly
        keeps the object complete (see above) and states the intent at the one place a future reader
        would ask about it.
        """
        # Bounded by the policy's read window: the handshake already succeeded, and S0 measured
        # `session.created` at +8 ms — a silent socket here is a dead ear, not a slow one, and must not
        # hold an admission slot for the whole `max_session_s`. The bound is converted to
        # `_UpstreamLost` rather than left as a `TimeoutError`, which `run()` reserves for the session
        # deadline: "the ear accepted the socket and then said nothing" is an upstream failure.
        try:
            async with asyncio.timeout(self._policy.timeout_s):
                while True:
                    event = await self._recv_upstream()
                    if event.get("type") == "session.created":
                        break
                    await self._handle_upstream_event(event)
        except TimeoutError:
            raise _UpstreamLost(
                f"the realtime endpoint opened no session within {self._policy.timeout_s}s"
            ) from None
        session: dict[str, Any] = {
            "turn_detection": {
                "type": "server_vad",
                # Config alone (D76 §D — the in-call override is gone), sent once, HERE, in the one
                # update this relay ever sends.
                "threshold": self._cfg.vad_threshold,
                "prefix_padding_ms": 0,
                "silence_duration_ms": self._cfg.silence_ms,
                "create_response": False,
            }
        }
        language = (self._target.language or self._policy.language or "").strip()
        if language:  # blank → omit the whole block (never null — see the docstring)
            session["input_audio_transcription"] = {"language": language}
        self._swallow_pad_error = True
        await self._send_up({"type": "session.update", "session": session})

    # ── phase 3: the pumps ────────────────────────────────────────────────────────────────────────

    async def _pump(self) -> None:
        """Run the three legs until the first of them finishes, then tear all of them down once.

        Three rather than two because the client→upstream direction is split by the bounded queue, and
        the split is what makes the R70 flush correct: the client reader OWNS the queue's producer end,
        so a flush injected from inside that reader lands strictly behind the mic audio already
        accepted, with no ordering coordination at all. It is also why the reader "stops draining
        client frames momentarily" during a flush for free — it is busy doing the flush.

        `FIRST_COMPLETED` (not `FIRST_EXCEPTION`): a clean `stop` is the client reader RETURNING, and
        that must end the session exactly as an exception does. `asyncio.create_task` + a single
        cancel-and-gather teardown, shielded so a `max_session_s` cancellation still cleans up —
        deliberately not `asyncio.TaskGroup` (house idiom).
        """
        depth = max(1, self._cfg.relay_queue_ms // self._cfg.frame_ms)
        self._queue = asyncio.Queue(maxsize=depth)
        tasks = [
            asyncio.create_task(self._pump_client(), name="voice-live-client"),
            asyncio.create_task(self._pump_uplink(), name="voice-live-uplink"),
            asyncio.create_task(self._pump_downlink(), name="voice-live-downlink"),
        ]
        try:
            done, _pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            with anyio.CancelScope(shield=True):
                await asyncio.gather(*tasks, return_exceptions=True)
        for task in done:
            task.result()  # re-raise the leg's typed failure, if it had one

    async def _pump_client(self) -> None:
        """Phone → (validate, resample, enqueue) → the relay queue. Returns on a clean `stop`."""
        while True:
            msg = await self._recv_client()
            data = msg.get("bytes")
            if data is not None:
                await self._accept_audio(data)
                continue
            text = msg.get("text")
            if text is None:  # pragma: no cover — starlette always fills one of the two
                raise _ProtocolError("empty websocket frame")
            control = self._parse_json(text)
            kind = control.get("type")
            if kind == "stop":
                return
            if kind == "flush":
                await self._flush()
            elif kind == "start":
                raise _ProtocolError("a live session accepts exactly one `start`")
            else:
                raise _ProtocolError(f"unknown control message {kind!r}")

    async def _pump_uplink(self) -> None:
        """The relay queue → Speaches, as TEXT frames. Deliberately dumb: everything that can be
        rejected was rejected by the producer, so this leg only owns the socket's failure mode."""
        while True:
            payload = await self._queue.get()
            await self._send_up_raw(payload)
            # The DELIVERY half of the queue's contract: `_flush` parks on `Queue.join()` until every
            # queued item has actually reached Speaches (F2), and this is the call that lets it go.
            # AFTER the send on purpose — "done" has to mean delivered, not dequeued. If the send
            # raised, this never runs and the join would wait forever: that is not a hang, because the
            # exception ends this leg, `_pump`'s FIRST_COMPLETED returns, and the teardown cancels the
            # client leg out of its join.
            self._queue.task_done()

    async def _pump_downlink(self) -> None:
        """Speaches → the typed downlink."""
        while True:
            await self._handle_upstream_event(await self._recv_upstream())

    # ── the uplink audio path ─────────────────────────────────────────────────────────────────────

    async def _accept_audio(self, data: bytes) -> None:
        """One client binary frame: caps, then resample, then enqueue.

        THREE caps, because they bound three different things and a byte ceiling alone bounds only the
        first (F4): `max_frame_bytes` bounds one message, `FRAME_MS_TOLERANCE × frame_ms` bounds the
        AUDIO one message may carry, and `_note_frame` bounds both over a rolling window. The frame's
        duration is implied by its length at the rate the client DECLARED — the same rate the
        resampler was built from — and the per-frame cap is what keeps the frame-COUNT queue depth
        truthful in milliseconds.
        """
        if len(data) > self._cfg.max_frame_bytes:
            raise _ProtocolError(
                f"binary frame of {len(data)} bytes exceeds max_frame_bytes ({self._cfg.max_frame_bytes})"
            )
        assert self._client_rate is not None  # `start` precedes every binary frame (phase 1)
        ms = len(data) / 2 / self._client_rate * 1000
        ceiling = FRAME_MS_TOLERANCE * self._cfg.frame_ms
        if ms > ceiling:
            raise _ProtocolError(
                f"binary frame carries {ms:.0f} ms of audio at the declared {self._client_rate} Hz, "
                f"over the {ceiling:g} ms per-frame ceiling ({FRAME_MS_TOLERANCE:g}× frame_ms="
                f"{self._cfg.frame_ms})"
            )
        self._note_frame(ms)
        # Every frame that clears the caps counts as audio fed, whatever the resampler then makes of
        # it — a frame too short to produce an output sample is CARRIED as phase, not discarded, so
        # even a byte-count view would say "nothing fed" about audio that is really in flight (F3).
        self._audio_seen = True
        assert self._resampler is not None
        try:
            converted = self._resampler.feed(data)
        except ValueError as exc:
            raise _ProtocolError(str(exc)) from None
        await self._enqueue(converted, drop_oldest=True)

    def _note_frame(self, ms: float) -> None:
        """The ENFORCED uplink ceiling (§3.1, confirm-round residual — a protocol close, not a
        warning): TWO budgets over one rolling `RATE_WINDOW_S` window, because they bound two
        different resources and either alone is trivially evaded (F4).

        * the **count** budget bounds per-message CPU: more than `RATE_MULTIPLIER ×` the nominal
          `1000/frame_ms` frames per second in the window is a flood of (possibly tiny) messages, each
          of which costs a base64 decode plus a synchronous Silero pass on Speaches' event loop;
        * the **ms** budget bounds audio THROUGHPUT: more than `RATE_MULTIPLIER ×` realtime worth of
          audio in the window is a flood that a few huge frames can mount while staying far inside the
          count budget — which is exactly how a compliant-looking client could ship ~100× realtime.

        Together they bound both, at 2× realtime. Both are BURST budgets over a window rather than
        instantaneous rates, so a short catch-up after a scheduler hiccup passes and only sustained
        excess closes. The relay's own flush burst is exempt BY CONSTRUCTION — it is generated past
        this point and never travels through `_accept_audio`; keep it that way.
        """
        nominal_per_s = 1000.0 / self._cfg.frame_ms
        frame_allowance = int(RATE_MULTIPLIER * nominal_per_s * RATE_WINDOW_S)
        ms_allowance = RATE_MULTIPLIER * RATE_WINDOW_S * 1000
        now = time.monotonic()
        self._recent_frames.append((now, ms))
        cutoff = now - RATE_WINDOW_S
        while self._recent_frames and self._recent_frames[0][0] < cutoff:
            self._recent_frames.popleft()
        if len(self._recent_frames) > frame_allowance:
            raise _ProtocolError(
                f"uplink frame rate exceeded: more than {frame_allowance} frames in "
                f"{RATE_WINDOW_S:g}s ({RATE_MULTIPLIER}× the nominal {nominal_per_s:g}/s for "
                f"frame_ms={self._cfg.frame_ms})"
            )
        window_ms = sum(entry[1] for entry in self._recent_frames)
        if window_ms > ms_allowance:
            raise _ProtocolError(
                f"uplink audio rate exceeded: {window_ms:.0f} ms of audio in {RATE_WINDOW_S:g}s "
                f"({RATE_MULTIPLIER}× realtime is {ms_allowance:g} ms)"
            )

    async def _enqueue(self, pcm: bytes, *, drop_oldest: bool) -> None:
        """Queue one 24 kHz frame as an `input_audio_buffer.append` event.

        `drop_oldest=True` is the MIC path: it must never stall, so a full queue loses its oldest
        frames and one `degraded` state goes down per burst (§3.1 — RealtimeSTT-server's explicit
        contract, not RVC's silent drop). `drop_oldest=False` is the FLUSH path: its frames are
        generated locally at loopback speed and losing them would break the endpoint arithmetic, so it
        waits for room instead. Both are bounded — the flush waiter is unblocked by the uplink leg, and
        if that leg dies the whole session tears down.
        """
        if not pcm:
            return
        item = json.dumps(
            {"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm).decode("ascii")}
        )
        if not drop_oldest:
            await self._queue.put(item)
            return
        dropped = False
        while True:
            try:
                self._queue.put_nowait(item)
                break
            except asyncio.QueueFull:
                try:
                    self._queue.get_nowait()
                    # An evicted item is one the uplink leg will never mark done, so it is marked
                    # here. This is not bookkeeping hygiene: `_flush`'s delivery barrier is
                    # `Queue.join()`, and an unbalanced counter makes that join either hang forever
                    # (a missed `task_done`) or return early (an extra one).
                    self._queue.task_done()
                    dropped = True
                except asyncio.QueueEmpty:  # pragma: no cover — the consumer drained it meanwhile
                    pass
        if dropped and not self._overflow_flagged:
            self._overflow_flagged = True
            log.warning("live voice: relay queue overflow — dropping the oldest uplink audio")
            await self._send_down({"type": "state", "state": "degraded", "reason": "overflow"})
        elif not dropped:
            self._overflow_flagged = False

    async def _flush(self) -> None:
        """R70 §4's release flush: pad the ear's buffer with silence until its endpointing rule fires.

        **This is the one place a `commit` would be tempting, and it is exactly where a commit kills
        the session** (R70 §1.2 arm A / §7-S0 amendment (i)): a commit with a speech segment still open
        trips `assert audio_end_ms is not None` and the words are lost at a bare 1006. The relay
        therefore NEVER commits — not here, not anywhere. What it does instead is arithmetic on the
        endpointing law: a stop needs either no speech in the trailing 3 s or a closed segment with the
        buffer past 3000 ms, so `max(3000, silence_ms) + 200` ms of zero-frames satisfies whichever of
        the two applies — WHATEVER the ear's buffer holds. (The expression states the LAW; with
        `silence_ms` bounded ≤ 1200 since D76 the max is 3000 every time — a constant 3200 ms pad.) Unpaced on purpose: this leg is loopback,
        off the client's metered wire, and the measured release→text tail is 530–830 ms.

        **The burst is deliberately a CONSTANT worst-case pad, not `3000 − fed_ms` (F3, two review
        rounds).** R70 §4's subtraction assumed the relay could know how much audio the ear's CURRENT
        buffer holds, and it cannot: `committed` events cannot be correlated with what was fed, so a
        per-buffer count goes stale in BOTH directions — processed-stale (the reset erases the next
        phrase's count; the no-op/short burst loses its words) and unprocessed-stale (the mirror: the
        count still includes the committed phrase, `3000 − fed_ms` goes near zero, and the burst lands
        below the 3 s floor — the phrase never endpoints). Both were caught by review; the shortening
        was an optimization, and it was the bug. The constant pad costs only loopback appends, and
        NOTHING in latency: Silero endpoints the moment the threshold is crossed mid-burst, and the
        burst's tail lands in the freshly rotated buffer as leading silence (which only helps the next
        endpoint past its own 3 s floor). The no-op guard is the one bit the relay can actually know:
        a session that never fed audio has nothing to flush; everything else bursts.
        """
        if not self._speech_open and not self._audio_seen:
            return
        needed = max(float(VAD_WINDOW_MS), float(self._cfg.silence_ms)) + FLUSH_MARGIN_MS
        chunk = self._cfg.frame_ms
        frames = int(needed // chunk)
        # `needed` is rarely a whole number of frames; the leftover (always < `frame_ms`, so always one
        # short frame) is sent too, because the burst's TOTAL duration is what the endpointing law is
        # arithmetic on — rounding it down by up to a frame would leave a short phrase one frame shy.
        remainder = int(needed - frames * chunk)
        log.info("live voice: flushing with %d ms of silence", frames * chunk + remainder)
        quiet = silence(chunk, SPEACHES_WIRE_RATE)
        for _ in range(frames):
            await self._enqueue(quiet, drop_oldest=False)
        if remainder:
            await self._enqueue(silence(remainder, SPEACHES_WIRE_RATE), drop_oldest=False)
        # The DELIVERY BARRIER (F2). Returning once the burst is merely ENQUEUED is not enough: the
        # client reader would resume immediately and its mic frames, which drop the OLDEST item when
        # the queue is full, would evict the burst's own tail — the silence would land upstream SHORT
        # of the 3 s VAD floor and the endpoint would never fire (reviewer's repro: 2760 of 3000 ms
        # delivered). Joining the queue makes the flush return only once everything queued ahead of
        # the burst AND the whole burst has gone upstream; and because this runs inside the client
        # reader, no mic frame can even be READ while it waits, so nothing can evict it. No new hang
        # path: if the uplink leg dies mid-join its exception ends `_pump` through FIRST_COMPLETED and
        # the teardown cancels this leg out of the join.
        await self._queue.join()

    # ── the downlink path ─────────────────────────────────────────────────────────────────────────

    async def _handle_upstream_event(self, event: dict[str, Any]) -> None:
        """Translate one Speaches realtime event into the typed downlink (or absorb it)."""
        kind = event.get("type")
        if kind == "input_audio_buffer.speech_started":
            self._speech_open = True
            await self._send_down({"type": "speech_started"})
        elif kind == "input_audio_buffer.speech_stopped":
            self._speech_open = False
            await self._send_down({"type": "speech_stopped"})
        elif kind == "conversation.item.input_audio_transcription.completed":
            # `final` is the R70 §9.2 seam for phrase-streaming dictation (S2.5): the ear has no
            # partials today (verified twice), so every transcript this relay emits is final — but the
            # FIELD exists from v1 so a partial-capable ear can arrive without a wire change.
            await self._send_down(
                {"type": "transcript", "text": event.get("transcript") or "", "final": True}
            )
        elif kind == "error":
            await self._handle_upstream_error(event)
        # Everything else (`session.updated`, `input_audio_buffer.committed`, `conversation.item.*`,
        # `rate_limits.*`) is upstream bookkeeping the phone has no use for — absorbed, not forwarded.
        # `committed` in particular DELIBERATELY updates nothing (F3, two rounds): it cannot be
        # correlated with what the relay fed, so no per-buffer accounting hangs off it — see `_flush`.

    async def _handle_upstream_error(self, event: dict[str, Any]) -> None:
        """Forward upstream errors, minus the ONE known-spurious one.

        §7-S0 ②: sending the complete `turn_detection` ALWAYS draws
        `Specifying \\`session.turn_detection.prefix_padding_ms\\` is not supported…` while
        `session.updated` still lands and the update still applies (`session_event_router.py:36/51`).
        Swallowing it is not optimism — it is the documented cost of the only spelling that works.
        Exactly one is absorbed, and only after `session.update`; every other error rides down as
        `upstream_error` and the session CONTINUES (the socket dying is a separate class).
        """
        raw = event.get("error")
        error: dict[str, Any] = raw if isinstance(raw, dict) else {}
        message = str(error.get("message") or "")
        param = str(error.get("param") or "")
        if self._swallow_pad_error and "prefix_padding_ms" in f"{message} {param}":
            self._swallow_pad_error = False
            log.debug("live voice: swallowed the expected prefix_padding_ms session.update error")
            return
        log.info("live voice: upstream error — %s", message or error.get("type") or "unspecified")
        await self._send_down(
            {
                "type": "error",
                "code": "upstream_error",
                "message": message or "the realtime endpoint reported an error",
            }
        )

    # ── socket plumbing ───────────────────────────────────────────────────────────────────────────

    async def _recv_client(self) -> dict[str, Any]:
        """One raw ASGI message from the phone. Raw rather than `receive_text`/`receive_bytes` because
        WHICH of the two arrived is itself part of the contract (a binary frame before `start`, or a
        control sent as binary, is a protocol error — not something to coerce)."""
        try:
            msg = await self._ws.receive()
        except RuntimeError:  # starlette raises this on a receive after disconnect
            self._client_gone = True
            raise _ClientGone("client socket already closed") from None
        if msg.get("type") == "websocket.disconnect":
            self._client_gone = True
            raise _ClientGone(f"client disconnected (code {msg.get('code')})")
        return dict(msg)  # ASGI hands back a MutableMapping; the relay reads a plain dict

    async def _recv_upstream(self) -> dict[str, Any]:
        """One realtime event. A closed upstream is the §7-S0 bare-1006 class: typed, not a traceback."""
        assert self._up is not None
        while True:
            try:
                raw = await self._up.recv()
            except Exception as exc:
                code = getattr(getattr(exc, "rcvd", None), "code", None)
                raise _UpstreamLost(
                    f"the realtime session closed (code {code if code is not None else 1006})"
                ) from None
            if isinstance(raw, bytes):  # pragma: no cover — the fork only ever sends text
                log.debug("live voice: ignoring a %d-byte binary frame from the realtime endpoint", len(raw))
                continue
            try:
                event = json.loads(raw)
            except ValueError:
                log.warning("live voice: unparseable realtime event, ignored")
                continue
            if isinstance(event, dict):
                return event

    async def _send_up(self, event: dict[str, Any]) -> None:
        await self._send_up_raw(json.dumps(event))

    async def _send_up_raw(self, payload: str) -> None:
        assert self._up is not None
        try:
            await self._up.send(payload)
        except Exception as exc:
            code = getattr(getattr(exc, "rcvd", None), "code", None)
            raise _UpstreamLost(
                f"the realtime session closed (code {code if code is not None else 1006})"
            ) from None

    async def _send_down(self, frame: dict[str, Any]) -> None:
        """One downlink frame, serialized and best-effort: a phone that vanished mid-frame is a
        teardown, not an error to report to the phone that vanished."""
        if self._client_gone or self._closed:
            return
        async with self._send_lock:
            try:
                await self._ws.send_json(frame)
            except Exception:  # noqa: BLE001 — the socket is gone; the finally path still runs
                self._client_gone = True

    async def _fail(self, code: str, message: str, close_code: int, reason: str) -> None:
        """The ONE way a session ends badly: a typed `error` frame, then the matching close."""
        log.info("live voice: session ending — %s (%s)", code, message)
        await self._send_down({"type": "error", "code": code, "message": message})
        await self._close(close_code, reason)

    async def _close(self, code: int, reason: str) -> None:
        """Close the phone's socket once. `reason` stays short — a WS close reason is capped at 123
        bytes on the wire, so the detail lives in the `error` frame that precedes it."""
        if self._closed or self._client_gone:
            self._closed = True
            return
        self._closed = True
        try:
            await self._ws.close(code=code, reason=reason)
        except Exception:  # noqa: BLE001 — already gone
            pass

    async def _close_upstream(self) -> None:
        """Close the realtime leg — WITHOUT a commit (the invariant). A failure here must not escape:
        the admission slot is released by the route's one `finally`, and a stuck upstream close that
        propagated would be indistinguishable from a leaked slot."""
        up, self._up = self._up, None
        if up is None:
            return
        try:
            await up.close()
        except Exception:  # noqa: BLE001 — best-effort, exactly like the SDK-client close path
            log.debug("live voice: realtime close failed", exc_info=True)
