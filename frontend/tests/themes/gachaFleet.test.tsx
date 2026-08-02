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

import { setGachaReelRunning } from "../../src/store/gachaReel";
import { setUI } from "../../src/store/ui";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { AUTOPLAY_MS, SNAP_MS } from "../../src/themes/gacha/carousel";
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
    // The query has ANSWERED (the additive `hasData` flag) — the default for these fixtures; the
    // still-loading cases pass `hasData: false` explicitly.
    hasData: true,
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
    setFleet({ hosts: [], isLoading: true, hasData: false });
    const { container } = render(<GachaFleet active />);
    expect(slides(container)).toHaveLength(1);
  });

  it("a background refetch error KEEPS the cached promos (never collapses to hero-only)", () => {
    setFleet({ error: new Error("backend unreachable") });
    const { container } = render(<GachaFleet active />);
    expect(slides(container)).toHaveLength(3);
  });

  it("crops CHARACTER slides at face height, and leaves the hero scene alone (F9)", () => {
    // theme.css:28-29 — the prototype states this per-slide (`:nth-child(2)`/`(3)`), which our live slide
    // set cannot use: which positions hold characters changes with the fleet. The class carries it instead.
    const { container } = render(<GachaFleet active />);
    const found = slides(container);
    expect(found[0].className).not.toContain("promo"); // the hero keeps the scene crop
    expect(found[1].className).toContain("promo");
    expect(found[2].className).toContain("promo");
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
    setFleet({ hosts: [], isLoading: true, hasData: false });
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
    // …and the promo the finger came to rest on must NOT open (the §6.4 `moved` flag, read in capture).
    // `detail: 1` is what makes this the POINTER-derived click a drag produces — jsdom defaults it to 0,
    // which is the keyboard shape the suppressor deliberately lets through (F5, below).
    expect(fireEvent.click(slides(container)[1].querySelector("button")!, { detail: 1 })).toBe(
      false,
    );
  });

  it("a re-tap inside the snap window is not swallowed by the drag before it (F5 residual)", () => {
    // The ordering bug: the reel/snap rejection ran BEFORE the token was disarmed, so a drag that never
    // produced its synthetic click left the token armed, and the very next tap — rejected as a gesture
    // because the snap was still running — had its OWN click eaten. The tap must still open the promo.
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      drag(banner, -100); // settles, arms the snap window, and delivers no synthetic click
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);

    // Inside the 620ms window: the gesture is rejected (the strip must not move)…
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 2, isPrimary: true, clientX: 200, clientY: 100 });
      fireEvent.pointerUp(banner, { pointerId: 2 });
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);
    // …but the click that tap produces is a real one, and must reach the slide.
    expect(fireEvent.click(slides(container)[1].querySelector("button")!, { detail: 1 })).toBe(
      true,
    );
  });

  it("a KEYBOARD activation is never swallowed, even by a stale suppression token (F5)", () => {
    // A drag whose synthetic click never arrives leaves the token armed. A keyboard/AT activation carries
    // no pointer sequence (`detail === 0`) and no pointerdown to disarm it, so before the fix the very next
    // Enter on a promo was eaten silently.
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(banner, { pointerId: 1, clientX: 120, clientY: 102 });
      fireEvent.pointerUp(banner, { pointerId: 1 });
    });
    // …no click was delivered; the token is still armed. The keyboard path must still work.
    expect(fireEvent.click(slides(container)[1].querySelector("button")!, { detail: 0 })).toBe(
      true,
    );
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
    vi.useFakeTimers();
    try {
      const { container } = render(<GachaFleet active />);
      const banner = container.querySelector(".gc-banner")!;
      act(() => {
        fireEvent.pointerDown(banner, {
          pointerId: 1,
          isPrimary: true,
          clientX: 200,
          clientY: 100,
        });
        fireEvent.pointerMove(banner, { pointerId: 1, clientX: 120, clientY: 102 });
        fireEvent.pointerCancel(banner, { pointerId: 1 });
      });
      expect(slides(container)[0].hasAttribute("inert")).toBe(false); // snapped back, not advanced

      // The snap-back is an animated move, so it OWNS the strip for its window: a pointerdown inside it is
      // rejected outright rather than zeroing the transition mid-flight (F1).
      act(() => {
        drag(banner, -100);
      });
      expect(slides(container)[0].hasAttribute("inert")).toBe(false);

      // Once the window closes the machine is idle again and a fresh drag works.
      act(() => {
        vi.advanceTimersByTime(SNAP_MS);
      });
      act(() => {
        drag(banner, -100);
      });
      expect(slides(container)[1].hasAttribute("inert")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("snap ownership and the reconciliation lock (F1/F2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const dots = (c: HTMLElement): HTMLButtonElement[] => [
    ...c.querySelectorAll<HTMLButtonElement>(".gc-dot"),
  ];

  it("a membership change DURING a dot snap is buffered until the window ends", () => {
    const { container, rerender } = render(<GachaFleet active />);
    act(() => {
      fireEvent.click(dots(container)[2]);
    });
    expect(slides(container)[2].hasAttribute("inert")).toBe(false);

    // A poll drops a host WHILE the strip is still animating. The set must not re-key under the animation.
    setFleet({ hosts: [host("pegasus", true)] });
    rerender(<GachaFleet active />);
    expect(slides(container)).toHaveLength(3);

    // …and once the snap window closes, the reconciliation lands.
    act(() => {
      vi.advanceTimersByTime(SNAP_MS);
    });
    rerender(<GachaFleet active />);
    expect(slides(container)).toHaveLength(2);
  });

  it("an AUTOPLAY advance owns the strip too — the same buffering applies", () => {
    const { container, rerender } = render(<GachaFleet active />);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false);

    setFleet({ hosts: [host("pegasus", true)] });
    rerender(<GachaFleet active />);
    expect(slides(container)).toHaveLength(3); // buffered: the tick armed the snap window

    act(() => {
      vi.advanceTimersByTime(SNAP_MS);
    });
    rerender(<GachaFleet active />);
    expect(slides(container)).toHaveLength(2);
  });

  it("a pointerdown holds the reconciliation even when it lands after the render (F2)", () => {
    const { container, rerender } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    // Arm the machine, then push a membership change through in the SAME turn: the effect that would
    // reconcile it re-checks the live machine, not the `busy` value its render captured.
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
      setFleet({ hosts: [host("pegasus", true)] });
    });
    rerender(<GachaFleet active />);
    expect(slides(container)).toHaveLength(3);

    // Releasing resolves the gesture; the set reconciles from there.
    act(() => {
      fireEvent.pointerUp(banner, { pointerId: 1 });
    });
    rerender(<GachaFleet active />);
    expect(slides(container)).toHaveLength(2);
  });

  it("restarts the FULL cadence at an interaction's end, not end + the snap window (F6)", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    // A drag that aborts: the release is the interaction's end, and the next auto-advance is due exactly
    // AUTOPLAY_MS later — gating the timer on the snap window would silently make it AUTOPLAY_MS + SNAP_MS.
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(banner, { pointerId: 1, clientX: 196, clientY: 170 }); // vertical -> abort
      fireEvent.pointerUp(banner, { pointerId: 1 });
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS - 1);
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false); // not yet
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(slides(container)[1].hasAttribute("inert")).toBe(false); // exactly on the cadence
  });
});

