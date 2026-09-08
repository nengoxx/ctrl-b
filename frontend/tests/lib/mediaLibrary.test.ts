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
  metaText,
  moveBy,
  moveToEdge,
  offersBundled,
  ownTier,
  defaultsRestorable,
  removeItem,
  restoreDefaults,
  rowId,
  rowFocal,
  setFocal,
  setHidden,
  toggleHidden,
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
//  · an ORDER intent — `moveBy` and `moveToEdge`, and so the drag — SWEEPS the whole section
//    into `files` in the resulting order, bundled rows included. It is the only shape that can SAY the
//    order: partial listing could not express a mid-list position at all, and listing only the rows of
//    a swap made those rows the owner's entire tier, shrinking the deal to two portraits;
//  · SWITCHING AN ENTRY OFF where order is the priority system sweeps too ("W7", owner 2026-08-26) —
//    and states the order UNCHANGED. Membership moves nothing: an unticked image dims where it is;
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
    expect(moveToEdge(entries, [disk("a.webp")], "f:a.webp", "top")).toEqual([{ name: "a.webp" }]);
  });
});

// THERE IS NO `setActive` AND NO `makeEligible` (owner ruling 2026-08-26, "W6" — order is the only
// priority system). "Use this one" is `moveToEdge(…, "top")`, an ordinary order intent with no
// membership side effect, and the arms for it live in the reorder-edges block below. What went with
// them:
//   · `setActive`'s un-hide. Activation used to guarantee eligibility in the same write (Emma's S2
//     review #1) because a hidden entry at the front is still skipped everywhere. Order and MEMBERSHIP
//     are separate systems now and the copy says so — "In use" means membership, "Active" means
//     painted — so moving an entry to the top of a list it is not in must not silently switch it on.
//   · `makeEligible`, the `files` half a POOL PIN needed. Every pool pin is gone; the two SEATS that
//     remain refuse a target their source ladder does not already deal rather than repairing the
//     source library from a read-only view of it (`hooks/useMediaLibrary.ts#pin`).

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

  it("a row GONE by send time refuses without sweeping — every order intent, one rule", () => {
    // A refusal states no new order, so it must not promote the fallback tier either: tier membership
    // decides what a later upload replaces, and a gesture that moved nothing may not change it.
    const refused = [{ name: "a.webp" }, { name: "b.webp" }];
    expect(moveBy(undefined, rows, "f:gone.webp", 1)).toEqual(refused);
    expect(moveToEdge(undefined, rows, "f:gone.webp", "top")).toEqual(refused);
    expect(moveToEdge(undefined, rows, "f:gone.webp", "bottom")).toEqual(refused);
  });

  it("MOVE TO TOP is activation, and it says nothing about membership ('W6')", () => {
    // What `setActive` used to be, minus its un-hide. The two systems are separate now: order decides
    // which entry is ACTIVE among the ones in use, and the In-use switch decides which are in use at
    // all. A move that quietly switched an entry back on would put the old two-priorities confusion
    // back in one gesture.
    const held: LibraryEntry[] = [{ name: "a.webp" }, { name: "c.webp", hidden: true, focal: {} }];
    const rowsOff = [disk("a.webp"), disk("c.webp", { hidden: true })];
    expect(moveToEdge(held, rowsOff, "f:c.webp", "top")).toEqual([
      { name: "c.webp", hidden: true, focal: {} },
      { name: "a.webp" },
    ]);
  });

  it("a BUNDLED entry can be moved to the top too — and the sweep lists the whole section", () => {
    // The order intent states the WHOLE section's order (§2.3 ③ as amended), so promoting one of the
    // shipped defaults writes all of them, that one first — never just the pick, which would make it
    // the owner's entire tier and retire the rest.
    const all = [bundled("pegasus"), bundled("atlas"), bundled("lyra")];
    expect(moveToEdge(undefined, all, "b:lyra", "top")).toEqual([
      { bundled: "lyra" },
      { bundled: "pegasus" },
      { bundled: "atlas" },
    ]);
  });
});

