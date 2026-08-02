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
    expect(container.querySelector('[aria-label="open pegasus dossier, online"]')).not.toBeNull();
    // the SLEEPING host still gets a promo — the membership ruling, not implementer latitude
    expect(container.querySelector('[aria-label="open atlas dossier, sleeping"]')).not.toBeNull();
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

describe("the gesture, wired to the machine", () => {
  // The reducer itself is exhaustively covered in gachaCarousel.test.ts; these prove the COMPONENT is
  // actually driving it — the pointer sequence reaches the machine, its effects reach the strip, and the
  // click the browser fires after a drag is the one that gets swallowed.
  const drag = (banner: Element, dx: number, dy = 2): void => {
    fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(banner, { pointerId: 1, clientX: 200 + dx / 2, clientY: 100 + dy });
    fireEvent.pointerMove(banner, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy });
    fireEvent.pointerUp(banner, { pointerId: 1 });
  };

  it("a leftward drag advances the strip, and the click that follows is swallowed", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      drag(banner, -100);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);
    // …and the promo the finger came to rest on must NOT open (the §6.4 `moved` flag, read in capture)
    expect(fireEvent.click(slides(container)[1].querySelector("button")!)).toBe(false);
  });

  it("an under-slop press leaves the strip alone and lets the click through", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      drag(banner, -4, 1);
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false); // still the hero
    expect(fireEvent.click(slides(container)[0])).toBe(true);
  });

  it("VERTICAL intent never moves the strip (the page keeps scrolling)", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(banner, { pointerId: 1, clientX: 196, clientY: 160 });
      fireEvent.pointerUp(banner, { pointerId: 1 });
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false);
  });

  it("a pointercancel mid-drag resolves the gesture instead of stranding it", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(banner, { pointerId: 1, clientX: 120, clientY: 102 });
      fireEvent.pointerCancel(banner, { pointerId: 1 });
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false); // snapped back, not advanced
    // and the machine is idle again: a fresh drag still works
    act(() => {
      drag(banner, -100);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);
  });
});

describe("the capsule track (§6.1/§6.2)", () => {
  const cards = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>(".gc-card")];

  it("renders one card per host, in the ruled geometry", () => {
    setFleet({ hosts: [host("a", true), host("b", true), host("c", false), host("d", true)] });
    const { container } = render(<GachaFleet active />);
    expect(cards(container).map((el) => el.className)).toEqual([
      "gc-card feat",
      "gc-card pair",
      "gc-card pair sleep",
      "gc-card wide",
    ]);
  });

  it("gives every card the SAME roster entry its promo slide got", () => {
    const { container } = render(<GachaFleet active />);
    const cardArt = [...container.querySelectorAll<HTMLImageElement>(".gc-card img")].map((i) =>
      i.getAttribute("src"),
    );
    const promoArt = [...container.querySelectorAll<HTMLImageElement>(".gc-slide img")]
      .slice(1)
      .map((i) => i.getAttribute("src"));
    // The bundled roster has no `wide` variants, so both crops resolve to the same file — which is exactly
    // the agreement the one-resolver ruling is about.
    expect(cardArt).toEqual(promoArt);
  });

  it("cycles the roster when there are MORE hosts than entries (never a placeholder)", () => {
    setFleet({ hosts: Array.from({ length: 6 }, (_, i) => host(`h${i}`, true)) });
    const { container } = render(<GachaFleet active />);
    const srcs = [...container.querySelectorAll<HTMLImageElement>(".gc-card img")].map(
      (i) => i.src,
    );
    expect(srcs).toHaveLength(6);
    expect(srcs[4]).toBe(srcs[0]); // 4 bundled characters → host 4 wraps back to host 0's
    expect(new Set(srcs).size).toBe(4);
  });

  it("draws stars from CONFIGURED services, and re-draws the ladder when the mode changes", () => {
    const svc = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `s${i}`,
        kind: null,
        port: null,
        path: "/",
        autostart: false,
        cmd: {},
      }));
    setFleet({ hosts: [host("a", true, { services: svc(4) }), host("b", true, { services: [] })] });
    const { container, rerender } = render(<GachaFleet active />);
    const rarity = () =>
      [...container.querySelectorAll(".gc-card .rar")].map((el) => el.textContent?.length);
    // 5-star mode: 4 services → 4 stars; zero services → the ruled ★1 floor
    expect(rarity()).toEqual([4, 1]);

    act(() => {
      setUI({ themeSettings: { gacha: { starMode: "three" } } });
    });
    rerender(<GachaFleet active />);
    // 3-star mode compresses the middle: 4 services → 3, and the floor still holds
    expect(rarity()).toEqual([3, 1]);
  });

  it("paints only the TOP rungs of the ladder in rose-gold (§6.2)", () => {
    const svc = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `s${i}`,
        kind: null,
        port: null,
        path: "/",
        autostart: false,
        cmd: {},
      }));
    setFleet({
      hosts: [host("a", true, { services: svc(5) }), host("b", true, { services: svc(2) })],
    });
    const { container } = render(<GachaFleet active />);
    const [five, two] = [...container.querySelectorAll(".gc-card .rar")];
    expect(five.querySelectorAll("i.hi")).toHaveLength(2); // ★4 and ★5
    expect(two.querySelectorAll("i.hi")).toHaveLength(0); // a ★2 card is all gold
  });

  it("states the machine on the chip AND in the button's accessible name", () => {
    const { container } = render(<GachaFleet active />);
    const [awake, asleep] = cards(container);
    expect(awake.querySelector(".state")!.textContent).toBe("ONLINE");
    expect(asleep.querySelector(".state")!.textContent).toBe("SLEEPING");
    expect(awake.getAttribute("aria-label")).toBe("open pegasus dossier, online");
    expect(asleep.getAttribute("aria-label")).toBe("open atlas dossier, sleeping");
  });

  it("carries the plate's ROLE line, with the frozen standing-by copy while asleep", () => {
    const { container } = render(<GachaFleet active />);
    const [awake, asleep] = cards(container);
    expect(awake.querySelector(".plate small")!.textContent).toContain("18 ms");
    expect(asleep.querySelector(".plate small")!.textContent).toContain(GACHA_COPY.cardSleeping);
  });

  it("counts online / total in the head, held until the fleet resolves", () => {
    const { container, unmount } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track-head .count")!.textContent).toBe("01 / 02");
    unmount();

    setFleet({ hosts: [], isLoading: true });
    const pending = render(<GachaFleet active />);
    expect(pending.container.querySelector(".gc-track-head .count")!.textContent).not.toContain(
      "0",
    );
  });

  it("replaces the track with an honest message on error — but keeps the banner standing", () => {
    setFleet({ hosts: [], error: new Error("nope") });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track")).toBeNull();
    expect(container.querySelector(".gc-msg")!.textContent).toContain("nope");
    expect(container.querySelector(".gc-banner")).not.toBeNull();
  });

  it("renders nothing under the head while the FIRST poll is still in flight", () => {
    setFleet({ hosts: [], isLoading: true });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track")).toBeNull();
    expect(container.querySelector(".gc-msg")).toBeNull();
  });

  it("opens through the SHARED seam — the same handler the promo slides use", () => {
    const { container } = render(<GachaFleet active />);
    // The seam is a stub until G2; what G1 owns is that pressing a card is a real, named button action
    // that does not throw and does not navigate anywhere yet.
    expect(() =>
      act(() => {
        fireEvent.click(cards(container)[0]);
      }),
    ).not.toThrow();
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
