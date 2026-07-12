import { describe, expect, it } from "vitest";

import { ART, RIG_KEYS, assets } from "../../src/themes/frontier/art";
import { present } from "../../src/themes/frontier/present";

// Frontier present() (§9.9) + the art manifest partition — the jsdom-safe pure math the badlands MAP relies
// on (the beacon/rig rendering is exercised visually + by the B2 render sweep). Covers the R2 scatter's
// determinism + safe-region bound, the rig-image modulo (pool = rigs ONLY), the plate derivation, and the
// explicit per-field override mapping (the review's latent-bug fix: validated + clamped, never a blind spread).

const host = (name: string) => ({ id: name, name });
const pos = (e: ReturnType<typeof present>) => e.position as { x: number; y: number };

// The safe region present() scatters into (must stay in sync with present.ts's SAFE_* constants).
const SAFE = { x0: 12, x1: 88, y0: 30, y1: 85 };

describe("present() — R2 scatter", () => {
  it("is deterministic: same index → the same position", () => {
    const a = pos(present(host("pegasus"), 3));
    const b = pos(present(host("different-name"), 3)); // position is index-driven, not name-driven
    expect(a).toEqual(b);
  });

  it("keeps every beacon inside the safe region for i = 0..15", () => {
    for (let i = 0; i < 16; i++) {
      const { x, y } = pos(present(host("h"), i));
      expect(x).toBeGreaterThanOrEqual(SAFE.x0);
      expect(x).toBeLessThanOrEqual(SAFE.x1);
      expect(y).toBeGreaterThanOrEqual(SAFE.y0);
      expect(y).toBeLessThanOrEqual(SAFE.y1);
    }
  });

  it("keeps a REAL minimum pairwise separation through N=12 (not just distinctness)", () => {
    // Pins the "≥15%-of-width min separation by construction" claim in present.ts — a regression in the
    // R2 constants that clustered beacons while staying 2-decimal-distinct would slip a Set-based check
    // (audit F2 NIT-3). Floor asserted at 10 (%-space Euclidean) — headroom under the actual ≈15.4 so a
    // legitimate safe-region retune doesn't false-fail, still far above visual overlap (~4 = pin+tag).
    const pts = Array.from({ length: 12 }, (_, i) => pos(present(host("h"), i)));
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    expect(min).toBeGreaterThan(10);
  });
});

describe("present() — rig image (modulo over rigs ONLY)", () => {
  it("assigns the indexed rig key and wraps over RIG_KEYS", () => {
    expect(present(host("h"), 0).asset).toBe(RIG_KEYS[0]);
    expect(present(host("h"), 5).asset).toBe(RIG_KEYS[5]);
    expect(present(host("h"), RIG_KEYS.length).asset).toBe(RIG_KEYS[0]); // wraps
    expect(present(host("h"), RIG_KEYS.length + 2).asset).toBe(RIG_KEYS[2]);
  });

  it("only ever yields a rig key — never hero or a stack layer", () => {
    for (let i = 0; i < 20; i++) {
      expect(RIG_KEYS as readonly string[]).toContain(present(host("h"), i).asset);
    }
  });
});

describe("present() — plate", () => {
  it("derives 0x + first-3-upper + zero-padded 1-based index", () => {
    expect(present(host("pegasus"), 0).plate).toBe("0xPEG01");
    expect(present(host("titan"), 3).plate).toBe("0xTIT04");
  });

  it("guards a short (2-char) name without crashing", () => {
    expect(present(host("vm"), 1).plate).toBe("0xVM02");
    expect(present(host(""), 0).plate).toBe("0xRIG01"); // empty name → RIG fallback
  });
});

describe("present() — override mapping (explicit, validated, clamped)", () => {
  it("swaps the asset when image names a real rig key", () => {
    expect(present(host("h"), 0, { image: "rig4" }).asset).toBe("rig4");
  });

  it("falls back to the indexed default when image is dangling (never crashes)", () => {
    expect(present(host("h"), 0, { image: "rig99" }).asset).toBe(RIG_KEYS[0]);
    expect(present(host("h"), 0, { image: 42 }).asset).toBe(RIG_KEYS[0]); // non-string ignored
  });

  it("replaces position from numeric x/y", () => {
    const { x, y } = pos(present(host("h"), 0, { x: 40, y: 55 }));
    expect(x).toBe(40);
    expect(y).toBe(55);
  });

  it("CLAMPS an out-of-range override into the safe region (a typo can't fling a beacon off-card)", () => {
    const hi = pos(present(host("h"), 0, { x: 900, y: 900 }));
    expect(hi.x).toBe(SAFE.x1); // clamped to the max
    expect(hi.y).toBe(SAFE.y1);
    const lo = pos(present(host("h"), 0, { x: -50, y: -50 }));
    expect(lo.x).toBe(SAFE.x0); // clamped to the min
    expect(lo.y).toBe(SAFE.y0);
  });

  it("ignores a non-numeric / NaN coordinate per-field (the scatter default stands)", () => {
    const def = pos(present(host("h"), 2));
    const e = pos(present(host("h"), 2, { x: "left" as unknown as number, y: Number.NaN }));
    expect(e).toEqual(def);
  });
});

describe("art manifest — partition", () => {
  it("RIG_KEYS is rig1..rig6 in numeric order", () => {
    expect(RIG_KEYS).toEqual(["rig1", "rig2", "rig3", "rig4", "rig5", "rig6"]);
  });

  it("ART.rigs has exactly 6 URLs, in RIG_KEYS order", () => {
    expect(ART.rigs).toHaveLength(6);
    ART.rigs.forEach((url) => expect(typeof url).toBe("string"));
    // each rig url equals its by-name entry in the raw assets map → same ordering
    ART.rigs.forEach((url, i) => expect(url).toBe(assets[RIG_KEYS[i]]));
  });

  it("keeps hero + the F4 stack layers OUT of the rig pool", () => {
    expect(ART.rigs).not.toContain(ART.hero);
    expect(ART.rigs).not.toContain(ART.stack.cube);
    expect(ART.rigs).not.toContain(ART.stack.mid);
    expect(ART.rigs).not.toContain(ART.stack.base);
  });
});
