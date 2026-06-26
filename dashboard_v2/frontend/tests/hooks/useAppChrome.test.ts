import { beforeEach, describe, expect, it, vi } from "vitest";

// hooks/useAppChrome — the app-chrome voice controller (D29 §14.2). We test the real logic in it:
// `toggleAutoTts` flips the UI store's `ttsAuto` AND stops any playing clip when muting (the behavior
// that used to live in the AppBar's effect). audioController is mocked so we assert the stop call.

vi.mock("../../src/lib/audioController", () => ({
  dismiss: vi.fn(),
  togglePlay: vi.fn(),
  seekFraction: vi.fn(),
  usePlayback: vi.fn(),
}));

import { toggleAutoTts } from "../../src/hooks/useAppChrome";
import { dismiss } from "../../src/lib/audioController";
import { getUI, setUI } from "../../src/store/ui";

beforeEach(() => {
  setUI({ ttsAuto: true }); // module state persists between cases
  vi.clearAllMocks();
});

describe("useAppChrome — toggleAutoTts", () => {
  it("flips ttsAuto, and silences playback ONLY when muting", () => {
    toggleAutoTts(); // true → false (mute)
    expect(getUI().ttsAuto).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(1);

    toggleAutoTts(); // false → true (enable)
    expect(getUI().ttsAuto).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(1); // not called again — enabling doesn't stop anything
  });
});
