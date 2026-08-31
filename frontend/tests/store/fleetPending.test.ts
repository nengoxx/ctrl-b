import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REBOOT_WINDOW_MS,
  SHUTDOWN_WINDOW_MS,
  WAKE_WINDOW_MS,
  beginPending,
  clearPending,
  overlayPending,
  pendingSnapshot,
  reconcilePending,
} from "../../src/store/fleetPending";
import type { Host } from "../../src/types";

// store/fleetPending — the app-wide "a power action was dispatched and the polls have not caught up
// yet" grace record (2026-08-30; the Home Assistant assumed-state pattern, core#86735). Three rules
// live here and nowhere else, so they are pinned here: the per-kind expiry WINDOW, the ownership TOKEN
// that keeps a stale dispatcher from clearing a newer action's record, and the AGREEMENT rules that end
// a record early when the polls confirm what the user did.
//
// Fake timers throughout (the `store/fleet.test.ts` idiom): the windows are minutes long and the store
// arms real `setTimeout`s. Every case resets the module state through `reconcilePending([])` — the
// sanctioned reset, since an empty fleet means every entry's host is gone.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  reconcilePending([]);
  vi.useRealTimers();
});

/** A host at a stated liveness — only `id` and `status.online` matter to this store. */
const host = (id: string, online: boolean | null): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status:
    online === null
      ? null
      : {
          host_id: id,
          online,
          ping_ms: online ? 18 : null,
          last_seen: null,
          checked_at: "2026-01-01T00:00:00Z",
          error: null,
        },
});

const kindOf = (id: string) => pendingSnapshot().get(id)?.kind;