/** The server's `library-v1` collation of one write, expressed as ROWS — listed entries in order
 *  (carrying whatever `hidden` they were written with), then the rows nobody listed, in theirs. It is
 *  what lets a test ask the real question behind the owner-round defect: after this write, what does
 *  `ladderRows` DEAL? */
function collated(entries: readonly LibraryEntry[], rows: readonly ArtRow[]): ArtRow[] {
  const byId = new Map(rows.map((r) => [rowId(r), r]));
  const ids = entries.map((e) => entryId(e));
  return [
    ...entries.map((e, i) => ({
      ...(byId.get(ids[i] as RowId) as ArtRow),
      listed: true,
      hidden: e.hidden === true,
    })),
    // An UNLISTED row is never hidden: `hidden` is a `files` field, so a row no entry names carries
    // none — which is exactly what makes dropping an entry a restore rather than a silent retirement.
    ...rows
      .filter((r) => !ids.includes(rowId(r)))
      .map((r) => ({ ...r, listed: false, hidden: false })),
  ];
}

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

  it("the TOGGLE derives its target at send — two queued toggles COMPOSE (the W6 review's #2)", () => {
    // The failure this pins: both taps of a rapid double-tap read the same RENDERED state, so both
    // wrote the same absolute value and on→off→on landed off. The toggle asks the send-time rows.
    const first = toggleHidden(undefined, rows, "f:b.webp");
    expect(first).toEqual([{ name: "a.webp" }, { name: "b.webp", hidden: true }]);
    // The second toggle sees the FIRST one's outcome (the queue refetches between sends) and inverts
    // it again — net: back on, exactly what two taps mean.
    const rowsAfter = [disk("a.webp"), { ...disk("b.webp"), hidden: true }];
    expect(toggleHidden(first, rowsAfter, "f:b.webp")).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
    ]);
  });

  it("a toggle whose row is GONE by send time states no change — `moveBy`'s refusal shape", () => {
    expect(toggleHidden(undefined, rows, "f:gone.webp")).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
    ]);
  });
});

// ── UNTICKING MOVES NOTHING (owner ruling 2026-08-26, "W7") ─────────────────────────────────────
//
// The owner-round defect and the rule that replaced it. Switching a BUNDLED row off used to list that
// row and nothing else — and a listed entry precedes the WHOLE fallback tier, so the picture the owner
// had just excluded jumped to the front of the grid. Switching it back on then left a bare
// `{bundled: id}` behind: the section's sole own-tier member, which `ladderRows` dealt to every host
// while the other four defaults vanished. The ruling: **an unticked image dims where it stands and
// stays there**, and re-ticking it puts it back in use from the same place. Arranging is the drag's
// job; membership moves nothing.

