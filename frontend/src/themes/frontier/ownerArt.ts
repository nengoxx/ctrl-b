// The frontier theme's ONE owner-art seam (D53 M2 / MEDIA_PLAN §3 + §5) — the gacha `roster.ts` +
// `useGachaRoster` house pattern applied to this theme's three surfaces: the rig cards, the map cover
// and the Comms rig-stack.
//
// SPLIT the same way gacha's is, and for the same reason: `frontierArtFromIndex` is PURE (a wire payload
// in, resolved art out), so the acceptance rows — the 8 partial-stack combinations, the empty folder, a
// dangling pin — are ordinary unit tests, and `useFrontierArt` is the two-line React wrapper. The query
// NEVER gates a render: `frontierArtFromIndex(undefined)` is the bundled art, so the first paint and a
// backend that is briefly unreachable both show the shipped theme rather than a hole.
//
// What it deliberately does NOT do is touch `present()`. The D29 §9.9 seam stays pure index-driven math
// (position · plate · the per-position rig KEY); threading a query payload through it would make the
// theme's placement depend on a network response. Owner art is resolved HERE, at the consumer layer,
// where the bundled `ART` lookup already happens.

import { useMemo } from "react";

import { useMediaIndex, type MediaFile, type MediaIndex } from "../../hooks/useMedia";
import { cycleAt, firstUsable, resolveNamed, revUrl } from "../../lib/media";
import {
  activeIds,
  ladderRows,
  offersBundled,
  rowId,
  shown,
  usableLadderRows,
  type ActiveArt,
  type LibraryRow,
} from "../../lib/mediaLibrary";
import { ART, RIG_KEYS } from "./art";

/** The three layer files, by the KEY their stem must match (the owner-ruled NAMED convention, §10.1).
 *  Ordered as they are dropped in the gallery, back to front. */
export const STACK_KEYS = ["cube", "platform-mid", "platform-base"] as const;

export type StackKey = (typeof STACK_KEYS)[number];

/** The bundled layer each KEY stands for. Here rather than in the media registry (which used to hold a
 *  second copy) because the registry may import this module and never the other way round (§2.4's pinned
 *  import direction) — and because the ladder below needs it: a bundled stack ROW resolves to exactly
 *  this asset, so the gallery's "in use" and the surface's paint read one table. */
export const STACK_ART: Record<StackKey, string> = {
  cube: ART.stack.cube,
  "platform-mid": ART.stack.mid,
  "platform-base": ART.stack.base,
};

/** What the frontier surfaces paint, after the owner's folder has had its say. */
export interface FrontierArt {
  /** The rig for display position `i`, in THREE answers — because "no URL" means two different things
   *  and a card must not treat them alike (Emma's S2 review #2):
   *
   *   · a URL — paint it. An owner file, or the bundled rig the fallback tier deals at that position.
   *   · `undefined` — this position's entry cannot paint (a broken drop; a bundled id the theme no
   *     longer ships). The consumer's own INDEXED rig stands, which is the shipped placeholder rule:
   *     an unusable file holds its slot and only ITS card falls back, so one bad drop can never
   *     re-deal the fleet. It is also the answer for a stub payload that never described the role.
   *   · `null` — the role RESOLVED TO NOTHING although the payload described it: the owner switched
   *     every entry off. Paint no rig. The In-use switch has to mean what it says, and a card that
   *     kept showing the bundled rig would make the gallery's "nothing in use" a lie.
   *
   *  The bundled fallback for a position is INDEXED (`present()` names it `RIG_KEYS[i % 6]`), which is
   *  why the last rung stays at the consumer rather than being copied here. */
  rigUrlFor: (i: number) => string | null | undefined;
  /** The map cover: the `hero` pin, else that folder's first usable file, else the bundled vista. The
   *  vista is addressed by NO id (the role ships no bundled entries), so it is not a library entry the
   *  owner can retire — which is why this rung is unconditional where the two above are not. */
  hero: string;
  /** The Comms stack, per LAYER — owner file where one is named for that layer, the bundled layer
   *  where the library still offers it, and NOTHING where the owner switched that bundled entry off.
   *  A partial drop therefore COMPOSITES owner over bundled, deliberately (§3): the layers are one
   *  picture, and refusing to mix them would mean the owner had to redraw all three to change one. */
  stack: { cube?: string; mid?: string; base?: string };
}

/** Resolve the theme's art from a media-index payload. `undefined` — the query has not answered, or
 *  failed — is the bundled set. */
export function frontierArtFromIndex(index: MediaIndex | undefined): FrontierArt {
  // Defensive against the PAYLOAD, not against our own types: this is wire data, and a stub or partial
  // response (an e2e mock, a proxy answering `{}`) must degrade to the bundled art rather than throw
  // inside a theme's render — the `rosterFromIndex` precedent.
  const role = (name: string): MediaFile[] => {
    const files = index?.roles?.[name];
    return Array.isArray(files) ? files : [];
  };
  const rigRowsIn = role("rigs");
  const rigs = rigRows(rigRowsIn);
  // Whether this payload described the rig role's bundled TIER at all. It is what separates "the owner
  // retired the shipped rigs" from "this is a stub payload" — see `offersBundled`.
  const rigTier = offersBundled(rigRowsIn);
  const stack = role("stack");

  return {
    rigUrlFor: (i) => {
      if (rigs.length === 0) return rigTier ? null : undefined;
      // `cycleAt`, so the pool is dealt WHOLE and position-preserving (the shipped gacha invariant):
      // an unusable file HOLDS its position, and only that one card falls back — one broken drop can
      // never re-deal the rest of the fleet's art.
      const f = cycleAt(rigs, i);
      return f === null || f.unusable ? undefined : rigUrl(f);
    },
    hero: heroRow(role("hero"), index?.slots ?? {}) ?? ART.hero,
    stack: {
      cube: stackLayerUrl(stack, "cube"),
      mid: stackLayerUrl(stack, "platform-mid"),
      base: stackLayerUrl(stack, "platform-base"),
    },
  };
}

