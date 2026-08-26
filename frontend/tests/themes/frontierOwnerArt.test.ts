import { describe, expect, it } from "vitest";

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { ART, HERO_KEY, RIG_KEYS, assets } from "../../src/themes/frontier/art";
import { frontierArtFromIndex, STACK_KEYS } from "../../src/themes/frontier/ownerArt";
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

/** A BUNDLED row, as the server collates it: no file, no url, its id in both `name` and `bundled`. */
const bundled = (id: string, over: Partial<MediaFile> = {}): MediaFile => ({
  ...file(id),
  file: "",
  url: "",
  bundled: id,
  format: null,
  size_bytes: 0,
  revision: "",
  width: null,
  height: null,
  ...over,
});

/** The URL that same file is PAINTED at (D65 defect #1): every ladder now hands its consumer a
 *  ready-to-paint url, so an owner file carries its `?rev=` cache-buster and a replace-in-place cannot
 *  keep showing the old bytes. `lib/media.ts#revUrl` is the one spelling; this mirrors it. */
const painted = (name: string, over: Partial<MediaFile> = {}) => {
  const f = file(name, over);
  return `${f.url}?rev=${encodeURIComponent(f.revision)}`;
};

const index = (roles: Partial<Record<string, MediaFile[]>>, slots: Record<string, string> = {}) =>
  ({
    ns: "frontier",
    collation: "library-v1",
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
    expect(art.rigUrlFor(0)).toBe(painted("a")); // the self host's card
    expect(art.rigUrlFor(1)).toBe(painted("b"));
  });

  it("CYCLES when there are more machines than files", () => {
    const art = frontierArtFromIndex(index({ rigs: [file("a"), file("b")] }));
    expect([0, 1, 2, 3, 4].map((i) => art.rigUrlFor(i))).toEqual(
      ["a", "b", "a", "b", "a"].map((n) => painted(n)),
    );
  });

  it("an UNUSABLE file holds its position: only ITS card falls back, the rest never re-deal", () => {
    // The shipped gacha invariant, inherited whole (Codex G0 #2): filtering the broken file out here
    // would shift every card after it, so one bad drop would silently change half the fleet's art.
    const art = frontierArtFromIndex(
      index({ rigs: [file("a"), file("bad", { unusable: true }), file("c")] }),
    );
    expect(art.rigUrlFor(0)).toBe(painted("a"));
    expect(art.rigUrlFor(1)).toBeUndefined(); // → the consumer's bundled rig for position 1
    expect(art.rigUrlFor(2)).toBe(painted("c"));
    expect(art.rigUrlFor(3)).toBe(painted("a")); // the cycle is unchanged
  });

  it("a nonsense position is unassigned rather than a throw (it is on a render path)", () => {
    const art = frontierArtFromIndex(index({ rigs: [file("a")] }));
    expect(art.rigUrlFor(-1)).toBeUndefined();
    expect(art.rigUrlFor(1.5)).toBeUndefined();
  });
});

