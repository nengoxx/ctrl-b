import { describe, expect, it } from "vitest";

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { proportionalFocal } from "../../src/lib/focalPosition";
import { MEDIA_NS } from "../../src/theme-engine/mediaRegistry";
import { ART } from "../../src/themes/gacha/art";
import {
  activePool,
  artForHost,
  assignArt,
  defaultRoster,
  entryForHost,
  heroArt,
  oracleArt,
  reelFigureArt,
  rosterFromIndex,
  slotEntry,
  wallpaperArt,
  wideArtForHost,
  type Roster,
  type RosterEntry,
} from "../../src/themes/gacha/roster";

// The roster resolver (D52 / GACHA_PLAN §5.2 / §5.3) — the ONE shared assignment every gacha consumer goes
// through (cards, promo slides, dossier, reel figure). These cases are the §7 acceptance-matrix rows the
// resolver owns: 0 / 1 / many hosts · hosts > roster (ordered cycling) · roster > hosts · a `slots` pin to a
// missing entry. Pure functions, so no render, no store, no queries.
//
// ── D53 M1b · the PARITY ARMS (MEDIA_PLAN §9). The resolver now composes `lib/media.ts` (`orderedUsable`,
//    `cycleAt`/`cycleAssign`, `firstUsable`) instead of owning those rules itself, and the obligation on that
//    lift is that nothing changed. The four named arms, each pinned below UNMODIFIED through the refactor:
//      ① scenes — "banner/ becomes the SCENE slides" + the broken-scene case (`orderedUsable`);
//      ② unusable-position deal stability — "unusable entries hold their position" (`cycleAt`, the whole
//        list dealt: one broken file must not re-deal the fleet);
//      ③ oracle fallback — "slots — pins, and what happens when a pin dangles" + the pin-outranks-folder
//        case (`firstUsable` as the ladder's middle rung). The wallpaper half of this arm was RETIRED at
//        G6.3 with the gacha `wallpaper/` role itself (owner ruling — one shared background home); the
//        backdrop's own ladder is pinned in its describe at the bottom of this file;
//      ④ reel bundled replacement — "reel/ outranks the bundled cutout" + the legacy-pin cases
//        (`firstUsable` with its pin).

function entry(name: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return { name, image: `${name}.webp`, ...extra };
}

/** A roster with NO owner media (G5) — the state a fresh install is in and the state every ladder below
 *  must degrade to. The owner-supplied cases pass `over`.
 *
 *  The ORACLE pool carries the bundled backdrop, because since S6 that is what "no owner media" means
 *  for this role: the shipped picture is an ordinary pool member reached through the fallback tier, not
 *  a hard-coded rung inside `oracleArt` (which would have outranked the In-use switch). An EMPTY oracle
 *  pool is a different state entirely — the owner switched it off — and the surface paints nothing.
 *  `reel` stays empty: its own bundled cutout is supplied by the arms that are about it. */
function roster(
  entries: RosterEntry[],
  slots: Roster["slots"] = {},
  over: Partial<Pick<Roster, "scenes" | "pools">> = {},
): Roster {
  return {
    entries,
    slots,
    scenes: [],
    pools: { reel: [], oracle: defaultRoster().pools.oracle },
    ...over,
  };
}

describe("entryForHost / artForHost — positional assignment over the display order", () => {
  it("0 hosts → nothing to assign", () => {
    expect(assignArt(roster([entry("a")]), 0)).toEqual([]);
  });

  it("1 host → the FIRST entry (the order IS the assignment)", () => {
    const r = roster([entry("a"), entry("b")]);
    expect(entryForHost(r, 0)?.name).toBe("a");
    expect(artForHost(r, 0)).toEqual({ url: "a.webp" });
  });

  it("many hosts, roster > hosts → each host gets its own entry; the spares just sit unused", () => {
    const r = roster([entry("a"), entry("b"), entry("c"), entry("d")]);
    expect(assignArt(r, 2).map((x) => x?.url)).toEqual(["a.webp", "b.webp"]);
    expect(r.entries).toHaveLength(4); // untouched — extras stay available in the gallery
  });

  it("hosts > roster → ORDERED CYCLING (i mod N), never the placeholder", () => {
    const r = roster([entry("a"), entry("b")]);
    expect(assignArt(r, 5).map((x) => x?.url)).toEqual([
      "a.webp",
      "b.webp",
      "a.webp",
      "b.webp",
      "a.webp",
    ]);
    expect(assignArt(r, 5).every((x) => x !== null)).toBe(true);
  });

  it("an EMPTY roster is the one case that yields the placeholder", () => {
    const r = roster([]);
    expect(entryForHost(r, 0)).toBeNull();
    expect(artForHost(r, 0)).toBeNull();
    expect(assignArt(r, 3)).toEqual([null, null, null]);
  });

  it("carries the entry's focal point through, and omits it when absent", () => {
    const r = roster([entry("a", { focus: proportionalFocal("50% 30%") }), entry("b")]);
    expect(artForHost(r, 0)).toEqual({ url: "a.webp", focus: proportionalFocal("50% 30%") });
    expect(artForHost(r, 1)).toEqual({ url: "b.webp" });
  });

  it("treats a nonsense index as unassigned rather than throwing (it is on a render path)", () => {
    const r = roster([entry("a")]);
    expect(entryForHost(r, -1)).toBeNull();
    expect(entryForHost(r, 1.5)).toBeNull();
  });
});

