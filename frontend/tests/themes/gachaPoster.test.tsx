import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE POSTER, RENDERED (GACHA_PLAN §12.6 E1) — the R25 §Q7 pins ⑦-⑫ plus the anatomy claims that are
// checkable without a browser. `useFleet` is mocked to a fixed FleetView and the media index to the
// fresh-install state (the `gachaFleet.test.tsx` harness), so these exercise the LAYOUT's own wiring
// rather than the query layer.
//
// The layout is driven through the real Surface: `themeSettings.gacha.fleetLayout = "poster"` is what
// `fleetSurface` resolves against, so every case here also proves the E0 seam resolves a REGISTERED
// variant end to end rather than a component imported directly.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));
const media = vi.hoisted((): { data: unknown } => ({ data: undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));

// jsdom shims for the ONE case below that renders gacha's whole Root (the body-attr stamp): the kit shell
// measures with ResizeObserver and resets the scroller on a section change. House convention — setup.ts
// keeps only the unavoidable ones (the `kitBackground.test.tsx` precedent).
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

/// <reference types="node" />
// ^ the CSS-reading block at the end reads gacha's stylesheet from disk (fs/path/process); the tests
//   tsconfig pins `types:["vitest"]`, so node's globals are pulled in explicitly.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { setGachaReelRunning } from "../../src/store/gachaReel";
import { setThemeSetting, setUI } from "../../src/store/ui";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { GachaPoster } from "../../src/themes/gacha/GachaPoster";
import { GachaRoot } from "../../src/themes/gacha/GachaRoot";
import type { GachaTrackProps } from "../../src/themes/gacha/GachaTrack";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import type { Host, HostServiceCfg } from "../../src/types";

/** N CONFIGURED services — the rarity input, and the registry's SERVICES line. */
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

const slices = (c: HTMLElement): HTMLButtonElement[] => [
  ...c.querySelectorAll<HTMLButtonElement>(".po-slice"),
];
const data = (c: HTMLElement): HTMLElement | null => c.querySelector<HTMLElement>(".po-data");
const live = (c: HTMLElement): string => c.querySelector(".gc-live")?.textContent ?? "";
const dossierName = (): string | null =>
  document.querySelector(".gc-dossier-title h2")?.textContent ?? null;
const runFn = (): ReturnType<typeof vi.fn> => fleet.view.run as ReturnType<typeof vi.fn>;

/** A media index whose ONE character file is UNUSABLE — the resolver's placeholder case (`toArt` returns
 *  null for it), and the only way to reach `.po-art-blank`: an EMPTY `characters` role falls back to the
 *  bundled cast, so "no owner files" is not the same thing as "no art". */
const unusableIndex = {
  ns: "gacha",
  collation: "casefold-natural",
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

/** Stub `document.startViewTransition` and hold its callbacks (the `gachaFleet.test.tsx` idiom). Without
 *  it `viewTransitionsActive()` is false in jsdom and every open takes the plain path — which would make a
 *  morph assertion silently vacuous. Torn down in the file's own `afterEach`. */
function deferVT() {
  const pending: (() => void)[] = [];
  const start = vi.fn((cb: () => void) => {
    pending.push(cb);
    return { ready: Promise.resolve(), finished: Promise.resolve() };
  });
  (document as { startViewTransition?: unknown }).startViewTransition = start;
  return {
    start,
    pending,
    /** Run one held callback (React state lands inside it, so it needs `act`). */
    run: (i: number) => act(() => void pending[i]()),
  };
}

/** The layout's props, filled with inert values — for the handful of claims that are about the CONTRACT
 *  rather than about the body above it. `ribbonHost: null` is the sharp case: `GachaFleet`'s effect always
 *  picks a machine while the fleet has one, so "no ribbon" is unreachable through it. */
const posterProps = (over: Partial<GachaTrackProps> = {}): GachaTrackProps => ({
  hosts: [host("pegasus", true), host("atlas", false)],
  error: null,
  isLoading: false,
  reeling: false,
  shapes: [],
  starMode: "five",
  ribbonHost: null,
  art: () => null,
  counter: "01 / 02",
  onOpenHost: vi.fn(),
  picked: "pegasus",
  onTapHost: vi.fn(),
  busy: new Set<string>(),
  waking: new Set<string>(),
  ...over,
});

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  setThemeSetting("gacha", "fleetLayout", "poster");
  setFleet();
  media.data = undefined; // no owner files ⇒ the bundled cast, which is every case but the blank one
  vi.spyOn(Math, "random").mockReturnValue(0); // the NEW ribbon's roll (unused here, pinned anyway)
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    vi.restoreAllMocks();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    setGachaReelRunning(false);
    setUI({ themeSettings: {} });
  }
});

