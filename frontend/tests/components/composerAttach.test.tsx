import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE COMPOSER'S ATTACHMENT CHROME (D68 S3 / ATTACHMENTS_PLAN §7) — driven through the REAL variants,
// because the whole subject is PLACEMENT: three layouts, one rail component, and owner-ruled
// geometry in each.
//
// The rulings pinned here (they are rulings, not preferences — re-deriving them is what this file
// exists to prevent):
//   · the RAIL is INSIDE the composer root, ABOVE the input row, in every variant (grammar ②) — which
//     is also what makes `--composer-h` account for it without a second measurement;
//   · the CLIP is present in ALL THREE (the A8 chrome ruling; LineComposer's old "ATTACH — ABSENT"
//     comment is superseded) and has TWO homes since the S6 fix wave (owner finding F1): immediately
//     LEFT of the mic while NOTHING is staged, and the rail's TAIL once something is — the empty
//     composer's placement is unchanged, and the old "always left of the mic" claim is superseded;
//   · the MIC IS NEVER BLOCKED by staged files (owner ruling; R62 fact 4);
//   · the send is HELD while a file is still uploading, and a FAILED chip holds nothing.

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
import { addStaged, clearStaged, type AttachStatus } from "../../src/store/attachments";
import { clearDraft, setDraft } from "../../src/store/composer";

const VARIANTS = [
  ["stacked", KitComposer],
  ["sheet", SheetComposer],
  ["line", LineComposer],
] as const;

function stage(status: AttachStatus = "staged", name = "photo.png") {
  addStaged({
    localId: name,
    name,
    kind: "image",
    status,
    attachmentId: status === "staged" ? "id-1" : undefined,
    error:
      status === "failed" ? "that file is 21.0 MB — this app accepts up to 10.0 MB." : undefined,
  });
}

const clip = () => screen.getByRole("button", { name: "attach files" });
// The mic's accessible name is its STATUS sentence (`MIC_LABEL`), and jsdom has no `mediaDevices`, so
// the state under test here is `insecure` ("microphone needs a secure (HTTPS) connection"). Matching
// both spellings keeps this file about attachments rather than about the mic's own state machine.
const mic = () => screen.getByRole("button", { name: /dictation|microphone/i });
const send = () => screen.getByRole("button", { name: "send message" });
const composer = () => document.querySelector("#composer")!;

/** `jest-dom` is not a dependency here (the repo asserts on the DOM directly), so the button gate is
 *  read off the element. */
const disabled = (el: Element): boolean => (el as HTMLButtonElement).disabled;

/** Where two elements sit among their shared parent's children — the placement assertions' currency. */
function orderOf(...nodes: Element[]): number[] {
  const kids = [...nodes[0].parentElement!.children];
  return nodes.map((n) => kids.indexOf(n));
}

beforeEach(() => {
  clearStaged();
  clearDraft();
});
afterEach(() => {
  cleanup();
  clearStaged();
  clearDraft();
});

