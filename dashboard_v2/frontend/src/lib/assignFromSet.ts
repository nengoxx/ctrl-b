// Stable, de-duplicated assignment of a fixed SET of items to a list of ids — a reusable, theme-agnostic
// decorative-asset picker. Cosmos service banners are the first user (themes/cosmos/serviceBanners), but any
// theme that lays rows into the shared BottomSheet (or anywhere) can reuse it for "give each thing a stable,
// varied, non-repeating decoration". Pure + dependency-free → unit-testable without any assets.
//
// Properties:
//  • DETERMINISTIC — each id's base pick HASHES the id, so it's identical across renders/devices (no flicker
//    on polls) and varied across the whole set rather than tied to list position.
//  • DISTINCT within a call — collisions are resolved by linear-probing to the next free item, so one call
//    never repeats an item until there are more ids than items (past which repeats are unavoidable; it then
//    falls back to the raw hash so every id still gets one).
//  • ORDER-INDEPENDENT — ids are processed in sorted order, so the result doesn't depend on the incoming
//    order (a re-ordered poll yields the same assignment).

/** A small stable string hash (djb2-ish) — deterministic across renders/devices, no deps. */
function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return h;
}

/** Map each id to an item from `set` — hashed base pick, de-duped within the call, stable across re-orders. */
export function assignFromSet<T>(ids: string[], set: readonly T[]): Map<string, T> {
  const n = set.length;
  const out = new Map<string, T>();
  if (!n) return out;
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
    out.set(id, set[idx]);
  }
  return out;
}