// ── the layout resolves, and it is the poster ────────────────────────────────────────────────────────
describe("the poster resolves through the fleet Surface", () => {
  it("renders one slice per machine, the INHERITED track head, and no capsule track", () => {
    const { container } = render(<GachaFleet active />);
    expect(slices(container)).toHaveLength(3);
    expect(container.querySelector(".gc-track")).toBeNull();
    // §12.6 ruling 9: capsule and poster keep the inherited head; the lab's local "Fleet" kicker dies.
    expect(container.querySelector(".gc-track-head h1")?.textContent).toContain(
      GACHA_COPY.trackHead,
    );
    expect(container.querySelector(".gc-track-head .count")?.textContent).toBe("02 / 03");
  });

  it("stamps the name treatment on the stack, and the setting moves it", () => {
    const { container, rerender } = render(<GachaFleet active />);
    // BLADE is the owner's default — declared, not assumed
    expect(container.querySelector(".po-poster")?.getAttribute("data-name")).toBe("blade");
    act(() => setThemeSetting("gacha", "posterName", "plate"));
    rerender(<GachaFleet active />);
    expect(container.querySelector(".po-poster")?.getAttribute("data-name")).toBe("plate");
  });

  it("gives every slice ONE accessible name that spells BOTH steps (the two-step contract)", () => {
    const { container } = render(<GachaFleet active />);
    expect(slices(container).map((b) => b.getAttribute("aria-label"))).toEqual([
      "pegasus, workstation, 2 stars, online. Selected. Tap to open the unit dossier.",
      "atlas, workstation, 2 stars, sleeping. Tap to select; tap again to run the wake sequence.",
      "vault, workstation, 2 stars, online. Tap to select; tap again to open the unit dossier.",
    ]);
  });

  it("wears the PER-UNIT hue ring by fleet position, not by rarity", () => {
    // OWNER RULING (dev-unit walk): §12.6 ruling 8's rarity->hue binding is overruled. His fleet is two
    // 2-star and two 3-star machines, so a rarity ladder painted it near-homogeneous — the colour says
    // WHICH MACHINE now, and the stars keep saying how rare it is. Position, not id hash: the roster
    // resolver's own idiom, so a machine's colour sits beside its portrait under one rule.
    const { container } = render(<GachaFleet active />);
    expect(slices(container).map((b) => b.style.getPropertyValue("--po-rar"))).toEqual([
      "var(--gc-unit-1)",
      "var(--gc-unit-2)",
      "var(--gc-unit-3)",
    ]);
    // three machines, three DISTINCT stops — which is the whole point of the change
    expect(new Set(slices(container).map((b) => b.style.getPropertyValue("--po-rar"))).size).toBe(
      3,
    );
    // …and the registry rides the SELECTED machine's own stop (identity, so it must match its slice)
    expect(data(container)!.style.getPropertyValue("--po-rar")).toBe("var(--gc-unit-1)");
  });

  it("keeps the registry's hue on the machine it names, across a re-selection", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[2]));
    expect(data(container)!.style.getPropertyValue("--po-rar")).toBe("var(--gc-unit-3)");
    expect(data(container)!.querySelector(".po-fname")!.textContent).toBe("vault");
  });

  it("selects host[0] at boot by RESOLVING it, and marks it with aria-pressed", () => {
    const { container } = render(<GachaFleet active />);
    expect(slices(container).map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(data(container)?.querySelector(".po-fname")?.textContent).toBe("pegasus");
  });
});

// ── ⑦ ⑧ ⑨ · SELECT-THEN-ACT ─────────────────────────────────────────────────────────────────────────
describe("select-then-act", () => {
  it("⑦ the FIRST tap selects and opens nothing; the SECOND opens the dossier", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[2])); // vault, online, not selected
    expect(dossierName()).toBeNull();
    expect(slices(container)[2].getAttribute("aria-pressed")).toBe("true");
    expect(slices(container)[0].getAttribute("aria-pressed")).toBe("false");
    expect(runFn()).not.toHaveBeenCalled();

    act(() => void fireEvent.click(slices(container)[2]));
    expect(dossierName()).toBe("vault");
  });

  it("⑧ the second tap on a SLEEPING machine wakes it — same seam, and no confirm dialog", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1])); // atlas: select
    expect(runFn()).not.toHaveBeenCalled();
    act(() => void fireEvent.click(slices(container)[1])); // atlas: wake
    // The SAME `run("wake", host)` the dossier's Wake button calls — no new execution path exists here.
    expect(runFn()).toHaveBeenCalledTimes(1);
    expect(runFn().mock.calls[0][0]).toBe("wake");
    expect((runFn().mock.calls[0][1] as Host).id).toBe("atlas");
    // …and nothing gates it in the UI: `wake_host` is risk=LOW with no `confirm`, so the registry (D8)
    // lets it through. The real POST + the no-dialog negative are e2e ㉒ at E4; this is the render-level
    // half — no dialog, and no dossier either (a wake must not double as an open).
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dossierName()).toBeNull();
  });

  it("⑨ tapping a DIFFERENT slice re-selects and sends nothing", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1]));
    act(() => void fireEvent.click(slices(container)[2]));
    expect(slices(container).map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(runFn()).not.toHaveBeenCalled();
    expect(dossierName()).toBeNull();
  });

  it("routes on the CURRENT liveness — a machine that woke between taps OPENS, it is not re-woken", () => {
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1])); // atlas, asleep: select
    setFleet({
      hosts: [host("pegasus", true), host("atlas", true), host("vault", true)],
      run: fleet.view.run,
    });
    rerender(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1])); // the poll says it is up now
    expect(runFn()).not.toHaveBeenCalled();
    expect(dossierName()).toBe("atlas");
  });

  it("the SECOND tap carries the capsule's image MORPH — the slice hands over its own portrait", () => {
    // OWNER RULING (dev-unit walk): §12.6 5②'s "capsule-only" is AMENDED. Its stated basis was only that
    // a morph clone sourced from a sheared clip-path had never been seen — the owner asked to see it.
    // The observable claim is the one that matters: the tapped slice's `<img>` is the element named for
    // the OLD capture, exactly as a capsule card's is, and the name is cleared inside the callback so a
    // stray one cannot dup-skip the next transition.
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
    const img = () => container.querySelectorAll<HTMLElement>(".po-art img")[2];
    act(() => void fireEvent.click(slices(container)[2])); // select vault
    act(() => void fireEvent.click(slices(container)[2])); // open — through a transition
    expect(vt.start).toHaveBeenCalledTimes(1);
    // named NOW: the old capture happens after the call returns, and the sheet has not opened yet
    expect(img().style.getPropertyValue("view-transition-name")).toBe("capsule-shell");
    expect(dossierName()).toBeNull();

    vt.run(0);
    expect(dossierName()).toBe("vault");
    expect(img().style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("an ART-LESS slice opens PLAIN, with no branch of its own", () => {
    // `.po-art-blank` is a span, so the GachaCard idiom (`currentTarget.querySelector("img")`) yields
    // null and the shared opener takes its own plain path. The degradation is the opener's, not the
    // layout's — which is why there is no `art ? … : …` anywhere in the tap handler.
    setFleet({ hosts: [host("solo", true, { services: [] })] });
    media.data = unusableIndex;
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".po-art-blank")).not.toBeNull();
    act(() => void fireEvent.click(slices(container)[0]));
    act(() => void fireEvent.click(slices(container)[0]));
    expect(vt.start).not.toHaveBeenCalled(); // no transition was ever started
    expect(dossierName()).toBe("solo");
  });

  it("the second tap does NOT dismiss the dossier it just opened (the `.gc-host-hit` exemption)", () => {
    // Re-verified ON THE MORPH PATH (it is the shipped one now): the opening click is the same click the
    // document listener sees, and the transition only changes WHEN the sheet commits — so the exemption
    // has to hold with the callback landing a tick later, not just on the plain open.
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[2]));
    act(() => void fireEvent.click(slices(container)[2]));
    vt.run(0);
    expect(dossierName()).toBe("vault");
    expect(document.body.dataset.sheet).toBe("open");
    // the tap-outside listener runs on the document; a slice is exempt by its semantic class
    expect(slices(container)[2].classList.contains("gc-host-hit")).toBe(true);
    // …and a real outside tap still closes it. Read through `body[data-sheet]` rather than through the
    // dossier's presence: the sheet RETAINS its content for the 420 ms exit slide, so the h2 outlives
    // the close by design.
    act(() => void fireEvent.click(document.body));
    expect(document.body.dataset.sheet).toBeUndefined();
  });
});