// ── UNUSABLE entries (Codex G0 #2) — the case the schema could not express before ──────────────────────
// The roster's ORDER is the host assignment, so an entry whose file is broken must keep its slot in the
// list. Dropping it would re-deal every host after it: one bad upload and half the fleet silently changes
// character. It is flagged instead, and only its own position falls back to the placeholder.
describe("unusable entries hold their position", () => {
  it("a MIDDLE entry going bad does not shift the hosts after it", () => {
    const good = roster([entry("a"), entry("b"), entry("c"), entry("d")]);
    const broken = roster([entry("a"), entry("b", { unusable: true }), entry("c"), entry("d")]);

    expect(assignArt(good, 4).map((x) => x?.url)).toEqual(["a.webp", "b.webp", "c.webp", "d.webp"]);
    // Only host 1 loses its art; 2 and 3 keep exactly the characters they had.
    expect(assignArt(broken, 4).map((x) => x?.url ?? null)).toEqual([
      "a.webp",
      null,
      "c.webp",
      "d.webp",
    ]);
    // …and the entry itself is still in the list, still at index 1 (the gallery can warn about it).
    expect(entryForHost(broken, 1)?.name).toBe("b");
  });

  it("keeps the CYCLE length intact, so the wrap-around lands on the same entries", () => {
    const r = roster([entry("a"), entry("b", { unusable: true }), entry("c")]);
    expect(assignArt(r, 6).map((x) => x?.url ?? null)).toEqual([
      "a.webp",
      null,
      "c.webp",
      "a.webp",
      null,
      "c.webp",
    ]);
  });

  it("an unusable entry cannot serve a slot — the slot falls back instead", () => {
    const r = roster([entry("a", { wide: "a-wide.webp", unusable: true }), entry("b")], {
      wallpaper: "a",
      oracle: "a",
    });
    expect(slotEntry(r, "wallpaper")?.name).toBe("a"); // it is still FOUND…
    expect(wallpaperArt(r)).toEqual({ url: ART.banner }); // …but not painted
    expect(oracleArt(r)).toMatchObject({ url: ART.oracle });
  });

  it("an unusable cutout never reaches the reel POOL, so it is never the figure", () => {
    // The pool is where the figure is chosen from (Codex F4), and `pool()` drops unusable files on the
    // way in — a first-wins pool has nothing to gain from holding a member that cannot paint.
    const r = rosterFromIndex(index({ reel: [file("bad", { unusable: true }), file("good")] }, {}));
    expect(reelFigureArt(r)).toMatchObject({ url: painted("good") });
  });
});

// ── The per-host WIDE accessor (G1) — the banner's promo slides ───────────────────────────────────────
// The promo slide and the capsule card are the SAME host and must therefore be the SAME character: §5.3's
// one-resolver ruling exists precisely because a card showing Pegasus beside a promo showing Atlas reads as
// a bug. Only the CROP differs, so these cases pin the agreement, not just the fallback ladder.
describe("wideArtForHost — the promo crop of the SAME assignment", () => {
  it("agrees with artForHost on the entry, at every index including the cycle wrap", () => {
    const r = roster([entry("a", { wide: "a-wide.webp" }), entry("b")]);
    for (const i of [0, 1, 2, 3, 7]) {
      const card = entryForHost(r, i)!;
      const promo = wideArtForHost(r, i)!;
      // same entry → either its own wide variant or its own image, never the neighbour's
      expect([card.wide, card.image]).toContain(promo.url);
    }
  });

  it("prefers the entry's WIDE variant", () => {
    const r = roster([entry("a", { wide: "a-wide.webp" })]);
    expect(wideArtForHost(r, 0)).toEqual({ url: "a-wide.webp" });
  });

  it("falls back to the entry's image + its focal crop — never a hole (§5.2)", () => {
    const r = roster([entry("a", { focus: proportionalFocal("50% 12%") })]);
    expect(wideArtForHost(r, 0)).toEqual({ url: "a.webp", focus: proportionalFocal("50% 12%") });
  });

  it("carries the focus through the wide variant too", () => {
    const r = roster([entry("a", { wide: "a-wide.webp", focus: proportionalFocal("20% 80%") })]);
    expect(wideArtForHost(r, 0)).toEqual({
      url: "a-wide.webp",
      focus: proportionalFocal("20% 80%"),
    });
  });

  it("yields the placeholder on the same terms as the card art: empty roster, unusable entry, bad index", () => {
    expect(wideArtForHost(roster([]), 0)).toBeNull();
    expect(wideArtForHost(roster([entry("a", { unusable: true })]), 0)).toBeNull();
    expect(wideArtForHost(roster([entry("a")]), -1)).toBeNull();
  });
});

