import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, useEffect, useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import { createSurface } from "../../src/theme-engine/surface";

// The GENERIC surface factory (D31 / THEME_ENGINE §14.14, extracted at GACHA_PLAN §12.6 E0). The two
// CONCRETES have their own suites — `composerSurface.test.ts` pins the composer's registry/ids/spec (and is
// the refactor's fence), `gachaFleet.test.tsx` the fleet's. What belongs HERE is the machinery itself: the
// resolution rule, `register`'s additivity, the fallback net, and the no-remount property that is the entire
// reason a surface is a registry of stable references rather than a switch that builds components in render.
//
// The instances under test are built LOCALLY, so nothing here can leak into the app's real registries. They
// borrow the `composer` setting KEY because the resolver deliberately validates through the theme registry —
// a setting no theme declares would only ever exercise the undefined path. cosmos declares
// `composer: [stacked, sheet, line]` with `stacked` as its default, which gives all three interesting cases:
// a value that is declared AND registered, one declared but NOT registered, and one that isn't declared.

/** The test variants' contract — a surface's props are opaque to the factory; this one just proves they
 *  arrive (and that the resolver override never leaks into them). */
interface Slots {
  tag?: string;
}
const variant = (mark: string): ComponentType<Slots> =>
  function Variant(props: Slots) {
    // the received prop NAMES are recorded, so "the resolver override doesn't leak into the variant" is
    // testable at the variant's own boundary rather than by inspecting the DOM React would have dropped it from
    return createElement(
      "i",
      { "data-variant": mark, "data-props": Object.keys(props).sort().join(",") },
      props.tag ?? "",
    );
  };

const Alpha = variant("alpha");
const Beta = variant("beta");

const mark = (c: HTMLElement): string | null =>
  c.querySelector("[data-variant]")?.getAttribute("data-variant") ?? null;

beforeEach(() => {
  setUI({ theme: "cosmos", themeSettings: {} });
});
afterEach(() => {
  cleanup();
  setUI({ themeSettings: {} });
});

describe("createSurface — the registry", () => {
  it("seeds the fallback under defaultId and grows only by `register` (additive, stable refs)", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    expect(s.variants).toEqual({ stacked: Alpha });
    const before = s.variants;

    s.register("sheet", Beta);
    expect(s.variants.stacked).toBe(Alpha); // the seeded entry is untouched
    expect(s.variants.sheet).toBe(Beta);
    // the SAME object, mutated — the references handed to React must not be rebuilt (a fresh map, or a
    // component identity built in render, remounts the variant subtree and resets the controller under it)
    expect(s.variants).toBe(before);
  });

  it("exposes the name + defaultId it was built with (the setting key and the degrade target)", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    expect(s.name).toBe("composer");
    expect(s.defaultId).toBe("stacked");
  });

  it("has NO prototype, so an inherited key is not a variant (`toString` → the fallback)", () => {
    // Variant ids arrive from persisted, cross-device-synced user data. On a plain object `toString` and
    // `constructor` resolve to inherited junk, and a bare index read would hand React a function that is not
    // a component. A null-prototype map has nothing to inherit.
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    expect(Object.getPrototypeOf(s.variants)).toBeNull();
    expect(mark(render(createElement(s.Themed, { layout: "toString" })).container)).toBe("alpha");
    cleanup();
    expect(mark(render(createElement(s.Themed, { layout: "constructor" })).container)).toBe(
      "alpha",
    );
  });

  it("registering `__proto__` stores an ORDINARY own key — no pollution of anything else", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    const other = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("__proto__", Beta);

    // it is a real own entry on THIS surface (on a plain object the assignment would have been swallowed
    // by the prototype setter and stored nothing at all)…
    expect(Object.hasOwn(s.variants, "__proto__")).toBe(true);
    expect(mark(render(createElement(s.Themed, { layout: "__proto__" })).container)).toBe("beta");
    cleanup();
    // …and nothing leaked: a second surface, and plain objects, are untouched
    expect(Object.hasOwn(other.variants, "__proto__")).toBe(false);
    expect(mark(render(createElement(other.Themed, { layout: "__proto__" })).container)).toBe(
      "alpha",
    );
    expect(({} as Record<string, unknown>).nope).toBeUndefined();
  });
});