// ── ⑩ · BUSY ────────────────────────────────────────────────────────────────────────────────────────
describe("⑩ busy reaches the slice", () => {
  it("disables it, marks aria-busy and carries a class — for ANY in-flight action on that machine", () => {
    setFleet({ busy: new Set(["atlas"]) });
    const { container } = render(<GachaFleet active />);
    const [, atlas, vault] = slices(container);
    expect(atlas.disabled).toBe(true);
    expect(atlas.getAttribute("aria-busy")).toBe("true");
    expect(atlas.classList.contains("busy")).toBe(true);
    expect(vault.disabled).toBe(false);
    expect(vault.hasAttribute("aria-busy")).toBe(false);
  });

  it("refuses a second wake while one is already in flight on that machine", () => {
    // Rewritten after Codex E1 LOW-7: the first version seeded atlas BUSY, so its slice was `disabled`
    // from the first paint and neither click ever reached React — removing the handler's busy guard would
    // not have failed it. The machine has to be SELECTED while free, then go busy, so the second
    // activation is a real attempt at the guard.
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1])); // atlas selected while free
    expect(slices(container)[1].getAttribute("aria-pressed")).toBe("true");
    expect(runFn()).not.toHaveBeenCalled();

    setFleet({ busy: new Set(["atlas"]), run: fleet.view.run }); // an action lands on it
    rerender(<GachaFleet active />);
    expect(slices(container)[1].getAttribute("aria-pressed")).toBe("true"); // still the selection
    expect(slices(container)[1].disabled).toBe(true);

    // the guard is SYNCHRONOUS in the handler, not just the disabled attribute: jsdom will dispatch into
    // a disabled button where a real engine would not, so the handler is invoked directly here — which is
    // exactly the path a stale render or a programmatic activation would take.
    act(() => void slices(container)[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(runFn()).not.toHaveBeenCalled();
  });
});

// ── OVERLAPPING WAKES + REPEATED ANNOUNCEMENTS (Codex E1 LOW-4 + LOW-5) ──────────────────────────────
// Both need the previous ceremony to be OVER before the next gesture: a tap while one is running is a
// SKIP by design (R24 §B.3), not a second action — so these run on fake timers and step past the budget.
describe("a second gesture, after the first ceremony has finished", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** select then act on slice `i`, and let its ceremony run out. */
  const act2 = (c: HTMLElement, i: number) => {
    act(() => void fireEvent.click(slices(c)[i]));
    act(() => void fireEvent.click(slices(c)[i]));
    act(() => void vi.advanceTimersByTime(1000));
  };

  it("keeps WAKING on a machine whose request is still flying while ANOTHER is woken", async () => {
    // One `wakingHost` SLOT could not represent two overlapping requests: dispatching B made A's chip
    // drop straight to SLEEPING while A's own request was still in the air — a false negative about a
    // request the app had genuinely sent. It is a Set now, and each machine leaves on its OWN settle.
    let settleA = () => {};
    const run = vi.fn((_action: string, h: Host) =>
      h.id === "atlas" ? new Promise<void>((r) => (settleA = r)) : Promise.resolve(),
    );
    setFleet({ hosts: [host("pegasus", true), host("atlas", false), host("relay", false)], run });
    const { container } = render(<GachaFleet active />);
    const chip = (i: number) => slices(container)[i].querySelector(".po-chip")!.textContent;

    act2(container, 1); // atlas — its request never settles
    expect(chip(1)).toBe("WAKING");
    act2(container, 2); // relay — settles immediately
    expect(chip(1)).toBe("WAKING"); // atlas is STILL in flight and still says so
    expect(run).toHaveBeenCalledTimes(2);

    // AWAITED, not returned as a `.then` chain (caught by the FULL run, not by the targeted one): an
    // assertion inside a trailing `.then` can be flushed by React's async-act machinery after the test's
    // own teardown has unmounted the tree, and it then throws `container.querySelector of undefined` as
    // an UNHANDLED error while every test still reports green.
    await act(async () => {
      settleA();
      await Promise.resolve();
    });
    // …and it leaves on its own settle, back to the SERVER's word — never to ONLINE
    expect(chip(1)).toBe("SLEEPING");
  });

  it("RE-ANNOUNCES an identical message — a retry of the same failed wake is not silent", () => {
    // Writing the same string twice is a React bail-out: no re-render, no DOM mutation, and a polite
    // region only speaks when its content CHANGES — so the second attempt at the same machine said
    // nothing at all. The region renders a child keyed on a monotonic sequence now, so the claim is that
    // the NODE swaps, which is the mutation an AT can actually see.
    const { container } = render(<GachaFleet active />);
    const spoken = () => container.querySelector(".gc-live span")!;
    act2(container, 1);
    const first = spoken();
    expect(first.textContent).toBe("Waking atlas.");

    // the request has settled and the machine is still asleep; the owner taps it again
    act(() => void fireEvent.click(slices(container)[1]));
    const second = spoken();
    expect(second.textContent).toBe("Waking atlas.");
    expect(second).not.toBe(first); // a real node swap, not the same node re-asserted
    expect(runFn()).toHaveBeenCalledTimes(2);
  });
});

