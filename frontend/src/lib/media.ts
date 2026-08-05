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
  // Truthiness, not `!== true` (Codex M1b LOW-2): a malformed wire value like the string "true" must stay
  // EXCLUDED, exactly as the pre-lift resolver treated it — degrade-defensively on junk payloads.
  return files.filter((f) => !f.unusable);
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

/** The ONE normalization every stem↔key comparison goes through (MEDIA_PLAN §5, pinned at the confirm
 *  round). NFC first — a macOS-decomposed `é` and a Linux-composed one are the same name to a human and
 *  must be the same key — then JS `toLowerCase`.
 *
 *  **The contract IS JavaScript semantics, not casefold ideals**: JS has no full Unicode casefold, so
 *  `ß` does not fold to `ss` and a final sigma resolves however `toLowerCase` resolves it. That is
 *  acceptable *because keys are computed client-side ONLY* — the server's `casefold-natural` collation
 *  orders listings and never computes a key, so one implementation exists by construction and there is
 *  nothing for a second one to disagree with. M3's `keyFor(service)` is this function over
 *  `kind ?? name`; sharing it is what keeps the two ends of the binding on one rule. */
export function normalizeMediaKey(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/** Bind a role's files to KEYS by casefolded stem — the `named` kind's whole mechanism (MEDIA_PLAN §2).
 *
 *  A file binds to the key its `normalizeMediaKey`d stem EQUALS. Nothing else binds: a stem matching no
 *  key is simply unbound (the gallery is where the owner learns that, not the render), which is what
 *  makes "drop `cube.png` in" a complete action with no config to write.
 *
 *  Two rules decide the contested cases, both stated at the operation because both are visible to the
 *  owner:
 *   · **unusable files never bind.** A file the mount would serve broken is not a candidate at all, so
 *     the key falls through to the consumer's next rung instead of painting a hole. It does NOT hold a
 *     position the way a pool entry does — position buys nothing here, the NAME is the binding.
 *   · **file/file collisions: first in the server's index order wins** (§5). `cube.png` and `cube.webp`
 *     both reach `cube`; the winner is the one the index lists first, which is the owner's own
 *     collation (and their gallery reorder), so the tie-break is something they can see and change.
 *
 *  Returns a Map holding only the keys that BOUND, so `map.get(key)` is `undefined` for an unbound one
 *  and composes with `??` into the consumer's fallback ladder — the `firstUsable` convention. The
 *  values are the caller's own objects (identity preserved), which is what lets the gallery invert the
 *  map to answer "which key did THIS file take?". */
export function resolveNamed<T extends MediaNamed>(
  files: readonly T[],
  keys: readonly string[],
): Map<string, T> {
  // First-DECLARED wins when two keys normalize identically (Codex M2 LOW-1): static registry lists are
  // invariant-tested unique, so this guard is for DATA-DERIVED key lists (M3's service identities), where
  // it makes the collapse deterministic in declaration order rather than silently last-wins.
  const wanted = new Map<string, string>();
  for (const k of keys) {
    const norm = normalizeMediaKey(k);
    if (!wanted.has(norm)) wanted.set(norm, k);
  }
  const bound = new Map<string, T>();
  for (const f of orderedUsable(files)) {
    const key = wanted.get(normalizeMediaKey(f.name));
    // First-wins: a later file reaching a key that already bound is ignored, never an overwrite.
    if (key !== undefined && !bound.has(key)) bound.set(key, f);
  }
  return bound;
}
