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
 *  one too (D9), naming the segment it answered. A `state` frame's `reason` IS parsed:
 *  `degraded{reason:"overflow"}`, and `ended{reason:"superseded"}` (Phase 26 D5 — a newer leg of this
 *  same tab took the relay's slot; the plain `stop` end carries none).
 *
 *  THE LEG CLOCK (ASR_PLAN §3.2, S7a — THIS UNION IS S7b's CONTRACT). A relay that runs the new ear says
 *  so on `ready`: `clock: "leg"` AND `answer_ttl_ms`, both or neither (H5/H9). On such a leg — and ONLY
 *  there — a final's `audio_start_ms`/`audio_end_ms`/`reason`/`outcome` are parsed and validated (§3.5 ②,
 *  `capFinalAnomaly`), and `state:"flushed"` closes a dictation release (§3.5 ⑥). On a leg WITHOUT the
 *  capability (today's Speaches relay, a rolled-back one) the transcript parses exactly as before: today's
 *  relay already forwards `audio_*` and, on a D80 ④ gap cut, `reason:"short"` + `gap_ms` with NO
 *  `outcome` — trail data there, never the client's, so an ungated pair check would turn every gap cut
 *  into an anomaly. Fields beyond these are ignored (D85 adds `accept`/`owner_check` to the same two
 *  frames — §3.12: an old parser copies only the fields it knows). */
export type LiveDown =
  | {
      type: "state";
      state: "ready";
      reason?: string;
      /** The capability pair (§3.2, §3.5 ⑨) — present together or not at all. */
      clock?: "leg";
      answer_ttl_ms?: number;
      /** Half a pair, or a malformed one (H5): the leg runs WITHOUT the capability, and says why once. */
      anomaly?: string;
    }
  | { type: "state"; state: "ended" | "degraded"; reason?: string }
  /** A capability leg's flush is answered (§3.5 ⑥): its `reason:"flush"` final is already out. */
  | { type: "state"; state: "flushed" }
  | { type: "speech_started"; item_id?: string }
  | { type: "speech_stopped"; item_id?: string }
  | {
      type: "transcript";
      text: string;
      final: boolean;
      item_id?: string;
      audio_start_ms?: number;
      audio_end_ms?: number;
      reason?: LiveReason;
      outcome?: LiveOutcome;
      /** A capability final that failed validation (H1) — DELIVERED, never dropped (a dropped final would
       *  strand its awaited id until the TTL and hold the mouth): its consumer settles the id and takes no
       *  text. The value names the first failed check. */
      anomaly?: string;
    }
  | { type: "error"; code: string; message: string; item_id?: string };

/** Why a segment ENDED (§3.5 ②): the VAD's end, a release-forced flush, the cap cut, a retraction. */
export type LiveReason = "endpoint" | "flush" | "max_segment" | "short";
/** What the pass/ASR SAID (§3.5 ②). `quiet` is NOT wire-valid in this phase. */
export type LiveOutcome = "ok" | "no_speech" | "asr_error" | "skipped";
const REASONS: readonly string[] = ["endpoint", "flush", "max_segment", "short"];
const OUTCOMES: readonly string[] = ["ok", "no_speech", "asr_error", "skipped"];
/** `setTimeout`'s own ceiling — a longer TTL would fire at once (H9). No product clamp below it: the relay
 *  owns `timeout_s`, and the TTL is that cap + 1 s (§3.5 ⑨). */
const TTL_MAX_MS = 2 ** 31 - 1;

/** THE PAIR RULE (EL-1, council 3): `short` and `skipped` only ever go together — a retraction runs no pass
 *  or ASR — and every other reason carries one of the three answers. 10 valid of the 16 combinations. */
function validPair(reason: string, outcome: string): boolean {
  return (reason === "short") === (outcome === "skipped");
}

/** A capability leg's final, judged (§3.5 ①②): why it is INVALID, or null. `lastEndMs` is the leg's
 *  latest valid `audio_end_ms` — "monotonic" means END non-decreasing across the leg's finals (FIFO stop
 *  order), never `start(n+1) ≥ end(n)`: the tentative start's pre-roll is "never clamped at the previous
 *  segment's end" (§3.4), so a valid start may sit before the previous end. */
function capFinalAnomaly(f: Record<string, unknown>, lastEndMs: number): string | null {
  if (typeof f.item_id !== "string" || f.item_id === "") return "item_id";
  const start = f.audio_start_ms;
  const end = f.audio_end_ms;
  if (typeof start !== "number" || typeof end !== "number") return "bounds";
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) return "bounds";
  if (end < lastEndMs) return "order";
  const { reason, outcome } = f;
  if (typeof reason !== "string" || !REASONS.includes(reason)) return "pair";
  if (typeof outcome !== "string" || !OUTCOMES.includes(outcome)) return "pair";
  return validPair(reason, outcome) ? null : "pair";
}

/** The `ready` frame's capability pair (§3.2, H5/H9): both valid ⇒ the leg clock; neither ⇒ today's
 *  leg; anything in between ⇒ today's leg AND an anomaly, never a guess at what the relay meant. Keyed on
 *  the two fields themselves, never on how many fields the frame has (D85 adds more). */
function readyFields(f: Record<string, unknown>): {
  clock?: "leg";
  answer_ttl_ms?: number;
  anomaly?: string;
} {
  if (f.clock === undefined && f.answer_ttl_ms === undefined) return {};
  const ttl = f.answer_ttl_ms;
  if (
    f.clock === "leg" &&
    typeof ttl === "number" &&
    Number.isInteger(ttl) &&
    ttl >= 1 &&
    ttl <= TTL_MAX_MS
  )
    return { clock: "leg", answer_ttl_ms: ttl };
  return { anomaly: "ready_pair" };
}

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
 *  is counted by the caller, never thrown — the same forward-compatible stance the SSE reducer takes.
 *
 *  `leg` is the caller's LATCHED capability (G-1 — `openLiveSocket` owns the latch, this stays pure):
 *  absent ⇒ a leg without the clock, parsed exactly as before S7a; present ⇒ a final carries its bounds,
 *  reason and outcome, judged against the leg's latest valid `audio_end_ms`. */
export function parseLiveFrame(raw: string, leg?: { lastEndMs: number }): LiveDown | null {
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
      // `flushed` carries nothing (§3.5 ⑥); parsed on any leg — only a capability leg's release waits on it.
      if (s === "flushed") return { type: "state", state: "flushed" };
      if (s !== "ready" && s !== "ended" && s !== "degraded") return null;
      const reason = typeof f.reason === "string" ? f.reason : undefined;
      const base = { type: "state" as const, ...(reason === undefined ? {} : { reason }) };
      return s === "ready" ? { ...base, state: s, ...readyFields(f) } : { ...base, state: s };
    }
    case "speech_started":
      return { type: "speech_started", ...itemIdOf(f) };
    case "speech_stopped":
      return { type: "speech_stopped", ...itemIdOf(f) };
    case "transcript": {
      // `final` is the relay's own constant `true` today; read it rather than assume it, so a future
      // partial (architecture ② — §4.1 says we have none) arrives as data instead of as a submission.
      const final = f.final !== false;
      const frame: LiveDown = {
        type: "transcript",
        text: typeof f.text === "string" ? f.text : "",
        final,
        ...itemIdOf(f),
      };
      if (!leg || !final) return frame;
      // A CAPABILITY final (§3.5 ②): its fields ride when well-typed, and a failed check is DELIVERED
      // marked (H1) — the consumer settles the id and takes no text. Each field is copied only in its
      // own valid shape, so a consumer never reads a reason the union does not name.
      const anomaly = capFinalAnomaly(f, leg.lastEndMs);
      const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
      return {
        ...frame,
        ...(num(f.audio_start_ms) ? { audio_start_ms: f.audio_start_ms } : {}),
        ...(num(f.audio_end_ms) ? { audio_end_ms: f.audio_end_ms } : {}),
        ...(typeof f.reason === "string" && REASONS.includes(f.reason)
          ? { reason: f.reason as LiveReason }
          : {}),
        ...(typeof f.outcome === "string" && OUTCOMES.includes(f.outcome)
          ? { outcome: f.outcome as LiveOutcome }
          : {}),
        ...(anomaly === null ? {} : { anomaly }),
      };
    }
    case "error":
      return {
        type: "error",
        code: typeof f.code === "string" ? f.code : "error",
        message: typeof f.message === "string" ? f.message : "",
        // …and the segment it was raised for, when named (Phase 26 D9). On a capability leg the typed
        // final comes FIRST and this `upstream_error` after it (H6, §3.9 ①); today's relay sends none.
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
  /** …and frames this build KNOWS but found invalid on a capability leg (H1/H5): a half `ready` pair, a
   *  final that failed §3.5 ②. Delivered marked `anomaly`, counted here — the trail's evidence that the
   *  relay broke its own contract. */
  anomalies: () => number;
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
  let anomalies = 0;
  let done = false;
  // THE READY LATCH (R86 LC-5). The relay reads nothing from the client between `start` and its
  // `_pump` — it is dialling and configuring the upstream — so frames sent in that window reach
  // `_note_frame` in ONE burst when the pump starts, spending the relay's uplink allowance (30 s, full
  // at `ready`) on a handshake instead of keeping it for the stall it exists for. Audio before `ready`
  // is also audio no session is listening to yet. So the door drops it, per leg (a fresh leg latches afresh), exactly like the
  // reconnect gap it already dropped; the callers' pacers keep their own clocks either way.
  let ready = false;
  // THE CAPABILITY LATCH (S7a, G-1 — the ready latch's twin): set by THIS leg's `ready` when it declares
  // the leg clock (§3.2), holding the latest valid `audio_end_ms` the monotonic check reads. Validation
  // lives HERE, once, for both hooks; `parseLiveFrame` is handed the latched bit and stays pure. Per leg
  // (a fresh leg latches afresh), and a later `ready` without the pair turns it off.
  let clock: { lastEndMs: number } | null = null;
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
    const frame = parseLiveFrame(e.data, clock ?? undefined);
    if (frame === null) {
      unknown += 1;
      return;
    }
    // Latched BEFORE the caller hears it, so anything it ships from inside its own handler goes out.
    if (frame.type === "state" && frame.state === "ready") {
      ready = true;
      clock = frame.clock === "leg" ? { lastEndMs: 0 } : null;
    }
    if ("anomaly" in frame && frame.anomaly !== undefined) anomalies += 1;
    // Only a VALID final moves the monotonic floor — an anomalous one says nothing the next can trust.
    else if (clock !== null && frame.type === "transcript" && frame.audio_end_ms !== undefined)
      clock.lastEndMs = frame.audio_end_ms;
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
    anomalies: () => anomalies,
  };
}