// ── ⑪ ⑫ · THE REGISTRY, AND SELECTION ACROSS POLLS ───────────────────────────────────────────────────
describe("⑪ the registry follows the live machine", () => {
  it("prints role / status / ping, the UPTIME dash and the configured services", () => {
    const { container } = render(<GachaFleet active />);
    const rows = [...data(container)!.querySelectorAll("div")].map((d) => d.textContent);
    expect(rows[0]).toBe("WORKSTATION · ONLINE · PING 18 ms");
    // UPTIME is the DEFERRED seam's ruled em dash — the same one the dossier's metric grid prints.
    expect(rows[1]).toContain(`UPTIME ${GACHA_COPY.metricPending}`);
    expect(rows[1]).toContain("SEEN NOW");
    expect(rows[2]).toBe("SERVICES · GRAFANA · SONARR");
    // A READOUT: no buttons anywhere in it (the poster owns exactly one control per machine).
    expect(data(container)!.querySelector("button")).toBeNull();
  });

  it("follows a POLL that changes the selected machine's own facts", () => {
    const { container, rerender } = render(<GachaFleet active />);
    expect(data(container)!.textContent).toContain("ONLINE");
    setFleet({
      hosts: [host("pegasus", false), host("atlas", false), host("vault", true)],
      run: fleet.view.run,
    });
    rerender(<GachaFleet active />);
    expect(data(container)!.textContent).toContain("SLEEPING");
    expect(data(container)!.textContent).toContain(`PING ${GACHA_COPY.metricPending}`);
  });

  it("says NONE rather than an empty line for a machine with no services", () => {
    setFleet({ hosts: [host("bare", true, { services: [] })] });
    const { container } = render(<GachaFleet active />);
    expect(data(container)!.textContent).toContain("SERVICES · NONE");
  });
});

describe("⑫ the selection across polls", () => {
  it("SURVIVES a re-order — it is keyed on the machine, never on its index", () => {
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[2])); // vault
    setFleet({
      hosts: [host("vault", true), host("pegasus", true), host("atlas", false)],
      run: fleet.view.run,
    });
    rerender(<GachaFleet active />);
    expect(slices(container).map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(data(container)?.querySelector(".po-fname")?.textContent).toBe("vault");
  });

  it("RE-DERIVES when the selected machine leaves the fleet (the view falls back to hosts[0])", () => {
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[2])); // vault
    setFleet({ hosts: [host("pegasus", true), host("atlas", false)], run: fleet.view.run });
    rerender(<GachaFleet active />);
    // never empty while machines exist, and never pointing at the gone one
    expect(slices(container)[0].getAttribute("aria-pressed")).toBe("true");
    expect(data(container)?.querySelector(".po-fname")?.textContent).toBe("pegasus");
  });

  it("clears on leaving the tab, and comes back at the resolved default", () => {
    const { container, rerender } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[2]));
    rerender(<GachaFleet active={false} />);
    rerender(<GachaFleet active />);
    expect(slices(container)[0].getAttribute("aria-pressed")).toBe("true");
    expect(live(container)).toBe("");
  });
});

// ── THE LIVE REGION (ruling 3) ───────────────────────────────────────────────────────────────────────
describe("the fleet's live region", () => {
  it("exists before it is needed, and announces the selection", () => {
    const { container } = render(<GachaFleet active />);
    const region = container.querySelector(".gc-live")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe(""); // mounted empty — a region added WITH its text is missed
    act(() => void fireEvent.click(container.querySelectorAll<HTMLElement>(".po-slice")[1]));
    expect(live(container)).toBe("atlas selected. WORKSTATION, 2 stars, SLEEPING.");
  });

  it("announces the wake REQUEST, and never claims the machine came up", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1]));
    act(() => void fireEvent.click(slices(container)[1]));
    expect(live(container)).toBe("Waking atlas.");
  });
});

