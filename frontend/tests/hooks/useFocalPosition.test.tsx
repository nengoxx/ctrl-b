import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom shims, per the house convention (the `sectionScroll` precedent): jsdom ships no
// `ResizeObserver` and does no layout at all, so a real window can never be measured here. Both halves
// are stubbed EXPLICITLY — the observer as a recording no-op, `getBoundingClientRect` per element — so
// the two states this hook has ("could not measure" and "measured") are both drivable.
const observed: Element[] = [];
const callbacks: (() => void)[] = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(cb: () => void) {
      callbacks.push(cb);
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  },
);
/** What the browser does when a box changes size — the only way a measurement reaches this hook. */
const resize = () => act(() => callbacks.forEach((cb) => cb()));

import { FocalImg } from "../../src/components/FocalImg";
import { centredFocal, proportionalFocal } from "../../src/lib/focalPosition";

afterEach(() => {
  cleanup();
  observed.length = 0;
  callbacks.length = 0;
});

/** Give every `<img>` this test renders a real box, since jsdom gives it none. */
function sizeImages(container: HTMLElement, box: { width: number; height: number }) {
  for (const img of container.querySelectorAll("img"))
    img.getBoundingClientRect = () =>
      ({ ...box, top: 0, left: 0, right: box.width, bottom: box.height, x: 0, y: 0 }) as DOMRect;
}

describe("useFocalPosition / FocalImg — one window, one measured box (§5, council H3)", () => {
  it("NO framing point ⇒ no inline position at all — the surface's own CSS default stands", () => {
    // The paint-parity line for the whole S4 rewrite: this is the state every install is in until an
    // owner sets a point, and the rewrite must not put a single declaration on the element.
    const { container } = render(<FocalImg src="/a.webp" alt="" />);
    expect(container.querySelector("img")!.style.objectPosition).toBe("");
    expect(container.querySelector("img")!.getAttribute("style")).toBe(null);
    // …and nothing is observed, so the bundled fleet costs zero observers.
    expect(observed).toHaveLength(0);
  });

  it("PROPORTIONAL art needs no box, so it observes nothing and paints its string verbatim", () => {
    const { container } = render(
      <FocalImg src="/a.webp" alt="" art={proportionalFocal("50% 12%")} />,
    );
    expect(container.querySelector("img")!.style.objectPosition).toBe("50% 12%");
    expect(observed).toHaveLength(0);
  });

  it("CENTRED art observes its own element and maps through the measured box", () => {
    const art = centredFocal({ x: 0.25, y: 0.25 }, 600, 300);
    const { container } = render(<FocalImg src="/a.webp" alt="" art={art} />);
    // It observes its OWN element — the window it will be painted in, not an ancestor.
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(container.querySelector("img"));
    // Unmeasured (jsdom gives every element a zero box, which the hook refuses as "not a measurement")
    // it is the recorded proportional degrade.
    expect(container.querySelector("img")!.style.objectPosition).toBe("25% 25%");
    // …and once the box is real: a 600x300 source in a 300x300 window crops X (s = 2) and matches Y
    // exactly (s = 1, the guard's axis), so the point is CENTRED horizontally and the guard answers 50%.
    sizeImages(container, { width: 300, height: 300 });
    resize();
    expect(container.querySelector("img")!.style.objectPosition).toBe("0% 50%");
    // The SAME item in a taller window is a different answer — the whole reason this is per-window.
    sizeImages(container, { width: 300, height: 600 });
    resize();
    expect(container.querySelector("img")!.style.objectPosition).toBe("16.6667% 50%");
  });

  it("degrades to PROPORTIONAL when there is no ResizeObserver at all", () => {
    // The one environment guard the house pattern carries (`Swatches`, `CosmosFleet`). It is also the
    // state a surface that cannot be measured is in, which §5 records as the weaker-but-visible answer.
    const real = globalThis.ResizeObserver;
    // @ts-expect-error — deliberately removing it, exactly as jsdom ships
    delete globalThis.ResizeObserver;
    try {
      const { container } = render(
        <FocalImg src="/a.webp" alt="" art={centredFocal({ x: 0.42, y: 0.18 }, 600, 300)} />,
      );
      expect(container.querySelector("img")!.style.objectPosition).toBe("42% 18%");
    } finally {
      globalThis.ResizeObserver = real;
    }
  });

  it("applies the per-window shift to the RESOLVED value, and only when asked", () => {
    const art = proportionalFocal("50% 12%");
    const { container } = render(
      <>
        <FocalImg className="plain" src="/a.webp" alt="" art={art} />
        <FocalImg className="hero" src="/a.webp" alt="" art={art} shiftX={-0.2} />
      </>,
    );
    expect(container.querySelector<HTMLImageElement>(".plain")!.style.objectPosition).toBe(
      "50% 12%",
    );
    expect(container.querySelector<HTMLImageElement>(".hero")!.style.objectPosition).toBe(
      "30% 12%",
    );
  });

  it("keeps the caller's own inline style beside the position it adds", () => {
    const { container } = render(
      <FocalImg src="/a.webp" alt="" art={proportionalFocal("50% 12%")} style={{ opacity: 0.5 }} />,
    );
    const img = container.querySelector("img")!;
    expect(img.style.opacity).toBe("0.5");
    expect(img.style.objectPosition).toBe("50% 12%");
  });
});
