import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE SEND PATH WITH ATTACHMENTS (D68 S3 / ATTACHMENTS_PLAN §7) — `store/chat.sendMessage`, driven
// through the same mocked-SSE `fetch` harness `tests/store/chat.test.ts` uses, so the real reducer
// and the real staging store run end to end.
//
// The three rules under test, all of them consequences rather than special cases:
//   · the ids ride the POST and the chips clear WITH the send — on the 200 (accepted) or the 202
//     (queued as a steer), never on the 409 (refused: the server's sentence says re-attach, so the
//     files must still be there to re-send);
//   · an ATTACHMENT-ONLY send is legal (empty text, files present) — it was a 422 at the door before
//     D68 and an FE early-return before this slice;
//   · a send that carried files re-reads the durable floor once it settles, because the server builds
//     every `AttachmentPart` at claim (E2) and the wire has no user-message frame to deliver it on.

import {
  addStaged,
  clearStaged,
  stagedFiles,
  stagedIds,
  type StagedAttachment,
} from "../../src/store/attachments";
import { sendMessage, startNewThread, useChat } from "../../src/store/chat";

type Frame = { event: string; data: unknown };

function sseResponse(frames: Frame[]): Response {
  const text = frames
    .map((f) => `event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`)
    .join("");
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
}

const DONE: Frame[] = [
  { event: "thread", data: { threadId: "t1" } },
  { event: "message.start", data: { messageId: "m1" } },
  { event: "text.delta", data: { messageId: "m1", delta: "seen" } },
  { event: "done", data: { state: "completed" } },
];

/** Every request the send made, in order — the POST first, then any reload GET. */
let calls: [string, RequestInit | undefined][];

function mockChat(reply: () => Response) {
  calls = [];
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push([url, init]);
    // The chat POST is the only thing this harness answers with a stream; a follow-up read (the
    // durable-floor reload) gets a body it cannot parse, which `reloadChat` swallows exactly as it
    // does a real failure — what matters here is THAT it asked.
    return Promise.resolve(url.endsWith("/api/agent/chat") ? reply() : ({} as Response));
  }) as unknown as typeof fetch;
}

function status(code: number): Response {
  return {
    ok: false,
    status: code,
    body: null,
    headers: { get: () => null },
    json: async () => ({ detail: "a turn is already running" }),
  } as unknown as Response;
}

function accepted202(): Response {
  return {
    ok: true,
    status: 202,
    body: null,
    headers: { get: () => null },
    json: async () => ({ entry_id: "e1", turn_id: "turn-1" }),
  } as unknown as Response;
}

const chip = (attachmentId: string): StagedAttachment => ({
  localId: attachmentId,
  name: `${attachmentId}.png`,
  kind: "image",
  status: "staged",
  attachmentId,
});

function bodyOf(index = 0): Record<string, unknown> {
  return JSON.parse(String(calls[index][1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  startNewThread();
  clearStaged();
});
afterEach(() => clearStaged());

describe("sendMessage × staged attachments", () => {
  it("the ids ride the POST and the chips clear with the send", async () => {
    mockChat(() => sseResponse(DONE));
    addStaged(chip("id-1"));
    await act(async () => {
      await sendMessage("what is this?", { attachments: ["id-1"] });
    });
    expect(calls[0][0]).toBe("/api/agent/chat");
    expect(bodyOf()).toMatchObject({ text: "what is this?", attachments: ["id-1"] });
    expect(stagedFiles()).toEqual([]); // consumed — an id can never be claimed twice (§3)
  });

  it("a send with no attachments carries NO `attachments` key at all", async () => {
    mockChat(() => sseResponse(DONE));
    await act(async () => {
      await sendMessage("plain");
    });
    expect("attachments" in bodyOf()).toBe(false);
  });

  it("a REFUSED send (409) keeps the chips so the owner can act on the server's sentence", async () => {
    mockChat(() => status(409));
    addStaged(chip("id-1"));
    await act(async () => {
      await sendMessage("busy?", { attachments: ["id-1"] });
    });
    expect(stagedIds()).toEqual(["id-1"]);
  });

  it("a QUEUED steer (202) consumes them — the drain claims the ids (E7)", async () => {
    mockChat(() => accepted202());
    addStaged(chip("id-1"));
    const { result } = renderHook(() => useChat());
    // Get the view into a live turn so the next send is a steer, then answer that send with a 202.
    await act(async () => {
      globalThis.fetch = vi.fn(() => Promise.resolve(sseResponse([])));
      void sendMessage("first");
      await Promise.resolve();
    });
    mockChat(() => accepted202());
    await act(async () => {
      await sendMessage("and this photo", { attachments: ["id-1"] });
    });
    expect(bodyOf()).toMatchObject({ attachments: ["id-1"] });
    expect(stagedFiles()).toEqual([]);
    expect(result.current.messages.some((m) => m.queued === "e1")).toBe(true);
  });

  it("a chip added WHILE the POST was in flight survives the send", async () => {
    mockChat(() => sseResponse(DONE));
    addStaged(chip("id-1"));
    await act(async () => {
      const sending = sendMessage("first", { attachments: ["id-1"] });
      addStaged(chip("id-2")); // the owner attaches again before the turn ends
      await sending;
    });
    expect(stagedIds()).toEqual(["id-2"]); // only what was SPENT is gone
  });

  it("ATTACHMENT-ONLY: empty text with files is a real send", async () => {
    mockChat(() => sseResponse(DONE));
    addStaged(chip("id-1"));
    await act(async () => {
      await sendMessage("", { attachments: ["id-1"] });
    });
    expect(bodyOf()).toMatchObject({ text: "", attachments: ["id-1"] });
  });

  it("…and empty text with NOTHING staged is still the no-op it always was", async () => {
    mockChat(() => sseResponse(DONE));
    await act(async () => {
      await sendMessage("   ");
    });
    expect(calls).toEqual([]);
  });

  it("a settled attachment send re-reads the durable floor (the server builds the parts, E2)", async () => {
    mockChat(() => sseResponse(DONE));
    addStaged(chip("id-1"));
    await act(async () => {
      await sendMessage("look", { attachments: ["id-1"] });
    });
    // …so the user bubble can render what it actually sent. (Other end-of-turn reads — the D57
    // memory-status probe — ride along on every turn and are not this pin's business.)
    expect(calls.map(([url]) => url)).toContain("/api/threads/t1/messages");
  });

  it("a send with no files does NOT pay for that read", async () => {
    mockChat(() => sseResponse(DONE));
    await act(async () => {
      await sendMessage("plain");
    });
    expect(calls.map(([url]) => url)).not.toContain("/api/threads/t1/messages");
  });
});
