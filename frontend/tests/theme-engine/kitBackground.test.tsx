import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SHARED kit background layer (the Kit Art System / Codex A3 + A6).
//
// The claim that actually matters is the OPT-OUT, and it can only be tested POPULATED: an empty media
// folder proves nothing, because then no theme mounts anything anyway. So every arm below runs with a
// real background file in the index and the Appearance switch ON, and asks whether a layer appears.
//
//   · the resolution + the switch      — `KitBackground` alone;
//   · the theme's MOUNT decision       — `DefaultRoot`'s `kitBackground` prop, rendered for real;
//   · and the five shipped themes      — every Root, rendered for real: minimal/vapor participate,
//                                        cosmos/frontier/gacha (each with full-bleed scenery of its own)
//                                        mount nothing, because full-app scenery is exclusive (§A5).
//
// jsdom shims, per the house convention (setup.ts keeps only the unavoidable ones): the kit shell measures
// with ResizeObserver and resets the scroller on a section change.

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

const media = vi.hoisted((): { data: unknown } => ({ data: undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));

import type { MediaFile } from "../../src/hooks/useMedia";
import { setUI } from "../../src/store/ui";
import { DefaultRoot } from "../../src/theme-engine/kit/DefaultRoot";
import { KitBackground } from "../../src/theme-engine/kit/KitBackground";
import { CosmosRoot } from "../../src/themes/cosmos/CosmosRoot";
import { FrontierRoot } from "../../src/themes/frontier/FrontierRoot";
import { GachaRoot } from "../../src/themes/gacha/GachaRoot";
import { MinimalRoot } from "../../src/themes/minimal/MinimalRoot";
import { VaporRoot } from "../../src/themes/vapor/VaporRoot";

const file = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.png`,
  url: `/api/media/kit/files/background/${name}.png`,
  format: "png",
  size_bytes: 90_000,
  revision: `1:90000:${name}`,
  width: 1600,
  height: 900,
  unusable: false,
  unusable_reason: null,
  ...over,
});

/** What the layer must paint for `file(name)` — the mount URL plus the `?rev=` stamp every CSS-painted
 *  owner role carries, so overwriting the image in place actually repaints (`ownerArt.ts#ownerArtUrl`). */
const painted = (name: string) =>
  `url("/api/media/kit/files/background/${name}.png?rev=${encodeURIComponent(`1:90000:${name}`)}")`;

/** Put a background role + pins on the mocked index (the state every arm here runs in). */
function seedIndex(files: MediaFile[], slots: Record<string, string> = {}) {
  media.data = { ns: "kit", collation: "library-v1", roles: { background: files }, slots };
}

function draw(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const layers = (c: HTMLElement) => c.querySelectorAll(".kit-bg");

beforeEach(() => {
  seedIndex([file("nebula")]);
  setUI({ kitBackgroundVisible: true });
});
afterEach(cleanup);

describe("KitBackground — what makes the layer exist", () => {
  it("paints the pool's first usable file as a custom property on ONE fixed layer", () => {
    const { container } = draw(<KitBackground />);
    expect(layers(container)).toHaveLength(1);
    expect(
      container.querySelector<HTMLElement>(".kit-bg")!.style.getPropertyValue("--kit-bg-img"),
    ).toBe(painted("nebula"));
    // Decorative: it must never be announced, and never intercept a tap (the CSS owns the latter).
    expect(container.querySelector(".kit-bg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it('ORDER is the only way to choose it — a leftover pin cannot outrank the list ("W6")', () => {
    // The kit's `background` PIN died with every other pool pin at the 2026-08-26 owner ruling: the
    // layer paints whatever sits at the top of that gallery. `KIT_SLOTS` is empty on the server side,
    // so a hand-authored value is refused at LOAD — this pins that the layer would ignore it anyway.
    seedIndex([file("nebula"), file("dunes")], { background: "dunes" });
    expect(
      draw(<KitBackground />)
        .container.querySelector<HTMLElement>(".kit-bg")!
        .style.getPropertyValue("--kit-bg-img"),
    ).toBe(painted("nebula"));
    cleanup();
    seedIndex([file("dunes"), file("nebula")]);
    expect(
      draw(<KitBackground />)
        .container.querySelector<HTMLElement>(".kit-bg")!
        .style.getPropertyValue("--kit-bg-img"),
    ).toBe(painted("dunes"));
  });

  it("REPAINTS when the file is overwritten in place — same URL, new bytes (Codex LOW)", () => {
    // The owner's ordinary repair: `background/nebula.png` is replaced over SSH. The mount URL cannot
    // move for it (the SW route is keyed on the path), so without the `?rev=` stamp the layer would keep
    // the image it already decoded until a reload. The SAME tree is re-rendered — a remount would repaint
    // from scratch whatever we did, and would prove nothing.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A FACTORY, not one element re-passed: React bails out of a subtree whose props object is the very
    // same object, so a re-render of a shared element would prove nothing either way.
    const tree = () => (
      <QueryClientProvider client={qc}>
        <KitBackground />
      </QueryClientProvider>
    );
    const r = render(tree());
    const img = () =>
      r.container.querySelector<HTMLElement>(".kit-bg")!.style.getPropertyValue("--kit-bg-img");
    expect(img()).toBe(painted("nebula"));

    seedIndex([file("nebula", { revision: "2:91000", size_bytes: 91_000 })]);
    r.rerender(tree());
    expect(img()).not.toBe(painted("nebula"));
    expect(img()).toContain("/api/media/kit/files/background/nebula.png?rev="); // the URL itself is stable
    expect(img()).toContain(encodeURIComponent("2:91000"));
  });

  it("renders NOTHING when the owner turns it off — with the file still sitting there", () => {
    setUI({ kitBackgroundVisible: false });
    expect(layers(draw(<KitBackground />).container)).toHaveLength(0);
  });

  it("renders nothing for an empty folder, an unusable-only folder, or an unreachable index", () => {
    seedIndex([]);
    expect(layers(draw(<KitBackground />).container)).toHaveLength(0);
    cleanup();
    seedIndex([file("broken", { unusable: true, unusable_reason: "unreadable" })]);
    expect(layers(draw(<KitBackground />).container)).toHaveLength(0);
    cleanup();
    media.data = undefined;
    expect(layers(draw(<KitBackground />).container)).toHaveLength(0);
  });
});

describe("DefaultRoot — the THEME decides whether the layer is mounted at all (A3)", () => {
  it("mounts it by default: a theme with no scenery of its own participates by omitting the prop", () => {
    expect(layers(draw(<DefaultRoot />).container)).toHaveLength(1);
  });

  it("mounts NOTHING for a theme that opts out — with the art present and the switch on (A6)", () => {
    // The arm the empty-folder dormancy test could never make: the file exists, the owner wants it, and
    // this theme still paints no shared layer, because it has scenery of its own.
    expect(layers(draw(<DefaultRoot kitBackground={false} />).container)).toHaveLength(0);
  });
});

describe("the five shipped themes, POPULATED and enabled (A6)", () => {
  // Rendered for real — the prop is only worth anything if the Roots actually pass it, and a theme added
  // later lands in this table by being added to it.
  const PARTICIPATES: [name: string, Root: () => ReactElement, mounts: number][] = [
    ["minimal", MinimalRoot, 1],
    ["vapor", VaporRoot, 1],
    // Each of these three owns a full-bleed surface the shared layer would compete with: cosmos's
    // starfield (its `.kit` is deliberately transparent, so the layer really would show through),
    // frontier's map, gacha's wallpaper.
    ["cosmos", CosmosRoot, 0],
    ["frontier", FrontierRoot, 0],
    ["gacha", GachaRoot, 0],
  ];

  for (const [name, Root, mounts] of PARTICIPATES) {
    it(`${name} mounts ${mounts} shared background layer(s)`, () => {
      expect(layers(draw(<Root />).container)).toHaveLength(mounts);
    });
  }
});
