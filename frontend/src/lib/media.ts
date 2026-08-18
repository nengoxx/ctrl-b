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

/** The two fields a service is IDENTIFIED by for icon binding. Structurally satisfied by the wire's
 *  `Service` and by the config editor's `HostServiceCfg` — the same reason `MediaUsable` above is a
 *  local interface rather than the wire type. */
export interface ServiceIdentity {
  name: string;
  kind?: string | null;
}

/** The KEY a service's icon file must be named after (MEDIA_PLAN §5, D53): its `kind` when it has one,
 *  else its display `name`, normalized. `kind` first because it is the SHARED identity — three machines
 *  each running "Jellyfin", "jellyfin (4k)" and "media" all declare `kind: jellyfin` and want one icon,
 *  which is also why same-kind services across hosts share a file by design (§0's stated limitation).
 *
 *  **Absent kind = empty kind** (the build ruling, M3): the plan writes `kind ?? name`, but `??` alone
 *  would take `""` as an answer and hand back an empty key that no file can be named after. The config
 *  editor already writes `kind: s.kind.trim() || null` (MachineEditor), so treating a blank kind as
 *  absent is not a new rule — it is the WRITER's rule, applied at the reader so a hand-authored
 *  `kind: ""` or `kind: "  "` behaves exactly like a hand-authored config with no `kind` at all.
 *  Both sources are trimmed for the same reason: a key with edge whitespace is one no owner could name
 *  a file for, since the padding is invisible in every listing they would compare it against. */
export function keyFor(service: ServiceIdentity): string {
  const kind = (service.kind ?? "").trim();
  return normalizeMediaKey(kind !== "" ? kind : service.name.trim());
}

/** The KEY a MACHINE's art file must be named after (the Kit Art System's `kit/hosts` role): its NAME,
 *  normalized. Its own function rather than `keyFor({name})` because the two identities are different
 *  rules that happen to coincide today — a service prefers its `kind`, a machine has no such shared
 *  identity — and the normalization (the part that must never fork) is the shared call underneath.
 *
 *  The NAME is the right key even though it is renameable, because nothing stabler is owner-facing:
 *  `Host.id` is a slug DERIVED from the name and rekeys with it (config.py `hosts()`, hosts.py's rename),
 *  a MAC is optional and carries colons no stem may hold, and an IP or VPN name moves. A case- or
 *  NFC-only rename keeps matching (that is what the normalization is); a SUBSTANTIVE rename leaves the
 *  old file unmatched in the gallery, and the remedy is to rename the file. */
export function hostKeyFor(host: { name: string }): string {
  return normalizeMediaKey(host.name.trim());
}

