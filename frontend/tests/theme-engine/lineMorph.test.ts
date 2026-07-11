import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearDraft, setDraft } from "../../src/store/composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";

// Phase E — the mic↔send MORPH (the one genuinely new pattern in the line variant; audit #3 coverage-gap
// fix). Lives in its OWN file because the mock below flips `sttReady` to TRUE, and composerSurface.test.ts's
// shared harness deliberately relies on sttReady=false (no voice data) for its always-send assertions.
//
// Only the voice-status probe is mocked — `useComposer`'s draft/send/mic wiring stays real, so the morph
// predicate `sttReady && (draft === "" || recording)` is exercised against the real draft store.
vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({ data: { stt: true, tts: false } }),
}));

function renderLine() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(LineComposer)));
}

afterEach(() => {
  cleanup();
  clearDraft(); // the draft store is module-level + persisted — never leak state between tests
});

describe("LineComposer trailing controls (sttReady=true — revised morph, owner 2026-07-11)", () => {
  it("EMPTY draft → the mic alone (the compact resting look; #cmd-send absent)", () => {
    clearDraft();
    const { container } = renderLine();
    expect(container.querySelector(".kit-cbtn.mic.line-btn")).not.toBeNull();
    expect(container.querySelector("#cmd-send")).toBeNull();
  });

  it("NON-EMPTY draft → SEND JOINS and the mic STAYS (left of send in the DOM)", () => {
    clearDraft();
    const { container } = renderLine();
    act(() => setDraft("hello"));
    const mic = container.querySelector(".kit-cbtn.mic.line-btn");
    const send = container.querySelector("#cmd-send");
    expect(mic).not.toBeNull();
    expect(send).not.toBeNull();
    // the mic sits to the LEFT of send (document order inside the row)
    expect(mic!.compareDocumentPosition(send!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("emptying the draft retires send; the mic remains", () => {
    setDraft("hello");
    const { container } = renderLine();
    expect(container.querySelector("#cmd-send")).not.toBeNull();
    act(() => clearDraft());
    expect(container.querySelector(".kit-cbtn.mic.line-btn")).not.toBeNull();
    expect(container.querySelector("#cmd-send")).toBeNull();
  });
});
