import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gacha bespoke Fleet, rendered (D52 / GACHA_PLAN §6). `useFleet` is mocked to a fixed FleetView (the
// frontier/App harness pattern) so these exercise the BODY's own wiring — the slide set, the pill's loading
// semantics, the shared roster assignment and the carousel's a11y — rather than the query layer.
//
// The acceptance-matrix rows these carry: 0 / 1 / many hosts · a fleet that has not resolved · a background
// error over cached data · a long host name · rapid tab switching (the timer must not survive it).

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));

import { setUI } from "../../src/store/ui";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { defaultRoster, wideArtForHost } from "../../src/themes/gacha/roster";
import type { Host } from "../../src/types";

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
  status: {
    host_id: id,
    online,
    ping_ms: online ? 18 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
  ...over,
});

function setFleet(over: Record<string, unknown> = {}): void {
  fleet.view = {
    hosts: [host("pegasus", true), host("atlas", false)],
    svcByHost: new Map(),
    run: vi.fn(),
    busy: new Set<string>(),
    isLoading: false,
    error: null,
    ...over,
  };
}

const slides = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>(".gc-slide")];
const rate = (c: HTMLElement): string => c.querySelector(".gc-banner-rate span")!.textContent ?? "";

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  setFleet();
});
afterEach(cleanup);

describe("the slide set (§6.4)", () => {
  it("is the fixed hero plus ONE promo per host — sleeping ones included", () => {
    const { container } = render(<GachaFleet active />);
    const found = slides(container);
    expect(found).toHaveLength(3);
    expect(found[0].textContent).toContain("PRIZE POOL");
    expect(container.querySelector('[aria-label="open pegasus dossier"]')).not.toBeNull();
    // the SLEEPING host still gets a promo — the membership ruling, not implementer latitude
    expect(container.querySelector('[aria-label="open atlas dossier"]')).not.toBeNull();
  });

  it("marks a sleeping promo with the sleep treatment and its own frozen caption", () => {
    const { container } = render(<GachaFleet active />);
    const [, online, asleep] = slides(container);
    expect(online.className).not.toContain("sleep");
    expect(asleep.className).toContain("sleep");
    expect(asleep.textContent).toContain(GACHA_COPY.promoCaptionSleeping);
    expect(online.textContent).toContain(GACHA_COPY.promoCaptionOnline);
  });

  it("zero hosts → the hero ALONE, with no dots and nothing to autoplay", () => {
    setFleet({ hosts: [] });
    const { container } = render(<GachaFleet active />);
    expect(slides(container)).toHaveLength(1);
    expect(container.querySelector(".gc-banner-dots")).toBeNull();
  });

  it("an unresolved fleet renders the hero alone — the one slide that needs no data", () => {
    setFleet({ hosts: [], isLoading: true });
    const { container } = render(<GachaFleet active />);
    expect(slides(container)).toHaveLength(1);
  });

  it("a background refetch error KEEPS the cached promos (never collapses to hero-only)", () => {
    setFleet({ error: new Error("backend unreachable") });
    const { container } = render(<GachaFleet active />);
    expect(slides(container)).toHaveLength(3);
  });

  it("resolves promo art through the SHARED resolver, at the host's display index", () => {
    const { container } = render(<GachaFleet active />);
    const imgs = [...container.querySelectorAll<HTMLImageElement>(".gc-slide img")];
    // slide 0 is the hero; the promos take the roster entries for host index 0 and 1
    expect(imgs[1].getAttribute("src")).toBe(wideArtForHost(defaultRoster(), 0)!.url);
    expect(imgs[2].getAttribute("src")).toBe(wideArtForHost(defaultRoster(), 1)!.url);
  });
});

describe("the rate pill (§6.3)", () => {
  it("reads the live online count at the configured star ceiling", () => {
    const { container } = render(<GachaFleet active />);
    expect(rate(container)).toBe(`${GACHA_COPY.star}5 RATE 1.0%`);
  });

  it("follows the starMode setting", () => {
    setUI({ themeSettings: { gacha: { starMode: "three" } } });
    const { container } = render(<GachaFleet active />);
    expect(rate(container)).toBe(`${GACHA_COPY.star}3 RATE 1.0%`);
  });

  it("never reads a false 0.0% while the first poll is in flight", () => {
    setFleet({ hosts: [], isLoading: true });
    const { container } = render(<GachaFleet active />);
    expect(rate(container)).not.toContain("0.0");
  });

  it("…and does read 0.0% once the fleet has genuinely answered with nothing online", () => {
    setFleet({ hosts: [host("atlas", false)] });
    const { container } = render(<GachaFleet active />);
    expect(rate(container)).toContain("0.0%");
  });
});

describe("carousel semantics", () => {
  it("exposes carousel/slide roles and keeps every OFFSCREEN slide inert", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector('[aria-roledescription="carousel"]')!;
    expect(banner).not.toBeNull();
    const found = slides(container);
    expect(found[0].hasAttribute("inert")).toBe(false);
    expect(found[1].hasAttribute("inert")).toBe(true);
    expect(found[1].getAttribute("aria-hidden")).toBe("true");
    expect(found.map((s) => s.getAttribute("aria-label"))).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
  });

  it("dots are labelled buttons carrying aria-current, and move the active slide", () => {
    const { container } = render(<GachaFleet active />);
    const dots = [...container.querySelectorAll<HTMLButtonElement>(".gc-dot")];
    expect(dots).toHaveLength(3);
    expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
      "show the prize pool",
      "show pegasus",
      "show atlas",
    ]);
    expect(dots[0].getAttribute("aria-current")).toBe("true");

    act(() => {
      fireEvent.click(dots[2]);
    });
    const after = [...container.querySelectorAll<HTMLButtonElement>(".gc-dot")];
    expect(after[2].getAttribute("aria-current")).toBe("true");
    // …and the newly active slide is the one that is no longer inert
    expect(slides(container)[2].hasAttribute("inert")).toBe(false);
  });

  it("a long host name wraps rather than overflowing (the plate is bounded, unlike the prototype's)", () => {
    setFleet({ hosts: [host("a".repeat(60), true)] });
    const { container } = render(<GachaFleet active />);
    const copy = slides(container)[1].querySelector(".gc-banner-copy b")!;
    expect(copy.textContent).toHaveLength(60);
  });
});

describe("the autoplay timer (§6.4's matrix)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances one slide per cadence while the Fleet tab is showing", () => {
    const { container } = render(<GachaFleet active />);
    expect(slides(container)[0].hasAttribute("inert")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);
  });

  it("does NOT advance while the Fleet tab is hidden — an off-tab timer is a re-render for nothing", () => {
    const { container } = render(<GachaFleet active={false} />);
    act(() => {
      vi.advanceTimersByTime(5200 * 3);
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false);
  });

  it("does not advance under reduced motion", () => {
    setUI({ motion: "reduced" });
    const { container } = render(<GachaFleet active />);
    act(() => {
      vi.advanceTimersByTime(5200 * 2);
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false);
  });

  it("leaves no timer behind when the body unmounts (rapid tab switching)", () => {
    const { unmount } = render(<GachaFleet active />);
    unmount();
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(5200 * 4);
      }),
    ).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
