import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE COVER, RENDERED (GACHA_PLAN §12.6 E2) — the R25 §Q7 ⑬ pin plus the ruling-9 anatomy claims that are
// checkable without a browser. `useFleet` is mocked to a fixed FleetView and the media index to the
// fresh-install state (the `gachaFleet.test.tsx` / `gachaPoster.test.tsx` harness), so these exercise the
// LAYOUT's own wiring rather than the query layer.
//
// The layout is driven through the real Surface: `themeSettings.gacha.fleetLayout = "cover"` is what
// `fleetSurface` resolves against, so every case here also proves the E2 registration resolves end to end.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
// The static view carries every fact but ONE: `pending` is read from the REAL `store/fleetPending`
// (2026-08-30), so a tap that dispatches a wake drives the WAKING chip AND the develop ceremony's
// `devLive` gate through the same store production uses. Merged here rather than frozen into the
// fixture because the store is what MOVES during a case; everything else is a fixed backdrop.
vi.mock("../../src/hooks/useFleet", async () => {
  const { usePendingFleet } = await import("../../src/store/fleetPending");
  return { useFleet: () => ({ ...fleet.view, pending: usePendingFleet() }) };
});
const media = vi.hoisted((): { data: unknown } => ({ data: undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));

/// <reference types="node" />
// ^ the stylesheet block at the end reads gacha's CSS from disk (fs/path/process); the tests tsconfig
//   pins `types:["vitest"]`, so node's globals are pulled in explicitly.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WAKE_WINDOW_MS, beginPending, reconcilePending } from "../../src/store/fleetPending";
import { setGachaReelRunning } from "../../src/store/gachaReel";
import { dispatchingRun } from "./fleetRunMock";
import { selectorsMentioning } from "./cssRules";
import { setThemeSetting, setUI } from "../../src/store/ui";
import { settingRowVisible } from "../../src/theme-engine/settings";
import { registry } from "../../src/theme-engine/registry";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import type { Host, HostServiceCfg } from "../../src/types";

/** N CONFIGURED services — the rarity input. */
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
    hosts: [host("pegasus", true), host("atlas", false), host("vault", true)],
    svcByHost: new Map(),
    // Begins the pending record at dispatch and resolves ok, like the real `run` — see `fleetRunMock`.
    // `busy` stays the REQUEST-busy set the view is handed; production unions the pending hosts into it
    // inside `useFleet`, which is that hook's own pin, not this layout's.
    run: dispatchingRun(),
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

const cards = (c: HTMLElement): HTMLButtonElement[] => [
  ...c.querySelectorAll<HTMLButtonElement>(".cv-card"),
];
const heroCard = (c: HTMLElement): HTMLButtonElement =>
  c.querySelector<HTMLButtonElement>(".cv-heroslot .cv-card")!;
const cutCards = (c: HTMLElement): HTMLButtonElement[] => [
  ...c.querySelectorAll<HTMLButtonElement>(".cv-stack .cv-card"),
];
const heroName = (c: HTMLElement): string | null =>
  heroCard(c).querySelector(".cv-herocopy b")?.textContent ?? null;
const heroChip = (c: HTMLElement): string | null =>
  heroCard(c).querySelector(".cv-chip")?.textContent ?? null;
const live = (c: HTMLElement): string => c.querySelector(".gc-live")?.textContent ?? "";
const dossierName = (): string | null =>
  document.querySelector(".gc-dossier-title h2")?.textContent ?? null;
const runFn = (): ReturnType<typeof vi.fn> => fleet.view.run as ReturnType<typeof vi.fn>;

/** Stub `document.startViewTransition` and hold its callbacks (the `gachaFleet.test.tsx` idiom). The
 *  COVER must never use it — without the stub `viewTransitionsActive()` is false in jsdom and the
 *  "opens plain" assertion would pass vacuously. */
function deferVT() {
  const pending: (() => void)[] = [];
  const start = vi.fn((cb: () => void) => {
    pending.push(cb);
    return { ready: Promise.resolve(), finished: Promise.resolve() };
  });
  (document as { startViewTransition?: unknown }).startViewTransition = start;
  return { start, pending };
}

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  setThemeSetting("gacha", "fleetLayout", "cover");
  setFleet();
  media.data = undefined; // no owner files ⇒ the bundled cast
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    vi.restoreAllMocks();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    setGachaReelRunning(false);
    setUI({ themeSettings: {} });
    // The pending store is MODULE state with real timers behind it — a wake dispatched by one case
    // would still be WAKING in the next. Reconciling against an empty fleet is the sanctioned reset:
    // every entry's host is gone, so every entry clears and every timer is disarmed.
    reconcilePending([]);
  }
});

// ── the layout resolves, and it is the cover ─────────────────────────────────────────────────────────
describe("the cover resolves through the fleet Surface", () => {
  it("draws one hero, the rest as cut-ins, and NO capsule track", () => {
    const { container } = render(<GachaFleet active />);
    expect(cards(container)).toHaveLength(3);
    expect(cutCards(container)).toHaveLength(2);
    expect(container.querySelector(".gc-track")).toBeNull();
    expect(container.querySelector(".po-poster")).toBeNull();
  });

  it("SUPPRESSES the inherited track head — the MASTHEAD is the tab's one heading (ruling 9)", () => {
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track-head")).toBeNull();
    const heads = container.querySelectorAll("h1");
    expect(heads).toHaveLength(1);
    expect(heads[0].classList.contains("cv-mast")).toBe(true);
    // It is REAL heading content, not the lab's aria-hidden mock scaffolding.
    expect(heads[0].hasAttribute("aria-hidden")).toBe(false);
    expect(heads[0].textContent).toContain(GACHA_COPY.coverKicker);
    expect(heads[0].textContent).toContain(GACHA_COPY.coverTitle1);
    expect(heads[0].textContent).toContain(GACHA_COPY.coverTitle2);
  });

  it("prints the ISSUE line rather than the track counter", () => {
    // The `counter` prop is deliberately unused here: `NN / NN` is the TRACK's read of the fleet, and a
    // magazine states its issue number. hosts[0] opens the issue, so it is ISSUE 01.
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".cv-mast-over")?.textContent).toBe(
      `ISSUE 01 ${GACHA_COPY.sep} ONLINE`,
    );
    expect(container.textContent).not.toContain("01 / 03");
  });

  it("seats the LIVE line over the display and the static brand under it (owner swap, wave 2)", () => {
    // The owner swapped what the masthead's two seats SAY without touching how they look: the coloured
    // seat on top carries the live issue line, the grey seat below carries CTRL/B. The classes name the
    // seats, so this is the assertion that the CONTENT is on the right one — and that the h1 still reads
    // as one sensible heading in document order.
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".cv-mast-over")?.textContent).toContain("ISSUE 01");
    expect(container.querySelector(".cv-mast-under")?.textContent).toBe(GACHA_COPY.coverKicker);
    const parts = [...container.querySelectorAll(".cv-mast > *")].map((n) => n.textContent);
    expect(parts).toEqual([
      `ISSUE 01 ${GACHA_COPY.sep} ONLINE`,
      `${GACHA_COPY.coverTitle1}${GACHA_COPY.coverTitle2}`,
      GACHA_COPY.coverKicker,
    ]);
  });

  it("opens the issue with hosts[0], marked with aria-pressed", () => {
    const { container } = render(<GachaFleet active />);
    expect(heroName(container)).toBe("PEGASUS");
    expect(heroCard(container).getAttribute("aria-pressed")).toBe("true");
    expect(cutCards(container).map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
    ]);
  });

  it("⑬ gives every machine EXACTLY ONE accessibly-named button, at N=4", () => {
    // R25 §Q7 ⑬, the invariant every layout owes: one control per machine, each with a real name, and
    // the promote/reparent must not leave a second copy of anything behind.
    setFleet({
      hosts: [
        host("pegasus", true),
        host("atlas", false),
        host("vault", true),
        host("relay", false),
      ],
    });
    const { container } = render(<GachaFleet active />);
    const named = cards(container).map((b) => b.getAttribute("aria-label"));
    expect(named).toHaveLength(4);
    expect(named.every((n) => !!n && n.length > 0)).toBe(true);
    expect(new Set(named).size).toBe(4);
    // …and the hero's name says what the HERO does, while a cut-in's says what a cut-in does
    expect(named[0]).toBe(
      "pegasus, workstation, 2 stars, on the cover, online. Opens the unit dossier.",
    );
    expect(named[1]).toBe(
      "atlas, workstation, 2 stars, sleeping. Supporting cut-in. Puts it on the cover.",
    );
  });

  it("marks every host control `.gc-host-hit` (the dossier's outside-click exemption, ruling 5①)", () => {
    const { container } = render(<GachaFleet active />);
    expect(cards(container).every((b) => b.classList.contains("gc-host-hit"))).toBe(true);
  });

  it("wears the PER-UNIT hue by fleet POSITION, and the frame carries the ISSUE's own", () => {
    const { container } = render(<GachaFleet active />);
    expect(cards(container).map((b) => b.style.getPropertyValue("--cv-rar"))).toEqual([
      "var(--gc-unit-1)",
      "var(--gc-unit-2)",
      "var(--gc-unit-3)",
    ]);
    // the masthead kicker and the strapline tag sit outside the hero card, so the hue is published on
    // the frame for them (the lab's `--cover-rar`)
    expect(
      container.querySelector<HTMLElement>(".cv-frame")!.style.getPropertyValue("--cv-cover"),
    ).toBe("var(--gc-unit-1)");
  });

  it("DERIVES the hero crop, and leaves art with no focus alone (ruling 9)", () => {
    const { container } = render(<GachaFleet active />);
    // PER WINDOW since S4 (D65 §5): the position is inline on the IMAGE, computed from the box that
    // image actually got — the `--cv-focus`/`--cv-hero-focus` chain the card used to publish is gone,
    // because a centred framing point is a function of each box's own overflow and cannot be inherited.
    const shot = (card: HTMLElement) => card.querySelector<HTMLImageElement>(".cv-shot img")!;
    // the bundled entry at display position 0 declares `50% 12%` PROPORTIONALLY (a hand-tuned string);
    // the hero seat shifts its X left by the same twenty points it always has
    const pegasus = cards(container)[0];
    expect(pegasus.classList.contains("is-hero")).toBe(true);
    expect(shot(pegasus).style.objectPosition).toBe("30% 12%");
    // …and the entry at position 1 declares none, so NO inline position is written at all and the CSS
    // default stands — a computed override would be a claim about a crop nobody authored
    const atlas = cards(container)[1];
    expect(atlas.classList.contains("is-cut")).toBe(true);
    expect(shot(atlas).style.objectPosition).toBe("");
    // …and neither card publishes the retired custom properties any more.
    for (const card of cards(container)) {
      expect(card.style.getPropertyValue("--cv-focus")).toBe("");
      expect(card.style.getPropertyValue("--cv-hero-focus")).toBe("");
    }
  });
});