describe.each(VARIANTS)("%s composer — the attachment chrome", (name, Variant) => {
  it("renders the quiet clip, LEFT of (before) the mic (with an EMPTY rail)", () => {
    render(<Variant />);
    // Document order, not shared-parent order: the line pill wraps its mic/send in the `.line-cluster`
    // (the S6 re-round's stack seam), so the clip and the mic are no longer siblings there — the
    // ruled property is only that the clip comes FIRST.
    expect(clip().compareDocumentPosition(mic()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Quiet by ruling: the `.kit-cbtn` chassis with the `attach` modifier that drops its ring — never
    // the accent-filled `.kit-send` treatment.
    expect(clip().className).toContain("kit-cbtn attach");
  });

  it("the rail rides INSIDE the composer root, above the input row", () => {
    stage();
    render(<Variant />);
    const rail = document.querySelector(".kit-attach-rail")!;
    expect(composer().contains(rail)).toBe(true);
    // The row the rail must sit above, per layout: the stacked field, the docked row, or the line
    // pill's own `.line-row` (since the S5 fix wave that row is an element — MED-1 — rather than the
    // root itself wrapping the rail onto a flex line of its own).
    const row =
      composer().querySelector(".sheet-row") ??
      composer().querySelector(".line-row") ??
      composer().querySelector(".field")!;
    expect(rail.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("one chip per staged file, each with its own remove control", () => {
    stage("staged", "a.png");
    stage("staged", "b.png");
    render(<Variant />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "remove a.png" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "remove b.png" })).not.toBeNull();
  });

  it("removing a chip drops it from the rail", () => {
    stage("staged", "a.png");
    render(<Variant />);
    fireEvent.click(screen.getByRole("button", { name: "remove a.png" }));
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(document.querySelector(".kit-attach-rail")).toBeNull(); // nothing staged → no rail at all
  });

  it("THE MIC IS NEVER BLOCKED by staged files (owner ruling)", () => {
    stage();
    render(<Variant />);
    expect(disabled(mic())).toBe(false);
  });

  it("the send is HELD while a file is still uploading", () => {
    stage("uploading");
    // With a caption typed, so all three variants render a send to hold: an upload in flight is not
    // yet something to send (MED-5), so the line variant shows no button at all without text.
    setDraft("look at this");
    render(<Variant />);
    expect(disabled(send())).toBe(true);
  });

  it("…and a FAILED chip holds nothing — it names its refusal and gets out of the way", () => {
    stage("failed");
    // With a typed draft, because a failed chip must neither block a send nor be one (MED-5): the
    // line variant now renders no send at all for a rail that holds only refusals (below).
    setDraft("send this anyway");
    render(<Variant />);
    expect(disabled(send())).toBe(false);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("this app accepts up to 10.0 MB");
  });

  it("a chip a send has RESERVED wears the busy face and cannot be removed (MED-1)", () => {
    stage("sending");
    render(<Variant />);
    // Its id is already named on a POST — removing the chip could not un-send it.
    expect(screen.queryByRole("button", { name: "remove photo.png" })).toBeNull();
    expect(document.querySelector(".kit-attach-busy")).not.toBeNull();
  });

  it("an empty draft with a staged file can still be sent (the attachment-only gesture)", () => {
    stage();
    render(<Variant />);
    // The line variant is the one that HIDES send at rest (mic alone), so this is where the gate
    // actually changed; the other two always render it, and the pin is that all three agree.
    expect(disabled(send())).toBe(false);
  });
});

// THE S6 FIX WAVE, owner finding F1 (the phone round): with files staged the clip was costing the TEXT
// FIELD horizontal space in every layout — worst in the line pill, which has the least to give. It moves
// onto the rail's right edge, "right above the send button" (owner). The property that makes this safe is
// the one pinned hardest below: EXACTLY ONE clip and EXACTLY ONE hidden picker are mounted at any moment,
// so `useAttachments`'s ref can never point at a stale input and a pick can never be lost.
describe.each(VARIANTS)(
  "%s composer — the staged CLIP moves to the rail's tail (S6/F1)",
  (name, Variant) => {
    const tail = () => document.querySelector(".kit-attach-tail")!;

    it("mounts exactly one clip and one picker, both inside the tail", () => {
      stage();
      render(<Variant />);
      expect(document.querySelectorAll(".kit-cbtn.attach")).toHaveLength(1);
      expect(document.querySelectorAll("input[type=file]")).toHaveLength(1);
      expect(tail().contains(clip())).toBe(true);
      expect(tail().contains(document.querySelector("input[type=file]"))).toBe(true);
    });

    it("…and it has LEFT the field/controls row it holds when nothing is staged", () => {
      stage();
      render(<Variant />);
      // The layout's own ruled spot: the stacked controls row, the docked field, the line pill's row.
      const home =
        document.querySelector(".crow") ??
        document.querySelector(".kit-composer.sheet .field") ??
        document.querySelector(".line-row")!;
      expect(home.contains(clip())).toBe(false);
      expect(clip().parentElement).toBe(tail());
    });

    it("the tail rides the RAIL, beside the chips' scroller — never inside it", () => {
      stage();
      render(<Variant />);
      const rail = document.querySelector(".kit-attach-rail")!;
      const scroll = document.querySelector(".kit-attach-scroll")!;
      expect(rail.contains(tail())).toBe(true);
      expect(scroll.contains(tail())).toBe(false);
      expect(scroll.getAttribute("aria-label")).toBe("attached files");
    });

    it("removing the last chip hands the clip back to the layout's own spot", () => {
      stage("staged", "a.png");
      render(<Variant />);
      fireEvent.click(screen.getByRole("button", { name: "remove a.png" }));
      expect(document.querySelector(".kit-attach-tail")).toBeNull();
      expect(document.querySelectorAll(".kit-cbtn.attach")).toHaveLength(1);
      expect(document.querySelectorAll("input[type=file]")).toHaveLength(1);
    });
  },
);

// MED-5 — sendability derives from READY rows only. The line variant is where this is VISIBLE (it is
// the one that hides send at rest), and a send that could only ever post an empty message is worse
// than no send at all: it is a button that does nothing.
describe("sendability is ready-only (MED-5)", () => {
  it("a rail holding only a FAILED chip does not arm the line variant's send", () => {
    stage("failed");
    render(<LineComposer />);
    expect(screen.queryByRole("button", { name: "send message" })).toBeNull();
  });

  it("…nor does one holding only a chip that is still uploading, or one already reserved", () => {
    stage("uploading", "a.png");
    stage("sending", "b.png");
    render(<LineComposer />);
    expect(screen.queryByRole("button", { name: "send message" })).toBeNull();
  });

  it("one READY chip arms it, with no text at all", () => {
    stage("staged");
    render(<LineComposer />);
    expect(disabled(send())).toBe(false);
  });
});

describe("the layouts' own geometry", () => {
  it("the sheet EMBEDS the clip inside the field, beside the embedded mic (R62 §2.1)", () => {
    render(<SheetComposer />);
    const field = document.querySelector(".kit-composer.sheet .field")!;
    expect(field.contains(clip())).toBe(true);
    expect(field.contains(mic())).toBe(true);
    expect(field.contains(send())).toBe(false); // the tall send stays outside it, as it always was
  });

  it("the line pill keeps the clip in the trailing cluster, out of the plan-pill lane", () => {
    render(<LineComposer controlsStart={<span data-testid="pill" />} />);
    const controls = document.querySelector(".line-controls")!;
    expect(controls.contains(clip())).toBe(false);
    expect(clip().parentElement).toBe(document.querySelector(".line-row"));
  });

  // The S5 fix wave's row wrapper (MED-1) is PURELY structural: it holds exactly what the single row
  // always held, in the same order, and the owner-eyeballed flex geometry moved onto it verbatim. jsdom
  // lays nothing out, so what this pins is the DOM shape that geometry is written against.
  it("the line pill's ROW holds the whole single row, and the bar holds only the row", () => {
    render(<LineComposer controlsStart={<span data-testid="pill" />} />);
    expect([...composer().children].map((el) => el.className)).toEqual(["line-row"]); // nothing staged
    const kids = [...document.querySelector(".line-row")!.children];
    // [plan-pill lane] [field] [the clip's hidden picker + clip] [the trailing cluster] — the resting
    // look with STT up and an empty draft. Since the S6 re-round the mic/send pair lives inside
    // `.line-cluster` (the stack seam), which horizontal is layout-invisible: an unpositioned flex row
    // carrying the row's own gap.
    expect(kids.map((el) => el.tagName.toLowerCase())).toEqual([
      "div",
      "textarea",
      "input",
      "button",
      "div",
    ]);
    expect(kids[0].className).toBe("line-controls");
    expect(kids[2].className).toBe("kit-attach-input");
    expect(kids[3].className).toContain("kit-cbtn attach");
    expect(kids[4].className).toBe("line-cluster");
    expect(kids[4].querySelector(".kit-cbtn.mic.line-btn")).not.toBeNull();
  });

  it("the stacked bar puts it in the controls row, after the slack absorber", () => {
    render(<KitComposer />);
    const crow = document.querySelector(".crow")!;
    expect(crow.contains(clip())).toBe(true);
    const [grow, at] = orderOf(crow.querySelector(".grow")!, clip());
    expect(grow).toBeLessThan(at);
  });
});