// ── THE WAKE CEREMONY (ruling 4 + 10) ────────────────────────────────────────────────────────────────
describe("the wake ceremony", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const wake = (c: HTMLElement) => {
    act(() => void fireEvent.click(slices(c)[1]));
    act(() => void fireEvent.click(slices(c)[1]));
  };

  it("parts the stack, sweeps the waking slice, and lands back at rest", () => {
    const { container } = render(<GachaFleet active />);
    wake(container);
    act(() => void vi.advanceTimersByTime(0));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(true);
    // the parting is expressed around the WAKING slice: above it lifts, below it drops, it stays put
    expect(slices(container).map((b) => b.style.getPropertyValue("--po-part"))).toEqual([
      "-1",
      "0",
      "1",
    ]);
    act(() => void vi.advanceTimersByTime(180));
    expect(slices(container)[1].classList.contains("waking")).toBe(true);
    act(() => void vi.advanceTimersByTime(520));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
    act(() => void vi.advanceTimersByTime(200));
    expect(container.querySelector(".po-slice.waking")).toBeNull();
  });

  it("is POLL-TRUTHFUL: the chip says WAKING while the request flies, then the SERVER's word", async () => {
    let settle = () => {};
    setFleet({ run: vi.fn(() => new Promise<void>((r) => (settle = r))) });
    const { container } = render(<GachaFleet active />);
    wake(container);
    expect(slices(container)[1].querySelector(".po-chip")!.textContent).toBe("WAKING");
    await act(async () => {
      settle();
      await Promise.resolve();
    });
    // …and it falls back to SLEEPING, not to ONLINE: only a hosts poll may flip a machine up.
    expect(slices(container)[1].querySelector(".po-chip")!.textContent).toBe("SLEEPING");
  });

  it("TAP-ANYWHERE-SKIP completes every remaining beat at once (R24 §B.3)", () => {
    const { container } = render(<GachaFleet active />);
    wake(container);
    act(() => void vi.advanceTimersByTime(200));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(true);
    act(() => void fireEvent.pointerDown(document.body));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
    expect(container.querySelector(".po-slice.waking")).toBeNull();
    // completed, not abandoned: advancing past the budget changes nothing further
    act(() => void vi.advanceTimersByTime(2000));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
  });

  it("a SKIP GESTURE does not also route: the real pointerdown -> click sequence (Codex E1 MED-1)", () => {
    // The regression the previous suite could not see, because it only ever fired `pointerDown` on
    // `document.body` — never the two-event sequence a real finger produces on a SLICE. The skip listener
    // ends the ceremony on pointerdown, React commits `running: false`, and the click that follows used
    // to find the guard already down: one gesture, two effects.
    const { container } = render(<GachaFleet active />);
    wake(container); // atlas
    act(() => void vi.advanceTimersByTime(200));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(true);
    expect(runFn()).toHaveBeenCalledTimes(1);

    // The SAME finger, on a DIFFERENT machine, mid-ceremony — as TWO separate `act`s, which is the
    // whole point: a real browser dispatches pointerdown and click as separate tasks and React commits
    // the skip's `running: false` in between. Batching them into one `act` hides the finding entirely
    // (verified: the single-act form passes with the fix REMOVED).
    act(() => void fireEvent.pointerDown(slices(container)[2]));
    act(() => void fireEvent.click(slices(container)[2]));
    // the beats completed (a skip COMPLETES, it does not abandon) …
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
    expect(container.querySelector(".po-slice.waking")).toBeNull();
    // … and the gesture did NOT also re-select
    expect(slices(container).map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(runFn()).toHaveBeenCalledTimes(1);

    // …and the NEXT gesture is a normal one — the suppression is per-gesture, never sticky
    act(() => void fireEvent.pointerDown(slices(container)[2]));
    act(() => void fireEvent.click(slices(container)[2]));
    expect(slices(container)[2].getAttribute("aria-pressed")).toBe("true");
  });

  it("a skip gesture on the SAME sleeping slice cannot send a second wake", () => {
    // The sharper half of MED-1: a wake request that settles inside the 900 ms re-enables the still-
    // sleeping slice, so the skip tap lands on a live control whose second-tap action is `wake`.
    const { container } = render(<GachaFleet active />);
    wake(container);
    act(() => void vi.advanceTimersByTime(200));
    expect(runFn()).toHaveBeenCalledTimes(1);
    act(() => void fireEvent.pointerDown(slices(container)[1]));
    act(() => void fireEvent.click(slices(container)[1]));
    expect(runFn()).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
  });

  it("a KEYBOARD activation mid-ceremony still skips rather than acting (no pointerdown to record)", () => {
    // Enter/Space produce a `click` with no pointerdown at all, so the per-gesture ref can never cover
    // them — the handler's own `ceremony.running` guard is what does, and this is the case that proves
    // the belt is load-bearing rather than dead code.
    const { container } = render(<GachaFleet active />);
    wake(container);
    act(() => void vi.advanceTimersByTime(200));
    act(() => void fireEvent.click(slices(container)[2])); // a click with no pointer gesture behind it
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
    expect(slices(container)[2].getAttribute("aria-pressed")).toBe("false");
    expect(runFn()).toHaveBeenCalledTimes(1);
  });

  it("a CLICKLESS skip cannot swallow the next keyboard activation (Codex confirm-round LOW)", () => {
    // A pointerdown that skips but never produces a click (the finger dragged away) leaves the
    // suppression standing — and a keyboard activation, being click-without-pointerdown, has nothing to
    // overwrite it with. `keydown` clearing the ref is what keeps that Enter from paying for a pointer
    // gesture that already spent itself.
    const { container } = render(<GachaFleet active />);
    wake(container); // atlas
    act(() => void vi.advanceTimersByTime(200));
    // the skip's pointerdown lands on a slice, but the gesture never clicks (a drag)
    act(() => void fireEvent.pointerDown(slices(container)[2]));
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
    // the NEXT activation is keyboard: keydown then click, no pointerdown
    act(() => void fireEvent.keyDown(slices(container)[2], { key: "Enter" }));
    act(() => void fireEvent.click(slices(container)[2]));
    expect(slices(container)[2].getAttribute("aria-pressed")).toBe("true");
  });

  it("collapses to the end state under REDUCED motion, request and announcement intact", () => {
    act(() => setUI({ motion: "reduced" }));
    const { container } = render(<GachaFleet active />);
    wake(container);
    expect(container.querySelector(".po-poster")!.classList.contains("parting")).toBe(false);
    expect(container.querySelector(".po-slice.waking")).toBeNull();
    expect(runFn()).toHaveBeenCalledTimes(1);
    expect(live(container)).toBe("Waking atlas.");
  });
});

