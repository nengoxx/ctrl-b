import { describe, expect, it } from "vitest";

import {
  advisoriesOf,
  appendItem,
  artFocal,
  focalState,
  displayOrder,
  entryId,
  fallbackTier,
  ladderRows,
  makeEligible,
  metaText,
  moveBy,
  moveToEdge,
  offersBundled,
  ownTier,
  removeItem,
  rowId,
  rowFocal,
  setActive,
  setFocal,
  setHidden,
  shown,
  tileUrl,
  usableLadderRows,
  type ArtRow,
  type LibraryEntry,
  type RowId,
} from "../../src/lib/mediaLibrary";

// The library's PURE half (D65 / MEDIA_MANAGER_PLAN §2.3 + §6.5). Every obligation here is a claim
// about CONFIG — what a gallery gesture writes — so it is a unit test over plain objects, exactly like
// `lib/media.ts`'s. The gallery suite then only has to prove it calls these.
//
// The two load-bearing rules, and the ones §11 pins by name (§2.3 ③ as AMENDED, owner 2026-08-25):
//  · an ORDER intent — `moveBy`, `moveToEdge`, `setActive`, and so the drag — SWEEPS the whole section
//    into `files` in the resulting order, bundled rows included. It is the only shape that can SAY the
//    order: partial listing could not express a mid-list position at all, and listing only the rows of
//    a swap made those rows the owner's entire tier, shrinking the deal to two portraits;
//  · every OTHER intent still lists only what it acted on (plus the disk tier, which is free). None of
//    them is a claim about order, so none of them may make one.

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
    // …and the collation the server will run over that list puts them back in exactly that order,
    // the bundled tier still trailing (which is where it already was — the sweep names it, it does
    // not move it).
    expect(next.map((e) => entryId(e))).toEqual(["f:b.webp", "f:a.webp", "b:pegasus", "b:atlas"]);
  });

  it("…and SWEEPS THE BUNDLED TIER TOO — an order write states the whole section's order", () => {
    // The 2026-08-25 amendment. The old rule listed only the rows the gesture touched, which made the
    // section's order unsayable: this drag can be written at all only because `pegasus` and `atlas`
    // are named too. Same art, new order — nothing on any surface moves.
    const next = moveBy(undefined, rows, "f:b.webp", -1);
    expect(next).toEqual([
      { name: "b.webp" },
      { name: "a.webp" },
      { bundled: "pegasus" },
      { bundled: "atlas" },
    ]);
  });

  it("a swap WITH a fallback row lands EXACTLY where it was asked to", () => {
    // `b.webp` is the last disk row; moving it down means moving `pegasus` above it. Under the old
    // rule that listed `pegasus` alone beside `b.webp` and `atlas` stayed behind in the fallback tier
    // — which, in a role whose ladder replaces the fallback tier with the owner's, retired it.
    const next = moveBy(undefined, rows, "f:b.webp", 1);
    expect(next).toEqual([
      { name: "a.webp" },
      { bundled: "pegasus" },
      { name: "b.webp" },
      { bundled: "atlas" },
    ]);
  });

  it("EXACT EXPRESSION: for any from/to over any mix of tiers, the collation IS the order asked for", () => {
    // The property the amendment exists for, stated as one. `collate` is the server's `library-v1`
    // rule (`core/media.py#list_role`) in three lines: listed entries in order, then the unlisted
    // rows in their own collation order. If the write is exact, re-collating it reproduces the
    // requested order for every pair of positions — which is what "it lands where you dropped it"
    // means, and what a snap-back one refetch later would disprove.
    const mixed = [disk("a.webp"), bundled("pegasus"), disk("b.webp"), bundled("atlas")];
    const collate = (entries: LibraryEntry[]): (RowId | null)[] => {
      const listed = entries.map(entryId);
      return [...listed, ...displayOrder(mixed).filter((id) => !listed.includes(id))];
    };
    for (let from = 0; from < mixed.length; from++) {
      for (let to = 0; to < mixed.length; to++) {
        const want = displayOrder(mixed);
        want.splice(to, 0, want.splice(from, 1)[0]);
        expect(collate(moveBy(undefined, mixed, want[to], to - from))).toEqual(want);
      }
    }
  });

  it("A SECTION OF NOTHING BUT DEFAULTS IS ARRANGEABLE — the owner-round defect, both halves", () => {
    // The state EVERY theme section is in on a fresh install: five bundled characters, no `files`.
    const cast = ["pegasus", "atlas", "3", "4", "lyra"].map((id) => bundled(id));
    // ① DOWNWARD. Every downward drag used to be a no-op: the clamp put the last expressible slot at
    //    the row's own index, so the tile snapped home and the owner saw the gesture refuse itself.
    expect(moveBy(undefined, cast, "b:pegasus", 2).map(entryId)).toEqual([
      "b:atlas",
      "b:3",
      "b:pegasus",
      "b:4",
      "b:lyra",
    ]);
    // ② UPWARD, more than one slot. It wrote `[lyra, 3]` — the two rows of the "swap" — and the
    //    collation then read [lyra, 3, pegasus, atlas, 4]: not the order asked for, and the fleet was
    //    now dealt two portraits instead of five (`ladderRows` replaces the fallback tier with the
    //    owner's the moment the owner's holds anything).
    expect(moveBy(undefined, cast, "b:lyra", -2).map(entryId)).toEqual([
      "b:pegasus",
      "b:atlas",
      "b:lyra",
      "b:3",
      "b:4",
    ]);
  });

  it("an entry keeps every field the gallery does not understand (read-modify-WRITE)", () => {
    const entries: LibraryEntry[] = [
      { name: "a.webp", key: "hero", focal: { x: 0.4, y: 0.2, rev: "r9" } },
      { name: "b.webp", hidden: true },
    ];
    expect(moveBy(entries, rows, "f:b.webp", -1)).toEqual([
      { name: "b.webp", hidden: true },
      { name: "a.webp", key: "hero", focal: { x: 0.4, y: 0.2, rev: "r9" } },
      // The swept bundled rows join as the bare `{bundled}` that listing one MEANS — they carried
      // nothing to preserve, and inventing a field for them would be the rebuild this never does.
      { bundled: "pegasus" },
      { bundled: "atlas" },
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

  it("SWITCHES THE ENTRY BACK ON — activation has to make it eligible, in the same write", () => {
    // Emma's S2 review #1. Moving a hidden entry to the front changes nothing the owner can see:
    // resolution skips hidden rows everywhere, so the tile would sit first and stay excluded while the
    // card kept painting somebody else — and the gallery would be claiming a binding the render ignores.
    const held: LibraryEntry[] = [{ name: "a.webp" }, { name: "c.webp", hidden: true, focal: {} }];
    const rowsOff = [disk("a.webp"), disk("c.webp", { hidden: true })];
    expect(setActive(held, rowsOff, "f:c.webp")).toEqual([
      { name: "c.webp", focal: {} }, // `hidden` gone; every other persisted field kept
      { name: "a.webp" },
    ]);
  });
});

describe("makeEligible — the `files` half of a PIN write (Emma's S2 review #1 ②)", () => {
  it("LISTS a fallback-tier bundled entry, leaving every priority where it was", () => {
    // A pin is resolved inside the list its ladder deals, and the fallback tier is offered only while
    // the owner's own tier is empty. Pinning a bundled entry beside owner files therefore has to list
    // it — one entry, the one the owner acted on, exactly as §2.3 ③ allows.
    const rows = [disk("cut.webp"), bundled("lyra")];
    expect(makeEligible(undefined, rows, "b:lyra")).toEqual([
      { name: "cut.webp" }, // order untouched: the PIN is what this gesture means
      { bundled: "lyra" },
    ]);
  });

  it("…and switches a hidden entry back on, for the same reason", () => {
    const rows = [disk("cut.webp", { hidden: true }), disk("other.webp")];
    expect(makeEligible([{ name: "cut.webp", hidden: true }], rows, "f:cut.webp")).toEqual([
      { name: "cut.webp" },
      { name: "other.webp" },
    ]);
  });

  it("never sweeps the REST of the fallback tier in behind it", () => {
    const rows = [bundled("lyra"), bundled("pegasus"), bundled("atlas")];
    expect(makeEligible(undefined, rows, "b:lyra")).toEqual([{ bundled: "lyra" }]);
  });
});

describe("offersBundled — degrade vs resolved-empty (Emma's S2 review #2)", () => {
  it("is TRUE the moment the payload describes the tier, hidden rows included", () => {
    // The predicate every theme ladder's last rung hangs off. A bundled row the owner switched OFF is
    // still an ENTRY — restoring the shipped art for it would make the In-use switch a lie — while a
    // payload carrying no bundled row at all never described the tier and may still degrade.
    expect(offersBundled([disk("a.webp")])).toBe(false);
    expect(offersBundled([])).toBe(false);
    expect(offersBundled([disk("a.webp"), bundled("lyra", { hidden: true })])).toBe(true);
  });
});

describe("reorder edges", () => {
  const rows = [disk("a.webp"), disk("b.webp"), bundled("pegasus")];

  it("move-to-top is move-to-front; move-to-bottom is the BOTTOM", () => {
    expect(moveToEdge(undefined, rows, "f:b.webp", "top")).toEqual([
      { name: "b.webp" },
      { name: "a.webp" },
      { bundled: "pegasus" },
    ]);
    // AFTER pegasus, which is where the words say it goes. This used to stop one short — nothing could
    // be ordered after an untouched fallback row without listing it, and listing it was forbidden — so
    // "Move to bottom" quietly meant "move to second-from-bottom" in every section holding a default.
    expect(moveToEdge(undefined, rows, "f:a.webp", "bottom")).toEqual([
      { name: "b.webp" },
      { bundled: "pegasus" },
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

// ── the framing point (§2.2's rev-keying + §5) ──────────────────────────────────────────────────

describe("focalState — rev-keying, the three-valued predicate", () => {
  it("UNSET when there is none, however the wire spells it", () => {
    expect(focalState(disk("a.webp"))).toBe("unset");
    expect(focalState(disk("a.webp", { focal: null }))).toBe("unset");
    // A non-finite coordinate is not a point: a hand-edited config must not reach the math.
    expect(focalState(disk("a.webp", { focal: { x: Number.NaN, y: 0.2, rev: "1:100" } }))).toBe(
      "unset",
    );
  });

  it("SET only while the rev matches the row's own revision", () => {
    expect(focalState(disk("a.webp", { focal: { x: 0.4, y: 0.2, rev: "1:100" } }))).toBe("set");
  });

  it("STALE when the bytes moved under a stable name (Opus M2 — the R57 §9⑤ safety clause)", () => {
    // The ordinary repair is an SSH overwrite of `lyra.webp`. The URL cannot move for it, so nothing
    // else notices — and a point measured on the old picture describes a spot that is gone.
    expect(focalState(disk("a.webp", { focal: { x: 0.4, y: 0.2, rev: "2:200" } }))).toBe("stale");
    // An EMPTY rev matches no revision, which is what makes the field safely additive.
    expect(focalState(disk("a.webp", { focal: { x: 0.4, y: 0.2, rev: "" } }))).toBe("stale");
    // …and it stays stale even against a row the server could not `stat` (revision "").
    expect(focalState(bundled("pegasus", { focal: { x: 0.4, y: 0.2, rev: "" } }))).toBe("stale");
  });

  it("STALE reads as UNSET everywhere a surface asks — one fold, one place", () => {
    const stale = disk("a.webp", { focal: { x: 0.4, y: 0.2, rev: "2:200" } });
    expect(rowFocal(stale)).toBeUndefined();
    expect(artFocal(stale)).toBeUndefined();
    const live = disk("a.webp", {
      focal: { x: 0.4, y: 0.2, rev: "1:100" },
      width: 600,
      height: 300,
    });
    expect(rowFocal(live)).toEqual({ x: 0.4, y: 0.2 });
    // …and the paint-site form carries the mapping MODE and the source pixels the mapping needs.
    expect(artFocal(live)).toEqual({
      mode: "centred",
      point: { x: 0.4, y: 0.2 },
      width: 600,
      height: 300,
    });
  });

  it("carries a MISSING source size through as null rather than inventing one", () => {
    const live = disk("a.webp", {
      focal: { x: 0.4, y: 0.2, rev: "1:100" },
      width: null,
      height: null,
    });
    expect(artFocal(live)).toEqual({
      mode: "centred",
      point: { x: 0.4, y: 0.2 },
      width: null,
      height: null,
    });
  });
});

describe("setFocal — the framing write (§5)", () => {
  const rows = [disk("a.webp", { listed: true }), disk("b.webp"), bundled("pegasus")];

  it("writes the point on its own entry, keeps the order, and sweeps only the DISK tier", () => {
    const out = setFocal([{ name: "a.webp" }], rows, "f:a.webp", {
      x: 0.42,
      y: 0.18,
      rev: "1:100",
    });
    expect(out).toEqual([
      { name: "a.webp", focal: { x: 0.42, y: 0.18, rev: "1:100" } },
      { name: "b.webp" },
    ]);
  });

  it("CLEARS by removing the field, never by persisting a centre that means the same thing", () => {
    // R57 §5.5⑤: every product in the field treats {0.5, 0.5} as unset. A redundant default in a
    // config file the owner may open is noise, and `prune` is the house spelling for dropping it.
    const held: LibraryEntry[] = [{ name: "a.webp", focal: { x: 0.42, y: 0.18, rev: "1:100" } }];
    expect(setFocal(held, rows, "f:a.webp", null)).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
    ]);
  });

  it("leaves every OTHER per-item field on the entry (read-modify-write, never a rebuild)", () => {
    const held: LibraryEntry[] = [{ name: "a.webp", key: "vault", hidden: true }];
    expect(setFocal(held, rows, "f:a.webp", { x: 0.5, y: 0.1, rev: "1:100" })[0]).toEqual({
      name: "a.webp",
      key: "vault",
      hidden: true,
      focal: { x: 0.5, y: 0.1, rev: "1:100" },
    });
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
