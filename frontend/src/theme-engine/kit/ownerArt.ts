// The `kit` media namespace's ADAPTER (D53 M3 + the Kit Art System / MEDIA_PLAN §3 + §5) — the owner's
// SHARED art, from the wire payload to the surfaces that paint it: service icons (through `ServiceIcon`),
// service banners and machine pictures (through the parent-prop primitives at the bottom of this file),
// the whole-app background layer (`KitBackground`), and the app bar's brand mark (`KitAppBar`).
//
// SPLIT the way `themes/frontier/ownerArt.ts` and gacha's `roster.ts` are, and for the same reason: the
// resolution is PURE (a payload + an identity in, a file out), so every acceptance row — the collisions,
// the unmatched files, the unrepresentable keys, a dangling pin — is an ordinary unit test, and the hooks
// are two-line React wrappers over ONE query.
//
// It lives under `kit/` rather than in a theme because the namespace belongs to no theme: every theme's
// service rows read the icons, and any theme may adopt the rest. That is also why its registry row is
// `alwaysOn`. It is named `ownerArt.ts` (the frontier precedent) rather than `serviceIcons.ts` (its M3
// name): four of its five roles are not icons, and three are not about services at all.
//
// WHAT IT DOES NOT DECIDE is the precedence (Codex A5): each role resolves the OWNER's file for one
// identity and stops. Whether that beats, loses to, or composes with a theme's own art is the ADOPTING
// SURFACE's ladder — cosmos deals its bundled banner pool and then overrides per service, and a theme's
// own hero/roster never consults these roles at all. (One exception, ruled: gacha's fleet BACKDROP reads
// the shared background as a rung of its own ladder — G6.3 deleted its private twin of that folder rather
// than run two. It still does not mount the kit LAYER.)

import { useCallback, useMemo, type CSSProperties } from "react";

import { useMediaIndex, type MediaFile, type MediaIndex } from "../../hooks/useMedia";
import {
  firstUsable,
  hostKeyFor,
  keyFor,
  normalizeMediaKey,
  revUrl,
  stemIndex,
} from "../../lib/media";
import type { ServiceIdentity } from "../../lib/media";

/** The namespace and its role folders — named once so the hooks, the gallery and the tests cannot drift
 *  from `core/media.py`'s `KIT_ROLES`/`KIT_SLOTS`. */
export const KIT_NS = "kit";
const ICON_ROLE = "services";
const BANNER_ROLE = "service-banners";
const HOST_ROLE = "hosts";
const BACKGROUND_ROLE = "background";
const BRAND_ROLE = "brand";
/** Each pool's pin (`media.kit.slots.<key>`) — the owner overriding that folder's first-wins pick. */
const BACKGROUND_SLOT = "background";
const BRAND_SLOT = "brand";

/** A role's files out of a payload, defensively. Wire data: a stub or partial response (an e2e mock, a
 *  proxy answering `{}`) must degrade to "no art" rather than throw inside a render — the
 *  `frontierArtFromIndex` / `rosterFromIndex` precedent. */
function roleFiles(index: MediaIndex | undefined, role: string): MediaFile[] {
  const files = index?.roles?.[role];
  return Array.isArray(files) ? files : [];
}

/** One key's file in a NAMED role. Binding goes through `lib/media.ts#stemIndex` rather than through a
 *  hand-rolled stem comparison, so the two contested rules (an unusable file never binds; on a stem
 *  collision the first in the server's index order wins) have ONE implementation shared with `resolveNamed`
 *  — i.e. with the frontier stack and with the gallery's annotations. */
function namedFile(
  index: MediaIndex | undefined,
  role: string,
  key: string,
): MediaFile | undefined {
  return stemIndex(roleFiles(index, role)).get(normalizeMediaKey(key));
}

/** The owner's icon for ONE service, or `undefined` when they have dropped none for it — which is the
 *  ordinary case and not a defect: absent art means the row renders exactly as it does today (§3 — the
 *  kit namespace has no bundled fallback by design). */
export function serviceIconFrom(
  index: MediaIndex | undefined,
  service: ServiceIdentity,
): MediaFile | undefined {
  return namedFile(index, ICON_ROLE, keyFor(service));
}

/** The owner's BANNER for one service — the wide art an adopting surface paints behind its row. Keyed by
 *  the same `keyFor` identity as the icon: one service, two pictures of it, one name to remember. */
export function serviceBannerFrom(
  index: MediaIndex | undefined,
  service: ServiceIdentity,
): MediaFile | undefined {
  return namedFile(index, BANNER_ROLE, keyFor(service));
}

/** The owner's picture for one MACHINE, keyed by its name (`hostKeyFor`). Undefined is the ordinary case;
 *  it is also what a machine RENAMED since the file was dropped resolves to, and the gallery is where
 *  that shows up (the old file lists as unmatched). */
