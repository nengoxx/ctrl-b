import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { requestConfirm } from "../../src/store/confirm";

// The shared confirm host, since it joined `useOverlayBackGuard` (Emma's S2 review #5): the Android
// Back gesture cancels the top-most confirm and leaves whatever is under it standing.
//
// What THIS suite pins is the consequence of that join (her confirm round). Closing is now
// ASYNCHRONOUS — the UI's gesture asks for `history.back()` and the `popstate` handler is the only
// closer — so the dialog stays mounted, focused and listening for a whole task after the owner has
// answered. A second gesture in that window used to rewrite the first one's answer: Enter then Escape
// resolved a cancel on a confirmation already given, and the reverse confirmed a destructive action
// that had just been cancelled. The first exit decision has to win.

afterEach(cleanup);

/** Open a danger confirm and hand back the promise its caller is awaiting. */
async function open(): Promise<{ answer: Promise<boolean>; dialog: HTMLElement }> {
  render(<ConfirmDialog />);
  let answer!: Promise<boolean>;
  act(() => {
    answer = requestConfirm({ title: "Delete a.webp?", confirmLabel: "Delete", danger: true });
  });
  return { answer, dialog: await screen.findByRole("alertdialog") };
}

describe("ConfirmDialog — the FIRST exit decision wins", () => {
  it("Enter then Escape before the pop lands still CONFIRMS", async () => {
    const { answer, dialog } = await open();
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "Escape" }); // too late — a close is already in flight
    expect(await answer).toBe(true);
  });

  it("…and Escape then Enter still CANCELS — the direction that matters on a destructive action", async () => {
    const { answer, dialog } = await open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(await answer).toBe(false);
  });

  it("…and the same for the buttons, including the backdrop's dismiss", async () => {
    const { answer, dialog } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(dialog.parentElement as HTMLElement); // the backdrop's "cancel", one tap late
    expect(await answer).toBe(true);
  });

  it("a plain single answer still resolves, and only once", async () => {
    const { answer, dialog } = await open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(await answer).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
