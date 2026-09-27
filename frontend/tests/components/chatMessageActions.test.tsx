import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// D81 — the owner's message actions in the TRANSCRIPT (`ChatThread` + `chatAttribution.BotWhoLine`):
// where each control shows, what it calls, and — as important — where it never shows (a streaming
// turn, a client-only row). The store's four actions are spied (their wire behaviour is pinned in
// tests/store/chatMessageActions.test.ts); everything else in `store/chat` stays real.

const h = vi.hoisted(() => ({
  regenerate: vi.fn(),
  selectAlternate: vi.fn(),
  editMessage: vi.fn(async (_id: string, _text: string) => true), // saved, unless a case says not
  deleteMessage: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../src/store/toast", async (orig) => ({
  ...(await orig<typeof import("../../src/store/toast")>()),
  pushToast: h.toast,
}));
vi.mock("../../src/store/chat", async (orig) => ({
  ...(await orig<typeof import("../../src/store/chat")>()),
  regenerate: h.regenerate,
  selectAlternate: h.selectAlternate,
  editMessage: h.editMessage,
  deleteMessage: h.deleteMessage,
}));
vi.mock("../../src/hooks/useActions", () => ({
  useActionSpecs: () => ({ data: [{ name: "ping_host", retry_safe: true }] }),
}));
vi.mock("../../src/hooks/useAgentArt", () => ({
  useAgentArt: () => (name: string | null) => ({
    name: name ?? "default",
    title: name ?? "default",
  }),
}));

import { ChatThread } from "../../src/components/ChatThread";
import { PromptModal } from "../../src/components/PromptModal";
import type { AgentChat } from "../../src/hooks/useAgentChat";
import { resolvePrompt } from "../../src/store/prompt";
import type { ChatMessage } from "../../src/types";

