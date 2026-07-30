import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRESET,
  fromTimeValue,
  presetOf,
  presetToCron,
  toTimeValue,
} from "../../src/lib/cronPreset";

// A3 slice 3 — the editor's presets are a VIEW of the one stored 5-field cron, never a second stored
// representation. Two properties carry that: a preset builds exactly one cron, and a cron only reads
// back as a preset when it really is one — so a hand-written expression is left alone (and the editor
// shows its not-representable warning) instead of being silently rewritten.

describe("presetToCron", () => {
  it("builds the three shapes", () => {
    expect(presetToCron({ kind: "hourly", minute: 15, hour: 9, dow: 1 }, "")).toBe("15 * * * *");
    expect(presetToCron({ kind: "daily", minute: 5, hour: 3, dow: 1 }, "")).toBe("5 3 * * *");
    expect(presetToCron({ kind: "weekly", minute: 30, hour: 18, dow: 5 }, "")).toBe("30 18 * * 5");
  });

  it("clamps out-of-range fields instead of emitting an invalid cron", () => {
    expect(presetToCron({ kind: "daily", minute: 99, hour: -4, dow: 9 }, "")).toBe("59 0 * * *");
  });

  it("passes the raw expression straight through in custom mode", () => {
    expect(presetToCron({ ...DEFAULT_PRESET, kind: "custom" }, "0 3 * * 1-5")).toBe("0 3 * * 1-5");
  });
});

describe("presetOf", () => {
  it("round-trips each preset shape", () => {
    expect(presetOf("15 * * * *")).toMatchObject({ kind: "hourly", minute: 15 });
    expect(presetOf("5 3 * * *")).toMatchObject({ kind: "daily", minute: 5, hour: 3 });
    expect(presetOf("30 18 * * 5")).toMatchObject({ kind: "weekly", minute: 30, hour: 18, dow: 5 });
    expect(presetOf(" 0   9  *  *  * ")).toMatchObject({ kind: "daily", hour: 9 }); // whitespace-tolerant
  });

  it("refuses everything a preset cannot actually express", () => {
    for (const cron of [
      "0 3 * * 1-5", // a weekday RANGE
      "*/15 * * * *", // a step
      "0 3,15 * * *", // a list
      "0 3 1 * *", // a day-of-month filter
      "0 3 * 6 *", // a month filter
      "* * * * *", // an every-minute schedule (the minute field is not a single value)
      "0 3 * *", // four fields
      "0 3 * * * *", // the six-field seconds form the backend refuses outright
      "",
    ]) {
      expect(presetOf(cron), cron).toBeNull();
    }
  });
});

describe("time-field helpers", () => {
  it("formats and parses HH:MM, and keeps the current value on junk", () => {
    const v = { kind: "daily" as const, minute: 5, hour: 3, dow: 1 };
    expect(toTimeValue(v)).toBe("03:05");
    expect(fromTimeValue("18:30", v)).toMatchObject({ hour: 18, minute: 30 });
    expect(fromTimeValue("", v)).toBe(v);
    expect(fromTimeValue("nope", v)).toBe(v);
  });
});
