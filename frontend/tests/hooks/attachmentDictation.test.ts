import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE §7 MIC PIN (D68, E-amend b) — **staged attachments ride a DICTATION AUTO-SEND exactly as they
// ride a button send, and clear with it.**
//
// This is its own file because of what it must NOT mock: `useDictation` bypasses
// `useComposer().send()` entirely and calls `runComposer` itself, so the pin is only worth anything
// with the REAL `lib/composer` in the loop — the mic's own suite mocks it, which is right there and
// wrong here. So: real dictation hook, real routing, real staging store, and only the store/chat
// boundary spied (the same seam `composerSteer.test.tsx` uses).
//
// What would break it: passing the staged ids from `useComposer().send()` instead of from
// `runComposer`'s natural-language branch. Every other send path would still work, and this one —
// the owner's primary mobile input — would silently drop the photo it was sent with.

vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../src/store/chat", () => ({
  sendMessage: vi.fn(),
  runShell: vi.fn(),
  compactThread: vi.fn(),
  startNewThread: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionAgent: vi.fn(),
  setSessionPrivilege: vi.fn(),
  pushSystemNote: vi.fn(),
  getChatStatus: vi.fn(() => "idle"),
}));
vi.mock("../../src/store/ui", () => ({ setUI: vi.fn() }));

import { FakeMediaRecorder, mockStt, recordOnce, setMediaDevices } from "./dictationFakes";
import { useDictation } from "../../src/hooks/useDictation";
import { addStaged, clearStaged, stagedIds } from "../../src/store/attachments";
import * as chat from "../../src/store/chat";
import { clearDraft, getDraft } from "../../src/store/composer";

const opts = { sttReady: true, statusStamp: 1, autoSend: true };

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  setMediaDevices(true);
  clearDraft();
  clearStaged();
  mockStt(200, { text: "what is in this photo" });
});

afterEach(() => {
  cleanup();
  clearStaged();
});

describe("dictation auto-send × staged attachments (§7's mic pin)", () => {
  it("the auto-sent message carries the staged ids", async () => {
    addStaged({
      localId: "l1",
      name: "photo.png",
      kind: "image",
      status: "staged",
      attachmentId: "id-1",
    });
    const { result } = renderHook(() => useDictation(opts));
    await recordOnce(result);
    await waitFor(() =>
      expect(chat.sendMessage).toHaveBeenCalledWith("what is in this photo", {
        raw: "what is in this photo",
        attachments: ["id-1"],
      }),
    );
    // …and the draft is cleared with it, exactly as an unattached auto-send clears it. (The CHIPS
    // clear inside `sendMessage`, on the server's acceptance — which is mocked out here; that half
    // is pinned in `tests/store/attachmentSend.test.ts`.)
    expect(getDraft()).toBe("");
    expect(stagedIds()).toEqual(["id-1"]); // the real store/chat is what spends them
  });

  it("with nothing staged the auto-send is byte-identical to its pre-D68 self", async () => {
    mockStt(200, { text: "wake corsair" });
    const { result } = renderHook(() => useDictation(opts));
    await recordOnce(result);
    await waitFor(() =>
      expect(chat.sendMessage).toHaveBeenCalledWith("wake corsair", { raw: "wake corsair" }),
    );
  });

  it("a dictated `!command` still does NOT consume the staged files (the routing ruling holds)", async () => {
    addStaged({
      localId: "l1",
      name: "photo.png",
      kind: "image",
      status: "staged",
      attachmentId: "id-1",
    });
    mockStt(200, { text: "!uptime" });
    const { result } = renderHook(() => useDictation(opts));
    await recordOnce(result);
    await waitFor(() => expect(chat.runShell).toHaveBeenCalledWith("uptime"));
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(stagedIds()).toEqual(["id-1"]);
  });
});
