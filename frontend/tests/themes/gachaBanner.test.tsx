import { StrictMode } from "react";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE BANNER TRI-STATE (GACHA_PLAN §12.6 ruling 6, slice E3) — the R25 §Q7 pins ⑰-⑱ plus the stylesheet
// claims jsdom paints none of. `useFleet` is mocked to a fixed FleetView and the media index to the
// fresh-install state (the `gachaFleet.test.tsx` harness), so these exercise the setting's WIRING: what is
// mounted, what is left ticking, what is stamped, and what the stylesheet then does with the stamp.
//
// The setting is theme-wide, so the render cases run under all three LAYOUTS: the banner is one instance
// handed to whichever layout is drawing (ruling 7's slot), and the slice line asks for the capsule — the
// untouched default LAYOUT — to be rendered and tested under every banner form in particular.
//
// ⚠ WHICH FORM IS WHICH, since the two are easy to conflate: `on` is the BASE form (the shipped v1.5.0
// band, and the stylesheet's own base declaration) while `minimal` is the SHIPPING DEFAULT since the
// owner's 2026-08-09 ruling — an override on top of that base. So the cases that want the band set `on`
// EXPLICITLY (the fence does the same), and the cases that want a real geometry change never write
// `minimal`, which is now a no-op write.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));
const media = vi.hoisted((): { data: unknown } => ({ data: undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));

// jsdom shims for the Root case (the body-attr stamp): the kit shell measures with ResizeObserver and
// resets the scroller on a section change. The `gachaPoster.test.tsx` precedent.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
/** Every `scrollTo` the SHELL makes, in order — and it applies the scroll, so both "what was asked for"
 *  and "where the pane ended up" are observable (the `sectionScroll.test.tsx` idiom; jsdom implements
 *  neither). The per-element spy in the unit cases below shadows this on its own synthetic pane. */
const scrollCalls: [number, number][] = [];
Element.prototype.scrollTo = function (this: Element, x: number, y: number) {
  scrollCalls.push([x, y]);
  (this as HTMLElement).scrollTop = y;
} as typeof Element.prototype.scrollTo;
Element.prototype.scrollIntoView = vi.fn();

/// <reference types="node" />
// ^ the stylesheet block at the end reads gacha's CSS from disk (fs/path/process); the tests tsconfig pins
//   `types:["vitest"]`, so node's globals are pulled in explicitly.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { selectorsMentioning, splitSelectors } from "./cssRules";

import { setGachaReelRunning } from "../../src/store/gachaReel";
import { setThemeSetting, setUI } from "../../src/store/ui";
import { registry } from "../../src/theme-engine/registry";
import { settingRowVisible } from "../../src/theme-engine/settings";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { GachaRoot } from "../../src/themes/gacha/GachaRoot";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { AUTOPLAY_MS } from "../../src/themes/gacha/carousel";
import type { Host, HostServiceCfg } from "../../src/types";

const cfg = (names: string[]): HostServiceCfg[] =>
  names.map((name) => ({ name, kind: null, port: null, path: "/", autostart: false, cmd: {} }));

const host = (id: string, online: boolean, over: Partial<Host> = {}): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  services: cfg(["grafana", "sonarr"]),
  status: {
    host_id: id,
    online,
    ping_ms: online ? 18 : null,
    last_seen: "2026-01-01T00:00:00Z",
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
  ...over,
});

function setFleet(over: Record<string, unknown> = {}): void {
  fleet.view = {
    hosts: [host("pegasus", true), host("atlas", false)],
    svcByHost: new Map(),
    run: vi.fn(() => Promise.resolve()),
    busy: new Set<string>(),
    isLoading: false,
    error: null,
    hasData: true,
    svcHasData: true,
    svcLoading: false,
    svcError: null,
    ...over,
  };
}

const banner = (c: HTMLElement): HTMLElement | null => c.querySelector<HTMLElement>(".gc-banner");
const slides = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>(".gc-slide")];
/** Every layout the setting has to hold under — it is theme-wide, and the banner is ONE instance the
 *  layout seats (ruling 7), so each of these is a different seat for the same component. */
const LAYOUTS = ["capsule", "poster", "cover"] as const;

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  setFleet();
  media.data = undefined;
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    vi.restoreAllMocks();
    setGachaReelRunning(false);
    setUI({ themeSettings: {} });
  }
});

