import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toasts } from "../../src/components/Toasts";
import { dismissToast, pushToast, useToasts } from "../../src/store/toast";

// components/Toasts — the host's action contract (F26 + ISS-84): an action runs and dismisses its toast
// UNLESS it answers `false` (a refused Retry keeps the clip it holds); a `secondary` pill renders beside
// the first with the same contract; a `persist` toast ignores the body tap that dismisses every other.

afterEach(() => {
  cleanup();
  // the store is a module singleton: drop whatever a case left standing (persist toasts never expire)
  const { result, unmount } = renderHook(() => useToasts());
  act(() => result.current.forEach((t) => dismissToast(t.id)));
  unmount();
});

describe("Toasts host", () => {
  it("an action answering `false` KEEPS its toast; any other answer dismisses it", () => {
    let keep = true;
    const onClick = vi.fn(() => (keep ? false : undefined));
    render(<Toasts />);
    act(() => pushToast("held", "err", { persist: true, action: { label: "Retry", onClick } }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("held")).not.toBeNull(); // refused → still there
    keep = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByText("held")).toBeNull();
  });

  it("renders the SECONDARY pill beside the first, and it dismisses like any action", () => {
    const discard = vi.fn();
    render(<Toasts />);
    act(() =>
      pushToast("two choices", "err", {
        persist: true,
        action: { label: "Retry", onClick: () => false },
        secondary: { label: "Discard", onClick: discard },
      }),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("two choices")).toBeNull();
  });

  it("a `persist` toast ignores the body tap; an ordinary one is dismissed by it", () => {
    render(<Toasts />);
    act(() => {
      pushToast("stays", "err", { persist: true, action: { label: "Go", onClick: () => {} } });
      pushToast("goes", "info", { sticky: true });
    });
    fireEvent.click(screen.getByText("stays"));
    fireEvent.click(screen.getByText("goes"));
    expect(screen.queryByText("stays")).not.toBeNull();
    expect(screen.queryByText("goes")).toBeNull();
  });
});
