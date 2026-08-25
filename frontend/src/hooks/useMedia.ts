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

/** One entry of a role's LIBRARY. Mirrors `app.core.media.MediaFile` — the wire contract.
 *
 *  Since D65 a row is either a file on disk or a BUNDLED id (`bundled` set), and every row carries the
 *  per-item facts the owner configured (`listed`/`hidden`/`focal`) so resolution is decidable from the
 *  index alone — no consumer ever reads media config (MEDIA_MANAGER_PLAN §2.3 ④).
 *
 *  The four D65 fields are declared OPTIONAL, deliberately: every consumer here already treats this as
 *  wire data that may arrive partial (an e2e mock, a proxy answering `{}`) and degrades rather than
 *  throwing — the same posture `rosterFromIndex` states. The server always sends them. */
export interface MediaFile {
  /** The filename STEM: the entry name the resolver deals, and what a `slots` pin names. On a BUNDLED
   *  row this is the bundled ID — one identity space, so a pin addresses either the same way. */
  name: string;
  /** The filename inside the role folder — the identity a config `files` entry's `name` holds. Empty
   *  on a bundled row. */
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
   *  client's own, from the numbers above against the registry's per-role bounds (MEDIA_PLAN §5).
   *  `unreadable` covers BOTH truncated bytes and a readable format this surface does not serve (a GIF,
   *  a HEIC) — the sentence must say both, or an owner hunts for a corruption that isn't there (#7). */
  unusable_reason: "unreadable" | "format-mismatch" | null;
  /** The registry id when this row is a BUNDLED entry — the client maps it to its own hashed asset.
   *  `null`/absent = a file on disk. (D65: bundled defaults are first-class library entries.) */
  bundled?: string | null;
  /** True when the owner's `files` list holds this entry; false when the collation appended it (an
   *  unlisted drop, or an unlisted bundled id — the FALLBACK TIER). A theme ladder reads this to keep
   *  its shipped semantics: a fallback bundled row participates exactly where bundled art already did. */
  listed?: boolean;
  /** The owner excluded this entry from resolution while keeping it in the library. Resolution SKIPS a
   *  hidden row; the gallery shows it dimmed. Note the opposite treatment from `unusable`, which HOLDS
   *  its position — never fold the two predicates together (MEDIA_MANAGER_PLAN §2.2). */
  hidden?: boolean;
  /** The framing point (0..1 per axis), keyed to the file's `revision`: a `rev` that disagrees with the
   *  row's `revision` means the bytes changed underneath it and the point reads as unset. */
  focal?: { x: number; y: number; rev: string } | null;
  /** The explicit named-role BINDING key the owner (or an upload) set on this entry; `null`/absent = it
   *  binds by its filename stem, the permanent fallback rule that keeps SSH drops binding forever
   *  (§2.2). On the wire so a resolver never reads config and the detail panel can name WHICH of the
   *  two bound the file. Always absent on a bundled row. */
  key?: string | null;
}

export interface MediaIndex {
  ns: string;
  /** The name of the server's ordering rule, so both ends can state the same contract. `library-v1`
   *  since D65: the owner's `files` entries, then unlisted disk files, then unlisted BUNDLED ids. */
  collation: string;
  /** role → its whole library, already in that ruled order. */
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
 *  ask for a long stale window and no focus refetch (`kit/ownerArt.ts`), and a theme's own surfaces
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
