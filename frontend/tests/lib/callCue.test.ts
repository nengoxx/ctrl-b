import { describe, expect, it } from "vitest";

import { CUE_GAIN, CUE_HZ, CUE_MS, CUE_RAMP_MS, playDropCue } from "../../src/lib/callCue";

// lib/callCue — the call's drop cue (D76 §C.5): one short sine through a ramped gain on the CAPTURE's
// own context. What is pinned is the shape the owner hears (pitch, level, length, no click) and that
// the pair retires itself.

class FakeParam {
  value = 0;
  calls: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["ramp", v, t]);
  }
}

function fakeContext(state = "running") {
  const made = {
    osc: null as null | {
      type: string;
      frequency: FakeParam;
      starts: number[];
      stops: number[];
      connectedTo: unknown;
      disconnected: boolean;
      onended: (() => void) | null;
    },
    gain: null as null | { gain: FakeParam; connectedTo: unknown; disconnected: boolean },
  };
  const destination = { tag: "destination" };
  const ctx = {
    state,
    currentTime: 3,
    destination,
    createOscillator() {
      const osc = {
        type: "",
        frequency: new FakeParam(),
        starts: [] as number[],
        stops: [] as number[],
        connectedTo: null as unknown,
        disconnected: false,
        onended: null as (() => void) | null,
        connect(n: unknown) {
          osc.connectedTo = n;
        },
        disconnect() {
          osc.disconnected = true;
        },
        start(t: number) {
          osc.starts.push(t);
        },
        stop(t: number) {
          osc.stops.push(t);
        },
      };
      made.osc = osc;
      return osc;
    },
    createGain() {
      const gain = {
        gain: new FakeParam(),
        connectedTo: null as unknown,
        disconnected: false,
        connect(n: unknown) {
          gain.connectedTo = n;
        },
        disconnect() {
          gain.disconnected = true;
        },
      };
      made.gain = gain;
      return gain;
    },
  };
  return { ctx: ctx as unknown as AudioContext, made, destination };
}

describe("playDropCue (D76 §C.5)", () => {
  it("plays one ramped sine of the named pitch, level and length into the destination", () => {
    const { ctx, made, destination } = fakeContext();
    playDropCue(ctx);
    const end = 3 + CUE_MS / 1000;
    const ramp = CUE_RAMP_MS / 1000;
    expect(made.osc?.type).toBe("sine");
    expect(made.osc?.frequency.value).toBe(CUE_HZ);
    expect(made.osc?.connectedTo).toBe(made.gain);
    expect(made.gain?.connectedTo).toBe(destination);
    // Attack and release ramps: a sine switched at full gain clicks.
    expect(made.gain?.gain.calls).toEqual([
      ["set", 0, 3],
      ["ramp", CUE_GAIN, 3 + ramp],
      ["set", CUE_GAIN, end - ramp],
      ["ramp", 0, end],
    ]);
    expect(made.osc?.starts).toEqual([3]);
    expect(made.osc?.stops).toEqual([end]);
  });

  it("retires its two nodes when the tone ends", () => {
    const { ctx, made } = fakeContext();
    playDropCue(ctx);
    made.osc?.onended?.();
    expect(made.osc?.disconnected).toBe(true);
    expect(made.gain?.disconnected).toBe(true);
  });

  it("plays NOTHING on a context that is not running (a teardown race, a suspended page)", () => {
    for (const state of ["closed", "suspended"]) {
      const { ctx, made } = fakeContext(state);
      playDropCue(ctx);
      expect(made.osc).toBeNull();
    }
  });
});
