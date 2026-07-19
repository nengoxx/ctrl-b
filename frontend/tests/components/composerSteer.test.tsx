import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// HIGH-1 (D41) — the send-while-streaming UX, driven through the REAL Composer UI (not the store): while
// a turn streams, the send BUTTON stays Stop, but Enter STEERS (routes through useComposer.send →
// runComposer → the store's sendMessage). This locks in that the store guard-lift is actually reachable
// from the composer — the audit's HIGH-1 was that the guard was lifted in the store but the composer
// still gated Enter. We mock the store boundary (sendMessage/stopTurn spies + a streaming useChatSlice)
// and voice-status (so no QueryClient/mic machinery is needed), then drive the real component.

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

import { Composer } from "../../src/components/Composer";
import { sendMessage, stopTurn } from "../../src/store/chat";
import { clearDraft } from "../../src/store/composer";

afterEach(() => {
  cleanup();
  clearDraft();
  vi.clearAllMocks();
  h.status = "streaming";
});

describe("Composer send-while-streaming (HIGH-1, D41)", () => {
  it("Enter while streaming STEERS — it calls sendMessage (the store enqueues the 202)", () => {
    h.status = "streaming";
    render(<Composer />);
    const ta = screen.getByPlaceholderText("ask anything…");
    fireEvent.change(ta, { target: { value: "steer me" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    // The whole point of HIGH-1: a live turn must NOT swallow Enter — it steers.
    expect(sendMessage).toHaveBeenCalledWith("steer me", { raw: "steer me" });
    expect(stopTurn).not.toHaveBeenCalled();
  });

  it("the send button while streaming is STOP — clicking it calls stopTurn, never send", () => {
    h.status = "streaming";
    render(<Composer />);
    // Type something too, to prove the button doesn't send even with a non-empty draft.
    fireEvent.change(screen.getByPlaceholderText("ask anything…"), {
      target: { value: "steer me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "stop turn" }));
    expect(stopTurn).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("Enter while idle sends normally (baseline)", () => {
    h.status = "idle";
    render(<Composer />);
    const ta = screen.getByPlaceholderText("ask anything…");
    fireEvent.change(ta, { target: { value: "hello" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(sendMessage).toHaveBeenCalledWith("hello", { raw: "hello" });
  });
});