describe("createSurface — useVariantId", () => {
  it("resolves the theme's declared default when nothing is stored", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    expect(renderHook(() => s.useVariantId()).result.current).toBe("stacked");
  });

  it("resolves a stored id that is BOTH declared by the theme and registered here", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("sheet", Beta);
    setThemeSetting("cosmos", "composer", "sheet");
    expect(renderHook(() => s.useVariantId()).result.current).toBe("sheet");
  });

  it("degrades an UNKNOWN stored value to defaultId (validated by the theme's option list)", () => {
    // `resolveThemeSetting` only accepts an id the theme declared, so a corrupt or rolled-back value can
    // never resolve to an off-catalog variant — D31's per-theme capability list, enforced for free.
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("sheet", Beta);
    setThemeSetting("cosmos", "composer", "not-a-variant");
    expect(renderHook(() => s.useVariantId()).result.current).toBe("stacked");
  });

  it("degrades a DECLARED-but-unregistered id to defaultId (the `Object.hasOwn` guard)", () => {
    // `line` is a real cosmos option; this surface never registered it — a theme-owned variant whose chunk
    // hasn't loaded, or an id from a newer build. The id resolves, the registry doesn't hold it, so the
    // resolver hands back the default rather than a hole.
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    setThemeSetting("cosmos", "composer", "line");
    expect(renderHook(() => s.useVariantId()).result.current).toBe("stacked");
  });

  it("degrades to defaultId when the ACTIVE THEME declares no such setting at all", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("sheet", Beta);
    setUI({ theme: "phosphor", themeSettings: {} }); // a valid ThemeId with no registry row
    setThemeSetting("phosphor", "composer", "sheet");
    expect(renderHook(() => s.useVariantId()).result.current).toBe("stacked");
  });
});

describe("createSurface — Themed", () => {
  it("renders the resolved variant and passes the slots through", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("sheet", Beta);
    const { container } = render(createElement(s.Themed, { tag: "hello" }));
    expect(mark(container)).toBe("alpha");
    expect(container.textContent).toBe("hello");

    cleanup();
    setThemeSetting("cosmos", "composer", "sheet");
    expect(mark(render(createElement(s.Themed, { tag: "hello" })).container)).toBe("beta");
  });

  it("the `layout` prop WINS over the resolved id — and never reaches the variant", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("sheet", Beta);
    const { container } = render(createElement(s.Themed, { layout: "sheet", tag: "x" }));
    expect(mark(container)).toBe("beta");
    // `layout` is the resolver's override, not a slot: a variant's props are its own contract
    expect(container.querySelector("[data-variant]")?.getAttribute("data-props")).toBe("tag");
  });

  it("is FALLBACK-SAFE: an id with no component renders the fallback rather than crashing", () => {
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    // bypassing the resolver entirely — the `?? fallback` net is the last line, and it is what makes a
    // half-registered lazy theme chunk a cosmetic problem instead of a blank screen
    const { container } = render(createElement(s.Themed, { layout: "nope" }));
    expect(mark(container)).toBe("alpha");
  });
});

describe("createSurface — a variant swap does NOT remount the parent", () => {
  it("keeps the parent mounted and its sibling child's state through a live swap", () => {
    // THE whole point of the mechanism (§14.14's explicit hazard, and GACHA_PLAN §12.6's fleet requirement):
    // the component that resolves the id owns real state — the fleet's dossier, its morph refs, the
    // composer's draft — so a layout change must re-render it, never remount it. The parent here takes the
    // DefaultRoot shape (it reads the id itself and hands it down as `layout`), which is the arm that could
    // regress: a resolver that returned a fresh component identity, or a Themed that keyed its child, would
    // take the whole subtree with it.
    const s = createSurface<Slots>("composer", "stacked", Alpha);
    s.register("sheet", Beta);

    let parentMounts = 0;
    function Counter() {
      const [n, setN] = useState(0);
      return createElement(
        "button",
        { onClick: () => setN(n + 1), "data-testid": "count" },
        String(n),
      );
    }
    function Parent() {
      const layout = s.useVariantId();
      useEffect(() => {
        parentMounts++;
      }, []);
      return createElement(
        "div",
        null,
        createElement(Counter),
        createElement(s.Themed, { layout }),
      );
    }

    const { getByTestId, container } = render(createElement(Parent));
    expect(parentMounts).toBe(1);
    expect(mark(container)).toBe("alpha");

    fireEvent.click(getByTestId("count"));
    fireEvent.click(getByTestId("count"));
    expect(getByTestId("count").textContent).toBe("2");

    act(() => {
      setThemeSetting("cosmos", "composer", "sheet");
    });

    expect(mark(container)).toBe("beta"); // the swap really happened…
    expect(parentMounts).toBe(1); // …without remounting the parent…
    expect(getByTestId("count").textContent).toBe("2"); // …so its sibling's state survived
  });
});
