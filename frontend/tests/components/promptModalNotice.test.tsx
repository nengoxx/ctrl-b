import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// ISS-28 — the fullscreen editor's generic NOTICE slot: a caller's component rendered at the top of the
// text-mode body with the LIVE text. The modal knows nothing about what a notice says; this pins only
// the slot (renders with the current text, re-renders per keystroke, absent → nothing).

import { PromptModal } from "../../src/components/PromptModal";
import { requestPrompt, resolvePrompt } from "../../src/store/prompt";

function Echo({ text }: { text: string }) {
  return <div data-testid="notice">{`notice: ${text}`}</div>;
}

afterEach(() => {
  act(() => resolvePrompt(null));
  cleanup();
});

describe("PromptModal · the notice slot", () => {
  it("renders the caller's notice with the LIVE text, above the field", () => {
    render(<PromptModal />);
    act(() => void requestPrompt({ title: "Scenario", value: "fog", notice: Echo }));
    expect(screen.getByTestId("notice").textContent).toBe("notice: fog");
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "fog {{time}}" } });
    expect(screen.getByTestId("notice").textContent).toBe("notice: fog {{time}}");
    // at the top of the body — the notice precedes the field it describes
    expect(screen.getByTestId("notice").nextElementSibling).toBe(field);
  });

  it("no slot → nothing rendered, and the body keeps its plain shape", () => {
    render(<PromptModal />);
    act(() => void requestPrompt({ title: "Greeting", value: "hi" }));
    expect(screen.queryByTestId("notice")).toBeNull();
    expect(document.querySelector(".pm-body")?.className).toBe("pm-body");
  });
});
