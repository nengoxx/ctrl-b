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
import { cycleAt, firstUsable, resolveNamed } from "../../lib/media";
import { ART } from "./art";

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
  const rigs = role("rigs");
  const stack = resolveNamed(role("stack"), STACK_KEYS);
  const layer = (key: (typeof STACK_KEYS)[number], bundled: string): string =>
    stack.get(key)?.url ?? bundled;

  return {
    rigUrlFor: (i) => {
      // `cycleAt`, so the pool is dealt WHOLE and position-preserving (the shipped gacha invariant):
      // an unusable file HOLDS its position, and only that one card falls back — one broken drop can
      // never re-deal the rest of the fleet's art.
      const f = cycleAt(rigs, i);
      return f === null || f.unusable ? undefined : f.url;
    },
    hero: firstUsable(role("hero"), index?.slots?.hero)?.url ?? ART.hero,
    stack: {
      cube: layer("cube", ART.stack.cube),
      mid: layer("platform-mid", ART.stack.mid),
      base: layer("platform-base", ART.stack.base),
    },
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
