import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE COMPOSER'S EXPAND AFFORDANCE (D68 S5 / ATTACHMENTS_PLAN §7 + §9-S5) — driven through the REAL
// variants, for the same reason the attachment chrome is: the subject is a SHARED seam, and "all three
// layouts, one control" is exactly the property that would rot.
//
// The rulings pinned here (main-seat, on R62 §5's evidence — owner-overridable at S6):
//   · the trigger appears at ≥3 RENDERED lines and not below (Telegram Web A `totalLines >= 3`,
//     Telegram Android `> 2`, open-webui `> 2` — three of four peers, one threshold);
//   · expanded is a TALLER AUTO-GROW CEILING and nothing else — no second editor surface, so the
//     assertion is the height the shared chrome hook writes;
//   · it is LEAVABLE (the collapse control outlives the ≥3-line condition that offered it) and
//     SELF-RESETTING (the draft clearing is the exit);
//   · THE MIC IS UNTOUCHED — every peer hides or disables it in expanded mode; ours is a ceiling, not
//     a mode, and the owner's mic-never-blocked posture stands.
//
// MEASUREMENT: jsdom lays nothing out, so the textarea's `scrollHeight` is stubbed — the same tactic
// `composerSurface.test.ts` uses for the plain auto-grow. With no stylesheet loaded, the hook's computed
// line box falls back to its `FALLBACK_LINE_PX`, which is what `LINE_PX` below mirrors.

vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({ data: { stt: true }, dataUpdatedAt: 0 }),
}));
vi.mock("../../src/store/chat", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/chat")>();
  return { ...actual, sendMessage: vi.fn(), stopTurn: vi.fn() };
});

import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import { clearStaged } from "../../src/store/attachments";
import { clearDraft, setDraft } from "../../src/store/composer";

const VARIANTS = [
  ["stacked", KitComposer],
  ["sheet", SheetComposer],
  ["line", LineComposer],
] as const;

/** The hook's fallback line box (kit.css's 15px × 1.45 ≈ 21.75, rounded) — jsdom computes none. */
const LINE_PX = 22;
/** The collapsed ceiling, and the tall one the hook derives from the app's viewport height. */
const CEIL = 96;
const TALL = Math.max(CEIL, Math.round(window.innerHeight * 0.5));

const toggle = () => screen.queryByRole("button", { name: /the message field$/ });
const mic = () => screen.getByRole("button", { name: /dictation|microphone/i });
const field = () => document.querySelector("textarea") as HTMLTextAreaElement;

/** The stubbed rendered content height, read lazily by the `scrollHeight` getter below. */
let content = 0;

function mount(Variant: (typeof VARIANTS)[number][1]) {
  render(<Variant />);
  Object.defineProperty(field(), "scrollHeight", { configurable: true, get: () => content });
}

/** Put the draft at `n` rendered lines — the content height first, so the auto-grow effect that runs
 *  inside this commit measures the new value. A distinct string per call so the store actually emits. */
function draftAt(n: number) {
  act(() => {
    content = n * LINE_PX;
    setDraft(`${n} line draft`);
  });
}

beforeEach(() => {
  content = 0;
  clearStaged();
  clearDraft();
});
afterEach(() => {
  cleanup();
  clearStaged();
  clearDraft();
});

