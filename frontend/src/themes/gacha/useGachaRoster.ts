import { useMemo } from "react";

import { useMediaIndex } from "../../hooks/useMedia";
import { rosterFromIndex, type Roster } from "./roster";

// The theme's ONE art seam (D52/G5, GACHA_PLAN §5.2's pinned read path): the media index query, adapted
// into the `Roster` every gacha surface already resolves through. Cards, promo slides, the dossier, the
// wallpaper, the oracle and the reel figure all call this and then the SAME pure resolver — which is the
// whole reason §5.3 rules one resolver: a host's card and its promo showing different characters would
// read as a bug.
//
// Several surfaces call it and there is still ONE request: the query key is shared, so TanStack dedupes.
// Memoised on the payload so the derived roster keeps a stable identity between renders — the reel's
// warm-up effect and the Root's wallpaper layout effect both key off it.
//
// The query never gates a render: `rosterFromIndex(undefined)` is the bundled set, so the first paint (and
// a backend that is briefly unreachable) shows the shipped art rather than placeholders or a spinner.
export function useGachaRoster(): Roster {
  const { data } = useMediaIndex("gacha");
  return useMemo(() => rosterFromIndex(data), [data]);
}
