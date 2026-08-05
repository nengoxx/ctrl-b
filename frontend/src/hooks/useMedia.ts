import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";

// The owner MEDIA index (D52/G5, GACHA_PLAN §5.4 + §10.4) — `GET /api/media/{ns}`: what the owner has
// dropped into `$CTRLB_HOME/media/<ns>/<role>/`, per role, already in the order the server rules.
//
// NAMESPACE-GENERIC (council M9): gacha is the first `ns`, and the next art-bearing theme reuses this
// hook with its own namespace string. Nothing theme-shaped lives here — the gacha ADAPTER
// (`themes/gacha/useGachaRoster`) is what turns a payload into a roster.
//
// ALWAYS-ON rather than tab-scoped (the `useNotificationPrefs` / `useVoiceStatus` pattern): the
// consumers are theme surfaces that render on Fleet AND Agent, and the reel overlay is not on a tab at
// all. Cheap, and shared: every gacha surface calls this with the same key, so TanStack answers all of
// them from ONE request. A Conf gallery save invalidates `["media", ns]` so a reorder is live without a
// reload; `staleTime` then keeps a tab switch from refetching a listing that changes only when the
// owner copies a file in from another machine.

/** One servable file in a role folder. Mirrors `app.core.media.MediaFile` — the wire contract. */
export interface MediaFile {
  /** The filename STEM: the entry name the resolver deals, and what a `slots` pin names. */
  name: string;
  /** The filename inside the role folder — the identity the Conf gallery's `order` list writes. */
  file: string;
  /** The percent-encoded mount URL. The client NEVER builds media paths itself. */
  url: string;
  /** Read from the file's magic bytes, not its extension; `null` when the bytes are unreadable. */
  format: string | null;
  size_bytes: number;
  /** An opaque change token for these BYTES (`mtime_ns:size`). Owner files are mutable IN PLACE under
   *  a stable name, so the URL is not their identity — and it must stay stable anyway, or the SW's
   *  media cache would miss on every poll. A consumer that REMEMBERS something about a file (the reel
   *  figure's failure latch) keys on (url, revision), so replacing the file clears what it remembered. */
  revision: string;
  width: number | null;
  height: number | null;
  /** Unreadable, or a format that disagrees with the extension — the mount would serve a broken image.
   *  The file still keeps its POSITION (that is what stops one bad drop re-dealing the whole fleet). */
  unusable: boolean;
  /** WHY it is unusable, machine-readable, `null` when it is not — one of the two verdicts only the SERVER
   *  can reach (it read the bytes). Named apart from the index's own `disabled`/`reason` below, which are
   *  about the whole NAMESPACE. The gallery turns it into a sentence; every SIZE-derived advisory is the
   *  client's own, from the numbers above against the registry's per-role bounds (MEDIA_PLAN §5). */
  unusable_reason: "unreadable" | "format-mismatch" | null;
}

export interface MediaIndex {
  ns: string;
  /** The name of the server's default ordering rule, so both ends can state the same contract. */
  collation: string;
  /** role → files, already in the ruled order (the owner's persisted order first, then the collation). */
  roles: Record<string, MediaFile[]>;
  /** The `slots` pins as configured (§5.2). A pin naming nothing on disk degrades in the resolver. */
  slots: Record<string, string>;
  /** The namespace's tree is not servable and is NOT MOUNTED: a symlink on its spine, a file where a
   *  role folder belongs, or a mkdir that failed. `roles` is empty, so the theme falls back to its
   *  bundled art on its own — but the GALLERY must say `reason` rather than show an empty grid, which
   *  is the difference between "nothing dropped in yet" and "the app cannot read your folder". */
  disabled?: boolean;
  reason?: string;
}

/** `opts` is per-OBSERVER, not per query: TanStack resolves `staleTime`/`refetchOnMount`/
 *  `refetchOnWindowFocus` for each consumer separately, so the three policies that ship can disagree on
 *  one query — the Conf gallery insists on a fresh read (files arrive out of band), the service icons
 *  ask for a long stale window and no focus refetch (`kit/serviceIcons.ts`), and a theme's own surfaces
 *  take the default. All of them still share ONE request and ONE invalidation. */
export function useMediaIndex(
  ns: string,
  opts?: { staleTime?: number; refetchOnMount?: "always"; refetchOnWindowFocus?: boolean },
) {
  return useQuery<MediaIndex>({
    queryKey: ["media", ns],
    queryFn: () => getJSON<MediaIndex>(`/api/media/${ns}`),
    staleTime: 60_000,
    ...opts,
  });
}