describe.each(VARIANTS)("%s composer — the expand affordance", (name, Variant) => {
  it("offers nothing under 3 rendered lines, and the quiet trigger AT 3", () => {
    mount(Variant);
    draftAt(2);
    expect(toggle()).toBeNull();
    draftAt(3);
    const btn = toggle()!;
    expect(btn).not.toBeNull();
    // ONE shared control per composer, quiet by ruling: the `.kit-cbtn` chassis with the modifier that
    // drops its ring — the clip's treatment, never the accent-filled mic/send one.
    expect(document.querySelectorAll(".kit-cbtn.expand")).toHaveLength(1);
    expect(btn.className).toContain("kit-cbtn expand");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe("cmd-input");
  });

  it("toggling RAISES the auto-grow ceiling, and toggling back lowers it", () => {
    mount(Variant);
    draftAt(20); // far past either ceiling, so the ceiling is what the height reports
    expect(field().style.height).toBe(`${CEIL}px`);
    expect(field().style.maxHeight).toBe(""); // collapsed writes none — kit.css's 96px still governs

    fireEvent.click(toggle()!);
    expect(field().style.height).toBe(`${TALL}px`);
    expect(field().style.maxHeight).toBe(`${TALL}px`); // …and lifts the stylesheet's clamp with it
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle()!);
    expect(field().style.height).toBe(`${CEIL}px`);
    expect(field().style.maxHeight).toBe("");
  });

  it("the field still GROWS while expanded — the mode only moves where growth stops", () => {
    mount(Variant);
    draftAt(4);
    fireEvent.click(toggle()!);
    expect(field().style.height).toBe(`${4 * LINE_PX}px`); // under the tall ceiling → content wins
    draftAt(6);
    expect(field().style.height).toBe(`${6 * LINE_PX}px`);
  });

  it("the collapse control OUTLIVES the ≥3-line condition that offered it (leavable, not a trap)", () => {
    mount(Variant);
    draftAt(3);
    fireEvent.click(toggle()!);
    draftAt(1); // deleting back down to one line must not strand the owner in the expanded field
    expect(toggle()).not.toBeNull();
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
  });

  it("clearing the draft leaves the mode and retires the trigger", () => {
    mount(Variant);
    draftAt(3);
    fireEvent.click(toggle()!);
    // The draft clearing IS the exit, which is why this one act covers every path that clears it: the
    // send button, Enter, `/clear`, and the dictation auto-send (pinned to clear the draft in
    // tests/hooks/attachmentDictation.test.ts) all land here.
    act(() => {
      content = 0;
      clearDraft();
    });
    expect(toggle()).toBeNull();
    expect(field().style.height).toBe("");
    expect(field().style.maxHeight).toBe("");
    draftAt(3); // …and the next message starts at the baseline
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("THE MIC IS UNTOUCHED while expanded (R62 §5's mic row — every peer hides or disables it)", () => {
    mount(Variant);
    draftAt(3);
    fireEvent.click(toggle()!);
    expect(mic()).not.toBeNull();
    expect((mic() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the expand affordance's placement (per layout, one component)", () => {
  it("the stacked bar puts it in the field, which holds nothing else", () => {
    mount(KitComposer);
    draftAt(3);
    const box = document.querySelector(".kit-composer.stacked .field")!;
    expect(toggle()).not.toBeNull();
    expect(box.contains(toggle())).toBe(true);
  });

  it("the docked sheet puts it in the field, beside — not on top of — the embedded controls", () => {
    mount(SheetComposer);
    draftAt(3);
    const box = document.querySelector(".kit-composer.sheet .field")!;
    expect(toggle()).not.toBeNull();
    expect(box.contains(toggle())).toBe(true);
  });

  it("the line pill has no field wrapper, so it hangs off the root (its row IS the field)", () => {
    mount(LineComposer);
    draftAt(3);
    expect(document.querySelector(".kit-composer.line .field")).toBeNull();
    expect(toggle()!.parentElement).toBe(document.querySelector("#composer"));
  });
});

describe("a real SEND leaves the mode (the primary exit)", () => {
  it("sending clears the draft, which collapses the field and retires the trigger", () => {
    mount(LineComposer);
    draftAt(3);
    fireEvent.click(toggle()!);
    expect(field().style.maxHeight).toBe(`${TALL}px`);
    // The REAL routing seam (`lib/composer` → the mocked `store/chat.sendMessage`), so this pins the
    // send path rather than a stand-in for it.
    act(() => {
      content = 0;
      fireEvent.click(screen.getByRole("button", { name: "send message" }));
    });
    expect(toggle()).toBeNull();
    expect(field().style.height).toBe("");
    expect(field().style.maxHeight).toBe("");
  });
});
