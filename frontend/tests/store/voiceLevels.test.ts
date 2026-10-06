import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  borrowVoiceLevel,
  getVoiceLevel,
  setVoiceLevel,
  voiceDeviceKey,
} from "../../src/store/voiceLevels";

// store/voiceLevels — the owner's learned voice level, per microphone × capture mode (D76 §C.3 / Maya
// F8 / S3b). Device-local by definition (never the synced UIState), keyed by the capture's effective
// device and the echo mode it was GRANTED, and storage that fails reads as UNSEEDED rather than
// breaking a call.

const KEY = "ctrlb.voiceLevels";

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("voiceDeviceKey — the effective device (Maya F8) × the granted mode (S3b)", () => {
  it("is the readback deviceId when it names a real device", () => {
    expect(voiceDeviceKey({ deviceId: "abc123", label: "USB mic", echoCancellation: "all" })).toBe(
      "abc123|ec=all",
    );
  });

  it("falls to the track LABEL for the empty or `default` id — not an identity — mode kept", () => {
    expect(
      voiceDeviceKey({ deviceId: "default", label: "Speakerphone", echoCancellation: "all" }),
    ).toBe("Speakerphone|ec=all");
    expect(voiceDeviceKey({ deviceId: "", label: "Speakerphone", echoCancellation: true })).toBe(
      "Speakerphone|ec=on",
    );
  });

  it("normalizes the GRANT: `all` → all, `true` → on, anything else → off", () => {
    const key = (echoCancellation?: string | boolean) =>
      voiceDeviceKey({ deviceId: "mic-1", label: "Mic", echoCancellation });
    expect(key("all")).toBe("mic-1|ec=all");
    expect(key(true)).toBe("mic-1|ec=on");
    expect(key(false)).toBe("mic-1|ec=off");
    expect(key(undefined)).toBe("mic-1|ec=off"); // the browser reported nothing
    expect(key("remote-only")).toBe("mic-1|ec=off"); // a mode string we do not know
  });

  it("is null when the capture names no device, whatever the mode", () => {
    for (const echoCancellation of ["all", true, false, undefined]) {
      expect(voiceDeviceKey({ deviceId: "", label: "", echoCancellation })).toBeNull();
      expect(voiceDeviceKey({ deviceId: "default", label: "", echoCancellation })).toBeNull();
    }
  });
});

describe("getVoiceLevel / setVoiceLevel", () => {
  it("round-trips a level per device, in one blob", () => {
    setVoiceLevel("Speakerphone|ec=all", -22.5);
    setVoiceLevel("usb-1|ec=off", -30);
    expect(getVoiceLevel("Speakerphone|ec=all")).toBe(-22.5);
    expect(getVoiceLevel("usb-1|ec=off")).toBe(-30);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      "Speakerphone|ec=all": -22.5,
      "usb-1|ec=off": -30,
    });
  });

  it("a MODE FLIP on the same device reads unseeded — the Call capture never inherits Media's level", () => {
    const media = voiceDeviceKey({ deviceId: "", label: "Speakerphone", echoCancellation: "all" });
    const call = voiceDeviceKey({ deviceId: "", label: "Speakerphone", echoCancellation: true });
    setVoiceLevel(media!, -12);
    expect(getVoiceLevel(media!)).toBe(-12);
    expect(getVoiceLevel(call!)).toBeNull();
  });

  it("a write PURGES legacy flat keys (no mode suffix) and keeps every keyed entry", () => {
    localStorage.setItem(KEY, JSON.stringify({ Speakerphone: -10, "usb-1|ec=on": -25 }));
    setVoiceLevel("Speakerphone|ec=all", -18);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      "usb-1|ec=on": -25,
      "Speakerphone|ec=all": -18,
    });
    expect(getVoiceLevel("Speakerphone")).toBeNull();
  });

  it("an unknown device is unseeded", () => {
    expect(getVoiceLevel("never-seen")).toBeNull();
  });

  it("garbage in the blob reads as unseeded, never as a number", () => {
    localStorage.setItem(KEY, JSON.stringify({ a: "loud", b: null, c: [1] }));
    for (const k of ["a", "b", "c"]) expect(getVoiceLevel(k)).toBeNull();
    localStorage.setItem(KEY, "not json");
    expect(getVoiceLevel("a")).toBeNull();
  });

  it("refuses to store a non-finite level", () => {
    setVoiceLevel("x", Number.NaN);
    setVoiceLevel("y", -Infinity);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("storage that THROWS (private mode, blocked data) reads unseeded and drops the write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(getVoiceLevel("Speakerphone")).toBeNull();
    expect(() => setVoiceLevel("Speakerphone", -20)).not.toThrow();
  });
});

