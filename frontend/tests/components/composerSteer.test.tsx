import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// HIGH-1 (D41) — the send-while-streaming UX, driven through the REAL composer UI (not the store): while
// a turn streams, the send BUTTON stays Stop, but Enter STEERS (routes through useComposer.send →
// runComposer → the store's sendMessage). This locks in that the store guard-lift is actually reachable
// from the composer — the audit's HIGH-1 was that the guard was lifted in the store but the composer
// still gated Enter. We mock the store boundary (sendMessage/stopTurn spies + a streaming useChatSlice)
// and voice-status (so no QueryClient/mic machinery is needed), then drive the real component.
//
// D51 V4 — RETARGETED from the bespoke `components/Composer` to **SheetComposer**. The bespoke one was
// vapor's, and vapor was the only theme that rendered it; since the DefaultRoot pivot vapor resolves the
// kit `sheet` variant like every other theme, so the bespoke component is DEAD (deleted in the Phase-2
// commit) and this pin was no longer covering a production path. SheetComposer carries both behaviours
// through the SHARED seams — `useComposer().send` (no streaming gate) reached via `useComposerChrome`'s
// Enter handler through the autocomplete wrapper's fall-through, and `isStreaming ? stopTurn : send` on
// the button — so nothing here is variant-specific except the two labels noted below.
// (KitComposer/LineComposer wire the identical seams; the coverage stays on the variant vapor ships.)

const h = vi.hoisted((): { status: "idle" | "streaming" } => ({ status: "streaming" }));

vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({ data: { stt: false }, dataUpdatedAt: 0 }),
}));

vi.mock("../../src/store/chat", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/chat")>();
  return {
    ...actual,
    // Spy the two the composer wires (send routes here through runComposer; the button uses stopTurn).
    sendMessage: vi.fn(),
    stopTurn: vi.fn(),
    // Force the composer's streaming gate: `isStreaming` = status === "streaming".
    useChatSlice: (sel: (s: { status: string }) => unknown) => sel({ status: h.status }),
  };
});

import { sendMessage, stopTurn } from "../../src/store/chat";
import { clearDraft } from "../../src/store/composer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";

// The textarea is `#cmd-input` in EVERY variant (the stable id DefaultRoot/e2e also key off); the
// placeholder is variant copy ("Message" here vs the bespoke bar's "ask anything…"), so the role query
// keeps this pin independent of copy edits.
const field = () => screen.getByRole("textbox");

afterEach(() => {
  cleanup();
  clearDraft();
  vi.clearAllMocks();
  h.status = "streaming";
});

describe("composer send-while-streaming (HIGH-1, D41)", () => {
  it("Enter while streaming STEERS — it calls sendMessage (the store enqueues the 202)", () => {
    h.status = "streaming";
    render(<SheetComposer />);
    fireEvent.change(field(), { target: { value: "steer me" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    // The whole point of HIGH-1: a live turn must NOT swallow Enter — it steers.
    expect(sendMessage).toHaveBeenCalledWith("steer me", { raw: "steer me" });
    expect(stopTurn).not.toHaveBeenCalled();
  });

  it("the send button while streaming is STOP — clicking it calls stopTurn, never send", () => {
    h.status = "streaming";
    render(<SheetComposer />);
    // Type something too, to prove the button doesn't send even with a non-empty draft.
    fireEvent.change(field(), { target: { value: "steer me" } });
    // The kit's label is "stop the running turn" (the bespoke bar's was "stop turn") — same control.
    fireEvent.click(screen.getByRole("button", { name: "stop the running turn" }));
    expect(stopTurn).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("Enter while idle sends normally (baseline)", () => {
    h.status = "idle";
    render(<SheetComposer />);
    fireEvent.change(field(), { target: { value: "hello" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(sendMessage).toHaveBeenCalledWith("hello", { raw: "hello" });
  });
});
