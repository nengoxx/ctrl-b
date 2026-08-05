import { describe, expect, it } from "vitest";

import {
  cycleAssign,
  cycleAt,
  firstUsable,
  normalizeMediaKey,
  orderedUsable,
  resolveNamed,
} from "../../src/lib/media";

// The owner-media OPERATIONS (D53 / MEDIA_PLAN §2) — the generic half of what G5 shipped inside gacha's
// resolver, lifted so frontier's rigs and the kit's icons compose the same rules. Pure functions over a
// role's server-ordered list, so every case here is an ordinary unit test.
//
// The load-bearing claims, in order of how much they would cost to get wrong:
//  · `cycleAt`/`cycleAssign` deal the list WHOLE — an unusable entry HOLDS its position, so one broken
//    file cannot re-deal every position after it;
//  · `orderedUsable` is the opposite treatment, and it is the right one where position buys nothing;
//  · `firstUsable`'s pin resolves within its own list, and a pin naming nothing falls THROUGH.

const f = (name: string, unusable?: boolean) => ({ name, ...(unusable === true && { unusable }) });

describe("orderedUsable", () => {
  it("keeps the server's order and drops only what cannot paint", () => {
    expect(orderedUsable([f("a"), f("b", true), f("c")]).map((x) => x.name)).toEqual(["a", "c"]);
  });

  it("is empty for an empty list, and never mutates its input", () => {
    const files = [f("a", true)];
    expect(orderedUsable([])).toEqual([]);
    expect(orderedUsable(files)).toEqual([]);
    expect(files).toHaveLength(1);
  });

  it("a malformed TRUTHY flag still excludes — junk wire values degrade defensively (Codex M1b LOW-2)", () => {
    const junk = [{ name: "a", unusable: "true" as unknown as boolean }, { name: "b" }];
    expect(orderedUsable(junk).map((x) => x.name)).toEqual(["b"]);
  });
});

describe("cycleAt / cycleAssign — positional dealing over the display order", () => {
  it("deals position i to entry i, then CYCLES (i mod N)", () => {
    const files = [f("a"), f("b")];
    expect(cycleAssign(files, 5).map((x) => x?.name)).toEqual(["a", "b", "a", "b", "a"]);
  });

  it("an unusable entry HOLDS its position — the invariant that stops one bad file re-dealing the rest", () => {
    const files = [f("a"), f("b", true), f("c")];
    // b is still dealt (flagged) at 1, and c is still at 2 — not shifted up into b's place.
    expect(cycleAssign(files, 6).map((x) => x?.name)).toEqual(["a", "b", "c", "a", "b", "c"]);
    expect(cycleAt(files, 1)?.unusable).toBe(true);
  });

  it("an EMPTY list is the one case that yields the placeholder", () => {
    expect(cycleAt([], 0)).toBeNull();
    expect(cycleAssign([], 3)).toEqual([null, null, null]);
  });

  it("treats a nonsense index or count as unassigned rather than throwing (it is on a render path)", () => {
    expect(cycleAt([f("a")], -1)).toBeNull();
    expect(cycleAt([f("a")], 1.5)).toBeNull();
    expect(cycleAssign([f("a")], -2)).toEqual([]);
  });
});

describe("firstUsable — the ladder rung", () => {
  it("takes the first member that can paint, skipping broken ones", () => {
    expect(firstUsable([f("bad", true), f("good")])?.name).toBe("good");
  });

  it("a PIN naming a member wins over the first", () => {
    expect(firstUsable([f("a"), f("b")], "b")?.name).toBe("b");
  });

  it("a pin naming nothing in THIS list falls through to the first — never a hole", () => {
    // The reel-figure ruling (Codex F4): a legacy pin naming a character finds no member of the reel
    // pool, and the surface degrades to that pool's own pick rather than blanking.
    expect(firstUsable([f("a"), f("b")], "ghost")?.name).toBe("a");
    expect(firstUsable([f("a"), f("b")], "bad")?.name).toBe("a");
  });

  it("a pin naming an UNUSABLE member falls through too", () => {
    expect(firstUsable([f("a"), f("b", true)], "b")?.name).toBe("a");
  });

  it("`undefined` on an empty list, so it composes with `??` into the next rung", () => {
    expect(firstUsable([])).toBeUndefined();
    expect(firstUsable([f("a", true)], "a")).toBeUndefined();
  });
});

