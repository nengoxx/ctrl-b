import { act, cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setUI } from "../../src/store/ui";
import { GachaReel } from "../../src/themes/gacha/GachaReel";

// The gacha tab REEL mechanism (D52 / GACHA_PLAN §10.1 — G0 owns the overlay + slats; the figure is G4).
//
// What must hold, and why each claim is load-bearing:
//  · FIVE slats, one node, `aria-hidden`, no interactivity — a decorative full-screen layer that must never
//    intercept a tap or announce itself (the tab bar's `aria-selected` already reports the change).
//  · NO reel on boot / on switching INTO gacha (which remounts the Root) — a transition announcing nothing.
//  · A reel on every subsequent tab change, INCLUDING returning to the tab the app booted on (the sticky
//    half of the latch — the naive "did we leave the boot tab" test regresses exactly there).
//  · `key={tab}` remounts the overlay, so hammering the bar restarts the sweep instead of leaving a
//    half-finished one running (the React-clean equivalent of the prototype's `void offsetWidth` poke).
//  · Reduced motion removes it entirely, via the app's own axis rather than the OS media query.

const reel = (c: HTMLElement) => c.querySelector(".gc-reel");

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full" });
});

afterEach(cleanup);

describe("GachaReel", () => {
  it("renders NOTHING on first mount (no boot reel)", () => {
    const { container } = render(<GachaReel />);
    expect(reel(container)).toBeNull();
  });

  it("sweeps on a tab change — five slats, aria-hidden, no interactive content", () => {
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    const node = reel(container);
    expect(node).not.toBeNull();
    expect(node!.querySelectorAll("i")).toHaveLength(5);
    expect(node!.getAttribute("aria-hidden")).toBe("true");
    expect(node!.querySelector("button, a, input")).toBeNull();
  });

  it("still sweeps when returning to the BOOT tab (the latch is sticky, not a one-way gate)", () => {
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    expect(reel(container)).not.toBeNull();
    act(() => setUI({ tab: "fleet" })); // back where we booted
    expect(reel(container)).not.toBeNull();
  });

  it("remounts the overlay per tab, so a rapid second switch restarts the sweep", () => {
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    const first = reel(container);
    act(() => setUI({ tab: "conf" }));
    const second = reel(container);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first); // a NEW node — a fresh CSS animation from frame 0
  });

  it("renders nothing under reduced motion", () => {
    setUI({ motion: "reduced" });
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    expect(reel(container)).toBeNull();
  });

  it("re-enabling motion does NOT sweep for a switch made while it was off (Codex G0 #5)", () => {
    // The leak this pins: the latch used to live beside the motion gate, so tab changes made under
    // reduced motion still armed it — and turning motion back ON (an APPEARANCE toggle, not a
    // navigation) mounted the overlay and swept for a switch that had happened minutes earlier. The gate
    // now unmounts the latch, so motion returning re-boots it against the CURRENT tab.
    setUI({ motion: "reduced" });
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" })); // a switch nobody saw
    act(() => setUI({ motion: "full" }));
    expect(reel(container)).toBeNull(); // …and nobody sees a reel for it now, either

    // The very next real navigation still reels — the gate suppresses the ghost, not the feature.
    act(() => setUI({ tab: "conf" }));
    expect(reel(container)).not.toBeNull();
  });
});

// ── M2, the cross-fade the slats sweep OVER (G4). Read off the stylesheet source, the `gachaDossier`
//    precedent: jsdom parses no `::view-transition-*` pseudo, so the rules are unobservable through the
//    CSSOM and the file is the only place the contract can be pinned. What is load-bearing is the
//    CHOREOGRAPHY (measured off the prototype, theme.css:144-147) and the fact that it is SCOPED to the
//    `tab` kind — unscoped it would fire on the theme swap too, which has its own cross-fade. ──
describe("the M2 tab cross-fade (CSS)", () => {
  const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
  /** The declaration block of the one rule whose selector contains `sel`. */
  const ruleFor = (sel: string): string => /\{([^{}]*)\}/.exec(css.slice(css.indexOf(sel)))![1];

  it("scales the outgoing screen down over 240 ms and fades the new one in over 380 ms +100 ms", () => {
    expect(ruleFor(':scope[data-transition="tab"]::view-transition-old(root)')).toContain(
      "animation: gacha-root-out 240ms ease both",
    );
    // The 100 ms delay is the whole point of the pair: the old screen gets a head start, so the two
    // read as one screen replacing another rather than as two independent fades.
    expect(ruleFor(':scope[data-transition="tab"]::view-transition-new(root)')).toContain(
      "animation: gacha-root-in 380ms 100ms var(--gc-ease-out) both",
    );
  });

  it("moves transform + opacity only — 96% out, 104% in (§14.11)", () => {
    const out = ruleFor("@keyframes gacha-root-out");
    expect(out).toContain("scale(0.96)");
    expect(out).toContain("opacity: 0");
    const into = ruleFor("@keyframes gacha-root-in");
    expect(into).toContain("scale(1.04)");
    expect(into).toContain("opacity: 0");
    // Nothing that would trigger layout: no width/height/top/left in either keyframe.
    expect(`${out}${into}`).not.toMatch(/\b(width|height|top|left|margin)\s*:/);
  });

  it("shares ONE keyframe pair with the `detail` morph, at that kind's own shorter timings", () => {
    // The prototype declares the pair once and re-times it (theme.css:149-150). Two near-identical
    // copies is the duplication this pins against — and the `detail` timings are what prove the
    // re-time is real rather than a copy that drifted.
    expect(ruleFor(':scope[data-transition="detail"]::view-transition-old(root)')).toContain(
      "gacha-root-out 200ms",
    );
    expect(ruleFor(':scope[data-transition="detail"]::view-transition-new(root)')).toContain(
      "gacha-root-in 300ms",
    );
    expect([...css.matchAll(/@keyframes gacha-root-(in|out)/g)]).toHaveLength(2);
  });

  it("never fires unscoped — no bare `::view-transition-old/new(root)` rule exists", () => {
    // An unstamped rule would also catch the THEME SWAP, which brings its own cross-fade (switchTheme
    // passes no type on purpose), and every future kind anyone adds.
    for (const m of css.matchAll(/([^{}]*)::view-transition-(old|new)\(root\)/g)) {
      expect(m[1]).toMatch(/\[data-transition="(tab|detail|showcase)"\]/);
    }
  });
});
