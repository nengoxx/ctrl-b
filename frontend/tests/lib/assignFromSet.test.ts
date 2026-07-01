import { describe, expect, it } from "vitest";

import { assignFromSet } from "../../src/lib/assignFromSet";

// The reusable, theme-agnostic decorative-asset picker. Tested against a synthetic set (no real assets) so it
// stays a pure-logic test: distinctness within a call, stability across re-orders, and the >set fallback.

const SET = ["a", "b", "c", "d", "e", "f"] as const;

describe("assignFromSet", () => {
  it("never repeats an item within a call (≤ set size) — the corsair repeat", () => {
    const ids = ["corsair.ssh", "corsair.web", "corsair.rdp", "corsair.smb", "corsair.vnc"];
    const m = assignFromSet(ids, SET);
    const picks = ids.map((id) => m.get(id));
    expect(picks.every(Boolean)).toBe(true);
    expect(new Set(picks).size).toBe(ids.length); // all distinct
  });

  it("is stable regardless of the incoming id order (no flicker on polls)", () => {
    const ids = ["vault.ssh", "vault.web", "corsair.rdp", "corsair.smb"];
    const a = assignFromSet(ids, SET);
    const b = assignFromSet([...ids].reverse(), SET);
    for (const id of ids) expect(a.get(id)).toBe(b.get(id));
  });

  it("assigns every id even when there are more ids than items (repeats then allowed)", () => {
    const ids = Array.from({ length: SET.length + 4 }, (_, i) => `svc${i}`);
    const m = assignFromSet(ids, SET);
    expect(m.size).toBe(ids.length);
    expect([...m.values()].every((v) => SET.includes(v))).toBe(true);
  });

  it("returns an empty map for an empty set (graceful, no throw)", () => {
    expect(assignFromSet(["x", "y"], []).size).toBe(0);
  });
});
