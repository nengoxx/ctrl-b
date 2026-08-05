// Owner-media OPERATIONS (D53 / MEDIA_PLAN §2) — how a consumer turns ONE role's server-ordered file list
// into what it paints. PURE and dependency-free (the `assignFromSet.ts` house shape): every operation takes
// its list as an argument, so the acceptance rows are ordinary unit tests and nothing React-, query- or
// theme-shaped can reach in here.
//
// The list arrives ALREADY ORDERED. The owner's persisted `media.<ns>.roles.<role>.order` is projected
// server-side (`core.media.list_role`), so there is deliberately NO client-side `order` parameter — one
// source of truth for "what does default order mean" (MEDIA_PLAN §5, Opus LOW).
//
// These are the OPERATIONS, not one function per kind: gacha's shipped semantics are four different rules
// over one pool, so a consumer COMPOSES (MEDIA_PLAN §2, Codex H1). A theme's own semantics — gacha's wide
// ladder, focal crops and cutouts — stay in the theme and compose on top of these.
//
// NOT `lib/assignFromSet.ts`, which looks adjacent and is not: that deals a fixed SET of decorations by
// HASHING each id (stable per id, order-independent — cosmos service banners). These deal a role's files by
// POSITION, because in a media namespace the order IS the assignment (GACHA_PLAN §5.2 / R3).

/** The only field these operations read. Structurally satisfied by the wire's `MediaFile` and by anything a
 *  theme has already derived from one — which is what keeps this module free of the wire type. */
export interface MediaUsable {
  /** Unreadable bytes, or a format that disagrees with the extension: the mount would serve a broken image. */
  unusable?: boolean;
}

/** …plus the NAME a pin addresses a member by (the config's `slots` values are filename stems). */
export interface MediaNamed extends MediaUsable {
  name: string;
}

/** The whole ordered list, minus what cannot paint — for a consumer that shows EVERY file in a role (the
 *  gacha banner's scene slides). Position carries no assignment here, so a broken file is simply dropped. */
export function orderedUsable<T extends MediaUsable>(files: readonly T[]): T[] {
  return files.filter((f) => f.unusable !== true);
}

/** The entry at position `i`, cycling (`i mod N`) when there are more positions than files.
 *
 *  POSITION-PRESERVING, and that is the invariant rather than a detail (GACHA_PLAN §5.3, Codex G0 #2): the
 *  list is dealt WHOLE — an unusable entry is dealt like any other and the caller renders its own
 *  placeholder for it. Filtering the broken ones out HERE would re-deal every position after them, so one
 *  bad file drop would silently change half the fleet's art.
 *
 *  `null` is reserved for the genuinely degenerate case: no files at all, or an index that is not a
 *  position (negative/fractional — the caller is a render path, so this must not throw). */
export function cycleAt<T>(files: readonly T[], i: number): T | null {
  const n = files.length;
  if (n === 0 || !Number.isInteger(i) || i < 0) return null;
  return files[i % n];
}

/** `cycleAt` for a whole run of positions — the form a fleet body maps over, in display order. */
export function cycleAssign<T>(files: readonly T[], count: number): (T | null)[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => cycleAt(files, i));
}

/** First-wins on a role, with an optional PIN naming a member of this same list.
 *
 *  The pin addresses THIS list and nothing else (the ruled reel-figure shape, GACHA_PLAN §5.2 / Codex F4):
 *  a pin naming something the role does not hold — a deleted file, or a legacy value from before a role's
 *  options changed — falls through to the first usable member rather than blanking the surface.
 *
 *  `undefined` rather than `null` on purpose: this is a LADDER rung, so it composes with `??` into the
 *  consumer's next fallback (a pinned entry from another role, then the theme's bundled art). */
export function firstUsable<T extends MediaNamed>(
  files: readonly T[],
  pin?: string,
): T | undefined {
  const usable = orderedUsable(files);
  const pinned = pin === undefined ? undefined : usable.find((f) => f.name === pin);
  return pinned ?? (usable.length > 0 ? usable[0] : undefined);
}
