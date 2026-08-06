import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Seg } from "../../src/components/Seg";

// Seg a11y semantics (F5 Gate A5). The segmented control is a labelled `role="group"` with each option a
// button carrying `aria-pressed` for its selected state (Primer/Workday pattern — NOT a radiogroup/tablist,
// so every option stays a tab stop). These lock in the contract axe + the render e2e machine-enforce.

afterEach(cleanup);

const OPTS = [
  { val: "local", label: "Local" },
  { val: "cloud", label: "Cloud" },
];

describe("Seg semantics", () => {
  it("the container is a labelled group", () => {
    const { container } = render(
      <Seg label="Backend" current="local" onPick={() => {}} options={OPTS} />,
    );
    const group = container.querySelector("[role='group']");
    expect(group).toBeTruthy();
    expect(group?.getAttribute("aria-label")).toBe("Backend");
  });

  it("marks exactly the current option aria-pressed", () => {
    const { container } = render(
      <Seg label="Backend" current="cloud" onPick={() => {}} options={OPTS} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });
});

// ── The optional `swatch` colour chip (D52 §4.9 ledger, G6 — gacha's dossier picker renders its palettes
//    as chips). The contract the ledger committed has TWO halves, and the second is the one worth a test:
//    a row WITHOUT a swatch must render byte-identically, with no extra DOM node at all. ──
describe("Seg swatch chips (the additive §4.9 slot)", () => {
  it("emits NO extra node when no option carries a swatch", () => {
    const { container } = render(
      <Seg label="Backend" current="local" onPick={() => {}} options={OPTS} />,
    );
    expect(container.querySelectorAll(".seg-chip")).toHaveLength(0);
    // the option's whole content is still just its label
    expect(container.querySelector("button")?.innerHTML).toBe("Local");
  });

  it("renders one aria-hidden chip per option that carries one, painted with its value", () => {
    const { container } = render(
      <Seg
        label="Dossier"
        current="neon"
        onPick={() => {}}
        options={[
          { val: "slip", label: "Slip", swatch: "#f9f8ff" },
          { val: "neon", label: "Neon", swatch: "#511cab" },
        ]}
      />,
    );
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".seg-chip"));
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
    expect(chips.map((c) => c.style.background)).toEqual([
      "rgb(249, 248, 255)",
      "rgb(81, 28, 171)",
    ]);
    // …and the label survives beside it: the chip decorates the option, it does not replace it.
    expect(container.querySelectorAll("button")[1].textContent).toBe("Neon");
  });

  it("a string[] swatch becomes the conic multi-token preview (the shared chipBackground rule)", () => {
    const { container } = render(
      <Seg
        label="Palette"
        current="a"
        onPick={() => {}}
        options={[{ val: "a", label: "A", swatch: ["#ff0000", "#00ff00"] }]}
      />,
    );
    expect(container.querySelector<HTMLElement>(".seg-chip")?.style.background).toContain(
      "conic-gradient",
    );
  });

  it("mixes: only the options that declare a swatch get a chip", () => {
    const { container } = render(
      <Seg
        label="Mixed"
        current="a"
        onPick={() => {}}
        options={[
          { val: "a", label: "A" },
          { val: "b", label: "B", swatch: "#123456" },
        ]}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0].querySelector(".seg-chip")).toBeNull();
    expect(buttons[1].querySelector(".seg-chip")).toBeTruthy();
  });
});
