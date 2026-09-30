import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE COMPOSER'S EXPAND AFFORDANCE (D68 S5 / ATTACHMENTS_PLAN §7 + §9-S5) — driven through the REAL
// variants, for the same reason the attachment chrome is: the subject is a SHARED seam, and "all three
// layouts, one control" is exactly the property that would rot.
//
// The rulings pinned here (main-seat, on R62 §5's evidence — owner-overridable at S6):
//   · the trigger appears at ≥3 RENDERED lines and not below (Telegram Web A `totalLines >= 3`,
//     Telegram Android `> 2`, open-webui `> 2` — three of four peers, one threshold);
//   · expanded PINS THE FIELD AT THE TALL HEIGHT at once (the owner's 2026-09-30 override of the
//     original ceiling-only ruling) — still no second editor surface, so the assertion is the height
//     the shared chrome hook writes;
//   · it is LEAVABLE (the collapse control outlives the ≥3-line condition that offered it) and
//     SELF-RESETTING (the draft clearing is the exit);
//   · THE MIC IS UNTOUCHED — every peer hides or disables it in expanded mode; ours only makes the
//     field taller, and the owner's mic-never-blocked posture stands.
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
import { addStaged, clearStaged, updateStaged } from "../../src/store/attachments";
import { clearDraft, setDraft } from "../../src/store/composer";

const VARIANTS = [
  ["stacked", KitComposer],
  ["sheet", SheetComposer],
  ["line", LineComposer],
] as const;

/** The hook's fallback line box (kit.css's 15px × 1.45 ≈ 21.75, rounded) — jsdom computes none. */
const LINE_PX = 22;
/** The collapsed ceiling (112 since the S6 re-round №3 owner ruling: exactly the line pill's full
 *  control column, so the stack fits at rest), and the tall one derived from the viewport height. */
