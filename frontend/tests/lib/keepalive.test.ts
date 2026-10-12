import { describe, expect, it } from "vitest";

import { createKeepalive, KEEPALIVE_GAIN } from "../../src/lib/keepalive";
import { FakeContext } from "./audioFakes";

// lib/keepalive — the D73 S6 ③ node pair, extracted for ISS-73 ① so the call's capture context and the
// mouth's reply hold run ONE mechanism. Its whole contract: an ON mints a constant source at an
// inaudible-but-NONZERO gain into the destination; a repeated ON is still one node; an OFF retires it
// (stop + unhook); a `ConstantSourceNode` cannot restart, so the next ON mints a fresh pair; `close()`
// retires a running node and refuses every later ON.

const ctxOf = (): FakeContext => new FakeContext();
const asCtx = (c: FakeContext): AudioContext => c as unknown as AudioContext;

describe("createKeepalive", () => {
  it("mints ONE constant source at the inaudible-but-nonzero gain, and nothing before an ON", () => {
    const c = ctxOf();
    const k = createKeepalive(asCtx(c));
    expect(c.sources).toHaveLength(0); // creating the switch renders nothing
    k.set(true);
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0].started).toBe(1);
    expect(c.gains.at(-1)?.gain.value).toBe(KEEPALIVE_GAIN);
    expect(KEEPALIVE_GAIN).toBeGreaterThan(0); // Blink asks `energy > 0` — nonzero is the requirement
    expect(KEEPALIVE_GAIN).toBeLessThan(0.01); // …and inaudible is the other half of it
  });

  it("is idempotent both ways — a page that says hidden twice still runs one node", () => {
    const c = ctxOf();
    const k = createKeepalive(asCtx(c));
    k.set(false); // OFF with nothing running is a no-op
    expect(c.sources).toHaveLength(0);
    k.set(true);
    k.set(true);
    expect(c.sources).toHaveLength(1);
    k.set(false);
    k.set(false);
    expect(c.sources[0].stopped).toBe(1);
  });

  it("an OFF retires the pair (stop + unhook), and the next ON mints a FRESH one", () => {
    const c = ctxOf();
    const k = createKeepalive(asCtx(c));
    k.set(true);
    k.set(false);
    expect(c.sources[0]).toMatchObject({ stopped: 1, disconnects: 1 });
    expect(c.gains[0].disconnects).toBe(1);
    k.set(true); // a stopped ConstantSourceNode cannot be restarted
    expect(c.sources).toHaveLength(2);
    expect(c.sources[1].started).toBe(1);
  });

  it("close() retires a running node and refuses every later ON", () => {
    const c = ctxOf();
    const k = createKeepalive(asCtx(c));
    k.set(true);
    k.close();
    expect(c.sources[0].stopped).toBe(1);
    k.set(true);
    expect(c.sources).toHaveLength(1);
    k.close(); // idempotent
    expect(c.sources[0].stopped).toBe(1);
  });

  it("close() with nothing running touches nothing", () => {
    const c = ctxOf();
    const k = createKeepalive(asCtx(c));
    k.close();
    k.set(true);
    expect(c.sources).toHaveLength(0);
  });
});
