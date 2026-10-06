// THE CALL'S SOCKET LEG (Phase 24 / D71 §3.1) — a typed wrapper over ONE connection to
// `WS /api/voice/live`, the first WebSocket this app has ever opened.
//
// ONE LEG, NO POLICY. This module owns the wire and nothing else: the `start` handshake, the four
// uplink shapes, the downlink parse, and the one client-side rule that has to live where `send()` is
// called (the outbound-buffer ceiling). RECONNECT POLICY — how many attempts, how long between them,
// when to give up — belongs to the machine, because reconnecting means starting a NEW session and the
// machine is what knows whether the call is still wanted.
//
// THE WIRE IS LAW (`services/voice_live.py`, the §7-S1 as-built record). Uplink: one TEXT
// `{"type":"start","sample_rate":<Hz>}` FIRST (plus `mode: "dictation"` on a dictation leg, S11, the
// D77 trail pair on a debug leg, and — on EVERY leg of a tab that can mint one — the tab's `client_id`,
// Phase 26 D5, added HERE so no caller can forget it), then binary pcm16 LE mono frames at that declared rate,
// plus the TEXT controls `{"type":"flush"}` and `{"type":"stop"}`. Anything else is a protocol close
// (1008). Two properties of those controls bind every caller:
//   · **`flush` has NO ack** — the endpoint's own `speech_stopped` + `transcript` are the only response;
//   · **`stop` DISCARDS unendpointed audio** — S2.5's release choreography is flush → await the final →
//     stop, and S2a deliberately does not build it (hanging up throws the tail away on purpose).
//
// Downlink is JSON only — no audio ever rides this socket (C3 owns reply audio over HTTP).

/** The downlink union, as the client reads it. The three SEGMENT frames carry the ear's `item_id` when
 *  the relay forwarded one (D80 ③ — one id per VAD segment, on its start, its stop and its transcript),
 *  which is what lets the call judge each final on its OWN segment's evidence — and an `error` may carry
 *  one too (D9), naming the segment it answered instead of a final. The relay also forwards
 *  Speaches' `audio_start_ms`/`audio_end_ms` and, on a gap-cut final, `reason`/`gap_ms` (D80 ④) — those
 *  are the trail's, and nothing here reads them, so they are not parsed. A `state` frame's `reason` IS
 *  parsed: `degraded{reason:"overflow"}`, and `ended{reason:"superseded"}` (Phase 26 D5 — a newer leg of
 *  this same tab took the relay's slot; the plain `stop` end carries none). */
export type LiveDown =
  | { type: "state"; state: "ready" | "ended" | "degraded"; reason?: string }
  | { type: "speech_started"; item_id?: string }
  | { type: "speech_stopped"; item_id?: string }
  | { type: "transcript"; text: string; final: boolean; item_id?: string }
  | { type: "error"; code: string; message: string; item_id?: string };

/** The segment id a frame carries, or nothing — never a non-string (the relay drops malformed ids). */
function itemIdOf(f: Record<string, unknown>): { item_id?: string } {
  return typeof f.item_id === "string" && f.item_id !== "" ? { item_id: f.item_id } : {};
}

/** THE CLOSE CODES seen on this route — the relay's four, and the two private-range codes this client
 *  mints for itself so a reader (the machine, the dictation's `end` line, the relay's leg-end summary —
 *  Phase 26 S1, T3) can tell "the client threw the leg away" from anything the server said:
 *
 *  | code | who    | meaning                                                                        |
 *  |------|--------|--------------------------------------------------------------------------------|
 *  | 1000 | relay  | a clean end (a `stop`, the session limit, the uplink-idle reaper)             |
 *  | 1008 | relay  | protocol — the client broke the wire contract (or a pre-accept refusal)        |
 *  | 1011 | relay  | upstream — the ear refused the handshake, or died mid-session                 |
 *  | 1013 | relay  | busy — every live slot is taken                                               |
 *  | 4000 | client | `send_buffer` — the socket's own outbound buffer passed the ceiling (K3, §3.1) |
 *  | 4001 | client | `client_backlog` — dictation's pacer queue passed `buffered_ceiling_ms` (K2)    |
 *
 *  (1005/1006 are the browser's own: no status / abnormal — a link that died without a close frame.) */