describe("slots — pins, and what happens when a pin dangles", () => {
  it("resolves a pin to its entry", () => {
    const r = roster([entry("a"), entry("b", { wide: "b-wide.webp" })], { wallpaper: "b" });
    expect(slotEntry(r, "wallpaper")?.name).toBe("b");
    expect(wallpaperArt(r)).toEqual({ url: "b-wide.webp" });
  });

  it("a wide-consuming slot on an entry WITHOUT a wide variant falls back to its image — never a hole", () => {
    const r = roster([entry("a", { focus: proportionalFocal("50% 10%") })], { wallpaper: "a" });
    expect(wallpaperArt(r)).toEqual({ url: "a.webp", focus: proportionalFocal("50% 10%") });
  });

  it("a pin naming a MISSING entry (deleted/renamed) degrades to the default — never crashes", () => {
    const r = roster([entry("a")], { wallpaper: "ghost", oracle: "ghost", hero: "ghost" });
    expect(slotEntry(r, "wallpaper")).toBeUndefined();
    expect(wallpaperArt(r)).toEqual({ url: ART.banner }); // the bundled scene art
    expect(oracleArt(r)).toMatchObject({ url: ART.oracle });
    expect(heroArt(r)).toEqual({ url: ART.banner }); // hero → wallpaper → the default
  });

  it("an unpinned hero follows the WALLPAPER pick (§5.2's stated default)", () => {
    const r = roster([entry("a", { wide: "a-wide.webp" })], { wallpaper: "a" });
    expect(heroArt(r)).toEqual({ url: "a-wide.webp" });
  });
});

describe("reelFigureArt — the figure is chosen from the REEL POOL alone", () => {
  it("no cutout anywhere → no figure (the slats must carry the reel alone)", () => {
    // A roster with an empty reel pool is the degenerate case the reel was designed to survive: the
    // synthetic helper below builds one, which the BUNDLED roster never is (its pool is derived).
    expect(reelFigureArt(roster([entry("a"), entry("b")]))).toBeNull();
    expect(reelFigureArt(roster([]))).toBeNull();
  });

  it("an entry's `cutout` field feeds the BUNDLED pool — it is not a second resolution path", () => {
    // The field is the schema's one source for the bundled option; the resolver reads the pool only.
    const withCutouts = defaultRoster().entries.filter((e) => e.cutout !== undefined);
    expect(defaultRoster().pools.reel.map((a) => a.url)).toEqual(withCutouts.map((e) => e.cutout));
    // …and a hand-built roster whose entries carry cutouts but whose pool is empty resolves to nothing,
    // which is what "one resolution path" means.
    expect(reelFigureArt(roster([entry("a", { cutout: "a-cut.webp" })]))).toBeNull();
  });
});

