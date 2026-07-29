import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { mergeComposerSlots } from "../../src/theme-engine/kit/composer/mergeSlots";
import type { ComposerSlots } from "../../src/theme-engine/kit/composer/types";

// A6 — the composer slot MERGE (D30). Until A6 DefaultRoot PICKED one addon source and silently dropped a
// theme-passed `composerSlots` whenever the plan was inline (a documented limitation); the tools/skills menu
// is the second contributor, so the pick became this merge. What must hold: argument ORDER is the row order
// (first source = leading edge), `undefined` sources vanish, and both slots stack independently.

afterEach(cleanup);

const slots = (id: string, which: "both" | "controls" | "overlay" = "both"): ComposerSlots => ({
  ...(which === "overlay" ? {} : { controlsStart: <b data-testid={`c-${id}`}>{id}</b> }),
  ...(which === "controls" ? {} : { overlay: <i data-testid={`o-${id}`}>{id}</i> }),
});

/** The rendered text of each slot, in DOM order — the observable the variants actually lay out. */
function order(merged: ComposerSlots) {
  const { container } = render(
    <>
      <div id="cs">{merged.controlsStart}</div>
      <div id="ov">{merged.overlay}</div>
    </>,
  );
  const read = (sel: string) =>
    Array.from(container.querySelectorAll(`#${sel} > *`)).map((n) => n.textContent);
  return { controlsStart: read("cs"), overlay: read("ov") };
}

describe("mergeComposerSlots (A6)", () => {
  it("fragments controlsStart in ARGUMENT order — the first source leads the row", () => {
    const merged = mergeComposerSlots(slots("menu"), slots("plan"), slots("theme"));
    expect(order(merged).controlsStart).toEqual(["menu", "plan", "theme"]);
  });

  it("stacks overlays in the same order, independently of controlsStart", () => {
    const merged = mergeComposerSlots(slots("menu"), slots("plan"));
    expect(order(merged).overlay).toEqual(["menu", "plan"]);
  });

  it("skips `undefined` sources (the `inline ? planSlots : undefined` call shape)", () => {
    const merged = mergeComposerSlots(slots("menu"), undefined, slots("theme"));
    expect(order(merged).controlsStart).toEqual(["menu", "theme"]);
    expect(order(merged).overlay).toEqual(["menu", "theme"]);
  });

  it("a source may contribute to just ONE slot", () => {
    const merged = mergeComposerSlots(slots("menu"), slots("pill", "controls"));
    expect(order(merged).controlsStart).toEqual(["menu", "pill"]);
    expect(order(merged).overlay).toEqual(["menu"]);
  });

  it("no contributions → `undefined`, so a variant's `{controlsStart && …}` wrapper gate still collapses", () => {
    expect(mergeComposerSlots(undefined, {})).toEqual({
      controlsStart: undefined,
      overlay: undefined,
    });
  });

  // Codex, round 2 — the merge used to return the BARE node for a single contributor and a keyed fragment
  // for several, so the slot's element TYPE depended on how many sources happened to contribute: flipping
  // the plan placement (or swapping a theme) changed the cardinality and React REMOUNTED the surviving
  // contributions, dropping their state. One shape now, keyed by ARGUMENT position so a source dropping
  // out doesn't renumber its neighbours.
  it("a cardinality change does NOT remount the SURVIVING contribution", () => {
    let mounts = 0;
    const Probe = () => {
      useEffect(() => {
        mounts++;
      }, []);
      return <b>menu</b>;
    };
    // exactly DefaultRoot's call shape: menu · (plan only when inline) · the theme's own slots
    const merge = (inline: boolean) =>
      mergeComposerSlots(
        { controlsStart: <Probe /> },
        inline ? slots("plan") : undefined,
        slots("theme"),
      );
    const { rerender } = render(<div id="cs">{merge(true).controlsStart}</div>);
    expect(mounts).toBe(1);
    rerender(<div id="cs">{merge(false).controlsStart}</div>); // the plan goes pinned → 3 sources → 2
    expect(mounts).toBe(1); // the menu survived the drop with its instance intact
    rerender(<div id="cs">{merge(true).controlsStart}</div>);
    expect(mounts).toBe(1); // …and back again
  });

  it("a single contribution renders no wrapper DOM (the `:empty` collapse still sees a bare row)", () => {
    const merged = mergeComposerSlots(undefined, slots("menu"));
    const { container } = render(<div id="cs">{merged.controlsStart}</div>);
    // a Fragment emits nothing, so the slot's child is still the contribution itself
    expect(container.querySelector("#cs")?.children.length).toBe(1);
    expect(container.querySelector("#cs > b")?.textContent).toBe("menu");
  });
});
