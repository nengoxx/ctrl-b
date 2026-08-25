import { describe, expect, it } from "vitest";

import {
  advisoriesOf,
  appendItem,
  displayOrder,
  entryId,
  fallbackTier,
  ladderRows,
  metaText,
  moveBy,
  moveToEdge,
  ownTier,
  removeItem,
  rowId,
  setActive,
  setHidden,
  shown,
  tileUrl,
  usableLadderRows,
  type ArtRow,
  type LibraryEntry,
} from "../../src/lib/mediaLibrary";

// The library's PURE half (D65 / MEDIA_MANAGER_PLAN §2.3 + §6.5). Every obligation here is a claim
// about CONFIG — what a gallery gesture writes — so it is a unit test over plain objects, exactly like
// `lib/media.ts`'s. The gallery suite then only has to prove it calls these.
//
// The two load-bearing rules, and the ones §11 pins by name:
//  · a write may SWEEP unlisted DISK rows into `files` (they are already in the resolution prefix, so
//    listing them changes only their order) — without it a reorder past an SSH-dropped file would be
//    inexpressible and would snap back on the next refetch;
//  · a write NEVER sweeps unlisted BUNDLED rows. Only the one the owner acted on becomes listed, or
//    the first drag would promote the whole fallback tier into the fleet's deal.

/** A row on disk, as the server collates it. */
const disk = (file: string, over: Partial<ArtRow> = {}): ArtRow => ({
  name: file.replace(/\.\w+$/, ""),
  file,
  url: `/api/media/gacha/files/characters/${file}`,
  revision: "1:100",
  size_bytes: 1000,
  width: 10,
  height: 10,
  unusable: false,
  unusable_reason: null,
  ...over,
});

/** A BUNDLED row — no file, no url, its id in both `name` and `bundled` (§2.3). */
const bundled = (id: string, over: Partial<ArtRow> = {}): ArtRow => ({
  name: id,
  file: "",
  url: "",
  bundled: id,
  revision: "",
  size_bytes: 0,
  unusable: false,
  unusable_reason: null,
  ...over,
});

describe("identity — two spaces, never mixed", () => {
  it("a file is keyed by its FILENAME and a bundled entry by its id", () => {
    expect(rowId(disk("a.webp"))).toBe("f:a.webp");
    expect(rowId(bundled("lyra"))).toBe("b:lyra");
    // The pair a single id space would collapse: a role may hold BOTH a file called `lyra.webp` and
    // the bundled entry `lyra`, and they are two library entries with two priorities.
    expect(rowId(disk("lyra.webp"))).not.toBe(rowId(bundled("lyra")));
  });

  it("a config entry answers with the same identity — and a malformed one with none", () => {
    expect(entryId({ name: "a.webp" })).toBe("f:a.webp");
    expect(entryId({ bundled: "lyra" })).toBe("b:lyra");
    // The discriminated union the server validates: both fields, or neither, is not an identity.
    expect(entryId({ name: "a.webp", bundled: "lyra" })).toBeNull();
    expect(entryId({})).toBeNull();
  });
});

describe("tiers — the vocabulary every resolver reads", () => {
  const rows = [disk("a.webp"), bundled("pegasus", { listed: true }), bundled("atlas")];

  it("the OWN tier is disk rows plus LISTED bundled ones; the FALLBACK tier is the rest", () => {
    expect(ownTier(rows).map(rowId)).toEqual(["f:a.webp", "b:pegasus"]);
    expect(fallbackTier(rows).map(rowId)).toEqual(["b:atlas"]);
  });

  it("`hidden` and `unusable` take OPPOSITE treatments — never one predicate (§2.2)", () => {
    const mixed = [
      disk("a.webp", { hidden: true }),
      disk("b.webp", { unusable: true }),
      disk("c.webp"),
    ];
    // hidden is FILTERED OUT (re-dealing is the point of the switch)…
    expect(shown(mixed).map(rowId)).toEqual(["f:b.webp", "f:c.webp"]);
    // …while unusable HOLDS its position in a dealt ladder (one bad file must not re-deal the fleet).
    expect(ladderRows(mixed).map(rowId)).toEqual(["f:b.webp", "f:c.webp"]);
  });

  it("a ladder falls back to the bundled tier only when the owner's tier is empty", () => {
    expect(ladderRows([disk("a.webp"), bundled("atlas")]).map(rowId)).toEqual(["f:a.webp"]);
    expect(ladderRows([bundled("atlas"), bundled("pegasus")]).map(rowId)).toEqual([
      "b:atlas",
      "b:pegasus",
    ]);
    // …and hiding the last owner file falls the role back rather than blanking it.
    expect(ladderRows([disk("a.webp", { hidden: true }), bundled("atlas")]).map(rowId)).toEqual([
      "b:atlas",
    ]);
  });

  it("the USABLE variant lets an all-broken folder fall through — the pair's other half", () => {
    const broken = [disk("bad.webp", { unusable: true }), bundled("atlas")];
    // A DEALT role keeps the owner's tier (its presence is the statement)…
    expect(ladderRows(broken).map(rowId)).toEqual(["f:bad.webp"]);
    // …a FIRST-WINS role would only get a blank surface out of it, so it falls through.
    expect(usableLadderRows(broken).map(rowId)).toEqual(["b:atlas"]);
  });
});

