import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// G5 — the figure's art now comes from `GET /api/media/gacha`. The index hook is mocked rather than
// wrapped in a QueryClientProvider (the `useFleet` precedent in the Fleet suite): the default — no owner
// files — is also the assertion that the G4 figure is byte-identical on a fresh install, and
// `media.data = …` drives the owner-cutout + swapped-URL cases below.
const media = vi.hoisted(() => ({ data: undefined as MediaIndex | undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));

import type { MediaIndex } from "../../src/hooks/useMedia";
import { setUI } from "../../src/store/ui";
import { GachaReel } from "../../src/themes/gacha/GachaReel";
import { defaultRoster, reelFigureArt } from "../../src/themes/gacha/roster";

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

/** Record every `new Image()` the component makes, and let a test report a failure on one. jsdom loads no
 *  resources, so a real warm-up Image fires neither `load` nor `error` — the stub is the only way to drive
 *  (and to COUNT) the pre-fetch, which is the half a CSS-only `perf: lite` gate can't reach. */
interface WarmImage {
  src: string;
  onerror: ((this: unknown) => void) | null;
}
let warmed: WarmImage[] = [];
const realImage = globalThis.Image;
function stubImage(): void {
  globalThis.Image = class {
    src = "";
    onerror: ((this: unknown) => void) | null = null;
    constructor() {
      warmed.push(this);
    }
  } as unknown as typeof Image;
}

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", perf: "full" });
  warmed = [];
  media.data = undefined; // default: no owner files ⇒ the bundled figure, exactly as G4 shipped it
});

afterEach(() => {
  cleanup();
  globalThis.Image = realImage;
});

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

// The stylesheet SOURCE — jsdom parses no `::view-transition-*` pseudo and computes no `env()`, so the
// file is the only place these contracts can be pinned (the `gachaDossier` precedent).
const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
/** The declaration block of the first rule whose selector contains `sel` (no nested braces). */
const ruleFor = (sel: string): string => /\{([^{}]*)\}/.exec(css.slice(css.indexOf(sel)))![1];
/** A whole at-rule (a `@keyframes` and every step inside it), brace-balanced. */
const atRuleFor = (sel: string): string => {
  const from = css.indexOf(sel);
  let depth = 0;
  for (let i = css.indexOf("{", from); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(from, i + 1);
  }
  throw new Error(`unbalanced block for ${sel}`);
};