// ── THE SHARED STATES + the resilience rows ──────────────────────────────────────────────────────────
describe("the poster's states match the capsule track's", () => {
  it("renders the empty-fleet message once a poll has answered with nothing", () => {
    setFleet({ hosts: [] });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")?.textContent).toBe("no hosts in config.yaml");
    expect(container.querySelector(".po-poster")).toBeNull();
    expect(container.querySelector(".po-data")).toBeNull();
  });

  it("renders NOTHING below the head while the first poll is in flight", () => {
    setFleet({ hosts: [], isLoading: true, hasData: false });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")).toBeNull();
    expect(container.querySelector(".po-poster")).toBeNull();
  });

  it("renders the error BESIDE the stack the last good poll left", () => {
    setFleet({ error: new Error("boom") });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-msg")?.textContent).toBe("backend unreachable: boom");
    expect(slices(container)).toHaveLength(3);
  });

  it("refuses input while the reel sweeps (§6.4/F3), like the capsule track", () => {
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".po-body")!.hasAttribute("inert")).toBe(false);
    act(() => setGachaReelRunning(true));
    expect(container.querySelector(".po-body")!.hasAttribute("inert")).toBe(true);
    act(() => setGachaReelRunning(false));
    expect(container.querySelector(".po-body")!.hasAttribute("inert")).toBe(false);
  });

  it("a long hostname and a long service list cannot run out of their boxes", () => {
    // The GEOMETRY is a device-round claim. What is assertable here is that the two unbounded strings are
    // drawn by elements that CARRY the containment rules — and after Codex E1 LOW-7 that means reading
    // the declarations out of the stylesheet, not just finding the nodes (node existence would survive
    // someone deleting every one of those rules).
    const sheet = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
    const decls = (sel: string): string => {
      const at = sheet.indexOf(`\n    ${sel} {`);
      return at < 0 ? "" : sheet.slice(at, sheet.indexOf("}", at));
    };
    expect(decls(".po-fname"), ".po-fname must wrap an unbroken hostname").toContain(
      "overflow-wrap: anywhere",
    );
    expect(decls(".po-fsvc"), ".po-fsvc must wrap an unbroken service list").toContain(
      "overflow-wrap: anywhere",
    );
    // `clip-path` hides paint but does NOT contain scrollable overflow — the plate needs `overflow: clip`
    // or a blade's nowrap name shows up as real scrollWidth on the tab scroller.
    expect(decls(".po-plate"), ".po-plate must contain its own overflow").toContain(
      "overflow: clip",
    );
    setFleet({
      hosts: [
        host("this-is-an-extremely-long-machine-hostname-for-a-homelab", true, {
          services: cfg(["grafana", "prometheus", "sonarr", "radarr", "jellyfin", "qbittorrent"]),
        }),
      ],
    });
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".po-fname")).not.toBeNull();
    expect(container.querySelector(".po-fsvc")!.textContent).toContain("QBITTORRENT");
    expect(container.querySelector(".po-plate")).not.toBeNull();
  });

  it("draws a slice with NO art rather than dropping the machine (the placeholder case)", () => {
    // It has to be an UNUSABLE file, not an absent one: an empty `characters` role falls back to the
    // bundled cast, so the first version of this case rendered a perfectly good portrait and proved
    // nothing about the placeholder at all.
    setFleet({ hosts: [host("solo", true)] });
    media.data = unusableIndex;
    const { container } = render(<GachaFleet active />);
    expect(slices(container)).toHaveLength(1);
    expect(container.querySelector(".po-art img")).toBeNull();
    expect(container.querySelector(".po-art-blank")).not.toBeNull();
    // hue, name, role and chip all still read — a slice without art is still a slice
    expect(container.querySelector(".po-name b")?.textContent).toBe("SOLO");
    expect(container.querySelector(".po-chip")?.textContent).toBe("ONLINE");
  });
});

// ── THE `NEW` RIBBON (owner, dev-unit walk — E1's poster-off default overturned) ─────────────────────
describe("the NEW ribbon", () => {
  it("rides exactly ONE slice, the one `ribbonHost` names", () => {
    // The pick is `pickRibbonHost`'s, made once in GachaFleet and STICKY — the same demo the capsule
    // track runs, off the same prop. `Math.random` is pinned to 0 in this file's setup, so the roll
    // lands on hosts[0] and the assertion is about WHICH slice wears it, not about the roll.
    const { container } = render(<GachaFleet active />);
    const ribbons = [...container.querySelectorAll(".po-slice .po-new")];
    expect(ribbons).toHaveLength(1);
    expect(slices(container)[0].querySelector(".po-new")).not.toBeNull();
    expect(slices(container)[1].querySelector(".po-new")).toBeNull();
    expect(slices(container)[2].querySelector(".po-new")).toBeNull();
    // DECORATION, not name material: the same posture the capsule card takes.
    expect(ribbons[0].getAttribute("aria-hidden")).toBe("true");
    expect(ribbons[0].textContent).toBe("NEW");
    // …and it must not leak into the accessible name, which `aria-label` owns outright
    expect(slices(container)[0].getAttribute("aria-label")).not.toContain("NEW");
  });

  it("is ABSENT when nothing is picked", () => {
    // Driven at the props, because it cannot be driven above them: GachaFleet's effect always picks a
    // machine while the fleet has one, so `ribbonHost: null` only exists as a contract state.
    const { container } = render(<GachaPoster {...posterProps({ ribbonHost: null })} />);
    expect(container.querySelectorAll(".po-slice")).toHaveLength(2);
    expect(container.querySelector(".po-new")).toBeNull();
  });

  it("follows the prop rather than an index", () => {
    const { container } = render(<GachaPoster {...posterProps({ ribbonHost: "atlas" })} />);
    expect(container.querySelectorAll(".po-new")).toHaveLength(1);
    expect(
      container.querySelectorAll<HTMLElement>(".po-slice")[1].querySelector(".po-new"),
    ).not.toBeNull();
  });
});