describe("switching OFF where order is the priority system (`ordered`)", () => {
  /** The state every theme section is in on a fresh install: five bundled defaults, no `files`. */
  const cast = ["pegasus", "atlas", "3", "4", "lyra"].map((id) => bundled(id));

  it("SWEEPS the section and states the order UNCHANGED — the picture does not move", () => {
    const next = toggleHidden(undefined, cast, "b:3", true);
    expect(next).toEqual([
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { bundled: "3", hidden: true },
      { bundled: "4" },
      { bundled: "lyra" },
    ]);
    // The collation of that list is the order the owner was looking at, to the row — the third picture
    // is exactly where it was, and only its membership changed. (Listing it alone put it FIRST.)
    expect(collated(next, cast).map(rowId)).toEqual(displayOrder(cast));
    expect(ladderRows(collated(next, cast)).map(rowId)).toEqual([
      "b:pegasus",
      "b:atlas",
      "b:4",
      "b:lyra",
    ]);
  });

  it("…and the ROUND TRIP is a no-op: back in use, in place, dealt beside the rest", () => {
    const off = toggleHidden(undefined, cast, "b:3", true);
    const on = toggleHidden(off, collated(off, cast), "b:3", true);
    // Everything stays LISTED. The section was swept, so the entry is one member of a stated order and
    // dropping it would move the picture — which is why the bare-entry guard below asks whether the
    // role is fully listed rather than firing on the shape of the entry alone.
    expect(on).toEqual(cast.map((r) => ({ bundled: r.bundled })));
    expect(collated(on, cast).map(rowId)).toEqual(displayOrder(cast));
    // …and the whole cast is dealt again — five portraits, not the one the bare entry collapsed it to.
    expect(ladderRows(collated(on, cast)).map(rowId)).toEqual(displayOrder(cast));
  });

  it("a DISK row is the same rule — one entry off, the section's order restated as it stands", () => {
    const mixed = [disk("a.webp"), disk("b.webp"), ...cast];
    const next = toggleHidden(undefined, mixed, "f:a.webp", true);
    expect(next.map(entryId)).toEqual(displayOrder(mixed));
    expect(next[0]).toEqual({ name: "a.webp", hidden: true });
  });

  it("a section where ORDER decides nothing keeps the minimal write", () => {
    // A named role's per-key gallery (`caps.reorder` false — a service icon, one frontier stack layer):
    // its files bind by NAME, so a sweep would list other keys' bundled rows for no reason at all. The
    // switch there says only what it did, which is what it has always said.
    expect(toggleHidden(undefined, cast, "b:3")).toEqual([{ bundled: "3", hidden: true }]);
  });
});