export function hostArtFrom(
  index: MediaIndex | undefined,
  host: { name: string },
): MediaFile | undefined {
  return namedFile(index, HOST_ROLE, hostKeyFor(host));
}

/** The shared whole-app background: the `background` PIN, else that folder's first usable file, else
 *  nothing. The frontier-hero pin shape, through the same `firstUsable` rung — a pin naming a file the
 *  folder no longer holds falls through rather than blanking the layer. */
export function backgroundArtFrom(index: MediaIndex | undefined): MediaFile | undefined {
  return firstUsable(roleFiles(index, BACKGROUND_ROLE), index?.slots?.[BACKGROUND_SLOT]);
}

/** The owner's BRAND MARK — the silhouette the app bar shows instead of the kit's accent dot (G6.3). The
 *  same pool+pin ladder as the background above, and the same degrade: no folder, no usable file or a
 *  dangling pin ⇒ `undefined` ⇒ the bar renders exactly what it rendered before this slice.
 *
 *  Only the file's ALPHA is used — `KitAppBar` paints it as a CSS mask over the accent fill — but that is
 *  the SURFACE's business, not this resolver's (the §A5 split: this module answers "which file", never
 *  "how it is painted"). */
export function brandArtFrom(index: MediaIndex | undefined): MediaFile | undefined {
  return firstUsable(roleFiles(index, BRAND_ROLE), index?.slots?.[BRAND_SLOT]);
}

// ── the hooks: ONE query, one policy, four readings of it ────────────────────────────────────────

/** The kit index as every RENDER path reads it, with its own query policy (Opus M3 — stated in code, and
 *  deliberately not the gallery's):
 *
 *   · a LONG staleTime and no focus refetch. This art changes only when the owner copies a file in from
 *     another machine, and these observers live on every rendered service row of every theme — the
 *     gallery's fresh-on-entry policy here would re-read the directory on every window focus, for a
 *     picture that is the same picture. The gallery keeps that policy where it belongs: on the one
 *     screen the owner opens right after dropping files in, which also invalidates this query's key.
 *   · SILENT degrade. There is no error branch anywhere below: an unreachable index is `undefined`
 *     data, which resolves to no art, which is the surface every theme already renders.
 *
 *  Same `["media", ns]` key family as the gallery, so a gallery save invalidates BOTH (the save's
 *  invalidation is prefix-matched on `["media"]`) — and all four readings below share ONE request. */
