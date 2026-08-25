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

/** What the frontier surfaces paint, after the owner's folder has had its say. */
export interface FrontierArt {
  /** The OWNER's rig for display position `i`, or `undefined` when they have supplied none for it.
   *
   *  Partial on purpose, and it is the one accessor here that is: the bundled fallback for a rig is
   *  INDEXED (`present()` names it as an asset key, `RIG_KEYS[i % 6]`), so putting the last rung in
   *  here would mean a second copy of that modulo living beside the first. The consumer writes
   *  `rigUrlFor(i) ?? assets[enc.asset]` — which degenerates to exactly the pre-M2 expression when the
   *  folder is empty, so byte-identity on a fresh install holds BY CONSTRUCTION rather than by
   *  assertion. Hero and the stack have no such index-driven bundled default, so they are total. */
  rigUrlFor: (i: number) => string | undefined;
  /** The map cover: the `hero` pin, else that folder's first usable file, else the bundled vista. */
  hero: string;
  /** The Comms stack, per LAYER — owner file where one is named for that layer, bundled where not.
   *  A partial drop therefore COMPOSITES owner over bundled, deliberately (§3): the layers are one
   *  picture, and refusing to mix them would mean the owner had to redraw all three to change one. */
  stack: { cube: string; mid: string; base: string };
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
  const rigs = rigRows(role("rigs"));
  const stack = stackRows(role("stack"));

  return {
    rigUrlFor: (i) => {
      // `cycleAt`, so the pool is dealt WHOLE and position-preserving (the shipped gacha invariant):
      // an unusable file HOLDS its position, and only that one card falls back — one broken drop can
      // never re-deal the rest of the fleet's art.
      const f = cycleAt(rigs, i);
      return f === null || f.unusable ? undefined : rigUrl(f);
    },
    hero: heroRow(role("hero"), index?.slots ?? {}) ?? ART.hero,
    stack: {
      cube: stack.get("cube") ?? ART.stack.cube,
      mid: stack.get("platform-mid") ?? ART.stack.mid,
      base: stack.get("platform-base") ?? ART.stack.base,
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

/** The Comms stack, per LAYER. The bundled ids ARE the layer keys, so a bundled row answers its own
 *  key — and a partial drop still composites owner over bundled, one layer at a time. */
function stackRows(rows: readonly MediaFile[]): Map<string, string> {
  const out = new Map<string, string>();
  const owner = resolveNamed(
    shown(rows).filter((f) => f.bundled == null),
    STACK_KEYS,
  );
  for (const key of STACK_KEYS) {
    const file = owner.get(key);
    if (file !== undefined) out.set(key, revUrl(file.url, file.revision));
  }
  return out;
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

/** The gallery's reading of ONE stack layer (each is its own section, §6.1): the owner's file for that
 *  key, else the bundled row carrying the same id. */
export function activeStackLayer(key: string) {
  return (rows: readonly LibraryRow[]): ActiveArt => {
    const files = rows as readonly MediaFile[];
    const owner = resolveNamed(
      shown(files).filter((f) => f.bundled == null),
      [key],
    ).get(key);
    const fallback = shown(files).find((f) => f.bundled === key);
    const pick = owner ?? fallback;
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
