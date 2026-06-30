import { assignFromSet } from "../../lib/assignFromSet";

// Cosmos service-banner artwork (owner's `docs/screenshot/designs/asdff` reference, cropped to 12 banners).
// This file owns ONLY the cosmos-specific ASSET SET — the bundled WebP (Vite hashes them; `import.meta.glob`
// pulls the whole folder, so add/remove a file with no code change). The reusable ASSIGNMENT logic (stable,
// varied, de-duped per call) lives in the theme-agnostic `lib/assignFromSet` so any other theme's bottom-sheet
// host-detail can reuse it with its OWN set. Rendered as a `.hd-svc` background under a readability scrim +
// `--svc-veil` mute (cosmos.css) — that CSS-var recipe is the reusable styling seam (lift to a Kit class when
// a second theme adopts it).

const modules = import.meta.glob("../../assets/cosmos/service-banners/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

/** All cosmos banner image URLs, in stable filename order (banner-01 … banner-12). */
export const SERVICE_BANNERS: string[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k] as string);

/** Assign a distinct cosmos banner to each service id of a host (de-duped, stable). Thin wrapper over the
 *  generic `assignFromSet` bound to the cosmos asset set. */
export function assignBanners(ids: string[]): Map<string, string> {
  return assignFromSet(ids, SERVICE_BANNERS);
}
