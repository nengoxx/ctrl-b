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
  reserveStaged,
  stagedFiles,
  stagedIds,
  type StagedAttachment,
} from "../../src/store/attachments";
import { reloadChat, sendMessage, startNewThread, useChat } from "../../src/store/chat";

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

// MED-1 — the RESERVATION's far end. `runComposer` flips the rows it snapshots to `sending`; this
// function either spends them (the accept) or hands them back. Nothing may stay spoken-for.
describe("the reservation (MED-1)", () => {
  it("a REFUSED send (409) hands the rows back — the chips are the owner's again", async () => {
    mockChat(() => status(409));
    addStaged(chip("id-1"));
    const reserved = reserveStaged();
    expect(stagedFiles()[0].status).toBe("sending");
    await act(async () => {
      await sendMessage("busy?", { attachments: reserved });
    });
    expect(stagedFiles()[0].status).toBe("staged");
    expect(stagedIds()).toEqual(["id-1"]); // …and immediately sendable again
  });

  it("an UNREACHABLE backend hands them back too", async () => {
    calls = [];
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("network")));
    addStaged(chip("id-1"));
    await act(async () => {
      await sendMessage("look", { attachments: reserveStaged() });
    });
    expect(stagedIds()).toEqual(["id-1"]);
  });

  it("an ACCEPTED send spends them — there is nothing to hand back", async () => {
    mockChat(() => sseResponse(DONE));
    addStaged(chip("id-1"));
    await act(async () => {
      await sendMessage("look", { attachments: reserveStaged() });
    });
    expect(stagedFiles()).toEqual([]);
  });
});

// MED-6 — the optimistic bubble carries a PRESENTATIONAL snapshot of the chips it consumed, so an
// attachment send shows what it sent immediately instead of after the durable floor lands. Not a wire
// field, not an `AttachmentPart` — and the object URL it renders is OWNED by the bubble from the
// accept onwards, which is why the rail stops revoking and the durable swap starts.
describe("the optimistic snapshot (MED-6)", () => {
  const photo = (attachmentId: string): StagedAttachment => ({
    ...chip(attachmentId),
    previewUrl: `blob:${attachmentId}`,
  });

  /** The durable floor a reload lands on — the SERVER's own `AttachmentPart` (E2). */
  const durable = (text: string) => [
    {
      id: "m9",
      thread_id: "t1",
      role: "user",
      parts: [
        ...(text ? [{ type: "text", text }] : []),
        {
          type: "attachment",
          kind: "image",
          name: "photo.webp",
          mime: "image/webp",
          path: "t1/photo.webp",
          bytes: 4096,
        },
      ],
      actor: "user",
      ts: "2026-09-01T10:00:00Z",
      tokens: null,
      compacted: false,
    },
  ];

  it("the bubble shows the staged files BEFORE any stream event", async () => {
    // The POST is held open, so what is asserted is the view in the window a real send lives in —
    // the whole point of the snapshot (the durable parts are a round trip and a turn away).
    let answer!: (res: Response) => void;
    mockChat(() => new Promise<Response>((resolve) => (answer = resolve)) as unknown as Response);
    addStaged(photo("id-1"));
    const { result } = renderHook(() => useChat());
    let sending!: Promise<void>;
    await act(async () => {
      sending = sendMessage("look at this", { attachments: reserveStaged() });
      await Promise.resolve();
    });
    const bubble = result.current.messages.find((m) => m.role === "user");
    expect(bubble?.pending_attachments).toEqual([
      { name: "id-1.png", kind: "image", previewUrl: "blob:id-1" },
    ]);
    // …and it is NOT on the wire: the request body names its own fields, and this is not one.
    expect("pending_attachments" in bodyOf()).toBe(false);
    await act(async () => {
      answer(sseResponse(DONE));
      await sending;
    });
  });

  it("an attachment-only send has a bubble at all (chips, no caption)", async () => {
    mockChat(() => sseResponse(DONE));
    addStaged(photo("id-1"));
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("", { attachments: reserveStaged() });
    });
    const bubble = result.current.messages.find((m) => m.role === "user");
    expect(bubble?.pending_attachments).toHaveLength(1);
    expect(bubble?.parts).toEqual([{ type: "text", text: "" }]); // the caption the renderer drops
  });

  it("a QUEUED STEER's bubble carries the snapshot too", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      globalThis.fetch = vi.fn(() => Promise.resolve(sseResponse([])));
      void sendMessage("first");
      await Promise.resolve();
    });
    mockChat(accepted202);
    addStaged(photo("id-2"));
    await act(async () => {
      await sendMessage("and this photo", { attachments: reserveStaged() });
    });
    const queued = result.current.messages.find((m) => m.queued === "e1");
    expect(queued?.pending_attachments).toEqual([
      { name: "id-2.png", kind: "image", previewUrl: "blob:id-2" },
    ]);
  });

  it("the URL survives the send and is revoked by the DURABLE swap, not by the rail", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    mockChat(() => sseResponse(DONE));
    addStaged(photo("id-1"));
    await act(async () => {
      await sendMessage("look", { attachments: reserveStaged() });
    });
    // The chips are gone (consumed) but the URL the bubble is rendering is still alive…
    expect(stagedFiles()).toEqual([]);
    expect(revoke).not.toHaveBeenCalled();
    // …until the durable floor replaces the optimistic bubble. (The harness's reload GET returns a
    // body `reloadChat` cannot parse, so it is driven here explicitly with the real thing.)
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => durable("look") } as unknown as Response),
    );
    await act(async () => {
      await reloadChat();
    });
    expect(revoke).toHaveBeenCalledWith("blob:id-1");
  });

  it("a REFUSED send never takes ownership — the rail keeps the chip AND its thumbnail", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    mockChat(() => status(409));
    addStaged(photo("id-1"));
    await act(async () => {
      await sendMessage("busy?", { attachments: reserveStaged() });
    });
    expect(stagedFiles()[0]).toMatchObject({ status: "staged", previewUrl: "blob:id-1" });
    expect(revoke).not.toHaveBeenCalled(); // the rollback dropped the bubble, not the rail's URL
  });
});
