import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// THE PENDING LABEL RULE (W6/D72) — the label of WHICHEVER control a pending host renders carries
// `livenessWord(online, pending)`.
//
// It is a RULE, not a site list, so it is pinned once across every surface a pending host renders a
// control on: the kit's own device row, cosmos's and frontier's host sheets, vapor's row — and gacha's
// unit dossier, whose CARDS and TRACK always spoke the word while the action bar inside the sheet did
// not (the review round's own finding; the rest of gacha's sentences stay pinned in its own suites).
// D67 stretched the DISABLED window from ~100 ms to
// 90/180/300 s, so a control that only greys is a control with no reason for three minutes — and the arm
// can INVERT inside that window: a pending shutdown is presented OFFLINE, which puts the WAKE control on
// screen while a shutdown runs. That inversion is the case each surface below is made to answer.
//
// The media hook is mocked to the fresh-install state rather than wrapped in a QueryClientProvider (the
// `kitArtSurfaces` precedent), and `useFleet` is mocked for the kit surface because the rule is about what
// the row RENDERS, not about how the controller polls.

const fleet = vi.hoisted((): { view: Record<string, unknown> } => ({ view: {} }));
vi.mock("../../src/hooks/useFleet", () => ({
  useFleet: () => fleet.view,
  useServerInfo: () => ({ data: { poll_seconds: 5 } }),
  useHosts: () => ({ data: [], isError: false }),
}));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

import type { PendingKind } from "../../src/store/fleetPending";
import { KitFleet } from "../../src/theme-engine/kit/Fleet";
import { CosmosHostDetail } from "../../src/themes/cosmos/CosmosHostDetail";
import { FrontierHostDetail } from "../../src/themes/frontier/FrontierHostDetail";
import { GachaCard } from "../../src/themes/gacha/GachaCard";
import { GachaHostDetail } from "../../src/themes/gacha/GachaHostDetail";
import { DeviceRow } from "../../src/themes/vapor/DeviceRow";
import type { Host } from "../../src/types";

afterEach(cleanup);

/** A host at a stated PRESENTED liveness — `overlayPending` has already run by the time a view sees it,
 *  which is exactly why a pending-shutdown host arrives here as offline. */
const host = (online: boolean): Host => ({
  id: "alpha",
  name: "alpha",
  ip: "10.0.0.7",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "alpha",
    online,
    ping_ms: online ? 9 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
});

const run = async () => true;
const noop = () => {};

/** The kit fleet with one host at `online`, carrying `pending` — the controller's own shape. */
function kit(online: boolean, pending?: PendingKind) {
  const h = host(online);
  fleet.view = {
    hosts: [h],
    svcByHost: new Map(),
    open: new Set<string>(),
    isLoading: false,
    error: null,
    busy: new Set(pending ? [h.id] : []),
    pending: new Map(pending ? [[h.id, { kind: pending }]] : []),
    run,
    toggleRow: noop,
  };
  return render(<KitFleet active />);
}

/** Every action button's accessible name on the rendered surface, in DOM order. */
const names = (c: HTMLElement): string[] =>
  [...c.querySelectorAll<HTMLElement>("button[aria-label]")].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );

describe("the kit device row — the state word rides the control that renders", () => {
  it("a settled machine names its own liveness, either arm", () => {
    expect(names(kit(true).container)).toContain("shut down alpha, online");
    cleanup();
    expect(names(kit(false).container)).toContain("wake alpha, sleeping");
  });

  it("a pending WAKE: the wake control says waking, not a bare wake promise", () => {
    const { container } = kit(false, "wake");
    expect(names(container)).toContain("wake alpha, waking");
    expect(container.querySelector<HTMLButtonElement>("button.act.wake")?.disabled).toBe(true);
  });

  it("a pending REBOOT: the machine is presented ONLINE, so the stop control says rebooting", () => {
    const { container } = kit(true, "reboot");
    expect(names(container)).toContain("shut down alpha, rebooting");
  });

  it("a pending SHUTDOWN inverts the arm — the WAKE button says shutting down", () => {
    // The M4 case: `overlayPending` presents the machine offline the moment the shutdown is dispatched,
    // so the control on screen for the next 90 s is the one that wakes it. Its name must not read as an
    // offer to wake a machine that is going down.
    const { container } = kit(false, "shutdown");
    const label = names(container).find((n) => n.startsWith("wake "));
    expect(label).toBe("wake alpha, shutting down");
    expect(container.querySelector<HTMLButtonElement>("button.act.wake")?.disabled).toBe(true);
  });

  it("VISIBLE (owner ruling on D72's open question): the subtitle speaks the transition word", () => {
    // The sighted half of the same rule — a disabled button for 90/180/300 s with no visible reason.
    // The word rides the sub's liveness slot only while the grace window runs…
    expect(kit(false, "shutdown").container.querySelector(".role")?.textContent).toContain(
      "shutting down…",
    );
    cleanup();
    expect(kit(false, "wake").container.querySelector(".role")?.textContent).toContain("waking…");
    cleanup();
    expect(kit(true, "reboot").container.querySelector(".role")?.textContent).toContain(
      "rebooting…",
    );
    cleanup();
    // …and the steady copy is byte-identical when no record exists (the pre-ruling look).
    expect(kit(false).container.querySelector(".role")?.textContent).toBe(
      "workstation · linux · dormant",
    );
    cleanup();
    expect(kit(true).container.querySelector(".role")?.textContent).toBe("workstation · linux");
  });
});