describe("the tier-preserving write rule (§2.3 ③)", () => {
  const rows = [disk("a.webp"), disk("b.webp"), bundled("pegasus"), bundled("atlas")];

  it("a reorder SWEEPS the unlisted disk rows in — the drag holds, it does not snap back", () => {
    // The arm §11 names: config is EMPTY, both files arrived over SSH, and the owner drags the second
    // above the first. Without the sweep the write could not express the order at all.
    const next = moveBy(undefined, rows, "f:b.webp", -1);
    expect(next).toEqual([{ name: "b.webp" }, { name: "a.webp" }]);
    // …and the collation the server will run over that list puts them back in exactly that order,
    // with the untouched bundled tier still trailing (which is where it already was).
    expect(next.map((e) => entryId(e))).toEqual(["f:b.webp", "f:a.webp"]);
  });

  it("…and NEVER sweeps the bundled fallback tier — the first drag must not re-deal the fleet", () => {
    const next = moveBy(undefined, rows, "f:b.webp", -1);
    expect(next.some((e) => "bundled" in e)).toBe(false);
  });

  it("a swap WITH a fallback row lists that ONE entry — the only way to express it", () => {
    // `b.webp` is the last disk row; moving it down means moving `pegasus` above it, which the owner
    // is visibly asking for. One bundled id becomes listed; the other three stay in the fallback tier.
    const next = moveBy(undefined, rows, "f:b.webp", 1);
    expect(next).toEqual([{ name: "a.webp" }, { bundled: "pegasus" }, { name: "b.webp" }]);
  });

  it("an entry keeps every field the gallery does not understand (read-modify-WRITE)", () => {
    const entries: LibraryEntry[] = [
      { name: "a.webp", key: "hero", focal: { x: 0.4, y: 0.2, rev: "r9" } },
      { name: "b.webp", hidden: true },
    ];
    expect(moveBy(entries, rows, "f:b.webp", -1)).toEqual([
      { name: "b.webp", hidden: true },
      { name: "a.webp", key: "hero", focal: { x: 0.4, y: 0.2, rev: "r9" } },
    ]);
  });

  it("a LISTED bundled entry holds its place and its fields through an unrelated move", () => {
    const listed = [
      disk("a.webp"),
      bundled("lyra", { listed: true, hidden: true }),
      disk("b.webp"),
    ];
    const entries: LibraryEntry[] = [
      { name: "a.webp" },
      { bundled: "lyra", hidden: true },
      { name: "b.webp" },
    ];
    expect(moveBy(entries, listed, "f:b.webp", -1)).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
      { bundled: "lyra", hidden: true },
    ]);
  });

  it("a config entry naming a file that is gone falls out — the collation drops it anyway", () => {
    const entries: LibraryEntry[] = [{ name: "ghost.webp" }, { name: "a.webp" }];
    expect(setActive(entries, [disk("a.webp")], "f:a.webp")).toEqual([{ name: "a.webp" }]);
  });
});

describe("set as active — move-to-front (§6.5)", () => {
  const rows = [disk("a.webp"), disk("b.webp"), disk("c.webp")];

  it("moves the chosen entry to the front, keeping everything else in order", () => {
    expect(setActive(undefined, rows, "f:c.webp")).toEqual([
      { name: "c.webp" },
      { name: "a.webp" },
      { name: "b.webp" },
    ]);
  });

  it("a BUNDLED entry can be chosen too — and listing it is exactly what that means", () => {
    const withBundled = [...rows, bundled("lyra")];
    expect(setActive(undefined, withBundled, "b:lyra")).toEqual([
      { bundled: "lyra" },
      { name: "a.webp" },
      { name: "b.webp" },
      { name: "c.webp" },
    ]);
  });
});

describe("reorder edges", () => {
  const rows = [disk("a.webp"), disk("b.webp"), bundled("pegasus")];

  it("move-to-top is move-to-front; move-to-bottom stops at the last EXPRESSIBLE position", () => {
    expect(moveToEdge(undefined, rows, "f:b.webp", "top")).toEqual([
      { name: "b.webp" },
      { name: "a.webp" },
    ]);
    // Not "after pegasus": nothing can be ordered after an untouched fallback row without listing it,
    // and listing it is the one thing the tier rule forbids. The bottom of the arrangeable list is the
    // honest answer, and it is the position the next refetch agrees with.
    expect(moveToEdge(undefined, rows, "f:a.webp", "bottom")).toEqual([
      { name: "b.webp" },
      { name: "a.webp" },
    ]);
  });

  it("a move off either end is refused, not clamped into a surprise", () => {
    expect(moveBy(undefined, rows, "f:a.webp", -1)).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
    ]);
  });
});