// ── THE BODY STAMP ───────────────────────────────────────────────────────────────────────────────────
// `body[data-gc-fleet]` carries the RESOLVED layout id, stamped by the Root. Its consumer is the SEAM
// COMPACTION below: the poster's track head is the capsule track's own markup, so the only way to give it
// tighter vertical air without moving the shipped capsule look is to scope the override by this attribute.
// (It briefly also drove a gold banner skin and a black page ground; the owner cut both — see the seam
// tests for the standing rule that neither may come back.)
describe("body[data-gc-fleet] — the resolved-layout stamp", () => {
  const drawRoot = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <GachaRoot />
      </QueryClientProvider>,
    );

  it("stamps the RESOLVED layout, follows the setting, and is cleared on unmount", () => {
    const view = drawRoot();
    expect(document.body.dataset.gcFleet).toBe("poster");
    act(() => setThemeSetting("gacha", "fleetLayout", "capsule"));
    expect(document.body.dataset.gcFleet).toBe("capsule");
    // a corrupt/newer synced id resolves to the fallback, exactly as the Surface renders it
    act(() => setThemeSetting("gacha", "fleetLayout", "not-a-layout"));
    expect(document.body.dataset.gcFleet).toBe("capsule");
    // …and a switched-to skin can never inherit gacha's stale attrs (the §10.5 cleanup ledger)
    view.unmount();
    expect(document.body.dataset.gcFleet).toBeUndefined();
  });
});