function useKitMedia(): MediaIndex | undefined {
  const { data } = useMediaIndex(KIT_NS, {
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  return data;
}

/** One NAMED role, resolved ONCE per index and then only looked up (Codex LOW).
 *
 *  The callback these hooks hand out is called per SUBJECT per render — cosmos's host sheet asks for a
 *  banner on every service row of every poll render — and each ask used to re-derive the role's whole
 *  stem→file binding to answer about ONE identity. That binding cannot change while the index is the same
 *  object, which is the query's whole contract, so it is memoized on exactly that and every ask becomes a
 *  Map `get`.
 *
 *  EAGER (the map is built inside the memo and never touched again) rather than a lazily-filled cache: a
 *  closure that keeps writing to a `useMemo`'d Map is state mutated after render, which the React Compiler
 *  rules reject outright — and rightly, since these callbacks ARE called during a parent's render. The
 *  eager map is also the cheaper shape here: it is one pass over a role folder, versus one pass per row.
 *
 *  `keyOf` is the identity rule (`keyFor` for a service, `hostKeyFor` for a machine) and `role` the folder
 *  — the same two constants the pure resolvers above compose, so nothing about the binding is stated twice.
 *  No API change: each hook still returns `(subject) => file | undefined`, stable for as long as the index
 *  is. */
function useNamedArt<T>(
  role: string,
  keyOf: (subject: T) => string,
): (subject: T) => MediaFile | undefined {
  const data = useKitMedia();
  const byStem = useMemo(() => stemIndex(roleFiles(data, role)), [data, role]);
  return useCallback(
    (subject: T) => byStem.get(normalizeMediaKey(keyOf(subject))),
    [byStem, keyOf],
  );
}

/** The five service-row surfaces' read of the icon index. */
export function useServiceIcons(): (service: ServiceIdentity) => MediaFile | undefined {
  return useNamedArt(ICON_ROLE, keyFor);
}

/** An adopting surface's read of the service BANNERS. */
export function useServiceBanners(): (service: ServiceIdentity) => MediaFile | undefined {
  return useNamedArt(BANNER_ROLE, keyFor);
}

/** An adopting host-detail surface's read of the machine pictures. */
export function useHostArt(): (host: { name: string }) => MediaFile | undefined {
  return useNamedArt(HOST_ROLE, hostKeyFor);
}

/** The shared background layer's own read (`KitBackground`) — and, since G6.3, gacha's wallpaper ladder,
 *  which takes the same resolved file as its last owner rung rather than mounting the layer. */
export function useKitBackgroundArt(): MediaFile | undefined {
  return backgroundArtFrom(useKitMedia());
}

/** The app bar's read of the owner's brand mark (`KitAppBar`). */
export function useKitBrandArt(): MediaFile | undefined {
  return brandArtFrom(useKitMedia());
}

// ── the URL every consumer paints from ───────────────────────────────────────────────────────────

/** The owner file's mount URL with its REVISION on the query string, or `undefined` for no file.
 *
 *  Owner media is mutable IN PLACE, and the ordinary repair is exactly that: overwrite `jellyfin.png` over
 *  SSH under the same name. The mount URL cannot move for it (it must stay stable or the SW's media route
 *  would miss on every poll — vite.config.ts), so a surface that keeps only the URL has nothing to notice:
 *  the browser's decoded image, the HTTP cache and the SW's `StaleWhileRevalidate` copy are all still
 *  keyed on a string that did not change, and the stale picture can survive the repair. `ServiceIcon`
 *  escapes that on its own — it keys the ELEMENT on `(url, revision)` — but the CSS-painted roles cannot:
 *  a `background-image` has no element to replace and no error event to latch on.
 *
 *  `?rev=` is that missing identity, put where every cache along the path already looks. Nothing serves it:
 *  the mount is a `StaticFiles` narrowing that reads only the ASGI path (`api/media.py`), and the SW route
 *  matches on `url.pathname`, so the query changes neither what is served nor whether it is cached — only
 *  WHICH cache entry it is. It moves only when the bytes move, so a poll still hits.
 *
 *  A file with no revision (the empty string the server writes when it could not `stat` — which also makes
 *  it `unusable`) keeps its bare URL: a `?rev=` naming nothing would be noise, and BUNDLED art, which has
 *  no revision at all, never comes through here in the first place (an adopter's own fallback URL is passed
 *  to the primitives below directly — cosmos's dealt banner pool). */
export function ownerArtUrl(file: MediaFile | undefined): string | undefined {
  if (file === undefined) return undefined;
  // The spelling itself lives in `lib/media.ts#revUrl` (G6.3) — the gacha wallpaper publish shares it.
  return revUrl(file.url, file.revision);
}

// ── the PARENT-surface primitives (Codex A2) ─────────────────────────────────────────────────────
//
// `ServiceIcon` can be a component because an icon is a CHILD of the row. A banner and a machine picture
// are backgrounds OF the row/sheet itself, and no component can attach a class and a custom property to
// its own parent — so the primitive is a pure helper returning the props the adopter SPREADS onto that
// element, and `undefined` when there is nothing to paint. Dormancy is therefore by ABSENCE: no file ⇒
// no class ⇒ no rule matches ⇒ the surface is byte-identical to the one that shipped before this slice.
//
// The kit CLASS owns MECHANICS ONLY (kit.css): which layer the image is, how it is cropped, the
// directional scrim and the veil. Every COLOUR comes from the adopter through `--kit-*-base`/`--kit-*-veil`
// — never a hardwired `--surface-2`, because gacha's dossier rows base on `--gc-dossier-card` and vapor
// maps its own row tokens (Codex A2).

/** What an adopter spreads onto the element the art paints. */
export interface KitArtProps {
  className: string;
  style: CSSProperties;
}

/** A `url("…")` value, or `undefined` for "nothing to paint". Index URLs are percent-encoded by the
 *  server (`core.media.file_url`), so neither a quote nor a backslash can reach the CSS token. */
function artProps(className: string, variable: string, url?: string): KitArtProps | undefined {
  if (url === undefined || url === "") return undefined;
  // A COMPUTED key, which is what makes this assignable to `CSSProperties` without a cast: the custom
  // property is data here (one helper, one variable name per role), not a literal the type would reject.
  return { className, style: { [variable]: `url("${url}")` } };
}

/** The parent props for a SERVICE-ROW banner. Takes the resolved URL rather than the file, because the
 *  LADDER is the adopter's: cosmos passes its own dealt banner when the owner has dropped none (§A5's
 *  surface-scoped precedence), while the kit's own Fleet passes only the owner's. */
export function serviceBannerProps(url?: string): KitArtProps | undefined {
  return artProps("kit-svc-banner", "--kit-banner-img", url);
}

/** The parent props for a faded MACHINE picture behind a host-detail surface. Same contract; the tone
 *  and veil stay in the adopting theme's stylesheet (only one adopter today — the shared class is
 *  mechanics, not a look). */
export function hostArtProps(url?: string): KitArtProps | undefined {
  return artProps("kit-host-art", "--kit-host-img", url);
}
