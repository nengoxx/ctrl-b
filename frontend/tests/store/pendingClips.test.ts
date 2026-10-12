import { beforeEach, describe, expect, it } from "vitest";

import {
  clearClipPending,
  markClipPending,
  newClipId,
  takeLostClips,
} from "../../src/store/pendingClips";

// store/pendingClips — the lost-clip marker (ISS-84 part G): a SET of clip ids in localStorage, one
// per clip in trouble; boot counts and clears it. Storage failures never throw (the persist helpers).

beforeEach(() => localStorage.removeItem("ctrlb.pendingClips"));

describe("pendingClips", () => {
  it("marks per clip: one landing never clears another's mark", () => {
    const a = newClipId();
    const b = newClipId();
    expect(a).not.toBe(b);
    markClipPending(a);
    markClipPending(b);
    markClipPending(a); // a second failure of the same clip is the same mark
    clearClipPending(a);
    expect(takeLostClips()).toBe(1); // b is still in trouble
  });

  it("boot TAKES the marks: counted once, then cleared", () => {
    markClipPending(newClipId());
    markClipPending(newClipId());
    expect(takeLostClips()).toBe(2);
    expect(takeLostClips()).toBe(0);
  });

  it("a FRESH launch takes EVERY mark (X4) — one written under another session's tab id too", () => {
    // A mark from before the swipe-from-recents (its session, and its tab id, are gone) and one in the
    // pre-X4 tab-stamped shape: a fresh `liveClientId()` matches neither, and both must still be said.
    localStorage.setItem(
      "ctrlb.pendingClips",
      JSON.stringify({ old: 1, stamped: { at: 2, tab: "00000000-0000-4000-8000-000000000000" } }),
    );
    markClipPending("mine");
    expect(takeLostClips()).toBe(3);
    expect(localStorage.getItem("ctrlb.pendingClips")).toBe("{}");
  });

  it("an unreadable stored value reads as no marks rather than throwing", () => {
    localStorage.setItem("ctrlb.pendingClips", "{not json");
    expect(takeLostClips()).toBe(0);
  });
});