describe("defaultRoster — the bundled fallback set (§5.5)", () => {
  const r = defaultRoster();

  it("is the dealt set the owner picked at the G1 eyeball, plus the two tail entries", () => {
    // `3`/`4` sit at display positions 2/3 — vault and g5 on the owner's fleet (round-3 swap); `lyra`
    // trails so the reel figure's cutout default survives without her being dealt to a four-host fleet,
    // and `rook` trails her (S6: the file always shipped, and no role had ever named it — so it was in
    // no gallery). Positions 0-3 are unchanged, which is the whole of the paint-parity claim here.
    expect(r.entries.map((e) => e.name)).toEqual(["pegasus", "atlas", "3", "4", "lyra", "rook"]);
    expect(r.entries.every((e) => e.image.length > 0)).toBe(true);
  });

  it("ships NO pins — the fallbacks are the intended defaults, not a second place to change them", () => {
    expect(r.slots).toEqual({});
  });

  it("resolves every slot without configuration: scene art for the wide slots, lyra for the figure", () => {
    expect(wallpaperArt(r)).toEqual({ url: ART.banner });
    expect(heroArt(r)).toEqual({ url: ART.banner });
    expect(oracleArt(r)).toMatchObject({ url: ART.oracle });
    expect(reelFigureArt(r)).toMatchObject({ url: ART.cutout });
  });

  it("keeps the SCENE art out of the per-host cycle (the frontier partition rule)", () => {
    // Every host, however many, gets a CHARACTER — never the banner, the oracle backdrop, or one of the
    // owner's banner SCENE drops (which ride the carousel as their own slides, G1 eyeball round 3).
    const dealt = assignArt(r, 12).map((a) => a!.url);
    expect(dealt).not.toContain(ART.banner);
    expect(dealt).not.toContain(ART.oracle);
    for (const scene of ART.scenes) expect(dealt).not.toContain(scene.url);
    expect(new Set(dealt)).toEqual(new Set(ART.characters));
  });
});

// ── G5 · rosterFromIndex — the OWNER's media folders (§5.4). The adapter is the only thing between the
//    index endpoint and the resolver above, so what it must get right is: which role feeds which
//    consumer, that a role the owner left empty falls back to the BUNDLED set (a fresh install is
//    byte-identical to G1–G4), and the two different treatments of an unusable file. ──

