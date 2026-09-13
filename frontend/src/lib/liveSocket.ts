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
// `{"type":"start","sample_rate":<Hz>}` FIRST, then binary pcm16 LE mono frames at that declared rate,
// plus the TEXT controls `{"type":"flush"}` and `{"type":"stop"}`. Anything else is a protocol close
// (1008). Two properties of those controls bind every caller:
//   · **`flush` has NO ack** — the endpoint's own `speech_stopped` + `transcript` are the only response;
//   · **`stop` DISCARDS unendpointed audio** — S2.5's release choreography is flush → await the final →
//     stop, and S2a deliberately does not build it (hanging up throws the tail away on purpose).
//
// Downlink is JSON only — no audio ever rides this socket (C3 owns reply audio over HTTP).

/** The downlink union, exactly as the relay emits it. */
export type LiveDown =
  | { type: "state"; state: "ready" | "ended" | "degraded"; reason?: string }
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "error"; code: string; message: string };

/** Close codes seen on this route. 1008 protocol · 1011 upstream · 1013 busy · 1000 clean — plus ONE
 *  private-range code this client mints for itself so the machine can tell "I closed the leg because the
 *  uplink backed up" from anything the server said (§3.1's client-side backpressure rule). */
export const CLOSE_BACKPRESSURE = 4000;

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
      return { type: "speech_started" };
    case "speech_stopped":
      return { type: "speech_stopped" };
    case "transcript":
      // `final` is the relay's own constant `true` today; read it rather than assume it, so a future
      // partial (architecture ② — §4.1 says we have none) arrives as data instead of as a submission.
      return {
        type: "transcript",
        text: typeof f.text === "string" ? f.text : "",
        final: f.final !== false,
      };
    case "error":
      return {
        type: "error",
        code: typeof f.code === "string" ? f.code : "error",
        message: typeof f.message === "string" ? f.message : "",
      };
    default:
      return null;
  }
}

export interface LiveSocket {
  /** Ship one pcm16 frame. Silently drops while the socket is not OPEN (the machine feeds only between
   *  `ready` and teardown, so this is the reconnect gap, not an error). */
  sendAudio: (buf: ArrayBuffer) => void;
  /** "End the phrase now" — a relay-side silence burst, NO ack (§7-S1). S2.5's door; unused by S2a. */
  flush: () => void;
  /** The clean end. DISCARDS audio the ear has not endpointed yet. */
  stop: () => void;
  /** Drop the leg without a `stop` — teardown and the backpressure bail. */
  close: () => void;
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
  onClose: (code: number, reason: string) => void;
  /** Test seam: the constructor to use. Production passes nothing and gets the global `WebSocket`. */
  make?: (url: string) => WebSocket;
}

/**
 * Open one leg and send its `start`. The socket is returned immediately — `onFrame`/`onClose` carry
 * everything that happens afterwards, including the relay's own `state: "ready"`, which is what the
 * machine waits for before feeding audio.
 */
export function openLiveSocket(opts: LiveSocketOpts): LiveSocket {
  const ws = opts.make ? opts.make(opts.url) : new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";
  const ceiling = bufferedCeilingBytes(opts.ceilingMs, opts.sampleRate);
  let unknown = 0;
  let done = false;

  const control = (type: "flush" | "stop"): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type }));
  };

  ws.onopen = () => {
    // The handshake, and it must be FIRST: the relay builds its resampler from this rate and treats a
    // leading binary frame as a protocol error.
    ws.send(JSON.stringify({ type: "start", sample_rate: Math.round(opts.sampleRate) }));
  };
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data !== "string") return; // binary downlink is not a thing on this route
    const frame = parseLiveFrame(e.data);
    if (frame === null) {
      unknown += 1;
      return;
    }
    opts.onFrame(frame);
  };
  ws.onclose = (e: CloseEvent) => {
    if (done) return;
    done = true;
    opts.onClose(e.code, e.reason);
  };
  ws.onerror = () => {
    /* an error is always followed by a close — the close is the one report (no double-reporting). */
  };

  return {
    sendAudio: (buf) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // §3.1: `WebSocket.send()` has no awaitable backpressure, so the ONLY honest reading of a
      // backed-up uplink is to throw the leg away. Draining seconds of stale speech into the ear would
      // transcribe it into a turn the owner has long since moved past; a fresh session loses the
      // utterance and says so. Checked BEFORE the send, so the ceiling bounds what we ever queue.
      if (ws.bufferedAmount > ceiling) {
        ws.close(CLOSE_BACKPRESSURE, "uplink backpressure");
        return;
      }
      ws.send(buf);
    },
    flush: () => control("flush"),
    stop: () => control("stop"),
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
    unknown: () => unknown,
  };
}