export const CLOSE_BACKPRESSURE = 4000;
/** …the dictation leg thrown away over its own PACER backlog (K2) — before `ready` (a handshake that is
 *  not coming) or after it (stale speech). Distinct from 4000, which is the SOCKET's buffer. */
export const CLOSE_CLIENT_BACKLOG = 4001;

/** THE TAB'S IDENTITY (Phase 26 D5, ASR_PLAN §3.9 ④) — `sessionStorage`, because the key is exactly
 *  per-tab and SURVIVES the reload a discarded tab comes back through (the `ctrlb-live-call` marker's
 *  reasoning, `useLiveCall`). The relay keys its slot by it: a newer leg of the SAME tab takes the slot
 *  over at once — the reload, the reconnect racing a dead link's ≤10 s close (R94 K5) — instead of being
 *  refused `busy` by its own zombie. ONE per tab and mode-agnostic: a call and a dictation in one tab are
 *  the same client, which is safe because a tab never opens a leg while one of its own is still wanted
 *  (the tab-wide leg hold in `store/micRelease` keeps that line — `holdLeg`).
 *
 *  THE ACCEPTED RESIDUAL (SECURITY_MODEL §2.10): "Duplicate tab" and a same-origin `window.open` COPY
 *  `sessionStorage`, id included, so the copy's leg supersedes the original's — the marker's own hole,
 *  bounded the same way. A BroadcastChannel "is this id live elsewhere?" probe is the exit if it is ever
 *  seen. */
const CLIENT_ID_KEY = "ctrlb-live-client";
/** The relay's own predicate for it (`call_trail.valid_call_id`): a canonical LOWERCASE UUID, which is
 *  what `crypto.randomUUID()` mints. A stored value that is anything else is re-minted, never sent. */
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Resolved ONCE per document (`undefined` = not yet): one id per page, and one storage write — jsdom's
 *  Storage schedules a timer per write, and a browser's is a synchronous disk-backed call besides. */
let clientId: string | null | undefined;

/**
 * This tab's `client_id`, or `null` — and `null` means NO FIELD: today's exact `start`, the plain
 * counted cap, and the busy ladder + marker as the compat path. Every storage access is wrapped like the
 * marker's (`markLeg`): a private window, blocked site data or a full quota all throw, and none of them
 * is a reason a leg cannot open. No `randomUUID` (a non-secure context, where the mic cannot open either)
 * is the same `null`. Exported for S8b, whose IndexedDB `owner` is this same id.
 */
export function liveClientId(): string | null {
  if (clientId !== undefined) return clientId;
  clientId = null;
  try {
    const stored = sessionStorage.getItem(CLIENT_ID_KEY);
    if (stored !== null && CLIENT_ID_RE.test(stored)) {
      clientId = stored;
    } else if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      const minted = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_ID_KEY, minted);
      clientId = minted;
    }
  } catch {
    clientId = null; // a write that threw leaves no id this document could keep across a reload
  }
  return clientId;
}

/** The relay's URL on this origin. `wss:` under Tailscale Serve, `ws:` on plain-HTTP dev — derived from
 *  the page rather than configured, because the route is same-origin by construction (the server's
 *  `Origin` rail refuses anything else). */
