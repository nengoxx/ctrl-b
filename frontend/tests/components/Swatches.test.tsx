import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Swatches } from "../../src/components/Swatches";
import { chipBackground } from "../../src/lib/chipBackground";
import { gacha } from "../../src/themes/gacha";

// The palette picker's CHIP (D29 §14.4, extended at G6.3). Owner ruling, 2026-08-06 device round: the chip
// is an OVAL showing the palette's gradient AND its flat `--accent`, because a gradient alone previews the
// scenery a palette paints and says nothing about the single hue every switch, ring and fill will take —
// which on gacha's eight variants is exactly what the owner picks between (family 1's three share their
// brand trio by design and differ only in the ramp).
//
// The claims here are the ones a look-alike implementation could get wrong: the accent is composed into the
// ONE background list `chipBackground` owns (not a second element some other control would have to grow
// too), a theme that declares no accent is untouched, and the radiogroup's a11y contract is unchanged by
// any of it.

afterEach(cleanup);

const chip = (c: HTMLElement) => c.querySelector<HTMLElement>(".sw-chip")!;

describe("chipBackground — the shared paint rule, with its optional accent band", () => {
  it("without an accent it is exactly what it always was", () => {
    expect(chipBackground()).toEqual({ background: "var(--surface-2)" });
    expect(chipBackground("#ff6cae")).toEqual({ background: "#ff6cae" });
    expect(chipBackground(["#f00", "#0f0"]).background).toContain("conic-gradient");
  });

  it("with one, the accent is a HARD-STOP layer over the swatch — one background list", () => {
    const { background } = chipBackground("linear-gradient(135deg, #000, #fff)", "#ff6cae");
    // The band's two stops sit at the same position, so there is no transparent→colour interpolation to
    // grey the seam (the classic `transparent` gradient trap).
    expect(background).toBe(
      "linear-gradient(90deg, transparent 0 65%, #ff6cae 65%), linear-gradient(135deg, #000, #fff)",
    );
  });

  it("keeps a plain colour LAST in the list, where the shorthand requires the <color> to sit", () => {
    // `background: <gradient>, <color>` is legal; `<color>, <gradient>` is not, so an accent over a
    // flat-colour palette (minimal's hues) must compose in this order or the whole declaration is dropped.
    expect(chipBackground("#123456", "#ff6cae").background).toBe(
      "linear-gradient(90deg, transparent 0 65%, #ff6cae 65%), #123456",
    );
    expect(chipBackground(undefined, "#ff6cae").background).toMatch(/, var\(--surface-2\)$/);
  });
});

describe("Swatches — the accent rides through, and the a11y contract does not move", () => {
  const options = [
    {
      val: "arcade",
      label: "Arcade",
      swatch: "linear-gradient(135deg, #000, #fff)",
      accent: "#ff6cae",
    },
    { val: "plain", label: "Plain", swatch: "#123456" },
  ];

  it("paints the accent band for the option that declares one, and only for it", () => {
    const { container } = render(
      <Swatches current="arcade" options={options} onPick={() => {}} ariaLabel="Palette" />,
    );
    const chips = container.querySelectorAll<HTMLElement>(".sw-chip");
    // jsdom re-serializes the computed shorthand, so the hexes come back as `rgb()`.
    expect(chips[0].style.background).toContain("rgb(255, 108, 174) 65%");
    // A theme that declares no accent renders the chip it always did — no band, no stray layer.
    expect(chips[1].style.background).toBe("rgb(18, 52, 86)");
  });

  it("stays a radiogroup of labelled radios with a roving tabindex (unchanged by the chip)", () => {
    const onPick = vi.fn();
    const { container } = render(
      <Swatches current="plain" options={options} onPick={onPick} ariaLabel="Palette" />,
    );
    expect(container.querySelector("[role=radiogroup]")?.getAttribute("aria-label")).toBe(
      "Palette",
    );
    const radios = container.querySelectorAll<HTMLButtonElement>("button[role=radio]");
    expect([...radios].map((r) => r.getAttribute("aria-label"))).toEqual(["Arcade", "Plain"]);
    expect([...radios].map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect([...radios].map((r) => r.tabIndex)).toEqual([-1, 0]);
    // The chip is decoration; the radio carries the name.
    expect(chip(container).getAttribute("aria-hidden")).toBe("true");
  });
});

describe("gacha's eight chips declare their own flat accent (G6.3)", () => {
  it("every variant carries one, and it is the FIRST hex of its own brand trio", () => {
    // `body[data-accent]` resolves `--accent: var(--gc-brand-1)` for all eight — family 1 inherits the
    // base brand-1, family 2 redefines it — and `rampSwatch` puts that same brand-1 at the trio's head.
    // So this arm plus gachaChrome's "each chip re-states its OWN palette's trio" (which reads tokens.css
    // itself) is the whole chain: chip accent → chip trio → the palette block. Pinned here rather than by
    // re-parsing the stylesheet a second time in a second file.
    const accents = gacha.palettes.accents ?? [];
    expect(accents).toHaveLength(8);
    for (const a of accents) {
      expect(a.accent, `${a.id} declares no accent`).toMatch(/^#[0-9a-f]{6}$/);
      const trioHead = String(a.swatch).match(/#[0-9a-f]{6}/g)?.[1];
      expect(a.accent, `${a.id}'s band is not its brand-1`).toBe(trioHead);
    }
    // Family 1's three share it BY DESIGN — which is the reason the band exists: their gradients differ
    // only in the crown, so without it the picker could not say they keep the same accent.
    const byId = new Map(accents.map((a) => [a.id, a.accent]));
    expect(new Set(["arcade", "midnight", "indigo"].map((id) => byId.get(id))).size).toBe(1);
    // …and the five family-2 variants each bring their own.
    expect(new Set(accents.map((a) => a.accent)).size).toBe(6);
  });
});
