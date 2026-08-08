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

import { selectorsMentioning } from "./cssRules";

import { setGachaReelRunning } from "../../src/store/gachaReel";
import { setThemeSetting, setUI } from "../../src/store/ui";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { GachaRoot } from "../../src/themes/gacha/GachaRoot";
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

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  setThemeSetting("gacha", "fleetLayout", "poster");
  setFleet();
  media.data = undefined; // no owner files ⇒ the bundled cast, which is every case but the blank one
  vi.spyOn(Math, "random").mockReturnValue(0); // pins `pickRibbonHost`'s roll (the CAPSULE still uses it)
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

  it("gives every slice a name that says as many steps as that machine's tap HAS", () => {
    // The owner's third-walk amendment, as the thing a screen-reader user actually hears: a live machine
    // is one tap, so it says so; a sleeping one keeps both steps named.
    const { container } = render(<GachaFleet active />);
    expect(slices(container).map((b) => b.getAttribute("aria-label"))).toEqual([
      "pegasus, workstation, 2 stars, online. Opens the unit dossier.",
      "atlas, workstation, 2 stars, sleeping. Tap to select; tap again to run the wake sequence.",
      "vault, workstation, 2 stars, online. Opens the unit dossier.",
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
  it("⑦ an ONLINE machine opens on ONE tap — and that tap SELECTS it, so the registry follows", () => {
    // OWNER AMENDMENT (third walk): "by default I don't want the double tap — only when the PC needs to
    // be woken up." Opening is the act; selecting rides along (the cosmos one-tap select-and-open
    // precedent), which is what keeps the registry pointing at the machine you just opened.
    const { container } = render(<GachaFleet active />);
    expect(slices(container)[0].getAttribute("aria-pressed")).toBe("true"); // host[0] resolved at boot
    act(() => void fireEvent.click(slices(container)[2])); // vault, online, NOT selected
    expect(dossierName()).toBe("vault");
    expect(slices(container)[2].getAttribute("aria-pressed")).toBe("true");
    expect(slices(container)[0].getAttribute("aria-pressed")).toBe("false");
    expect(data(container)!.querySelector(".po-fname")!.textContent).toBe("vault");
    expect(runFn()).not.toHaveBeenCalled();
  });

  it("⑦b a SLEEPING machine still takes two taps — the guard the double-tap was kept FOR", () => {
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1])); // atlas, asleep
    expect(dossierName()).toBeNull();
    expect(runFn()).not.toHaveBeenCalled();
    expect(slices(container)[1].getAttribute("aria-pressed")).toBe("true");
    act(() => void fireEvent.click(slices(container)[1]));
    expect(runFn()).toHaveBeenCalledTimes(1);
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

  it("⑨ moving between SLEEPING machines re-selects and sends nothing", () => {
    // The re-select case only exists among asleep machines now — tapping a live one opens it. Two
    // sleeping machines are what makes "the second tap went to a DIFFERENT machine, so it selects rather
    // than wakes" a real case rather than a hypothetical.
    setFleet({ hosts: [host("pegasus", true), host("atlas", false), host("relay", false)] });
    const { container } = render(<GachaFleet active />);
    act(() => void fireEvent.click(slices(container)[1])); // select atlas
    act(() => void fireEvent.click(slices(container)[2])); // a DIFFERENT sleeping one: select, never wake
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

  it("names the CLIP CARRIER `.po-art` for the morph, never the `<img>` inside it (R26)", () => {
    // R26's verified result: a captured element's OWN `clip-path` bakes into its View-Transition
    // snapshot — only ANCESTOR clipping is lost — so naming the picture one level BELOW the clip made
    // the full rectangle fly and pop. Naming the span that carries `--poly` makes the actual sheared
    // cutout fly (0 leaked frames on both engines). The name still lands before the old capture and is
    // cleared inside the callback, so a stray one cannot dup-skip the next transition.
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
    const slice = () => slices(container)[2];
    const art = () => slice().querySelector<HTMLElement>(".po-art")!;
    const img = () => slice().querySelector<HTMLElement>(".po-art img")!;
    act(() => void fireEvent.click(slice())); // vault is online: one tap opens
    expect(vt.start).toHaveBeenCalledTimes(1);
    // named NOW: the old capture happens after the call returns, and the sheet has not opened yet
    expect(art().style.getPropertyValue("view-transition-name")).toBe("capsule-shell");
    // …and emphatically NOT the picture: naming both would put two `capsule-shell` nodes in one capture,
    // which makes the browser skip the transition outright
    expect(img().style.getPropertyValue("view-transition-name")).toBe("");
    expect(dossierName()).toBeNull();

    vt.run(0);
    expect(dossierName()).toBe("vault");
    expect(art().style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("the CAPSULE path still hands over its `<img>` — only the poster re-targets", () => {
    // The capsule card's crop already IS its capture (no ancestor clip between the picture and what you
    // see), so R26's finding does not apply to it and its morph source is unchanged. Widening the seam
    // to `HTMLElement` is what lets the two layouts differ without a second opener.
    act(() => setThemeSetting("gacha", "fleetLayout", "capsule"));
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
    const card = container.querySelectorAll<HTMLElement>(".gc-card")[0];
    act(() => void fireEvent.click(card));
    expect(vt.start).toHaveBeenCalledTimes(1);
    expect(card.querySelector("img")!.style.getPropertyValue("view-transition-name")).toBe(
      "capsule-shell",
    );
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
    act(() => void fireEvent.click(slices(container)[0])); // online: one tap opens
    expect(vt.start).not.toHaveBeenCalled(); // no transition was ever started
    expect(dossierName()).toBe("solo");
  });

  it("the OPENING tap does not dismiss the dossier it just opened (the `.gc-host-hit` exemption)", () => {
    // Re-verified ON THE MORPH PATH (it is the shipped one now): the opening click is the same click the
    // document listener sees, and the transition only changes WHEN the sheet commits — so the exemption
    // has to hold with the callback landing a tick later, not just on the plain open. Since the
    // amendment this is the FIRST tap, which makes it strictly harder: there is no earlier tap to have
    // settled anything.
    const vt = deferVT();
    const { container } = render(<GachaFleet active />);
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
    // … and the gesture did NOT also act. Since the tap policy amendment this is sharper than it was: an
    // unsuppressed tap on a LIVE machine now OPENS ITS DOSSIER rather than merely re-selecting, so the
    // cost of the leak went up and this is what it would look like.
    expect(dossierName()).toBeNull();
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
    expect(dossierName()).toBeNull(); // it skipped; it did not open the live machine it landed on
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

  it("declares the ring as the PROTOTYPE's own literals, once, at the base scope", () => {
    // OWNER RULING (second dev-unit walk): "make it just like the prototype exactly". These are the
    // finalists lab's five `--rar-*` values verbatim, in the lab's CARD order (its ROSTER runs
    // pegasus/atlas/rook/lyra and `hueOf` maps each by star count 5/4/2/3 → gold, purple, green, cyan),
    // so the owner's four machines reproduce the walked screen. They supersede the accent-derived OKLCH
    // ring; a colour-theory pass on harmonizing them with the accent is banked for later.
    const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");
    const RING = ["#ffd464", "#b07cff", "#5fe0a0", "#4dd7ff", "#cdd2e0"];
    RING.forEach((hex, i) =>
      expect(tokens, `--gc-unit-${i + 1} must be the lab's ${hex}`).toMatch(
        new RegExp(`--gc-unit-${i + 1}: ${hex};`),
      ),
    );
    // exactly once each — a duplicate in the same scope lets a later one win silently (the LOW-6 lesson)
    for (let k = 1; k <= RING.length; k++)
      expect(tokens.split(`--gc-unit-${k}:`).length - 1, `--gc-unit-${k} declared twice`).toBe(1);
    expect(tokens.split("--gc-unit-off:").length - 1).toBe(1);
    // FIVE stops, not more: the lab defines five per-unit colours and inventing a sixth is the banked
    // colour work, so a sixth token appearing means someone did it anyway
    expect(tokens, "the ring has exactly five stops").not.toContain("--gc-unit-6");
    // PALETTE-INDEPENDENT theme identity (the `--gc-star-hi` precedent): no accent block may restate one,
    // and nothing derives them from the accent any more
    const accentBlocks = tokens.slice(tokens.indexOf('body[data-accent="arcade"]'));
    expect(accentBlocks, "an accent block must not restate a unit hue").not.toContain("--gc-unit-");
    expect(tokens, "the accent-derived ring is gone").not.toMatch(/--gc-unit-\d: oklch\(from/);
    // and the rarity ladder stays gone
    expect(tokens, "the rarity->hue ladder has no consumer left").not.toContain("--gc-rar-");
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
    //
    // ⚠ CONSCIOUSLY RE-CONFIRMED AT E2, NOT LOOSENED. The cover is a fixed magazine page and does need a
    // black field and a re-scaled banner — a SIGNED structural exception (§12.6 E2). It does NOT take it
    // through this stamp: the field is painted on `.cv-frame`, the strip is scoped to `.cv-strap`, and
    // both are markup only the cover renders, so this enumeration is EXACTLY the poster's and the
    // capsule↔poster identity invariant is untouched. The exception has its own enumerated list in
    // `gachaCover.test.tsx` ("THE SIGNED STRUCTURAL EXCEPTION"), and the last arm here is what stops it
    // migrating onto the stamp — where it would escape both enumerations at once.
    //
    // IT READS THE STYLESHEET AS RULES, NOT AS LINES (Codex E2 MED-4). The first form of this test matched
    // single-line headers at one indent, which an ordinary multi-line selector list walks straight past —
    // a false NEGATIVE in a guard whose whole job is to fail. `selectorsMentioning` collects complete
    // headers across newlines and splits the list, so each offending selector is judged on its own.
    const scoped = selectorsMentioning(css, "[data-gc-fleet");
    expect(scoped.length, "the stamp must still have consumers").toBeGreaterThan(0);
    for (const { selector, rule } of scoped) {
      expect(rule.declarations, `${selector} must not paint a background`).not.toMatch(
        /(^|[\s;])background/,
      );
      // …and nothing may reach the shell or the tab box either, whatever it declares
      expect(selector, `${selector} must not target the shell or the tab`).not.toMatch(
        /\.kit-main|\.kit\b|#tab-|\.tab\b/,
      );
    }
    // every consumer the stamp has is still POSTER's — the seam compaction and nothing else
    expect(
      scoped.map(({ selector }) => selector).filter((s) => !s.includes('data-gc-fleet="poster"')),
      "a new layout-scoped rule appeared — enumerate it deliberately, do not let it in here",
    ).toEqual([]);
  });

  it("…and CATCHES the escapes a naive scan lets through (the adversarial fixtures)", () => {
    // Codex's own counter-examples, run through the same reader this suite uses. They have to be CAUGHT,
    // or the guard above is decorative — and each failure mode was invisible from the outside: the rule
    // was simply never seen. Kept as fixtures rather than as comments for exactly that reason.
    const caught = (css: string) => selectorsMentioning(css, "[data-gc-fleet");

    // (a) the ordinary MULTI-LINE list — the escape the line-anchored form was blind to
    const multiline = `
    body[data-gc-fleet="cover"] .gc-banner,
    .some-other-selector {
      background: red;
    }`;
    expect(caught(multiline).map((c) => c.selector)).toEqual([
      'body[data-gc-fleet="cover"] .gc-banner',
    ]);
    expect(caught(multiline)[0].rule.declarations).toMatch(/(^|[\s;])background/);

    // (b) a QUOTED BRACE inside an attribute selector — brace counting ends the header early and the
    //     rule vanishes from the enumeration entirely
    const quotedBrace = `body[data-gc-fleet="cover"][data-probe="}"] .gc-banner { background: red; }`;
    expect(caught(quotedBrace).map((c) => c.selector)).toEqual([
      'body[data-gc-fleet="cover"][data-probe="}"] .gc-banner',
    ]);
    expect(caught(quotedBrace)[0].rule.declarations).toMatch(/(^|[\s;])background/);

    // (c) a nested comma inside `:is()` — splitting every comma tears the selector in half and the
    //     `.kit-main` half walks out of the list unexamined
    const isList = `body[data-gc-fleet="poster"] :is(.x, .kit-main) { color: red; }`;
    const isCaught = caught(isList);
    expect(isCaught).toHaveLength(1);
    expect(isCaught[0].selector, "the :is() list must survive whole").toContain(".kit-main");
    expect(isCaught[0].selector).toMatch(/\.kit-main|\.kit\b|#tab-|\.tab\b/); // the guard would reject it

    // (d) a quoted brace in a DECLARATION — it truncated the body before the property that matters
    const quotedDecl = `body[data-gc-fleet="poster"] .x { content: "}"; background: red; }`;
    expect(caught(quotedDecl)[0].rule.declarations).toMatch(/(^|[\s;])background/);
  });

  it("compacts the banner->head->stack seam, POSTER-ONLY and vertical-only", () => {
    // The head is the CAPSULE TRACK'S OWN markup — both layouts render it byte-identically — so every
    // number here is an override under the layout stamp, never an edit to the shipped rule. Capsule's
    // `22px 14px 10px` is asserted untouched, and nothing HORIZONTAL moves in either.
    expect(blockFor(".gc-track-head")).toContain("padding: 22px 14px 10px");
    const head = blockFor('body[data-gc-fleet="poster"] .gc-track-head')!;
    expect(head).toContain("padding-top: var(--po-head-pad-top)");
    expect(head).toContain("padding-bottom: 0");
    expect(blockFor('body[data-gc-fleet="poster"] .po-poster')).toContain("--po-stack-gap: 11px");
    expect(head).not.toMatch(/padding-(left|right)|padding: /);
  });

  it("draws the keyline UNCONDITIONALLY — it is anatomy, not an axis (owner ruling)", () => {
    // §12.6 ruling 8 bound the rim to the `outlines` axis; the owner overruled that on the third walk
    // ("I want it back, it looks better"). The rim is not a border: it is the PLATE's background showing
    // through a 1px inset on the art, so the inset IS the keyline and there is exactly one number.
    expect(blockFor(".po-art")).toContain("inset: 1px");
    expect(blockFor(".po-plate")).toContain("background: var(--po-hue)");
    // and nothing in the poster reads the axis any more — `outlines` is chat chrome again
    expect(css, "the poster must not consume the outlines axis").not.toMatch(
      /body\[data-outlines[^{]*\.po-/,
    );
  });

  it("drops the head INTO the shear's void, and raises the counter out of the way", () => {
    // Owner, fourth walk: `04 / 04` was clipping under the first card's right edge, and with that fixed
    // he wants LESS space between the head and the first card. Both halves live here because they are one
    // decision — the counter WAS the thing capping the overlap.
    const head = blockFor('body[data-gc-fleet="poster"] .gc-track-head')!;
    const body = blockFor('body[data-gc-fleet="poster"] .po-body')!;
    const count = blockFor('body[data-gc-fleet="poster"] .gc-track-head .count')!;

    // the counter leaves the head's BOTTOM-right (where the sheared slice rises highest) for its top
    expect(count).toContain("align-self: flex-start");
    // …and takes its own taps back: the head is pointer-events:none so the h1 cannot swallow slice taps,
    // but at wide columns the SELECTED slice's grow extends its hit-clip under the counter (measured at
    // 1200: both lower corners hit-tested into the slice), and a read-only counter must not open a dossier
    expect(count).toContain("pointer-events: auto");

    // the whole composition rides up toward the banner, and the stack deepens into the void
    expect(head).toContain("--po-head-pad-top: 8px"); // 11 -> 6 (ride up), 6 -> 8 (walked back)
    expect(body).toContain("--po-head-overlap: 36px"); // 40 -> 36: the cards sit further below
    expect(body).toContain("margin-top: calc(var(--po-head-overlap) * -1)");

    // ⚠ THE HEAD MUST CLEAR THE PICKED SLICE'S OWN z-index, not merely a static box. `.po-slice.picked`
    // raises itself to 3, and `.po-body` is `position: relative; z-index: auto`, which opens NO stacking
    // context — so that 3 competes directly with the head. At z-index 1 the selected slice painted over
    // the heading; this is the regression that caught it.
    expect(head).toContain("z-index: 5");
    expect(blockFor(".po-slice.picked")).toContain("z-index: 3");
    expect(head).toContain("pointer-events: none");
  });

  it("re-derives the overlap cap against the h1, at the NARROWEST column", () => {
    // With the counter lifted, the governing term is the h1's own bottom-right corner: the `em` caption is
    // the widest thing in the heading, so its right edge reaches deepest into the shear. The h1's width is
    // shrink-to-fit and therefore constant, but the void beneath it scales with `--run` — so the narrowest
    // supported column binds, and the cap is recomputed here rather than restated.
    const tan10 = Math.tan((10 * Math.PI) / 180);
    const h1RightLocal = 109.6 - 35; // measured on the live app; constant across widths
    const stackGap = 11;
    const capAt = (col: number) => {
      const w = col - 60; // --lead + --trail
      return stackGap + tan10 * w * (1 - h1RightLocal / w);
    };
    expect(capAt(320)).toBeLessThan(capAt(390)); // the narrow column is the binding one
    expect(capAt(320)).toBeGreaterThan(36); // …and the shipped 36 fits under it
    expect(capAt(320)).toBeLessThan(44); // …but not by much, which is what makes 320 the binding column
    // the raised counter is no longer a term at all: its own clearance is width-independent
    const counterClear = 47 + stackGap - 15 - 36 + tan10 * (14 + 40.2 - 25);
    expect(counterClear).toBeGreaterThan(5);
  });

  it("keeps the stack off-centre RIGHT with the trailing inset the grow actually needs", () => {
    // Owner, third walk: the selected card's edge "gets too close to the actual right edge". `.picked`
    // scales 1.05 about its own centre and nudges 4px, and its DROP rides 5px further out again — at
    // 40/20 the drop landed 2.5px from the viewport edge at the 390 column. 35/25 keeps the WIDTH
    // (the pair still sums to 60, so `--run` and every derived number are untouched) and moves the stack
    // 5px left, putting the freed air on the side that needed it: 7.5px of clearance.
    const body = blockFor(".po-body")!;
    expect(body).toContain("--lead: 35px");
    expect(body).toContain("--trail: 25px");
    const lead = 35,
      trail = 25,
      col = 390,
      drop = 5,
      grow = 1.05,
      nudge = 4;
    const w = col - lead - trail;
    const dropRight = lead + w / 2 + (w + drop - w / 2) * grow + nudge;
    expect(col - dropRight, "the picked slice's drop must clear the viewport edge").toBeGreaterThan(
      5,
    );
  });

  it("draws the focus ring INSIDE the polygon (a clip-path erases the UA ring — R18)", () => {
    expect(blockFor(".po-slice:focus-visible")).toContain("outline: none");
    const ring = blockFor(".po-slice:focus-visible::after")!;
    expect(ring).toContain("clip-path: var(--poly)");
    expect(ring).toContain("var(--accent)"); // the kit's own ring token, not a poster literal
  });

  it("keeps the chip on the THEME's own status grammar, not a bespoke one", () => {
    // The lab's pixel chip was tried and CUT (owner, fourth walk: "the new chip doesn't really look that
    // good, let's not use it in this fleet"), so the chip is back on the tokens every other gacha surface
    // reads — the capsule card's ONLINE ribbon, its sleeping pill, and the accent for a request in
    // flight. Nothing here is poster-private, which is the point: one theme, one status grammar.
    const chip = blockFor(".po-chip")!;
    expect(chip).toContain("background: var(--gc-online-fill)");
    expect(chip).toContain("color: var(--gc-online-ink)");
    expect(blockFor(".po-slice.asleep .po-chip")).toContain("background: var(--gc-pill-bg)");
    expect(blockFor(".po-slice.busy .po-chip")).toContain("background: var(--accent-fill)");
    // …and the pixel face left with it, tokens and all — no dead assets, no orphan tokens
    expect(chip, "the cut face must not linger").not.toContain("Silkscreen");
    const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");
    expect(tokens, "the chip's bespoke tokens have no consumer left").not.toContain("--gc-po-chip");
  });

  it("seats the CORNER TAG clear of the shear, in the unit's own hue", () => {
    // The lab's `.po-jp` seat verbatim. It reads `--po-hue`, so it greys with the slice when the machine
    // sleeps for free — unlike status, decoration IS allowed to ride on colour alone.
    const tag = blockFor(".po-jp")!;
    expect(tag).toContain("writing-mode: vertical-rl");
    expect(tag).toContain("right: 9px");
    expect(tag).toContain("top: 9px");
    expect(tag).toContain("color: var(--po-hue)");
    // the SANS, not `--font-display` — that token is Shippori Mincho in this theme, and the lab's tag is
    // Zen Kaku, which is what `--font-body` resolves to
    expect(tag).toContain("font-family: var(--font-body)");
    // checked on the DECLARATION, not the block — the comment above it names the token it rejects
    expect(tag).not.toMatch(/font-family:[^;]*--font-display/);
    // the seat clears the diagonal: a ~13px glyph at right:9px puts its far corner ~22px in, where the
    // plate's top boundary has descended tan(10deg)*22 = 3.9px — under the 9px top inset
    expect(Math.tan((10 * Math.PI) / 180) * 22).toBeLessThan(9);
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