// ── THE TAP GRAMMAR (the E2 main-seat ruling) ────────────────────────────────────────────────────────
describe("the cover's tap grammar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a CUT-IN always PROMOTES — even an ONLINE one, which is where the poster differs", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[1])); // vault, ONLINE
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("VAULT");
    // it did NOT open a dossier and it did NOT wake anything
    expect(dossierName()).toBeNull();
    expect(runFn()).not.toHaveBeenCalled();
  });

  it("the ONLINE HERO opens its dossier on one tap", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    expect(dossierName()).toBe("pegasus");
    expect(runFn()).not.toHaveBeenCalled();
  });

  it("the SLEEPING HERO develops — the same `run('wake', host)` seam, and no confirm dialog", () => {
    setFleet({ hosts: [host("atlas", false), host("pegasus", true)] });
    const { container } = render(<GachaFleet active />);
    expect(heroName(container)).toBe("ATLAS");
    act(() => void fireEvent.click(heroCard(container)));
    expect(runFn()).toHaveBeenCalledTimes(1);
    expect(runFn().mock.calls[0][0]).toBe("wake");
    expect((runFn().mock.calls[0][1] as Host).id).toBe("atlas");
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dossierName()).toBeNull();
  });

  it("OPENS PLAIN — the cover hands over no morph element (ruling 5②, as signed for cover)", () => {
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    // the stub is installed, so a morph WOULD have been carried had one been offered
    expect(vt.start).not.toHaveBeenCalled();
    expect(dossierName()).toBe("pegasus");
  });

  it("the opening tap does not dismiss the dossier it just opened", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    expect(document.body.dataset.sheet).toBe("open");
    // …and a real outside tap still closes it
    act(() => void fireEvent.click(document.body));
    expect(document.body.dataset.sheet).toBeUndefined();
  });

  it("refuses a develop while an action on that machine is already in flight", () => {
    setFleet({ hosts: [host("atlas", false), host("pegasus", true)], busy: new Set(["atlas"]) });
    const { container } = render(<GachaFleet active />);
    const hero = heroCard(container);
    expect(hero.disabled).toBe(true);
    expect(hero.getAttribute("aria-busy")).toBe("true");
    // the guard is SYNCHRONOUS in the router, not merely the disabled attribute: jsdom dispatches into a
    // disabled button where a real engine would not, which is the path a stale render would take
    act(() => void hero.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(runFn()).not.toHaveBeenCalled();
    // …and no ceremony was staged for a request that was never sent
    act(() => void vi.advanceTimersByTime(1000));
    expect(container.querySelector(".cv-card.developing")).toBeNull();
  });
});

