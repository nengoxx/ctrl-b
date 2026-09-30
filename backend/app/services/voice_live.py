"""The live-voice relay — phone WS ↔ Speaches realtime WS (Phase 24 / D71 §3, slice S1).

`WS /api/voice/live` is **the first WebSocket in this codebase**, admitted by D71 for continuous media
ingress ONLY (§3.2): the turn machinery, chat text and every non-media channel stay SSE/HTTP. This
module is the session object behind that route — asyncio only, no threads (RVC's eleven-`Event`
teardown is the counter-example, R51 §2.6), one object per call, nothing shared but the admission
counter.

**What crosses the wire**

* **Uplink (phone → relay):** one JSON `start` (`{"type":"start","sample_rate":<Hz>}` — unknown
  keys are ignored), then raw binary pcm16 LE mono frames at the declared rate, plus the JSON
  controls `flush` and `stop`. The server-VAD knobs come from config alone (D76 §D). A debug call
  (D77) adds `call_id` (a canonical UUID) + `leg` (its reconnect ordinal) to `start` — both or
  neither, validated like `sample_rate` — and only then does the relay write its half of the CALL
  TRAIL (`services/call_trail.py`, gated by `voice.live.debug`). A streaming-dictation leg (S11) adds
  `mode: "dictation"` (`"call"` is the absent default; anything else is a protocol close) — the one
  thing the relay does differently for it is skip the gap cut below.
* **Uplink (relay → Speaches):** `input_audio_buffer.append` with base64 pcm16 @ **24 kHz**, as TEXT
  frames — one binary frame kills the session (§7-S0 ②), which is why the plan's binary uplink stops
  at the relay and pays ~33 % base64 overhead on the loopback leg.
* **Downlink (relay → phone):** JSON only — `state` / `speech_started` / `speech_stopped` /
  `transcript` / `error`. **No audio ever rides this socket** (C3 owns reply audio over HTTP).
  THE SEGMENT ID (D80 ③): Speaches tags all three segment events with the input buffer's `item_id`
  (one id per VAD segment — `input_audio_buffer_event_router.py:75-99`, `input_audio_buffer.py:137/164`),
  and the relay FORWARDS it — `speech_started` also carries Speaches' `audio_start_ms`,
  `speech_stopped` its `audio_end_ms` (the buffer's own audio clock) — so the phone judges each final on
  its OWN segment's evidence even when Speaches overlaps them (`speech_started(B)` before
  `transcript(A)` is routine). Each field rides only when Speaches sent it.
  THE GAP CUT (D80 ④): a segment whose `speech_started → speech_stopped` span — on the RELAY's arrival
  clock, the clock the car evidence was measured on — is shorter than `silence_ms / 2` cannot be real
  speech (Silero cannot emit a real stop under `silence_ms`; it is a flap of the 3 s zero-state
  rescan), unless Speaches' own audio span is ≥ `silence_ms` (a veto: that is a real stop), so its
  transcript goes down EMPTY with a reason —
  `{"type":"transcript","text":"","final":true,"item_id":…,"reason":"short","gap_ms":…}` — which the
  phone disposes of like any empty final (no cue, no note, no hold). `short` is the only `reason` today.
  The audio-clock veto judges the span NET of the pre-roll the ear ECHOED in `session.updated`
  (`prefix_padding_ms`, S11 — the fork back-dates `audio_start_ms` by it; an unpatched ear echoes 0 and
  the relay warns once; the relay's arrival clock is untouched). A DICTATION leg is never
  cut (S11): a flap there carries real words into the composer, and there is no conversation to guard.

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
   88-frame burst in 3 ms is the phone running seconds AHEAD of the wall clock, spent from the uplink
   allowance (`_note_frame`) that exists for real stalls — and the relay makes silence for free. The
   burst is also a **delivery barrier** (S1 review F2): the flush does not return until every one of its frames has
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
import re
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import urlencode, urlsplit, urlunsplit

import anyio

from app.config import UPLINK_ALLOWANCE_MS
from app.core.audio import SPEACHES_WIRE_RATE, Pcm16Resampler, silence
from app.services.call_trail import LIVE_MODES, LiveMode, valid_call_id

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.websockets import WebSocket

    from app.config import LiveCfg
    from app.domain.provider import LivePolicy, ResolvedTarget
    from app.services.call_trail import CallTrail

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

#: The per-frame DURATION ceiling, as a multiple of the configured `frame_ms` (S1 review F4). ×2
#: admits a client that occasionally coalesces two frames after a scheduler hiccup; anything larger is
#: not jitter, it is a protocol violation. This cap is also what makes the frame-COUNT queue depth
#: truthful in milliseconds: `max_frame_bytes` (32 KiB) at the 8 kHz floor is 2048 ms of audio in ONE
#: frame, so without it a "2000 ms" relay queue could hold ~100 s and a fully compliant client could
#: ship ~100× realtime.
FRAME_MS_TOLERANCE = 2.0

#: `start.leg`'s accepted range — the client's per-call reconnect ordinal (D77). Bounded like every
#: other number this relay takes off the wire; a million legs is far past any real call.
MAX_LEG = 1_000_000

#: How many relay trail lines are buffered before one batch goes to disk (D77). Batched so the relay
#: never pays a thread hop per downlink frame; `run()`'s `finally` flushes whatever is left.
TRAIL_BATCH_LINES = 20

#: WebSocket close codes used by this route. 1008 = policy violation (protocol errors + the pre-accept
#: refusals), 1011 = internal/upstream failure, 1013 = try again later (busy), 1000 = clean end.
CLOSE_PROTOCOL = 1008
CLOSE_UPSTREAM = 1011
CLOSE_BUSY = 1013
CLOSE_OK = 1000

#: What the leg summary accepts as an upstream error CODE (`last_err`) — identifier-shaped, bounded.
_ERROR_CODE_RE = re.compile(r"[A-Za-z0-9_.:-]{1,64}")

#: THE GAP CUT's ledger bound (D80 ④): how many VAD segments the relay keeps clocks for while their
#: transcript is still due. Speaches runs one segment at a time and transcribes each in ~0.3–0.5 s, so
#: a healthy leg holds one or two; the bound is for the segments that NEVER get a transcript (an
#: errored transcription publishes `error` instead, R86 LC-2) — the oldest is evicted, and a transcript
#: that arrives for it later simply passes uncut. Bookkeeping, not a preference: the client's own
#: ledger (`SEGMENT_CAP`, `useLiveCall`) is 16; this one is twice that so the relay is never the side
#: that forgets first.
SEGMENT_LEDGER_CAP = 32


@dataclass(slots=True)
class _SegmentClock:
    """One VAD segment's span on TWO clocks (D80 ④): the relay's monotonic arrival time of its start
    and stop (the clock the gap cut judges on — the evidence's) and Speaches' own audio clock
    (`audio_start_ms` on its start, `audio_end_ms` on its stop — the veto; see `gap_cut_ms`). Both are
    trailed on every cut."""

    audio_start_ms: int | None = None
    audio_end_ms: int | None = None
    started_at: float | None = None
    stopped_at: float | None = None

    def audio_gap_ms(self, pre_roll_ms: int) -> int | None:
        """Speaches' audio span NET of the slice-start pre-roll (S11): the fork back-dates
        `audio_start_ms` by `prefix_padding_ms`, clamped at its buffer's start, so a start above 0
        carries the whole pre-roll and is judged without it. A start AT 0 may carry any part of it
        (the clamp hides how much), and there nothing is subtracted — the span then reads long, which
        errs toward the veto: a flap passes uncut rather than a real stop losing its words."""
        if self.audio_start_ms is None or self.audio_end_ms is None:
            return None
        pre_roll = pre_roll_ms if self.audio_start_ms > 0 else 0
        return max(0, self.audio_end_ms - self.audio_start_ms - pre_roll)

    def relay_gap_ms(self) -> int | None:
        if self.started_at is None or self.stopped_at is None:
            return None
        return round((self.stopped_at - self.started_at) * 1000)


def gap_cut_ms(relay_gap_ms: int | None, audio_gap_ms: int | None, silence_ms: int) -> int | None:
    """THE GAP CUT's verdict (D80 ④, the code round's OPEN-1 correction): the span to cut on, or `None`.

    Judged on the RELAY clock — the clock the evidence was measured on (every hallucinated short in the
    car trail had a `speech_started → speech_stopped` arrival gap ≤ 201 ms, every real one ≥ 2361 ms).
    Speaches' AUDIO clock cannot judge a flap: its `audio_start_ms` is back-dated to where the 3 s
    zero-state rescan placed the speech, so a flap's audio span can run far past `silence_ms / 2`. It is
    a VETO only: an audio span ≥ `silence_ms` is a real path-2 stop (its trailing silence lies inside the
    span — Silero cannot emit one sooner), never cut, whatever the relay clock says. No relay clock
    (a stop whose start the relay never timed) ⇒ never cut."""
    if relay_gap_ms is None or relay_gap_ms >= silence_ms / 2:
        return None
    if audio_gap_ms is not None and audio_gap_ms >= silence_ms:
        return None
    return relay_gap_ms


def _segment_fields(event: dict[str, Any], clock: str | None) -> dict[str, Any]:
    """The segment identity a Speaches event carries, as the downlink forwards it (D80 ③): its
    `item_id`, plus the one audio-clock field `clock` names (`audio_start_ms` on a start,
    `audio_end_ms` on a stop). Each rides only when Speaches sent it with the right type — an older or
    different ear that omits them yields the pre-D80 frame, which the phone reads as "no id" (its
    unmeasured, fail-open case) rather than as a malformed one."""
    fields: dict[str, Any] = {}
    item_id = event.get("item_id")
    if isinstance(item_id, str) and item_id:
        fields["item_id"] = item_id
    if clock is not None:
        ms = event.get(clock)
        if isinstance(ms, int) and not isinstance(ms, bool):
            fields[clock] = ms
    return fields


@dataclass(slots=True)
class _LegStats:
    """THE LEG'S SUMMARY (Phase 26 S1, ASR_PLAN §5 T1/T3/T7) — what ONE `log.info` says about every leg
    end, whatever ended it, so a dead dictation or a dropped call is classified from `journalctl` alone.
    Accumulated by the session as the leg runs and read ONCE, by `run()`'s `finally` — the one place
    every path passes (a clean `stop`, every `_fail`, the phone going away — its keepalive death and its
    own close arrive the same way, as `websocket.disconnect` — and an outer cancellation). The trail's
    `leg_end` carries the same counters (`counters`), so the journal and the trail agree.

    Counts and codes only, BY CONSTRUCTION: no field can hold a transcript (the journal never sees the
    owner's words; the trail's `down` lines are where those live)."""

    #: `time.monotonic()` when the relay said `ready`; `None` for a leg that never got there (duration 0).
    started: float | None = None
    #: Binary frames past every uplink cap, and the audio they carried (ms at the declared rate).
    frames: int = 0
    audio_ms: float = 0.0
    #: Transcript frames sent down — and how many carried words: an EMPTY final (the gap cut's, or an ear
    #: that heard nothing) discharges an endpoint, it is not speech.
    finals: int = 0
    finals_text: int = 0
    #: Uplink items the bounded queue EVICTED (T7) — the count beside the once-per-burst `degraded`.
    drops: int = 0
    #: How the leg ended: the `_fail` code (or its finer `summary` — `uplink_idle` for the reaper, whose
    #: wire code is `session_limit`), `stop`, `client_gone`, `cancelled` — or `error` for an exception no
    #: handler owns (still a leg end, still a line).
    reason: str | None = None
    #: The close code the leg ended with (T3): ours from `_close`, or — on `client_gone` — the PEER's, off
    #: its `websocket.disconnect` (4000/4001 the client's own closes, 1000 clean, 1005/1006 abnormal).
    close_code: int | None = None
    #: The last upstream error code the relay forwarded (`_handle_upstream_error`), if any.
    last_err: str | None = None
    #: THE UPLINK ALLOWANCE (Phase 26 S2, T2): the least audio credit the bucket held this leg, in ms —
    #: after each accepted frame, or the credit a refused one found (`_note_frame`). How close a legit
    #: client came to the allowance is the number that says whether 30 s is still comfortable. `None`
    #: for a leg that never armed the bucket (never reached `ready`).
    credit_min_ms: float | None = None
    #: Which budget refused a frame — `ms` (audio ahead of the wall clock) or `frames` (a tiny-frame
    #: flood) — `None` when none did.
    budget: str | None = None

    def counters(self) -> dict[str, Any]:
        """Everything but `reason` — the trail's `leg_end` already names its own."""
        duration = 0.0 if self.started is None else time.monotonic() - self.started
        return {
            "duration_s": round(duration, 1),
            "frames": self.frames,
            "audio_ms": round(self.audio_ms),
            "finals": self.finals,
            "finals_text": self.finals_text,
            "drops": self.drops,
            "close_code": self.close_code,
            "last_err": self.last_err,
            "credit_min_ms": None if self.credit_min_ms is None else round(self.credit_min_ms),
            "budget": self.budget,
        }

    def line(self, mode: str) -> str:
        """The journal line's `key=value` body, `-` for an absent value. The allowance pair (T2) goes
        LAST, after how the leg ended, so the S1 order a reader scans is unchanged."""
        c = self.counters()
        ending = {"reason": self.reason, "close_code": c.pop("close_code"), "last_err": c.pop("last_err")}
        ending |= {"credit_min_ms": c.pop("credit_min_ms"), "budget": c.pop("budget")}
        fields: dict[str, Any] = {"mode": mode, **c, **ending}
        return " ".join(f"{k}={'-' if v is None else v}" for k, v in fields.items())


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
    """The phone's socket closed. Nothing left to send and nothing to close — teardown only.

    `code` is the PEER's close code off the `websocket.disconnect` message (Phase 26 S1, T3) — `None`
    when the socket was already gone and there was no message to read it from."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


class _UplinkIdle(Exception):
    """The phone's socket is open but no audio has crossed it for `uplink_idle_s` (R86 LC-8)."""


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
        trail: CallTrail | None = None,
    ) -> None:
        self._ws = websocket
        self._cfg = cfg
        self._target = target
        self._policy = policy
        self._connect = connect
        #: THE CALL TRAIL (D77) — the store, and this leg's identity from `start`. The relay writes
        #: only when all three line up: the store exists, `cfg.debug` is on (snapshotted with the rest
        #: of `cfg` at session start), and the client named the call. Lines batch in `_trail_lines`
        #: and go to disk off the loop (`_flush_trail`); `_trail_write` keeps batches in order, and
        #: `_trail_tasks` holds the batch flushes in flight so the teardown can wait them out.
        self._trail = trail
        self._call_id: str | None = None
        self._leg: int | None = None
        #: Which feature this leg serves (`start.mode`, S11) — `call` unless the client said otherwise.
        #: Also the trail's DIRECTORY (Phase 26 S1): a dictation's trail lives under `calls/dictation/`.
        self._mode: LiveMode = "call"
        #: THE LEG'S SUMMARY (Phase 26 S1, T1) — accumulated as the leg runs, logged once at its end.
        self._stats = _LegStats()
        self._trail_lines: list[dict[str, Any]] = []
        self._trail_write = asyncio.Lock()
        self._trail_tasks: set[asyncio.Task[None]] = set()
        self._trail_ended = False

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
        #: THE EFFECTIVE PRE-ROLL (S11 fix wave 1): what the ear SAID it applies — Speaches echoes the
        #: whole session in `session.updated`, `turn_detection.prefix_padding_ms` included — never what
        #: config asked for. 0 until an echo carries it: an unpatched ear rejects the field and echoes its
        #: own 0, and netting out a pre-roll nobody applied would under-read every span and cut real short
        #: answers. The gap cut's audio veto nets out THIS (`_gap_cut`).
        self._pre_roll_ms: int = 0
        #: One WARNING per session when the ear's pre-roll is not the configured one (see
        #: `_note_pre_roll_mismatch`) — the loud signal for a Speaches without the fork patch.
        self._pre_roll_warned = False
        #: THE GAP CUT's clocks (D80 ④), one per VAD segment by its `item_id`, from its start until its
        #: transcript consumes it; insertion-ordered, bounded by `SEGMENT_LEDGER_CAP` (oldest evicted).
        self._segments: OrderedDict[str, _SegmentClock] = OrderedDict()
        #: One `degraded` frame per overflow BURST, not per dropped frame.
        self._overflow_flagged = False
        #: THE UPLINK ALLOWANCE's two buckets (`_note_frame`): audio credit in ms and its frame-count
        #: twin, both refilled at wall rate from `_credit_at` — which `_arm_allowance` stamps just before
        #: `ready` goes down. Filled there, not here: a leg's allowance starts with its `ready`.
        self._credit_ms = 0.0
        self._credit_frames = 0.0
        self._credit_at: float | None = None

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
                # THE ALLOWANCE'S CLOCK starts HERE, just before `ready` (§3.3) — never at the first
                # frame, so the backlog a dictation pumps the moment it hears `ready` is paid from the
                # full bucket, not from refill that has not accrued. Its own stamp, not `started`
                # below: that one waits for the send to succeed (the two differ by the send, on purpose).
                self._arm_allowance()
                await self._send_down({"type": "state", "state": "ready"})
                # The leg's clock starts once `ready` actually went down — a send the gone phone
                # swallowed never started a leg (its duration stays 0).
                if not self._client_gone:
                    self._stats.started = time.monotonic()
                await self._pump()
                self._stats.reason = "stop"  # the pump returns only on the client's clean `stop`
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
        except _UplinkIdle as exc:
            # The session_limit CLASS — a clean end the relay chose, not an upstream or wire fault —
            # with its own sentence, so the owner (and the trail) can tell the two apart.
            # The leg summary names it apart (`uplink_idle`); the wire code stays `session_limit`.
            await self._fail("session_limit", str(exc), CLOSE_OK, "uplink idle", summary="uplink_idle")
        except _ClientGone as exc:
            # The phone hung up: nothing to tell it, nothing to close — but HOW it hung up is the one
            # fact the relay has about its end (T3: the client's own 4000/4001, a clean 1000, or a
            # keepalive death's 1006), so it is kept for the leg's summary.
            self._stats.reason = "client_gone"
            self._stats.close_code = exc.code
        finally:
            # A leg end no handler above owned — an outer cancellation (the server stopping), or an
            # exception nothing here names — is still a leg end, and still says so (invariant 8).
            if self._stats.reason is None:
                self._stats.reason = (
                    "cancelled" if isinstance(sys.exception(), asyncio.CancelledError) else "error"
                )
            # THE LEG-END LINE (Phase 26 S1, T1): ONE per leg, on EVERY path, from this one chokepoint —
            # and FIRST, before any await, so a second cancellation landing in the teardown below cannot
            # skip it. Counts and codes only — never the owner's words (`_LegStats`).
            log.info("live voice: leg end %s", self._stats.line(self._mode))
            await self._close_upstream()
            # The trail's last word (D77). A session that never reached `_close` — the phone hung up,
            # or the task was cancelled — still says how it ended; then the tail goes to disk, shielded
            # so a cancellation cannot eat the lines that explain it.
            if not self._trail_ended:
                self._note(
                    "leg_end",
                    code=None,
                    reason="client gone" if self._client_gone else "aborted",
                    **self._stats.counters(),
                )
            with anyio.CancelScope(shield=True):
                await self._flush_trail()
                await asyncio.gather(*self._trail_tasks, return_exceptions=True)

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
        rate, self._call_id, self._leg, self._mode = self._parse_start(msg)
        self._client_rate = rate
        self._resampler = Pcm16Resampler(rate, SPEACHES_WIRE_RATE)

    def _parse_start(self, msg: dict[str, Any]) -> tuple[int, str | None, int | None, LiveMode]:
        """`(sample_rate, call_id, leg, mode)` — `call_id`/`leg` `None` on a leg that writes no trail,
        `mode` `"call"` when the client sent none."""
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
        # THE LEG'S FEATURE (S11) — optional, strict once present like every other `start` field.
        mode = data.get("mode", "call")
        if mode not in LIVE_MODES:
            raise _ProtocolError(f"start.mode must be one of {', '.join(LIVE_MODES)}")
        # THE TRAIL'S IDENTITY (D77) — optional, but with `sample_rate`'s strictness once present: the
        # id becomes a FILENAME, so a malformed one is a protocol error here rather than a path later.
        # The pair travels together (a leg with no call, or a call with no leg, is a client bug).
        if ("call_id" in data) != ("leg" in data):
            raise _ProtocolError("start.call_id and start.leg must be sent together")
        if "call_id" not in data:
            return rate, None, None, mode
        call_id = data["call_id"]
        if not valid_call_id(call_id):
            raise _ProtocolError("start.call_id must be a canonical lowercase UUID")
        leg = data["leg"]
        if not isinstance(leg, int) or isinstance(leg, bool) or not 0 <= leg <= MAX_LEG:
            raise _ProtocolError(f"start.leg must be an integer 0–{MAX_LEG}")
        return rate, call_id, leg, mode

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
          `NotGiven` and is SILENTLY DROPPED, so a threshold sent alone simply never applies.
          `prefix_padding_ms` is honoured since the owned fork's S11 patch (`fd4b956`: a slice-START
          pre-roll); an unpatched ear answers it with one `error` event that forwards like any other
          (the update still applies, the pre-roll simply does not — the relay then nets out the ECHOED
          0 and logs ONE warning naming the fork requirement, `_adopt_pre_roll`);
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
                "prefix_padding_ms": self._cfg.prefix_padding_ms,
                "silence_duration_ms": self._cfg.silence_ms,
                "create_response": False,
            }
        }
        language = (self._target.language or self._policy.language or "").strip()
        if language:  # blank → omit the whole block (never null — see the docstring)
            session["input_audio_transcription"] = {"language": language}
        # The trail's header line: the exact knobs this leg runs (D77) — the update itself, verbatim —
        # and which feature it serves (S11).
        self._note("leg_start", rate=self._client_rate, mode=self._mode, session=session)
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
        """Phone → (validate, resample, enqueue) → the relay queue. Returns on a clean `stop`.

        THE UPLINK-IDLE DEADLINE (R86 LC-8). The client ships a frame every `frame_ms` for the whole
        leg — a held or muted ear goes up as silence of the same length — so `uplink_idle_s` with NO
        binary frame is a page that froze or an ear that died. Nothing else reaps that leg: the
        browser answers the WS ping from its network stack even with the renderer frozen, and the
        client's own clocks cannot run inside it. Left alone it would hold `max_sessions` until
        `max_session_s` and refuse every other device `busy`. The clock is the PHONE's: it restarts on
        every accepted frame, and after a `flush`, whose burst delivery is the relay's own time.
        Converted to `_UplinkIdle` here for the reason `_configure_upstream` converts its bound:
        `run()` reserves `TimeoutError` for the session deadline (the nested scope re-raises that one
        as a cancellation, never as its own expiry).
        """
        idle_s = self._cfg.uplink_idle_s
        heard = time.monotonic()
        while True:
            try:
                async with asyncio.timeout(max(0.0, heard + idle_s - time.monotonic())):
                    msg = await self._recv_client()
            except TimeoutError:
                raise _UplinkIdle(f"no audio from the phone for {idle_s:g}s — the call was ended") from None
            data = msg.get("bytes")
            if data is not None:
                await self._accept_audio(data)
                heard = time.monotonic()
                continue
            text = msg.get("text")
            if text is None:  # pragma: no cover — starlette always fills one of the two
                raise _ProtocolError("empty websocket frame")
            control = self._parse_json(text)
            kind = control.get("type")
            if kind == "stop":
                self._note("stop")
                return
            if kind == "flush":
                await self._flush()
                heard = time.monotonic()
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
        AUDIO one message may carry, and `_note_frame` bounds both against the wall clock. The frame's
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
        self._stats.frames += 1
        self._stats.audio_ms += ms
        assert self._resampler is not None
        try:
            converted = self._resampler.feed(data)
        except ValueError as exc:
            raise _ProtocolError(str(exc)) from None
        await self._enqueue(converted, drop_oldest=True)

    def _arm_allowance(self) -> None:
        """Fill both buckets and start their wall clock — once per leg, just before `ready` (§3.3)."""
        self._credit_ms = float(UPLINK_ALLOWANCE_MS)
        self._credit_frames = UPLINK_ALLOWANCE_MS / self._cfg.frame_ms
        self._credit_at = time.monotonic()
        self._stats.credit_min_ms = self._credit_ms

    def _note_frame(self, ms: float) -> None:
        """THE UPLINK ALLOWANCE (Phase 26 S2, ASR_PLAN §3.3 — a protocol close, not a warning): a
        real-time source can arrive LATE by any amount, but never AHEAD of the wall clock by more than
        the reservoirs between the mic and the relay hold. So the guard is a token bucket refilled at
        wall rate, capacity `UPLINK_ALLOWANCE_MS`, started FULL just before `ready` (`_arm_allowance`).
        The bucket sits full while the phone is on time; a stall's backlog is paid from that STANDING
        capacity (a stall refills at most what earlier early arrivals spent), which is why the capacity
        must cover every reservoir — and `LiveCfg`'s load-time inequality proves it does, so a legit
        client cannot trip it and the call's terminal treatment of a 1008 stays honest. The cap also
        bounds banked credit: a leg idle for a minute can dump 30 s, not 60. No drift term — see the
        constant.

        TWO budgets, because they bound two different resources and either alone is trivially evaded
        (F4):

        * the **ms** budget bounds audio THROUGHPUT: `UPLINK_ALLOWANCE_MS` of credit, earning 1000 ms
          per wall second — a flood a few huge frames can mount while staying far inside any count;
        * the **frames** budget bounds per-message CPU: `UPLINK_ALLOWANCE_MS / frame_ms` frames of
          credit, earning `1000 / frame_ms` per second — a flood of tiny messages, each costing a base64
          decode plus a synchronous Silero pass on Speaches' event loop, that carries realtime audio and
          is invisible to the ms budget.

        A frame whose debit would take either below zero is refused, naming the budget and the credit
        it found. The relay's own flush burst is exempt BY CONSTRUCTION — it is generated past this
        point and never travels through `_accept_audio`; keep it that way.
        """
        assert self._credit_at is not None  # armed before `ready`, and `_pump` runs after it
        frame_ms = self._cfg.frame_ms
        cap_frames = UPLINK_ALLOWANCE_MS / frame_ms
        now = time.monotonic()
        elapsed_ms = (now - self._credit_at) * 1000
        self._credit_at = now
        self._credit_ms = min(float(UPLINK_ALLOWANCE_MS), self._credit_ms + elapsed_ms)
        self._credit_frames = min(cap_frames, self._credit_frames + elapsed_ms / frame_ms)
        refused = "ms" if ms > self._credit_ms else "frames" if self._credit_frames < 1 else None
        if refused is None:
            self._credit_ms -= ms
            self._credit_frames -= 1
        stats = self._stats
        if stats.credit_min_ms is None or self._credit_ms < stats.credit_min_ms:
            stats.credit_min_ms = self._credit_ms
        if refused is not None:
            stats.budget = refused
            why = (
                f"the phone ran more than {UPLINK_ALLOWANCE_MS} ms of audio ahead of the wall clock"
                if refused == "ms"
                else f"the {cap_frames:g}-frame allowance at frame_ms={frame_ms} is exhausted — a tiny-frame flood"
            )
            raise _ProtocolError(
                f"uplink allowance exceeded ({refused} budget): a {ms:.0f} ms frame against "
                f"{self._credit_ms:.0f} ms and {self._credit_frames:.2f} frames of credit — {why}"
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
                    self._stats.drops += 1  # T7 — the COUNT beside the once-per-burst flag below
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
        self._note("flush", pad_ms=frames * chunk + remainder)
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
            fields = _segment_fields(event, "audio_start_ms")
            clock = self._segment_clock(fields.get("item_id"))
            if clock is not None:
                clock.audio_start_ms = fields.get("audio_start_ms")
                clock.started_at = time.monotonic()
            await self._send_down({"type": "speech_started", **fields})
        elif kind == "input_audio_buffer.speech_stopped":
            self._speech_open = False
            fields = _segment_fields(event, "audio_end_ms")
            clock = self._segment_clock(fields.get("item_id"))
            if clock is not None:
                clock.audio_end_ms = fields.get("audio_end_ms")
                clock.stopped_at = time.monotonic()
            await self._send_down({"type": "speech_stopped", **fields})
        elif kind == "conversation.item.input_audio_transcription.completed":
            # `final` is the R70 §9.2 seam for phrase-streaming dictation (S2.5): the ear has no
            # partials today (verified twice), so every transcript this relay emits is final — but the
            # FIELD exists from v1 so a partial-capable ear can arrive without a wire change.
            text = event.get("transcript") or ""
            fields = _segment_fields(event, None)
            cut = self._gap_cut(fields.get("item_id"), text)
            self._stats.finals += 1
            if cut is None and text.strip():
                self._stats.finals_text += 1
            if cut is not None:
                # A sub-silence flap (D80 ④): its words go down as NOTHING, named — the frame is its own
                # trail line (the one downlink hook below), and the phone disposes of it like any empty
                # final. The text it would have carried is the `gap_cut` note's alone (R92 §V: trail it).
                await self._send_down(
                    {
                        "type": "transcript",
                        "text": "",
                        "final": True,
                        **fields,
                        "reason": "short",
                        "gap_ms": cut,
                    }
                )
            else:
                await self._send_down({"type": "transcript", "text": text, "final": True, **fields})
        elif kind == "session.updated":
            self._adopt_pre_roll(event)
        elif kind == "error":
            await self._handle_upstream_error(event)
        # Everything else (`input_audio_buffer.committed`, `conversation.item.*`,
        # `rate_limits.*`) is upstream bookkeeping the phone has no use for — absorbed, not forwarded.
        # `committed` in particular DELIBERATELY updates nothing (F3, two rounds): it cannot be
        # correlated with what the relay fed, so no per-buffer accounting hangs off it — see `_flush`.

    def _segment_clock(self, item_id: str | None) -> _SegmentClock | None:
        """The clock record for segment `item_id`, created on first sight (a start, or a stop whose start
        was missed) — `None` for an event that named no id, which the gap cut then never judges."""
        if item_id is None:
            return None
        clock = self._segments.get(item_id)
        if clock is None:
            if len(self._segments) >= SEGMENT_LEDGER_CAP:
                self._segments.popitem(last=False)
            clock = self._segments[item_id] = _SegmentClock()
        return clock

    def _gap_cut(self, item_id: str | None, text: str) -> int | None:
        """THE GAP CUT (D80 ④, R92 §L3/§V b1): the span, in ms, of a segment too short to be speech — or
        `None` to pass the transcript verbatim. The segment's clocks are CONSUMED either way.

        Why the relay and why `silence_ms / 2`: Silero cannot emit a real stop sooner than `silence_ms`
        after speech (the path-2 stop needs that much trailing silence), so a start→stop span under it
        is Speaches' other stop — the 3 s zero-state rescan finding nothing on the next append, a FLAP.
        The car trail: every hallucinated short ("", "Yeah.", "Mm.") came from a span ≤ 201 ms, every
        real segment's was ≥ 2361 ms. Half of `silence_ms` (350 ms at the default) leaves the relay
        clock's event bunching room and keeps a real one-syllable word's ~0.1–0.2 s of margin (R92 §V —
        recorded). The relay owns it because it owns `silence_ms` and sees all three events.

        The CLOCK (`gap_cut_ms`): the relay's own arrival clock judges — the evidence's clock — and
        Speaches' audio clock only VETOES (a span ≥ `silence_ms` is a real stop). A transcript whose
        segment the relay never timed (no id, an evicted id, a missing stop) is never cut.

        The audio span is judged NET of the pre-roll the ear ECHOED (S11 — see `_SegmentClock.audio_gap_ms`
        and `_adopt_pre_roll`), or the fork's back-dated start would lift every flap toward the veto; the
        CONFIGURED value is never trusted here — an ear that did not apply it would under-read every span. A DICTATION leg is never cut
        (S11, the owner's ruling): a flap mid-dictation can carry real words, and an empty final there
        costs the composer those words (with other phrases landed, the clip that also has them is
        discarded) — the cut exists to keep a call's conversation clean, which a dictation has none of."""
        # The clock is POPPED before any early return — a dictation leg's finals consume their segment's
        # clock too (only the verdict is skipped), or the ledger would sit full of them for the session.
        clock = self._segments.pop(item_id, None) if item_id is not None else None
        if clock is None or self._mode == "dictation":
            return None
        audio, relay = clock.audio_gap_ms(self._pre_roll_ms), clock.relay_gap_ms()
        gap = gap_cut_ms(relay, audio, self._cfg.silence_ms)
        if gap is None:
            return None
        self._note("gap_cut", item_id=item_id, text=text, gap_ms=gap, audio_gap_ms=audio, relay_gap_ms=relay)
        return gap

    def _adopt_pre_roll(self, event: dict[str, Any]) -> None:
        """Take the EFFECTIVE pre-roll from Speaches' `session.updated` echo (S11 fix wave 1). A missing
        or malformed field reads as 0 — the ear's own default, and the value an unpatched fork echoes
        after rejecting the one we sent."""
        session = event.get("session")
        td = session.get("turn_detection") if isinstance(session, dict) else None
        echoed = td.get("prefix_padding_ms") if isinstance(td, dict) else None
        if isinstance(echoed, int) and not isinstance(echoed, bool) and echoed >= 0:
            self._pre_roll_ms = echoed
        else:
            self._pre_roll_ms = 0
        self._note("pre_roll", configured=self._cfg.prefix_padding_ms, effective=self._pre_roll_ms)
        if self._pre_roll_ms != self._cfg.prefix_padding_ms:
            self._note_pre_roll_mismatch()

    def _note_pre_roll_mismatch(self) -> None:
        """ONE warning per session: the ear is not applying the configured pre-roll, so phrase onsets
        stay clipped (BUG-001 H3) and the gap cut nets out only what the ear echoed."""
        if self._pre_roll_warned:
            return
        self._pre_roll_warned = True
        log.warning(
            "live voice: the realtime ear applies prefix_padding_ms=%d, not the configured %d — the "
            "speech pre-roll needs the owned Speaches fork (fd4b956 or later: `turn_detection."
            "prefix_padding_ms` honoured); phrase onsets stay clipped until it is deployed",
            self._pre_roll_ms,
            self._cfg.prefix_padding_ms,
        )

    async def _handle_upstream_error(self, event: dict[str, Any]) -> None:
        """Forward an upstream error as `upstream_error`; the session CONTINUES (the socket dying is a
        separate class). Every one forwards since S11: the one the relay used to swallow — the fork
        refusing `prefix_padding_ms` — is gone with the fork patch that honours it (`fd4b956`)."""
        raw = event.get("error")
        error: dict[str, Any] = raw if isinstance(raw, dict) else {}
        message = str(error.get("message") or "")
        # An ear that REJECTS the pre-roll (an unpatched fork) says so here, before (or instead of) the
        # echo — the effective pre-roll is already 0 unless an echo said otherwise; name it loudly once.
        if "prefix_padding_ms" in f"{message} {error.get('param') or ''}" and self._cfg.prefix_padding_ms:
            self._pre_roll_ms = 0
            self._note_pre_roll_mismatch()
        self._note("up_error", error=error)
        # The leg summary's `last_err` (T1): the error's CODE — an identifier, never its message text.
        # Identifier-shaped only: an upstream is free to put prose in `code`, and the journal line keeps
        # none — anything else reads `unspecified`.
        code = error.get("code") or error.get("type")
        self._stats.last_err = (
            code if isinstance(code, str) and _ERROR_CODE_RE.fullmatch(code) else "unspecified"
        )
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
            code = msg.get("code")
            raise _ClientGone(
                f"client disconnected (code {code})",
                code if isinstance(code, int) and not isinstance(code, bool) else None,
            )
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
            # THE ONE DOWNLINK HOOK (D77): every frame the phone is sent is a trail line — `state`,
            # `speech_*`, `transcript` (the owner's words appear in the trail HERE, once), `error`.
            # UNDER the lock (the S3 code round, F4), so the trail's order is the wire's order when the
            # two pumps send at once.
            self._note("down", frame=frame)
            try:
                await self._ws.send_json(frame)
            except Exception:  # noqa: BLE001 — the socket is gone; the finally path still runs
                self._client_gone = True

    async def _fail(
        self, code: str, message: str, close_code: int, reason: str, *, summary: str | None = None
    ) -> None:
        """The ONE way a session ends badly: a typed `error` frame, then the matching close. `summary` is
        the leg-end line's reason when it names the end more finely than the wire code (`uplink_idle`)."""
        self._stats.reason = summary or code
        log.info("live voice: session ending — %s (%s)", code, message)
        await self._send_down({"type": "error", "code": code, "message": message})
        await self._close(close_code, reason)

    async def _close(self, code: int, reason: str) -> None:
        """Close the phone's socket once. `reason` stays short — a WS close reason is capped at 123
        bytes on the wire, so the detail lives in the `error` frame that precedes it."""
        self._stats.close_code = code
        if not self._trail_ended:
            self._note("leg_end", code=code, reason=reason, **self._stats.counters())
        if self._closed or self._client_gone:
            self._closed = True
            return
        self._closed = True
        try:
            await self._ws.close(code=code, reason=reason)
        except Exception:  # noqa: BLE001 — already gone
            pass

    # ── the call trail (D77) ──────────────────────────────────────────────────────────────────────

    def _note(self, ev: str, **fields: Any) -> None:
        """Buffer one relay trail line — a no-op unless this leg writes a trail (see `__init__`).

        Synchronous, so it can sit on any path, the audio pump's included: a full batch is handed to
        a background task and NOTHING here waits on the disk. `leg_end` latches: whichever of `_close`
        or `run()`'s `finally` says it first is the one that stands."""
        if self._trail is None or not self._cfg.debug or self._call_id is None:
            return
        if ev == "leg_end":
            self._trail_ended = True
        self._trail_lines.append(
            {"t": int(time.time() * 1000), "src": "relay", "leg": self._leg, "ev": ev, **fields}
        )
        # `==`, not `>=`: one flush per batch. Lines that land while it waits for the lock ride it (the
        # swap takes the whole list); the count restarts at zero behind the swap.
        if len(self._trail_lines) == TRAIL_BATCH_LINES:
            task = asyncio.create_task(self._flush_trail(), name="voice-live-trail")
            self._trail_tasks.add(task)
            task.add_done_callback(self._trail_tasks.discard)

    async def _flush_trail(self) -> None:
        """Hand the buffered lines to the store, OFF the event loop (`asyncio.to_thread`). The swap
        happens under `_trail_write` (asyncio's lock is FIFO), so batches reach the file in order."""
        if self._trail is None or self._call_id is None:
            return
        async with self._trail_write:
            lines, self._trail_lines = self._trail_lines, []
            if lines:
                await asyncio.to_thread(
                    self._trail.append, self._call_id, lines, keep=self._cfg.trail_keep, mode=self._mode
                )

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
