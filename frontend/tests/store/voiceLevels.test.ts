import { beforeEach, describe, expect, it, vi } from "vitest";

import { getVoiceLevel, setVoiceLevel, voiceDeviceKey } from "../../src/store/voiceLevels";

// store/voiceLevels — the owner's learned voice level, per microphone (D76 §C.3 / Maya F8).
// Device-local by definition (never the synced UIState), keyed by the capture's effective device,
// and storage that fails reads as UNSEEDED rather than breaking a call.

const KEY = "ctrlb.voiceLevels";

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("voiceDeviceKey — the effective device (Maya F8)", () => {
  it("is the readback deviceId when it names a real device", () => {
    expect(voiceDeviceKey({ deviceId: "abc123", label: "USB mic" })).toBe("abc123");
  });

  it("falls to the track LABEL for the empty or `default` id — not an identity", () => {
    expect(voiceDeviceKey({ deviceId: "default", label: "Speakerphone" })).toBe("Speakerphone");
    expect(voiceDeviceKey({ deviceId: "", label: "Speakerphone" })).toBe("Speakerphone");
  });

  it("is null when the capture names nothing at all", () => {
    expect(voiceDeviceKey({ deviceId: "", label: "" })).toBeNull();
  });
});

describe("getVoiceLevel / setVoiceLevel", () => {
  it("round-trips a level per device, in one blob", () => {
    setVoiceLevel("Speakerphone", -22.5);
    setVoiceLevel("usb-1", -30);
    expect(getVoiceLevel("Speakerphone")).toBe(-22.5);
    expect(getVoiceLevel("usb-1")).toBe(-30);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      Speakerphone: -22.5,
      "usb-1": -30,
    });
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