// ── THE PROMOTE CEREMONY (lab beats verbatim) ────────────────────────────────────────────────────────
describe("the promote ceremony", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a WAKING cut-in stays SELECTABLE — the grace window holds actions, never selection (owner 2026-08-30)", () => {
    // `busy` spans the whole wake/shutdown window since D67, and a blanket `disabled={isBusy}` froze
    // a booting machine out of the cover for minutes. Only the HERO is an action control; a cut-in
    // tap is pure selection, and the router's synchronous busy-guard is what refuses a re-wake.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false), host("vault", true)] });
    const { container } = render(<GachaFleet active />);
    act(() => void beginPending("atlas", "wake"));
    const atlas = cutCards(container).find((c) => c.dataset.gcHost === "atlas")!;
    expect(atlas.disabled).toBe(false);
    expect(atlas.getAttribute("aria-label")).toContain(
      "waking. Supporting cut-in. Puts it on the cover.",
    );
    act(() => void fireEvent.click(atlas)); // …and the promise is real: the promote ceremony starts
    act(() => void vi.advanceTimersByTime(170));
    expect(heroName(container)).toBe("ATLAS");
  });

  it("cross-fades the hero: the SELECT commits at beat 170 with the outgoing clone mounted (owner 2026-08-30)", () => {
    // RE-PINNED: the lab's page-turn fold (scale+dim), hero zoom entrance and masthead pulse are
    // DELETED — a promote is one simultaneous cross-fade of the hero imagery, everything else still.
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // atlas
    act(() => void vi.advanceTimersByTime(0));
    expect(heroName(container)).toBe("PEGASUS"); // not yet — the swap lands at beat 170
    expect(container.querySelector(".cv-ghost")).toBeNull();

    act(() => void vi.advanceTimersByTime(170));
    expect(heroName(container)).toBe("ATLAS");
    // …and the outgoing hero's inert clone mounted in the SAME commit, wearing pegasus's visual
    const ghost = container.querySelector(".cv-ghost")!;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.textContent).toContain("PEGASUS");

    act(() => void vi.advanceTimersByTime(710)); // past 880 — the clone leaves with the ceremony
    expect(container.querySelector(".cv-ghost")).toBeNull();
  });

  it("drops the ghost the moment its TARGET stops being the hero (Emma round MED-1)", () => {
    // The clone is bound to the machine it REVEALS: if that machine leaves the fleet mid-ceremony,
    // the resolved hero changes under the slot, and a stale overlay + restarted fade is exactly the
    // dip this gate prevents — the new hero simply shows, plainly.
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // promote atlas
    act(() => void vi.advanceTimersByTime(200)); // ghost up, ceremony mid-flight
    expect(container.querySelector(".cv-ghost")).not.toBeNull();
    setFleet({ hosts: [host("pegasus", true), host("vault", true)] }); // atlas leaves the fleet
    rerender(<GachaFleet active />);
    expect(heroName(container)).toBe("PEGASUS"); // the resolved fallback hero
    expect(container.querySelector(".cv-ghost")).toBeNull(); // the fade went with its target
  });

  it("SKIPPING still commits the select — a skip completes, it never abandons (R24 §B.3)", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0]));
    act(() => void vi.advanceTimersByTime(50)); // well before beat 170
    expect(heroName(container)).toBe("PEGASUS");
    act(() => void fireEvent.pointerDown(document.body));
    expect(heroName(container)).toBe("ATLAS");
    expect(container.querySelector(".cv-ghost")).toBeNull(); // the skip completed the 860 cleanup
    // completed, not abandoned: advancing past the budget changes nothing further
    act(() => void vi.advanceTimersByTime(2000));
    expect(heroName(container)).toBe("ATLAS");
  });

  it("collapses to an INSTANT swap under reduced motion, announcing ONLY the settled sentence", () => {
    // RULED (main seat, Codex E2 LOW-5): under collapsed motion the promote makes ONE announcement, and it
    // is the settled one. The runner fires every beat synchronously, React batches both `announce` writes
    // and only the final keyed child reaches the DOM — and that is the CORRECT outcome, not a gap to
    // engineer around: with no theatre there is no "takes the cover" moment to narrate, so a second
    // sentence would be describing a page turn that never happened. The previous title claimed both
    // sentences and asserted one; the claim is what was wrong.
    act(() => setUI({ motion: "reduced" }));
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0]));
    expect(heroName(container)).toBe("ATLAS");
    expect(container.querySelector(".cv-ghost")).toBeNull(); // batched set+clear: no clone ever paints
    expect(live(container)).toBe("atlas is on the cover. WORKSTATION, 2 stars, SLEEPING.");
  });

  it("…and that ONE announcement is one COMMITTED mutation, not one surviving span", () => {
    // The previous oracle counted `.gc-live span`, of which there is always exactly one — structural, and
    // true whatever happened (Codex E2-confirm L2). What the ruling actually claims is that the region
    // MUTATES once, so the region is observed across the whole gesture and every committed text recorded.
    act(() => setUI({ motion: "reduced" }));
    const { container } = render(<GachaFleet active />);
    const region = container.querySelector(".gc-live")!;
    const obs = new MutationObserver(() => {});
    obs.observe(region, { childList: true });
    act(() => void fireEvent.click(cutCards(container)[0]));
    // DRAINED SYNCHRONOUSLY: a MutationObserver's callback is a microtask, so reading it after the act
    // returns nothing at all. `takeRecords` is the queue itself, and each announcement is one keyed-child
    // swap — so the records ARE the committed announcements.
    const spoken = obs
      .takeRecords()
      .flatMap((r) => [...r.addedNodes])
      .map((n) => n.textContent ?? "");
    obs.disconnect();
    expect(spoken).toEqual(["atlas is on the cover. WORKSTATION, 2 stars, SLEEPING."]);
  });

  it("narrates BOTH ends in the lab's wording, and the body stays quiet under this grammar", () => {
    // §12.6 ruling 10 + the E2 announcement split: cover's promote is a full-screen page turn with two
    // sentences on its own beats, so `GachaFleet`'s generic "X selected." must NOT also fire — three
    // voices inside one gesture is the thing the split exists to prevent.
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0]));
    act(() => void vi.advanceTimersByTime(0));
    expect(live(container)).toBe("atlas takes the cover.");
    act(() => void vi.advanceTimersByTime(200)); // past the dispatch at 170
    expect(live(container)).toBe("atlas takes the cover."); // still — nothing else spoke
    act(() => void vi.advanceTimersByTime(900));
    expect(live(container)).toBe("atlas is on the cover. WORKSTATION, 2 stars, SLEEPING.");
  });

  it("a tap DURING a ceremony is a skip, never a second route (Codex E1 MED-1, verbatim)", () => {
    // The same finger, two browser events, as TWO separate `act`s — which is the whole point: a real
    // browser dispatches pointerdown and click as separate tasks and React commits the skip's
    // `running: false` in between. Batching them hides the finding entirely.
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // promote atlas
    act(() => void vi.advanceTimersByTime(50));
    const target = cutCards(container)[1]; // vault — an ONLINE machine, so an unsuppressed tap promotes
    act(() => void fireEvent.pointerDown(target));
    act(() => void fireEvent.click(target));
    // the ceremony completed …
    expect(container.querySelector(".cv-ghost")).toBeNull();
    // … and the gesture did NOT also promote the machine it landed on
    expect(heroName(container)).toBe("ATLAS");
    expect(dossierName()).toBeNull();
    // …and the NEXT gesture is a normal one — the suppression is per-gesture, never sticky
    const next = cutCards(container)[0];
    act(() => void fireEvent.pointerDown(next));
    act(() => void fireEvent.click(next));
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).not.toBe("ATLAS");
  });

  it("a KEYBOARD activation mid-ceremony skips rather than acting (no pointerdown to record)", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0]));
    act(() => void vi.advanceTimersByTime(50));
    act(() => void fireEvent.click(cutCards(container)[1])); // a click with no pointer gesture behind it
    expect(container.querySelector(".cv-ghost")).toBeNull(); // the skip completed the cleanup
    expect(heroName(container)).toBe("ATLAS");
  });

  it("a CLICKLESS skip cannot swallow the next keyboard activation (Codex confirm-round LOW)", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0]));
    act(() => void vi.advanceTimersByTime(50));
    // the skip's pointerdown lands on a card, but the gesture never clicks (a drag)
    act(() => void fireEvent.pointerDown(cutCards(container)[1]));
    expect(container.querySelector(".cv-ghost")).toBeNull(); // the skip completed the cleanup
    // the NEXT activation is keyboard: keydown then click, no pointerdown
    const target = cutCards(container)[1];
    act(() => void fireEvent.keyDown(target, { key: "Enter" }));
    act(() => void fireEvent.click(target));
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("VAULT");
  });

  it("RESTORES FOCUS across the reparent (ruling 9 — React remounts the moved control)", () => {
    // The hero slot and the internal scroller are two containers, so a promote unmounts the tapped
    // button and mounts a new one in the other seat. Without the explicit restore, focus falls to <body>
    // and a keyboard user loses their place entirely.
    const { container } = render(<GachaFleet active />);
    const tapped = cutCards(container)[0];
    act(() => void tapped.focus());
    expect(document.activeElement).toBe(tapped);
    act(() => void fireEvent.click(tapped));
    act(() => void vi.advanceTimersByTime(1000));
    const hero = heroCard(container);
    expect(hero.dataset.gcHost).toBe("atlas");
    expect(document.activeElement).toBe(hero);
    // …and the node really is a NEW one (a passing test on an unchanged node would prove nothing)
    expect(hero).not.toBe(tapped);
  });

  it("A POLL THAT REMOVES THE HERO MID-TURN cannot turn the promote into a wake (Codex E2 HIGH-1)", () => {
    // THE RELEASE-BLOCKING RACE. A is the hero, sleeping B is tapped as a cut-in — a promote. Before the
    // commit beat a routine poll removes A, which makes B the RESOLVED selection. The old code called the
    // ROUTER again at that beat, and `tapAction(B, B, offline, "select-first")` reads a selected sleeping
    // machine as a WAKE — so a gesture that meant "put B on the cover" sent a real wake request.
    //
    // The commit seam cannot do that: it selects a still-present machine or refuses, and it never reads
    // liveness at all.
    // A SPARE MACHINE OUTLIVES THE POLL (Codex E2-confirm L2): if the target were the only host left, the
    // render-derived FALLBACK would make it hero even when the commit was lost, and the oracle could not
    // tell the two apart. `relay` is hosts[0] after the poll, so it is what the fallback would choose —
    // "atlas is on the cover" can therefore only mean the commit survived.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false), host("relay", true)] });
    const { container, rerender } = render(<GachaFleet active />);
    expect(heroName(container)).toBe("PEGASUS");
    act(() => void fireEvent.click(cutCards(container)[0])); // atlas, asleep — a promote
    act(() => void vi.advanceTimersByTime(50)); // still inside the fold, before the commit

    setFleet({ hosts: [host("relay", true), host("atlas", false)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    act(() => void vi.advanceTimersByTime(1000)); // the commit beat lands on the NEW fleet

    expect(runFn(), "the promote must never become a wake").not.toHaveBeenCalled();
    expect(dossierName(), "…nor a dossier open").toBeNull();
    expect(heroName(container)).toBe("ATLAS"); // the COMMIT landed — the fallback would have said RELAY
    expect(container.querySelector(".cv-card.developing")).toBeNull();
  });

  it("…and the ONLINE form of the same race cannot open a dossier either", () => {
    // The other half of the finding: with an ONLINE tapped machine the old re-route returned `open`.
    setFleet({ hosts: [host("pegasus", true), host("vault", true), host("relay", true)] });
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // vault, ONLINE — still a promote under cover
    act(() => void vi.advanceTimersByTime(50));
    // …and again a spare survives, so RELAY is what a lost commit would fall back to
    setFleet({ hosts: [host("relay", true), host("vault", true)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(dossierName()).toBeNull();
    expect(document.body.dataset.sheet).toBeUndefined();
    expect(heroName(container)).toBe("VAULT");
  });

  it("REFUSES cleanly when the tapped machine itself leaves mid-turn, and says nothing settled", () => {
    // The seam's other verdict. The beat-0 "takes the cover" has already spoken — accepted, it described
    // an intent that was true when it was said — but nothing may claim the machine IS on the cover.
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // atlas
    act(() => void vi.advanceTimersByTime(50));
    expect(live(container)).toBe("atlas takes the cover.");
    setFleet({ hosts: [host("pegasus", true), host("vault", true)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(live(container)).toBe("atlas takes the cover."); // no settled sentence followed
    expect(heroName(container)).toBe("PEGASUS");
    expect(runFn()).not.toHaveBeenCalled();
  });

  it("an ACCEPTED commit survives a poll that strands the PREVIOUS pick (Codex E2-confirm M1)", () => {
    // ⚠ A CONTRACT TEST, NOT A REGRESSION TEST, and the distinction is stated because it was measured:
    // this case passes on the pre-fix code too. The finding reasoned that the passive stale-pick
    // normalizer, holding `pickedId` in its closure, could clear a newer accepted commit — but React
    // COALESCES passive effects to the LATEST commit, so by the time the effect runs its closure already
    // carries the committed value and the stale one it was supposed to act on no longer exists. Every
    // ordering tried (poll-then-beat in one act, and the beat landing before the flush) produced the same
    // hero either way. The functional compare-and-clear still SHIPS — it is the canonical form, it costs
    // nothing, and it removes the reliance on that coalescing entirely — but this test pins the INVARIANT
    // rather than proving a fix, and it should not be read as evidence the race was live.
    //
    // The setup needs a STORED pick that goes stale, which under cover only `onCommitSelect` can create:
    // promote atlas first, then promote relay while atlas is being polled away.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false), host("relay", true)] });
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // promote atlas …
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("ATLAS"); // …so `pickedId` now STORES atlas

    act(() => void fireEvent.click(cutCards(container)[1])); // promote relay
    act(() => void vi.advanceTimersByTime(50));
    // the poll drops atlas — the stored pick — in the SAME window the commit lands in
    act(() => {
      setFleet({ hosts: [host("pegasus", true), host("relay", true)], run: fleet.view.run });
      rerender(<GachaFleet active />);
      vi.advanceTimersByTime(1000);
    });

    // pegasus is hosts[0] and is still here, so it is what a LOST commit would fall back to
    expect(heroName(container), "the accepted commit must survive normalization").toBe("RELAY");
    // …and the sentence describes the machine that is actually on the cover
    expect(live(container)).toBe("relay is on the cover. WORKSTATION, 2 stars, ONLINE.");
  });

  it("RESTORES FOCUS across an INTERMEDIATE hero change, then on its own (Codex E2-confirm F3)", () => {
    // `[pegasus, relay, atlas]`: focus and promote ATLAS, then poll pegasus away before the commit. relay
    // becomes the fallback hero — a hero change that has nothing to do with this gesture. Spending the arm
    // there left atlas's own promotion, 120 ms later, to reparent it with no restoration at all.
    setFleet({ hosts: [host("pegasus", true), host("relay", true), host("atlas", false)] });
    const { container, rerender } = render(<GachaFleet active />);
    const tapped = cutCards(container)[1]; // atlas
    expect(tapped.dataset.gcHost).toBe("atlas");
    act(() => void tapped.focus());
    act(() => void fireEvent.click(tapped));
    act(() => void vi.advanceTimersByTime(50)); // before the commit

    setFleet({ hosts: [host("relay", true), host("atlas", false)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    // the INTERMEDIATE hero — not ours, and it must not consume the arm
    expect(heroCard(container).dataset.gcHost).toBe("relay");

    act(() => void vi.advanceTimersByTime(1000)); // now atlas's own commit lands
    const hero = heroCard(container);
    expect(hero.dataset.gcHost).toBe("atlas");
    expect(hero).not.toBe(tapped);
    expect(document.activeElement, "the arm waits for ITS host's promotion").toBe(hero);
  });

  it("drops the focus arm when its machine leaves, or when the commit REFUSES", () => {
    // The two bounds on an arm that will never be spent. Neither may leave it live for an unrelated turn.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false), host("relay", true)] });
    const { container, rerender } = render(<GachaFleet active />);
    const tapped = cutCards(container)[0]; // atlas
    act(() => void tapped.focus());
    act(() => void fireEvent.click(tapped));
    act(() => void vi.advanceTimersByTime(50));

    // atlas itself leaves: the commit refuses AND the armed machine is gone
    setFleet({ hosts: [host("pegasus", true), host("relay", true)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("PEGASUS");

    // a LATER, unrelated promotion of a machine that happens to reuse the id must not be focus-stolen by
    // the dead arm: relay takes the cover, and focus stays where the (pointer) user left it
    act(() => void document.body.focus());
    act(() => void fireEvent.click(cutCards(container)[0])); // relay
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("RELAY");
    expect(document.activeElement).toBe(document.body);
  });

  it("RESTORES FOCUS when the old hero leaves BEFORE the commit beat (Codex E2 MED-3)", () => {
    // Arming at the commit beat was too late: if the old hero goes away first, the POLL's own render
    // reparents the focused cut-in into the hero slot, React remounts it, focus falls to <body>, and by
    // the beat there is nothing left to read. Armed at promote START, the id survives that reparent.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false)] });
    const { container, rerender } = render(<GachaFleet active />);
    const tapped = cutCards(container)[0];
    act(() => void tapped.focus());
    act(() => void fireEvent.click(tapped));
    act(() => void vi.advanceTimersByTime(50)); // before the commit

    setFleet({ hosts: [host("atlas", false)], run: fleet.view.run });
    rerender(<GachaFleet active />); // the poll reparents atlas into the hero slot, right now

    const hero = heroCard(container);
    expect(hero.dataset.gcHost).toBe("atlas");
    expect(hero).not.toBe(tapped); // it really was remounted
    expect(document.activeElement).toBe(hero);
  });

  it("swallows a HELD key's repeat activations (Codex E2 LOW-6)", () => {
    // Auto-repeat turns one press into a stream of keydown/click pairs. The first is the gesture; the
    // rest are the same gesture still being held, and after a skip the first repeat would land on a
    // ceremony that has just ended and route for real.
    // REPRODUCED FROM THE START OF THE GESTURE (Codex E2-confirm L2): a genuine first keydown, the click
    // it produces landing mid-ceremony as a SKIP, and only then the repeats. Starting the test at
    // `repeat: true` skipped the very sequence the finding describes.
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(cutCards(container)[0])); // a promote is running (atlas)
    act(() => void vi.advanceTimersByTime(50));
    const held = cutCards(container)[1]; // vault — the key is held down on THIS control

    // 1. the held key's FIRST activation: it lands on a live ceremony, so it is a skip and nothing else
    act(() => void fireEvent.keyDown(held, { key: "Enter" }));
    act(() => void fireEvent.click(held));
    expect(container.querySelector(".cv-ghost")).toBeNull(); // it skipped (cleanup ran)
    expect(heroName(container)).toBe("ATLAS"); // the skipped promote completed; vault was NOT promoted

    // 2. the SAME key, still held: the ceremony is over now, so an unswallowed repeat would route for real
    act(() => void fireEvent.keyDown(held, { key: "Enter", repeat: true }));
    act(() => void fireEvent.click(held));
    act(() => void fireEvent.keyDown(held, { key: "Enter", repeat: true }));
    act(() => void fireEvent.click(held));
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container), "repeats of a held key are one spent gesture").toBe("ATLAS");

    // 3. …and the flag never goes stale: a genuine new press works
    act(() => void fireEvent.keyDown(held, { key: "Enter" }));
    act(() => void fireEvent.click(held));
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("VAULT");
  });

  it("a held SPACE still activates — exactly once, on its release (Codex E2-confirm L1)", () => {
    // Enter activates on KEYDOWN, so its repeats are extra activations and are rightly swallowed. SPACE
    // activates on KEYUP — its repeats produce no click at all, and the one real click arrives after they
    // have set the flag. Without a keyup reset a held Space did nothing whatsoever.
    const { container } = render(<GachaFleet active />);
    const held = cutCards(container)[1]; // vault
    act(() => void fireEvent.keyDown(held, { key: " " }));
    act(() => void fireEvent.keyDown(held, { key: " ", repeat: true }));
    act(() => void fireEvent.keyDown(held, { key: " ", repeat: true }));
    // no click has been produced yet — Space does not activate until it is released
    expect(heroName(container)).toBe("PEGASUS");
    act(() => void fireEvent.keyUp(held, { key: " " }));
    act(() => void fireEvent.click(held)); // the browser's own activation, after keyup
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container), "held Space must activate exactly once").toBe("VAULT");
  });

  it("a POINTER gesture is never swallowed by a stale key-repeat flag", () => {
    const { container } = render(<GachaFleet active />);
    const target = cutCards(container)[1];
    act(() => void fireEvent.keyDown(target, { key: "Enter", repeat: true })); // arms the flag
    act(() => void fireEvent.pointerDown(target)); // a new POINTER gesture clears it
    act(() => void fireEvent.click(target));
    act(() => void vi.advanceTimersByTime(1000));
    expect(heroName(container)).toBe("VAULT");
  });

  it("does NOT steal focus when nobody was standing on a card", () => {
    // The restore is spent per promote, so a pointer-driven swap on a page whose focus is elsewhere must
    // leave that focus exactly where it was.
    const { container } = render(<GachaFleet active />);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    act(() => void fireEvent.click(cutCards(container)[0]));
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

// ── THE DEVELOP CEREMONY (poll-truthful, ruling 4) ───────────────────────────────────────────────────
describe("the develop ceremony", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setFleet({ hosts: [host("atlas", false), host("pegasus", true)] });
  });
  afterEach(() => vi.useRealTimers());

  it("flashes, shakes, thuds the stamp down and cleans up", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    act(() => void vi.advanceTimersByTime(0));
    expect(heroCard(container).classList.contains("developing")).toBe(true);
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(false);

    act(() => void vi.advanceTimersByTime(150));
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(true);
    expect(container.querySelector(".cv-shake")!.classList.contains("shaking")).toBe(true);

    act(() => void vi.advanceTimersByTime(450)); // 600
    expect(container.querySelector(".cv-stamp")?.textContent).toBe(GACHA_COPY.coverStamp);
    // decoration, and it says so: the machine's real state is the chip beside it
    expect(container.querySelector(".cv-stamp")!.getAttribute("aria-hidden")).toBe("true");

    act(() => void vi.advanceTimersByTime(400)); // past 880
    expect(container.querySelector(".cv-stamp")).toBeNull();
    expect(container.querySelector(".cv-card.developing")).toBeNull();
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(false);
  });

  it("is POLL-TRUTHFUL: WAKING through the grace window, and it ends on the SERVER's word", async () => {
    // RE-PINNED 2026-08-30, with the poster's twin. The chip used to die with the HTTP round-trip, so
    // WAKING blinked and the machine wore SLEEPING for the whole minute it took to boot. The assumed
    // state is a bounded grace record now (`store/fleetPending`), and this pins its three endings:
    // it OUTLIVES the settle, it yields to poll AGREEMENT, and failing that it expires. The honesty
    // claim is untouched — the lab's 430 ms ONLINE flip is still fiction; only a poll may say ONLINE.
    let settle = (_ok: boolean) => {};
    setFleet({
      hosts: [host("atlas", false), host("pegasus", true)],
      run: dispatchingRun(() => new Promise<boolean>((r) => (settle = r))),
    });
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    expect(heroChip(container)).toBe("WAKING");
    // …and the ACCESSIBLE NAME agrees (sol confirm MED-2): no "develops the cover and wakes it"
    // instruction on a hero whose wake is already in progress — the label carries the third liveness.
    expect(heroCard(container).getAttribute("aria-label")).toContain(
      "waking. Wake sequence in progress.",
    );
    act(() => void vi.advanceTimersByTime(1000)); // the whole ceremony runs out
    expect(heroChip(container)).toBe("WAKING"); // the REQUEST is still in the air

    // AWAITED, not chained: an assertion inside a trailing `.then` can be flushed after teardown and
    // throws as an UNHANDLED error while the test still reports green (the E1 lesson).
    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(heroChip(container)).toBe("WAKING"); // …and SURVIVES it: the machine is still coming up
    expect(heroCard(container).classList.contains("asleep")).toBe(true); // still not online, and says so

    // (a) AGREEMENT — the poll says atlas is up, and the server's word takes the chip. It wins even on
    // the render before the store's reconcile clears the record: `online` outranks `waking`.
    setFleet({ hosts: [host("atlas", true), host("pegasus", true)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    expect(heroChip(container)).toBe("ONLINE");

    // (b) EXPIRY — the other ending, for a machine that never came up: back to SLEEPING, never ONLINE.
    setFleet({ hosts: [host("atlas", false), host("pegasus", true)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    expect(heroChip(container)).toBe("WAKING"); // the record is still live (nothing reconciled it away)
    act(() => void vi.advanceTimersByTime(WAKE_WINDOW_MS));
    expect(heroChip(container)).toBe("SLEEPING");
    expect(heroCard(container).classList.contains("asleep")).toBe(true);
  });

  it("KEEPS the theatre through a FAST successful settle — the ceremony runs to its end", async () => {
    // THE INVERSION of the pin below (2026-08-30). Codex E2 MED-2 read the RESPONSE as the licence: a
    // wake that came back at 40 ms stripped the flash, the wash and the 600 ms stamp, because the
    // request was no longer "in flight". That was only ever a proxy for the real question — is this
    // machine still coming up? — and it answered it wrong, since the WOL round trip says nothing about
    // the boot. The licence is the PENDING RECORD now, which outlives the settle by the whole grace
    // window, so an ok'd wake gets the ceremony it was written for, in full.
    let settle = (_ok: boolean) => {};
    setFleet({
      hosts: [host("atlas", false), host("pegasus", true)],
      run: dispatchingRun(() => new Promise<boolean>((r) => (settle = r))),
    });
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    act(() => void vi.advanceTimersByTime(150));
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(true);

    // the request comes back ok, LONG before the stamp's beat
    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(heroCard(container).classList.contains("developing")).toBe(true);
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(true);
    expect(container.querySelector(".cv-shake")!.classList.contains("shaking")).toBe(true);
    expect(heroChip(container)).toBe("WAKING"); // …and still no synthetic ONLINE (ruling 4 holds)

    // the stamp lands on its own beat, and the ceremony cleans up on its own clock
    act(() => void vi.advanceTimersByTime(450)); // 600
    expect(container.querySelector(".cv-stamp")?.textContent).toBe(GACHA_COPY.coverStamp);
    act(() => void vi.advanceTimersByTime(400)); // past 880
    expect(container.querySelector(".cv-stamp")).toBeNull();
    expect(container.querySelector(".cv-card.developing")).toBeNull();
  });

  it("STRIPS the theatre the moment the wake FAILS — no stamp for a refused wake (Codex E2 MED-2)", async () => {
    // THE POLL-TRUTH LEAK, re-aimed. The presentation ran on its own 880 ms clock, so a wake that had
    // already come back still got a flash, a wash and — at 600 ms — an AWAKE stamp over a machine whose
    // request was done. `aria-hidden` hid that false claim from one audience only; it was still
    // synthetic liveness on screen, which is what ruling 4 forbids. Every artifact is licensed by the
    // pending record (`waking`) and by nothing else, so the LICENSING FACT moved: from "the request is
    // in flight" to "the pending record is live". A failure hands that record straight back — nothing
    // is coming up — and the theatre goes with it in the same commit.
    let settle = (_ok: boolean) => {};
    setFleet({
      hosts: [host("atlas", false), host("pegasus", true)],
      run: dispatchingRun(() => new Promise<boolean>((r) => (settle = r))),
    });
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    act(() => void vi.advanceTimersByTime(150));
    expect(heroCard(container).classList.contains("developing")).toBe(true);
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(true);

    // the request comes back REFUSED, LONG before the stamp's beat
    await act(async () => {
      settle(false);
      await Promise.resolve();
    });
    expect(heroChip(container)).toBe("SLEEPING"); // the server's word, unchanged by the wake
    expect(container.querySelector(".cv-card.developing")).toBeNull();
    expect(container.querySelector(".cv-flash")!.classList.contains("fire")).toBe(false);
    expect(container.querySelector(".cv-shake")!.classList.contains("shaking")).toBe(false);

    // …and the stamp's beat lands on a stripped stage: it must NEVER appear
    act(() => void vi.advanceTimersByTime(1000));
    expect(container.querySelector(".cv-stamp")).toBeNull();
    expect(container.querySelector(".cv-card.stamped")).toBeNull();
  });

  it("…and a REJECTED request takes the theatre with it at the next commit", async () => {
    let fail = (_e?: unknown) => {};
    setFleet({
      hosts: [host("atlas", false), host("pegasus", true)],
      run: dispatchingRun(() => new Promise<boolean>((_r, j) => (fail = j))),
    });
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    act(() => void vi.advanceTimersByTime(600)); // past the stamp's own beat
    expect(container.querySelector(".cv-stamp")).not.toBeNull();

    await act(async () => {
      fail(new Error("wake refused"));
      await Promise.resolve();
    });
    // a THROWN request clears the record on the same token a failure would (the `run` contract's catch
    // arm), so nothing on screen may still be claiming the machine is coming up
    expect(container.querySelector(".cv-stamp")).toBeNull();
    expect(container.querySelector(".cv-card.developing")).toBeNull();
    expect(heroChip(container)).toBe("SLEEPING");
  });

  it("stages NOTHING when the router did not send a wake", () => {
    // The poster's pattern: route first, stage only on `"wake"`. An ONLINE hero opens instead, and a
    // ceremony for a request that was never sent would be theatre about nothing.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false)] });
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    act(() => void vi.advanceTimersByTime(1000));
    expect(container.querySelector(".cv-card.developing")).toBeNull();
    expect(container.querySelector(".cv-stamp")).toBeNull();
    expect(dossierName()).toBe("pegasus");
  });

  it("announces the REQUEST in the cover's own wording, and the body stays quiet", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    // the request is dispatched synchronously; the SENTENCE is the ceremony's first beat
    expect(live(container)).toBe("");
    act(() => void vi.advanceTimersByTime(0));
    expect(live(container)).toBe("Developing the cover. Waking atlas.");
    // …not the stack layouts' sentence, which would be the same request said twice
    expect(live(container)).not.toBe("Waking atlas.");
    act(() => void vi.advanceTimersByTime(2000));
    // and there is NO settled counterpart — only a hosts poll can know (ruling 4)
    expect(live(container)).toBe("Developing the cover. Waking atlas.");
  });

  it("collapses under reduced motion, request and announcement intact", () => {
    act(() => setUI({ motion: "reduced" }));
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(heroCard(container)));
    expect(runFn()).toHaveBeenCalledTimes(1);
    expect(live(container)).toBe("Developing the cover. Waking atlas.");
    expect(container.querySelector(".cv-card.developing")).toBeNull();
    expect(container.querySelector(".cv-stamp")).toBeNull();
  });
});

// ── THE SHARED STATES + the fleet-size rows ──────────────────────────────────────────────────────────
describe("the cover's states match the capsule track's", () => {
  it("N=1 → the hero ALONE: no cut-in column, no CHANGE COVER hint (ruling 9)", () => {
    setFleet({ hosts: [host("solo", true)] });
    const { container } = render(<GachaFleet active />);
    expect(cards(container)).toHaveLength(1);
    expect(container.querySelector(".cv-side")).toBeNull();
    expect(container.querySelector(".cv-stack")).toBeNull();
    expect(container.querySelector(".cv-hint")).toBeNull();
    // …and the rest of the composition is still a cover
    expect(container.querySelector(".cv-strap .gc-banner")).not.toBeNull();
    expect(container.querySelector(".cv-foot")).not.toBeNull();
  });

  it("N=0 → the shared empty-state message, and no composition at all", () => {
    setFleet({ hosts: [] });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")?.textContent).toBe("no hosts in config.yaml");
    expect(cards(container)).toHaveLength(0);
    expect(container.querySelector(".cv-foot")).toBeNull();
    // the masthead survives — a magazine with no contents is still a magazine — but it claims no issue
    expect(container.querySelector(".cv-mast")).not.toBeNull();
    expect(container.querySelector(".cv-mast-over")).toBeNull();
    // …and the STATIC seat survives, because the brand is not a claim about the fleet
    expect(container.querySelector(".cv-mast-under")?.textContent).toBe(GACHA_COPY.coverKicker);
  });

  it("renders NOTHING but the masthead while the first poll is in flight", () => {
    setFleet({ hosts: [], isLoading: true, hasData: false });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")).toBeNull();
    expect(container.querySelector(".cv-mast")).not.toBeNull();
    expect(container.querySelector(".cv-heroslot")).toBeNull();
  });

  it("renders the error BESIDE the cover the last good poll left", () => {
    setFleet({ error: new Error("boom") });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")?.textContent).toBe("backend unreachable: boom");
    expect(cards(container)).toHaveLength(3);
  });

  it("refuses input while the reel sweeps (§6.4/F3), like every other layout", () => {
    const { container } = render(<GachaFleet active />);
    const frame = container.querySelector(".cv-frame")!;
    expect(frame.hasAttribute("inert")).toBe(false);
    act(() => setGachaReelRunning(true));
    expect(frame.hasAttribute("inert")).toBe(true);
    act(() => setGachaReelRunning(false));
    expect(frame.hasAttribute("inert")).toBe(false);
  });

  it("draws a card with NO art rather than dropping the machine", () => {
    setFleet({ hosts: [host("solo", true)] });
    media.data = {
      ns: "gacha",
      collation: "library-v1",
      roles: {
        characters: [
          {
            name: "broken",
            file: "broken.webp",
            url: "/api/media/gacha/files/characters/broken.webp",
            format: "webp",
            size_bytes: 1,
            revision: "1:1",
            width: 1,
            height: 1,
            unusable: true,
            unusable_reason: "decode failed",
          },
        ],
      },
      slots: {},
    };
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".cv-shot img")).toBeNull();
    expect(container.querySelector(".cv-shot-blank")).not.toBeNull();
    expect(heroName(container)).toBe("SOLO");
    expect(heroChip(container)).toBe("ONLINE");
  });

  it("survives a poll that removes the machine on the cover (the pick re-derives)", () => {
    const { container, rerender } = render(<GachaFleet active />);
    expect(heroName(container)).toBe("PEGASUS");
    setFleet({ hosts: [host("atlas", false), host("vault", true)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    expect(heroName(container)).toBe("ATLAS");
    expect(container.querySelector(".cv-mast-over")?.textContent).toBe(
      `ISSUE 01 ${GACHA_COPY.sep} SLEEPING`,
    );
  });
});

// ── THE BANNER AS A SLOT (ruling 7) ──────────────────────────────────────────────────────────────────
describe("the banner slot", () => {
  it("seats ONE banner in the STRAPLINE under cover, and first in flow under the others", () => {
    const { container, rerender } = render(<GachaFleet active />);
    expect(container.querySelectorAll(".gc-banner")).toHaveLength(1);
    expect(container.querySelector(".cv-strap .gc-banner")).not.toBeNull();

    act(() => setThemeSetting("gacha", "fleetLayout", "capsule"));
    rerender(<GachaFleet active />);
    expect(container.querySelectorAll(".gc-banner")).toHaveLength(1);
    expect(container.querySelector(".cv-strap")).toBeNull();
    // FIRST IN SCROLL FLOW — byte-identically where `GachaFleet` used to mount it. Read as document
    // order against the head that follows it, which is what "first" means for a scrolling layout.
    const tab = container.querySelector("#tab-fleet")!;
    const banner = tab.querySelector(".gc-banner")!;
    const head = tab.querySelector(".gc-track-head")!;
    expect(banner.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("REPARENTS across a layout switch with no leaked timer (ruling 7's accepted cost)", () => {
    // The remount itself is signed off — autoplay and slide state reset, the owner switches layouts
    // rarely. What is NOT acceptable is a cadence timer surviving the move.
    //
    // MEASURED AT THE SWITCH, not after a long advance (Codex E2 LOW-7): the old form advanced far enough
    // for a LEAKED timer to fire and drain before the final `getTimerCount()`, so it could not tell "the
    // old one was cleared" from "the old one ran itself out". The count is taken immediately after each
    // swap and compared to the steady state — one cadence timer, never old plus new.
    vi.useFakeTimers();
    try {
      const { container, unmount, rerender } = render(<GachaFleet active />);
      act(() => void vi.advanceTimersByTime(5200 * 2));
      const steady = vi.getTimerCount();
      expect(steady, "the banner must have a live cadence to begin with").toBeGreaterThan(0);
      const bannerNode = () => container.querySelector(".gc-banner");
      const before = bannerNode();

      /** Count the timers a swap LEFT BEHIND. The 1 ms drain is not slack for a leak — a cadence timer is
       *  5200 ms and a snap is 620, so neither can fire in it: it clears REACT'S OWN scheduler callback,
       *  which is a sub-millisecond `setTimeout` the commit posts and which would otherwise be miscounted
       *  as the banner's. A leaked old cadence would still be pending here, giving 2. */
      const settledCount = () => {
        act(() => void vi.advanceTimersByTime(1));
        return vi.getTimerCount();
      };

      act(() => setThemeSetting("gacha", "fleetLayout", "capsule"));
      rerender(<GachaFleet active />);
      expect(container.querySelectorAll(".gc-banner")).toHaveLength(1);
      expect(settledCount(), "old + new cadence would be a leak").toBe(steady);
      // the REPARENT is real — a remounted node, which is the accepted cost the ruling names
      expect(bannerNode()).not.toBe(before);
      const afterCapsule = bannerNode();

      act(() => setThemeSetting("gacha", "fleetLayout", "cover"));
      rerender(<GachaFleet active />);
      expect(container.querySelectorAll(".gc-banner")).toHaveLength(1);
      expect(settledCount()).toBe(steady);
      expect(bannerNode()).not.toBe(afterCapsule);

      unmount();
      expect(() => act(() => void vi.advanceTimersByTime(5200 * 4))).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── THE SETTINGS ROW (the E2 contract half) ──────────────────────────────────────────────────────────
describe("`fleetLayout` gains cover, and `posterName` stays poster-scoped", () => {
  const gacha = registry.gacha!;

  it("offers exactly capsule · poster · cover, in that order, with capsule still the default", () => {
    const field = gacha.settings!.fleetLayout;
    expect(field.type).toBe("seg");
    expect(field.type === "seg" && field.options.map((o) => o.val)).toEqual([
      "capsule",
      "poster",
      "cover",
    ]);
    expect(field.type === "seg" && field.options.map((o) => o.label)).toEqual([
      "Capsule",
      "Poster",
      "Cover",
    ]);
    expect(field.default).toBe("capsule");
  });

  it("hides `posterName` under cover and brings it back under poster, value intact", () => {
    const posterName = gacha.settings!.posterName;
    const visible = (layout: string) =>
      settingRowVisible("gacha", "posterName", posterName, layout);
    expect(visible("poster")).toBe(true);
    expect(visible("cover")).toBe(false);
    expect(visible("capsule")).toBe(false);
  });

  it("says WHY cover wants the app bar hidden, in the picker's own copy (§12.3⑤)", () => {
    expect(gacha.settings!.fleetLayout.desc).toBe(GACHA_COPY.settingFleetLayoutDesc);
    expect(GACHA_COPY.settingFleetLayoutDesc).toContain("cover pairs best with the app bar hidden");
  });
});

// ── THE STYLESHEET CLAIMS (jsdom paints none of this) ────────────────────────────────────────────────
describe("the cover's stylesheet claims", () => {
  const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
  const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");
  /** One selector's declaration block (values carry no braces, so scanning to the next `}` is exact). */
  const blockFor = (sel: string): string | null => {
    const at = css.indexOf(`\n    ${sel} {`);
    return at < 0 ? null : css.slice(at, css.indexOf("}", at));
  };

  it("paints the black field on ITS OWN frame — never on the shell (the E1 owner ruling holds)", () => {
    // Owner ruling ① killed the poster's `.kit-main` ground because its `background-image: none` half
    // also killed the wallpaper and its opaque black covered `.kit`'s coloured backdrop. The cover needs
    // a black page too, and gets it WITHOUT that class of rule: the frame is an element of its own, so
    // the theme's backdrop and the wallpaper are exactly the cascade they always were.
    const frame = blockFor(".cv-frame")!;
    expect(frame).toContain("background: var(--gc-cv-field)");
    expect(frame).toContain("position: absolute");
    expect(frame).toContain("inset: 0");
    expect(css, "the withdrawn ground rule must not come back under cover").not.toContain(
      'body[data-gc-fleet="cover"]',
    );
    expect(tokens).toContain("--gc-cv-field: #0b0910");
  });

  it("reaches the shell through NOTHING — every cover rule is scoped to cover's own markup", () => {
    // The sharp form, and the twin of the poster's own enumeration: every rule in this file that names a
    // `.cv-` class is checked for a selector that could touch a box gacha does not own. The layout is a
    // fixed page drawn INSIDE the tab, not a re-dressing of the shell around it.
    // Read as RULES, not as lines (Codex E2 MED-4): a multi-line selector list walks straight past a
    // line-anchored regex, which is a false negative in a guard whose whole job is to fail.
    const scoped = selectorsMentioning(css, ".cv-").map(({ selector }) => selector);
    expect(scoped.length, "the cover must have rules").toBeGreaterThan(20);
    for (const sel of scoped)
      expect(sel, `${sel} must not target the shell or the tab`).not.toMatch(
        /\.kit-main|\.kit\b|#tab-|\.tab\b/,
      );
  });

  it("floors the composition on the COMPOSER'S TOP EDGE, not on its height (the fix-wave seed)", () => {
    // THE LAB'S FOUR NUMBERS ARE ONE SEED AND THREE INTERVALS. 70 / 102 / 202 / 212 = a floor plus
    // 6 / 32 / 100 / 110, authored against a BARE viewport where nothing floated over the page.
    // Production keeps the intervals and replaces the seed: under gacha the tab bar FLOATS over
    // `.kit-main` instead of shortening it and the composer floats above the bar, so the frame's bottom
    // edge is the shell's bottom and a floor of "the composer's HEIGHT" lands INSIDE the chrome — which
    // is exactly what the render audit measured (the strapline covering the composer, the gag footer
    // behind the nav bar). The floor is therefore where the composer's TOP is.
    const frame = blockFor(".cv-frame")!;
    expect(frame).toContain("--cv-floor: calc(var(--gc-composer-b) + var(--composer-h, 64px))");
    expect(frame).toContain("--cv-foot: calc(var(--cv-floor) + 6px)");
    expect(frame).toContain("--cv-strap: calc(var(--cv-foot) + 32px)");
    expect(frame).toContain("--cv-side-floor: calc(var(--cv-strap) + 100px)");
    expect(frame).toContain("--cv-herocopy: calc(var(--cv-strap) + 110px)");
    expect(frame).toContain("--cv-mast-top: calc(var(--appbar-h, 0px) + 16px)");
    // …and the seed REUSES the composer's own anchor rather than restating or guessing it, so the two
    // can never drift (the `--gc-nav-zone` precedent one element up).
    expect(blockFor(".kit-composer")).toContain("bottom: var(--gc-composer-b)");
    // (`blockFor` would find the FIRST `.kit {` — the app backdrop — so the shell's two declarations are
    // read off the file: the base anchor, and the SHEET layout's flush-above-the-bar override. Declared
    // on the shell rather than on the composer because the cover and the composer are not each other's
    // descendants, and a custom property only travels downward.)
    expect(css).toContain("--gc-composer-b: calc(12px + var(--gc-nav-zone));");
    expect(css).toContain("--gc-composer-b: var(--gc-nav-zone);");
    expect(css.split("--gc-composer-b:").length - 1, "exactly two declarations").toBe(2);
    // …and the retired inline override must not come back beside them
    expect(blockFor(".kit-composer.sheet")).toBeNull();
    // THE INTERVALS ARE THE LAB'S, unchanged — stated as the deltas they are, applied to whatever floor
    // the app resolves. The lab's own four numbers are what this chain yields at ITS seed of 64.
    const chain = (floor: number) => {
      const foot = floor + 6;
      const strap = foot + 32;
      return [foot, strap, strap + 100, strap + 110];
    };
    expect(chain(64), "the lab's own numbers are this chain at the lab's own floor").toEqual([
      70, 102, 202, 212,
    ]);
    // …and at the audited device geometry (390x844: nav zone 68+14, composer inset 12, height 50) the
    // whole composition clears the chrome: the footer's floor sits just above the composer's top edge,
    // which is 94 + 50 = 144 from the frame's bottom.
    const navZone = 68 + 14;
    const composerB = 12 + navZone;
    const composerH = 50;
    const floor = composerB + composerH;
    expect(floor).toBe(144);
    expect(chain(floor)[0], "the footer must clear the composer's top edge").toBeGreaterThan(floor);
    // …and every floor is a TOKEN, so §12.3② has one place to tune (no magic number inline)
    for (const sel of [".cv-foot", ".cv-strap", ".cv-side", ".cv-herocopy"])
      expect(blockFor(sel), `${sel} must consume a --cv-* floor`).toMatch(/var\(--cv-/);
  });

  it("makes the frame its OWN stacking context, so its rungs stay internal (fix-wave defect 1)", () => {
    // `.cv-frame` declared no z-index, so it created NO stacking context and its internal rungs — the
    // strapline's 5, the masthead's 5, the stamp's 6 — competed in the app-wide context, beating the
    // floating composer's 4 and the kit's edge scrims' 3. Measured: `elementFromPoint` at the composer's
    // centre returned a node inside the strapline. `isolation: isolate` is the kit's own idiom for a
    // stacking context WITHOUT a position/z-index that would change how anything else stacks
    // (`.kit:has(> .kit-bg)`), and it is deliberately NOT the `position: relative; z-index: N` form §10.1
    // bans one element up — that one would claim a rung in the shell's ladder.
    expect(blockFor(".cv-frame")).toContain("isolation: isolate");
    expect(blockFor(".cv-frame")).not.toMatch(/\n\s+z-index:/);
    // the consequence, stated: the composer (4) and the scrims (3) now paint OVER the cover, which is
    // the posture capsule and poster already have
    expect(blockFor(".kit-composer")).not.toBeNull();
  });

  it("makes the CUT-IN COLUMN the only thing that scrolls (ruling 9)", () => {
    const stack = blockFor(".cv-stack")!;
    expect(stack).toContain("overflow-y: auto");
    expect(stack).toContain("overscroll-behavior: contain");
    expect(stack).toContain("scrollbar-width: none");
    expect(blockFor(".cv-stack::-webkit-scrollbar")).toContain("display: none");
    // …and the page itself does NOT scroll: the frame is absolute (asserted above) and clips.
    expect(blockFor(".cv-frame")).toContain("overflow: hidden");
  });

  it("depends on gacha nulling the kit's tab entrance — a transform there would break the frame", () => {
    // `.cv-frame` is absolute, so its containing block is the nearest POSITIONED ancestor (`.kit-scroll`).
    // `kit-fade` animates `transform`, and a transformed `.tab` would become the containing block instead
    // — collapsing the frame to a zero-height box for 250 ms on every entry. gacha already nulls that
    // animation for its own reasons (§10.1: the reel IS the transition); this is the assertion that the
    // cover now DEPENDS on it, so nobody restores it without meeting this test.
    expect(blockFor(".kit .tab.active")).toContain("animation: none");
  });

  it("gives host controls `touch-action: manipulation` (ruling 3)", () => {
    expect(blockFor(".cv-card")).toContain("touch-action: manipulation");
  });

  it("draws a focus ring that survives BOTH shapes (R18)", () => {
    // A cut-in is clipped to a polygon and a clip-path erases the UA ring outright, so its ring is a
    // pseudo INSIDE the clip wearing the card's own shape. The hero is unclipped but fills the frame,
    // so an outside ring lands in the overflow — it takes the banner promo's own answer instead.
    expect(blockFor(".cv-card.is-cut:focus-visible")).toContain("outline: none");
    const ring = blockFor(".cv-card.is-cut:focus-visible::after")!;
    expect(ring).toContain("clip-path: polygon(");
    expect(ring).toContain("var(--accent)"); // the kit's own ring token, not a cover literal
    expect(blockFor(".cv-card.is-hero:focus-visible")).toContain("outline-offset: -3px");
  });

  it("suppresses a sleeping card's hue through the RESOLVED property, not the inline one", () => {
    // The E1 trap, restated: an inline custom property beats every selector, so the property the
    // component writes (`--cv-rar`) and the property the paint reads (`--cv-hue`) must be different.
    expect(blockFor(".cv-card")).toContain("--cv-hue: var(--cv-rar)");
    expect(blockFor(".cv-card.asleep")).toContain("--cv-hue: var(--gc-unit-off)");
    for (const sel of [".cv-herocopy small", ".cv-cutcopy"])
      expect(blockFor(sel), `${sel} must paint the RESOLVED hue`).toContain("var(--cv-hue)");
  });

  it("names every machine in ITS OWN hue, in both seats (owner eyeball wave 2)", () => {
    // "the name of the computer to be of the colour that it has — Corsair is purple, vault is green, g5
    // is blue — so it's not just white and plain." Both seats read the RESOLVED hue, which is what makes
    // the sleeping law apply for free: an asleep machine's name greys with its card.
    expect(blockFor(".cv-cutcopy b")).toContain("color: var(--cv-hue)");
    expect(blockFor(".cv-card.is-hero .cv-herocopy b")).toContain("color: var(--cv-hue)");
    // the hero keeps its hard drop — that is what holds a coloured name legible over art
    expect(blockFor(".cv-herocopy b")).toContain("text-shadow: var(--gc-cv-display-shadow)");
    // …and the ROLE line keeps its halo (E5 device round: the bare caption was illegible on busy art —
    // the poster's proven treatment, on the cover's own token)
    expect(blockFor(".cv-herocopy i")).toContain("text-shadow: var(--gc-cv-role-shadow)");
    // …and the HERO half is a main-seat reading of a cut-in ruling, so it stays trivially revertible:
    // its own single-declaration rule, never folded into the block above
    expect(blockFor(".cv-card.is-hero .cv-herocopy b")!.split(":").length - 1).toBe(1);
    // no darkening mechanism was invented for the paper slip — the literal ruling ships (E5 measures it)
    expect(blockFor(".cv-cutcopy")).toContain("background: var(--gc-cv-slip)");
  });

  it("halves the hero scrim's TOP band only (owner eyeball wave 2)", () => {
    // "the dark gradient on top of the image… at the bottom is fine, but at the top it looks a little bit
    // too strong." One lean change — the top band's alpha, 0.82 -> 0.45 — with its run untouched and the
    // bottom and leading bands byte-identical to the lab's.
    const scrim = tokens.slice(
      tokens.indexOf("--gc-cv-hero-scrim:"),
      tokens.indexOf(";", tokens.indexOf("--gc-cv-hero-scrim:")),
    );
    expect(scrim).toContain(
      "linear-gradient(0deg, #08070cf5 0 8%, #08070c8c 26%, transparent 52%)",
    );
    expect(scrim).toContain("linear-gradient(90deg, #08070ce0, #08070c3d 36%, transparent 58%)");
    expect(scrim).toContain("linear-gradient(180deg, #08070c73 0 11%, transparent 33%)");
    expect(scrim, "the lab's heavy top band must not come back").not.toContain("#08070cd1");
  });

  it("floods the DEVELOP wash with the unit's TRUE hue, not the suppressed one", () => {
    // The one deliberate exception to the rule above, and it is the whole gesture of the ceremony: the
    // machine being developed is by definition asleep, so its `--cv-hue` is the grey suppression — a wash
    // reading it would put grey over grey. It reads the INPUT, which is the colour flooding back in.
    const wash = blockFor(".cv-dev")!;
    expect(wash).toContain("var(--cv-rar)");
    expect(wash).not.toContain("var(--cv-hue)");
    expect(blockFor(".cv-card.developing .cv-dev")).toContain("animation: gacha-cv-dev");
  });

  it("keeps the chip on the THEME's status grammar and never tints the stars by the hue", () => {
    expect(blockFor(".cv-chip")).toContain("background: var(--gc-online-fill)");
    expect(blockFor(".cv-card.asleep .cv-chip")).toContain("background: var(--gc-pill-bg)");
    expect(blockFor(".cv-card.busy .cv-chip")).toContain("background: var(--accent-fill)");
    const stars = blockFor(".cv-stars")!;
    expect(stars).toContain("var(--gc-star)");
    expect(stars).not.toContain("--cv-hue");
    // The row wears the CARD row's own metrics (E5 device round: the shipped one-size-down 11.5px read
    // too small on the hero art). No local re-DECLARATION may creep back — the trailing colon is what
    // distinguishes a declaration from the `var(--gc-star-gap)` read the block legitimately keeps.
    expect(stars).not.toContain("--gc-star-size:");
    expect(stars).not.toContain("--gc-star-gap:");
    expect(blockFor(".cv-card.asleep .cv-stars")).toContain("var(--gc-star-dim)");
  });

  it("THE SIGNED STRUCTURAL EXCEPTION: the strapline restyles the banner, and only there", () => {
    // Owner ruling ① (E1) — the banner renders byte-identically under every layout — is a claim about
    // the LAYOUT STAMP, and it still holds: no `body[data-gc-fleet]` rule touches the banner (the poster
    // suite enumerates that). The cover is the one composition that gives the banner a different SEAT,
    // and E2 signs off a strip form for it. Enumerated HERE, as its own list, so new drift still fails:
    // every banner rule the cover adds must be scoped by `.cv-strap`, which is markup only this layout
    // renders — it cannot leak to a banner sitting anywhere else.
    // Same rule reader as the poster's enumeration, for the same reason: a multi-line list must not be
    // able to smuggle a banner rule past this list (Codex E2 MED-4).
    const bannerRules = selectorsMentioning(css, ".gc-banner").map(({ selector }) => selector);
    const covered = bannerRules.filter((s) => s.includes(".cv-"));
    expect(covered.sort()).toEqual(
      [
        ".cv-strap .gc-banner",
        ".cv-strap .gc-banner-copy",
        ".cv-strap .gc-banner-copy .tag",
        ".cv-strap .gc-banner-copy b",
        ".cv-strap .gc-banner-copy small",
        ".cv-strap .gc-banner-dots",
        ".cv-strap .gc-banner-rate",
        ".cv-strap .gc-banner-rate span",
      ].sort(),
    );
    // …and every one of them really is seat-scoped, never mode-scoped
    for (const sel of covered) expect(sel.startsWith(".cv-strap ")).toBe(true);
    // the strip's own two structural facts: a height token, and the paper keyline that makes it printed
    expect(blockFor(".cv-strap .gc-banner")).toContain("height: var(--cv-bn-h)");
    expect(blockFor(".cv-strap .gc-banner")).toContain("inset 0 0 0 2px var(--gc-cv-paper)");
    expect(blockFor(".cv-frame")).toContain("--cv-bn-h: 88px");
  });

  it("gates every ceremony on the app's own motion axis, with no OS media query", () => {
    // (`.cv-page` left this list 2026-08-30: its 320ms fold transition was deleted with the page
    // turn — a rule with nothing to gate needs no reduced-motion clause. The ghost cross-fade's own
    // belts are asserted structurally by their selectors below.)
    for (const sel of ['body[data-motion="reduced"] .cv-card.is-cut'])
      expect(blockFor(sel), `no reduced-motion rule for ${sel}`).toBeTruthy();
    expect(css).toContain('body[data-motion="reduced"] .cv-heroslot > .cv-ghost');
    expect(css).toContain('body[data-motion="reduced"] .cv-shake.shaking');
    expect(css).toContain('body[data-motion="reduced"] .cv-flash.fire');
    // the repo's named parallel-implementation trap: gacha models the preference itself
    expect(css).not.toContain("prefers-reduced-motion");
    // …and every cover animation is transform/opacity only (§14.11)
    const frames = [...css.matchAll(/@keyframes (gacha-cv-[\w-]+) \{([\s\S]*?)\n {4}\}/g)];
    expect(frames.length).toBeGreaterThanOrEqual(6);
    for (const [, name, body] of frames)
      for (const decl of body.matchAll(/\n\s+([a-z-]+):/g))
        expect(["transform", "opacity"], `${name} animates ${decl[1]}`).toContain(decl[1]);
  });

  it("writes no literal colour of its own — every ink is a token (council M7)", () => {
    for (const t of [
      "--gc-cv-field",
      "--gc-cv-paper",
      "--gc-cv-slip",
      "--gc-cv-slip-ink",
      "--gc-cv-hero-scrim",
      "--gc-cv-cut-scrim",
      "--gc-cv-display-shadow",
      "--gc-cv-role-shadow",
      "--gc-cv-stamp-ink",
      "--gc-cv-flash",
    ])
      expect(tokens.split(`${t}:`).length - 1, `${t} must be declared exactly once`).toBe(1);
  });
});