// ── THE FIGURE (G4) — the character riding the slats. What is load-bearing: it comes through the theme's
//    ONE art resolver (so a G5 `reel_figure:` pin swaps it), it is the LAST child (paint order alone puts
//    it over the slats), it is decorative to the letter, and it carries NO runtime filter — the glow is
//    baked into the asset, which is the §10.1 rider that keeps a large moving image off Gecko's
//    per-frame rasterizer. ──
describe("the reel figure", () => {
  const figure = (c: HTMLElement) => c.querySelector<HTMLImageElement>(".gc-reel-figure");

  it("rides the sweep, as the LAST child of the overlay", () => {
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    const node = reel(container)!;
    expect(figure(container)).not.toBeNull();
    expect(node.lastElementChild).toBe(figure(container)); // after all five slats — the prototype's order
  });

  it("is the ROSTER's pick, not a hardcoded import", () => {
    // The whole point of resolving through `reelFigureArt`: a G5 `reel_figure:` pin (or simply a
    // different first cutout-bearing entry) moves the figure with the rest of the theme's art.
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)!.getAttribute("src")).toBe(reelFigureArt(defaultRoster())!.url);
  });

  it("is decorative to the letter — empty alt under an aria-hidden parent, nothing interactive", () => {
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    const img = figure(container)!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.closest("[aria-hidden='true']")).not.toBeNull();
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("goes with the reel under reduced motion — one gate, not two", () => {
    setUI({ motion: "reduced" });
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)).toBeNull();
  });

  it("carries NO runtime filter, and every dial is a token (CSS)", () => {
    // The §10.1 rider, machine-checked: the prototype's static double `drop-shadow()` on a large moving
    // image re-rasterizes per frame on Gecko, so the glow is baked into the exported asset and no filter
    // may creep back. The rest pins the "tunable without a code edit" contract — the owner's eyeball
    // round moves tokens.css, never this stylesheet.
    const fig = ruleFor(".gc-reel-figure {");
    expect(fig).not.toMatch(/\bfilter\s*:/);
    expect(fig).toContain("height: var(--gc-figure-h)");
    expect(fig).toContain("left: var(--gc-figure-x)");
    expect(fig).toContain("var(--gc-figure-dur)");
    // The floor is the SAFE AREA, not the viewport edge — a home indicator must not cut the hem.
    expect(fig).toMatch(
      /bottom:\s*calc\(env\(safe-area-inset-bottom[^)]*\) \+ var\(--gc-figure-lift\)\)/,
    );
    expect(fig).toContain("will-change: transform, opacity"); // promoted, §14.11
    const keys = atRuleFor("@keyframes gacha-reel-figure");
    expect(keys).not.toMatch(/\b(width|height|top|left|margin|filter)\s*:/); // transform/opacity only
    expect(keys).toContain("var(--gc-figure-peak)");
  });

  it("is the half `perf: lite` drops — the slats carry the sweep alone", () => {
    // The banner-glow / oracle-scan precedent: five flat gradients are cheap, a full-height image
    // compositing over the whole shell on every navigation is not.
    expect(css).toMatch(/body\[data-perf="lite"\] \.gc-reel-figure \{\s*display: none;/);
    // …and reduced motion still takes the WHOLE overlay, figure included, in one rule.
    expect(css).toMatch(/body\[data-motion="reduced"\] \.gc-reel \{\s*display: none;/);
  });

  // ── DEGRADATION (Codex G4 F2). The CSS rule above hides the node; these pin the two things CSS cannot
  //    do — not FETCHING the image the owner opted out of, and dropping a figure whose asset is broken
  //    rather than sweeping a torn <img> across the whole shell. ──

  it("under `perf: lite` it is never fetched and never mounted — not merely hidden", () => {
    setUI({ perf: "lite" });
    stubImage();
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    expect(warmed).toHaveLength(0); // the warm-up itself is skipped — no request at all
    expect(figure(container)).toBeNull(); // …and no element, so nothing to compose or animate
    expect(reel(container)!.querySelectorAll("i")).toHaveLength(5); // the sweep is complete without it
  });

  it("…and is fetched exactly ONCE per mount when perf is full (the warm-up, unchanged)", () => {
    stubImage();
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    act(() => setUI({ tab: "conf" }));
    expect(warmed).toHaveLength(1);
    expect(warmed[0].src).toBe(reelFigureArt(defaultRoster())!.url);
    expect(figure(container)).not.toBeNull();
  });

  it("a cutout that fails to LOAD drops the figure — the reel runs on its slats", () => {
    stubImage();
    const { container } = render(<GachaReel />);
    expect(warmed).toHaveLength(1);
    act(() => warmed[0].onerror!()); // corrupt / pruned / unreachable asset
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)).toBeNull(); // never mounted — no broken <img> riding the sweep
    expect(reel(container)!.querySelectorAll("i")).toHaveLength(5);
  });

  // ── G5 · the latch is URL-SCOPED (the G4 carry). While the figure was a module constant a boolean was
  //    safe; now the art is runtime-mutable, so a boolean would strand the theme figure-less after the
  //    owner FIXES the file — the reason the note came forward to this slice. ──

  const ownerCutout = (name: string, revision = "1:1") => ({
    ns: "gacha",
    collation: "casefold-natural",
    roles: {
      reel: [
        {
          name,
          file: `${name}.webp`,
          url: `/api/media/gacha/files/reel/${name}.webp`,
          format: "webp",
          size_bytes: 1,
          revision,
          width: 1,
          height: 1,
          unusable: false,
          warnings: [],
        },
      ],
    },
    slots: {},
  });

  it("takes the OWNER's reel cutout over the bundled one", () => {
    media.data = ownerCutout("mine");
    stubImage();
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)!.getAttribute("src")).toBe("/api/media/gacha/files/reel/mine.webp");
    expect(warmed[0].src).toBe("/api/media/gacha/files/reel/mine.webp");
  });

  it("a REPLACED cutout clears the failure latch — the latch is keyed to the URL that broke", () => {
    media.data = ownerCutout("broken");
    stubImage();
    const { container } = render(<GachaReel />);
    act(() => warmed[0].onerror!()); // the owner's drop is corrupt
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)).toBeNull();

    // The owner replaces the file; the index hands over a DIFFERENT url. A boolean latch would keep the
    // theme figure-less until a reload — this must recover on the next render.
    media.data = ownerCutout("fixed");
    act(() => setUI({ tab: "conf" }));
    expect(figure(container)!.getAttribute("src")).toBe("/api/media/gacha/files/reel/fixed.webp");

    // …and the broken one is still latched: coming BACK to it must not re-mount a known-bad image.
    media.data = ownerCutout("broken");
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)).toBeNull();
  });

  it("does NOT re-warm when the index changes but the art does not (W5)", () => {
    // The warm-up depends on the art's IDENTITY, not on the roster object: a refetch that returns an
    // equal-but-new listing (or a change to a role this component does not read) rebuilds the roster,
    // and re-fetching the same bytes on every one of those would be a request per poll.
    media.data = ownerCutout("cut", "1:1");
    stubImage();
    render(<GachaReel />);
    expect(warmed).toHaveLength(1);

    media.data = ownerCutout("cut", "1:1"); // same file, brand-new payload object
    act(() => setUI({ tab: "agent" }));
    expect(warmed).toHaveLength(1);
  });

  it("a file REPLACED IN PLACE clears the latch — the same name is not the same bytes", () => {
    // Codex F6: the owner's usual repair is `scp cut.webp` over the broken one, which changes nothing
    // about the URL — and the URL has to stay stable for the SW's media cache. The index's revision is
    // what makes "this is a different file now" expressible.
    media.data = ownerCutout("cut", "100:5");
    stubImage();
    const { container } = render(<GachaReel />);
    act(() => warmed[0].onerror!());
    act(() => setUI({ tab: "agent" }));
    expect(figure(container)).toBeNull();

    // same URL, new bytes
    media.data = ownerCutout("cut", "200:9");
    act(() => setUI({ tab: "conf" }));
    expect(figure(container)!.getAttribute("src")).toBe("/api/media/gacha/files/reel/cut.webp");

    // …and a refetch that returns the SAME revision must not un-latch a still-broken file
    act(() => warmed[warmed.length - 1].onerror!());
    media.data = ownerCutout("cut", "200:9");
    act(() => setUI({ tab: "fleet" }));
    expect(figure(container)).toBeNull();
  });

  it("…and a failure reported by the RENDERED image drops it too (the final fallback)", () => {
    // The warm-up normally catches a bad asset first; this is the path where it doesn't — a cache entry
    // that goes bad after the warm request succeeded.
    const { container } = render(<GachaReel />);
    act(() => setUI({ tab: "agent" }));
    fireEvent.error(figure(container)!);
    expect(figure(container)).toBeNull();
    expect(reel(container)).not.toBeNull();

    // …and it stays gone on the next sweep, rather than re-mounting a known-broken image every navigation.
    act(() => setUI({ tab: "conf" }));
    expect(figure(container)).toBeNull();
  });
});

// ── M2, the cross-fade the slats sweep OVER (G4). What is load-bearing is the CHOREOGRAPHY (measured off
//    the prototype, theme.css:144-147) and the fact that it is SCOPED to the `tab` kind — unscoped it would
//    fire on the theme swap too, which has its own cross-fade. ──
describe("the M2 tab cross-fade (CSS)", () => {
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
    const out = atRuleFor("@keyframes gacha-root-out");
    expect(out).toContain("scale(0.96)");
    expect(out).toContain("opacity: 0");
    const into = atRuleFor("@keyframes gacha-root-in");
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
