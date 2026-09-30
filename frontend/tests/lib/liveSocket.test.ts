import { describe, expect, it, vi } from "vitest";

import {
  CLOSE_BACKPRESSURE,
  CLOSE_CLIENT_BACKLOG,
  bufferedCeilingBytes,
  liveSocketUrl,
  openLiveSocket,
  parseLiveFrame,
  type LiveDown,
} from "../../src/lib/liveSocket";

// lib/liveSocket — ONE leg of `WS /api/voice/live` (D71 §3.1). The relay's own suite pins the server
// half; these arms pin the client's promises to it: `start` FIRST, the downlink union parsed exactly,
// an unknown frame tolerated rather than thrown, and the outbound-buffer ceiling closing the leg
// instead of draining stale speech into an obsolete turn.

/** A WebSocket stand-in with the two things the module reads: `readyState` and `bufferedAmount`. */
class FakeSocket {
  static last: FakeSocket | null = null;
  url: string;
  binaryType = "blob";
  readyState: number = WebSocket.CONNECTING;
  bufferedAmount = 0;
  sent: (string | ArrayBuffer)[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }
  /** The server accepting the upgrade. */
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  say(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
  /** …and the relay's own `ready`, after which (and only after which) audio may flow (R86 LC-5). */
  ready(): void {
    this.open();
    this.say({ type: "state", state: "ready" });
  }
}

function leg(opts?: {
  ceilingMs?: number;
  sampleRate?: number;
  trail?: { callId: string; leg: number };
  mode?: "dictation";
}) {
  const frames: LiveDown[] = [];
  const closes: { code: number; reason: string }[] = [];
  const socket = openLiveSocket({
    url: "ws://x/api/voice/live",
    sampleRate: opts?.sampleRate ?? 48000,
    ceilingMs: opts?.ceilingMs ?? 1000,
    trail: opts?.trail,
    mode: opts?.mode,
    onFrame: (f) => frames.push(f),
    onClose: (code, reason) => closes.push({ code, reason }),
    make: (url) => new FakeSocket(url) as unknown as WebSocket,
  });
  return { socket, frames, closes, ws: FakeSocket.last! };
}

describe("liveSocket — the uplink", () => {
  it("sends `start` with the MEASURED rate before anything else — and nothing else (D76 §D)", () => {
    const { ws } = leg({ sampleRate: 44100 });
    expect(ws.sent).toEqual([]); // nothing before the upgrade completes
    ws.open();
    expect(ws.sent).toEqual([JSON.stringify({ type: "start", sample_rate: 44100 })]);
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("a DEBUG call's `start` names the call and its leg (D77) — both, beside the rate", () => {
    const { ws } = leg({ sampleRate: 48000, trail: { callId: "c-1", leg: 4 } });
    ws.open();
    expect(ws.sent).toEqual([
      JSON.stringify({ type: "start", sample_rate: 48000, call_id: "c-1", leg: 4 }),
    ]);
  });

  it("a DICTATION leg's `start` says so (S11) — and a debug one carries its trail beside it", () => {
    const { ws } = leg({ sampleRate: 48000, mode: "dictation" });
    ws.open();
    expect(ws.sent).toEqual([
      JSON.stringify({ type: "start", sample_rate: 48000, mode: "dictation" }),
    ]);
    const traced = leg({ sampleRate: 48000, mode: "dictation", trail: { callId: "c-2", leg: 1 } });
    traced.ws.open();
    expect(traced.ws.sent).toEqual([
      JSON.stringify({
        type: "start",
        sample_rate: 48000,
        mode: "dictation",
        call_id: "c-2",
        leg: 1,
      }),
    ]);
  });

  it("ships audio only while OPEN — the reconnect gap drops frames, it does not throw", () => {
    const { socket, ws } = leg();
    socket.sendAudio(new ArrayBuffer(8)); // still CONNECTING
    expect(ws.sent).toHaveLength(0);
    ws.ready();
    socket.sendAudio(new ArrayBuffer(8));
    expect(ws.sent).toHaveLength(2); // start + the frame
  });

  it("…and only once the relay said `ready` — the handshake window is not a burst (R86 LC-5)", () => {
    // The relay reads nothing between `start` and its pump (it is dialling the upstream), so anything
    // sent here lands on `_note_frame` in one burst — past ~2 s, a protocol terminal.
    const { socket, ws, frames } = leg();
    ws.open();
    for (let i = 0; i < 5; i++) socket.sendAudio(new ArrayBuffer(8));
    ws.say({ type: "state", state: "degraded" }); // not `ready`: still nothing
    socket.sendAudio(new ArrayBuffer(8));
    expect(ws.sent).toEqual([JSON.stringify({ type: "start", sample_rate: 48000 })]);
    ws.say({ type: "state", state: "ready" });
    expect(frames.at(-1)).toEqual({ type: "state", state: "ready" }); // the caller still hears it
    socket.sendAudio(new ArrayBuffer(8));
    expect(ws.sent).toHaveLength(2);
    // …and the latch is PER LEG: a fresh socket starts closed again.
    const next = leg();
    next.ws.open();
    next.socket.sendAudio(new ArrayBuffer(8));
    expect(next.ws.sent).toHaveLength(1);
  });

  it("the latch lands BEFORE the caller's handler — a frame shipped from inside it goes out", () => {
    const socket = openLiveSocket({
      url: "ws://x/api/voice/live",
      sampleRate: 48000,
      ceilingMs: 1000,
      onFrame: (f) => {
        if (f.type === "state" && f.state === "ready") socket.sendAudio(new ArrayBuffer(8));
      },
      onClose: () => {},
      make: (url) => new FakeSocket(url) as unknown as WebSocket,
    });
    const ws = FakeSocket.last!;
    ws.ready();
    expect(ws.sent).toHaveLength(2); // start + the frame the handler shipped
  });

  it("`flush` and `stop` are the only other things it will ever say", () => {
    const { socket, ws } = leg();
    ws.open();
    socket.flush();
    socket.stop();
    expect(ws.sent.slice(1)).toEqual([
      JSON.stringify({ type: "flush" }),
      JSON.stringify({ type: "stop" }),
    ]);
  });

  it("…and they REPORT whether the frame actually went out (S2.5 confirm round F2)", () => {
    // `flush` has NO ack, so the readyState at the moment of the call is the only honest answer to "did
    // the ear hear me ask" — and S2.5's release is a caller that must know SYNCHRONOUSLY: a leg already
    // CLOSING whose `onclose` has not been delivered yet would otherwise park the whole release on
    // `tail_wait_ms` waiting for a tail nothing can mint, and then discard the clip in silence.
    const { socket, ws } = leg();
    expect(socket.flush()).toBe(false); // still CONNECTING
    expect(socket.stop()).toBe(false);
    ws.open();
    expect(socket.flush()).toBe(true);
    expect(socket.stop()).toBe(true);
    ws.readyState = WebSocket.CLOSING; // the close handshake has started; no event has landed yet
    expect(socket.flush()).toBe(false);
    // …and a `false` is not a lie about a frame that snuck out: exactly the one OPEN flush was sent.
    expect(ws.sent.filter((m) => typeof m === "string" && m.includes("flush"))).toHaveLength(1);
  });

  it("NEVER `commit` — the client API has no such word, and nothing it can be told to do mints one", () => {
    // THE COMMIT-SAFETY INVARIANT, from this side of the wire (R70 §1.2 arm A, measured: a commit
    // while the buffer has an open speech segment KILLS the Speaches session — it is not a "force
    // endpoint"). The relay holds the same invariant on its own side (`services/voice_live.py::_flush`
    // — red-proven there); S2.5's release is the one place a client would be tempted, and its answer
    // is the relay-side `flush` burst. Two arms, because either alone is evadable: the wrapper's
    // SURFACE carries no commit door, and its whole vocabulary — every method, called — emits none.
    const { socket, ws } = leg();
    expect(Object.keys(socket).sort()).toEqual(["close", "flush", "sendAudio", "stop", "unknown"]);
    ws.ready();
    socket.sendAudio(new ArrayBuffer(8));
    socket.flush();
    socket.stop();
    socket.close();
    expect(ws.sent.filter((m) => typeof m === "string" && m.includes("commit"))).toEqual([]);
  });
});

describe("liveSocket — client backpressure (§3.1/F6)", () => {
  it("converts the ceiling to BYTES at the declared rate", () => {
    // 1000 ms of pcm16 mono at 48 kHz = 48000 samples × 2 bytes.
    expect(bufferedCeilingBytes(1000, 48000)).toBe(96000);
    expect(bufferedCeilingBytes(500, 24000)).toBe(24000);
  });

  it("closes the leg rather than queueing past the ceiling, and reports it as OUR close code", () => {
    const { socket, ws, closes } = leg({ ceilingMs: 1000, sampleRate: 48000 });
    ws.ready();
    ws.bufferedAmount = 96001;
    socket.sendAudio(new ArrayBuffer(1920));
    expect(ws.sent).toHaveLength(1); // start only — the frame was NOT queued behind the backlog
    expect(ws.closed?.code).toBe(CLOSE_BACKPRESSURE);
    expect(closes).toEqual([{ code: CLOSE_BACKPRESSURE, reason: "uplink backpressure" }]);
  });

  it("a backlog the frame still FITS under is ordinary jitter and ships", () => {
    const { socket, ws, closes } = leg({ ceilingMs: 1000, sampleRate: 48000 });
    ws.ready();
    ws.bufferedAmount = 94000; // 94000 + 1920 = 95920, still inside the ceiling
    socket.sendAudio(new ArrayBuffer(1920));
    expect(ws.sent).toHaveLength(2);
    expect(closes).toEqual([]);
  });

  it("the frame that would CROSS the ceiling is the one refused — the backlog alone admits one past", () => {
    const { socket, ws, closes } = leg({ ceilingMs: 1000, sampleRate: 48000 });
    ws.ready();
    ws.bufferedAmount = 95999; // under the ceiling on its own…
    socket.sendAudio(new ArrayBuffer(1920)); // …and 97919 once this frame is queued behind it
    expect(ws.sent).toHaveLength(1); // start only
    expect(ws.closed?.code).toBe(CLOSE_BACKPRESSURE);
    expect(closes).toEqual([{ code: CLOSE_BACKPRESSURE, reason: "uplink backpressure" }]);
  });
});

describe("liveSocket — the downlink parse", () => {
  it("parses every frame the relay emits", () => {
    expect(parseLiveFrame('{"type":"state","state":"ready"}')).toEqual({
      type: "state",
      state: "ready",
    });
    expect(parseLiveFrame('{"type":"state","state":"degraded","reason":"overflow"}')).toEqual({
      type: "state",
      state: "degraded",
      reason: "overflow",
    });
    expect(parseLiveFrame('{"type":"speech_started"}')).toEqual({ type: "speech_started" });
    expect(parseLiveFrame('{"type":"speech_stopped"}')).toEqual({ type: "speech_stopped" });
    expect(parseLiveFrame('{"type":"transcript","text":"hi","final":true}')).toEqual({
      type: "transcript",
      text: "hi",
      final: true,
    });
    expect(parseLiveFrame('{"type":"error","code":"busy","message":"taken"}')).toEqual({
      type: "error",
      code: "busy",
      message: "taken",
    });
  });

  it("carries the segment's `item_id` on all three segment frames — and never a malformed one (D80 ③)", () => {
    expect(
      parseLiveFrame('{"type":"speech_started","item_id":"item_A","audio_start_ms":40}'),
    ).toEqual({ type: "speech_started", item_id: "item_A" });
    expect(parseLiveFrame('{"type":"speech_stopped","item_id":"item_A"}')).toEqual({
      type: "speech_stopped",
      item_id: "item_A",
    });
    // the gap cut's empty final: the id rides, the trail-only fields are not the client's
    expect(
      parseLiveFrame(
        '{"type":"transcript","text":"","final":true,"item_id":"item_B","reason":"short","gap_ms":80}',
      ),
    ).toEqual({ type: "transcript", text: "", final: true, item_id: "item_B" });
    expect(parseLiveFrame('{"type":"speech_started","item_id":7}')).toEqual({
      type: "speech_started",
    });
    expect(parseLiveFrame('{"type":"speech_stopped","item_id":""}')).toEqual({
      type: "speech_stopped",
    });
  });

  it("refuses junk without throwing: bad JSON, a non-object, an unknown state", () => {
    expect(parseLiveFrame("not json")).toBeNull();
    expect(parseLiveFrame("[1,2]")).toBeNull();
    expect(parseLiveFrame('{"type":"state","state":"sideways"}')).toBeNull();
  });

  it("an UNKNOWN frame type is counted and the leg keeps working (forward compatibility)", () => {
    const { socket, frames, ws } = leg();
    ws.open();
    ws.say({ type: "partial", text: "a future relay's idea" });
    expect(frames).toEqual([]);
    expect(socket.unknown()).toBe(1);
    ws.say({ type: "transcript", text: "still fine", final: true });
    expect(frames).toEqual([{ type: "transcript", text: "still fine", final: true }]);
  });

  it("binary downlink is not a thing on this route and is ignored", () => {
    const { frames, ws } = leg();
    ws.open();
    ws.onmessage?.({ data: new ArrayBuffer(4) } as MessageEvent);
    expect(frames).toEqual([]);
  });
});

describe("liveSocket — the URL", () => {
  it("follows the page's scheme, so Tailscale Serve gets `wss`", () => {
    expect(liveSocketUrl({ protocol: "https:", host: "emma.ts.net" })).toBe(
      "wss://emma.ts.net/api/voice/live",
    );
    expect(liveSocketUrl({ protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/api/voice/live",
    );
  });
});

describe("liveSocket — close reporting", () => {
  it("reports the server's close code and reason exactly once", () => {
    const { closes, ws } = leg();
    ws.open();
    const onclose = ws.onclose!;
    onclose({ code: 1013, reason: "busy" } as CloseEvent);
    onclose({ code: 1013, reason: "busy" } as CloseEvent);
    expect(closes).toEqual([{ code: 1013, reason: "busy" }]);
  });

  it("an `error` event is not a second report — the close that follows it is the report", () => {
    const { closes, ws } = leg();
    ws.open();
    ws.onerror?.();
    expect(closes).toEqual([]);
  });

  it("`close()` is safe on an already-closed leg", () => {
    const { socket, ws } = leg();
    ws.open();
    socket.close();
    const spy = vi.spyOn(ws, "close");
    socket.close();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("liveSocket — the client's own close codes (Phase 26 S1, T3)", () => {
  it("the two private-range codes: 4000 the socket's buffer (K3), 4001 the pacer's backlog (K2)", () => {
    expect(CLOSE_BACKPRESSURE).toBe(4000);
    expect(CLOSE_CLIENT_BACKLOG).toBe(4001);
  });

  it("a CODED `close` goes out on the wire with its code and reason — bare stays bare", () => {
    const a = leg();
    a.ws.ready();
    a.socket.close(CLOSE_CLIENT_BACKLOG, "client backlog");
    expect(a.ws.closed).toEqual({ code: 4001, reason: "client backlog" });
    expect(a.closes).toEqual([{ code: 4001, reason: "client backlog" }]);
    const b = leg();
    b.ws.ready();
    b.socket.close();
    expect(b.ws.closed).toEqual({ code: undefined, reason: undefined });
  });

  it("reports the code THIS CLIENT chose even when the link never echoed it (the browser says 1006)", () => {
    // A leg thrown away over a backed-up link is exactly the one whose closing handshake cannot finish:
    // the server's echo never arrives and the event reads 1006. The readers want the client's reason.
    const { socket, ws, closes } = leg({ ceilingMs: 1000, sampleRate: 48000 });
    ws.ready();
    ws.close = (code?: number, reason?: string) => {
      ws.closed = { code, reason }; // the close frame goes out… and nothing comes back
      ws.readyState = WebSocket.CLOSING;
    };
    ws.bufferedAmount = 96001;
    socket.sendAudio(new ArrayBuffer(1920)); // the K3 bail
    ws.onclose?.({ code: 1006, reason: "" } as CloseEvent); // …the abnormal end, much later
    expect(closes).toEqual([{ code: CLOSE_BACKPRESSURE, reason: "uplink backpressure" }]);
  });

  it("…but an AUTHORITATIVE server close that raced ours wins — the server's code is the truth", () => {
    const { socket, ws, closes } = leg();
    ws.ready();
    ws.close = (code?: number, reason?: string) => {
      ws.closed = { code, reason };
      ws.readyState = WebSocket.CLOSING;
    };
    socket.close(CLOSE_CLIENT_BACKLOG, "client backlog"); // ours goes out…
    ws.onclose?.({ code: 1011, reason: "upstream lost" } as CloseEvent); // …the relay's closed first
    expect(closes).toEqual([{ code: 1011, reason: "upstream lost" }]);
  });

  it("…and a leg the SERVER ended keeps the server's code", () => {
    const { closes, ws } = leg();
    ws.ready();
    ws.onclose?.({ code: 1011, reason: "upstream lost" } as CloseEvent);
    expect(closes).toEqual([{ code: 1011, reason: "upstream lost" }]);
  });
});