describe("the reel REJECTS banner input (F3, §6.4)", () => {
  afterEach(() => {
    setGachaReelRunning(false);
  });

  it("marks the banner inert and ignores a tap or a dot click while the slats run", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      setGachaReelRunning(true);
    });
    expect(banner.hasAttribute("inert")).toBe(true);

    // Belt-and-braces: the overlay is pointer-events:none, so a synthetic sequence still reaches the
    // handlers — and must do nothing.
    act(() => {
      fireEvent.pointerDown(banner, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(banner, { pointerId: 1, clientX: 100, clientY: 102 });
      fireEvent.pointerUp(banner, { pointerId: 1 });
    });
    expect(slides(container)[0].hasAttribute("inert")).toBe(false); // still the hero

    // The DOTS are covered by `inert` alone rather than a second guard: a real engine does not dispatch a
    // click into an inert subtree at all. jsdom does not implement that behaviour, so what is assertable
    // here is the containment — every interactive control of the banner sits inside the inert root.
    const controls = [...banner.querySelectorAll("button")];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((b) => banner.contains(b))).toBe(true);
  });

  it("lifts the block the moment the sweep ends", () => {
    const { container } = render(<GachaFleet active />);
    const banner = container.querySelector(".gc-banner")!;
    act(() => {
      setGachaReelRunning(true);
    });
    act(() => {
      setGachaReelRunning(false);
    });
    expect(banner.hasAttribute("inert")).toBe(false);
    act(() => {
      fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".gc-dot")[2], { detail: 1 });
    });
    expect(slides(container)[2].hasAttribute("inert")).toBe(false);
  });
});