describe("cosmos's host sheet — the same rule on a bespoke action bar", () => {
  const sheet = (online: boolean, pending?: PendingKind) =>
    render(
      <CosmosHostDetail
        host={host(online)}
        services={[]}
        busy={pending !== undefined}
        pending={pending}
        run={run}
        titleId="t"
      />,
    );

  it("names the state on both settled arms", () => {
    expect(names(sheet(true).container)).toContain("Shut down, online");
    cleanup();
    expect(names(sheet(false).container)).toContain("Wake, sleeping");
  });

  it("a pending SHUTDOWN: the Wake pill says shutting down", () => {
    expect(names(sheet(false, "shutdown").container)).toContain("Wake, shutting down");
  });

  it("a pending REBOOT: the online pair both say rebooting", () => {
    const { container } = sheet(true, "reboot");
    expect(names(container)).toEqual(
      expect.arrayContaining(["Reboot, rebooting", "Shut down, rebooting"]),
    );
  });

  it("a pending WAKE: the Wake pill says waking", () => {
    expect(names(sheet(false, "wake").container)).toContain("Wake, waking");
  });

  it("PING carries the word too — the bar's third pill greys for the same reason", () => {
    // It is dimmed by the same `busy` for the same 90 s, so a bar where two pills explain themselves
    // and the third simply greys answers the question inconsistently.
    expect(names(sheet(false, "shutdown").container)).toContain("Ping, shutting down");
  });

  it("VISIBLE: the status pill speaks the transition word, then returns to its steady copy", () => {
    expect(sheet(false, "shutdown").container.querySelector(".hd-status .t")?.textContent).toBe(
      "shutting down… · workstation",
    );
    cleanup();
    expect(sheet(false).container.querySelector(".hd-status .t")?.textContent).toBe(
      "asleep · workstation",
    );
  });
});

describe("frontier's rig sheet — the same rule, frontier's own phrases", () => {
  const sheet = (online: boolean, pending?: PendingKind) =>
    render(
      <FrontierHostDetail
        host={host(online)}
        services={[]}
        plate="0xALP01"
        busy={pending !== undefined}
        pending={pending}
        run={run}
        titleId="t"
      />,
    );

  it("keeps each pill's own phrase and appends the state", () => {
    expect(names(sheet(false).container)).toContain("Wake rig, sleeping");
    cleanup();
    expect(names(sheet(true).container)).toEqual(
      expect.arrayContaining(["Reboot, online", "Shut down, online"]),
    );
  });

  it("a pending SHUTDOWN: the Wake rig pill says shutting down", () => {
    expect(names(sheet(false, "shutdown").container)).toContain("Wake rig, shutting down");
  });

  it("a pending REBOOT reads on the online arm", () => {
    expect(names(sheet(true, "reboot").container)).toContain("Reboot, rebooting");
  });

  it("VISIBLE: the banner chip sentence-cases the word, then returns to Online/Dormant", () => {
    expect(sheet(false, "shutdown").container.querySelector(".stat")?.textContent).toBe(
      "Shutting down…",
    );
    cleanup();
    expect(sheet(false).container.querySelector(".stat")?.textContent).toBe("Dormant");
  });
});