export function liveSocketUrl(loc: { protocol: string; host: string } = window.location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/voice/live`;
}

/** Bytes of pcm16 mono audio that `ms` milliseconds occupies at `sampleRate` — the ceiling comparison's
 *  whole arithmetic, named so the test can pin it (48 kHz × 1000 ms × 2 bytes = 96000). */
export function bufferedCeilingBytes(ms: number, sampleRate: number): number {
  return (ms / 1000) * sampleRate * 2;
}

/** Parse one downlink text frame. PURE and TOLERANT: an unknown `type` (a newer relay) returns null and
 *  is counted by the caller, never thrown — the same forward-compatible stance the SSE reducer takes. */
export function parseLiveFrame(raw: string): LiveDown | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const f = data as Record<string, unknown>;
  switch (f.type) {
    case "state": {
      const s = f.state;
      if (s !== "ready" && s !== "ended" && s !== "degraded") return null;
      const reason = typeof f.reason === "string" ? f.reason : undefined;
      return { type: "state", state: s, ...(reason === undefined ? {} : { reason }) };
    }
    case "speech_started":
      return { type: "speech_started", ...itemIdOf(f) };
    case "speech_stopped":
      return { type: "speech_stopped", ...itemIdOf(f) };
    case "transcript":
      // `final` is the relay's own constant `true` today; read it rather than assume it, so a future
      // partial (architecture ② — §4.1 says we have none) arrives as data instead of as a submission.
      return {
        type: "transcript",
        text: typeof f.text === "string" ? f.text : "",
        final: f.final !== false,
        ...itemIdOf(f),
      };
    case "error":
      return {
        type: "error",
        code: typeof f.code === "string" ? f.code : "error",
        message: typeof f.message === "string" ? f.message : "",
        // …and the segment it was raised for, when named (Phase 26 D9: an `upstream_error` arrives
        // INSTEAD of that segment's final). The relay sends none today; session B's ear will.
        ...itemIdOf(f),
      };
    default:
      return null;
  }
}

export interface LiveSocket {
  /** Ship one pcm16 frame. Silently drops until THIS leg's relay has said `ready`, and while the socket
   *  is not OPEN — the handshake and the reconnect gap, not errors (see the latch in `openLiveSocket`). */
  sendAudio: (buf: ArrayBuffer) => void;
  /** "End the phrase now" — a relay-side silence burst, NO ack (§7-S1). S2.5's door; unused by S2a.
   *
   *  RETURNS WHETHER THE FRAME ACTUALLY WENT OUT (S2.5 confirm round F2). `flush` has no ack, so the
   *  readyState at the moment of the call is the ONLY honest answer to "did the ear hear me ask" — and
   *  S2.5's release is a caller that must know SYNCHRONOUSLY: a leg already CLOSING whose `onclose` has
   *  not been delivered yet would otherwise have its release park on the full `tail_wait_ms` waiting for
   *  a tail nothing can mint. Callers that do not care ignore it (a `boolean` return is
   *  source-compatible with the `void` one it replaces). */
  flush: () => boolean;
  /** The clean end. DISCARDS audio the ear has not endpointed yet. Same boolean truth as `flush`. */
  stop: () => boolean;
  /** Drop the leg without a `stop` — teardown and the backpressure bail. A caller that is throwing the
   *  leg away for a reason of its OWN names it with one of the private-range codes above (the pacer's
   *  backlog bail, `CLOSE_CLIENT_BACKLOG`); bare, it is the browser's ordinary close. */
  close: (code?: number, reason?: string) => void;
  /** Downlink frames this build does not know, counted rather than thrown (forward compatibility with
   *  a proof: the arm asserts the socket keeps working past one). */
  unknown: () => number;
}

export interface LiveSocketOpts {
  url: string;
  /** The capture's REAL rate — declared in `start`, and the rate the ceiling's byte math uses. */
  sampleRate: number;
  /** `/voice/status.live_call.buffered_ceiling_ms` — the outbound buffer ceiling, in ms of audio. */
  ceilingMs: number;
  onFrame: (frame: LiveDown) => void;
  /** Once per leg. The close event's code — or THIS client's own (4000/4001) when it closed the leg with
   *  one and the event could only say 1005/1006 (the link never completed the closing handshake). */
  onClose: (code: number, reason: string) => void;
  /** THE LEG'S FEATURE (S11) — sent in `start` as `mode` ONLY when present. Dictation passes
   *  `"dictation"`, and the relay skips the D80 ④ gap cut on that leg; a call passes nothing (the relay's
   *  absent default is `call`). */
  mode?: "dictation";
  /** THE CALL TRAIL's identity (D77) — sent in `start` as `call_id` + `leg` ONLY when present, which is
   *  only with `voice.live.debug` on. A call names
   *  itself; a dictation recording names its own trail (S11, `leg: 1`). ONE optional object rather than
   *  two optional fields because the relay
   *  takes them together or not at all (a protocol close otherwise) — the type makes half a pair
   *  unwritable. `callId` is the call's (the file the relay appends to); `leg` is this socket's
   *  ordinal within it, so the relay's lines say which leg of a reconnecting call they belong to. */
  trail?: { callId: string; leg: number };
  /** Test seam: the constructor to use. Production passes nothing and gets the global `WebSocket`. */
  make?: (url: string) => WebSocket;
}

/**
 * Open one leg and send its `start`. The socket is returned immediately — `onFrame`/`onClose` carry
 * everything that happens afterwards, including the relay's own `state: "ready"`, before which this
 * leg ships NO audio (the latch below — the promise is kept here, at the one door, not by each caller).
 */
export function openLiveSocket(opts: LiveSocketOpts): LiveSocket {
  const ws = opts.make ? opts.make(opts.url) : new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";
  const ceiling = bufferedCeilingBytes(opts.ceilingMs, opts.sampleRate);
  let unknown = 0;
  let done = false;
  // THE READY LATCH (R86 LC-5). The relay reads nothing from the client between `start` and its
  // `_pump` — it is dialling and configuring the upstream — so frames sent in that window reach
  // `_note_frame` in ONE burst when the pump starts, spending the relay's uplink allowance (30 s, full
  // at `ready`) on a handshake instead of keeping it for the stall it exists for. Audio before `ready`
  // is also audio no session is listening to yet. So the door drops it, per leg (a fresh leg latches afresh), exactly like the
  // reconnect gap it already dropped; the callers' pacers keep their own clocks either way.
  let ready = false;
  // THE CLOSE THIS CLIENT CHOSE (Phase 26 S1, T3/T4), when it chose one: the backpressure bail, or a
  // caller's own coded `close`. `onClose` reports IT in place of a NON-authoritative event code (1005
  // no status · 1006 abnormal), because a leg thrown away over a backed-up link is exactly the leg whose
  // closing handshake cannot complete — the server's echo never arrives and the browser says 1006, which
  // would erase the one fact the readers want. A code the SERVER actually sent (1000/1008/1011/1013 — it
  // closed first, racing ours) is the truth and always wins.
  let chosen: { code: number; reason: string } | null = null;
  const closeWith = (code: number, reason: string): void => {
    chosen = { code, reason };
    ws.close(code, reason);
  };

  // …and it REPORTS the readyState it checked (see `LiveSocket.flush`): "the socket was not OPEN" is a
  // fact only this line has, and a caller that has to choreograph around an unsent control cannot
  // rediscover it from anywhere else without waiting for the close it is trying not to wait for.
  const control = (type: "flush" | "stop"): boolean => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type }));
    return true;
  };

  ws.onopen = () => {
    // The handshake, and it must be FIRST: the relay builds its resampler from this rate and treats a
    // leading binary frame as a protocol error. The tab's id rides EVERY leg from this one door (D5), so
    // neither hook can forget it; a tab without one sends today's exact frame.
    const client = liveClientId();
    ws.send(
      JSON.stringify({
        type: "start",
        sample_rate: Math.round(opts.sampleRate),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.trail ? { call_id: opts.trail.callId, leg: opts.trail.leg } : {}),
        ...(client === null ? {} : { client_id: client }),
      }),
    );
  };
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data !== "string") return; // binary downlink is not a thing on this route
    const frame = parseLiveFrame(e.data);
    if (frame === null) {
      unknown += 1;
      return;
    }
    // Latched BEFORE the caller hears it, so anything it ships from inside its own handler goes out.
    if (frame.type === "state" && frame.state === "ready") ready = true;
    opts.onFrame(frame);
  };
  ws.onclose = (e: CloseEvent) => {
    if (done) return;
    done = true;
    const mine = chosen !== null && (e.code === 1005 || e.code === 1006) ? chosen : null;
    opts.onClose(mine?.code ?? e.code, mine?.reason ?? e.reason);
  };
  ws.onerror = () => {
    /* an error is always followed by a close — the close is the one report (no double-reporting). */
  };

  return {
    sendAudio: (buf) => {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      // §3.1: `WebSocket.send()` has no awaitable backpressure, so the ONLY honest reading of a
      // backed-up uplink is to throw the leg away. Draining seconds of stale speech into the ear would
      // transcribe it into a turn the owner has long since moved past; a fresh session loses the
      // utterance and says so. Checked BEFORE the send, against what the buffer would hold AFTER it —
      // the backlog alone would admit one frame past the ceiling, which is the thing the ceiling is.
      if (ws.bufferedAmount + buf.byteLength > ceiling) {
        closeWith(CLOSE_BACKPRESSURE, "uplink backpressure");
        return;
      }
      ws.send(buf);
    },
    flush: () => control("flush"),
    stop: () => control("stop"),
    close: (code, reason) => {
      if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) return;
      if (code === undefined) ws.close();
      else closeWith(code, reason ?? "");
    },
    unknown: () => unknown,
  };
}