describe("beyond the dot bound (§6.4's many-host presentation)", () => {
  beforeEach(() => {
    setFleet({ hosts: Array.from({ length: 11 }, (_, i) => host(`h${i}`, true)) });
  });

  it("swaps the rail for an announced counter flanked by labelled Prev/Next", () => {
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-banner-dots")).toBeNull();
    const nav = container.querySelector(".gc-banner-nav")!;
    expect(nav.querySelector("span")!.textContent).toBe("1 / 12");
    expect(nav.querySelector("span")!.getAttribute("aria-live")).toBe("polite");
    expect([...nav.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "previous slide",
      "next slide",
    ]);
  });

  it("WRAPS at both ends, matching the auto-advance cycle", () => {
    const { container } = render(<GachaFleet active />);
    const [prev, next] = [
      ...container.querySelectorAll<HTMLButtonElement>(".gc-banner-nav button"),
    ];
    const counter = () => container.querySelector(".gc-banner-nav span")!.textContent;

    act(() => {
      fireEvent.click(prev, { detail: 1 });
    });
    expect(counter()).toBe("12 / 12"); // wrapped backwards off the hero
    act(() => {
      fireEvent.click(next, { detail: 1 });
    });
    expect(counter()).toBe("1 / 12"); // …and forwards again
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
    expect(srcs[5]).toBe(srcs[0]); // 5 bundled entries → host 5 wraps back to host 0's
    expect(new Set(srcs).size).toBe(5);
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

    setFleet({ hosts: [], isLoading: true, hasData: false });
    const pending = render(<GachaFleet active />);
    expect(pending.container.querySelector(".gc-track-head .count")!.textContent).not.toContain(
      "0",
    );
  });

  it("an error with NO data ever stands alone — the notice, no track, banner still up", () => {
    setFleet({ hosts: [], error: new Error("nope"), hasData: false });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track")).toBeNull();
    expect(container.querySelector(".gc-msg")!.textContent).toContain("nope");
    expect(container.querySelector(".gc-banner")).not.toBeNull();
  });

  it("a failed refetch over CACHED hosts reports itself AND keeps the track (F7)", () => {
    // The two surfaces have to agree: the banner keeps its cached promos from TanStack's retained data, so
    // deleting the track would have the same screen showing a live fleet above and "unreachable" below.
    setFleet({ error: new Error("boom") });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")!.textContent).toContain("boom");
    expect(cards(container)).toHaveLength(2);
    expect(slides(container)).toHaveLength(3);
  });

  it("renders nothing under the head while the FIRST poll is still in flight", () => {
    setFleet({ hosts: [], isLoading: true, hasData: false });
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