// ── ⑰ · WHAT IS MOUNTED ──────────────────────────────────────────────────────────────────────────────
describe("`off` UNMOUNTS the banner — under every layout (R25 ⑰)", () => {
  it.each(LAYOUTS)("draws no .gc-banner at all under %s", (layout) => {
    setThemeSetting("gacha", "fleetLayout", layout);
    setThemeSetting("gacha", "banner", "off");
    const { container } = render(<GachaFleet active />);
    expect(banner(container)).toBeNull();
    // …and nothing the banner owns survives it either: no slides, no dot rail, no rate pills. A CSS hide
    // would leave every one of them in the tree (and focusable behind `display: none` on the engines
    // that get `inert` wrong), which is exactly what this value must not be.
    expect(slides(container)).toHaveLength(0);
    expect(container.querySelector(".gc-banner-dots")).toBeNull();
    expect(container.querySelector(".gc-banner-rate")).toBeNull();
  });

  it("leaves the REST of the fleet standing — `off` removes a banner, not a layout", () => {
    setThemeSetting("gacha", "banner", "off");
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track-head")).not.toBeNull();
    expect(container.querySelectorAll(".gc-card")).toHaveLength(2);
  });

  it("the cover's strapline SEAT goes with it — an empty printed strip is not a cover", () => {
    // The cover renders `<div class="cv-strap">{banner}</div>`; under `off` the slot is null, so the seat
    // is an empty box. It must not paint a keyline around nothing — asserted as the banner's absence
    // INSIDE the seat, which is the fact the stylesheet's `.cv-strap .gc-banner` rules key on.
    setThemeSetting("gacha", "fleetLayout", "cover");
    setThemeSetting("gacha", "banner", "off");
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".cv-strap")).not.toBeNull();
    expect(container.querySelector(".cv-strap .gc-banner")).toBeNull();
  });
});

describe("`minimal` is a CSS FORM — the same component, the same DOM (R25 ⑰)", () => {
  it.each(LAYOUTS)(
    "keeps the tag, the display line, both pills and the dots under %s",
    (layout) => {
      setThemeSetting("gacha", "fleetLayout", layout);
      setThemeSetting("gacha", "banner", "minimal");
      const { container } = render(<GachaFleet active />);
      const bn = banner(container)!;
      expect(bn).not.toBeNull();
      expect(bn.querySelector(".gc-banner-copy .tag")).not.toBeNull();
      expect(bn.querySelector(".gc-banner-copy b")).not.toBeNull();
      expect(bn.querySelectorAll(".gc-banner-rate span")).toHaveLength(2);
      expect(bn.querySelectorAll(".gc-dot").length).toBeGreaterThan(0);
    },
  );

  it("drops the caption in the STYLESHEET, not in React — the node is still there", () => {
    // The ruling is that `minimal` is a re-authored strip, and the strip's one omission is the caption.
    // It is dropped by a rule (asserted in the stylesheet block below) rather than by a render branch, so
    // the two forms are one component with one DOM — which is what makes the switch instant and keeps
    // `GachaBanner` free of a second layout mode. This is the half a CSS assertion cannot make.
    setThemeSetting("gacha", "banner", "minimal");
    const { container } = render(<GachaFleet active />);
    expect(banner(container)!.querySelector(".gc-banner-copy small")).not.toBeNull();
  });

  it("renders byte-for-byte what `on` renders — the difference is entirely the stamp", () => {
    setThemeSetting("gacha", "banner", "on");
    const { container: onC, unmount } = render(<GachaFleet active />);
    const onHtml = banner(onC)!.outerHTML;
    unmount();
    setThemeSetting("gacha", "banner", "minimal");
    const { container: minC } = render(<GachaFleet active />);
    expect(banner(minC)!.outerHTML).toBe(onHtml);
  });
});

