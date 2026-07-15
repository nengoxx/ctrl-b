import { render } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import { useScrollKeep } from "../../src/theme-engine/scrollKeep";

// Gate B scroll-keep (2026-07-15) — the one-hop save/restore handoff across a theme-Root remount.
// jsdom has no layout, but `scrollTop` is a settable property, which is all the module touches.

/** A minimal Root stand-in: a scroller + the hook, exposing the skip-ref + scroller node to the test. */
function Probe({ out }: { out: { restored?: RefObject<boolean>; el?: HTMLDivElement | null } }) {
  const ref = useRef<HTMLDivElement>(null);
  out.restored = useScrollKeep(ref);
  return (
    <div
      ref={(node) => {
        ref.current = node;
        out.el = node;
      }}
    />
  );
}

describe("useScrollKeep", () => {
  it("saves scrollTop on unmount and restores it on the next mount, flagging the skip-ref", () => {
    const a: { restored?: RefObject<boolean>; el?: HTMLDivElement | null } = {};
    const first = render(<Probe out={a} />);
    expect(a.restored!.current).toBe(false); // nothing pending on a cold mount
    a.el!.scrollTop = 137;
    first.unmount(); // the old Root leaves → position saved

    const b: { restored?: RefObject<boolean>; el?: HTMLDivElement | null } = {};
    const second = render(<Probe out={b} />);
    expect(b.el!.scrollTop).toBe(137); // the new Root mounts restored
    expect(b.restored!.current).toBe(true); // …and the reset effect gets its one-run skip signal
    second.unmount();
  });

  it("consumes the saved position — a later mount with none pending starts clean", () => {
    // the previous test's final unmount saved scrollTop 137 → drain it first
    const drain: { restored?: RefObject<boolean>; el?: HTMLDivElement | null } = {};
    render(<Probe out={drain} />).unmount();

    // that unmount re-saved (137 again) — so mount/consume/reset-to-0 before the real assertion
    const reset: { restored?: RefObject<boolean>; el?: HTMLDivElement | null } = {};
    const r = render(<Probe out={reset} />);
    reset.el!.scrollTop = 0;
    r.unmount(); // saves 0

    const clean: { restored?: RefObject<boolean>; el?: HTMLDivElement | null } = {};
    render(<Probe out={clean} />);
    expect(clean.el!.scrollTop).toBe(0);
  });
});
