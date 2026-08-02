import { describe, expect, it } from "vitest";

import { GACHA_COPY } from "../../src/themes/gacha/copy";
import {
  cardShapes,
  counterText,
  hostsResolved,
  plateSub,
  promoCopy,
  rateText,
} from "../../src/themes/gacha/fleet";
import type { Host } from "../../src/types";

// The gacha Fleet's pure derivations (D52 / GACHA_PLAN §6.1–§6.4). These carry the acceptance-matrix rows
// that are about VALUES rather than markup: the card-geometry rule at every fleet size, the loading
// semantics the rate pill and the counter share (§6.3's "must not read 0.0% while unresolved — that is a
// lie, not a state"), and the plate's role/ping line for a host that declares neither.

const host = (over: Partial<Host> = {}): Host => ({
  id: "pegasus",
  name: "Pegasus",
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "pegasus",
    online: true,
    ping_ms: 18,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
  ...over,
});

describe("cardShapes — the card-geometry rule (Q8.10)", () => {
  it("reproduces the PROTOTYPE at four hosts: feat, a pair, then wide", () => {
    // index.html:10-13 — the four cards the owner signed off on.
    expect(cardShapes(4)).toEqual(["feat", "pair", "pair", "wide"]);
  });

  it.each([
    [0, []],
    [1, ["feat"]],
    [2, ["feat", "wide"]],
    [3, ["feat", "pair", "pair"]],
    [5, ["feat", "pair", "pair", "pair", "pair"]],
    [7, ["feat", "pair", "pair", "pair", "pair", "pair", "pair"]],
  ])("%i hosts", (n, expected) => {
    expect(cardShapes(n)).toEqual(expected);
  });

  it("never leaves a lone half-width card with a hole beside it", () => {
    for (let n = 1; n <= 12; n++) {
      const shapes = cardShapes(n);
      expect(shapes).toHaveLength(n);
      // the pairs must come in twos, whatever the count
      expect(shapes.filter((s) => s === "pair").length % 2).toBe(0);
      expect(shapes.filter((s) => s === "feat")).toHaveLength(1);
    }
  });

  it("survives a nonsense count rather than throwing on a render path", () => {
    expect(cardShapes(-3)).toEqual([]);
    expect(cardShapes(Number.NaN)).toEqual([]);
    expect(cardShapes(2.7)).toEqual(["feat", "wide"]);
  });
});

describe("hostsResolved — has the fleet actually answered?", () => {
  it("the first poll in flight is UNRESOLVED", () => {
    expect(hostsResolved(true, null, 0)).toBe(false);
  });

  it("a successful poll with ZERO hosts is resolved (an honest zero)", () => {
    expect(hostsResolved(false, null, 0)).toBe(true);
  });

  it("a hard failure with no data ever is unresolved — that is also the hero-only case", () => {
    expect(hostsResolved(false, new Error("backend unreachable"), 0)).toBe(false);
  });

  it("a background refetch error KEEPS the last successful set resolved (Codex R4-4)", () => {
    expect(hostsResolved(false, new Error("boom"), 4)).toBe(true);
  });
});

describe("rateText — the §6.3 pill", () => {
  it("is the prototype's format with the mode and the online count made live", () => {
    expect(rateText(3, 3, true)).toBe(`${GACHA_COPY.star}3 RATE 3.0%`);
    expect(rateText(5, 4, true)).toBe(`${GACHA_COPY.star}5 RATE 4.0%`);
  });

  it("reads a HELD value while unresolved — never a false 0.0%", () => {
    const held = rateText(5, 0, false);
    expect(held).not.toContain("0.0");
    expect(held).toContain("RATE");
  });

  it("…and reads a real 0.0% once the fleet has genuinely answered with nothing online", () => {
    expect(rateText(5, 0, true)).toBe(`${GACHA_COPY.star}5 RATE 0.0%`);
  });
});

describe("counterText — the track head's NN / NN", () => {
  it("is zero-padded, like the prototype's 04 / 04", () => {
    expect(counterText(4, 4, true)).toBe("04 / 04");
    expect(counterText(0, 2, true)).toBe("00 / 02");
  });

  it("lets the natural width take over past 99", () => {
    expect(counterText(7, 120, true)).toBe("07 / 120");
  });

  it("holds both halves while unresolved", () => {
    expect(counterText(0, 0, false)).not.toContain("0");
  });
});

describe("plateSub — a capsule's ROLE · state line", () => {
  it("is the role and the ping while online (the prototype's `WORKSTATION · 18 ms`)", () => {
    expect(plateSub(host())).toBe(`WORKSTATION ${GACHA_COPY.sep} 18 ms`);
  });

  it("swaps the ping for the frozen standing-by copy while asleep", () => {
    const asleep = host({ status: { ...host().status!, online: false, ping_ms: null } });
    expect(plateSub(asleep)).toBe(`WORKSTATION ${GACHA_COPY.sep} ${GACHA_COPY.cardSleeping}`);
  });

  it("falls back to the OS when a machine declares no role (the Kit device row's own pair)", () => {
    expect(plateSub(host({ role: null }))).toBe(`LINUX ${GACHA_COPY.sep} 18 ms`);
  });

  it("drops the segment entirely rather than printing a dash for a missing ping", () => {
    const noPing = host({ status: { ...host().status!, ping_ms: null } });
    expect(plateSub(noPing)).toBe("WORKSTATION");
  });

  it("survives a host with no status at all", () => {
    expect(plateSub(host({ status: null }))).toBe(
      `WORKSTATION ${GACHA_COPY.sep} ${GACHA_COPY.cardSleeping}`,
    );
  });
});

describe("promoCopy — the per-state slide templates (§6.4 / the R8 amendment)", () => {
  it("uses the frozen ONLINE pair", () => {
    expect(promoCopy(true)).toEqual({
      tag: GACHA_COPY.promoTagOnline,
      caption: GACHA_COPY.promoCaptionOnline,
    });
  });

  it("uses the frozen SLEEPING pair", () => {
    expect(promoCopy(false)).toEqual({
      tag: GACHA_COPY.promoTagSleeping,
      caption: GACHA_COPY.promoCaptionSleeping,
    });
  });
});