describe("normalizeMediaKey — the pinned stem↔key normalization", () => {
  it("is NFC + JS toLowerCase, so case and unicode FORM stop mattering", () => {
    expect(normalizeMediaKey("Cube")).toBe("cube");
    expect(normalizeMediaKey("PLATFORM-BASE")).toBe("platform-base");
    // A decomposed é (e + U+0301, how macOS hands filenames over) and a composed one are one key.
    expect(normalizeMediaKey("Café")).toBe(normalizeMediaKey("café"));
  });

  it("is JS semantics rather than casefold IDEALS — pinned, because that is the contract", () => {
    // JS has no full Unicode casefold: `ß` does not fold to `ss`. Stated as a test so the day someone
    // reaches for a casefold polyfill they find the decision instead of a surprise (MEDIA_PLAN §5).
    expect(normalizeMediaKey("Straße")).toBe("straße");
    expect(normalizeMediaKey("Straße")).not.toBe("strasse");
  });
});

describe("resolveNamed — stem binds to key (the `named` kind)", () => {
  it("binds on the casefolded stem, in either direction, and leaves unknown stems unbound", () => {
    const files = [f("Cube"), f("platform-base"), f("notes")];
    const bound = resolveNamed(files, ["cube", "platform-mid", "platform-base"]);
    expect(bound.get("cube")?.name).toBe("Cube");
    expect(bound.get("platform-base")?.name).toBe("platform-base");
    // A key nobody named a file for is ABSENT, so `?? bundled` is the consumer's whole fallback.
    expect(bound.get("platform-mid")).toBeUndefined();
    expect(bound.size).toBe(2);
  });

  it("keys the map by the DECLARED spelling, whatever the file was called", () => {
    const bound = resolveNamed([f("CUBE")], ["cube"]);
    expect([...bound.keys()]).toEqual(["cube"]);
  });

  it("file/file collision: FIRST in the server's index order wins (§5)", () => {
    // `cube.png` and `cube.webp` both reach `cube`. The winner is the one the index lists first —
    // the owner's own collation and gallery reorder, so the tie-break is visible and movable.
    const first = f("cube");
    const second = f("Cube");
    expect(resolveNamed([first, second], ["cube"]).get("cube")).toBe(first);
    expect(resolveNamed([second, first], ["cube"]).get("cube")).toBe(second);
  });

  it("an UNUSABLE file never binds — the key falls through instead of painting a hole", () => {
    expect(resolveNamed([f("cube", true)], ["cube"]).has("cube")).toBe(false);
    // …and it does not hold the position either: the next file with that stem takes the key. Position
    // is what a POOL preserves; here the NAME is the binding, so there is nothing to re-deal.
    const good = f("Cube");
    expect(resolveNamed([f("cube", true), good], ["cube"]).get("cube")).toBe(good);
  });

  it("returns the caller's own entries, so a consumer can invert it (the gallery does)", () => {
    const file = f("cube");
    expect(resolveNamed([file], ["cube"]).get("cube")).toBe(file);
  });

  it("no files or no keys is an empty map, never a throw (it is on a render path)", () => {
    expect(resolveNamed([], ["cube"]).size).toBe(0);
    expect(resolveNamed([f("cube")], []).size).toBe(0);
  });

  it("declared keys that NORMALIZE identically collapse first-declared-wins (Codex M2 LOW-1)", () => {
    // Registry lists are invariant-tested unique; this is the data-derived-list guard (M3 services).
    const bound = resolveNamed([f("cube")], ["Cube", "CUBE"]);
    expect([...bound.keys()]).toEqual(["Cube"]);
    expect(bound.get("Cube")?.name).toBe("cube");
  });
});