//: Characters no stem may carry. The set is WINDOWS' (a superset of POSIX's, which forbids only `/`),
//: and that is deliberate rather than paranoid: `$CTRLB_HOME/media/` lives on the SERVER's filesystem,
//: and a Windows server is a supported deployment profile (ARCHITECTURE §6). The rule has to be the
//: strictest of the profiles we ship, because the alternative is a key that looks fine in the gallery on
//: one host and cannot be typed on another. Control characters ride along: they are unusable everywhere
//: and invisible in every listing the owner would compare against.
// eslint-disable-next-line no-control-regex -- the control range IS the rule here, not an accident
const UNNAMEABLE = /[<>:"/\\|?*\u0000-\u001f]/;
//: …and the DOS device names, which Windows refuses as a whole filename however it is spelled. Matched
//: against the whole (already lowercased) stem.
const DOS_DEVICES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Whether a key can be a FILENAME STEM at all — the honest answer to "why does this service never get
 *  an icon" (§5). A service called `media/plex`, or `Plex: 4K`, normalizes to a key no file in one
 *  directory can carry; the empty key (a blank name AND kind) is the same problem. Said OUT LOUD in the
 *  gallery rather than left to be discovered, which is the whole reason this predicate exists: the owner
 *  would otherwise keep renaming a file that can never match.
 *
 *  Conservative on purpose (Codex M3 LOW-3) — see `UNNAMEABLE`. The render path still needs no guard:
 *  the index only ever lists real files from one directory, so no listed stem can match one of these
 *  keys in the first place. */
export function isStemRepresentable(key: string): boolean {
  return (
    key !== "" &&
    !UNNAMEABLE.test(key) &&
    !DOS_DEVICES.has(normalizeMediaKey(key)) &&
    // A trailing dot or space is silently STRIPPED by Windows, so the file the owner thinks they saved
    // is not the one on disk — unnameable in the only sense that matters here.
    !/[. ]$/.test(key)
  );
}

/** The identity of one piece of art FOR A FAILURE LATCH: which file, and which bytes of it (Codex M2/G4
 *  F6). Owner media is mutable IN PLACE, so the URL alone would keep a REPAIRED file latched — and the
 *  URL has to stay stable anyway, or the SW's media cache would miss on every poll. Bundled art carries
 *  no revision, which is correct: it cannot change under a running app.
 *
 *  Shared rather than re-derived per consumer (the gacha reel latch and the kit `ServiceIcon` are the
 *  two), because "what makes this the same picture" is exactly the kind of rule that drifts when it is
 *  written twice. Two arguments rather than an object: the two consumers name the field differently
 *  (`rev` on a roster entry, `revision` on the wire). */
export function artIdentity(url: string, revision?: string): string {
  // NUL-joined: the one character neither a percent-encoded URL nor an `mtime_ns:size:ino:ctime_ns`
  // revision can contain, so two different pairs can never spell the same identity.
  return `${url}\u0000${revision ?? ""}`;
}

/** The `?rev=` cache-busting SPELLING — one home (G6.3), shared by `kit/ownerArt.ts#ownerArtUrl` and the
 *  gacha wallpaper publish (`GachaRoot`). The same mutable-in-place fact `artIdentity` answers for the
 *  failure latch, put where the caches look: the query moves only when the bytes move, so a poll still
 *  hits, and an in-place overwrite moves the cache entry instead of serving the stale decode. No/empty
 *  revision ⇒ the bare URL (bundled art, or the empty string the server writes when it could not `stat`). */
export function revUrl(url: string, revision?: string): string {
  return revision ? `${url}?rev=${encodeURIComponent(revision)}` : url;
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
  const wanted = wantedKeys(keys);
  const bound = new Map<string, T>();
  // In FILE order (that is `stemIndex`'s own insertion order), so the map is built in exactly the sequence
  // the per-file loop this replaced built it in.
  for (const [stem, f] of stemIndex(files)) {
    const key = wanted.get(stem);
    if (key !== undefined) bound.set(key, f);
  }
  return bound;
}

/** normalized STEM -> the file that owns it: both of `resolveNamed`'s contested rules, and nothing else.
 *
 *  Its own function because the two callers want it at different granularities and must not answer
 *  differently (the whole reason the binding lives in one place): `resolveNamed` above intersects it with a
 *  declared key list, while a render path that asks about ONE identity at a time — every service row of
 *  every theme, on every poll render — memoizes this map per media index and then only ever LOOKS UP
 *  (`kit/ownerArt.ts`). Building it there by hand would have been the fork.
 *
 *  Insertion order is the server's index order, which is what makes the first-wins tie-break the owner's
 *  own collation (and their gallery reorder) rather than a hash-map accident. */
export function stemIndex<T extends MediaNamed>(files: readonly T[]): Map<string, T> {
  const byStem = new Map<string, T>();
  for (const f of orderedUsable(files)) {
    const stem = normalizeMediaKey(f.name);
    // First-wins: a later file reaching a stem that already bound is ignored, never an overwrite.
    if (!byStem.has(stem)) byStem.set(stem, f);
  }
  return byStem;
}

/** normalized key -> the DECLARED spelling that claimed it. First-DECLARED wins when two keys normalize
 *  identically (Codex M2 LOW-1): static registry lists are invariant-tested unique, so this guard is for
 *  DATA-DERIVED key lists (service identities), where it makes the collapse deterministic in declaration
 *  order rather than silently last-wins. */
function wantedKeys(keys: readonly string[]): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const k of keys) {
    const norm = normalizeMediaKey(k);
    if (!wanted.has(norm)) wanted.set(norm, k);
  }
  return wanted;
}