// ── the AUTOPLAY LOOP · the reason `off` had to be an unmount ────────────────────────────────────────
describe("the autoplay timer across the three forms (R25 ⑰'s second half)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** How many timers the FLEET BODY itself arms in one banner form, and nothing of its own left behind
   *  once it unmounts (the `gachaFleet.test.tsx:1752` pin, per form).
   *
   *  A DELTA against a baseline taken after the setting write, deliberately: writing a theme setting arms
   *  the store's own pending work, so an absolute count would be measuring the harness. */
  const armsTimers = (mode: string): number => {
    setThemeSetting("gacha", "banner", mode);
    const before = vi.getTimerCount();
    const view = render(<GachaFleet active />);
    const armed = vi.getTimerCount() - before;
    view.unmount();
    expect(vi.getTimerCount(), `${mode} left a timer of its own behind`).toBe(before);
    return armed;
  };

  it("`off` arms NOTHING — the cadence is the one timer the banner brings", () => {
    expect(armsTimers("on")).toBe(1);
    expect(armsTimers("minimal")).toBe(1); // the strip is the same carousel
    expect(armsTimers("off")).toBe(0);
  });

  it("`minimal` still advances — the strip is the same carousel", () => {
    setThemeSetting("gacha", "banner", "minimal");
    const { container } = render(<GachaFleet active />);
    expect(slides(container)[0].hasAttribute("inert")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);
  });

  it("switching to `off` MID-AUTOPLAY leaves nothing ticking (R25 ⑰)", () => {
    // THE POINT OF THE UNMOUNT RULING, as a test. The owner flips the row while the carousel is between
    // beats; the banner leaves the tree, and the cadence effect's cleanup has to take the pending timeout
    // with it. The oracle is the shape `gachaFleet.test.tsx` already uses for a leak — let time pass and
    // count what is left — because the cadence RE-ARMS itself: a banner that is merely hidden would keep
    // exactly one timer pending forever, whatever the clock does.
    //
    // Started from `on` EXPLICITLY rather than from the default (which is `minimal` since the owner's
    // 08-09 ruling): the case is about the shipped hero band's teardown, and a case should not change
    // which form it exercises because a picker's default moved.
    setThemeSetting("gacha", "banner", "on");
    const { container } = render(<GachaFleet active />);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS / 2);
    });
    act(() => setThemeSetting("gacha", "banner", "off"));
    expect(banner(container)).toBeNull();
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(AUTOPLAY_MS * 4);
      }),
    ).not.toThrow();
    expect(vi.getTimerCount(), "a re-arming cadence survived the switch").toBe(0);
  });

  it("…and that oracle is NOT vacuous: the same clock with the banner ON leaves it armed", () => {
    // The control for the case above. Without it, "0 timers after advancing" would also pass for a
    // stylesheet-only `off` in a build where the cadence had stopped re-arming for some other reason.
    setThemeSetting("gacha", "banner", "on"); // the form this case's own name claims
    render(<GachaFleet active />);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS * 4);
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("switching back to `on` gives the loop back (a remount, per ruling 7's accepted cost)", () => {
    setThemeSetting("gacha", "banner", "off");
    const { container } = render(<GachaFleet active />);
    act(() => setThemeSetting("gacha", "banner", "on"));
    expect(banner(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);
  });

  it("the two gates do not fight: under REDUCED MOTION even `on` arms nothing", () => {
    // The cadence is already gated by `data-motion`, so with motion reduced the banner arms no timer at
    // all and `off` can only match it. That is what makes the count in the first case unambiguous: the
    // one timer `off` removes IS the cadence, not some other consequence of an absent subtree.
    setUI({ motion: "reduced" });
    expect(armsTimers("on")).toBe(0);
    expect(armsTimers("off")).toBe(0);
  });
});

// ── ⑱ · THE STAMP ────────────────────────────────────────────────────────────────────────────────────
describe("body[data-gc-banner] — the resolved-form stamp (R25 ⑱)", () => {
  const drawRoot = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <GachaRoot />
      </QueryClientProvider>,
    );

  it("stamps the RESOLVED form, follows the setting, and is cleared on unmount", () => {
    const view = drawRoot();
    expect(document.body.dataset.gcBanner).toBe("minimal"); // the declared default (owner, 08-09)
    // …and it FOLLOWS the row, in both directions. `on` first, deliberately: with `minimal` now the
    // default, writing `minimal` here would assert nothing at all.
    act(() => setThemeSetting("gacha", "banner", "on"));
    expect(document.body.dataset.gcBanner).toBe("on");
    act(() => setThemeSetting("gacha", "banner", "off"));
    expect(document.body.dataset.gcBanner).toBe("off");
    // a stale/corrupt synced value resolves to the default, exactly as `GachaFleet`'s own bridge does —
    // the two readers of this one setting can never disagree about a value neither recognizes
    act(() => setThemeSetting("gacha", "banner", "not-a-form"));
    expect(document.body.dataset.gcBanner).toBe("minimal");
    // …and a switched-to skin can never inherit gacha's stale attr (the §10.5 cleanup ledger)
    view.unmount();
    expect(document.body.dataset.gcBanner).toBeUndefined();
  });

  it("is INDEPENDENT of the WALLPAPER axis — the two stamps stand together", () => {
    // The two rows are adjacent in the picker and read as one subject ("Pickup banner" / "Banner
    // wallpaper"), but they are separate axes: the wallpaper is the FLEET BACKGROUND, painted on
    // `.kit-main`, and it has to survive a banner the owner turned off. Both halves are asserted — the
    // stamps here, the stylesheet's own blindness below.
    setThemeSetting("gacha", "banner", "off");
    const view = drawRoot();
    expect(document.body.dataset.wallpaper).toBe("on"); // R6's flipped-ON default
    expect(document.body.dataset.gcBanner).toBe("off");
    view.unmount();
  });
});