describe("vapor's device row — the spinner gains the word it never had", () => {
  const row = (online: boolean, pending?: PendingKind) =>
    render(
      <DeviceRow
        host={host(online)}
        services={[]}
        index={0}
        featured={false}
        open
        busy={pending !== undefined}
        pending={pending}
        onToggle={noop}
        onAction={noop}
      />,
    );

  it("names the state on both settled arms", () => {
    expect(names(row(true).container)).toEqual(
      expect.arrayContaining(["reboot alpha, online", "shutdown alpha, online"]),
    );
    cleanup();
    expect(names(row(false).container)).toContain("wake alpha, sleeping");
  });

  it("a pending SHUTDOWN inverts the arm here too — both wake controls say shutting down", () => {
    // The row header's wake button AND the dropdown's own `wake` button: one rule, every control.
    const { container } = row(false, "shutdown");
    const wakes = names(container).filter((n) => n.startsWith("wake "));
    expect(wakes).toHaveLength(2);
    for (const n of wakes) expect(n).toBe("wake alpha, shutting down");
  });

  it("a pending REBOOT says so on the pair the online arm renders", () => {
    expect(names(row(true, "reboot").container)).toEqual(
      expect.arrayContaining(["reboot alpha, rebooting", "shutdown alpha, rebooting"]),
    );
  });

  it("VISIBLE: the sub's liveness slot speaks the word, then returns to its steady copy", () => {
    expect(row(false, "shutdown").container.querySelector(".sub")?.textContent).toBe(
      "linux · shutting down…",
    );
    cleanup();
    expect(row(true, "reboot").container.querySelector(".sub")?.textContent).toBe(
      "linux · rebooting…",
    );
    cleanup();
    expect(row(false).container.querySelector(".sub")?.textContent).toBe("linux · asleep");
  });
});

describe("gacha's unit dossier — the one bar in that theme that stayed silent", () => {
  // gacha's capsule cards and its track have spoken `livenessWord` since D67; the action bar INSIDE the
  // dossier sheet did not, so the theme that invented the word had one surface that never said it.
  const slip = (online: boolean, pending?: PendingKind) =>
    render(
      <GachaHostDetail
        host={host(online)}
        services={[]}
        art={null}
        mode="five"
        busy={pending !== undefined}
        pending={pending}
        run={run}
        titleId="t"
      />,
    );

  it("names the state on both settled arms", () => {
    expect(names(slip(true).container)).toEqual(
      expect.arrayContaining(["Reboot, online", "Shut down, online"]),
    );
    cleanup();
    expect(names(slip(false).container)).toContain("Wake, sleeping");
  });

  it("a pending SHUTDOWN inverts the arm — the Wake ticket says shutting down", () => {
    const label = names(slip(false, "shutdown").container).find((n) => n.startsWith("Wake"));
    expect(label).toBe("Wake, shutting down");
  });

  it("VISIBLE: the dossier subtitle spells the word in gacha caps, then returns to SLEEPING", () => {
    // `dossierSub` now rides `livenessWord` — the card's chip and this line describe a machine
    // identically, SHUTTING DOWN included (the chips' own inversion, closed the same way).
    expect(slip(false, "shutdown").container.textContent).toContain("SHUTTING DOWN");
    cleanup();
    expect(slip(false).container.textContent).toContain("SLEEPING");
  });
});

describe("gacha's capsule chip — the five states, and the transition rung", () => {
  const card = (online: boolean, pending?: PendingKind) =>
    render(
      <GachaCard
        host={host(online)}
        art={null}
        shape="pair"
        mode="five"
        onOpen={noop}
        pending={pending}
      />,
    );

  it("says SHUTTING DOWN — the hand-rolled ladder read a pending shutdown as SLEEPING", () => {
    expect(card(false, "shutdown").container.querySelector(".state")?.textContent).toBe(
      "SHUTTING DOWN",
    );
  });

  it("a TRANSITION chip wears `.pend` — the ribbon rung at every width (gacha.css)", () => {
    // SHUTTING DOWN is ~1.6× SLEEPING's width: on the TOP rung it re-opens the 5★ star collision the
    // 380px media rule closed, so a pending chip takes the rung below for the grace window's duration.
    expect(card(false, "shutdown").container.querySelector(".state.pend")).not.toBeNull();
    cleanup();
    expect(card(false, "wake").container.querySelector(".state.pend")).not.toBeNull();
    cleanup();
    // …and the steady chips keep the top rung: no `.pend`, byte-identical classes to before.
    expect(card(false).container.querySelector(".state.pend")).toBeNull();
    cleanup();
    expect(card(true).container.querySelector(".state.pend")).toBeNull();
  });
});

describe("the disabled control still says what it is for", () => {
  it("a screen reader hearing a held kit button learns the machine, the action AND the state", () => {
    // The whole point of the wave's C-1 finding: `disabled` alone is not a reason, and for up to five
    // minutes it was the only thing the four surfaces said.
    const { container } = kit(false, "wake");
    const btn = container.querySelector<HTMLButtonElement>("button.act.wake")!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-label")).toBe("wake alpha, waking");
  });
});
