// Service-banner artwork (owner's `docs/screenshot/designs/asdff` reference, cropped to 12 individual
// banners). Bundled WebP assets — Vite hashes + serves them. Each service's base pick HASHES its stable global
// id (NOT its position in a host's list) → deterministic (survives polls / re-renders, never flickers) and
// varied across the whole fleet, instead of every planet marching through the same banner-01,02,03… order.
// Within a single host the picks are de-duplicated (`assignBanners`) so one host never shows the same banner
// twice (the hash-collision that repeated on corsair). Consumed as a `.hd-svc` background (cover) under a
// readability scrim + mute veil (cosmos.css). `import.meta.glob` pulls all twelve — add/remove a file, no code.

const modules = import.meta.glob("../../assets/cosmos/service-banners/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

/** All banner image URLs, in stable filename order (banner-01 … banner-12). */
export const SERVICE_BANNERS: string[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k] as string);

// A small stable string hash (djb2-ish) — deterministic across renders/devices, no deps.
function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return h;
}

/** Map each service id (one host's services) to a banner url. Base pick = `hash(id) % N` (varied across the
 *  fleet); WITHIN this set, collisions are resolved by linear-probing to the next free banner so the host
 *  never repeats a banner — until it has more services than banners (N=12), past which repeats are
 *  unavoidable and it falls back to the raw hash. Ids are processed in SORTED order so the assignment is
 *  stable regardless of the incoming service order (no flicker on polls). */
export function assignBanners(ids: string[]): Map<string, string> {
  const n = SERVICE_BANNERS.length;
  const out = new Map<string, string>();
  if (!n) {
    for (const id of ids) out.set(id, "");
    return out;
  }
  const used = new Set<number>();
  const distinct = ids.length <= n;
  for (const id of [...ids].sort()) {
    let idx = ((hash(id) % n) + n) % n;
    if (distinct) {
      let tries = 0;
      while (used.has(idx) && tries < n) {
        idx = (idx + 1) % n;
        tries++;
      }
      used.add(idx);
    }
    out.set(id, SERVICE_BANNERS[idx]);
  }
  return out;
}
