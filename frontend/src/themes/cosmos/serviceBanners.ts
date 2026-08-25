import { assignFromSet } from "../../lib/assignFromSet";
import { activeIds, shown, type ActiveArt, type LibraryRow } from "../../lib/mediaLibrary";

// Cosmos service-banner artwork (owner's `docs/screenshot/designs/asdff` reference, cropped to 12 banners).
// This file owns ONLY the cosmos-specific ASSET SET — the bundled WebP (Vite hashes them; `import.meta.glob`
// pulls the whole folder, so add/remove a file with no code change). The reusable ASSIGNMENT logic (stable,
// varied, de-duped per call) lives in the theme-agnostic `lib/assignFromSet` so any other theme's bottom-sheet
// host-detail can reuse it with its OWN set. Rendered as a `.hd-svc` background under a readability scrim +
// `--svc-veil` mute (cosmos.css) — that CSS-var recipe is the reusable styling seam (lift to a Kit class when
// a second theme adopts it).
//
// SINCE S6 THE SET IS A LIBRARY (the owner ruling: no shipped art is left behind). The twelve banners used to
// be a private array no gallery could see — cosmos is not a media namespace, so they sat outside the owner's
// media system entirely and there was no way to reorder or retire one. They are now the BUNDLED tier of the
// kit's `service-banners` role: the ROTATION set the gallery lists, orders and switches off, while a file the
// owner drops for a service keeps winning that service's own row (`kit/ownerArt.ts#serviceBannerFrom` —
// unchanged, and the precedence is still the adopting surface's, §A5).
//
// The ids are the files' own stems (`banner-01` … `banner-12`), which is what makes the mirror derivable: the
// media registry reads `SERVICE_BANNER_SET` and the backend's `KIT_ROLES["service-banners"]` is held in step
// by the cross-language drift guard.

const modules = import.meta.glob("../../assets/cosmos/service-banners/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

/** One bundled banner: the stable id the server emits as an index row, and the hashed asset it stands for.
 *  In filename order (banner-01 … banner-12), which is the rotation's own default order. */
export const SERVICE_BANNER_SET: readonly { id: string; url: string }[] = Object.keys(modules)
  .sort()
  .map((k) => ({
    id: (k.split("/").pop() ?? "").replace(/\.webp$/, ""),
    url: modules[k] as string,
  }));

/** id → asset. The server emits an id and never a url for a bundled row, so this is the one place the
 *  cosmos surface maps one back — the `rigUrl`/`sceneUrl` shape every theme's adapter has. */
const BY_ID = new Map(SERVICE_BANNER_SET.map((b) => [b.id, b.url]));

/** The pool a host sheet deals from, given the library's own answer.
 *
 *  `undefined` in = the payload never described the role (a stub, a mock, an unreachable backend), which is
 *  the one case that degrades to the whole shipped set — the same `offersBundled` rule every theme adapter
 *  runs on. Otherwise the owner's library decides: hidden banners drop out, and the ORDER is the one they
 *  arranged, which is what `assignFromSet` walks. An id the theme no longer ships resolves to nothing and
 *  falls out rather than dealing a broken url. */
export function bannerPool(ids: readonly string[] | undefined): string[] {
  if (ids === undefined) return SERVICE_BANNER_SET.map((b) => b.url);
  return ids.map((id) => BY_ID.get(id)).filter((u): u is string => u !== undefined);
}

/** Assign a distinct cosmos banner to each service id of a host (de-duped, stable), out of `pool`. Thin
 *  wrapper over the generic `assignFromSet` bound to whatever the library resolved. */
export function assignBanners(ids: string[], pool: readonly string[]): Map<string, string> {
  return assignFromSet(ids, pool);
}

/** §2.4 — the gallery's reading of the ROTATION section: every visible banner is dealt across the fleet's
 *  service rows, in this order. `deal` is the mode word for exactly that (the cast and the rigs are the
 *  other two), and it is the honest one: no single banner is "the current" one, so the tiles carry no
 *  `aria-current` and the card paints a collage rather than a winner. */
export function activeBannerSet(rows: readonly LibraryRow[]): ActiveArt {
  return { ids: activeIds(shown(rows).filter((r) => r.bundled != null)), mode: "deal" };
}