describe("beginPending — the record, and its per-kind window", () => {
  it("records the dispatched action and expires it at the WAKE window", () => {
    beginPending("atlas", "wake");
    expect(kindOf("atlas")).toBe("wake");

    // one tick short of the ceiling the record still stands — the window is the FAILURE bound, not a
    // guess at how long a boot takes
    vi.advanceTimersByTime(WAKE_WINDOW_MS - 1);
    expect(kindOf("atlas")).toBe("wake");
    vi.advanceTimersByTime(1);
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("expires a SHUTDOWN at its own, shorter window", () => {
    // The two directions are sized apart on purpose (an SSH shutdown is accepted in seconds; a WOL boot
    // takes a minute), so a shutdown must NOT inherit the wake ceiling.
    beginPending("atlas", "shutdown");
    vi.advanceTimersByTime(SHUTDOWN_WINDOW_MS - 1);
    expect(kindOf("atlas")).toBe("shutdown");
    vi.advanceTimersByTime(1);
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("expires a REBOOT at the five-minute window — the longest of the three", () => {
    // Reboot is the only kind that has to bound BOTH transitions plus the OS's own restart, so it
    // inherits neither neighbour's ceiling (owner-ruled 2026-08-31).
    expect(REBOOT_WINDOW_MS).toBe(300_000);
    beginPending("atlas", "reboot");
    vi.advanceTimersByTime(REBOOT_WINDOW_MS - 1);
    expect(kindOf("atlas")).toBe("reboot");
    vi.advanceTimersByTime(1);
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("keeps one record PER HOST — a second machine's dispatch leaves the first alone", () => {
    beginPending("atlas", "wake");
    beginPending("relay", "shutdown");
    expect(kindOf("atlas")).toBe("wake");
    expect(kindOf("relay")).toBe("shutdown");
    // …and each leaves on its own clock
    vi.advanceTimersByTime(SHUTDOWN_WINDOW_MS);
    expect(kindOf("atlas")).toBe("wake");
    expect(pendingSnapshot().has("relay")).toBe(false);
  });
});

describe("last action wins, and the ownership token", () => {
  it("replaces the kind AND disarms the superseded timer", () => {
    const wakeToken = beginPending("atlas", "wake");
    vi.advanceTimersByTime(10_000);
    beginPending("atlas", "shutdown"); // the owner changed their mind
    expect(kindOf("atlas")).toBe("shutdown");

    // the SHUTDOWN window governs now — and the wake's own 180 s timer, if it were still armed, would
    // land inside the successor's life and kill it
    vi.advanceTimersByTime(SHUTDOWN_WINDOW_MS - 1);
    expect(kindOf("atlas")).toBe("shutdown");
    vi.advanceTimersByTime(1);
    expect(pendingSnapshot().has("atlas")).toBe(false);
    expect(wakeToken).toBeTypeOf("number");
  });

  it("a SUPERSEDED dispatcher's clear is a no-op — it does not kill the newer record", () => {
    // The overlap race sol MED-2 named: two `useFleet` instances dispatch, and the FIRST one's request
    // fails after the second has already begun. Its failure handler must clear its own record and
    // nothing else.
    const stale = beginPending("atlas", "wake");
    beginPending("atlas", "shutdown");
    clearPending("atlas", stale);
    expect(kindOf("atlas")).toBe("shutdown");
  });

  it("…and a superseded timer cannot kill its successor either", () => {
    beginPending("atlas", "wake");
    vi.advanceTimersByTime(WAKE_WINDOW_MS - 1_000);
    beginPending("atlas", "shutdown"); // 1 s before the wake's timer would have fired
    vi.advanceTimersByTime(2_000); // past that moment
    expect(kindOf("atlas")).toBe("shutdown");
  });

  it("the OWNING token clears, and an unknown host is a safe no-op", () => {
    const token = beginPending("atlas", "wake");
    clearPending("atlas", token);
    expect(pendingSnapshot().has("atlas")).toBe(false);
    expect(() => clearPending("ghost", token)).not.toThrow();
  });

  it("WITHOUT a token the clear is unconditional — the reconciliation form", () => {
    // Reconciliation acts on observed truth rather than on a dispatch it owns, so it must be able to
    // clear a record it never began.
    beginPending("atlas", "wake");
    clearPending("atlas");
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });
});

describe("reconcilePending — the polls agree, or the host is gone", () => {
  it("clears a pending WAKE when the machine is observed ONLINE, and holds it while it is not", () => {
    beginPending("atlas", "wake");
    reconcilePending([host("atlas", false)]); // still booting — the poll says nothing new
    expect(kindOf("atlas")).toBe("wake");
    reconcilePending([host("atlas", true)]); // agreement: it came up
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("clears a pending SHUTDOWN when the machine is observed OFFLINE, and holds it while it is not", () => {
    beginPending("atlas", "shutdown");
    reconcilePending([host("atlas", true)]); // still pingable — exactly the window's reason to exist
    expect(kindOf("atlas")).toBe("shutdown");
    reconcilePending([host("atlas", false)]);
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("treats a MISSING status as offline — a host that has never been polled is not up", () => {
    beginPending("atlas", "wake");
    reconcilePending([host("atlas", null)]);
    expect(kindOf("atlas")).toBe("wake"); // no agreement: the wake wanted ONLINE
    beginPending("relay", "shutdown");
    reconcilePending([host("relay", null)]);
    expect(pendingSnapshot().has("relay")).toBe(false); // …and the shutdown wanted offline, so it agrees
  });

  it("a host that LEFT the fleet takes its record with it, whichever way it was going", () => {
    beginPending("atlas", "wake");
    beginPending("relay", "shutdown");
    reconcilePending([host("vault", true)]); // the config no longer lists either
    expect(pendingSnapshot().size).toBe(0);
  });

  it("clearing on agreement also DISARMS the timer (no stale expiry on a later record)", () => {
    beginPending("atlas", "wake");
    reconcilePending([host("atlas", true)]);
    beginPending("atlas", "wake"); // a second wake, well inside the first window
    vi.advanceTimersByTime(WAKE_WINDOW_MS - 1);
    expect(kindOf("atlas")).toBe("wake"); // the FIRST record's timer must not have fired into this one
  });

  it("emits only on a real deletion — the snapshot keeps its identity otherwise", () => {
    // Six live `useFleet` instances call this with every hosts answer. A new map per call would be a
    // fresh `useSyncExternalStore` snapshot each time — a re-render storm on the poll cadence — so
    // "nothing changed" has to mean "the same reference".
    expect(pendingSnapshot()).toBe(pendingSnapshot());
    beginPending("atlas", "wake");
    const armed = pendingSnapshot();
    reconcilePending([host("atlas", false)]); // no agreement
    expect(pendingSnapshot()).toBe(armed);
    reconcilePending([host("atlas", false)]); // …and again, still nothing
    expect(pendingSnapshot()).toBe(armed);

    reconcilePending([host("atlas", true)]); // agreement — now it must publish
    expect(pendingSnapshot()).not.toBe(armed);
    expect(armed.has("atlas")).toBe(true); // the old snapshot is untouched, not mutated under the reader
  });

  it("is a cheap no-op with nothing pending", () => {
    const empty = pendingSnapshot();
    reconcilePending([host("atlas", true), host("relay", false)]);
    expect(pendingSnapshot()).toBe(empty);
  });
});

// ── REBOOT, the two-phase kind (2026-08-31) ─────────────────────────────────────────────────────────
// The machine is ONLINE at dispatch, so "observed online" is the state a reboot STARTS in and can never
// be its agreement — which is the whole reason it needs a phase marker at all. Agreement is a SEQUENCE:
// observed down, and only then observed up again.
describe("reconcilePending — a REBOOT agrees on down, THEN up", () => {
  it("does not clear while the machine is still up — the restart has not reached the network yet", () => {
    beginPending("atlas", "reboot");
    reconcilePending([host("atlas", true)]);
    expect(kindOf("atlas")).toBe("reboot");
    expect(pendingSnapshot().get("atlas")?.sawDown).toBeUndefined();
  });

  it("records the DOWN observation on the entry rather than ending it", () => {
    beginPending("atlas", "reboot");
    reconcilePending([host("atlas", false)]);
    expect(kindOf("atlas")).toBe("reboot"); // half the transition — the record still stands
    expect(pendingSnapshot().get("atlas")?.sawDown).toBe(true);
  });

  it("clears when it comes back UP, and only after the down", () => {
    beginPending("atlas", "reboot");
    reconcilePending([host("atlas", true)]); // an online poll BEFORE the down is not agreement…
    expect(kindOf("atlas")).toBe("reboot");
    reconcilePending([host("atlas", false)]);
    reconcilePending([host("atlas", true)]); // …the identical poll after it is
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("expires at its OWN ceiling when the machine never comes back", () => {
    beginPending("atlas", "reboot");
    reconcilePending([host("atlas", false)]); // it went down…
    vi.advanceTimersByTime(REBOOT_WINDOW_MS - 1);
    expect(kindOf("atlas")).toBe("reboot"); // …and stayed down; the assumption still stands
    vi.advanceTimersByTime(1);
    expect(pendingSnapshot().has("atlas")).toBe(false); // it cannot lie forever
  });

  it("a host that LEFT the fleet takes its reboot with it, phase or no phase", () => {
    beginPending("atlas", "reboot");
    reconcilePending([host("atlas", false)]); // the down is recorded…
    reconcilePending([host("vault", true)]); // …and then the config stops listing the machine
    expect(pendingSnapshot().size).toBe(0);
  });

  it("emits only on a real write — the phase change publishes ONCE, and copies", () => {
    beginPending("atlas", "reboot");
    const armed = pendingSnapshot();
    reconcilePending([host("atlas", true)]);
    expect(pendingSnapshot()).toBe(armed); // still up: nothing to write
    reconcilePending([host("atlas", false)]);
    const down = pendingSnapshot();
    expect(down).not.toBe(armed); // the phase IS a write, so it must publish
    expect(armed.get("atlas")?.sawDown).toBeUndefined(); // …copy-on-write, not a mutation under the reader
    reconcilePending([host("atlas", false)]);
    expect(pendingSnapshot()).toBe(down); // …and repeating the same observation is not a write
  });

  it("last action wins DROPS the phase — a newer wake starts from nothing", () => {
    // The token rules are the kind's business only in that a replacement is a whole new entry: a
    // `sawDown` carried over would let the wake agree on the reboot's half-finished progress.
    beginPending("atlas", "reboot");
    reconcilePending([host("atlas", false)]);
    expect(pendingSnapshot().get("atlas")?.sawDown).toBe(true);
    beginPending("atlas", "wake"); // it never came back, so the owner wakes it instead
    expect(kindOf("atlas")).toBe("wake");
    expect(pendingSnapshot().get("atlas")?.sawDown).toBeUndefined();
    reconcilePending([host("atlas", true)]); // …and a wake agrees on ONE observation, as it always did
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("a SUPERSEDED dispatcher's clear still no-ops against a reboot", () => {
    const stale = beginPending("atlas", "wake");
    beginPending("atlas", "reboot");
    clearPending("atlas", stale);
    expect(kindOf("atlas")).toBe("reboot");
  });
});

describe("overlayPending — the assumed-state presentation", () => {
  const HOSTS = [host("atlas", true), host("relay", true), host("vault", false)];

  it("presents a pending-SHUTDOWN host as offline, and touches nothing else", () => {
    beginPending("atlas", "shutdown");
    const out = overlayPending(HOSTS);
    expect(out[0].status?.online).toBe(false); // the machine the owner just shut down
    expect(out[1]).toBe(HOSTS[1]); // …and every other host is the SAME object
    expect(out[2]).toBe(HOSTS[2]);
    expect(HOSTS[0].status?.online).toBe(true); // the input is never mutated
  });

  it("leaves a pending WAKE alone — that host IS offline, and the chip ranks the poll above it", () => {
    beginPending("vault", "wake");
    expect(overlayPending(HOSTS)).toBe(HOSTS);
  });

  it("returns the INPUT ARRAY when nothing overlays, so memoized consumers keep bailing", () => {
    expect(overlayPending(HOSTS)).toBe(HOSTS); // nothing pending at all
    beginPending("atlas", "shutdown");
    // …and an explicit map is honored, which is how `useFleet` memoizes on the store's own reference
    expect(overlayPending(HOSTS, new Map())).toBe(HOSTS);
    expect(overlayPending(HOSTS)).not.toBe(HOSTS);
  });

  it("does not re-mint a host whose shutdown the poll has already caught up with", () => {
    beginPending("vault", "shutdown"); // vault is ALREADY offline
    expect(overlayPending(HOSTS)).toBe(HOSTS);
  });

  it("presents a pending-REBOOT host as ONLINE — the mirror of the shutdown arm", () => {
    // The COMMANDED end state: a rebooting machine is meant to come back, so the honest offline the
    // poll sees mid-restart must not read as a fleet that lost a member for a minute.
    beginPending("vault", "reboot"); // vault is the offline one
    const out = overlayPending(HOSTS);
    expect(out[2].status?.online).toBe(true);
    expect(out[0]).toBe(HOSTS[0]); // …and every other host is the SAME object
    expect(out[1]).toBe(HOSTS[1]);
    expect(HOSTS[2].status?.online).toBe(false); // the input is never mutated…
    expect(out[2]).not.toBe(HOSTS[2]); // …the overlaid host is a copy, status object included
  });

  it("does not re-mint a rebooting host the poll already agrees with", () => {
    beginPending("atlas", "reboot"); // atlas has not gone down yet — nothing to overlay
    expect(overlayPending(HOSTS)).toBe(HOSTS);
  });

  it("leaves a host with NO status alone — it presents a poll, it never invents one", () => {
    const unpolled = [host("ghost", null)];
    beginPending("ghost", "reboot");
    expect(overlayPending(unpolled)).toBe(unpolled);
    expect(unpolled[0].status).toBeNull();
  });
});