// ── THE GEOMETRY RESET (ruling 6's ⚖ clause) ─────────────────────────────────────────────────────────
describe("the fleet lands at the TOP after a geometry change", () => {
  /** A real `#app-scroll` with a spy on it — the shell's one content pane, which these isolated renders do
   *  not otherwise have (`GachaFleet` is rendered without DefaultRoot around it). Torn down per case: the
   *  body reaches the pane BY ID, so a leftover from a previous case would be the one it found. */
  let pane: HTMLElement;
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    pane = document.createElement("div");
    pane.id = "app-scroll";
    scrollTo = vi.fn();
    // the DOM signature is overloaded (options | x,y), which a bare mock cannot satisfy
    pane.scrollTo = scrollTo as unknown as typeof pane.scrollTo;
    document.body.appendChild(pane);
  });
  afterEach(() => pane.remove());
  /** The reset is queued as a MICROTASK (it has to land after the shell's own restore effect, which runs
   *  later in the same flush because effects go child-first). Draining it is one awaited tick. */
  const drain = () => act(async () => {});

  it("does NOT scroll on mount — a fresh boot is not a geometry change", async () => {
    render(<GachaFleet active />);
    await drain();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls to the top when the BANNER form changes", async () => {
    render(<GachaFleet active />);
    await drain();
    act(() => setThemeSetting("gacha", "banner", "off"));
    await drain();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("scrolls to the top when the LAYOUT changes", async () => {
    render(<GachaFleet active />);
    await drain();
    act(() => setThemeSetting("gacha", "fleetLayout", "poster"));
    await drain();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("WAITS for the fleet to be showing — the scroller is shared with every other section", async () => {
    // Both settings live in Conf, so the change almost always lands while the fleet is hidden. Resetting
    // then would scroll the page the owner is actually reading and record THAT as its position, so the
    // change is latched and spent when the fleet comes back.
    const { rerender } = render(<GachaFleet active={false} />);
    await drain();
    // `off`, not `minimal`: `minimal` IS the default since the owner's 08-09 ruling, so writing it would
    // leave the geometry key unchanged and the case would pass without ever arming the latch.
    act(() => setThemeSetting("gacha", "banner", "off"));
    await drain();
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(<GachaFleet active />);
    await drain();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("does NOT reset on a NET-ZERO hidden round trip (Codex E3 LOW)", async () => {
    // The state is the geometry LAST SHOWN, not a dirty flag, and this is the case that tells them apart:
    // leave for another section, flip the banner and flip it back, return. The stored offset is still an
    // offset into exactly the page it was taken on, so throwing it away would be a pointless jump to the
    // top. `minimal -> off -> minimal` because `minimal` is the default since 2026-08-09 — the round trip
    // has to START from what actually ships.
    const { rerender } = render(<GachaFleet active />);
    await drain();
    rerender(<GachaFleet active={false} />);
    act(() => setThemeSetting("gacha", "banner", "off"));
    act(() => setThemeSetting("gacha", "banner", "minimal"));
    await drain();
    rerender(<GachaFleet active />);
    await drain();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("…but a hidden round trip that does NOT net out still resets", async () => {
    // The control for the case above: same shape, one different endpoint. Without it, "no reset after a
    // round trip" would also pass for a latch that had simply stopped working while hidden.
    const { rerender } = render(<GachaFleet active />);
    await drain();
    rerender(<GachaFleet active={false} />);
    act(() => setThemeSetting("gacha", "banner", "off"));
    act(() => setThemeSetting("gacha", "banner", "on"));
    await drain();
    rerender(<GachaFleet active />);
    await drain();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("spends the latch ONCE — coming back to a fleet nobody re-shaped does not move it", async () => {
    const { rerender } = render(<GachaFleet active />);
    await drain();
    act(() => setThemeSetting("gacha", "banner", "off")); // a real change from the `minimal` default
    await drain();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    rerender(<GachaFleet active={false} />);
    rerender(<GachaFleet active />);
    await drain();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

// ── …AND THE SAME RESET THROUGH THE REAL SHELL (Codex E3 MED) ───────────────────────────────────────
// The unit cases above mount `GachaFleet` beside a SYNTHETIC `#app-scroll`, where `DefaultRoot`'s own
// per-section restore never runs — so they cannot see the one property the microtask exists for. Replace
// the `queueMicrotask` with a direct call and every one of them still passes.
//
// This mounts the real shell: `GachaRoot` renders `DefaultRoot`, which owns the scroller, the section
// switch and the stored-offset map. The claim is an ORDERING one — on the commit that shows the fleet
// again, the shell restores its stale offset and gacha's reset has to land AFTER it — and ordering is
// only observable where both effects actually exist.
//
// StrictMode, per the review: the double-invoked mount effects are exactly where a reset keyed on
// anything less stable than "the geometry last shown" would fire spuriously.
//
// The intermediate section is UTILS on the 4-tab preset, not Conf: Conf is a lazy chunk (the reason
// `sectionScroll.test.tsx` avoids it too) and the Agent section is the one the shell deliberately never
// positions, which would make the "hidden section untouched" arm vacuous. Utils is on-bar and eager.
describe("the geometry reset, through the REAL shell (the ordering pin)", () => {
  const drawShell = (): HTMLElement => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <StrictMode>
        <QueryClientProvider client={qc}>
          <GachaRoot />
        </QueryClientProvider>
      </StrictMode>,
    );
    const scroller = container.querySelector<HTMLElement>("#app-scroll")!;
    // `useScrollKeep` is a MODULE slot: a previous test's unmount saved into it and this mount just
    // consumed the one-run skip. Normalise to a known 0 and record it, as a real scroll would.
    act(() => {
      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);
    });
    scrollCalls.length = 0;
    return scroller;
  };
  /** Scroll the pane like a finger would: move it, then let the shell's passive listener see it. */
  const scrollPane = (el: HTMLElement, y: number): void => {
    act(() => {
      el.scrollTop = y;
      fireEvent.scroll(el);
    });
  };
  const go = (tab: string) => act(() => setUI({ tab: tab as never }));
  const drain = () => act(async () => {});

  beforeEach(() => {
    // 4-tab so utils is an on-bar, unhosted, EAGER section (gacha's own default is 3-tab, which hosts
    // utils inside the lazy Conf chunk). Set before anything is recorded: a section-layout change drops
    // the shell's whole offset map by design.
    setUI({ layout: "4-tab", appbarMode: "visible" });
    scrollCalls.length = 0;
  });
  afterEach(() => setUI({ layout: "auto" }));

  it("beats the shell's own restore — the fleet lands at 0 even though a stale offset was restored", async () => {
    const scroller = drawShell();
    scrollPane(scroller, 240); // the shell records fleet:240 against the CURRENT geometry
    go("utils");
    scrollCalls.length = 0;

    // …the owner changes the banner while the fleet is hidden. `off`, because `minimal` is the default
    // since 2026-08-09 and writing the default would be a no-op change that proves nothing.
    act(() => setThemeSetting("gacha", "banner", "off"));
    await drain();
    expect(scrollCalls, "the section the owner is actually reading must not move").toEqual([]);

    go("fleet");
    await drain();
    // BOTH halves, and the first is what makes the second mean anything: the shell really did try to put
    // the pane back at 240, and gacha's reset still had the last word.
    expect(scrollCalls[0], "the shell must have attempted its stored restore").toEqual([0, 240]);
    expect(scrollCalls.at(-1), "…and the reset must land AFTER it").toEqual([0, 0]);
    expect(scroller.scrollTop).toBe(0);
  });

  it("leaves an UNCHANGED fleet on its stored offset — the shell's feature still works under gacha", async () => {
    // The other side of the ordering claim. If the reset fired on every return to the fleet, the shell's
    // per-section restoration would be dead under this theme and nobody would notice from the tests above.
    const scroller = drawShell();
    scrollPane(scroller, 180);
    go("utils");
    go("fleet");
    await drain();
    expect(scroller.scrollTop).toBe(180);
  });
});

// ── THE SETTINGS ROW (the E3 contract half) ──────────────────────────────────────────────────────────
describe("`banner` — the row itself", () => {
  const gacha = registry.gacha!;

  it("offers exactly on · minimal · off, in that ladder order, with `minimal` the default", () => {
    const field = gacha.settings!.banner;
    expect(field.type).toBe("seg");
    expect(field.type === "seg" && field.options.map((o) => o.val)).toEqual([
      "on",
      "minimal",
      "off",
    ]);
    expect(field.type === "seg" && field.options.map((o) => o.label)).toEqual([
      "On",
      "Minimal",
      "Off",
    ]);
    // OWNER RULING (live on the dev units, 2026-08-09): "it looks better than the full on banner".
    // The §12.6 settings table's `on (default)` is superseded — it was written before the strip existed
    // to be walked. The ORDER is untouched: it is the ladder's, not default-first.
    expect(field.default).toBe("minimal");
    expect(field.label).toBe("Pickup banner");
    expect(field.desc).toBe(GACHA_COPY.settingBannerDesc);
  });

  it("is THEME-WIDE: no `showWhen`, and the row shows under every layout", () => {
    // The ruling, as a test. The banner is one instance handed to whichever layout is drawing, so its
    // form belongs to the theme — unlike `posterName`, which is meaningless outside the layout it names.
    const field = gacha.settings!.banner;
    expect((field as { showWhen?: unknown }).showWhen).toBeUndefined();
    for (const layout of LAYOUTS)
      expect(settingRowVisible("gacha", "banner", field, layout), layout).toBe(true);
  });

  it("adds NO glyph to the frozen subset — its JP tail is the banner's own hero tag", () => {
    // The standing rule for a new descriptor (see `settingCardNameFontDesc`): reach for a word the subset
    // already carries and the copy edit stays a copy edit instead of a font regeneration. 開催 is
    // `heroTag`'s own word, printed on the slide this row governs.
    expect(GACHA_COPY.settingBannerDesc).toContain("開催");
    for (const glyph of [...GACHA_COPY.settingBannerDesc].filter((c) => c.codePointAt(0)! > 0x7f))
      expect(
        GACHA_COPY.heroTag.includes(glyph) || GACHA_COPY.settingStarsDesc.includes(glyph),
        `${glyph} is a NEW glyph — re-run \`npm run fonts:gacha\` and commit the subsets`,
      ).toBe(true);
  });
});

// ── THE STYLESHEET CLAIMS (jsdom paints none of this) ────────────────────────────────────────────────
describe("the tri-state's stylesheet claims", () => {
  const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
  /** One selector's declaration block (values carry no braces, so scanning to the next `}` is exact). */
  const blockFor = (sel: string): string | null => {
    const at = css.indexOf(`\n    ${sel} {`);
    return at < 0 ? null : css.slice(at, css.indexOf("}", at));
  };
  /** The minimal form's rules, addressed the way they are authored: the FLOW SEAT. */
  const min = (tail: string): string | null =>
    blockFor(`body[data-gc-banner="minimal"] .tab > .gc-banner${tail}`);

  it("gives the head back its seam under `off`, beating the poster's tuned pad", () => {
    // The banner was the tab's first child and carried no top space of its own, so the head's 22px was
    // air between two boxes — not the appbar->content seam it inherits when the banner leaves.
    expect(blockFor('body[data-gc-banner="off"] .tab > .gc-track-head')).toContain(
      "padding-top: 0",
    );
    // The capsule head's own shipped numbers are untouched (the poster suite pins the same literal).
    expect(blockFor(".gc-track-head")).toContain("padding: 22px 14px 10px");
    // …and the poster's tuned seam is still 8px: the null beats it on SPECIFICITY (a `.tab >` child
    // combinator against a bare descendant), so neither block depends on the other's position in the file.
    expect(blockFor('body[data-gc-fleet="poster"] .gc-track-head')).toContain(
      "--po-head-pad-top: 8px",
    );
  });

  it("ships the strip height as ONE named token, seeded at the lab's 88px", () => {
    // The device-round tunable (E5). The lab calls it `--bn-h-strip`; the cover already carries the same
    // number as `--cv-bn-h`, and the two seats stay separately named because they are separately walked.
    expect(min("")).toContain("--gc-bn-h-min: 88px");
    expect(min("")).toContain("height: var(--gc-bn-h-min)");
    expect(css.split("--gc-bn-h-min:").length - 1, "declared exactly once").toBe(1);
    // the band's own height is NOT touched — `on` has no rule in this block at all
    expect(blockFor(".gc-banner")).toContain("height: 232px");
  });

  it("RE-AUTHORS the strip rather than clipping the band (the ⚖ ruling)", () => {
    // Every number the lab's `.bn[data-size="strip"]` block re-scales, present here: if `minimal` were
    // "height + caption hide" this test would be four assertions shorter, which is exactly why it is
    // written as an inventory.
    expect(min(" .gc-banner-copy")).toContain("bottom: 9px");
    expect(min(" .gc-banner-copy .tag")).toContain("font-size: 7px");
    expect(min(" .gc-banner-copy b")).toContain("font-size: 16px");
    expect(min(" .gc-banner-rate span")).toContain("font-size: 7px");
    expect(min(" .gc-banner-dots")).toContain("bottom: 8px");
    expect(min(" .gc-dot")).toContain("width: 14px");
    // the caption is the strip's one omission, and it is a RULE — the node stays in the DOM
    expect(min(" .gc-banner-copy small")).toContain("display: none");
  });

  it("keeps the strip's dots as tappable as the band's (where the lab must NOT be followed)", () => {
    // The lab's dots are decorative `<i>`; ours are buttons with an invisible 24px box over a 7px pip.
    // Shrinking the pip without growing the box would quietly hand the owner an 18px touch target.
    expect(blockFor(".gc-dot::before")).toContain("inset: -9px -2px");
    expect(min(" .gc-dot::before")).toContain("inset: -9px -5px");
  });

  it("the FLEET WALLPAPER is banner-blind — `off` removes a banner, not the backdrop", () => {
    // The matrix cell the two adjacent rows invite someone to break. The wallpaper paints on `.kit-main`
    // under its own two-attribute rule; if any wallpaper rule ever read the banner axis, turning the
    // banner off would take the fleet's scenery with it.
    expect(blockFor('body[data-wallpaper="on"][data-tab="fleet"] .kit-main')).toBeTruthy();
    for (const { selector } of selectorsMentioning(css, "data-wallpaper"))
      expect(selector, `${selector} must not read the banner axis`).not.toContain("data-gc-banner");
  });

  it("the `on` form has no rule at all — the shipped band is the BASE declaration", () => {
    // Unchanged by the 08-09 default flip, and worth saying why: `minimal` ships now, but it ships as an
    // OVERRIDE on top of the band, which is still what the stylesheet calls normal. So the axis has no
    // `on` block, the band cannot move by accident, and picking `On` in the picker resolves to exactly
    // the v1.5.0 form rather than to a re-derivation of it.
    expect(css).not.toContain('[data-gc-banner="on"]');
  });

  /** THE ONE SIGNED EXCEPTION to the flow-seat scoping (main-seat ruling, E3 fix wave). Listed here, as
   *  its own constant, so the guard below stays a guard: a new `[data-gc-banner` selector is either
   *  flow-seat-scoped or it is literally in this list, and there is no third way to get in. */
  const COVER_REFLOW = ['body[data-gc-banner="off"] .cv-frame'];

  it("every tri-state rule is scoped to the FLOW SEAT — with ONE enumerated cover exception", () => {
    // THE DISJOINTNESS CLAIM, enumerated. The cover seats the same banner instance inside `.cv-strap` and
    // already ships its own authored strip (the E2 signed exception); this block must not be able to
    // reach it, or picking `minimal` would silently restyle the cover's strapline — its display line in
    // particular, which is container-relative there and a fixed 16px here.
    //
    // ⚠ CONSCIOUSLY AMENDED, NOT LOOSENED (the E2 eyeball-① precedent). The first form of this test
    // required EVERY tri-state rule to be flow-seat-scoped, which was right for `minimal` — a skin — and
    // wrong for `off`, which is a re-flow: the cover's floors RESERVE the strapline, so leaving them
    // alone under `off` keeps ~88px of empty band over the footer. The lab ruled that case explicitly
    // ("each screen must RE-FLOW, not just lose a strip") and the main seat ruled it in for E3, so the
    // exception is PINNED BY NAME below rather than let through by relaxing the predicate.
    //
    // Read as RULES, not as lines (Codex E2 MED-4): a multi-line selector list walks straight past a
    // line-anchored regex, which is a false negative in a guard whose whole job is to fail.
    const scoped = selectorsMentioning(css, "[data-gc-banner").map(({ selector }) => selector);
    expect(scoped.length, "the stamp must have consumers").toBeGreaterThan(0);
    for (const selector of scoped.filter((s) => !COVER_REFLOW.includes(s))) {
      expect(selector, `${selector} must address the tab's own flow`).toContain(".tab > ");
      expect(selector, `${selector} must not reach the cover's seat`).not.toContain(".cv-");
      // it may only ever address the banner or the head the banner's absence exposes
      expect(selector).toMatch(/\.tab > \.gc-(banner|track-head)/);
    }
    // the exception list is EXACT in both directions — every member present, no member unused
    expect(scoped.filter((s) => s.includes(".cv-")).sort()).toEqual([...COVER_REFLOW].sort());
    // …and the converse: no rule anywhere else in the file has quietly taken the stamp into the cover's
    // own banner enumeration (`gachaCover.test.tsx` lists every `.cv-strap`-scoped banner rule and would
    // fail too). The re-flow is scoped to `.cv-frame`, the SEAT's container, never to the seat.
    const covered = selectorsMentioning(css, ".cv-strap").map(({ selector }) => selector);
    for (const sel of covered)
      expect(sel, `${sel} must not mix the seat with the stamp`).not.toContain("[data-gc-banner");
  });

  it("the cover RE-FLOWS under `off` — the lab's walked floors, on production's anchor", () => {
    // THE LAB'S NUMBERS, VERIFIED IN ITS OWN STYLESHEET, not echoed: B seats `.cv-foot` at 70 and
    // `.cv-strap` at 102, floors the hero copy at 212 and the cut-in stack at 202 WITH the strip, and
    // drops them to 116 and 126 without it. Against the strap anchor those are +110/+100 on and
    // +14/+24 off — and production's `--cv-strap` is the composer-derived twin of that 102 (the E2 seed
    // swap), so the intervals port unchanged while the whole composition still clears the real chrome.
    const off = blockFor('body[data-gc-banner="off"] .cv-frame')!;
    expect(off).toContain("--cv-herocopy: calc(var(--cv-strap) + 14px)");
    expect(off).toContain("--cv-side-floor: calc(var(--cv-strap) + 24px)");
    // it moves FLOORS and nothing else — no paint, no new box, no second chain
    expect(off.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /(^|[\s;])(background|position|inset|display|height|width)/,
    );
    // …and the ON chain it overrides is untouched, still derived off the same anchor
    const frame = blockFor(".cv-frame")!;
    expect(frame).toContain("--cv-side-floor: calc(var(--cv-strap) + 100px)");
    expect(frame).toContain("--cv-herocopy: calc(var(--cv-strap) + 110px)");
    // THE PAIR INVERTS, by ruling rather than by arithmetic: with the strip gone the bottom-TRAILING
    // hero copy comes down closer to the footer than the cut-in COLUMN does, because the column runs
    // down the leading edge straight into the barcode at the footer's left. So a "both floors drop by
    // the strip height" simplification is a regression, not a tidy-up — pinned as the relation, which
    // is the part that carries the meaning.
    const gap = (block: string, name: string): number =>
      Number(new RegExp(`${name}: calc\\(var\\(--cv-strap\\) \\+ (\\d+)px\\)`).exec(block)![1]);
    expect(gap(off, "--cv-herocopy")).toBeLessThan(gap(off, "--cv-side-floor"));
    expect(gap(frame, "--cv-herocopy")).toBeGreaterThan(gap(frame, "--cv-side-floor"));
  });

  it("leaves the WALLPAPER banner shadow exactly as it is — an OPEN E3 question, recorded", () => {
    // `body[data-wallpaper="on"] .gc-banner` swaps in the heavier `--gc-banner-shadow-wall` drop, which
    // was drawn for a 232px band. Under `minimal` an 88px strip wears the same shadow, and whether that
    // reads as seated or as smudged is an EYEBALL call — accepted-or-overridden by the owner at E3/E5,
    // not by the implementer. Pinned as "unchanged" so an override is a deliberate edit with a ruling
    // behind it rather than a drive-by.
    expect(blockFor('body[data-wallpaper="on"] .gc-banner')).toContain(
      "box-shadow: var(--gc-banner-shadow-wall)",
    );
    for (const { selector } of selectorsMentioning(css, "--gc-banner-shadow-wall"))
      expect(splitSelectors(selector), "the wall shadow is still mode-blind").not.toContain(
        "[data-gc-banner",
      );
  });
});
