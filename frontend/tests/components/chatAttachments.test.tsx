import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// THE BUBBLE BRANCH (D68 S3 / ATTACHMENTS_PLAN §7, the §0b-2 owner overrule) — what a user turn that
// carried files LOOKS like in the transcript.
//
// The rules pinned here:
//   · an IMAGE part paints the actual picture, from the serving route, lazily, and tapping it opens
//     the full-size view through the EXISTING overlay primitives (no second overlay machine);
//   · a text/PDF part is a quiet chip that links to the same route (which serves it as an inert
//     download — the server's half, pinned in `test_attachments_d68.py`);
//   · the URL is built from the MESSAGE's thread and the part's exact stored name, which are the two
//     facts the route matches a persisted part on;
//   · an attachment-only turn renders NO empty caption bubble (that message has no text part at all).

vi.mock("../../src/hooks/useActions", () => ({ useActionSpecs: () => ({ data: [] }) }));

import { ChatThread } from "../../src/components/ChatThread";
import type { AgentChat } from "../../src/hooks/useAgentChat";
import type { AttachmentPart, ChatMessage, Part } from "../../src/types";

beforeAll(() => {
  class ResizeObserverStub {
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(cleanup);

const image: AttachmentPart = {
  type: "attachment",
  kind: "image",
  name: "holiday snap.webp",
  mime: "image/webp",
  path: "t1/holiday snap.webp",
  bytes: 402_000,
  width: 2048,
  height: 1536,
};

const paper: AttachmentPart = {
  type: "attachment",
  kind: "pdf",
  name: "invoice.pdf",
  mime: "application/pdf",
  path: "t1/invoice.pdf",
  bytes: 88_000,
};

function userTurn(parts: Part[]): ChatMessage {
  return {
    id: "m1",
    thread_id: "t1",
    role: "user",
    parts,
    actor: "user",
    ts: "2026-09-01T10:00:00Z",
    tokens: null,
    compacted: false,
  };
}

function chatWith(parts: Part[]): AgentChat {
  return {
    messages: [userTurn(parts)],
    status: "idle",
    streamingId: null,
    resultByCall: {},
    currentPlan: null,
    resolvedDefault: undefined,
    ttsOn: false,
  };
}

describe("attachments in the transcript", () => {
  it("an image part PAINTS the picture, from the serving route", () => {
    render(<ChatThread active chat={chatWith([{ type: "text", text: "look" }, image])} />);
    const img = screen.getByAltText("holiday snap.webp");
    // The two facts the route matches on, both encoded — the stored name carries a space.
    expect(img.getAttribute("src")).toBe("/api/attachments/t1/holiday%20snap.webp");
    expect(img.getAttribute("loading")).toBe("lazy"); // a long thread can hold dozens
    expect(screen.getByText("look")).toBeTruthy(); // …and the caption is still the caption
  });

  it("tapping it opens the full-size view, and closing it returns", () => {
    render(<ChatThread active chat={chatWith([image])} />);
    fireEvent.click(screen.getByRole("button", { name: "view holiday snap.webp" }));
    const dialog = screen.getByRole("dialog", { name: "holiday snap.webp" });
    expect(dialog).toBeTruthy();
    // The house overlay shell, reused rather than reinvented (`.pm` + its `.pm-x` close).
    expect(dialog.className).toContain("pm");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes it too (the shared modal key handler)", () => {
    render(<ChatThread active chat={chatWith([image])} />);
    fireEvent.click(screen.getByRole("button", { name: "view holiday snap.webp" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a PDF part is a quiet chip linking to the same route", () => {
    render(<ChatThread active chat={chatWith([paper])} />);
    const link = screen.getByRole("link", { name: /invoice\.pdf/ });
    expect(link.getAttribute("href")).toBe("/api/attachments/t1/invoice.pdf");
    expect(link.textContent).toContain("PDF");
    expect(link.textContent).toContain("88 KB"); // the size, in the units a phone shows
    expect(screen.queryByRole("img")).toBeNull(); // never painted — it is not a picture
  });

  it("an attachment-only turn renders NO empty caption bubble", () => {
    const { container } = render(<ChatThread active chat={chatWith([image])} />);
    expect(container.querySelector(".b.user .body")).toBeNull();
    expect(container.querySelector(".chat-attach")).not.toBeNull();
  });

  it("a message with no attachment parts is untouched", () => {
    const { container } = render(
      <ChatThread active chat={chatWith([{ type: "text", text: "hi" }])} />,
    );
    expect(container.querySelector(".chat-attach")).toBeNull();
    expect(container.querySelector(".b.user .body")?.textContent).toBe("hi");
  });
});