beforeAll(() => {
  class ResizeObserverStub {
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
  act(() => resolvePrompt(null));
  for (const f of Object.values(h)) f.mockClear();
});

const msg = (over: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage => ({
  thread_id: "t1",
  parts: [{ type: "text", text: over.role === "user" ? "hello" : "pong" }],
  actor: over.role === "user" ? "user" : "agent",
  ts: "2026-09-27T10:00:00.000Z",
  tokens: null,
  compacted: false,
  ...over,
});

function chat(messages: ChatMessage[], over: Partial<AgentChat> = {}): AgentChat {
  return {
    messages,
    status: "idle",
    streamingId: null,
    resultByCall: {},
    currentPlan: null,
    resolvedDefault: undefined,
    ttsOn: false,
    ...over,
  };
}

const HOST = msg({ id: "a1", role: "assistant", reply: { ids: ["a1"], n: 1, count: 1 } });
const openDisclosure = (c: HTMLElement) =>
  act(() => (c.querySelector(".b.bot .who .who-id") as HTMLElement).click());
const actLabels = (c: HTMLElement) =>
  [...c.querySelectorAll(".who-acts .who-act")].map((b) => b.textContent);

describe("D81 · the assistant who-line actions", () => {
  it("a durable reply with NO metrics still opens — the actions alone make it tappable", () => {
    const { container } = render(
      <ChatThread active chat={chat([msg({ id: "a0", role: "assistant" })])} />,
    );
    // the AT toggle exists, and says it reveals the actions too
    expect(container.querySelector(".b.bot .who .who-sr")?.textContent).toBe(
      "message details and actions",
    );
    openDisclosure(container);
    expect(container.querySelector(".who-meta")).toBeNull(); // no metrics to show…
    expect(actLabels(container)).toEqual(["edit", "delete"]); // …but the actions (no retry: not the tail host)
  });

  it("the tail host offers retry, and retry calls regenerate with the catalog's retry-safe lookup", () => {
    const { container } = render(<ChatThread active chat={chat([HOST])} />);
    openDisclosure(container);
    expect(actLabels(container)).toEqual(["retry", "edit", "delete"]);
    fireEvent.click(screen.getByRole("button", { name: "retry this reply" }));
    expect(h.regenerate).toHaveBeenCalledWith("a1", expect.any(Function));
    const safe = h.regenerate.mock.calls[0][1] as (t: string) => boolean;
    expect(safe("ping_host")).toBe(true);
    expect(safe("reboot_host")).toBe(false); // unknown to the catalog → unsafe
  });

  it("edit is not offered on a folded row or a row with no text; delete always is", () => {
    const folded = msg({ id: "a0", role: "assistant", compacted: true });
    const { container } = render(<ChatThread active chat={chat([folded])} />);
    openDisclosure(container);
    expect(actLabels(container)).toEqual(["delete"]);
    fireEvent.click(screen.getByRole("button", { name: "delete this reply" }));
    expect(h.deleteMessage).toHaveBeenCalledWith("a0");
  });

  it("says an edited reply was edited, under the metrics that describe the original", () => {
    const { container } = render(
      <ChatThread
        active
        chat={chat([msg({ id: "a0", role: "assistant", edited: "2026-09-27T11:00:00Z" })])}
      />,
    );
    openDisclosure(container);
    expect(container.querySelector(".who-meta")?.textContent).toContain("edited by you");
  });

  it("NOTHING while a turn streams, and nothing on a client-only row", () => {
    const streaming = render(
      <ChatThread
        active
        chat={chat([HOST, msg({ id: "x", role: "assistant" })], {
          status: "streaming",
          streamingId: "x",
        })}
      />,
    );
    expect(streaming.container.querySelector(".b.bot .who .who-sr")).toBeNull();
    expect(streaming.container.querySelector(".who-alt")).toBeNull();
    cleanup();
    const local = render(<ChatThread active chat={chat([{ ...HOST, local: true }])} />);
    expect(local.container.querySelector(".b.bot .who .who-sr")).toBeNull();
  });
});

describe("D81 · the variant counter ‹ n/N ›", () => {
  it("names the version for a screen reader", () => {
    const two = { ...HOST, reply: { ids: ["a1"], n: 2, count: 3 } };
    render(<ChatThread active chat={chat([two])} />);
    expect(screen.getByRole("img", { name: "version 2 of 3" }).textContent).toBe("2/3");
  });

  it("while an UNSENT message follows the reply: no retry, and `›` past the end is disabled", () => {
    const last = { ...HOST, reply: { ids: ["a1"], n: 2, count: 2 } };
    const unsent = msg({ id: "local-1", role: "user", local: true });
    const { container } = render(<ChatThread active chat={chat([last, unsent])} />);
    const next = screen.getByRole("button", { name: "write a new version of this reply" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    openDisclosure(container);
    expect(actLabels(container)).toEqual(["edit", "delete"]);
    // A LANDED bubble (the server took it) or a queued steer does not lock anything.
    cleanup();
    render(<ChatThread active chat={chat([last, { ...unsent, landed: true }])} />);
    const free = screen.getByRole("button", { name: "write a new version of this reply" });
    expect((free as HTMLButtonElement).disabled).toBe(false);
  });

  it("is absent until alternates exist", () => {
    const { container } = render(<ChatThread active chat={chat([HOST])} />);
    expect(container.querySelector(".who-alt")).toBeNull();
  });

  it("at 2/2: ‹ swaps to 1, › writes a NEW version (ST's swipe past the end)", () => {
    const two = { ...HOST, reply: { ids: ["a1"], n: 2, count: 2 } };
    const { container } = render(<ChatThread active chat={chat([two])} />);
    expect(container.querySelector(".who-alt-n")?.textContent).toBe("2/2");
    fireEvent.click(screen.getByRole("button", { name: "previous version of this reply" }));
    expect(h.selectAlternate).toHaveBeenCalledWith("a1", 1);
    fireEvent.click(screen.getByRole("button", { name: "write a new version of this reply" }));
    expect(h.regenerate).toHaveBeenCalledWith("a1", expect.any(Function));
    // The chevrons are siblings of the identity run (D25 breakout) — a tap never opens the disclosure.
    expect(container.querySelector(".who-acts")).toBeNull();
  });

  it("at 1/3: ‹ is disabled and › steps forward", () => {
    const first = { ...HOST, reply: { ids: ["a1"], n: 1, count: 3 } };
    render(<ChatThread active chat={chat([first])} />);
    const prev = screen.getByRole("button", { name: "previous version of this reply" });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "next version of this reply" }));
    expect(h.selectAlternate).toHaveBeenCalledWith("a1", 2);
  });
});

describe("D81 · the F20 error pill", () => {
  it("retries through regenerate on the error's own row", () => {
    const failed = msg({
      id: "a9",
      role: "assistant",
      parts: [{ type: "error", message: "upstream 502", retryable: true }],
    });
    render(<ChatThread active chat={chat([failed], { status: "error" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry the last message" }));
    expect(h.regenerate).toHaveBeenCalledWith("a9", expect.any(Function));
  });
});

describe("D81 · the user's pencil (edit, with delete inside)", () => {
  it("opens the house editor on the message's text; Save sends only a CHANGED text", async () => {
    const { container } = render(
      <>
        <ChatThread active chat={chat([msg({ id: "u1", role: "user" })])} />
        <PromptModal />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit your message" }));
    const field = container.querySelector(".pm-text") as HTMLTextAreaElement;
    expect(field.value).toBe("hello");
    fireEvent.click(screen.getByRole("button", { name: "Save" })); // unchanged → nothing sent
    await act(async () => {});
    expect(h.editMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "edit your message" }));
    fireEvent.change(container.querySelector(".pm-text") as HTMLTextAreaElement, {
      target: { value: "hello there" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {});
    expect(h.editMessage).toHaveBeenCalledWith("u1", "hello there");
  });

  it("a save the server did NOT take re-opens the editor on the typed text, with a toast", async () => {
    h.editMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { container } = render(
      <>
        <ChatThread active chat={chat([msg({ id: "u1", role: "user" })])} />
        <PromptModal />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit your message" }));
    fireEvent.change(container.querySelector(".pm-text") as HTMLTextAreaElement, {
      target: { value: "typed words" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {});
    expect(h.editMessage).toHaveBeenCalledWith("u1", "typed words");
    expect((container.querySelector(".pm-text") as HTMLTextAreaElement).value).toBe("typed words");
    expect(h.toast).toHaveBeenCalledWith(
      "The edit wasn't saved — your text is back in the editor",
      "err",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {});
    expect(container.querySelector(".pm")).toBeNull(); // the second save took it
  });

  it("the editor's Delete message closes it and hands over to the store's delete (its confirm)", async () => {
    const { container } = render(
      <>
        <ChatThread active chat={chat([msg({ id: "u1", role: "user" })])} />
        <PromptModal />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit your message" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete message" }));
    await act(async () => {});
    expect(container.querySelector(".pm")).toBeNull();
    expect(h.deleteMessage).toHaveBeenCalledWith("u1");
    expect(h.editMessage).not.toHaveBeenCalled();
  });

  it("an edited message says so; a client-only or queued bubble has no pencil", () => {
    const { container } = render(
      <ChatThread
        active
        chat={chat([
          msg({ id: "u1", role: "user", edited: "2026-09-27T11:00:00Z" }),
          msg({ id: "local-1", role: "user", local: true }),
        ])}
      />,
    );
    const whos = [...container.querySelectorAll(".b.user .who")];
    expect(whos[0].textContent).toMatch(/ · edited$/);
    expect(whos[0].querySelector(".who-edit")).toBeTruthy();
    expect(whos[1].querySelector(".who-edit")).toBeNull();
  });
});