const file = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.webp`,
  url: `/api/media/gacha/files/x/${name}.webp`,
  format: "webp",
  size_bytes: 1000,
  width: 640,
  height: 854,
  revision: "1:1000",
  unusable: false,
  unusable_reason: null,
  ...over,
});

/** The URL that file is PAINTED at (D65 defect #1): a ladder hands its consumer a ready-to-paint url,
 *  so an owner file carries its `?rev=` and a replace-in-place cannot keep showing the old bytes. */
const painted = (name: string, over: Partial<MediaFile> = {}) => {
  const f = file(name, over);
  return `${f.url}?rev=${encodeURIComponent(f.revision)}`;
};

const index = (
  roles: Record<string, MediaFile[]>,
  slots: Record<string, string> = {},
): MediaIndex => ({
  ns: "gacha",
  collation: "library-v1",
  roles,
  slots,
});

describe("rosterFromIndex — the owner's media folders drive the roster (§5.4)", () => {
  it("no index yet (first paint, or a backend hiccup) → the bundled set, so art never waits on a query", () => {
    expect(rosterFromIndex(undefined)).toEqual(defaultRoster());
  });

  it("an index with nothing in it is ALSO the bundled set — every role falls back on its own", () => {
    const r = rosterFromIndex(index({ characters: [], banner: [], reel: [], oracle: [] }));
    expect(r.entries).toEqual(defaultRoster().entries);
    expect(r.scenes).toEqual(defaultRoster().scenes);
    expect(wallpaperArt(r)).toEqual({ url: ART.banner });
    expect(oracleArt(r)).toMatchObject({ url: ART.oracle });
    expect(reelFigureArt(r)).toMatchObject({ url: ART.cutout });
  });

  // ── the §2.4 resolvers over the wire's BUNDLED tier (D65). The index carries every role's bundled
  //    ids now, and `castRows`/`sceneRows`/`poolRows` are the ONE rule the gallery reads too — so what
  //    these arms pin is that the ladder's shipped semantics survived the move.
  const bundled = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
    ...file(name),
    bundled: name,
    name,
    file: "",
    url: "",
    revision: "",
    ...over,
  });
  /** What the server actually sends for `characters/` on a fresh install: the fallback tier, whole. */
  const castTier = ["pegasus", "atlas", "3", "4", "lyra", "rook"].map((id) => bundled(id));

  it("the FALLBACK TIER is what a fresh install deals — byte-identical to the bundled roster", () => {
    // Paint parity by construction (§2.4): the registry derives its ids FROM `defaultRoster()`, so
    // dealing the fallback tier and dealing the bundled set are the same list — mapped back through
    // `toEntry`, hand-tuned focal points and the cutout included.
    const r = rosterFromIndex(index({ characters: castTier, reel: [bundled("lyra")] }));
    expect(r.entries).toEqual(defaultRoster().entries);
    expect(r.pools.reel).toEqual(defaultRoster().pools.reel);
    expect(reelFigureArt(r)).toMatchObject({ url: ART.cutout });
  });

  // ── the ORACLE backdrop as a LIBRARY ENTRY (S6) ────────────────────────────────────────────────
  //
  // It used to live on `oracleArt`'s last rung as a bare URL no id addressed, so the one picture that
  // role paints was in no gallery: unreachable, unorderable, unretirable. It is a pool member now.

  it("the bundled BACKDROP resolves through the pool, and an owner drop still outranks it", () => {
    const shipped = rosterFromIndex(index({ oracle: [bundled("oracle")] }));
    expect(oracleArt(shipped)).toMatchObject({ url: ART.oracle });
    const dropped = rosterFromIndex(index({ oracle: [file("night"), bundled("oracle")] }));
    expect(oracleArt(dropped)).toMatchObject({ url: painted("night") });
  });

  it("switching the backdrop OFF paints none — and a STUB payload still gets the shipped one", () => {
    // The pair `offersBundled` exists for. A hidden bundled row is the owner's own answer, and a
    // hard-coded rung inside `oracleArt` would have outranked it — the operator block would keep
    // painting art the gallery said was retired. A payload that never described the tier still
    // degrades to the shipped picture, which is what keeps a stub from painting a hole.
    expect(
      oracleArt(rosterFromIndex(index({ oracle: [bundled("oracle", { hidden: true })] }))),
    ).toBe(null);
    expect(oracleArt(rosterFromIndex(index({ oracle: [] })))).toMatchObject({ url: ART.oracle });
  });

  it("one owner file DEMOTES the whole fallback tier — the shipped 'drop one in' semantics", () => {
    const r = rosterFromIndex(index({ characters: [file("kira"), ...castTier] }));
    expect(r.entries.map((e) => e.name)).toEqual(["kira"]);
  });

  it("…unless the owner LISTED one, which mixes it into the deal at the priority they gave it", () => {
    // `listed` is the whole difference between the two tiers, and it is on the wire precisely so this
    // is decidable without reading config.
    const r = rosterFromIndex(
      index({ characters: [bundled("lyra", { listed: true }), file("kira"), ...castTier] }),
    );
    expect(r.entries.map((e) => e.name)).toEqual(["lyra", "kira"]);
    // …and the listed bundled entry keeps its own art, not a hole (the server sends no url for it).
    expect(r.entries[0].image).toBe(defaultRoster().entries[4].image);
  });

  it("a HIDDEN entry leaves the deal entirely — the OPPOSITE treatment from `unusable` (§2.2)", () => {
    const r = rosterFromIndex(
      index({ characters: [file("kira", { hidden: true }), file("nova")] }),
    );
    expect(r.entries.map((e) => e.name)).toEqual(["nova"]); // filtered OUT, the fleet re-deals
    const broken = rosterFromIndex(
      index({ characters: [file("kira", { unusable: true }), file("nova")] }),
    );
    expect(broken.entries.map((e) => e.name)).toEqual(["kira", "nova"]); // HOLDS its position
  });

  it("hiding the LAST owner file falls the role back to its bundled art rather than blanking it", () => {
    const r = rosterFromIndex(index({ characters: [file("kira", { hidden: true }), ...castTier] }));
    expect(r.entries).toEqual(defaultRoster().entries);
  });

  it("…but hiding the BUNDLED tier TOO leaves the role EMPTY — the switch means what it says", () => {
    // Emma's S2 review #2. The render-side fallback used to read "resolved to nothing" as "this must be
    // a stub payload" and restore the shipped cast — so the gallery said "nothing in use" while the
    // fleet kept dealing exactly the art the owner had just retired.
    const off = castTier.map((b) => ({ ...b, hidden: true }));
    const r = rosterFromIndex(index({ characters: off, banner: [], reel: [] }));
    expect(r.entries).toEqual([]);
    // …and the same for the two other roles that ship art, each on its own row.
    const scenes = rosterFromIndex(
      index({ banner: [bundled("b2", { hidden: true }), bundled("b3", { hidden: true })] }),
    );
    expect(scenes.scenes).toEqual([]);
    const reel = rosterFromIndex(index({ reel: [bundled("lyra", { hidden: true })] }));
    expect(reelFigureArt(reel)).toBeNull();
  });

  it("a PIN can only name what the ladder deals — which is why the pin write LISTS its entry", () => {
    // Emma's S2 review #1 ②, at the resolver. With an owner cutout present the ladder never offers the
    // fallback tier, so a pin naming a bundled id resolves to nothing and the pool's own first pick
    // keeps painting — the card claiming one picture while the transition shows another.
    const owner = file("cut");
    const lyra = bundled("lyra");
    const pin = { reel_figure: "lyra" };
    expect(activePool("reel_figure")([owner, lyra], pin).ids).toEqual(["f:cut.webp"]);
    // LISTED — which is exactly what the gallery now writes in the same patch — it is a full citizen.
    const listed = { ...lyra, listed: true };
    expect(activePool("reel_figure")([owner, listed], pin).ids).toEqual(["b:lyra"]);
    // …and the theme's own paint site agrees, because it is the same rule read twice.
    expect(reelFigureArt(rosterFromIndex(index({ reel: [owner, listed] }, pin)))).toMatchObject({
      url: ART.cutout,
    });
  });

  it("…while a payload that never described the tier still degrades to the shipped art", () => {
    // The other half of the same predicate, and the reason it is not simply "did anything resolve":
    // a stub mock, a partial response or a proxy answering `{}` must keep showing the theme rather
    // than a fleet of placeholders.
    const stub = rosterFromIndex(index({ characters: [], banner: [], reel: [], oracle: [] }));
    expect(stub.entries).toEqual(defaultRoster().entries);
    expect(stub.scenes).toEqual(defaultRoster().scenes);
    expect(reelFigureArt(stub)).toMatchObject({ url: ART.cutout });
  });

  it("characters/ REPLACES the dealt cast, in the order the index handed over", () => {
    const r = rosterFromIndex(index({ characters: [file("kira"), file("nova")] }));
    expect(r.entries.map((e) => e.name)).toEqual(["kira", "nova"]);
    expect(assignArt(r, 3).map((a) => a!.url)).toEqual([
      painted("kira"),
      painted("nova"),
      painted("kira"), // the cycling rule is untouched by where the entries came from
    ]);
  });

  it("a broken CHARACTER keeps its position (flagged) — dropping it would re-deal every host after it", () => {
    const r = rosterFromIndex(
      index({ characters: [file("a"), file("b", { unusable: true }), file("c")] }),
    );
    expect(r.entries.map((e) => e.name)).toEqual(["a", "b", "c"]);
    expect(r.entries[1].unusable).toBe(true);
    // …and only ITS host gets the placeholder; the third host still gets the third entry.
    expect(assignArt(r, 3).map((a) => a?.url ?? null)).toEqual([painted("a"), null, painted("c")]);
  });

  it("a broken file in a first-wins POOL is SKIPPED — there its position only buys a blank surface", () => {
    const r = rosterFromIndex(
      index({
        oracle: [file("bad", { unusable: true }), file("good")],
        banner: [file("s1", { unusable: true })],
      }),
    );
    expect(oracleArt(r)).toMatchObject({ url: painted("good") });
    expect(r.scenes).toEqual(defaultRoster().scenes); // the only scene was broken ⇒ the bundled pair
  });

  it("banner/ becomes the SCENE slides, one per file, keyed by stem", () => {
    const r = rosterFromIndex(index({ banner: [file("b9"), file("b1")] }));
    expect(r.scenes).toEqual([
      { name: "b9", url: painted("b9"), rev: "1:1000" },
      { name: "b1", url: painted("b1"), rev: "1:1000" }, // the SERVER ruled the order; never re-sorted
    ]);
  });

  it("reel/ outranks the bundled cutout — dropping one in is the whole point of the folder", () => {
    const r = rosterFromIndex(index({ reel: [file("cut")] }));
    expect(reelFigureArt(r)).toMatchObject({ url: painted("cut") });
  });

  it("carries each pool file's REVISION, so a consumer can tell replaced bytes from the same name", () => {
    const r = rosterFromIndex(index({ reel: [file("cut", { revision: "77:9" })] }));
    expect(reelFigureArt(r)).toEqual({
      name: "cut",
      url: `${file("cut").url}?rev=${encodeURIComponent("77:9")}`,
      rev: "77:9",
    });
  });

  it("a slots PIN still outranks the role folder (the owner binding a character into a role)", () => {
    // Read on the ORACLE ladder since G6.3: it is the surviving pin-over-folder pair (the backdrop's
    // folder is gone, and its own three rungs are pinned at the bottom of this file).
    const withWide = index({ characters: [file("kira")], oracle: [file("w")] }, { oracle: "kira" });
    expect(oracleArt(rosterFromIndex(withWide))).toMatchObject({ url: painted("kira") });
    // …and a pin naming nothing on disk degrades to the folder rather than blanking the surface.
    const dangling = index(
      { characters: [file("kira")], oracle: [file("w")] },
      { oracle: "ghost" },
    );
    expect(oracleArt(rosterFromIndex(dangling))).toMatchObject({ url: painted("w") });
  });

  it("owner characters carry no wide/cutout/focus — under the role rule the FOLDER is the assignment", () => {
    const r = rosterFromIndex(index({ characters: [file("kira")] }));
    expect(r.entries[0]).toEqual({ name: "kira", image: painted("kira") });
    // …so a character can never become the reel figure just by existing — and replacing the CAST must
    // not cost the transition its figure either (the reel role falls back on its own).
    expect(reelFigureArt(r)).toMatchObject({ url: ART.cutout });
    expect(reelFigureArt(r)!.url).not.toBe(painted("kira"));
  });
});

describe("rosterFromIndex — a malformed payload degrades, never throws inside a render", () => {
  it("an empty object (a stub mock, a proxy answering `{}`) is the bundled set", () => {
    expect(rosterFromIndex({} as MediaIndex)).toEqual(defaultRoster());
  });

  it("a non-array role is ignored rather than iterated", () => {
    const bad = { ns: "gacha", roles: { characters: null } } as unknown as MediaIndex;
    expect(rosterFromIndex(bad).entries).toEqual(defaultRoster().entries);
  });
});

// ── G5 · the reel_figure pin addresses the REEL POOL (ruled, Codex F4). A character portrait is a
//    rectangle; pinned as the figure it would sweep across the screen as one, so it must not resolve —
//    and the gallery must not even offer it (see the MediaGallery suite). ──
describe("reelFigureArt — the pin selects a CUTOUT, never a portrait", () => {
  it("a pin naming a reel/ file wins over that folder's first entry", () => {
    const r = rosterFromIndex(index({ reel: [file("a"), file("b")] }, { reel_figure: "b" }));
    expect(reelFigureArt(r)).toMatchObject({ url: painted("b") });
  });

  it("a pin naming the BUNDLED cutout entry still resolves (the fresh-install case)", () => {
    const r = rosterFromIndex(index({ characters: [] }, { reel_figure: "lyra" }));
    expect(reelFigureArt(r)).toMatchObject({ url: ART.cutout });
  });

  it("a LEGACY pin naming a character without a cutout degrades to the default, never a rectangle", () => {
    const r = rosterFromIndex(
      index(
        { characters: [file("kira"), file("nova")], reel: [file("cut")] },
        { reel_figure: "kira" },
      ),
    );
    // NOT kira's portrait: the pin resolves to nothing and the ladder falls through (§5.3)
    expect(reelFigureArt(r)).toMatchObject({ url: painted("cut") });
  });

  it("…and with no reel/ files either, the same legacy pin lands on the bundled cutout", () => {
    const r = rosterFromIndex(index({ characters: [file("kira")] }, { reel_figure: "kira" }));
    expect(reelFigureArt(r)).toMatchObject({ url: ART.cutout });
  });

  it("the REEL ROLE's bundled ids ARE the bundled cutout-bearing entries", () => {
    // The gallery offers these while reel/ is empty; if they drift, the owner is offered a name the
    // resolver would refuse. Since **D65** the ids live on the ROLE (`MediaSlotDef.bundled` retired) and
    // are DERIVED from this pool — the registry imports `defaultRoster()`, never the reverse — so the
    // meaningful assertion is that the derivation still lands on the names this file's own schema rule
    // produces, and on the literal one the theme ships.
    const declared = MEDIA_NS.gacha.roles.reel.bundled.map((b) => b.id);
    const withCutouts = defaultRoster()
      .entries.filter((e) => e.cutout !== undefined)
      .map((e) => e.name);
    expect(declared).toEqual(withCutouts);
    // The literal, so a roster edit that changes WHICH entry carries the cutout is visible here rather
    // than quietly agreeing with itself on both sides of a derivation.
    expect(declared).toEqual(["lyra"]);
    // …and the pin no longer carries a copy of it.
    expect(MEDIA_NS.gacha.slots?.find((s) => s.key === "reel_figure")).toEqual({
      key: "reel_figure",
      label: "Transition figure",
      from: "reel",
    });
  });
});

// ── G6.3 · THE FLEET BACKDROP'S THREE-RUNG LADDER ────────────────────────────────────────────────────
//
// gacha's scenery is exclusive (D54 A5): the Root passes `kitBackground={false}`, so the kit's own layer
// never mounts under this theme. Before G6.3 that meant a file dropped into `media/kit/background/` did
// NOTHING here while every other theme picked it up — which the owner hit on the device round and read as
// a bug. The first fix was a RUNG (the kit picture as gacha's backdrop); the owner then ruled the rest:
// "just having the background in the kit is the better approach — no duplicated systems", so gacha's own
// `wallpaper/` drop folder was REMOVED outright rather than kept above it. Two folders for one picture
// was the confusion itself.
//
// What survives is the theme-SPECIFIC half — the `wallpaper:` PIN, which names a CHARACTER, something the
// kit has no equivalent of. So the ladder these arms pin is exactly three rungs:
//
//     the gacha pin (a cast portrait, wide-cropped) → the SHARED kit background → the bundled scene
//
// …plus the two things that could silently go wrong around it: `heroArt` must read the SAME ladder (a
// backdrop and a hero slide showing different pictures is the §5.3 disagreement), and the kit rung must
// not leak onto gacha's other surfaces.

const kitFile = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  ...file(name),
  url: `/api/media/kit/files/background/${name}.webp`,
  ...over,
});

/** The kit rung as the ladder hands it over: PAINT-READY, like every other rung (D65 defect #1 + its
 *  S2 review rider #8). It used to hand back the bare mount URL and leave the `?rev=` to its two call
 *  sites — which is how one of them came to stamp a string another rung had already stamped, giving one
 *  file two cache keys on the one screen that shows both. */
const kitRung = (f: MediaFile) => ({
  url: `${f.url}?rev=${encodeURIComponent(f.revision)}`,
  rev: f.revision,
});

describe("wallpaperArt — the three-rung fleet backdrop (G6.3)", () => {
  it("takes the SHARED kit background when nothing is pinned, INSTEAD of the bundled scene", () => {
    const kit = kitFile("shared");
    expect(wallpaperArt(roster([entry("a")]), kit)).toEqual(kitRung(kit));
  });

  it("loses to the gacha PIN — binding a cast portrait is the half the theme kept", () => {
    const kit = kitFile("shared");
    const pinned = roster([entry("a", { wide: "a-wide.webp" })], { wallpaper: "a" });
    expect(wallpaperArt(pinned, kit)).toEqual({ url: "a-wide.webp" });
    // …and the pin goes through the WIDE ladder, so a portrait with no landscape variant still crops
    // rather than being skipped.
    const noWide = roster([entry("a", { focus: proportionalFocal("50% 10%") })], {
      wallpaper: "a",
    });
    expect(wallpaperArt(noWide, kit)).toEqual({
      url: "a.webp",
      focus: proportionalFocal("50% 10%"),
    });
  });

  it("there is NO gacha wallpaper pool left to sit between them — the Roster has no such field", () => {
    // The removal is structural, not a skipped branch: `RolePools` carries `reel` and `oracle` only, so
    // a re-added middle rung would not typecheck rather than quietly reappearing.
    expect(Object.keys(defaultRoster().pools).sort()).toEqual(["oracle", "reel"]);
    expect(Object.keys(rosterFromIndex(index({ reel: [file("cut")] })).pools).sort()).toEqual([
      "oracle",
      "reel",
    ]);
  });

  it("falls through to the BUNDLED scene when there is no kit file either", () => {
    expect(wallpaperArt(roster([entry("a")]), undefined)).toEqual({ url: ART.banner });
    expect(wallpaperArt(roster([entry("a")]))).toEqual({ url: ART.banner }); // omitted ⇒ pin, else bundled
  });

  it("a DANGLING pin falls through to the kit picture, never to a hole", () => {
    const kit = kitFile("shared");
    const r = roster([entry("a")], { wallpaper: "ghost" });
    expect(wallpaperArt(r, kit)).toEqual(kitRung(kit));
  });

  it("an UNUSABLE pinned entry falls through too (the pin is found, but not painted)", () => {
    const kit = kitFile("shared");
    const r = roster([entry("a", { wide: "a-wide.webp", unusable: true })], { wallpaper: "a" });
    expect(wallpaperArt(r, kit)).toEqual(kitRung(kit));
  });

  it("the HERO slide reads the SAME ladder — the two must never show different pictures (§5.3)", () => {
    // `heroArt` defaults to the wallpaper pick, so dropping the argument one call deep would give the
    // backdrop the shared image and the hero slide the bundled banner.
    const kit = kitFile("shared");
    expect(heroArt(roster([entry("a")]), kit)).toEqual(wallpaperArt(roster([entry("a")]), kit));
    // …and a hero PIN still outranks it, exactly as it outranks the wallpaper pick.
    const pinned = roster([entry("a", { wide: "a-wide.webp" })], { hero: "a" });
    expect(heroArt(pinned, kit)).toEqual({ url: "a-wide.webp" });
  });

  it("does NOT reach the oracle backdrop — a rung is added to one ladder, not to the theme", () => {
    // The operator art is its own surface with its own folder and its own bundled default; the owner
    // asked for the fleet backdrop, and a shared picture silently taking over every gacha surface is
    // not that.
    expect(oracleArt(roster([entry("a")]))).toMatchObject({ url: ART.oracle });
  });
});
