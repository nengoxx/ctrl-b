import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// kit/composer/useComposerChrome · THE CARET ACROSS A STREAMING PHRASE (Phase 24 / S2.5, R70 §5).
//
// R70 flagged the hazard [U] — reasoned, not measured — and the BUILD measured it in a real engine:
// `e2e/micGesture.spec.ts`'s PROBE drives the built app in Chromium and records the collapse (caret 5
// → the end of the new value). jsdom reproduces the same mechanism (the HTML value setter moves the
// text entry cursor to the end whenever the value differs), which is what makes these arms honest here
// rather than only in the e2e.
//
// The seam under test is the ONE textarea all three kit variants share. What it must do, and the two
// halves are equally load-bearing: restore a caret that was INSIDE the draft, and NOT interfere with
// anything else — a restore on an ordinary keystroke would fight the owner's typing one character
// behind, which is exactly why the gate is the streaming APPEND COUNTER and not "is a session live".

const h = vi.hoisted(() => ({ appends: 0 }));

// `dictationAppends` is the gate; the rest of the recorder is irrelevant to a caret.
vi.mock("../../src/hooks/useDictation", () => ({
  dictationAppends: () => h.appends,
}));

import { useComposerChrome } from "../../src/theme-engine/kit/composer/useComposerChrome";
import { appendDraft, clearDraft, setDraft, useDraft } from "../../src/store/composer";

/** The composer's field, exactly as the three variants render it: CONTROLLED off the draft store. */
function Field() {
  const ta = useRef<HTMLTextAreaElement>(null);
  const draft = useDraft();
  useComposerChrome(ta, draft, () => {});
  return (
    <textarea ref={ta} id="cmd-input" value={draft} onChange={(e) => setDraft(e.target.value)} />
  );
}

const field = (): HTMLTextAreaElement => document.querySelector<HTMLTextAreaElement>("#cmd-input")!;

/** Put the caret where the owner left it, and let the seam's listeners see it happen. */
function caretAt(at: number): void {
  const ta = field();
  ta.focus();
  ta.setSelectionRange(at, at);
  ta.dispatchEvent(new Event("keyup", { bubbles: true }));
}

/** A phrase lands from the ear — the store write plus the counter that says whose commit this is. */
function landPhrase(text: string): void {
  act(() => {
    h.appends += 1;
    appendDraft(text);
  });
}

beforeEach(() => {
  h.appends = 0;
  clearDraft();
});
afterEach(cleanup);

describe("the caret across a streaming phrase (R70 §5)", () => {
  it("jsdom reproduces the hazard the e2e measured: a controlled re-assign collapses the selection", () => {
    // Stated FIRST, and directly: without it every arm below could pass vacuously on an engine that
    // never collapsed anything. This is the same operation React performs on a controlled field.
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.value = "hello world";
    ta.focus();
    ta.setSelectionRange(5, 5);
    ta.value = "hello world and more";
    expect(ta.selectionStart).toBe("hello world and more".length);
    ta.remove();
  });

  it("restores a caret that was INSIDE the draft when a phrase lands", () => {
    render(<Field />);
    act(() => setDraft("hello world"));
    caretAt(5);
    landPhrase("spoken words");
    expect(field().value).toBe("hello world spoken words");
    expect(field().selectionStart).toBe(5);
    expect(field().selectionEnd).toBe(5);
  });

  it("…and a SELECTION, both ends of it", () => {
    render(<Field />);
    act(() => setDraft("hello world"));
    const ta = field();
    ta.focus();
    ta.setSelectionRange(6, 11); // "world", mid-edit
    ta.dispatchEvent(new Event("select", { bubbles: true }));
    landPhrase("spoken words");
    expect([field().selectionStart, field().selectionEnd]).toEqual([6, 11]);
  });

  it("a caret at the END rides forward with the new words rather than being pinned behind them", () => {
    render(<Field />);
    act(() => setDraft("hello world"));
    caretAt("hello world".length);
    landPhrase("spoken words");
    // Restoring here would park the caret BEFORE the phrase that just landed — the owner was typing
    // at the end, and the end is where the next thing they type belongs.
    expect(field().selectionStart).toBe("hello world spoken words".length);
  });

  it("an UNFOCUSED field is never focused — a locked-mode owner may be deliberately elsewhere", () => {
    render(<Field />);
    act(() => setDraft("hello world"));
    caretAt(5);
    field().blur();
    landPhrase("spoken words");
    expect(document.activeElement).not.toBe(field());
  });

  it("THE GATE: an ordinary keystroke is NOT a landing, so typing is never fought", () => {
    // The red-proof for the counter. With an "is a session live" flag instead, this commit would look
    // exactly like a phrase landing and the caret would be dragged back to the last snapshot — one
    // character behind every keystroke, for the whole session.
    render(<Field />);
    act(() => setDraft("hello world"));
    caretAt(5);
    // …the owner then TYPES. The browser has already placed both the text and the caret by the time
    // React hears about it, and `h.appends` does not move because no ear said anything — so the commit
    // must leave the caret exactly where the typing left it. Dragging it back to the stale snapshot is
    // what an "is a session live" gate would do, once per keystroke, for the whole session.
    fireEvent.change(field(), { target: { value: "hello world typed" } });
    expect(field().value).toBe("hello world typed");
    expect(field().selectionStart).toBe("hello world typed".length);
    expect(field().selectionStart).not.toBe(5); // …and emphatically not the snapshot
  });

  it("…and neither is a landing while the owner has not touched the field at all", () => {
    render(<Field />);
    act(() => setDraft("hello world"));
    // No focus, no snapshot ever taken — there is nothing to restore and nothing to steal.
    landPhrase("spoken words");
    expect(field().value).toBe("hello world spoken words");
    expect(document.activeElement).not.toBe(field());
  });
});
