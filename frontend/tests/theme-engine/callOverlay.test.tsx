import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const call: {
    phase: string;
    heard: string;
    note: string | null;
    userSpeechActive: boolean;
    hangUp: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
  } = {
    phase: "listening",
    heard: "",
    note: null,
    userSpeechActive: false,
    hangUp: vi.fn(),
    interrupt: vi.fn(),
  };
  return { call };
});

vi.mock("../../src/hooks/useLiveCall", () => ({ useLiveCall: () => h.call }));
vi.mock("../../src/hooks/useActiveBackdrop", () => ({ useActiveBackdrop: () => undefined }));

import { CallOverlay } from "../../src/theme-engine/kit/CallOverlay";

// kit/CallOverlay — the call screen's MODAL CONTRACT (D71 §6). `aria-modal="true"` is a promise about
// focus, and the arms below are that promise: focus moves in on mount, Tab cannot leave, Escape is the
// hang-up (there is nothing here to dismiss without ending the call), and the element the overlay took
// focus from gets it back. The machine itself is mocked — its rules live in `useLiveCall.test.ts`.

/** The app underneath: something focusable for the overlay to take focus FROM and give it back TO. */
function Host({ open }: { open: boolean }) {
  return (
    <div>
      <textarea aria-label="composer" />
      {open && <CallOverlay />}
    </div>
  );
}

beforeEach(() => {
  cleanup(); // `globals: false` ⇒ RTL's auto-cleanup is not registered (the house pattern)
  h.call = { ...h.call, phase: "listening", heard: "", note: null, userSpeechActive: false };
});

describe("CallOverlay — the focus contract", () => {
  it("takes focus to hang up on mount, and hands it back on unmount", () => {
    const view = render(<Host open={false} />);
    const composer = screen.getByLabelText("composer");
    composer.focus();
    expect(document.activeElement).toBe(composer);

    view.rerender(<Host open={true} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Hang up" }));

    view.rerender(<Host open={false} />);
    expect(document.activeElement).toBe(composer);
  });

  it("Tab cycles INSIDE the overlay — it never walks the app the dialog has hidden", () => {
    render(<Host open={true} />);
    const hangUp = screen.getByRole("button", { name: "Hang up" });
    // The browser's own Tab is what would leave the dialog, so the proof is that it is TAKEN OVER:
    // the default is prevented and the cycle lands back on the panel's own focusable set.
    for (const shiftKey of [false, true]) {
      const ev = createEvent.keyDown(hangUp, { key: "Tab", shiftKey });
      fireEvent(hangUp, ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(hangUp);
    }
  });

  it("Escape HANGS UP — deliberately, since closing this panel and ending the call are one thing", () => {
    render(<Host open={true} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Hang up" }), { key: "Escape" });
    expect(h.call.hangUp).toHaveBeenCalledTimes(1);
  });

  it("leaves the tap-to-interrupt surface alone (§4.3 trigger B)", () => {
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(h.call.interrupt).toHaveBeenCalledTimes(1);
    // …and the control cluster still is not one: hanging up must never also be an interrupt.
    h.call.interrupt.mockClear();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Hang up" }));
    expect(h.call.interrupt).not.toHaveBeenCalled();
  });
});