/** `resolveNamed` plus the answer from the FILES' side: every file accounted for, exactly once.
 *
 *  The gallery has to be able to say why a drop did nothing, and "it bound" is only one of four
 *  answers — the other three are what the owner actually needs when the icon or the layer does not
 *  appear. GENERIC rather than service-specific (Codex M3 MED-1): both `named` key sources have
 *  collisions and typos, so the static-key roles (the frontier stack) and the data-derived one (kit's
 *  services) classify through this one function instead of one of them shipping the diagnostics and the
 *  other only its winners. */
export interface NamedBinding<T> {
  /** key -> the file that took it (`resolveNamed`). */
  byKey: Map<string, T>;
  /** …and the inverse, for the file's own row. */
  keyOf: Map<T, string>;
  /** Files whose stem reaches a key ANOTHER file already took — the file/file collision's losers. */
  shadowed: Set<T>;
  /** Files whose stem matches no declared key at all: a typo, a rename, or art for something gone. */
  unmatched: Set<T>;
}

/** One CONSUMER of a DATA-derived `named` role: the key its file must be named after, and what to call
 *  it in the gallery. The two sources that produce these — a fleet's services, a fleet's machines — turn
 *  their own identities into this one shape (`theme-engine/mediaKeySources.ts`), so nothing downstream
 *  knows which source it is reading. */
export interface KeyedConsumer {
  key: string;
  label: string;
}

/** One derived KEY row: what the owner would name a file, who uses it, and what currently answers. */
export interface DerivedKeyRow<T> {
  /** The normalized key — what the file's stem has to match. */
  key: string;
  /** Every consumer collapsing to this key, in source order. More than one is a consumer/consumer
   *  collision: consumers are not in the media index, so there is no winner to pick — they SHARE the
   *  file (§5), and the gallery says so. */
  consumers: string[];
  /** The file that took it, if any. */
  file?: T;
  /** False when no file could ever be named this (a path separator in the key, or an empty one). */
  representable: boolean;
}

export interface DerivedKeyBinding<T> {
  rows: DerivedKeyRow<T>[];
  /** The files' side of the same answer — bound / shadowed / unmatched, from the SHARED classifier, so
   *  a derived-key role and a static-key one diagnose a drop identically (Codex M3 MED-1). */
  binding: NamedBinding<T>;
}

/** Everything the gallery says about a DATA-derived `named` role: the KEY rows (which the static-key
 *  roles get from the registry instead) plus the generic file classification.
 *
 *  SOURCE-AGNOSTIC by construction (Codex A1): it takes `{key,label}` pairs, so services and machines —
 *  and whatever the next dynamic source is — share one view model rather than growing a branch each. */
export function deriveKeyBindings<T extends MediaNamed>(
  consumers: readonly KeyedConsumer[],
  files: readonly T[],
): DerivedKeyBinding<T> {
  const byKey = new Map<string, DerivedKeyRow<T>>();
  for (const consumer of consumers) {
    const row = byKey.get(consumer.key);
    if (row) row.consumers.push(consumer.label);
    else
      byKey.set(consumer.key, {
        key: consumer.key,
        consumers: [consumer.label],
        representable: isStemRepresentable(consumer.key),
      });
  }
  const binding = classifyNamed(files, [...byKey.keys()]);
  for (const [key, file] of binding.byKey) {
    // The row is present by construction (the keys came from it) — the classifier returns only keys it
    // was given. Both directions are recorded because the gallery asks the question both ways.
    const row = byKey.get(key);
    if (row) row.file = file;
  }
  return { rows: [...byKey.values()], binding };
}

export function classifyNamed<T extends MediaNamed>(
  files: readonly T[],
  keys: readonly string[],
): NamedBinding<T> {
  const byKey = resolveNamed(files, keys);
  const keyOf = new Map<T, string>();
  for (const [key, file] of byKey) keyOf.set(file, key);
  const wanted = wantedKeys(keys);
  const shadowed = new Set<T>();
  const unmatched = new Set<T>();
  for (const f of files) {
    // An unusable file binds nothing, but "shadowed"/"unmatched" would be the wrong reason to give: it
    // already carries the server's verdict, and THAT is what the owner has to act on. Truthiness, like
    // `orderedUsable` — a junk wire value is excluded there, so it must not be diagnosed here.
    if (f.unusable || keyOf.has(f)) continue;
    (wanted.has(normalizeMediaKey(f.name)) ? shadowed : unmatched).add(f);
  }
  return { byKey, keyOf, shadowed, unmatched };
}
