import { describe, expect, it } from "vitest";

import { present } from "../../src/themes/cosmos/present";

// cosmos present() (§9.9) — the per-host orbital encoding. Pure host+index→VisualEncoding, so it's the
// jsdom-safe part to lock (the planet rendering is exercised visually).

const host = (id: string, name?: string) => ({ id, name });
const pos = (e: ReturnType<typeof present>) => e.position as { angle: number; radius: number };

describe("present()", () => {
  it("places index 0 at angle 0, and the angle is linear in index (golden-angle spacing)", () => {
    expect(pos(present(host("a"), 0)).angle).toBe(0);
    // angle = index · GOLDEN_ANGLE → index 2's angle is exactly twice index 1's.
    expect(pos(present(host("a"), 2)).angle).toBeCloseTo(2 * pos(present(host("a"), 1)).angle, 10);
  });

  it("grows the orbit radius with index (no host at the dead center)", () => {
    expect(pos(present(host("a"), 0)).radius).toBeGreaterThan(0);
    expect(pos(present(host("a"), 4)).radius).toBeGreaterThan(pos(present(host("a"), 1)).radius);
  });

  it("assigns a stable planet color by host id (same id → same color, hex string)", () => {
    const c = present(host("g5"), 3).color!;
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(present(host("g5"), 9).color).toBe(c); // color tracks id, not index
  });

  it("derives the symbol from the host name (uppercased first letter), '?' when missing", () => {
    expect(present(host("a", "corsair"), 0).symbol).toBe("C");
    expect(present(host("a"), 0).symbol).toBe("?");
  });

  it("shallow-merges a per-host override on top (additive, C4)", () => {
    const e = present(host("a", "vega"), 0, { color: "#123456", size: 2 });
    expect(e.color).toBe("#123456"); // override wins
    expect(e.size).toBe(2); // additive channel
    expect(e.symbol).toBe("V"); // untouched base field survives
  });
});
