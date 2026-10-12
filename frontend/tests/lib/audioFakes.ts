import { vi } from "vitest";

// The Web Audio stand-in shared by every suite that drives a real `AudioContext` consumer: the call's
// capture (`pcmCapture.test.ts`), the background keepalive (`keepalive.test.ts`) and the mouth's reply
// hold (`audioControllerCall.test.ts`, ISS-73 ①). Lifted out of `pcmCapture.test.ts` (ISS-73 ① — the
// keepalive is now ONE module with two owners, so its fake is one class with three readers) rather than
// copied: a second fake would let "the keepalive's node" mean two different things in two suites.
//
// NOT a `.test.ts` file, so vitest's `include` never collects it as a suite (the `dictationFakes`
// precedent). A suite installs it with `vi.stubGlobal("AudioContext", FakeContext)` and resets the
// statics it relies on in its own `beforeEach`.

/** The Web Audio stand-ins, minimal and driveable. `state` is the whole point of the suspended case. */
export class FakeContext {
  static last: FakeContext | null = null;
  /** Every context made, in order — the K6 fallback makes two. */
  static all: FakeContext[] = [];
  /** K6 — the device's own rate: what a context runs at when no rate is asked for. */
  static deviceRate = 48000;
  /** K6 — Firefox/Fennec before 148: `createMediaStreamSource` THROWS on a context whose rate is not
   *  the track's (R96 §2.3). The track here runs at the device rate. */
  static foreignRateThrows = false;
  /** K6 — a browser that takes the option and runs at the device rate anyway (R96 §2.2's unverified
   *  "some devices stick to the system default"): whatever it GIVES is what must be declared. */
  static ignoresRateOption = false;
  /** What the constructor was handed — the K6 ask, recorded. */
  options: AudioContextOptions | undefined;
  state: AudioContextState = "running";
  /** The rate the fake RUNS at: the requested one, as a real context honours it, unless a case says
   *  otherwise. */
  sampleRate: number;
  streamSources = 0;
  closed = 0;
  resumes = 0;
  /** What `resume()` leaves the context in — a policy that refuses the resume leaves it suspended. */
  resumesTo: AudioContextState = "running";
  audioWorklet = { addModule: vi.fn(async () => {}) };
  /** The render clock (ISS-54's trail field) — a case moves it by hand. */
  currentTime = 0;
  /** ISS-54 — the context's own `error`/`statechange` listeners, the `FakeTrack` pattern. */
  ctxListeners: Record<string, ((e: Event) => void)[]> = {};
  addEventListener(type: string, cb: (e: Event) => void) {
    (this.ctxListeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: (e: Event) => void) {
    this.ctxListeners[type] = (this.ctxListeners[type] ?? []).filter((c) => c !== cb);
  }
  /** Raise one of the context's events the way the renderer does (R99 §1.5: `error`, then the state). */
  fire(type: string) {
    for (const cb of [...(this.ctxListeners[type] ?? [])]) cb(new Event(type));
  }
  /** How many listeners are still attached, across both events — `stop()` must leave none (ISS-54 design round, Maya L1). */
  listening(): number {
    return Object.values(this.ctxListeners).reduce((n, l) => n + l.length, 0);
  }
  constructor(options?: AudioContextOptions) {
    this.options = options;
    this.sampleRate =
      (!FakeContext.ignoresRateOption && options?.sampleRate) || FakeContext.deviceRate;
    FakeContext.last = this;
    FakeContext.all.push(this);
  }
  async resume(): Promise<void> {
    this.resumes += 1;
    this.state = this.resumesTo;
  }
  /** ISS-73 ① — the reply hold suspends its context between holds (nothing renders while nothing is
   *  pending); counted like `resumes`. */
  suspends = 0;
  async suspend(): Promise<void> {
    this.suspends += 1;
    this.state = "suspended";
  }
  async close(): Promise<void> {
    this.closed += 1;
    this.state = "closed";
  }
  createMediaStreamSource() {
    if (FakeContext.foreignRateThrows && this.sampleRate !== FakeContext.deviceRate)
      throw new DOMException(
        "Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported.",
        "NotSupportedError",
      );
    this.streamSources += 1;
    return { connect: () => {} };
  }
  /** Every gain this context ever made: the uplink's silent sink, and (D73 S6 ③) the keepalive's. */
  gains: { gain: { value: number }; disconnects: number }[] = [];
  createGain() {
    const node = {
      gain: { value: 1 },
      disconnects: 0,
      connect: () => {},
      disconnect: () => {
        node.disconnects += 1;
      },
    };
    this.gains.push(node);
    return node;
  }
  /** …and every constant source — the keepalive's, started while the page is hidden. `disconnects`
   *  counts the retire's unhook (ISS-73 ①'s `lib/keepalive` tests read it). */
  sources: { started: number; stopped: number; disconnects: number }[] = [];
  createConstantSource() {
    const src = {
      started: 0,
      stopped: 0,
      disconnects: 0,
      start: () => {
        src.started += 1;
      },
      stop: () => {
        src.stopped += 1;
      },
      connect: () => {},
      disconnect: () => {
        src.disconnects += 1;
      },
    };
    this.sources.push(src);
    return src;
  }
  destination = {};
}