describe("the In-use switch (§2.2's `hidden`)", () => {
  const rows = [disk("a.webp"), disk("b.webp")];

  it("writes `hidden` on the entry — and the whole list, so nothing silently re-prioritises", () => {
    // Listing ONE entry into an empty `files` would move it to the front of the collation: the switch
    // would silently promote the file it just excluded.
    expect(setHidden(undefined, rows, "f:b.webp", true)).toEqual([
      { name: "a.webp" },
      { name: "b.webp", hidden: true },
    ]);
  });

  it("switching back ON removes the field rather than persisting a redundant default", () => {
    const entries: LibraryEntry[] = [{ name: "a.webp" }, { name: "b.webp", hidden: true }];
    const next = setHidden(entries, rows, "f:b.webp", false);
    expect(next).toEqual([{ name: "a.webp" }, { name: "b.webp" }]);
    expect(Object.keys(next[1])).toEqual(["name"]);
  });

  it("a BUNDLED default can be retired — the one way to exclude one from an all-entries role", () => {
    const withBundled = [disk("a.webp"), bundled("pegasus")];
    expect(setHidden(undefined, withBundled, "b:pegasus", true)).toEqual([
      { name: "a.webp" },
      { bundled: "pegasus", hidden: true },
    ]);
  });
});

describe("delete — the config half (§6.4)", () => {
  it("drops the entry and PROMOTES the next one, in the same list", () => {
    const rows = [disk("a.webp"), disk("b.webp"), disk("c.webp")];
    // `a` was first (= active); after the write `b` is, and no second write was needed to say so.
    expect(removeItem(undefined, rows, "f:a.webp")).toEqual([
      { name: "b.webp" },
      { name: "c.webp" },
    ]);
  });

  it("leaves the fallback tier alone while it does it", () => {
    const rows = [disk("a.webp"), bundled("pegasus")];
    expect(removeItem(undefined, rows, "f:a.webp")).toEqual([]);
  });
});

describe("append — the upload's register phase (S3b calls it; the rule lives here)", () => {
  it("adds the new file LAST, keeping every other entry's priority", () => {
    const rows = [disk("a.webp")];
    expect(appendItem(undefined, rows, "new.webp", { key: "jellyfin" })).toEqual([
      { name: "a.webp" },
      { name: "new.webp", key: "jellyfin" },
    ]);
  });

  it("a retry after the index caught up patches the entry in place, never a second copy", () => {
    const rows = [disk("a.webp"), disk("new.webp")];
    expect(appendItem([{ name: "a.webp" }], rows, "new.webp", { key: "jellyfin" })).toEqual([
      { name: "a.webp" },
      { name: "new.webp", key: "jellyfin" },
    ]);
  });
});

describe("the view rules the card, the grid and the detail panel share", () => {
  const section = { def: { bundled: [{ id: "lyra", url: "/assets/lyra-abc.webp" }] } };

  it("a disk row paints with its `?rev=`; a bundled row paints the client's own asset (defect #1)", () => {
    expect(tileUrl(disk("a.webp"), section)).toBe(
      "/api/media/gacha/files/characters/a.webp?rev=1%3A100",
    );
    expect(tileUrl(bundled("lyra"), section)).toBe("/assets/lyra-abc.webp");
    // An id this build no longer ships has no picture — and says so rather than painting a 404.
    expect(tileUrl(bundled("ghost"), section)).toBeUndefined();
  });

  it("advisories are the server's verdict first, then the role's own bounds", () => {
    const bounds = { bytes: 1_500_000, pixels: 4_000_000 };
    expect(advisoriesOf(disk("a.webp"), bounds)).toEqual([]);
    expect(
      advisoriesOf(disk("big.webp", { size_bytes: 3_600_000, width: 3000, height: 4257 }), bounds),
    ).toEqual(["oversize", "dimensions"]);
    expect(
      advisoriesOf(
        disk("liar.webp", { unusable: true, unusable_reason: "format-mismatch" }),
        bounds,
      ),
    ).toEqual(["format-mismatch"]);
    // A bundled entry is the app's own art: it has no size the owner could act on.
    expect(advisoriesOf(bundled("lyra"), bounds)).toEqual([]);
  });

  it("the meta line is the two numbers, and nothing else", () => {
    expect(metaText(disk("a.webp", { size_bytes: 88_000, width: 640, height: 854 }))).toBe(
      "640×854 · 88 KB",
    );
    expect(metaText(disk("a.webp", { size_bytes: 3_600_000, width: null, height: null }))).toBe(
      "3.6 MB",
    );
  });

  it("displayOrder is the collation, unchanged — the starting point of every gesture", () => {
    const rows = [disk("a.webp"), bundled("lyra")];
    expect(displayOrder(rows)).toEqual(["f:a.webp", "b:lyra"]);
  });
});
