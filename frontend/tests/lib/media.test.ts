import { describe, expect, it } from "vitest";

import {
  artIdentity,
  classifyNamed,
  cycleAssign,
  cycleAt,
  deriveKeyBindings,
  firstUsable,
  hostKeyFor,
  isStemRepresentable,
  keyFor,
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

  // It took an optional PIN naming a member of this same list until 2026-08-26 ("W6"), when the owner
  // ruled ORDER the only priority system app-wide and every POOL pin died. The rung reads the list's
  // own order and nothing else, so "the owner's own pick" is simply the entry they moved to the top —
  // one system, one place to look.
  it("ORDER is the whole rule — the first usable entry wins, whatever else the config says", () => {
    expect(firstUsable([f("a"), f("b")])?.name).toBe("a");
    expect(firstUsable([f("a", true), f("b"), f("c")])?.name).toBe("b");
  });

  it("`undefined` on an empty list, so it composes with `??` into the next rung", () => {
    expect(firstUsable([])).toBeUndefined();
    expect(firstUsable([f("a", true)])).toBeUndefined();
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

  it("is IDEMPOTENT — which is what lets a KEY be handed back to `resolveNamed` as a declared key", () => {
    // `keyFor` returns a normalized key and the icon lookup then binds files against it, so
    // normalize(normalize(x)) must equal normalize(x) or the gallery's grouping and the render's
    // binding could disagree. Includes the two shapes that make people nervous: a dotted capital I
    // (whose lowercase is a decomposed pair) and a ligature (which NFC deliberately leaves alone).
    for (const s of ["Cube", "İstanbul", "ﬀ", "Straße", "Café", "café", "ǅ"]) {
      expect(normalizeMediaKey(normalizeMediaKey(s))).toBe(normalizeMediaKey(s));
    }
  });
});

describe("keyFor — the service identity a file is named after (D53 M3)", () => {
  it("takes KIND over name: the shared identity, so three differently-named services share one icon", () => {
    expect(keyFor({ name: "Jellyfin (4K)", kind: "jellyfin" })).toBe("jellyfin");
    expect(keyFor({ name: "media", kind: "Jellyfin" })).toBe("jellyfin");
  });

  it("falls to NAME when there is no kind — null, undefined, blank and whitespace alike", () => {
    // The build ruling (M3): `??` alone would take `""` as an answer and hand back a key no file can be
    // named after. `kind: s.kind.trim() || null` is what the config editor WRITES, so this is that same
    // rule applied at the reader — a hand-authored `kind: ""` behaves like a hand-authored no-kind.
    expect(keyFor({ name: "Plex", kind: null })).toBe("plex");
    expect(keyFor({ name: "Plex" })).toBe("plex");
    expect(keyFor({ name: "Plex", kind: "" })).toBe("plex");
    expect(keyFor({ name: "Plex", kind: "   " })).toBe("plex");
  });

  it("trims both sources — an edge-whitespace key is one no owner could name a file for", () => {
    expect(keyFor({ name: " Plex " })).toBe("plex");
    expect(keyFor({ name: "x", kind: "  Jellyfin  " })).toBe("jellyfin");
  });

  it("normalizes exactly like a stem, so the two ends of the binding are ONE rule", () => {
    expect(keyFor({ name: "Café" })).toBe(normalizeMediaKey("café"));
  });
});

describe("hostKeyFor — the MACHINE identity a file is named after (the Kit Art System)", () => {
  it("is the machine's NAME, normalized through the one shared rule", () => {
    expect(hostKeyFor({ name: "Corsair" })).toBe("corsair");
    expect(hostKeyFor({ name: " vault " })).toBe("vault");
    expect(hostKeyFor({ name: "Café" })).toBe(normalizeMediaKey("café"));
  });

  it("has no `kind` rung — a machine has no shared identity to prefer (that is what makes it a second rule)", () => {
    // Distinct from `keyFor`, which would have taken a `kind` if one existed. Passing a service-shaped
    // object here still keys on the NAME, which is the whole difference between the two.
    expect(hostKeyFor({ name: "corsair", kind: "windows" } as { name: string })).toBe("corsair");
  });

  it("a case- or NFC-only RENAME keeps matching; a substantive one does not (the A7 accepted cost)", () => {
    expect(hostKeyFor({ name: "CORSAIR" })).toBe(hostKeyFor({ name: "corsair" }));
    expect(hostKeyFor({ name: "corsair-2" })).not.toBe(hostKeyFor({ name: "corsair" }));
  });
});

describe("isStemRepresentable — the keys no file can be named after", () => {
  it("accepts the ordinary ones: letters, digits, spaces, dots and dashes inside the stem", () => {
    for (const ok of ["jellyfin", "home assistant", "signal-bot", "platform-mid", "node.exporter"])
      expect(isStemRepresentable(ok), ok).toBe(true);
  });

  it("rejects every character WINDOWS forbids, not only POSIX's `/` (Codex M3 LOW-3)", () => {
    // `$CTRLB_HOME/media/` lives on the SERVER's filesystem and a Windows server is a supported
    // profile, so the rule is the strictest of the ones we ship — otherwise a key looks nameable in
    // the gallery on one host and cannot be typed on another. `Plex: 4K` is the realistic one.
    for (const bad of [
      "media/plex",
      "media\\plex",
      "plex: 4k",
      'say "hi"',
      "a<b",
      "a>b",
      "a|b",
      "a?b",
      "a*b",
    ])
      expect(isStemRepresentable(bad), bad).toBe(false);
  });

  it("rejects control characters, the empty key, and a trailing dot or space", () => {
    expect(isStemRepresentable("a b")).toBe(false);
    expect(isStemRepresentable("ab")).toBe(false);
    expect(isStemRepresentable("")).toBe(false);
    // Windows silently STRIPS these, so the file the owner thinks they saved is not the one on disk.
    expect(isStemRepresentable("plex.")).toBe(false);
    expect(isStemRepresentable("plex ")).toBe(false);
  });

  it("rejects the DOS device names as a WHOLE stem, however they are cased", () => {
    for (const dev of ["con", "CON", "PRN", "aux", "nul", "com1", "LPT9"])
      expect(isStemRepresentable(dev), dev).toBe(false);
    // …and only as the whole stem: a service actually called `console` is nameable.
    for (const ok of ["console", "con-fig", "com10", "lpt0"])
      expect(isStemRepresentable(ok), ok).toBe(true);
  });

  it("agrees with `keyFor` on the keys it can produce", () => {
    expect(isStemRepresentable(keyFor({ name: "   ", kind: "  " }))).toBe(false);
    expect(isStemRepresentable(keyFor({ name: "Plex: 4K" }))).toBe(false);
    expect(isStemRepresentable(keyFor({ name: "CON" }))).toBe(false);
    expect(isStemRepresentable(keyFor({ name: "Home Assistant" }))).toBe(true);
  });
});

describe("classifyNamed — every file accounted for, whatever the key SOURCE is", () => {
  // Generic on purpose (Codex M3 MED-1): the frontier stack's static keys and the kit's data-derived
  // ones both have collisions and typos, so the diagnostics are one function rather than a feature the
  // service role happened to get.
  it("records the winner AND the loser of a file/file collision", () => {
    const first = f("cube");
    const second = f("Cube");
    const out = classifyNamed([first, second], ["cube"]);
    expect(out.byKey.get("cube")).toBe(first);
    expect(out.keyOf.get(first)).toBe("cube");
    expect(out.shadowed.has(second)).toBe(true);
    expect(out.unmatched.size).toBe(0);
  });

  it("a file matching no declared key is UNMATCHED — the typo case", () => {
    const typo = f("platform_mis");
    const out = classifyNamed([f("cube"), typo], ["cube", "platform-mid"]);
    expect(out.unmatched.has(typo)).toBe(true);
    expect(out.shadowed.size).toBe(0);
  });

  it("an UNUSABLE file is neither shadowed nor unmatched — it carries the server's verdict", () => {
    const broken = f("cube", true);
    const out = classifyNamed([broken], ["cube"]);
    expect(out.byKey.size).toBe(0);
    expect(out.shadowed.size + out.unmatched.size).toBe(0);
  });

  it("classifies against the NORMALIZED declared keys, like the binding itself", () => {
    const out = classifyNamed([f("CUBE"), f("cube")], ["Cube"]);
    expect(out.keyOf.get(out.byKey.get("Cube")!)).toBe("Cube");
    expect(out.shadowed.size).toBe(1);
  });
});

describe("artIdentity — the (url, revision) failure-latch key", () => {
  it("distinguishes the same URL's two REVISIONS — the whole point (an in-place repair)", () => {
    expect(artIdentity("/x.png", "1:2")).not.toBe(artIdentity("/x.png", "3:4"));
    expect(artIdentity("/x.png", "1:2")).toBe(artIdentity("/x.png", "1:2"));
  });

  it("tolerates art with no revision (bundled files are content-hashed and cannot change)", () => {
    expect(artIdentity("/a.png")).toBe(artIdentity("/a.png", undefined));
    expect(artIdentity("/a.png")).not.toBe(artIdentity("/b.png"));
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

// ── the generic DERIVED-KEY view model (the Kit Art System / Codex A1) ──────────────────────────
//
// Two dynamic key sources exist now (the fleet's services and its machines), so the rows the gallery
// renders are built ONCE from `{key,label}` pairs rather than per source. Everything the M3 service-only
// model had to get right is the same here, and none of it mentions a service:
//
//  · one row per KEY, in source order;
//  · consumer/consumer collisions — no winner exists (consumers are not in the media index), so BOTH
//    labels land on ONE row and share whatever answers it;
//  · a key no file could ever be named is flagged rather than left to be discovered.
//
// WHICH FILE answers a key is deliberately NOT one of them (the W8 council's F5, and the W9 tail's
// deletion of the husk it left): that is the role's own §2.4 ladder, asked through the section, and
// `deriveKeyBindings` stopped answering it — it took a `files` list and returned a `binding` beside the
// rows, and the family card fed it `[]` from the moment F5 landed. The file-side rules themselves are
// unchanged and keep their own coverage: `classifyNamed`'s describe block above, and `resolveNamed`'s.

const consumer = (key: string, label: string) => ({ key, label });

describe("deriveKeyBindings — the source-agnostic key rows", () => {
  it("one row per key, in source order", () => {
    const rows = deriveKeyBindings([consumer("jellyfin", "Media"), consumer("grafana", "Grafana")]);
    expect(rows.map((r) => r.key)).toEqual(["jellyfin", "grafana"]);
  });

  it("consumer/consumer collision: BOTH labels on ONE row", () => {
    // Two hosts each running a `jellyfin` service collapse to one key — and so would two machines named
    // the same way. There is no index order over CONSUMERS to break the tie with, so there is no tie:
    // they share the one row, and therefore the one picture.
    const rows = deriveKeyBindings([
      consumer("jellyfin", "media-a"),
      consumer("jellyfin", "media-b"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].consumers).toEqual(["media-a", "media-b"]);
  });

  it("flags a key that can never be a filename", () => {
    const rows = deriveKeyBindings([
      consumer(keyFor({ name: "media/plex" }), "media/plex"),
      consumer("plex", "plex"),
    ]);
    expect(rows[0].representable).toBe(false);
    expect(rows[1].representable).toBe(true);
  });

  it("no consumers is an empty list, never a throw", () => {
    expect(deriveKeyBindings([])).toEqual([]);
  });

  it("says NOTHING about which file answers — that is the role's own ladder (F5)", () => {
    // The husk this tail deleted, pinned as an absence: a row carries the consumers' side and only
    // that. It used to carry a `file` the caller then overwrote with the ladder's answer, and a
    // `binding` computed over the empty list the caller passed.
    const rows = deriveKeyBindings([consumer("plex", "plex")]);
    expect(Object.keys(rows[0]).sort()).toEqual(["consumers", "key", "representable"]);
  });
});
