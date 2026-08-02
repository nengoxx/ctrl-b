import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KitTtsFlash } from "../../src/theme-engine/kit/AppBar";

// The auto-TTS flash (vapor's `.tts-toast` rebuilt kit-wide, owner ruling 2026-08-02). What must
// hold: the pill NEVER flashes on first paint — including under StrictMode's dev double-effect,
// which is exactly where a mounted-flag skip regresses (refs survive the simulated remount) — it
// flashes the just-set state on any toggle of `ttsAuto` (the bar button and the Conf switch both
// drive that value), a rapid re-toggle restarts the 1.1 s window instead of being cut short by the
// first timer, and it auto-hides. Mounted unconditionally by DefaultRoot (Codex R1: the echo must
// survive the `off`/`minimal` appbar modes where KitAppBar doesn't render).

let ttsAuto = true;
vi.mock("../../src/hooks/useAppChrome", () => ({
  useAppChrome: () => ({ ttsAuto, ttsConfigured: true, toggleAutoTts: vi.fn() }),
}));

beforeEach(() => {
  ttsAuto = true;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const toast = (c: HTMLElement) => c.querySelector(".kit-tts-toast")!;

describe("kit auto-TTS flash", () => {
  it("stays hidden on first paint — no flash of the persisted state", () => {
    const { container } = render(<KitTtsFlash />);
    expect(toast(container).classList.contains("show")).toBe(false);
    // Stay-mounted for the fade transition, but purely visual: aria-hidden, never interactive.
    expect(toast(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("stays hidden on first paint under StrictMode's double-effect (the mounted-flag regression)", () => {
    const { container } = render(
      <StrictMode>
        <KitTtsFlash />
      </StrictMode>,
    );
    expect(toast(container).classList.contains("show")).toBe(false);
  });

  it("flashes 'muted' (.off) when the user toggles off, then auto-hides after 1.1 s", () => {
    const { container, rerender } = render(<KitTtsFlash />);
    ttsAuto = false;
    rerender(<KitTtsFlash />);
    expect(toast(container).classList.contains("show")).toBe(true);
    expect(toast(container).classList.contains("off")).toBe(true);
    expect(toast(container).textContent).toContain("muted");
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(toast(container).classList.contains("show")).toBe(false);
  });

  it("flashes 'on' (no .off) when toggled back on", () => {
    ttsAuto = false;
    const { container, rerender } = render(<KitTtsFlash />);
    ttsAuto = true;
    rerender(<KitTtsFlash />);
    expect(toast(container).classList.contains("show")).toBe(true);
    expect(toast(container).classList.contains("off")).toBe(false);
    expect(toast(container).textContent).toContain("on");
  });

  it("a rapid re-toggle restarts the window — the first timer cannot hide the second flash", () => {
    const { container, rerender } = render(<KitTtsFlash />);
    ttsAuto = false;
    rerender(<KitTtsFlash />);
    act(() => {
      vi.advanceTimersByTime(1000); // 100 ms before the first hide would fire
    });
    ttsAuto = true;
    rerender(<KitTtsFlash />);
    act(() => {
      vi.advanceTimersByTime(200); // past the first timer's would-be deadline
    });
    expect(toast(container).classList.contains("show")).toBe(true);
    expect(toast(container).textContent).toContain("on");
    act(() => {
      vi.advanceTimersByTime(900); // the second window completes
    });
    expect(toast(container).classList.contains("show")).toBe(false);
  });
});