describe("the bare-entry guard (un-hiding must never enlist a default)", () => {
  const cast = ["pegasus", "atlas", "3", "4", "lyra"].map((id) => bundled(id));

  it("DROPS an entry left saying nothing, in a role that was never swept", () => {
    // The hole a hand-edited or legacy config can still be in — and the one the non-sweep path leaves:
    // one hidden bundled entry beside four unlisted siblings. Clearing `hidden` would leave
    // `{bundled: "3"}`, the sole own-tier member, and the fleet would be dealt that one portrait.
    const rows = cast.map((r) => (r.bundled === "3" ? { ...r, listed: true, hidden: true } : r));
    const next = setHidden([{ bundled: "3", hidden: true }], rows, "b:3", false);
    expect(next).toEqual([]);
    // …so the row rejoins the fallback tier at its REGISTRY position and the deal is the whole cast.
    expect(ladderRows(collated(next, rows)).map(rowId)).toEqual(displayOrder(cast));
  });

  it("…but keeps one that still carries something of the owner's", () => {
    // Not bare = not the guard's business. Every transform here is a read-modify-WRITE, so a field this
    // module does not interpret (whatever a later slice adds) is never dropped to tidy up a tier.
    const rows = cast.map((r) => (r.bundled === "3" ? { ...r, listed: true, hidden: true } : r));
    const held: LibraryEntry[] = [
      { bundled: "3", hidden: true, focal: { x: 0.4, y: 0.2, rev: "" } },
    ];
    expect(setHidden(held, rows, "b:3", false)).toEqual([
      { bundled: "3", focal: { x: 0.4, y: 0.2, rev: "" } },
    ]);
  });

  it("…and keeps a bare one in a SWEPT role, where dropping it would MOVE the picture", () => {
    const swept = cast.map((r) => ({ ...r, listed: true, hidden: r.bundled === "3" }));
    const held: LibraryEntry[] = cast.map((r) =>
      r.bundled === "3" ? { bundled: "3", hidden: true } : { bundled: r.bundled as string },
    );
    expect(setHidden(held, swept, "b:3", false)).toEqual(
      cast.map((r) => ({ bundled: r.bundled as string })),
    );
  });

  it("never touches a DISK entry — its listing is what holds its position", () => {
    const rows = [disk("a.webp", { listed: true, hidden: true }), ...cast];
    expect(setHidden([{ name: "a.webp", hidden: true }], rows, "f:a.webp", false)).toEqual([
      { name: "a.webp" },
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

describe("restore defaults (the S6 affordance, on the owner ruling of 2026-08-26)", () => {
  // The ruling, in the owner's words: *"put them first and activate them and you deactivate the other
  // ones — as if the defaults are the one selected, and I just uploaded the other images that are
  // there."* So it is an ORDER intent: the shipped art goes to the top, in the REGISTRY's order and in
  // use, and the owner's own files stay in the library below it, switched off. It used to DROP the
  // bundled entries back to the fallback tier — a mechanism that could not express this at all, since
  // one owner file outranks that whole tier and would have gone on painting.
  const swept = [
    disk("mine.webp", { listed: true }),
    bundled("pegasus", { listed: true }),
    bundled("atlas", { listed: true, hidden: true }),
  ];
  const entries: LibraryEntry[] = [
    { name: "mine.webp", focal: { x: 0.4, y: 0.2, rev: "r9" }, key: "hero" },
    { bundled: "pegasus" },
    { bundled: "atlas", hidden: true },
  ];
  /** The registry's own id order for the role — what only the caller knows (`MediaRoleDef.bundled`). */
  const SHIPPED = ["b:pegasus", "b:atlas"];

  it("is OFFERED wherever the section is showing something other than its defaults", () => {
    // A section still exactly as it came carries no control at all — there is nothing to put back.
    expect(defaultsRestorable([bundled("pegasus"), bundled("atlas")])).toBe(false);
    // …a listed bundled entry (an order write swept the section) and a hidden one both qualify…
    expect(defaultsRestorable([bundled("pegasus", { listed: true })])).toBe(true);
    expect(defaultsRestorable([bundled("pegasus", { hidden: true })])).toBe(true);
    // …and so does one of the owner's OWN files being in use, which is the arm the ruling adds: the
    // restore would switch it off, so there is a difference to put back.
    expect(defaultsRestorable([disk("a.webp"), bundled("pegasus")])).toBe(true);
    // It is a DIFFERENCE test rather than an equality one, so a section that already looks restored
    // still offers the control (its own file is switched off, which is the `hidden` arm) — a spurious
    // button that writes what is already there costs nothing, and a missing one would strand the owner.
    expect(defaultsRestorable([disk("a.webp", { hidden: true }), bundled("pegasus")])).toBe(true);
  });

  it("puts the defaults FIRST in the registry's order, in use, and switches the owner's files off", () => {
    expect(restoreDefaults(entries, swept, SHIPPED)).toEqual([
      // The registry's order, not the one the owner dragged them into — and `atlas` loses the `hidden`
      // it was switched off with.
      { bundled: "pegasus" },
      { bundled: "atlas" },
      // The owner's own file: still here, still framed, still keyed — a library member that is simply
      // not in use, exactly as it would be if it had been uploaded into a section showing its defaults.
      { name: "mine.webp", focal: { x: 0.4, y: 0.2, rev: "r9" }, key: "hero", hidden: true },
    ]);
  });

  it("keeps the owner's own files whole and in their own relative order, below the defaults", () => {
    const rows = [
      disk("b.webp", { listed: true }),
      disk("a.webp", { listed: true, hidden: true }),
      bundled("pegasus"),
    ];
    const held: LibraryEntry[] = [
      { name: "b.webp", focal: { x: 0.1, y: 0.9, rev: "r1" } },
      { name: "a.webp", hidden: true, key: "jellyfin" },
    ];
    expect(restoreDefaults(held, rows, SHIPPED)).toEqual([
      { bundled: "pegasus" }, // the only default this library holds, lifted out of the fallback tier
      { name: "b.webp", focal: { x: 0.1, y: 0.9, rev: "r1" }, hidden: true }, // `b` was first, still is
      { name: "a.webp", key: "jellyfin", hidden: true },
    ]);
  });

  it("SCOPES to the rows it was offered for — a key gallery restores its own layer", () => {
    // The frontier stack is three destinations under one role, so restoring `cube` must leave the
    // other layers exactly as the owner arranged them — neither reordered nor switched off.
    const rows = [
      disk("cube.webp", { listed: true }),
      bundled("cube", { listed: true, hidden: true }),
      bundled("platform-mid", { listed: true }),
    ];
    const held: LibraryEntry[] = [
      { name: "cube.webp" },
      { bundled: "cube", hidden: true },
      { bundled: "platform-mid" },
    ];
    expect(
      restoreDefaults(held, rows, ["b:cube", "b:platform-mid"], new Set(["b:cube", "f:cube.webp"])),
    ).toEqual([
      { bundled: "cube" },
      { name: "cube.webp", hidden: true },
      { bundled: "platform-mid" },
    ]);
  });

  it("a SCOPED restore does not SWEEP — the other layers keep their TIER, not just their order", () => {
    // Both confirm lenses landed on this independently. The sweep is what makes a stated order the
    // whole SECTION's, and a scoped restore speaks for one key's layer — so sweeping listed every
    // OTHER key's bundled row into the owner's own tier as a side effect. Tier membership is what
    // decides what a later upload replaces, so restoring `cube` quietly re-tiered the two platform
    // layers: a subsequent drop into `stack/` would have found them already in the owner's tier and
    // composited over them instead of replacing the fallback.
    //
    // Here the two out-of-scope defaults are UNLISTED (the ordinary state of a role nobody has
    // arranged), which is exactly the case the all-listed arm above cannot see.
    const rows = [
      disk("cube.webp", { listed: true }),
      bundled("cube", { listed: true, hidden: true }),
      bundled("platform-mid"),
      bundled("platform-base"),
    ];
    const held: LibraryEntry[] = [{ name: "cube.webp" }, { bundled: "cube", hidden: true }];
    expect(
      restoreDefaults(
        held,
        rows,
        ["b:cube", "b:platform-mid", "b:platform-base"],
        new Set(["b:cube", "f:cube.webp"]),
      ),
    ).toEqual([
      // The covered default is LISTED — `touched` is what does that now, and it is precisely what
      // `touched` is for: the ids this write explicitly acted on.
      { bundled: "cube" },
      { name: "cube.webp", hidden: true },
      // …and nothing else. `platform-mid`/`platform-base` stay in the fallback tier, at their registry
      // positions, untouched by a restore that was never about them.
    ]);
  });

  it("…while the UNSCOPED restore still sweeps — there the order IS the whole section's", () => {
    // The other half of the same rule, so the fix cannot silently disarm the pool restore: with no
    // scope, every bundled row is the write's business and the stated order speaks for all of them.
    const rows = [disk("mine.webp", { listed: true }), bundled("pegasus"), bundled("atlas")];
    expect(restoreDefaults([{ name: "mine.webp" }], rows, SHIPPED)).toEqual([
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { name: "mine.webp", hidden: true },
    ]);
  });

  it("…and what it writes SURVIVES the round trip: re-ticking an own file moves nothing", () => {
    // The state the restore leaves behind is an ordinary swept section, so the W7 rule applies to it
    // unchanged: membership never moves a picture. Re-ticking `mine` puts it back in use where it
    // stands — under the defaults — and switching a default off leaves the order alone too.
    const after = [
      bundled("pegasus", { listed: true }),
      bundled("atlas", { listed: true }),
      disk("mine.webp", { listed: true, hidden: true }),
    ];
    const held: LibraryEntry[] = [
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { name: "mine.webp", hidden: true },
    ];
    expect(toggleHidden(held, after, "f:mine.webp", true)).toEqual([
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { name: "mine.webp" },
    ]);
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
  });

  it("a BUNDLED row is keyed to NOTHING, so a point on one is live ('W10')", () => {
    // Rev-keying exists because owner media changes under a stable name. A bundled entry's bytes are
    // content-hashed by the build and cannot change under a running app — the server sends no
    // revision for one at all — so there is nothing for a point to go stale against. Without this the
    // whole affordance was dead on arrival: every point written on a default would read `stale`
    // immediately and the shipped crop would come straight back.
    expect(focalState(bundled("pegasus", { focal: { x: 0.4, y: 0.2, rev: "" } }))).toBe("set");
    expect(rowFocal(bundled("pegasus", { focal: { x: 0.4, y: 0.2, rev: "" } }))).toEqual({
      x: 0.4,
      y: 0.2,
    });
    // …and the three-valued predicate keeps its first rung: no point is still no point.
    expect(focalState(bundled("pegasus"))).toBe("unset");
    expect(focalState(bundled("pegasus", { focal: { x: Number.NaN, y: 0.2, rev: "" } }))).toBe(
      "unset",
    );
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

  it("carries the ZOOM out with the point, and drops both together when it goes stale (wave 3)", () => {
    // `z` is part of the framing, never a setting beside it: one object in, one object out, and a
    // point that no longer describes these bytes takes its zoom down with it.
    const zoomed = disk("a.webp", {
      focal: { x: 0.4, y: 0.2, rev: "1:100", z: 2.5 },
      width: 600,
      height: 300,
    });
    expect(rowFocal(zoomed)).toEqual({ x: 0.4, y: 0.2, z: 2.5 });
    expect(artFocal(zoomed)).toEqual({
      mode: "centred",
      point: { x: 0.4, y: 0.2 },
      width: 600,
      height: 300,
      zoom: 2.5,
    });
    expect(rowFocal({ ...zoomed, revision: "2:200" })).toBeUndefined();
    // The wire's two spellings of "no zoom" fold to the one an edit may produce — absent.
    expect(rowFocal(disk("a.webp", { focal: { x: 0.4, y: 0.2, rev: "1:100", z: null } }))).toEqual({
      x: 0.4,
      y: 0.2,
    });
    expect(
      Object.keys(rowFocal(disk("a.webp", { focal: { x: 0.4, y: 0.2, rev: "1:100" } }))!),
    ).toEqual(["x", "y"]);
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

  it("carries the zoom into the entry as part of the one focal object", () => {
    expect(
      setFocal([{ name: "a.webp" }], rows, "f:a.webp", {
        x: 0.42,
        y: 0.18,
        z: 2,
        rev: "1:100",
      })[0],
    ).toEqual({ name: "a.webp", focal: { x: 0.42, y: 0.18, z: 2, rev: "1:100" } });
  });

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

  it("frames a BUNDLED id ('W10') — the entry it needs is LISTED, and only it", () => {
    // The tier rule's `touched` arm carries it: a bundled row a write acted on may be listed, and this
    // write acted on exactly one. The whole disk tier rides along as it does for every focal write
    // (listing one entry into an empty list would move it to the front of the collation), and the
    // OTHER bundled rows stay in the fallback tier where a framing write has no business moving them.
    //
    // `rev: ""` is not an oversight: a bundled row has no revision, and `focalState` reads a point on
    // one as live precisely because build-hashed bytes cannot change under a running app.
    const out = setFocal([{ name: "a.webp" }], rows, "b:pegasus", { x: 0.5, y: 0.12, rev: "" });
    expect(out).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
      { bundled: "pegasus", focal: { x: 0.5, y: 0.12, rev: "" } },
    ]);
    // …and clearing it drops the field, leaving the bare listing the sweep would have written anyway.
    expect(setFocal(out, rows, "b:pegasus", null)).toEqual([
      { name: "a.webp" },
      { name: "b.webp" },
      { bundled: "pegasus" },
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
