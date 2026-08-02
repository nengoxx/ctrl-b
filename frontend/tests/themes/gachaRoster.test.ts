import { describe, expect, it } from "vitest";

import { ART } from "../../src/themes/gacha/art";
import {
  artForHost,
  assignArt,
  defaultRoster,
  entryForHost,
  heroArt,
  oracleArt,
  reelFigureArt,
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

function entry(name: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return { name, image: `${name}.webp`, ...extra };
}

function roster(entries: RosterEntry[], slots: Roster["slots"] = {}): Roster {
  return { entries, slots };
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
    const r = roster([entry("a", { focus: "50% 30%" }), entry("b")]);
    expect(artForHost(r, 0)).toEqual({ url: "a.webp", focus: "50% 30%" });
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
    expect(oracleArt(r)).toEqual({ url: ART.oracle });
  });

  it("an unusable cutout is skipped for the reel figure, in favour of a usable one", () => {
    const r = roster([
      entry("a", { cutout: "a-cut.webp", unusable: true }),
      entry("b", { cutout: "b-cut.webp" }),
    ]);
    expect(reelFigureArt(r)).toEqual({ url: "b-cut.webp" });
    // …and with no usable cutout at all, no figure (the slats carry the reel alone).
    expect(
      reelFigureArt(roster([entry("a", { cutout: "a-cut.webp", unusable: true })])),
    ).toBeNull();
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
    const r = roster([entry("a", { focus: "50% 12%" })]);
    expect(wideArtForHost(r, 0)).toEqual({ url: "a.webp", focus: "50% 12%" });
  });

  it("carries the focus through the wide variant too", () => {
    const r = roster([entry("a", { wide: "a-wide.webp", focus: "20% 80%" })]);
    expect(wideArtForHost(r, 0)).toEqual({ url: "a-wide.webp", focus: "20% 80%" });
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
    const r = roster([entry("a", { focus: "50% 10%" })], { wallpaper: "a" });
    expect(wallpaperArt(r)).toEqual({ url: "a.webp", focus: "50% 10%" });
  });

  it("a pin naming a MISSING entry (deleted/renamed) degrades to the default — never crashes", () => {
    const r = roster([entry("a")], { wallpaper: "ghost", oracle: "ghost", hero: "ghost" });
    expect(slotEntry(r, "wallpaper")).toBeUndefined();
    expect(wallpaperArt(r)).toEqual({ url: ART.banner }); // the bundled scene art
    expect(oracleArt(r)).toEqual({ url: ART.oracle });
    expect(heroArt(r)).toEqual({ url: ART.banner }); // hero → wallpaper → the default
  });

  it("an unpinned hero follows the WALLPAPER pick (§5.2's stated default)", () => {
    const r = roster([entry("a", { wide: "a-wide.webp" })], { wallpaper: "a" });
    expect(heroArt(r)).toEqual({ url: "a-wide.webp" });
  });
});

describe("reelFigureArt — the cutout slot is stricter than the crops", () => {
  it("uses the pinned entry only when it actually HAS a cutout", () => {
    const r = roster([entry("a"), entry("b", { cutout: "b-cut.webp" })], { reel_figure: "a" });
    expect(reelFigureArt(r)).toEqual({ url: "b-cut.webp" }); // the pin has no cutout → first that does
  });

  it("honors a valid pin over the positional first", () => {
    const r = roster([entry("a", { cutout: "a-cut.webp" }), entry("b", { cutout: "b-cut.webp" })], {
      reel_figure: "b",
    });
    expect(reelFigureArt(r)).toEqual({ url: "b-cut.webp" });
  });

  it("no cutout anywhere → no figure (the slats must carry the reel alone)", () => {
    expect(reelFigureArt(roster([entry("a"), entry("b")]))).toBeNull();
    expect(reelFigureArt(roster([]))).toBeNull();
  });
});

describe("defaultRoster — the bundled fallback set (§5.5)", () => {
  const r = defaultRoster();

  it("is the dealt set the owner picked at the G1 eyeball: two prototype characters, the two drops, and the cutout-bearing tail", () => {
    // `3`/`4` sit at display positions 2/3 — vault and g5 on the owner's fleet (round-3 swap); `lyra`
    // stays LAST so the reel figure's cutout default survives without her being dealt to a host.
    expect(r.entries.map((e) => e.name)).toEqual(["pegasus", "atlas", "3", "4", "lyra"]);
    expect(r.entries.every((e) => e.image.length > 0)).toBe(true);
  });

  it("ships NO pins — the fallbacks are the intended defaults, not a second place to change them", () => {
    expect(r.slots).toEqual({});
  });

  it("resolves every slot without configuration: scene art for the wide slots, lyra for the figure", () => {
    expect(wallpaperArt(r)).toEqual({ url: ART.banner });
    expect(heroArt(r)).toEqual({ url: ART.banner });
    expect(oracleArt(r)).toEqual({ url: ART.oracle });
    expect(reelFigureArt(r)).toEqual({ url: ART.cutout });
  });

  it("keeps the SCENE art out of the per-host cycle (the frontier partition rule)", () => {
    // Every host, however many, gets a CHARACTER — never the banner or the oracle backdrop.
    const dealt = assignArt(r, 12).map((a) => a!.url);
    expect(dealt).not.toContain(ART.banner);
    expect(dealt).not.toContain(ART.oracle);
    expect(new Set(dealt)).toEqual(new Set(ART.characters));
  });
});
