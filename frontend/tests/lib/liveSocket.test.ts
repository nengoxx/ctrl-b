import { describe, expect, it, vi } from "vitest";

import {
  CLOSE_BACKPRESSURE,
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
}

function leg(opts?: { ceilingMs?: number; sampleRate?: number }) {
  const frames: LiveDown[] = [];
  const closes: { code: number; reason: string }[] = [];
  const socket = openLiveSocket({
    url: "ws://x/api/voice/live",
    sampleRate: opts?.sampleRate ?? 48000,
    ceilingMs: opts?.ceilingMs ?? 1000,
    onFrame: (f) => frames.push(f),
    onClose: (code, reason) => closes.push({ code, reason }),
    make: (url) => new FakeSocket(url) as unknown as WebSocket,
  });
  return { socket, frames, closes, ws: FakeSocket.last! };
}

describe("liveSocket — the uplink", () => {
  it("sends `start` with the MEASURED rate before anything else", () => {
    const { ws } = leg({ sampleRate: 44100 });
    expect(ws.sent).toEqual([]); // nothing before the upgrade completes
    ws.open();
    expect(ws.sent).toEqual([JSON.stringify({ type: "start", sample_rate: 44100 })]);
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("ships audio only while OPEN — the reconnect gap drops frames, it does not throw", () => {
    const { socket, ws } = leg();
    socket.sendAudio(new ArrayBuffer(8)); // still CONNECTING
    expect(ws.sent).toHaveLength(0);
    ws.open();
    socket.sendAudio(new ArrayBuffer(8));
    expect(ws.sent).toHaveLength(2); // start + the frame
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
});

describe("liveSocket — client backpressure (§3.1/F6)", () => {
  it("converts the ceiling to BYTES at the declared rate", () => {
    // 1000 ms of pcm16 mono at 48 kHz = 48000 samples × 2 bytes.
    expect(bufferedCeilingBytes(1000, 48000)).toBe(96000);
    expect(bufferedCeilingBytes(500, 24000)).toBe(24000);
  });

  it("closes the leg rather than queueing past the ceiling, and reports it as OUR close code", () => {
    const { socket, ws, closes } = leg({ ceilingMs: 1000, sampleRate: 48000 });
    ws.open();
    ws.bufferedAmount = 96001;
    socket.sendAudio(new ArrayBuffer(1920));
    expect(ws.sent).toHaveLength(1); // start only — the frame was NOT queued behind the backlog
    expect(ws.closed?.code).toBe(CLOSE_BACKPRESSURE);
    expect(closes).toEqual([{ code: CLOSE_BACKPRESSURE, reason: "uplink backpressure" }]);
  });

  it("a backlog UNDER the ceiling is ordinary jitter and ships", () => {
    const { socket, ws, closes } = leg({ ceilingMs: 1000, sampleRate: 48000 });
    ws.open();
    ws.bufferedAmount = 95999;
    socket.sendAudio(new ArrayBuffer(1920));
    expect(ws.sent).toHaveLength(2);
    expect(closes).toEqual([]);
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
