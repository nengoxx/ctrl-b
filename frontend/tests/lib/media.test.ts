import { describe, expect, it } from "vitest";

import { cycleAssign, cycleAt, firstUsable, orderedUsable } from "../../src/lib/media";

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
