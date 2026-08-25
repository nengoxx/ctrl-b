import { render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useOverlayBackGuard } from "../../src/hooks/useOverlayBackGuard";

// The Android-Back guard (MEDIA_MANAGER_PLAN §6.2, Emma #5). Two properties, and both are about the
// HISTORY STACK rather than about React:
//
//  ① ONE CLOSER. The ✕/Escape path must not close the overlay itself — it asks the browser to go back,
//     and the `popstate` handler is what closes. Otherwise every open/close pair leaks an entry and the
//     owner has to press Back five times to leave the app (the orphan-entry regression).
//  ② The entry is CONSUMED exactly once, whoever spends it: the owner's gesture, the ✕, or an unmount
//     while the overlay is still open.

/** A minimal host: renders while `open`, and reports every close the hook delivers. */
function Host({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const close = useOverlayBackGuard(open, () => {
    setOpen(false);
    onClose();
  });
  return (
    <div>
      {open && (
        <button type="button" onClick={close}>
          close
        </button>
      )}
    </div>
  );
}

/** Whether OUR entry is the one the browser is sitting on. `history.length` is the wrong instrument:
 *  `back()` moves the pointer without shortening the stack, and a `pushState` from the new position
 *  truncates whatever was ahead — so the leak this hook prevents shows up as the stack GROWING across
 *  open/close cycles, not as a length that fails to shrink. Both are asserted below. */
const ours = () => (history.state as { ctrlbOverlay?: boolean } | null)?.ctrlbOverlay === true;

describe("useOverlayBackGuard", () => {
  it("pushes exactly ONE entry while open, and the ✕ spends it", async () => {
    const onClose = vi.fn();
    const before = history.length;
    const { getByText, queryByText } = render(<Host onClose={onClose} />);
    await waitFor(() => expect(ours()).toBe(true));
    expect(history.length).toBe(before + 1);

    getByText("close").click();
    // The click does NOT close on its own — `history.back()` is asynchronous, and the popstate handler
    // is the only closer. This is the regression arm: a UI path that closed directly would leave the
    // entry behind.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(queryByText("close")).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ours()).toBe(false); // the entry was SPENT, not left behind
  });

  it("the owner's own BACK gesture closes it, once", async () => {
    const onClose = vi.fn();
    const { queryByText } = render(<Host onClose={onClose} />);
    await waitFor(() => expect(ours()).toBe(true));

    history.back();
    await waitFor(() => expect(queryByText("close")).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ours()).toBe(false);
  });

  it("an UNMOUNT while open consumes the entry rather than orphaning it", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<Host onClose={onClose} />);
    await waitFor(() => expect(ours()).toBe(true));

    unmount();
    await waitFor(() => expect(ours()).toBe(false));
    // …and the close it triggers is swallowed: whatever removed the overlay already did the closing.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("open · close · open leaves no pile — the property a leak would show up as", async () => {
    const before = history.length;
    for (let i = 0; i < 3; i++) {
      const view = render(<Host onClose={() => undefined} />);
      await waitFor(() => expect(ours()).toBe(true));
      view.getByText("close").click();
      await waitFor(() => expect(ours()).toBe(false));
      view.unmount();
    }
    // ONE slot, reused three times: each open pushes from the position the last close returned to, so
    // it TRUNCATES rather than piles. A UI path that closed without spending its entry would have
    // grown the stack by three — the shape the owner meets as "Back does nothing five times".
    expect(history.length).toBeLessThanOrEqual(before + 1);
  });
});