const CEIL = 112;
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

  it("toggling PINS the tall height, and toggling back hands the field to the auto-grow", () => {
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
    // The cap CARRIES the pre-collapse height for one beat (the feel round's shrink-clamp fix):
    // max-height is not transitioned, so clearing it at once would snap the paint to 96 and eat the
    // collapse animation. It is inert above the inline 96px height and settles on the NEXT measure —
    // which on the line variant is immediate (the collapse releases the control stack, whose width
    // key re-measures), while the other variants hold the carry until the next input.
    expect(["", `${TALL}px`]).toContain(field().style.maxHeight);
    draftAt(21);
    expect(field().style.maxHeight).toBe(""); // …settled — the resting path is byte-identical again
    expect(field().style.height).toBe(`${CEIL}px`);
  });

  it("a SHORT draft expands straight to the tall height — the mode is the height, not a ceiling", () => {
    // The owner's 2026-09-30 round: a trigger that only raised a ceiling did nothing visible until
    // the text reached it. Expanded now pins the field at the tall box whatever the draft's length.
    mount(Variant);
    draftAt(3);
    expect(field().style.height).toBe(`${3 * LINE_PX}px`);
    fireEvent.click(toggle()!);
    expect(field().style.height).toBe(`${TALL}px`); // at once, with 3 lines in it
    draftAt(4);
    expect(field().style.height).toBe(`${TALL}px`); // typing never moves the pinned box
    fireEvent.click(toggle()!);
    expect(field().style.height).toBe(`${4 * LINE_PX}px`); // collapse → the content height again
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
    // send button, Enter, `/new`, and the dictation auto-send (pinned to clear the draft in
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

// THE PLACEMENT HAS TWO MODES since the S6 fix wave (owner finding F2, the phone round): the toggle
// belongs at the COMPOSER's top-right corner, and WHICH element holds that corner depends on whether a
// rail is staged. With nothing staged it is the field's, exactly as S5 ruled and unchanged here; with a
// rail up the rail IS the composer's top row, so the toggle moves into the rail's TAIL — where the old
// field-corner anchor would have rendered it BELOW the chips, which is what the owner saw.
describe("the expand affordance's placement — NO RAIL (the S5 anchors, unchanged)", () => {
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

  // MED-1 (the S5 Emma round, main-seat ruled): the toggle used to hang off the ROOT — whose top-right
  // corner stops being the field's the moment a rail is staged above it. The line layout's row is now its
  // own element, and the toggle's POSITIONING CONTEXT is that row (kit.css puts `position:relative`
  // there), which is what jsdom can pin: the parent chain, not the paint.
  it("the line pill has no field wrapper — its ROW is the field, and the toggle anchors to THAT", () => {
    mount(LineComposer);
    draftAt(3);
    expect(document.querySelector(".kit-composer.line .field")).toBeNull();
    const row = document.querySelector(".kit-composer.line .line-row")!;
    expect(row).not.toBeNull();
    // Since the S6 re-round the toggle's PARENT is the trailing `.line-cluster` — but the cluster is
    // deliberately unpositioned (kit.css), so the positioning CONTEXT is still the row, which is what
    // this pin has always meant. At 3 jsdom lines (66px) the cluster is not stacked (mic + send need
    // 77), so the absolute corner rule is the one in force.
    const cluster = toggle()!.parentElement!;
    expect(cluster.className).toBe("line-cluster");
    expect(cluster.parentElement).toBe(row);
    expect(row.parentElement).toBe(document.querySelector("#composer"));
  });
});

describe("the expand affordance's placement — STAGED (the S6 tail, F2)", () => {
  const stageOne = () =>
    addStaged({ localId: "photo.png", name: "photo.png", kind: "image", status: "staged" });

  describe.each(VARIANTS)("%s", (name, Variant) => {
    it("puts the toggle in the rail's TAIL, and nowhere else", () => {
      stageOne();
      mount(Variant);
      draftAt(3);
      const tail = document.querySelector(".kit-attach-tail")!;
      expect(tail).not.toBeNull();
      expect(toggle()!.parentElement).toBe(tail);
      expect(document.querySelectorAll(".kit-cbtn.expand")).toHaveLength(1); // still exactly one
      // …and it is the rail's FIRST tail item, i.e. the composer's top-right corner — the clip sits
      // under it, in the lane the send button occupies one row down.
      expect(tail.firstElementChild).toBe(toggle());
    });

    it("…and no chip can slide under it: the chips scroll in their OWN box", () => {
      stageOne();
      mount(Variant);
      draftAt(3);
      const scroll = document.querySelector(".kit-attach-scroll")!;
      const tail = document.querySelector(".kit-attach-tail")!;
      expect(scroll.contains(tail)).toBe(false);
      expect(scroll.getAttribute("role")).toBe("list"); // the list moved to the scroller with the chips
      expect(scroll.contains(screen.getByRole("listitem"))).toBe(true);
      expect(tail.parentElement).toBe(scroll.parentElement); // the rail row is the two of them
    });

    it("clearing the rail hands it back to the layout's own anchor — one instance either way", () => {
      stageOne();
      mount(Variant);
      draftAt(3);
      expect(document.querySelector(".kit-attach-tail")!.contains(toggle())).toBe(true);
      act(() => clearStaged());
      expect(document.querySelector(".kit-attach-tail")).toBeNull();
      expect(document.querySelectorAll(".kit-cbtn.expand")).toHaveLength(1);
      expect(toggle()!.parentElement).toBe(
        document.querySelector(".kit-composer .field") ??
          // The line pill's own anchor since the S6 re-round: the unpositioned trailing cluster
          // inside the row (the positioning context stays `.line-row`).
          document.querySelector(".kit-composer.line .line-cluster"),
      );
    });
  });

  // The S5 MED-1 property, restated for the tail: the rail is still an ordinary block sibling ABOVE the
  // line layout's row, and the toggle is inside it rather than absolutely positioned over it.
  it("the line pill's rail stays the row's sibling, and carries the toggle itself", () => {
    stageOne();
    mount(LineComposer);
    draftAt(3);
    const rail = document.querySelector(".kit-attach-rail")!;
    const row = document.querySelector(".kit-composer.line .line-row")!;
    expect(row.contains(rail)).toBe(false);
    expect(rail.parentElement).toBe(row.parentElement); // ordinary siblings — no flex reordering left
    expect(rail.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rail.contains(toggle())).toBe(true);
    expect(row.contains(toggle())).toBe(false);
  });
});

// MED-3 (the S6 blind round, main-seat ruled): the clip leaving/entering the field row changes the
// TEXTAREA's rendered width, and the measurement used to re-run only on draft/expanded/viewport — so a
// draft sitting on the 2-line/3-line boundary kept a stale line count, hence a stale trigger, until the
// next keystroke. The `widthKey` option is the fourth input to the same `measure()`.
describe("staging RE-MEASURES the field (MED-3)", () => {
  it("a 2-line draft that re-wraps to 3 when the clip leaves the row offers the trigger at once", () => {
    mount(SheetComposer);
    draftAt(2);
    expect(toggle()).toBeNull();
    // No keystroke: the file lands, the clip + toggle leave `.field` for the tail, the field is wider…
    act(() => {
      content = 3 * LINE_PX;
      addStaged({ localId: "photo.png", name: "photo.png", kind: "image", status: "staged" });
    });
    expect(toggle()).not.toBeNull();
  });

  it("…and the HEIGHT follows the same re-measure", () => {
    mount(SheetComposer);
    draftAt(2);
    expect(field().style.height).toBe(`${2 * LINE_PX}px`);
    act(() => {
      content = 3 * LINE_PX;
      addStaged({ localId: "photo.png", name: "photo.png", kind: "image", status: "staged" });
    });
    expect(field().style.height).toBe(`${3 * LINE_PX}px`);
  });
});

// MED-2 (the S5 Emma round, main-seat ruled): the measurement ran ONLY on draft/expanded changes, yet both
// of its outputs are viewport-dependent — the tall ceiling READS `--app-h` (so the on-screen keyboard left
// an expanded field sized for the old viewport) and the rendered line count follows the field's WIDTH (so a
// rotation could re-wrap a 2-line draft to 3 with no trigger until the next keystroke). One measure
// function, now also run from the viewport's own events.
describe("the measurement REACTS to the viewport (MED-2)", () => {
  const REAL_VV = Object.getOwnPropertyDescriptor(window, "visualViewport");
  /** Force the hook down one branch or the other, whatever jsdom does or does not implement. As far as
   *  this hook is concerned the visual viewport is only an EventTarget — the HEIGHT reaches it through
   *  `--app-h`, the var App.tsx's `useAppViewport` writes. */
  function withVisualViewport(vv: EventTarget | undefined) {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  }
  /** The keyboard opening / a rotation: App.tsx rewrites the var, the browser fires the event. */
  function viewportChangeTo(appH: number, fire: () => void) {
    act(() => {
      document.documentElement.style.setProperty("--app-h", `${appH}px`);
      fire();
    });
  }

  afterEach(() => {
    if (REAL_VV) Object.defineProperty(window, "visualViewport", REAL_VV);
    else Reflect.deleteProperty(window, "visualViewport");
    document.documentElement.style.removeProperty("--app-h");
  });

  it("an EXPANDED field re-ceils on a visualViewport resize — no draft change involved", () => {
    const vv = new EventTarget();
    withVisualViewport(vv);
    document.documentElement.style.setProperty("--app-h", "800px");
    mount(LineComposer);
    draftAt(20); // far past either ceiling → the ceiling IS the reported height
    fireEvent.click(toggle()!);
    expect(field().style.height).toBe("400px"); // half of the 800px viewport
    expect(field().style.maxHeight).toBe("400px");

    viewportChangeTo(300, () => vv.dispatchEvent(new Event("resize"))); // the keyboard opens
    expect(field().style.height).toBe("150px");
    // The cap carries the pre-shrink 400 for the height transition's benefit (the feel round's
    // shrink-clamp fix) — inert above the 150px inline height — and settles with the next measure.
    expect(field().style.maxHeight).toBe("400px");
    draftAt(21);
    expect(field().style.maxHeight).toBe("150px");
  });

  it("…and on its SCROLL too (the visual viewport offsets under a pinned keyboard)", () => {
    const vv = new EventTarget();
    withVisualViewport(vv);
    document.documentElement.style.setProperty("--app-h", "800px");
    mount(LineComposer);
    draftAt(20);
    fireEvent.click(toggle()!);
    viewportChangeTo(1000, () => vv.dispatchEvent(new Event("scroll")));
    expect(field().style.maxHeight).toBe("500px"); // the tall height moved with the viewport…
    expect(field().style.height).toBe("500px"); // …and the pinned field with it
  });

  it("the ≥3-line TRIGGER re-derives on the same event (a rotation re-wraps the draft)", () => {
    const vv = new EventTarget();
    withVisualViewport(vv);
    mount(LineComposer);
    draftAt(2);
    expect(toggle()).toBeNull();
    // The draft is untouched; the FIELD gets narrower, so the same text renders at three lines.
    act(() => {
      content = 3 * LINE_PX;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(toggle()).not.toBeNull();
  });

  it("a browser with NO visualViewport falls back to the window's own resize", () => {
    withVisualViewport(undefined);
    document.documentElement.style.setProperty("--app-h", "800px");
    mount(LineComposer);
    draftAt(20);
    fireEvent.click(toggle()!);
    expect(field().style.height).toBe("400px");
    viewportChangeTo(300, () => window.dispatchEvent(new Event("resize")));
    expect(field().style.height).toBe("150px");
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

// THE LINE PILL'S CONTROL STACK (the owner's S6 re-round, 2026-09-03): once the field is tall enough,
// the trailing controls turn VERTICAL — mic over send, the toggle in-flow on top — and the text keeps
// the freed lane. "Only when there's space" is the ruling, and since the owner's 2026-09-30 round the
// PAIR decides (LineComposer documents it): mic+send fit the text's height from ~3 rendered lines,
// and the toggle rides on top uncounted. LINE layout only.
describe("the line pill's control stack (S6 re-round)", () => {
  const cluster = () => document.querySelector(".line-cluster");

  // The currency here is the PAINTED field height (`probePx` = min(ceiling, scrollHeight) at the
  // stacked width; the pinned tall height while expanded) — the re-round review's MED-2: a
  // rendered-line count lies whenever the ceiling binds. jsdom computes no padding and the fallback
  // line box is 22, so `draftAt(n)` paints exactly `min(ceil, n×22)` at any width. THE PAIR DECIDES
  // (the owner's 2026-09-30 round): mic 36 + send 36 + gap 6 = 78, stacks ≥77 — the toggle rides on
  // top and is never counted; the same bar releases it.

  it("the PAIR decides — the toggle rides on top of the column and costs no extra lines", () => {
    // Counting the toggle made the stack wait for 112px (5 lines) — two whole lines of typing past
    // the point where mic + send already fit ("you need too much text to make it switch" — owner).
    mount(LineComposer);
    draftAt(3); // paints 66 < 77 — not yet, though the corner toggle is already offered
    expect(cluster()!.classList.contains("stack")).toBe(false);
    expect(toggle()).not.toBeNull();
    draftAt(4); // 88 ≥ 77 — stacks, well short of the trio's 112 (the pill grows to hold it)
    const stack = document.querySelector(".line-cluster.stack")!;
    expect(stack).not.toBeNull();
    // The column top-to-bottom mirrors the rail tail: the quiet toggle, then mic, then send — and
    // the toggle is INSIDE the stack (in-flow), not a second corner instance.
    const kinds = [...stack.children].map((el) => el.className);
    expect(kinds[0]).toContain("expand");
    expect(kinds[1]).toContain("mic");
    expect(kinds[2]).toContain("kit-send");
    expect(document.querySelectorAll(".kit-cbtn.expand")).toHaveLength(1);
  });

  it("expanding stacks at ONCE — even a short draft — and collapsing hands it back", () => {
    // The owner's other half of the round: the tap pins the tall height, so the column fits with it.
    mount(LineComposer);
    draftAt(3); // 66 — in the row
    expect(document.querySelector(".line-cluster.stack")).toBeNull();
    fireEvent.click(toggle()!);
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
    fireEvent.click(toggle()!); // collapse — 66 again, under the pair's 77
    expect(document.querySelector(".line-cluster.stack")).toBeNull();
  });

  it("…and the stack survives entering AND leaving the expand mode — the mode owes it nothing", () => {
    // The resting ceiling (112) is above the pair's 77 and the expanded field is pinned taller still,
    // so no mode change can pull the probed height under the column — collapse never unstacks a
    // draft the resting field covers.
    mount(LineComposer);
    draftAt(20);
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull(); // resting: 112 ≥ 111
    fireEvent.click(toggle()!); // expand — paints min(TALL, 440)
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
    fireEvent.click(toggle()!); // collapse — paints 112 again, still ≥ 111
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
  });

  it("with a rail staged the toggle is the TAIL's, so the pair alone stacks — from ~3 lines", () => {
    mount(LineComposer);
    act(() => {
      addStaged({ localId: "photo.png", name: "photo.png", kind: "image", status: "staged" });
    });
    draftAt(3); // paints 66 < 77 — not yet
    expect(cluster()!.classList.contains("stack")).toBe(false);
    draftAt(4); // paints 88 ≥ 77
    const stack = document.querySelector(".line-cluster.stack")!;
    expect(stack).not.toBeNull();
    const kinds = [...stack.children].map((el) => el.className);
    expect(kinds[0]).toContain("mic");
    expect(kinds[1]).toContain("kit-send");
    // The toggle lives in the rail's tail, never in the stack, and there is still exactly one.
    expect(stack.querySelector(".kit-cbtn.expand")).toBeNull();
    expect(document.querySelectorAll(".kit-attach-tail .kit-cbtn.expand")).toHaveLength(1);
  });

  it("un-stacks on the same line it stacked — deleting back mirrors typing forward", () => {
    // Measured at the one stacked width, the height is a pure function of the draft, so the stack
    // needs no hysteresis band: the threshold that engages it is the threshold that releases it.
    mount(LineComposer);
    act(() => {
      addStaged({ localId: "photo.png", name: "photo.png", kind: "image", status: "staged" });
    });
    draftAt(4); // 88 ≥ 77 — stacked
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
    draftAt(3); // 66 < 77 — released at once; the wrapper stays, only its shape changes
    expect(document.querySelector(".line-cluster.stack")).toBeNull();
    expect(cluster()).not.toBeNull();
    draftAt(4); // …and typing forward again re-stacks on the very same line
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
  });

  it("a LONE button never stacks — there is no lane to free — and the pair forms when send joins", () => {
    mount(LineComposer);
    // A rail whose one file is still UPLOADING + a whitespace draft: nothing is sendable, so the
    // trailing cluster is the mic alone, and a 4-line field (88px) leaves it in the row.
    act(() => {
      addStaged({ localId: "up", name: "up.png", kind: "image", status: "uploading" });
    });
    act(() => {
      content = 4 * LINE_PX;
      setDraft("\n\n\n\n"); // renders as lines, trims to nothing — `sendable` stays false
    });
    expect(document.querySelector(".line-cluster.stack")).toBeNull();
    // The upload lands: send joins, the pair needs 78 — and 88px paints that, so it stacks at once.
    act(() => {
      updateStaged("up", { status: "staged", attachmentId: "id-9" });
    });
    expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
  });

  // THE OWNER'S JUMPING BUTTONS (2026-09-30): the stack decision must be read at the STACKED width.
  // jsdom lays nothing out, so the width-dependent wrap is stubbed off the one observable the probe
  // leaves: while the hook measures at the stacked width, the field carries an inline width.
  function wrapByWidth(rowLines: number, stackedLines: number) {
    Object.defineProperty(field(), "scrollHeight", {
      configurable: true,
      get: () =>
        (field().style.width !== "" || document.querySelector(".line-cluster.stack")
          ? stackedLines
          : rowLines) * LINE_PX,
    });
  }
  const stagedRail = () =>
    act(() => {
      addStaged({
        localId: "p",
        name: "p.png",
        kind: "image",
        status: "staged",
        attachmentId: "a",
      });
    });

  it("a draft that only fills the column at the ROW width never stacks — no per-keystroke flip", () => {
    // The reproduced geometry: in the row the draft paints 4 lines (88 ≥ the pair's 77), but at the
    // stacked width it re-wraps to 2 (44). Deciding off the current width stacked it, re-wrapped,
    // released it on the next keystroke, re-stacked on the one after — for a whole line of typing.
    mount(LineComposer);
    stagedRail();
    wrapByWidth(4, 2);
    for (const draft of [
      "boundary draft",
      "boundary draft,",
      "boundary draft, e",
      "boundary draft, ed",
    ]) {
      act(() => setDraft(draft));
      expect(document.querySelector(".line-cluster.stack")).toBeNull();
    }
  });

  it("…and one that fills it at the stacked width stacks once and STAYS across keystrokes", () => {
    mount(LineComposer);
    stagedRail();
    wrapByWidth(5, 4); // 88 at the stacked width ≥ 77
    for (const draft of ["long draft", "long draft,", "long draft, e", "long draft, ed"]) {
      act(() => setDraft(draft));
      expect(document.querySelector(".line-cluster.stack")).not.toBeNull();
    }
  });

  it("the stacked and sheet layouts have no cluster at all — this is the line pill's geometry", () => {
    mount(KitComposer);
    expect(cluster()).toBeNull();
    cleanup();
    mount(SheetComposer);
    expect(cluster()).toBeNull();
  });
});