// ── the §2.4 ACTIVE RESOLVERS (D65, council H1) ──────────────────────────────────────────────────
//
// One function per ladder, exported so the Conf gallery resolves through the SAME rule the surfaces
// paint through (`theme-engine/mediaRegistry.ts` imports them; this module never imports it back).
// Pure in the index rows + the wire's `slots`, and reading only wire facts — `listed` is what lets a
// ladder keep falling through to bundled art exactly as it always did (§2.3 ④).

/** The rig POOL as dealt: the owner's tier when they have dropped anything, else the six bundled rigs
 *  in their own order — which is precisely what `present()` deals positionally (`RIG_KEYS[i % 6]`), so
 *  a fresh install paints what it always painted. */
export function rigRows(rows: readonly MediaFile[]): MediaFile[] {
  return ladderRows(rows);
}

/** A rig row's URL. A bundled row resolves to this theme's own asset (the server emits the id only);
 *  an id the theme no longer ships resolves to nothing and the consumer keeps its own fallback. */
function rigUrl(f: MediaFile): string | undefined {
  if (f.bundled == null) return revUrl(f.url, f.revision);
  const at = RIG_KEYS.indexOf(f.bundled as (typeof RIG_KEYS)[number]);
  return at < 0 ? undefined : ART.rigs[at];
}

/** The map cover: the `hero` pin, else the folder's first usable file. `undefined` = the ladder falls
 *  through to the bundled vista, which is art no id addresses (the role ships none). */
function heroRow(rows: readonly MediaFile[], slots: Record<string, string>): string | undefined {
  const pick = firstUsable(usableLadderRows(rows), slots.hero || undefined);
  return pick === undefined ? undefined : revUrl(pick.url, pick.revision);
}

/** ONE stack layer's row — the §2.4 ladder BOTH the Comms surface and the Conf gallery read (they
 *  used to run two near-copies of it, which is how they came to disagree): the owner's file named for
 *  that layer, else the bundled row carrying the same id. Hidden entries are skipped on both rungs.
 *
 *  The bundled ids ARE the layer keys, so a bundled row answers its own key — and a partial drop
 *  still composites owner over bundled, one layer at a time. */
function stackLayerRow(rows: readonly MediaFile[], key: string): MediaFile | undefined {
  const visible = shown(rows);
  const owner = resolveNamed(
    visible.filter((f) => f.bundled == null),
    [key],
  ).get(key);
  return owner ?? visible.find((f) => f.bundled === key);
}

/** What one layer PAINTS. `undefined` = nothing — which since the S2 review is a state the owner can
 *  reach: switching the bundled layer's In-use off retires it, and compositing it back in anyway would
 *  make the gallery's "nothing in use" a lie (Emma's #2).
 *
 *  The shipped layer may still stand as the last DEGRADE rung, and the test is per-KEY rather than
 *  per-role because that is where the honest line sits: a payload that carries no bundled ENTRY for
 *  this layer never offered the owner a way to retire it (a stub, a partial mock — or an unusable
 *  owner file in a payload that listed nothing else), so the shipped layer is still the truthful
 *  answer. A bundled row that IS on the wire and hidden is the owner's own answer. */
function stackLayerUrl(rows: readonly MediaFile[], key: StackKey): string | undefined {
  const row = stackLayerRow(rows, key);
  if (row !== undefined) {
    return row.bundled != null ? STACK_ART[key] : revUrl(row.url, row.revision);
  }
  return rows.some((f) => f.bundled === key) ? undefined : STACK_ART[key];
}

/** The gallery's reading of the rig pool — every member is dealt, in this order. */
export function activeRigs(rows: readonly LibraryRow[]): ActiveArt {
  return { ids: activeIds(rigRows(rows as readonly MediaFile[])), mode: "deal" };
}

/** The gallery's reading of the map cover: pin, else first usable — one winner. */
export function activeHero(
  rows: readonly LibraryRow[],
  slots: Readonly<Record<string, string>>,
): ActiveArt {
  const pick = firstUsable(
    usableLadderRows(rows as readonly MediaFile[]),
    slots?.hero || undefined,
  );
  return { ids: pick ? [rowId(pick)] : [], mode: "first" };
}

/** The gallery's reading of ONE stack layer (each is its own section, §6.1) — the SAME `stackLayerRow`
 *  the surface paints through, which is the whole of §2.4's one-ladder rule. */
export function activeStackLayer(key: string) {
  return (rows: readonly LibraryRow[]): ActiveArt => {
    const pick = stackLayerRow(rows as readonly MediaFile[], key);
    return { ids: pick ? [rowId(pick)] : [], mode: "first" };
  };
}

/** The hook every frontier surface reads. Both bodies (Fleet and Agent) call it and there is still ONE
 *  request — the query key is shared, so TanStack dedupes — and the derived object is memoised on the
 *  payload so `FrontierFleet`'s `placements` memo keeps its identity across renders (the F3 retention
 *  effect keys on it; a fresh object every render loops it). */
export function useFrontierArt(): FrontierArt {
  const { data } = useMediaIndex("frontier");
  return useMemo(() => frontierArtFromIndex(data), [data]);
}