describe("setVoiceLevel keeps the blob in WRITE order (D8 — the `last` tier's recency)", () => {
  const order = () => Object.keys(JSON.parse(localStorage.getItem(KEY) ?? "{}") as object);

  it("a REWRITE moves the key to the end — no timestamp, the same shape", () => {
    setVoiceLevel("A|ec=all", -10);
    setVoiceLevel("B|ec=on", -20);
    setVoiceLevel("A|ec=all", -15);
    expect(order()).toEqual(["B|ec=on", "A|ec=all"]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      "B|ec=on": -20,
      "A|ec=all": -15,
    });
  });

  it("the legacy purge still holds when the written key was already there", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ "usb-1|ec=on": -25, Speakerphone: -10, "Speakerphone|ec=all": -18 }),
    );
    setVoiceLevel("usb-1|ec=on", -20);
    expect(order()).toEqual(["Speakerphone|ec=all", "usb-1|ec=on"]);
    expect(getVoiceLevel("usb-1|ec=on")).toBe(-20);
  });
});

describe("borrowVoiceLevel — another key's level for a key with none (D8)", () => {
  const seed = (blob: Record<string, unknown>) => localStorage.setItem(KEY, JSON.stringify(blob));

  it("tier `mode`: the same device under its other echo mode", () => {
    seed({ "Speakerphone|ec=all": -10 });
    expect(borrowVoiceLevel("Speakerphone|ec=on")).toEqual({ dbfs: -10, from: "mode" });
  });

  it("…the LOWER of two other modes (the more permissive floor), ahead of a later-written key", () => {
    seed({ "mic|ec=all": -12, "mic|ec=on": -25, "other|ec=off": -5 });
    expect(borrowVoiceLevel("mic|ec=off")).toEqual({ dbfs: -25, from: "mode" });
  });

  it("tier `last`: the last-WRITTEN other key, following a rewrite", () => {
    setVoiceLevel("A|ec=all", -10);
    setVoiceLevel("B|ec=on", -20);
    expect(borrowVoiceLevel("C|ec=all")).toEqual({ dbfs: -20, from: "last" });
    setVoiceLevel("A|ec=all", -15);
    expect(borrowVoiceLevel("C|ec=all")).toEqual({ dbfs: -15, from: "last" });
  });

  it("an UNNAMED device (null key) borrows tier `last` only", () => {
    seed({ "A|ec=all": -10, "B|ec=on": -20 });
    expect(borrowVoiceLevel(null)).toEqual({ dbfs: -20, from: "last" });
  });

  it("NEVER returns the exact key's own entry — that is `getVoiceLevel`'s", () => {
    seed({ "X|ec=all": -10 });
    expect(borrowVoiceLevel("X|ec=all")).toBeNull();
    seed({ "A|ec=all": -10, "X|ec=all": -30 }); // X is the last written, and is skipped
    expect(borrowVoiceLevel("X|ec=all")).toEqual({ dbfs: -10, from: "last" });
  });

  it("never borrows a LEGACY flat key (unreadable by design since S3b)", () => {
    seed({ Speakerphone: -10 });
    expect(borrowVoiceLevel("Speakerphone|ec=on")).toBeNull();
    expect(borrowVoiceLevel(null)).toBeNull();
  });

  it("empty or missing storage ⇒ null", () => {
    expect(borrowVoiceLevel("A|ec=all")).toBeNull();
    seed({});
    expect(borrowVoiceLevel(null)).toBeNull();
  });

  it("GARBAGE is skipped entry by entry, and a garbage blob is null", () => {
    seed({ "A|ec=all": -10, "B|ec=all": "loud", "A|ec=on": null, "C|ec=off": [1] });
    expect(borrowVoiceLevel("A|ec=off")).toEqual({ dbfs: -10, from: "mode" });
    expect(borrowVoiceLevel("D|ec=all")).toEqual({ dbfs: -10, from: "last" });
    localStorage.setItem(KEY, "not json");
    expect(borrowVoiceLevel(null)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify([-10]));
    expect(borrowVoiceLevel(null)).toBeNull();
  });

  it("storage that THROWS ⇒ null, never a throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    });
    expect(borrowVoiceLevel("A|ec=all")).toBeNull();
    expect(borrowVoiceLevel(null)).toBeNull();
  });
});
