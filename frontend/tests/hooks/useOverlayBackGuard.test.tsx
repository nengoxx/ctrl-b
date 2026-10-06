import { render, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
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
//  ③ A STACK, with identity (her S2 review #5). Overlays nest, `popstate` fires on every listener, and
//     one pop consumes exactly ONE entry — the innermost one's. So only the TOP owner may close, or
//     Back takes the outer overlay away and leaves the inner one stranded on top of nothing.
//  ④ CLOSE IS IDEMPOTENT while its pop is in flight (her confirm round). Closing is asynchronous and
//     the overlay stays mounted until the pop lands, so a second gesture in that window used to spend
//     a SECOND history entry — the first pop closed the overlay and the second was a real navigation
//     out of the app. The first exit wins, and `close()` says so to its caller.
//  ⑤ The optional `onBack` VETO (ISS-53 — Android's `OnBackPressedCallback` shape): a Back that reaches
//     an entry whose owner gave `onBack` RE-ARMS the entry and asks the owner, who leaves through its
//     own `close()` or stays. A `close()` is already a decision and never reaches `onBack`.

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

/** A host whose owner VETOES Back (the automation sheet's shape): every Back is reported to `onBack`,
 *  which may then call the guard's closer through the `leave` button — or not. */
function VetoHost({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const [open, setOpen] = useState(true);
  const close = useOverlayBackGuard(
    open,
    () => {
      setOpen(false);
      onClose();
    },
    onBack,
  );
  return (
    <div>
      {open && (
        <button type="button" onClick={close}>
          leave
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

/** ONE tree's close button. Scoped to its own container, because two nested overlays put two of them
 *  in the document and RTL's top-level queries search all of it. */
const closer = (view: ReturnType<typeof render>) =>
  within(view.container).queryByRole("button", { name: "close" });

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

  it("a SECOND close before the pop lands is a no-op — one gesture, one entry", async () => {
    const onClose = vi.fn();
    const before = history.length;
    const view = render(<Host onClose={onClose} />);
    await waitFor(() => expect(ours()).toBe(true));

    // Two taps inside the async window. The second must not spend another entry: with the overlay
    // still mounted, the extra `history.back()` navigated the app itself.
    closer(view)!.click();
    closer(view)!.click();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(ours()).toBe(false);
    expect(history.length).toBeLessThanOrEqual(before + 1);
  });

  it("…and it SAYS which gesture took the exit — how a caller knows whose answer to record", async () => {
    // ConfirmDialog records its answer only on `true`: the second gesture came too late to decide
    // anything, and letting it write would turn a confirmation into a cancellation (or the reverse).
    const took: boolean[] = [];
    function Reporter() {
      const close = useOverlayBackGuard(true, () => undefined);
      return (
        <button type="button" onClick={() => took.push(close())}>
          close
        </button>
      );
    }
    const view = render(<Reporter />);
    await waitFor(() => expect(ours()).toBe(true));
    closer(view)!.click();
    closer(view)!.click();
    expect(took).toEqual([true, false]);
  });

  it("survives a setup → cleanup → setup cycle in ONE task — one entry, no reclamation", async () => {
    // StrictMode IS the arm: it double-invokes every effect in development, which is the shape React's
    // contract permits everywhere. Before the deferred push this cost a push, a pending `history.back()`
    // and a second push — after which the browser sat one entry BELOW what the module believed, so the
    // ✕ traversed past the app's own entry. On the dev server that meant `about:blank`, with the whole
    // tab gone, on every single gallery close.
    const push = vi.spyOn(history, "pushState");
    const back = vi.spyOn(history, "back");
    const onClose = vi.fn();
    const before = history.length;
    const view = render(
      <StrictMode>
        <Host onClose={onClose} />
      </StrictMode>,
    );
    await waitFor(() => expect(ours()).toBe(true));
    // The claim: the whole cycle costs exactly ONE entry and NO reclaiming traversal.
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(history.length).toBe(before + 1);

    // …and the exit is the ordinary one: one back, one close, the entry spent rather than piled on.
    // Asserted on THIS entry's id rather than on `ours()`: an earlier case in this file may still be
    // sitting on an overlay entry of its own, and going back onto it is correct — what must not
    // survive is the entry this cycle pushed.
    const pushedId = (push.mock.calls[0][0] as { id: number }).id;
    closer(view)!.click();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(back).toHaveBeenCalledTimes(1);
    expect((history.state as { id?: number } | null)?.id).not.toBe(pushedId);
    expect(history.length).toBeLessThanOrEqual(before + 1);
  });

  it("NESTED: one Back closes the TOP overlay and leaves the one under it standing", async () => {
    // The regression this pins is the one Emma found: with a single shared listener every guard reacted
    // to every pop, so Back over the gallery's delete confirm unmounted the GALLERY and left the alert
    // dialog on screen — holding a promise nobody could reach and a captured trigger that was gone.
    const outer = vi.fn();
    const inner = vi.fn();
    const view = render(<Host onClose={outer} />);
    await waitFor(() => expect(ours()).toBe(true));
    const nested = render(<Host onClose={inner} />);
    await waitFor(() => expect(closer(nested)).not.toBeNull());

    history.back();
    await waitFor(() => expect(inner).toHaveBeenCalledTimes(1));
    expect(outer).not.toHaveBeenCalled(); // …and the gallery is still open behind it
    expect(closer(view)).not.toBeNull();

    // …and the NEXT Back closes the one underneath, having spent its own entry and no one else's.
    history.back();
    await waitFor(() => expect(outer).toHaveBeenCalledTimes(1));
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("…and an inner overlay's own close spends only the inner entry", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const view = render(<Host onClose={outer} />);
    await waitFor(() => expect(ours()).toBe(true));
    const nested = render(<Host onClose={inner} />);
    await waitFor(() => expect(closer(nested)).not.toBeNull());

    closer(nested)!.click();
    await waitFor(() => expect(inner).toHaveBeenCalledTimes(1));
    expect(outer).not.toHaveBeenCalled();
    // The OUTER guard's entry is the one the browser is sitting on again — its own close still works.
    closer(view)!.click();
    await waitFor(() => expect(outer).toHaveBeenCalledTimes(1));
  });

  it("an inner UNMOUNT does not hand its pop to the guard underneath", async () => {
    // The swallow has to be shared: the unmounting guard has already removed its listener, so a
    // per-instance flag would let the one below read itself as the top and close for nothing.
    const outer = vi.fn();
    render(<Host onClose={outer} />);
    await waitFor(() => expect(ours()).toBe(true));
    const nested = render(<Host onClose={() => undefined} />);
    await waitFor(() => expect(closer(nested)).not.toBeNull());

    nested.unmount();
    await waitFor(() => expect(ours()).toBe(true)); // back on the outer overlay's own entry
    await new Promise((r) => setTimeout(r, 10));
    expect(outer).not.toHaveBeenCalled();
  });

  it("onBack VETOES: Back re-arms the entry, the overlay stays, and the owner is asked", async () => {
    const onClose = vi.fn();
    const onBack = vi.fn();
    const view = render(<VetoHost onClose={onClose} onBack={onBack} />);
    await waitFor(() => expect(ours()).toBe(true));
    const id = (history.state as { id: number }).id;

    history.back();
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(view.container).getByText("leave")).toBeTruthy(); // still mounted
    // …and the entry is OURS again — same id — so the NEXT Back is still the overlay's to judge.
    expect((history.state as { id?: number } | null)?.id).toBe(id);
    history.back();
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(2));
    expect(onClose).not.toHaveBeenCalled();
    expect((history.state as { id?: number } | null)?.id).toBe(id);
    view.unmount();
    await waitFor(() => expect((history.state as { id?: number } | null)?.id).not.toBe(id));
  });

  it("onBack → close() spends exactly ONE entry", async () => {
    // The owner decides to leave (a clean sheet, or "discard"): its own closer is the way out.
    const onClose = vi.fn();
    function Leaver() {
      const [open, setOpen] = useState(true);
      // `onBack` is handed the guard's own closer — the same function the hook returns.
      useOverlayBackGuard(
        open,
        () => {
          setOpen(false);
          onClose();
        },
        (close) => close(),
      );
      return <div>{open && <span>up</span>}</div>;
    }
    const before = history.length;
    const view = render(<Leaver />);
    await waitFor(() => expect(ours()).toBe(true));
    const id = (history.state as { id: number }).id;

    history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(within(view.container).queryByText("up")).toBeNull();
    // The re-push was spent by the owner's close, and nothing else: the browser is back BELOW the
    // overlay's entry, and the stack did not grow past the one slot the overlay held.
    expect((history.state as { id?: number } | null)?.id).not.toBe(id);
    expect(history.length).toBeLessThanOrEqual(before + 1);
  });

  it("a close() call NEVER reaches onBack — a close is already a decision", async () => {
    const onClose = vi.fn();
    const onBack = vi.fn();
    const view = render(<VetoHost onClose={onClose} onBack={onBack} />);
    await waitFor(() => expect(ours()).toBe(true));

    within(view.container).getByText("leave").click();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onBack).not.toHaveBeenCalled();
  });

  it("NESTED: the outer onBack is never consulted while an inner entry sits on top", async () => {
    const outerBack = vi.fn();
    const outerClose = vi.fn();
    const inner = vi.fn();
    const outer = render(<VetoHost onClose={outerClose} onBack={outerBack} />);
    await waitFor(() => expect(ours()).toBe(true));
    const nested = render(<Host onClose={inner} />);
    await waitFor(() => expect(closer(nested)).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));

    history.back();
    await waitFor(() => expect(inner).toHaveBeenCalledTimes(1));
    expect(outerBack).not.toHaveBeenCalled(); // the pop was the INNER entry's
    expect(outerClose).not.toHaveBeenCalled();

    // …and once the inner is gone, the outer's veto is what the next Back reaches.
    history.back();
    await waitFor(() => expect(outerBack).toHaveBeenCalledTimes(1));
    expect(outerClose).not.toHaveBeenCalled();
    outer.unmount();
  });
});
