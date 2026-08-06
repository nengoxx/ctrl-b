import { describe, expect, it } from "vitest";

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { ART, RIG_KEYS, assets } from "../../src/themes/frontier/art";
import { frontierArtFromIndex } from "../../src/themes/frontier/ownerArt";
import { present } from "../../src/themes/frontier/present";

// The frontier owner-art adapter (D53 M2 / MEDIA_PLAN §9's frontier arms). PURE — a wire payload in,
// resolved URLs out — so every obligation below is an ordinary unit test rather than a render:
//
//  · EMPTY-FOLDER BYTE-IDENTITY: with no owner files the theme paints exactly what it painted before M2;
//  · the rig deal follows the fleet's DISPLAY order (self first), position-preserving;
//  · all EIGHT owner/bundled combinations of the three stack layers composite correctly;
//  · the hero pin, its dangling case, and the first-wins default;
//  · a payload that is a stub or a lie degrades rather than throwing inside a theme's render.

const file = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.png`,
  url: `/api/media/frontier/files/x/${name}.png`,
  format: "png",
  size_bytes: 100,
  revision: "1:100",
  width: 10,
  height: 10,
  unusable: false,
  unusable_reason: null,
  ...over,
});

const index = (roles: Partial<Record<string, MediaFile[]>>, slots: Record<string, string> = {}) =>
  ({
    ns: "frontier",
    collation: "casefold-natural",
    roles: { rigs: [], hero: [], stack: [], ...roles },
    slots,
  }) as MediaIndex;

describe("empty folders ⇒ the pre-M2 rendering, byte for byte", () => {
  it("yields NO owner rig at any position, so the consumer's bundled rung stands", () => {
    // `rigUrlFor` is the one partial accessor on purpose: the bundled rig for a position is named by
    // present() (`RIG_KEYS[i % 6]`), so the last rung lives at the consumer and cannot drift from it.
    for (const idx of [undefined, index({})]) {
      const art = frontierArtFromIndex(idx);
      for (let i = 0; i < 14; i++) expect(art.rigUrlFor(i)).toBeUndefined();
    }
  });

  it("the consumer's composed expression IS the bundled indexed rig, for i = 0..13", () => {
    // The exact expression FrontierFleet evaluates. This is the anti-drift fence between the adapter
    // and present(): if either side ever stopped agreeing, a fresh install would silently re-deal.
    const art = frontierArtFromIndex(undefined);
    for (let i = 0; i < 14; i++) {
      const enc = present({ name: "h" }, i, undefined);
      expect(art.rigUrlFor(i) ?? assets[enc.asset as string]).toBe(ART.rigs[i % ART.rigs.length]);
    }
  });

  it("hero and all three stack layers are the bundled URLs", () => {
    for (const idx of [undefined, index({})]) {
      const art = frontierArtFromIndex(idx);
      expect(art.hero).toBe(ART.hero);
      expect(art.stack).toEqual({ cube: ART.stack.cube, mid: ART.stack.mid, base: ART.stack.base });
    }
  });
});

describe("rigs — the pool dealt over the fleet's display order", () => {
  it("deals position i the i-th file, SELF FIRST (position 0 is the self host — useHosts sorts it there)", () => {
    const art = frontierArtFromIndex(index({ rigs: [file("a"), file("b")] }));
    expect(art.rigUrlFor(0)).toBe(file("a").url); // the self host's card
    expect(art.rigUrlFor(1)).toBe(file("b").url);
  });

  it("CYCLES when there are more machines than files", () => {
    const art = frontierArtFromIndex(index({ rigs: [file("a"), file("b")] }));
    expect([0, 1, 2, 3, 4].map((i) => art.rigUrlFor(i))).toEqual(
      ["a", "b", "a", "b", "a"].map((n) => file(n).url),
    );
  });

  it("an UNUSABLE file holds its position: only ITS card falls back, the rest never re-deal", () => {
    // The shipped gacha invariant, inherited whole (Codex G0 #2): filtering the broken file out here
    // would shift every card after it, so one bad drop would silently change half the fleet's art.
    const art = frontierArtFromIndex(
      index({ rigs: [file("a"), file("bad", { unusable: true }), file("c")] }),
    );
    expect(art.rigUrlFor(0)).toBe(file("a").url);
    expect(art.rigUrlFor(1)).toBeUndefined(); // → the consumer's bundled rig for position 1
    expect(art.rigUrlFor(2)).toBe(file("c").url);
    expect(art.rigUrlFor(3)).toBe(file("a").url); // the cycle is unchanged
  });

  it("a nonsense position is unassigned rather than a throw (it is on a render path)", () => {
    const art = frontierArtFromIndex(index({ rigs: [file("a")] }));
    expect(art.rigUrlFor(-1)).toBeUndefined();
    expect(art.rigUrlFor(1.5)).toBeUndefined();
  });
});

describe("hero — a pool with a pin (the kit-background shape)", () => {
  it("first usable wins with no pin", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one"), file("two")] }));
    expect(art.hero).toBe(file("one").url);
  });

  it("the pin names a member of its OWN role and wins", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one"), file("two")] }, { hero: "two" }));
    expect(art.hero).toBe(file("two").url);
  });

  it("a DANGLING pin falls through to the first usable — never a blank cover", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one")] }, { hero: "deleted" }));
    expect(art.hero).toBe(file("one").url);
  });

  it("an all-unusable folder falls all the way through to the bundled vista", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one", { unusable: true })] }));
    expect(art.hero).toBe(ART.hero);
  });
});

describe("stack — the NAMED role, all 8 owner/bundled combinations", () => {
  const OWNER = { cube: file("cube"), mid: file("platform-mid"), base: file("platform-base") };
  const BUNDLED = { cube: ART.stack.cube, mid: ART.stack.mid, base: ART.stack.base };

  // Every subset of the three layers: a partial drop must COMPOSITE owner over bundled (§3), because
  // the layers are one picture and the owner must be able to replace just the cube.
  for (const bits of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const has = { cube: !!(bits & 1), mid: !!(bits & 2), base: !!(bits & 4) };
    const files = [
      ...(has.cube ? [OWNER.cube] : []),
      ...(has.mid ? [OWNER.mid] : []),
      ...(has.base ? [OWNER.base] : []),
    ];
    it(`cube=${has.cube ? "owner" : "bundled"} mid=${has.mid ? "owner" : "bundled"} base=${has.base ? "owner" : "bundled"}`, () => {
      expect(frontierArtFromIndex(index({ stack: files })).stack).toEqual({
        cube: has.cube ? OWNER.cube.url : BUNDLED.cube,
        mid: has.mid ? OWNER.mid.url : BUNDLED.mid,
        base: has.base ? OWNER.base.url : BUNDLED.base,
      });
    });
  }

  it("binds on the STEM whatever its case or extension, and ignores a stem naming no layer", () => {
    const art = frontierArtFromIndex(
      index({ stack: [file("CUBE", { file: "CUBE.webp" }), file("sketch")] }),
    );
    expect(art.stack.cube).toBe(file("CUBE").url);
    expect(art.stack.mid).toBe(ART.stack.mid); // `sketch` bound to nothing
  });

  it("a stem COLLISION resolves first-in-index-order — the owner's own listing decides", () => {
    const first = file("cube", { url: "/first.png" });
    const second = file("Cube", { url: "/second.png" });
    expect(frontierArtFromIndex(index({ stack: [first, second] })).stack.cube).toBe("/first.png");
    expect(frontierArtFromIndex(index({ stack: [second, first] })).stack.cube).toBe("/second.png");
  });

  it("an unusable layer file keeps the BUNDLED layer rather than painting a hole", () => {
    const art = frontierArtFromIndex(index({ stack: [file("cube", { unusable: true })] }));
    expect(art.stack.cube).toBe(ART.stack.cube);
  });
});

describe("degrade — the payload is wire data, not our types", () => {
  it("a stub or partial index yields the bundled art instead of throwing", () => {
    for (const junk of [{}, { ns: "frontier" }, { roles: null }, { roles: { stack: "nope" } }]) {
      const art = frontierArtFromIndex(junk as unknown as MediaIndex);
      expect(art.hero).toBe(ART.hero);
      expect(art.stack.cube).toBe(ART.stack.cube);
      expect(art.rigUrlFor(0)).toBeUndefined();
    }
  });

  it("the bundled rig pool is still the partitioned one (hero/stack can never be dealt to a card)", () => {
    expect(ART.rigs).toHaveLength(RIG_KEYS.length);
    for (const url of [ART.hero, ART.stack.cube, ART.stack.mid, ART.stack.base]) {
      expect(ART.rigs).not.toContain(url);
    }
  });
});