describe("hero — a first-wins pool (the kit-background shape)", () => {
  it("first usable wins", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one"), file("two")] }));
    expect(art.hero).toBe(painted("one"));
  });

  it("ORDER is the only way to choose it — a leftover `hero:` value cannot reach the ladder", () => {
    // "W6" (owner ruling 2026-08-26): the `hero` PIN died with every other pool pin, so the cover is
    // whichever image the owner moved to the top of that gallery. `FRONTIER_SLOTS` is empty on the
    // server side, so such a value is refused at LOAD rather than honoured here — this arm pins that
    // the resolver would ignore it even if one arrived.
    const art = frontierArtFromIndex(index({ hero: [file("one"), file("two")] }, { hero: "two" }));
    expect(art.hero).toBe(painted("one"));
    const moved = frontierArtFromIndex(index({ hero: [file("two"), file("one")] }));
    expect(moved.hero).toBe(painted("two"));
  });

  it("an all-unusable folder falls all the way through to the bundled vista", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one", { unusable: true })] }));
    expect(art.hero).toBe(ART.hero);
  });

  // ── the vista as a LIBRARY ENTRY (S6) ──────────────────────────────────────────────────────────
  //
  // It used to be a bare URL on the ladder's last rung that no id addressed, which meant the one
  // picture this role paints was in no gallery: unreachable, unorderable, unretirable. It is a bundled
  // row now, and these three arms are what that costs and buys.

  it("the bundled ROW resolves to this theme's own asset — the server emits an id, never a url", () => {
    const art = frontierArtFromIndex(index({ hero: [bundled(HERO_KEY)] }));
    expect(art.hero).toBe(ART.hero);
  });

  it("an owner file still outranks it, because the owner's tier replaces the fallback one", () => {
    const art = frontierArtFromIndex(index({ hero: [file("one"), bundled(HERO_KEY)] }));
    expect(art.hero).toBe(painted("one"));
  });

  it("switching it OFF paints no cover — the In-use switch has to mean what it says", () => {
    // The half that a hard-coded last rung made impossible: the gallery would say "nothing in use"
    // while the map kept painting the retired vista (Emma's S2 review #2, on this surface).
    const art = frontierArtFromIndex(index({ hero: [bundled(HERO_KEY, { hidden: true })] }));
    expect(art.hero).toBeUndefined();
  });

  it("…but a STUB payload still gets it — `offersBundled` is what tells the two apart", () => {
    // An e2e mock, a proxy answering `{}`, a partial response: none of them ever described the tier,
    // so "nothing resolved" is not the owner's answer and the shipped theme stands.
    expect(frontierArtFromIndex(index({})).hero).toBe(ART.hero);
    expect(frontierArtFromIndex(undefined).hero).toBe(ART.hero);
  });

  it("an id the theme no longer ships resolves to nothing rather than to a broken url", () => {
    expect(frontierArtFromIndex(index({ hero: [bundled("retired")] })).hero).toBeUndefined();
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
        cube: has.cube ? painted("cube") : BUNDLED.cube,
        mid: has.mid ? painted("platform-mid") : BUNDLED.mid,
        base: has.base ? painted("platform-base") : BUNDLED.base,
      });
    });
  }

  it("binds on the STEM whatever its case or extension, and ignores a stem naming no layer", () => {
    const art = frontierArtFromIndex(
      index({ stack: [file("CUBE", { file: "CUBE.webp" }), file("sketch")] }),
    );
    expect(art.stack.cube).toBe(painted("CUBE", { file: "CUBE.webp" }));
    expect(art.stack.mid).toBe(ART.stack.mid); // `sketch` bound to nothing
  });

  it("a stem COLLISION resolves first-in-index-order — the owner's own listing decides", () => {
    const first = file("cube", { url: "/first.png" });
    const second = file("Cube", { url: "/second.png" });
    const at = (u: string) => `${u}?rev=${encodeURIComponent(first.revision)}`;
    expect(frontierArtFromIndex(index({ stack: [first, second] })).stack.cube).toBe(
      at("/first.png"),
    );
    expect(frontierArtFromIndex(index({ stack: [second, first] })).stack.cube).toBe(
      at("/second.png"),
    );
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

// ── the §2.4 resolvers over the wire's BUNDLED tier (D65). `rigRows` is the ONE rule the Conf gallery
//    reads too, so these arms are what stop the gallery claiming a deal the cards will not paint.

/** A bundled row as the server emits one: the id in `bundled`, no file, no url, no revision. */
const bundledRow = (id: string, over: Partial<MediaFile> = {}): MediaFile => ({
  ...file(id),
  bundled: id,
  name: id,
  file: "",
  url: "",
  revision: "",
  ...over,
});

describe("the bundled FALLBACK TIER (D65 §2.3)", () => {
  const tier = RIG_KEYS.map((k) => bundledRow(k));

  it("deals exactly what present() names, position for position — parity by construction", () => {
    // The fallback tier arrives in RIG_KEYS order and `cycleAt` deals it positionally, which is the
    // same expression `present()` evaluates (`RIG_KEYS[i % 6]`). A fresh install cannot re-deal.
    const art = frontierArtFromIndex(index({ rigs: tier }));
    for (let i = 0; i < 14; i++) expect(art.rigUrlFor(i)).toBe(ART.rigs[i % ART.rigs.length]);
  });

  it("one owner file DEMOTES the tier — the shipped 'drop one in' semantics", () => {
    const art = frontierArtFromIndex(index({ rigs: [file("a"), ...tier] }));
    expect(art.rigUrlFor(0)).toBe(painted("a"));
    expect(art.rigUrlFor(1)).toBe(painted("a")); // cycles over the owner's one file, as it always did
  });

  it("a HIDDEN file leaves resolution while an UNUSABLE one holds its slot (§2.2's pair)", () => {
    const hidden = frontierArtFromIndex(index({ rigs: [file("a", { hidden: true }), file("b")] }));
    expect(hidden.rigUrlFor(0)).toBe(painted("b")); // filtered OUT — position 0 is b's now
    const broken = frontierArtFromIndex(
      index({ rigs: [file("a", { unusable: true }), file("b")] }),
    );
    expect(broken.rigUrlFor(0)).toBeUndefined(); // HOLDS its slot; only its own card falls back
    expect(broken.rigUrlFor(1)).toBe(painted("b"));
  });

  it("hiding the whole tier leaves the role EMPTY — 'not in use' means not in use", () => {
    // Emma's S2 review #2, the frontier half. `rigUrlFor` used to answer `undefined` here, and the
    // consumer reads that as "fall back to my own indexed rig" — so the map kept dealing exactly the
    // six rigs the owner had just retired while the gallery said nothing was in use. `null` is the
    // third answer that tells the two apart.
    const off = tier.map((b) => ({ ...b, hidden: true }));
    const art = frontierArtFromIndex(index({ rigs: off }));
    for (let i = 0; i < 8; i++) expect(art.rigUrlFor(i)).toBeNull();
    // …and the same for one stack LAYER, which is its own destination with its own switch.
    const layers = STACK_KEYS.map((k) => bundledRow(k, { hidden: k === "cube" }));
    const stack = frontierArtFromIndex(index({ stack: layers })).stack;
    expect(stack.cube).toBeUndefined();
    expect(stack.mid).toBe(ART.stack.mid); // the other two are untouched — the layers composite
  });

  it("…while a payload that never described the tier still degrades to the shipped art", () => {
    // The other half of the predicate: a stub mock or a partial response keeps painting the theme.
    const art = frontierArtFromIndex(index({ rigs: [], stack: [] }));
    expect(art.rigUrlFor(0)).toBeUndefined(); // ⇒ the consumer's own indexed rig
    expect(art.stack).toEqual({ cube: ART.stack.cube, mid: ART.stack.mid, base: ART.stack.base });
  });

  it("a bundled STACK row answers its own layer, and an owner file still wins it", () => {
    const layers = STACK_KEYS.map((k) => bundledRow(k));
    expect(frontierArtFromIndex(index({ stack: layers })).stack).toEqual({
      cube: ART.stack.cube,
      mid: ART.stack.mid,
      base: ART.stack.base,
    });
    expect(frontierArtFromIndex(index({ stack: [file("cube"), ...layers] })).stack.cube).toBe(
      painted("cube"),
    );
  });
});