describe("the poster's stylesheet claims (jsdom paints none of this)", () => {
  const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
  /** One selector's declaration block (values carry no braces, so scanning to the next `}` is exact). */
  const blockFor = (sel: string): string | null => {
    const at = css.indexOf(`\n    ${sel} {`);
    return at < 0 ? null : css.slice(at, css.indexOf("}", at));
  };

  it("resolves the per-unit INPUT into a hue a class can override (the inline-style trap)", () => {
    // An inline custom property beats every selector short of `!important`, so the property the component
    // writes and the property the paint reads MUST be different — else `.asleep` could never suppress the
    // hue. This is the regression: `--po-rar` in, `--po-hue` out, both stylesheet-decided.
    expect(blockFor(".po-slice")).toContain("--po-hue: var(--po-rar)");
    expect(blockFor(".po-slice.asleep")).toContain("--po-hue: var(--gc-unit-off)");
    for (const sel of [".po-drop", ".po-plate", ".po-name b"])
      expect(blockFor(sel), `${sel} must paint the RESOLVED hue`).toContain("var(--po-hue)");
  });

  it("derives the per-unit RING off the accent token, once, with L and C held", () => {
    // The owner's "in line with the theme" ask, as a structural claim: eight stops 45deg apart, derived
    // from `--accent` in OKLCH rather than fitted as 6x8 literals — so every accent palette re-tints the
    // whole fleet for free and a ninth palette needs no colour work. Read from tokens.css, since jsdom
    // resolves none of it.
    const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");
    // stop 1 IS the accent, unrotated
    expect(tokens).toContain("--gc-unit-1: var(--accent);");
    for (let k = 1; k < 8; k++) {
      // `calc(h + 45)`, NOT `+ 45deg`: inside `oklch(from …)` the `h` keyword substitutes a NUMBER of
      // degrees, so an angle there is a type error — and an invalid custom-property value is dropped at
      // computed-value time, unpainting every slice with no error anywhere. Verified against both
      // shipped engines; this row is what keeps the `deg` from creeping back in.
      const decl = `--gc-unit-${k + 1}: oklch(from var(--accent) l c calc(h + ${k * 45}));`;
      expect(tokens, `stop ${k + 1} must be the accent rotated ${k * 45}deg`).toContain(decl);
    }
    // …exactly once each — a duplicate in the same scope would let a later one win silently (the LOW-6
    // lesson, which this file learned the hard way)
    for (let k = 1; k <= 8; k++)
      expect(tokens.split(`--gc-unit-${k}:`).length - 1, `--gc-unit-${k} declared twice`).toBe(1);
    expect(tokens.split("--gc-unit-off:").length - 1).toBe(1);
    // and the RARITY ladder is gone outright — nothing maps a star count to a hue any more
    expect(tokens, "the rarity->hue ladder has no consumer left").not.toContain("--gc-rar-");
    expect(tokens, "an <angle> in the hue channel is a silent type error").not.toMatch(
      /--gc-unit-\d: oklch\([^;]*deg\)/,
    );
  });

  it("does NOT dress the page or the banner — the owner cut both (standing negative)", () => {
    // OWNER RULING (dev-unit walk, after E1's Codex round): the top banner keeps the capsule styling
    // exactly, and the fleet background is not to change either. That OVERRIDES Codex MED-2, whose
    // reasoning was fidelity to the lab's black field — the owner is the authority on the composition.
    //
    // What the owner actually saw is worth recording, because it is subtler than "the black is wrong":
    // the rule paired `background-color: #000` with `background-image: none` on `.kit-main`, and the
    // `none` killed the WALLPAPER while the opaque black covered `.kit`'s own coloured backdrop — so with
    // the wallpaper switched OFF the poster still did not look like capsule. Both halves are gone.
    //
    // A NEGATIVE test rather than nothing, because both were argued for once and would be argued for
    // again: the lab really is a black field with gold furniture, so the next reader of the finalists
    // prototype will reach for exactly these rules. The stamp itself stays — it has a real consumer now
    // (the seam compaction below).
    for (const sel of [
      'body[data-gc-fleet="poster"][data-tab="fleet"] .kit-main',
      'body[data-gc-fleet="poster"] .kit-main',
      'body[data-gc-fleet="poster"] .gc-banner',
      'body[data-gc-fleet="poster"] .gc-banner-copy .tag',
      'body[data-gc-fleet="poster"] .gc-banner-glow',
      'body[data-gc-fleet="poster"] .gc-dot.on .pip',
    ])
      expect(blockFor(sel), `${sel} was CUT by the owner and must not come back`).toBeNull();
    expect(css, "the banner-skin tokens went with the rules").not.toContain("gc-po-banner");
  });

  it("no layout-scoped rule paints a BACKGROUND at all — the two layouts share every background rule", () => {
    // The sharp form of the ruling, and the one that survives someone re-adding the ground under a
    // different selector. Every rule in this file keyed on `data-gc-fleet` is enumerated and checked for
    // background properties: if none of them paints, then under poster the fleet tab resolves EXACTLY the
    // background cascade capsule does — `.kit`'s coloured backdrop, plus the wallpaper's own
    // `[data-wallpaper="on"][data-tab="fleet"] .kit-main` rule, which is layout-blind. That covers both
    // states the owner named (wallpaper ON and OFF) without needing to render either.
    const scoped = [...css.matchAll(/\n {4}([^\n{]*\[data-gc-fleet[^\n{]*)\{([^}]*)\}/g)];
    expect(scoped.length, "the stamp must still have consumers").toBeGreaterThan(0);
    for (const [, sel, body] of scoped) {
      expect(body, `${sel.trim()} must not paint a background`).not.toMatch(/(^|[\s;])background/);
      // …and nothing may reach the shell or the tab box either, whatever it declares
      expect(sel, `${sel.trim()} must not target the shell or the tab`).not.toMatch(
        /\.kit-main|\.kit\b|#tab-|\.tab\b/,
      );
    }
  });

  it("compacts the banner->head->stack seam, POSTER-ONLY and vertical-only", () => {
    // The owner's "less spacing between the cards and the top banner". The head is the CAPSULE TRACK'S
    // OWN markup — both layouts render it byte-identically — so the compaction has to be an override
    // under the layout stamp, never an edit to the shipped rule. Three claims: capsule's number is
    // untouched, the poster's is roughly half of it, and nothing HORIZONTAL moved.
    expect(blockFor(".gc-track-head")).toContain("padding: 22px 14px 10px");
    const head = blockFor('body[data-gc-fleet="poster"] .gc-track-head')!;
    expect(head).toContain("--po-head-pad-top: 11px");
    expect(head).toContain("padding-top: var(--po-head-pad-top)");
    // the lower gap was TWO contributions (head 10 + stack 12); it is one tunable now
    expect(head).toContain("padding-bottom: 0");
    expect(blockFor('body[data-gc-fleet="poster"] .po-poster')).toContain("--po-stack-gap: 11px");
    // vertical only — a side-padding override here would silently unalign the head from the counter
    expect(head).not.toMatch(/padding-(left|right)|padding: /);
  });

  it("seats the NEW ribbon inside the polygon, clear of the chip and the name in BOTH modes", () => {
    // The capsule seats its ribbon flush on the LEADING edge; the poster cannot — that edge is the sheared
    // one. The claim here is the shear-awareness: the seat is expressed in `--run`, not as a flat inset,
    // because near the trailing edge the plate's top boundary is still descending and a `top: 10px` tab
    // would lose its inner corner at every width. The seat itself is an eyeball item (E5).
    const ribbon = blockFor(".po-new")!;
    expect(ribbon).toBeTruthy();
    expect(ribbon).toContain("--po-new-top: calc(var(--run) * 0.22 + 6px)");
    expect(ribbon).toContain("right: 0");
    // decoration, so it is NOT tinted by the rarity hue — a second thing wearing it would read as a
    // second rarity signal
    expect(ribbon).not.toContain("--po-hue");
    expect(ribbon).toContain("background: var(--gc-brand-fill)");
    // …and it never eats a tap meant for the slice underneath it
    expect(ribbon).toContain("pointer-events: none");
  });

  it("pairs the keyline with the art's inset, both on the `outlines` axis (gacha ships it OFF)", () => {
    // Keyline off must also drop the art's 1px inset, or a black hairline survives where the rim was.
    expect(blockFor(".po-art")).toContain("inset: 0");
    expect(blockFor('body[data-outlines="on"] .po-art')).toContain("inset: 1px");
  });

  it("draws the focus ring INSIDE the polygon (a clip-path erases the UA ring — R18)", () => {
    expect(blockFor(".po-slice:focus-visible")).toContain("outline: none");
    const ring = blockFor(".po-slice:focus-visible::after")!;
    expect(ring).toContain("clip-path: var(--poly)");
    expect(ring).toContain("var(--accent)"); // the kit's own ring token, not a poster literal
  });

  it("never tints the star row by the rarity hue (two signals, two colours)", () => {
    const stars = blockFor(".po-stars")!;
    expect(stars).toContain("var(--gc-star)");
    expect(stars).not.toContain("--po-hue");
    expect(blockFor(".po-slice.asleep .po-stars")).toContain("var(--gc-star-dim)");
  });

  it("gates every ambient motion on the app's own axis, and uses no OS media query", () => {
    for (const sel of [
      'body[data-motion="reduced"] .po-slice img',
      'body[data-motion="reduced"] .po-slice.waking .po-flashline',
      'body[data-motion="reduced"] .po-data',
    ])
      expect(blockFor(sel), `no reduced-motion rule for ${sel}`).toBeTruthy();
    // the repo's named parallel-implementation trap: gacha models the preference itself
    expect(css).not.toContain("prefers-reduced-motion");
  });
});
