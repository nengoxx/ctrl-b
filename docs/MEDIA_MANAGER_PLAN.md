# MEDIA_MANAGER_PLAN — the media manager v2: per-destination art LIBRARIES · upload · crop · focal point · reorder

**Status: v2.1 — COUNCIL ROUND 2 CLOSED 2026-08-24, BOTH LENSES FINAL-CONFIRMED RESOLVED
(record: §15; Emma correctness lens 1 HIGH + 9 MED · adversarial Opus architecture lens 5 HIGH +
8 MED + 3 sweep; every finding ruled and folded; each lens's confirm rounds ran to an explicit
"RESOLVED — ready to build"). The owner DECISION-SESSION rulings (§10) all stand, and the
H5 refinement (role-family cards for data-derived keys, §6.1) is **OWNER-RATIFIED 2026-08-24**
("we could try your suggestion first"). NOTHING BUILDS until the owner reads this document and
rules the push.**

Locks as **D65** (amending D52 §5.4 + D53/D54). MEDIA_PLAN.md (D53/D54) stays the authority on
namespaces/roles/kinds/serving; this plan is the authority on writes, libraries, and management UI.

## 0. Goal (the owner's words, condensed — 2026-08-24 decision session)

Every custom-art destination is a **section with its OWN gallery: a LIBRARY of images stored on
disk** so the owner can switch art later **without re-uploading**. Uploads are **purely
additive** — nothing replaces anything, delete is the only removal, **priority order decides what
is active**. **Bundled default images appear in every gallery as first-class entries.** The Conf
tab stays uncluttered: **tap a section → its gallery opens full-screen** — upload, crop, focal
point (v1, owner-ruled), reorder (drag primary), delete.

**Standing design principle (owner):** CORE feature — best-practice architecture and code,
several review eyes, and **everything customizable** (tunables in config or the registry, never
magic numbers).

## 1. D65 — the security reversal (RATIFIED 2026-08-24; NO kill switch)

D52 §5.4 ruled "no write API, ever". **The owner reverses that for typed media writes** on R55
§2's mechanism: the realistic attacker is the owner's browser — a cross-origin
`multipart/form-data` POST is CORS-safelisted. Therefore:

- **Raw-body `PUT`/`DELETE`, never multipart, never POST.** Non-safelisted verbs force a CORS
  preflight; we run no CORS middleware and answer no ACAO — a cross-origin browser write dies
  unsent. Pinned by tests + an architecture guard (adding CORS middleware without revisiting D65
  fails a test).
- Writes land **only** in registered `$CTRLB_HOME/media/<ns>/<role>/` dirs; `probe_image`
  validates bytes **before** the final name; extension must agree; streamed byte counter; a
  rejected upload leaves zero bytes.
- **No kill switch — the reversal is UNCONDITIONAL (owner ruling; the standing whole-feature-
  toggle rule knowingly waived).** No `enabled` flag, no 503 branch, no `write_enabled`, no
  degraded mode. A toggle stays trivially additive later.
- **No server-side image processing, still** (no Pillow, no decode — header probes only, same as
  SSH drops; stronger than every peer, R55).
- SECURITY_MODEL §2.x with the premise correction (the §CSRF "no session" reasoning never covered
  unauthenticated writes). **Residuals → Phase 19 register:** DNS rebinding (whole-API property;
  lean fix `TrustedHostMiddleware`) · `POST /api/voice/stt` (the standing safelisted-class
  instance).
- The three read-side "never a write API" docstrings rewritten (doc-truth rule).

## 2. The library data model (the core of v2)

### 2.1 Sections

A **section** = one art destination. Two kinds, ONE gallery UI driven by a **capability
descriptor** (council M1 — the difference is data, never implicit):

- **Library-backed sections** — one per (namespace, role): the role directory + the role's
  bundled entries. Capabilities: upload · reorder/drag · set-active (= move-to-front) · In-use
  toggle · delete · framing.
- **Pin-backed seat sections** — the D54 slots (gacha `wallpaper`/`hero`/`oracle`/`reel_figure`,
  frontier `hero`, kit slots): a **read-only VIEW over the source library plus exactly one
  write — the pin**. The tile action reads **"Use here"** (never "Set as active"); no upload,
  no drag, no delete, no In-use toggle, no framing from a seat (those belong to the source
  library's own section — one grid component reading capabilities, not two behaviors sharing a
  label).

Each section descriptor declares `activate: "reorder" | "pin"` + its capability set + (council
H1) its **active resolver** — see §2.4. A multi-window source (gacha characters feeds 11
windows) is ONE library; the focal point (§5) handles per-window crops.

> **S2 AS-BUILT — the `MediaSlotDef.seat` split (main-seat ruling 2026-08-25, Emma-reviewed).**
> The two kinds above are drawn by ONE fact on the pin, `MediaSlotDef.seat`, because a pin is a
> section of its own only when it is **its own destination**:
>
> · **In-role pins** — gacha `reel_figure`, frontier `hero`, kit `background`/`brand` — are the top
>   rung of **their own role's ladder**, not a separate surface. They FOLD into that role's card
>   (`seat` absent ⇒ `mediaSections` gives the pool `activate: "pin"`), because one destination gets
>   one card: a `reel/` section beside a "Transition figure" section would be two cards for one
>   picture. "Set as active" there writes the **PIN** — move-to-front would leave the pin silently
>   winning above it — **and, per the review's #1 ②, it lists an acted-on FALLBACK-tier bundled entry
>   in the same patch**, since a pin can only name what its ladder deals (§2.3 ③'s "only the entry
>   the owner explicitly acted on becomes listed" — a pin is as explicit as it gets).
> · **Cross-role seats** — gacha `wallpaper`/`hero`/`oracle`, which bind a CAST portrait into a
>   surface the cast does not own — stay their own sections (`seat: true`). Their write is the pin
>   and nothing else: a seat is a read-only VIEW over another library, so listing one of its bundled
>   rows would collapse the SOURCE role's whole fallback tier to that single entry.

**Every claim a card makes comes from the §2.4 resolver, never from the config value** (review #3):
a pin naming an entry the library no longer holds resolves to nothing, so the card reads
*"the pinned image is gone — a fallback is in use"* rather than naming the missing value as active.

> **W9 AS-BUILT — a pin NAMES the config identity union (owner ruling 2026-08-26).** The pin is
> still "exactly one write", and what it writes is now
> `slots.<key>: {name: <filename>} | {bundled: <id>} | null` — the very union a `files` entry
> persists, parsed by the very parser (`entryId`). A seat therefore resolves by IDENTITY: the row of
> the dealt tier whose `f:`/`b:` id the pin names, and nothing when that row cannot paint. The
> "first name-match" wording above and in §2.4 is retired everywhere it appeared, along with the
> send-time name-re-resolution the write needed to be safe. See §12's **W9** block.

### 2.2 Config shape — the clean fold, `config_version` 1 → 2 (owner-ruled)

> **Numbering correction (S0 audit, 2026-08-25):** this fold was recorded in-session as
> "schema 6→7" — a mislabel. **6 is the DB `schema_version`** (`app/db.py`), untouched by this
> phase; the config-shape marker is **`config_version`** (`config_migration/VERSION`), currently
> **1**, and this fold is its step **1 → 2**. The ruling's substance (the fold itself) is
> unchanged; every "schema 6→7"/"schema-7" shorthand in this document reads as `config_version
> 1→2`.

```yaml
media:
  write:                    # write-path tunables (per-operation naming)
    max_bytes: 15728640     #   15 MB (owner-ruled). gt=0. Detail never echoes the true size.
  namespaces:               # ← today's media.<ns> blocks move here ("write" would otherwise
    gacha:                  #   parse as a namespace — the fold is the migration's whole reason)
      roles:
        characters:
          files:            # ONE ordered list of per-item objects; replaces `order: [names]`
            - name: lyra-2.png              # a disk file (exactly one of name|bundled — a
              focal: {x: 0.42, y: 0.18, rev: "…"}   # discriminated union, validator-enforced,
            - bundled: pegasus              #   identities unique per role; council E10)
            - name: my-drop.png
              hidden: true                  # excluded from use, still in the library (§2.3)
      slots:                                # pins — the SAME identity union (W9, owner 2026-08-26)
        wallpaper: {name: lyra-2.png}       #   one of the owner's files, BY FILENAME
        oracle:    {bundled: lyra}          #   a shipped entry, by registry id
        # (null / absent = unpinned; the gallery's "Clear" writes null)
```

- **`files` is the unified per-item object list** (the 2026-06-24 extend-don't-migrate directive;
  Sanity/Umbraco's shape, R57 §6.1). List position = priority. Additive growth (`key`, `hidden`,
  `focal`, future `z`) — never a sibling map. **Item identity is a discriminated union**: exactly
  one of `name` (disk file) | `bundled` (registry id); `(kind, id)` unique per role (Emma #10).
- **A `slots` PIN is that same union** (W9, owner-ruled 2026-08-26 — see §12). It held a bare STEM
  until then, and a stem is ambiguous by construction: a file's stem and a bundled id are two
  identity spaces that both answer to `lyra`, and two files can share a stem inside one of them, so
  one pin value could mean two pictures with the collation deciding. One identity idiom config-wide
  now, one parser (`entryId` / `MediaIdentity`), and both arms validated exactly as a `files`
  entry's are — the `bundled` arm against the ids the seat's **source role** ships
  (`MediaSlot.source`, the backend registry's new per-slot object).
- **`hidden: true`** — the exclusion mechanism (council-renamed from `disabled`, which already
  means two other things in this subsystem — Opus sweep ②): a hidden entry stays in the gallery
  (dimmed) but is skipped by resolution everywhere. It is how a bundled default (or any entry) is
  retired from an all-entries role (rosters/dealt pools, where order cannot exclude). UI label:
  the **"In use"** switch. **`hidden` and `unusable` take OPPOSITE list treatments (Opus confirm
  sweep ②): `unusable` HOLDS its position** (the shipped `cycleAt` rule — one bad file must not
  re-deal the fleet) **while `hidden` is FILTERED OUT** (set-membership; re-dealing is its
  purpose). Never fold the two into one predicate; §11 pins the pair.
- **`focal: {x, y, rev}`** — the framing point (§5) **keyed to the file's `revision`** (Opus M2,
  restoring R57 §9⑤'s dropped safety clause): an in-place SSH overwrite under a stable name makes
  the stale focal wrong on every window; `rev` mismatch ⇒ treated as unset, framing sheet says
  "framing was reset — the file changed".
- **Named keys — metadata binding with the stem fallback as a PERMANENT rule** (Opus M7: not a
  legacy seam — "drop a file in and it binds" is the shipped owner-facing contract of the
  namespace and keeps working for SSH drops forever). **Precedence, per-item:** an item binds by
  its `key` field if present, else by its stem; a key's active art = first usable bound item in
  collation order (one mental model: priority). The detail panel names the binding source.
  Uploads always set `key`. On-disk layout UNCHANGED (no media-tree migration; the road not
  taken: per-key subfolders).
- **Migration `config_version` 1→2** (UPDATE_PLAN rules, no-legacy-seams): `media.<ns>` → `media.namespaces.<ns>`;
  `order: [n1, n2]` → `files: [{name: n1}, {name: n2}]`; **`slots.<key>: <stem>` → the typed union**
  (W9); `media.write` added; old keys deleted in the write-back. The migration is **config-pure**
  (steps never touch the filesystem — its own contract) and **lists no bundled `files` entry**:
  paint parity holds by construction via §2.3's fallback-tier rule. The addressable-name predicate
  is kept verbatim **and loosened by one character** (§3, defect #8 re-ruled). Idempotency +
  round-trip collation tests (§11).
  - **The pin half is where purity bit, and the contract won.** `Context` carries parsed documents
    and no `$CTRLB_HOME`, so a legacy STEM cannot be turned into the FILENAME the `{name}` arm
    holds. A stem that is a **bundled id of the seat's source role** is typed `{bundled: <id>}` —
    the registry is code, so that reads nothing on disk and is the exact complement of the
    bundled-free rule above (a pin names one picture and changes no tier). Anything else is
    **DROPPED**, and the drop is declared in `Plan.consumes`, so `--check`/`--apply` name it in the
    legacy-key list. Dropping beats both alternatives: an invented `{name: "lyra"}` would be a pin
    that can never resolve, persisted forever under a "verified" stamp, while an unpinned seat is a
    true statement that falls to its own ladder and is one tap to fix. A stem under an **unknown**
    slot key is left exactly where it was written — the config model refuses it by name, and folding
    it would turn the "W6" retirements' loud refusal into a silent deletion.

### 2.3 Collation — ONE chokepoint, server-side (council H2)

The **server is the collator**; `list_role` stays the one implementation. The rule:

1. `files` entries in list order — disk items resolved against the directory (dangling names
   drop and self-heal), **bundled items emitted as index rows** (`{bundled: <id>}`, no url — the
   client maps id → its Vite-hashed asset; the backend registry gains the per-role bundled id
   list, mirrored FE-side under the existing registry-mirror discipline);
2. then unlisted disk files (name-sorted — today's rule);
3. then unlisted bundled entries, **as the FALLBACK TIER**: they participate in RESOLUTION only
   when the theme's ladder falls through to them (§2.4) — exactly today's semantics, which is
   what makes the migration parity-free. An explicitly LISTED bundled entry is a full mixed
   citizen. **What a write may LIST is decided by its INTENT (AMENDED 2026-08-25 — owner ruling,
   S6; the box below is the record).** An **ORDER intent** — `moveBy` / `moveToEdge` /
   `setActive`, and therefore the drag — sweeps the WHOLE section into `files` in the resulting
   display order, unlisted disk rows and unlisted bundled rows alike, because that order is a
   statement about the section. **Every other intent** — `setHidden`, `setFocal`, `makeEligible`,
   `appendItem`, `removeItem` — lists only the entry it acted on, plus the disk tier (free: those
   rows already sit in the resolution prefix, so listing them changes nothing but their order).
   The `lib/mediaLibrary` transforms own this rule; §11 pins every arm.
   **AMENDED AGAIN 2026-08-26 (owner, the re-poke — "W7"; D66's amendment is the D-entry):
   switching an entry OUT OF USE is an order intent too, wherever order is the section's priority
   system (`caps.reorder`) — and the order it states is the one already on screen.** The write is
   `sweep` + `displayOrder(rows)` UNCHANGED + `hidden: true` on its one entry: **an unticked image
   dims in place and does not move**, and re-ticking it puts it back in use from the same place.
   Membership never moves a picture; arranging is the drag's job. The sweep is what BUYS that
   stillness — listing only the bundled row the tap acted on collated it to the FRONT of the grid,
   because a listed entry precedes the whole fallback tier. Its other half is the **bare-entry
   guard** on the un-hide: clearing `hidden` off a bundled entry that would be left as bare
   `{bundled: id}` DROPS the entry instead, in any role whose bundled tier is not fully listed —
   otherwise that entry becomes the section's sole own-tier member and `ladderRows` deals one
   picture to the whole fleet. A fully-listed (swept) role keeps the entry: there it is one member
   of a stated order and dropping it would move the picture. Sections where order decides nothing —
   a named role's per-key gallery — keep the minimal write, because sweeping a role that binds by
   NAME would list other keys' bundled rows for no reason.

> **THE §2.3 ③ AMENDMENT (owner-ruled 2026-08-25, S6 triage). The rule this replaces read: a write
> may sweep unlisted DISK rows but NEVER unlisted BUNDLED ones — "only the bundled entry the owner
> explicitly acted on becomes listed", so that the owner's first drag could not promote five bundled
> characters into the fleet deal (Opus confirm ①, split by tier at his final confirm).**
>
> The owner round found it broke the feature it was protecting. In a section whose entries are ALL
> unlisted bundled defaults — which is every theme section of a fresh install — a partial listing
> cannot express a position at all: every downward drag clamped to the row's own index and snapped
> home, and `moveBy([], rows, "b:lyra", -2)` over the five-character roster wrote `[lyra, 3]`, which
> collates as `[lyra, 3, pegasus, atlas, 4]` — not the order asked for. Worse, the same partial
> listing SHRANK THE DEAL: after one ↑/↓ swap on a fresh characters section `files` held the two
> swapped ids, `ladderRows`' own-tier-replaces-fallback rule read them as the owner's whole tier, and
> the fleet was dealt two portraits instead of five.
>
> **The owner's ruling: reordering the shipped cast IS the feature.** A drag that will not move is a
> worse answer than a config file naming art it already paints, and the defaults are ordinary library
> entries — visible, reorderable, hideable. An order write therefore states the whole section's
> order, and a full sweep is the same art in a new order.
>
> Two consequences, both deliberate:
>
> · **The VIRGIN section is untouched.** A role nobody has reordered still has an empty `files` list,
>   so an upload into it replaces the bundled tier exactly as before and the `config_version` 1→2
>   migration stays paint-parity-free (§2.4). After a sweep the defaults are owner-tier members and an
>   upload joins them at the end, per the S3 additive rule.
> · **In a MIXED section the first order write changes the DEAL.** Owner files beside unlisted
>   defaults deal the files alone; once an order write lists everything, the defaults are in the
>   owner's tier and are dealt beside them. That is not paint-neutral and is the ruling's real cost.
>   The In-use switch is how a default leaves again — exactly as it is for a file — and §6.6's
>   **Restore defaults** is the way back for the whole section. Flagged for the owner's eye in S6.
>
> `lastExpressible` and the drag's `limit` clamp are DELETED with the old rule: every position is
> expressible now, so a drop lands where the owner put it.
4. **The wire carries the WHOLE truth, so resolution is decidable from the index alone (Emma
   confirm E2):** the index emits **every** entry — hidden ones included, marked — and each row
   carries its per-item facts: `focal`, `hidden`, `key` (the binding override — the S1
   main-seat rider: a resolver may not read config to learn whether key or stem bound a
   file), and **`listed`** (true for a `files` entry,
   false for an appended fallback row; on bundled rows this is exactly the listed-vs-fallback
   tier distinction the ladders need — e.g. gacha's role-presence-before-usability predicates
   read `listed`/disk rows only, and fall through to fallback rows precisely as they fall
   through to bundled art today). **Resolution skips `hidden`; the gallery shows hidden rows
   dimmed** — one index, two consumers, no config side-channel. `MediaIndex.collation` is
   re-versioned **`library-v1`** (Opus sweep ① — the contract string states the new rule).

**Pins resolve against the collated library** — first entry whose stem (disk) or id (bundled)
matches. **The stem/id tie-break is stated in the pin hint, and the pin row surfaces a duplicate
note when both a file stem and a bundled id match** (Opus sweep ③ — the old claim leaned on
diagnostics that never ran there; composes with defect #4's dedupe work in S2).

### 2.4 Active resolution — theme-owned, registry-declared (council H1)

"Which image is live" is **theme-ladder knowledge** (`wallpaperArt`'s pin → kit background →
bundled scene; `oracleArt`; `serviceIconFrom`; …). The gallery is namespace-generic by
construction and must never re-derive a ladder (the shipped rule: *"the gallery cannot claim a
binding the render will not honour"*). **Each section descriptor therefore declares an `active`
resolver — one function, supplied by the theme module that already owns the ladder, imported by
BOTH the paint site and the gallery** (the same seam shape as `MediaSlotDef.from`/`bundled`). It
returns the active/used entry ids + the mode word (`all` / `first` / `deal`) **+ an optional
`overriddenBy: {sectionId, label}` (Opus confirm ②) for the half of gacha's ladders where the
winner lives in another section** — when the oracle PIN beats the oracle pool, the pool
section's card truthfully reads "Currently set by <seat> →" and links the seat section, instead
of painting a phantom its own grid doesn't hold or claiming emptiness. **Import direction is
pinned (Opus H1 rider): the registry may import the theme ladder modules
(`themes/*/roster.ts`, `kit/ownerArt.ts`, `frontier/ownerArt.ts`); those modules never import
the registry back** (the store↛registry lesson) — and since the import exists, the FE bundled-id
rows are DERIVED from `defaultRoster()`/`ART`, never hand-mirrored. **Resolvers are pure
functions of the index rows + the wire's slots — never of config directly** (the §2.3 ④ wire
facts make that sufficient: `listed`/`hidden` on every row). Ladders keep their shipped fallback
predicates untouched — which is precisely why upgrade paint-parity needs no filesystem-reading
migration (Emma #2, re-derived; the `listed` fact is what makes the predicates implementable,
Emma confirm E2).

### 2.5 No collisions, by construction

Filenames carry no user-facing meaning. Uploads mint auto-unique names: sanitized stem
(admission predicate, §3), **truncated on a code-point boundary with the UTF-8 byte budget
reserved for extension + the largest suffix** (Emma #7); on clash `-2`, `-3`, … to a **fixed
attempt cap, then the timestamp fallback**; the server's plain 409-on-exists is the race guard,
auto-retried with the next suffix — never a dialog. The v1 revision/overwrite/Replace machinery
stays deleted (replaces do not exist). `classifyNamed` duplicate diagnostics remain for SSH-drop
duplicates (defect #4).

## 3. The backend write API

```
PUT    /api/media/{ns}/files/{role}/{filename}      body = raw png|jpeg|webp bytes
    -> 201 MediaFile · 404 · 409 name exists (race guard) · 413 over media.write.max_bytes
       415 extension/bytes disagree · 422 filename/empty body
DELETE /api/media/{ns}/files/{role}/{filename}      -> 204 | 404
```

- **Persist pipeline** (R55 §4.4, unchanged): mkstemp `.part` in the role dir → fchmod 0644 →
  stream+count → 413 → fsync → probe → 415 → `os.link` (no-clobber, 409) → unlink tmp →
  `fsync_dir` → `describe_file`. `.part` boot sweep. `fsutil._fsync_dir` promoted public.
  No lock (mkstemp + atomic link).
- **Filename rules, two tiers, one home (`core/media.py`):** addressable tier = today's config
  semantics **with the `\` clause REMOVED from the bare-filename predicate** (defect #8
  RE-RULED by council M5: tightening `is_served_file` would make a currently-painting POSIX
  file vanish from the fleet; the config check is self-described defense-in-depth, so the
  zero-regression fix is to let config express what the index already serves — `/`, `.`, `..`,
  empty stay rejected; `is_served_file` is untouched and keeps meaning "will this surface serve
  it"). Admission tier for new uploads unchanged: NFC-required, no `<>:"|?*`/C0/DEL/U+FFFD, no
  leading dot / trailing dot-space, `ntpath.isreserved`, ≤255 UTF-8 bytes, allowlisted extension;
  reject with the reason, never sanitize.
- **DELETE touches no config**; delete-active-promotes-next is a client composition —
  **DELETE-first, then the config write; a cleanup failure leaves a dangling entry that drops
  harmlessly at collation** (Emma-verified degrade path; partial success reported).
- Shared URL with the read mount stays safe (`Match.PARTIAL`); router registered before mounts.

## 4. The client upload pipeline

- **Picker** (R54): hidden input, explicit `accept`, no `capture`, `input.value` reset,
  drag-drop + paste riders. **Single-file per pick.**
- **Input guard:** 15 MB → header-parsed **64 MP** (Honor 20 = 48 MP; ≈ Chrome/Android RAM÷25 on
  6 GB; guards the PNG/WebP full-size decode path) → HEIC/TIFF/SVG refused by name →
  `createImageBitmap` proof. Named registry constants (customizable principle). Dimension reader
  fenced by the shared fixture corpus.
- **Crop** (unchanged): react-easy-crop@6.2.3, free-ratio, confirm-untouched = "use as is",
  cancel unwinds; the crop centre seeds the focal point.
- **Export** (unchanged): worker `OffscreenCanvas.convertToBlob`, `drawImage` never
  bitmap-crop-rect, pixels capped to the role bound, readback check, `blob.type` naming the
  extension, EXIF/GPS stripped, webp q0.90-alpha / jpeg q0.85, per-role `export` override
  (brand/stack png; lossless skips the byte step-down), one step-down retry then badge.
- **Upload → register, as a two-phase job with idempotent retry** (Emma #4): PUT the blob →
  201 → ONE config write appending `{name, key?, focal?}`. The failure row persists the
  **minted filename + phase**; a retry after a 201 **never re-uploads the blob** — it reconciles
  against the index/config and retries only the registration for that exact identity.
- **Write serialization** (Emma #3, re-derived lean): ALL media config writes flow through the
  one existing gallery chokepoint (`patch`), **queued client-side and recomputed from the latest
  state at send time** — two sections' jobs can't replace each other's list. The two-devices-
  simultaneously lost-update remains an **accepted residual** (single owner; consistent with the
  standing micro-window rulings). Server-side revision tokens = the road not taken.
- **ONE admission path** (Opus M8 — the v1 per-section latch was accordion residue): the entry
  card always opens the gallery; the gallery's labeled **Add row is the single upload
  entrance**; exactly one section is ever visible, so ONE job latch (a synchronous in-flight
  ref, not rendered state) guards admission. The v1 second per-section flag is deleted.

## 5. The focal point (v1; R57 + council H3/E1/E6 folded)

- **Value:** per-item `{x, y}` 0..1 (2 decimals; absent = unset), `rev`-keyed (§2.2).
- **Control:** fixed centre reticle over a pannable image (react-easy-crop reused; focal = crop
  centre, one line; no occlusion), tap-to-place coarse entry, transient rule-of-thirds flash.
  **Flow:** upload seeds focal silently; editing = **"Set framing"** on the item detail —
  editable any time. **Framing previews:** one small window per destination, geometry from the
  registry's preview descriptors — **declared coarse and captioned "previews are examples"**
  (Statamic's honesty; council M4 partial: preview aspects are approximations by design, the
  real surfaces' CSS stays the paint authority; where a card aspect must be exact it gets the
  house invariant-test treatment).
- **The math, with its guard as part of the contract (Emma #1 — HIGH):**
  `P(f, s) = s ≤ 1+ε ? 0.5 : clamp01((f·s − 0.5)/(s − 1))` per axis — under cover at least one
  axis has s = 1 (division by zero in the bare formula; NaN would void the whole
  `object-position`). Exact-1 and near-1 test arms pinned.
- **The render contract is a property of the ITEM, not the call site (council H3):** one
  `focalPosition(item, box)` where an item carries its mapping mode — owner items = centred
  `{x,y}`; **bundled items = `mode: proportional`** (their hand-tuned strings, untouched
  semantics). Every consumer becomes a per-window `useFocalPosition(ref, item)`
  (ResizeObserver-measured box): **the `--cv-focus`/`--cv-hero-focus` CSS inheritance chain is
  REWRITTEN** (a centred value is a function of each window's own overflow — it cannot be
  published once and inherited by two windows), and `coverHeroFocus`'s percentage-point
  arithmetic is re-expressed as a per-window fractional offset. **S4 is honestly sized: a
  rewrite of ~10 paint sites, not plumbing reuse.** A surface that cannot measure falls back to
  proportional (visible, weaker — recorded). Cover surfaces only (`contain` + focal is actively
  wrong); the registry says which roles offer it — **`MediaRoleDef.framable`, declared for gacha's
  `characters`/`banner`/`oracle` in v1** (§12's S4 as-built states why frontier's and the kit's cover
  roles are not, and which one surface takes the proportional degrade).
- **Bundled entries are non-framable in v1** (Emma #6: converting a hand-tuned proportional
  value through the reticle produces a visible no-op-edit jump; a per-entry focus-mode edit
  path is the recorded future).
- Future recorded, not built: `z` zoom (additive field), per-destination crop overrides, region
  hotspot (rejected for v1).

## 6. The gallery (R59 + council folds)

- **6.1 Entry affordance:** **one card per DECLARED destination** (council H5, refining the
  uniform-scope ruling — **OWNER-RATIFIED 2026-08-24**; the owner's own alternative, one POOLED
  family gallery whose image ORDER maps positionally onto the PCs/services, is the recorded
  road-not-taken: positional binding makes a reorder silently re-assign which machine gets which
  picture, and a fleet add/rename shifts every assignment — per-key libraries keep bindings
  explicit; revive only on the owner's ask if the two-tap flow annoys in practice): pool roles and static named keys (frontier's 3 stack
  layers) get their own card; **data-derived key families (`kit/services` ×2, `kit/hosts`) get
  ONE role card** carrying the key list (today's RoleSection shape) — tapping a key row opens
  the SAME gallery modal scoped to that key, and an **"Unassigned" bucket** homes files bound to
  no key (a rename's aftermath — otherwise invisible and undeletable). Every key still has its
  own gallery; the Conf tab doesn't grow dozens of art-painting cards. The card: full-width,
  destination-shaped (`aspect-ratio` from the registry), painted with the **active image per the
  §2.4 resolver**, status line + warning chip; multi-active = collage + the mode word from the
  same resolver; **when the resolver reports `overriddenBy`, the card says "Currently set by
  <seat> →" and links that seat section** (§2.4 — never a phantom image its own grid doesn't
  hold). Empty = "Add an image" face (opens the gallery, §4). Gutenberg a11y shape. No
  hover-revealed actions.
- **6.2 Container:** full-screen modal on the house dialog shell (`role="dialog" aria-modal`,
  `lib/focusTrap`, Escape, focus restore; never `BottomSheet`). **The Android-Back guard is a
  shared hook `useOverlayBackGuard`** (Opus H4 — second/third customers already exist) with
  **one close primitive** (Emma #5): UI close (✕/Escape) calls `history.back()` and the
  `popstate` handler is the ONLY closer — no orphaned history entries, re-entry guarded.
  Chrome: ✕ + section title; the labeled `Add an image` row (≥56 px).
- **6.3 Grid:** 3 columns; tiles at the role aspect (square unknown); gap/gutter 12–16 px; kit
  radius. Corners: bottom-end = in use (24 px check + 2 px accent ring) · top-end = problem ·
  bottom-start = origin (bundled glyph). **Decode budget stated** (Opus M3): `loading="lazy"`,
  `decoding="async"`, `content-visibility: auto`, in-flight decode cap — the grid paints
  originals (no server thumbnails by ruling) and libraries grow monotonically. **The SW
  `ctrlb-media` bound is re-based on a plain generous constant with a written rationale**
  (the registry cannot derive library sizes — the v2.0 rider line was wrong).
- **6.4 Item detail panel** (tap a tile): filename, dimensions/size, badges spelled out, the
  binding source (key vs stem, §2.2), and the capability-gated actions: Set as active / Use here
  · Set framing · In use · Delete (absent on bundled). Tap = open detail, never tap = apply.
- **6.5 Selection & state:** `files` order stays the storage; **Set as active = move-to-front**;
  seat sections write the pin ("Use here") — **as the identity union, derived from the tapped row**
  (W9): `{bundled: <id>}` for a shipped entry, `{name: <filename>}` for one of the owner's files.
  The send-time check is then the whole of the rule — *is this row in the tier the seat deals, and
  can it paint* — with no name to re-resolve, and the detail panel's "In use here" / dangling-pin
  comparisons are by id (the notice still prints the human half). In-use marks from the §2.4 resolver: first-wins →
  the active tile; roster/pool → check per used member, `hidden` entries dimmed, rotation said
  in words (no live "currently painted" tile for dealt pools — the field's honest form).
  **A `hidden` entry dims WHERE IT IS** ("W7", owner 2026-08-26): membership never moves a picture,
  so the off state is carried entirely by the tile's own look — dimmed + desaturated art under the
  hollow corner ring — and the accent ring means ACTIVE, on active tiles alone.
  **a11y (Emma #9):** tiles stay plain dialog-opening buttons — membership lives in the
  accessible description; `aria-checked` only on the detail panel's real "In use" switch;
  `aria-current="true"` on a genuinely current item. Delete-active promotes the next entry in
  the same write; delete keeps `requestConfirm`; no undo toast.
  > **S2 AS-BUILT — the review wave (main-seat ruled 2026-08-25, all 9 Emma findings ACCEPTed).**
  > · **Activation GUARANTEES eligibility, atomically (#1).** Both spellings of "this one, please"
  >   leave the entry actually resolvable, in ONE queued patch: move-to-front also clears `hidden`
  >   (a hidden entry at the front is still skipped everywhere), and the in-role pin write also
  >   LISTS an acted-on fallback bundled row (§2.1's as-built note). Neither may land as two writes
  >   — half of it is exactly the claim the gallery exists to prevent.
  > · **The DEGRADE rung is per-payload, not per-result (#2).** A theme ladder may restore its
  >   shipped art only while the payload never described the role's bundled tier (a stub, an e2e
  >   mock, a proxy answering `{}` — `lib/mediaLibrary#offersBundled`). A role whose tier IS on the
  >   wire and resolves to nothing paints NOTHING: that is what the In-use switch means, and
  >   resurrecting the default would make the card's "nothing in use" a lie. Audited across all
  >   three ladder modules; `kit` needed no fix (it ships no bundled art) and carries a pin.
  > · **THE QUEUE'S ONE INVARIANT (#1/#4, restated at Emma's confirm round): every write is computed
  >   from AUTHORITATIVE state at SEND time; no authoritative state, no write.** A job is an INTENT
  >   and its patch is a function of the freshest cached settings + index, `null` being its honest
  >   refusal. The rule used to hold only of the `files` half, and both carve-outs were holes:
  >   a PIN's ELIGIBILITY (is the target `hidden`? is it a fallback-tier row needing listing?) was
  >   decided when the owner TAPPED, off the rendered item — so hiding an entry and activating it
  >   before the refetch landed minted a scalar-only pin onto an entry that was already hidden; and
  >   the timeout discard SPARED scalar jobs, so that pin survived the very timeout meant to stop it.
  >   Now eligibility is recomputed at send from the index, and a refetch that misses
  >   `MEDIA_REFETCH_TIMEOUT_MS` (`useSaveSettings#onMediaStale`) discards **every** remaining job
  >   with a toast: a dropped write costs one re-tap, a retained one writes a binding nothing
  >   honours. `busy` still releases in `finally`.
  >   **Eligibility is THREE-valued** (her final confirm): `ready` · a `files` transform · `refuse`,
  >   the last nulling the whole job. "No `files` half needed" and "cannot be made to resolve from
  >   here" were one value, and the caller read both as pin-only-safe — so a SEAT asked to use a
  >   bundled source row that has since been retired, or any pin whose target is ABSENT from the
  >   send-time index, wrote a binding nothing could honour. A seat refuses on a bundled row
  >   specifically: both repairs (listing it, un-hiding it) put that row into the SOURCE role's own
  >   tier, which is the collapse judgment A forbids. The question itself is `ladderRows` — the same
  >   §2.3 rule the pin will be looked up in, so it cannot drift from it.
  > · **The Android-Back guard is a STACK with per-entry identity (#5),** and `ConfirmDialog` joins
  >   it with its own entry: Back cancels the top-most confirm, the gallery under it stays, the next
  >   Back closes the gallery. One shared `popstate` listener; only the popped TOP owner closes.
  >   **`close()` is idempotent while its pop is in flight** and returns whether THIS call took the
  >   exit (her confirm round): closing is asynchronous and the overlay stays mounted through it, so
  >   a second gesture used to spend a second history entry — and, in the confirm, to rewrite the
  >   first one's answer (Enter then Escape cancelled a confirmation already given, and the reverse
  >   confirmed a destructive action just cancelled). The FIRST exit decision wins.
  > · **The stem/id pin note (#6, §2.3's owed sentence).** In a pin-capable section a file stem and
  >   a bundled id that answer to one pin value carry the duplicate badge plus a sentence stating
  >   the tie-break — collation order wins, and "Set as active" is how the owner changes it.
  > · **DELETE partial success (#7).** The bytes go first, so a failed config cleanup toasts
  >   "…was deleted, but the library entry could not be cleaned up — it will drop on its own",
  >   never a bare save error (which reads as "the delete failed").
  > · **One `?rev=` stamp (#8).** `ResolvedArt.url` is paint-ready at every rung, the kit rung
  >   included; consumers paint it and stamp nothing — a second stamp gave one file two cache keys.
- **6.6 Bundled entries:** one grid, mixed by priority once listed (§2.3); origin glyph +
  "Bundled" in the detail; undeletable (action absent, not disabled); non-framable in v1 (§5).
  **EVERY shipped picture is one** (owner ruling 2026-08-25, S6 — "all shipped default art must be
  represented in the gallery, overridable, none left behind"): the two roles that deliberately
  listed none (gacha `oracle`, frontier `hero`) carry their asset's own stem, gacha's orphaned
  `rook` joined the cast, and the cosmos service-banner set became the `kit/service-banners`
  bundled tier with a **rotation** section of its own. The only art that is NOT a library entry is
  art belonging to no role: a SEAT's built-in fallback (gacha's `banner.webp`), shown read-only on
  the seat card and in its gallery through `MediaSlotDef.builtin` — no hide, no order, and the
  unpin is its restore. **Restore defaults** (per role section, `requestConfirm`) — **RE-RULED
  2026-08-26 ("W8"), the owner's words: *"put them first and activate them and you deactivate the
  other ones — as if the defaults are the one selected, and I just uploaded the other images that are
  there."*** So it is an **ORDER INTENT**: the section's bundled entries go to the TOP in the
  REGISTRY's shipped order, listed and in use, and the owner's own files keep their relative order
  BELOW them and are switched OFF — still in the library, with their framing, their `key` and
  everything else untouched. Nothing is deleted; deleting uploads is what Delete is for. Under the one
  priority system that IS "the defaults are the selection" in every mode at once (first-wins paints the
  first default, a dealt role deals the default set, an `all` role shows the default slides). The S6
  mechanism — drop every `bundled:` entry so the FALLBACK tier answers — is superseded: it could not
  express the ruling at all, because the owner's tier outranks the fallback tier whole, so with one
  upload present the restore left that upload painting. The registry's id order is theme knowledge the
  pure transform cannot see, so the HOOK passes it down (`section.def.bundled` → `b:<id>`), the same
  split `toggleHidden`'s `ordered` flag runs on. Offered where the section ships art and shows anything
  other than its defaults — a listed default, a hidden entry, or a file of the owner's own (a
  DIFFERENCE test, not an equality one; a spurious button that rewrites what is already there costs
  nothing) — and scoped to what is on screen (a key gallery restores its own layer).
- **6.7 Rider fixes** (defect register §8): the `?rev=` freshness class closed at every paint
  site; SW cache single-keyed + re-based bound; the media index query scoped to the Conf
  surface.

## 7. Reorder (R58; drag primary)

Extend `useDragReorder` (never dnd-kit: +15.3 KB gz, frozen pre-React-19 line). Gap work
G1–G10 (~150 TS + 25 CSS + 40 tests), order G6/G5 → G1 → G2 → G4 → G3 → hygiene; the field's
displaced-motion numbers are literally our `--dur-slow`/`--ease-std` tokens. **The held-commit
state machine is explicit (Emma #8):** success holds the transform until the authoritative
refetch lands; **error releases in `finally`** — snap back to the pre-drag order, clear
autoscroll/transforms, keep the error toast; drag start is refused through a synchronous
in-flight ref. ↑/↓ buttons stay (WCAG floor, ≥44 px) with move-to-top/bottom in the detail
panel; both drag and buttons hidden where order is meaningless.

## 8. The defect register (12 verified findings; fix homes — #8 re-ruled per §3)

| # | sev | defect | fix home |
|---|---|---|---|
| 1 | HIGH | `?rev=` missing at ~10 paint sites (resolvers drop `revision`) — stale art fleet-wide after in-place replaces | S2 |
| 2 | MED | SW cache double-filled (bare vs `?rev=` keys) vs `maxEntries: 64` | S2 (single-key via #1; re-based bound §6.3) |
| 3 | MED | media index refetches both namespaces on EVERY window focus once Conf opened | S2 (scope to the Conf surface) |
| 4 | MED | duplicate pool stems invisible; pin select emits duplicate options | S2 (+ §2.3's stem/id pin note) |
| 5 | MED | 3 gacha pins empty on fresh installs | dissolved by §2.3 (bundled ids on the wire); registry rows S0 |
| 6 | MED | fixed namespace stays disabled till restart; message silent about it | S1 (one sentence) |
| 7 | MED | "unreadable file" mislabels unsupported formats | S1 (one string) |
| 8 | MED | backslash filename breaks reorder with an opaque 422 | S1 — **RE-RULED (council M5): drop `\` from the bare-filename predicate** (config accepts what the index serves); `is_served_file` untouched |
| 9 | LOW | alpha-art thumbs invisible | S2 (checkerboard + contain) |
| 10 | LOW | stacked "Settings saved" toasts per reorder tap | S2 (quiet flag on `patch`) |
| 11 | LOW | ↑/↓ shown where order is meaningless | S2 |
| 12 | LOW | a11y batch (headings, `role="status"`, badge text, img attrs) | S2 |

Audited sound (don't re-tread): reorder concurrency, failed-PUT surfacing, object-URL hygiene,
write shape, Conf-draft isolation, `(missing)` pins, backend probe/collation/containment.

## 9. Performance & Phase-19 fit (council M6)

`build_index` stats + header-probes every file per GET; the library model grows the tree by
design. **Recorded as the Packet ④ item** (revision-keyed memo seam = the SYS-8 recorded home)
with an expected-library-size note so H1's media baseline is taken AFTER this ships; the new FE
modules (§12) are logged in HARDENING §7b's delta register in S0 so Packet ⑤ audits a real
inventory. Defect #3's scoping fix addresses frequency; the memo addresses unit cost — both
recorded, neither silently absorbed.

## 10. The ruling ledger (2026-08-24 decision session — ALL CLOSED)

① kill switch DROPPED (unconditional; toggle-rule waiver recorded) · ② config = the clean fold,
"schema 6→7" (= `config_version` 1→2 — the §2.2 numbering correction) · ③ 15 MB · ④ 64 MP (Honor 20) · ⑤ free-ratio ratified; "derive from the element" =
the framing previews · ⑥ focal IN v1 · ⑦ collisions designed away (additive-only, auto-unique) ·
⑧ drag primary (extend the house hook) · ⑨ single-file pick · ⑩ 1.7.x; 1.8 RESERVED · plus: the
LIBRARY model · bundled defaults first-class · per-key scope (§6.1's H5 role-family-card refinement
OWNER-RATIFIED 2026-08-24; the pooled positional-order family gallery = the recorded
road-not-taken) · full-screen gallery · in-use highlight per §6.5 · D65 RATIFIED as amended ·
push after the council closes + the owner's final read.

## 11. Test obligations

BE: R55's pin list (delete-vs-config · symlink 404 · double-delete · traversal/encoded-separator
404 · `.part` invisible) + streamed-cap 413 both body kinds + 415 leaves no bytes + `os.link`
409 + mode 0644 + the two-tier predicate (upgrade arm incl. **a backslash-named order entry
loading AND reordering after the predicate loosening**; `%FF` → 422; DOS-device names → 422) +
boot sweep + the no-CORS invariant + architecture guard + **config_version-2 migration arms** (fold +
files transform + write-back deletes old keys; idempotent; **a populated v6 config round-trips
to identical collation output, incl. the all-unusable-role arm** — parity is by construction,
the test proves it) + **collation arms** (hidden skipped · unlisted appends · fallback-tier
bundled · listed-bundled mixing · pin over stem/id + the duplicate note · discriminated-union
validation: `{name,bundled}` both → 422, duplicate identity → 422) + **wire arms** (`MediaFile.
focal`/`hidden`/`listed` merged; hidden rows present-but-marked; bundled rows carry id + `listed`,
no url; a fallback bundled row vs a listed one distinguishable from the wire alone — the E2 arm;
`collation: "library-v1"`; resolver purity: active resolvers consume index+slots only) +
**intent-scoped writes** (§2.3 ③ as AMENDED 2026-08-25: an ORDER intent sweeps the whole section
— the EXACT-EXPRESSION property arm, for any from/to over any mix of tiers, plus the
all-defaults section in both directions and a browser drag downwards inside one — while every
other intent lists only what it acted on; the drag-past-an-SSH-dropped-file arm still commits and
holds; **as AMENDED 2026-08-26 ("W7"): switching off in an order-priority section sweeps and states
the order VERBATIM — the untick → re-tick round trip leaves the same list in the same order with
nothing hidden and the whole tier dealt, a per-key section keeps the minimal write, and the
bare-entry guard drops an entry left saying nothing in a role that was never swept while keeping a
non-bare one and keeping a bare one in a swept role**) + **restore defaults** (**as RE-RULED
2026-08-26, "W8"**: offered wherever the section shows anything other than its defaults · the bundled
entries lifted to the TOP in registry order and un-hidden, the owner's files below them switched off
with their per-item fields whole · scoped to the rows on screen · the round trip back through the
In-use switch) + **`overriddenBy`** (pin
beats pool → the pool card carries the seat pointer, no phantom active) + **the
`hidden`-vs-`unusable` pair arm** (unusable holds position · hidden filtered out — asserted
side by side so neither predicate absorbs the other). FE: entry
cards (active from the §2.4 resolver · collage + mode word · status chip) · the H5 role-family
card + key rows + Unassigned bucket · gallery modal (focus trap · Escape-via-history.back ·
popstate single-closer — the orphan-entry regression arm) · grid corners + a11y (description-
carried membership · `aria-checked` on the switch only · `aria-current`) · set-active both kinds
(move-to-front · pin write; seat sections read-only otherwise) · delete-active-promotes-next
single write · hidden toggle dims + excludes **IN PLACE (the "W7" grid arms: dim + hollow corner +
unchanged position checked against the written order; the ring means ACTIVE and only that)** ·
bundled undeletable/non-framable · auto-unique
naming (byte-budget truncation · suffix cap · timestamp fallback · 409-race retry) · the ONE
admission latch (sync ref) · two-phase upload retry (never re-uploads after 201) · serialized
`patch` queue (recompute-at-send; interleaved sections) · crop modal state machine · export
worker arms · focal: `focalPosition` table (exact-1 · near-1 · clamps · proportional mode ·
missing w/h) · `useFocalPosition` fallback · framing previews from registry + the "examples"
caption · drag (displacement pure fn · autoscroll curve · held-commit success/error release ·
sync-ref drag refusal) · defect regression arms (#1 rev per resolver · #3 no focus refetch when
Conf inactive · #4 dedupe+badge · #10 quiet write). E2E: one full round-trip (open section →
upload → crop → active → framing → drag reorder → delete → bundled fallback paints) + the
Back-gesture close. Stylelint: `image-orientation` disallow.

## 12. Slices (each: Opus build from a pinned brief → main-seat audit → Emma-lane review → owner eyeball)

**The FE module map is PINNED (council H4). Acceptance line: `ConfTab.tsx` gains ZERO net
lines — `MediaGallery` stays its single child and hosts the modal.**
Pure: `lib/mediaLibrary.ts` (**config transforms only** — setActive / toggle-hidden /
delete-promote / append / the tier-preserving write rule — unit-tested like `lib/media.ts`,
**taking section descriptors as ARGUMENTS: `lib/` stays theme-free** — the descriptors + active
resolvers live in `theme-engine/mediaRegistry.ts`, the module allowed to know themes; Opus H4
confirm rider) · `lib/focalPosition.ts` ·
`lib/imageExport.ts` + worker. Hooks: `hooks/useMediaLibrary.ts` (index + settings + registry →
sections; owns busy, the serialized quiet `patch` queue, invalidation) · `hooks/useMediaUpload.ts`
(pick → guard → crop → export → PUT → register; owns the latch + two-phase retry) ·
`hooks/useFocalPosition.ts` · `hooks/useOverlayBackGuard.ts`. Components:
`components/media/{SectionCard, GalleryModal, LibraryGrid, ItemDetail, FramingSheet, CropModal}.tsx`.

| slice | content | gate |
|---|---|---|
| S0 | docs: D65 · SECURITY_MODEL §2.x · MEDIA_PLAN amendment · SPEC · doc-map row · RESEARCH pins · backend+FE registry bundled-id rows (**retire `MediaSlotDef.bundled`** — M4 rider; **FE ids derived from `defaultRoster()`/`ART`, not hand-mirrored** — H1 rider; **"coarse, examples only" in the preview-descriptor TYPE's doc comment** — M4 confirm ask) · ROADMAP/TODO · HARDENING §8.2 rows + §7b FE-module delta entries (§9) · docstring truth pass | docs-only commit |
| S1 | backend: write API · `config_version` 1→2 migration · `media.write` · collation v2 + wire (`focal`/`hidden`/bundled rows/`library-v1`) · predicate loosening (#8) · `.part` sweep · `fsync_dir` · defects #6/#7 · BE tests | full gate + curl round on dev |
| S2 | gallery: section descriptors + active resolvers (H1) · entry/role-family cards · modal + `useOverlayBackGuard` · grid + detail panel · set-active/use-here/promote/hidden · defect #1–#4, #9–#12 · e2e | full gate + e2e |
| S3a | pure: imageExport + worker + guard + fixture fence | full gate |
| S3b | wiring: picker + CropModal + useMediaUpload (latch · naming · two-phase retry · failure rows) + add-row live | full gate + e2e arm |

> **S3a/S3b AS-BUILT (2026-08-25) — four notes, three of them deviations from this document.**
>
> · **The pure module is THREE modules.** The map above pins `lib/imageExport.ts` + worker; the build
>   split off `lib/imageProbe.ts` (the header reader + the guard ladder) and `lib/uploadName.ts` (§2.5's
>   minter). Each is a different subject with its own fixture fence, and folding a byte-level format
>   parser into the export module is how a 500-line file nobody re-reads gets made. The pin's SUBSTANCE
>   is intact — every one of them is pure, takes its policy as an argument, and imports no registry.
> · **The upload's tunables live in `theme-engine/mediaRegistry.ts#UPLOAD_LIMITS`** (64 MP · the 15 MB
>   fallback · the head slice · the name budget · the suffix-attempt cap · the 409 race cap), with
>   `UPLOAD_ACCEPT` beside it and a per-role `export` override on `MediaRoleDef` (`kit/brand` and
>   `frontier/stack` force PNG). `media.write.max_bytes` stays the SERVER's, read off the settings
>   snapshot.
> · **NO `focal` is seeded by an upload (§4's "the crop centre seeds the focal point" is VACUOUS here,
>   and is not built).** What gets stored IS the crop, so the framed subject is at the centre of the
>   stored file by construction: the seeded value would be `{x: 0.5, y: 0.5}` for every upload, crop
>   and "use as is" alike — which is exactly what an ABSENT focal already means (§5). Writing it would
>   put a redundant default in the owner's config and make every uploaded file look deliberately
>   framed. **S4 owns focal entirely**, where it earns its keep: one library feeding windows of
>   different shapes. Flagged to the main seat, not absorbed.
> · **THE S3 REVIEW WAVE (Emma lane, blind; main-seat ruled 2026-08-25 — all 6 findings ACCEPTed with
>   her lean fixes as written).** Five of them are one theme: *a fact must come from the thing it is a
>   fact about.*
>   · **The job carries its own DESTINATION** (#1). `run`/`deliver` read the LIVE section, so closing
>     the gallery while the worker was exporting left them with nothing to deliver to — and they
>     returned without releasing the latch, so every Add row in every gallery silently refused every
>     pick for the rest of the session. The section and scope are bound into the job at ADMISSION and
>     never re-read; closing the gallery now means the owner stopped watching, not the upload stopped.
>   · **The unknown-outcome reconcile must be a DEMONSTRABLY FRESH read** (#2). `invalidateQueries`
>     refetches active observers and swallows a failed refetch, handing back a cache that PREDATES the
>     upload — the exact failure the reconcile exists to recover from, and the retry then stored a
>     second copy under the next suffix. It is now the query's own fetcher called DIRECTLY
>     (`useMedia#readMediaIndex`): fresh, throwing, and invisible to the cache — a cache-writing read
>     published its own transient failure to the gallery and unmounted the panel the failure row had to
>     appear in (found while building the arm). A failed reconcile keeps the job in the unknown state
>     and never falls through to a PUT; a **409 on a resumed original-name PUT reconciles that exact
>     name again before any suffixing**.
>   · **Alpha comes from the BYTES, not from `File.type`** (#3). An Android content URI hands over an
>     empty MIME type, and the old rule sent a transparent logo down the jpeg path — flattened,
>     permanently, in the stored file. The guard already proved the format; it is carried through, and
>     only a byte-proven JPEG loses alpha. Unknown keeps it.
>   · **The 64 MP cap is enforced after the PROOF decode too** (#4). The header reader admits what it
>     cannot measure (a JPEG whose frame header sits past the head, AVIF, GIF), so the cap was only
>     true of the files we could parse — and a 108 MP one went on to a second full decode in the worker.
>   · **The readback asks the CANVAS, not the owner's art** (#5). Sampling five points and refusing an
>     all-transparent result cannot tell a dead canvas from a sparse mask silhouette — the art the
>     `brand` and `stack` roles exist FOR. A sentinel is written and read back before the draw (and
>     cleared, so it cannot show through an alpha composite).
>   · **The timestamp fallback is checked like every other candidate** (#6) — "unique by construction"
>     was a claim about a clock.
> · **The crop's "untouched" rule is not what a first reading suggests.** `react-easy-crop` emits
>   `onCropChange`, `onZoomChange` AND `onCropComplete` while it MEASURES its own container — caught in
>   the browser, where a freshly opened modal already offered "Use this crop". Reading any of those as
>   an edit makes "confirm-untouched = use as is" unreachable on every upload forever. Only
>   `onInteractionStart`, our own zoom slider and the shape row set `touched`; the reducer's arms pin
>   both halves.
| S4 | focal: focalPosition/useFocalPosition + FramingSheet + registry preview descriptors + **the ~10 paint-site rewrite** (the `--cv-*` chain → per-window hooks; `coverHeroFocus` refractionalized) | full gate + visual probe |

> **S4 AS-BUILT (2026-08-25) — eight notes; five are deviations from this document.**
>
> · **THE PAINT-SITE INVENTORY, and what "~10" turned out to be.** Nine windows consume a framing point,
>   all of them gacha's, and every one is now a per-window `useFocalPosition` call:
>   the capsule card · the banner slide (promo, scene and hero seat alike) · the dossier portrait · the
>   dossier watermark · the poster slice · the cover CUT-IN · the cover HERO · the operator backdrop ·
>   the fleet backdrop. The reel figure is a cutout and takes none. **The `--cv-focus` /
>   `--cv-hero-focus` chain and `--po-focus` are DELETED** — both published one value on a parent for an
>   image to inherit, and the cover's hero rule (`var(--cv-hero-focus, var(--cv-focus, 50% 22%))`) is
>   gone with them: both seats now read the same `50% 22%` default and the difference is applied by the
>   window. `--gc-oracle-pos` and `--gc-wallpaper-pos` SURVIVE, and the reason is not inconsistency (see
>   the next two notes).
> · **FRAMABLE IS A DECLARED ROLE FIELD, and v1 declares it for THREE roles** (`MediaRoleDef.framable`;
>   gacha `characters` · `banner` · `oracle`). §5 says "cover surfaces only; the registry says which
>   roles offer it" and leaves the set open — this is the set. frontier's `rigs`/`hero` and the kit's
>   three cover roles (`background`, `hosts`, `service-banners`) are cover surfaces and are **NOT**
>   framable in v1: their theme seams hand consumers a bare URL (`FrontierArt.rigUrlFor`/`hero`) or
>   background props for a parent element rendered inside a `.map()` in two themes, so there is no focal
>   channel to carry a point down. Making them framable is a per-theme SEAM change, not the paint-site
>   rewrite S4 owns, and the honest v1 answer is that the gallery does not offer what the render cannot
>   keep. Recorded, not absorbed.
> · **The fleet BACKDROP is the recorded "cannot measure" degrade, and it is the only one.** It paints as
>   a `background-image` on `.kit-main` — a node `DefaultRoot` owns, which `GachaRoot` has no ref to — so
>   `focalPosition(art, null)` resolves it PROPORTIONALLY (the subject roughly over there rather than
>   centred). §5 names this case; this is where it landed. It sits under a 72%-to-opaque scrim, and the
>   recorded fix is a ref threaded from `DefaultRoot`, i.e. a kit-layer seam.
> · **The OPERATOR backdrop keeps its custom property, and that is still per-window.** `.gc-oracle`'s two
>   stacked faces are the SAME box painted twice (both `inset: 0`, and their scale is a transform, which
>   moves no layout box), so there is one window to measure and one value for two copies. What changed is
>   the source: the hook measures the block, rather than the item publishing a string every surface reads.
> · **`coverHeroFocus` is RETIRED, not refactored** (§5's "refractionalized", made concrete). The shift is
>   now `lib/focalPosition.ts#shiftFocalX` applied by the hero WINDOW to the position that window
>   resolved, and `COVER_HERO_SHIFT` is a FRACTION (`0.2`) rather than twenty percentage points. Its whole
>   arm table moved to `tests/lib/focalPosition.test.ts` with the SAME expected strings — including the
>   non-finite and unparseable degrades, which a render path still needs.
> · **`components/FocalImg.tsx` is a module the pinned map does not name, and it is load-bearing.** §12
>   pins `useFocalPosition(ref, item)`; three of the nine windows (the banner slide, the poster slice, the
>   cover card) are built by plain FUNCTIONS called inside a `.map()`, where no hook can be called at all.
>   A component is the only shape that gives each one its own ref and its own observer. It is ten lines
>   over the hook, it takes the `shiftX` the cover needs, and it is what the framing previews use too — so
>   a preview runs the same code path as the real surface.
> · **The reticle turns the library's `restrictPosition` OFF.** react-easy-crop's fence keeps the whole
>   crop AREA inside the media, which is right for a crop and wrong for a reticle: it would confine the
>   focal point to `[r/2W, 1 − r/2W]` — with a 30% reticle over a contained portrait, the middle three
>   fifths of the picture — and a subject near an edge would be silently unaddressable. The pan is clamped
>   here instead, to HALF the picture, so the reticle's centre reaches every point including the corners.
>   (Caught by the desktop viewport in the visual probe, not by review.)
> · **The capability lives in `MediaCaps.frame`, not on the section**, matching `reorder`/`activate`/
>   `hidden`/`remove`/`upload` — the role decides, and a SEAT or the Unassigned bucket still refuses (a
>   seat is a read-only view over another destination's library; an unassigned file paints nowhere). No
>   `previews` field was added to `MediaSection`: `section.def.previews` was already reachable.
> · **`e2e/fixtures.ts` now EXPORTS `SETTINGS`.** A spec that drives a settings WRITE has to echo a whole
>   doc back — `useSaveSettings` adopts the PUT's response as the settings cache and Conf then reads every
>   section off it, so an echo carrying only the media block hands the tab a doc with no `voice` and the
>   next render throws. It surfaced as a React recoverable-error (#520) in the probe, not as a visible
>   failure. **`e2e/media-gallery.spec.ts` has the same partial echo and does not assert `pageErrors`** —
>   left alone here (it is S2's file and its assertions are unaffected), flagged for the S2/S5 owner.

> **THE S4 REVIEW WAVE (Emma lane, blind; main-seat ruled 2026-08-25 — all 4 findings ACCEPTed with her
> lean fixes as written). Verdict was DO NOT SHIP, and two of the four were about the same thing: what
> the sheet is looking at.**
>
> · **The sheet never seeded from the existing point (#1, HIGH).** It opened at `crop {0,0}` with
>   `point: null`, and `react-easy-crop` reports the crop area WHILE IT MEASURES — `onMediaLoad` calls
>   `emitCropData()` and only then `onMediaLoaded` — so the picture's CENTRE arrived as the live point
>   before anything had happened. Opening a correctly framed image to look at it and confirming
>   without moving anything therefore replaced the owner's framing with the middle of the picture.
>   There is no "touched" rule here (unlike the crop step, where untouched means something different),
>   so the fix had to be the seed itself: `initialFraming(rowFocal(item.row))` opens ON the stored
>   point, `seedPan` derives the controlled pan once the media size is known
>   (`crop = (0.5 − f)·media`, through the same `clampPan` a drag uses), and reports are IGNORED until
>   that pan has been handed over. A stale point seeds nothing — `rowFocal` is the same predicate — so
>   that case still opens centred under its own "framing was reset" note.
> · **A mid-edit file replacement blessed the wrong coordinates (#2, MED).** The `rev` a point is
>   stored under is read at SEND time (the queue's one invariant) but the COORDINATES were chosen at
>   open time, so an SSH overwrite landing in between married the old picture's point to the new
>   picture's revision — and `focalState` then called that pair live forever, which is exactly the pair
>   rev-keying exists to fold to "unset". The sheet now carries the revision it RENDERED
>   (`onSave(point, expectedRev)` — the sheet supplies it because the sheet is the only thing that can
>   be authoritative about what it showed), and the send-time patch refuses on a disagreement with a
>   toast rather than guessing. **Clearing stays revision-independent**: "no framing" is true of
>   whatever is there now.
> · **The JPEG probe ignored EXIF orientation (#3, MED — the one backend fix in S4).** The SOF carries
>   the frame as STORED and every browser paints it as EXIF says to, so an SSH-dropped phone portrait
>   reported 4000x3000 and laid out 3000x4000. Nothing cared until the focal point, which decides which
>   axis a window crops from the file's aspect — so the centred mapping moved the picture along the
>   axis that was not cropping. `_exif_orientation` now reads the tag during the marker walk the reader
>   already does (the APP1 sits ahead of the SOF, so it costs no extra I/O and stays inside
>   `_JPEG_SCAN_LIMIT`), and `Probe.width`/`height` are documented as the PAINTED dimensions.
>   **Uploads were always immune** — the export re-encodes at the painted orientation and strips EXIF —
>   which is exactly why this could only ever be found by reading the SSH path.
> · **The parity arms compared the new code to itself (#4, LOW).** The arm named as the bundled-art
>   parity line checked two windows, and the dossier assertions derived their expected values through
>   `focalPosition` — so a lost CSS default or a dropped inline override on the other seven windows
>   would have passed. There is now an independent GOLDEN in `e2e/media-framing.spec.ts`: a table of
>   literals read out of `git show 492738e` (the commit before the rewrite), asserted in the browser
>   across all nine windows and each distinct capsule shape. Two shapes needed staging to exist at all
>   — `pair` only appears on a THREE-machine fleet, and `.gc-card.feat`'s own default only when
>   position 0's art carries no framing, which the bundled cast never does. Both mutation-checked: a
>   changed CSS default and a dropped inline override each fail it.

> **S4 CONFIRM ROUND — the EXIF entry's COUNT (Emma, runtime-probed; ruled 2026-08-25).** All four
> review findings and the rider confirmed resolved, and one new LOW: `_exif_orientation` read the
> entry's TYPE and its inline value but skipped the four bytes between them — the COUNT. A TIFF field
> lives in those last four bytes only while it FITS there; at any other count they hold an OFFSET into
> the TIFF block instead. Her fixture (a LONG at count 2 whose offset field reads 6) therefore probed
> as orientation 6 and transposed a 400x200 frame — against the parser's own
> cannot-read-with-certainty ⇒ unchanged contract. `count == 1` is now required, which is both the
> inline rule and the spec (Orientation is a single SHORT); two orientations is a writer bug and
> picking one of them is the guessing this reader does not do. Five fixtures pin it — hers verbatim,
> its little-endian twin, a SHORT at count 2, a count of 0, and a count large enough to be an offset
> past the segment — beside a count-1 LONG little-endian arm proving the real shape still reads.
>
> **S4 RIDER — the disabled namespace's 405 (main-seat ruled 2026-08-25, found by the S4 gate).**
> A READ of a file path whose namespace is not mounted answered `405` with `Allow: PUT, DELETE`,
> advertising the write route on a namespace the server had already refused to serve — against S1's
> own stated rule (`media_upload`'s docstring: *one URL space, one answer for "there is nothing
> there"*). `api/media.py#absent_router` is the rung BELOW the mounts: its own router because
> `include_router` runs before `app.mount`, so a GET on the main router would have shadowed every
> namespace's `StaticFiles` and no owner file would ever be served again. GET **and HEAD** (FastAPI's
> `APIRoute` does not add HEAD the way Starlette's does, and a bodyless 405 leaks the same header);
> **no OPTIONS**, which would answer the preflight D65's whole defence depends on going unanswered.
>
> **Why it hid, and why it was worth chasing:** the leak was reachable in the DEV profile only. With
> `frontend/dist` present, SYS-5's `/api/{rest:path}` GET catch-all full-matches and answers 404 (a
> FULL match beats a PARTIAL wherever it sits in the table), so prod said 404 and dev said 405 — and
> `test_a_symlinked_media_path_DISABLES_…` flipped with **whether a frontend build existed on disk**,
> which is what read as flakiness across the S4 gate runs. The backstop is registered unconditionally,
> so both profiles now answer the same thing whatever is on disk. Pinned from both sides: the
> disabled-namespace 404 + the absent `Allow` header + HEAD + the untouched OPTIONS
> (`test_media_write_d65.py`), and the healthy-namespace `Match.PARTIAL` arm that proves the mount is
> still reached first.

| S5 | drag: G6/G5→G1→G2→G4→G3→hygiene + held-commit machine | full gate |

> **S5 AS-BUILT (2026-08-25) — seven notes; three are deviations from this document.**
>
> · **THE HOOK GREW TWO AXES OF SHAPE, and every existing consumer is on the old value of both.**
>   `SectionRefEditor` (the Inference / Voice STT / Voice TTS / Embeddings fallback chains — the hook's
>   only prior consumer) passes no options at all, so it keeps `activation: "handle"` (a dedicated ⠿
>   with `touch-action: none`, 6px distance activation, ArrowUp/Down on the same control) and
>   `axis: "list"` (`targetIndex`, unchanged and still Y-only, so a purely horizontal wobble on a
>   handle still does nothing). The gallery grid passes `activation: "press"` + `axis: "grid"`. That
>   pairing is not two independent flags in practice — a control whose primary meaning is "open me"
>   cannot also be a reorder control on the keyboard — so `press` deliberately emits **no** `onKeyDown`
>   and no `aria-roledescription`: the tile's a11y contract stays exactly as S2 designed it (Emma #9),
>   and the WCAG floor for order stays the ↑/↓ + move-to-edge pair in the detail panel, which is
>   untouched.
> · **G-BY-G**: **G6** rects are measured ONCE at lift and the dragged node's transform is written
>   straight to the DOM (never through React state), so a `pointermove` costs no layout and no render;
>   only a midpoint CROSSING re-renders. **G5** the container's scroll delta is added to both the
>   transform and the hit test, against those frozen rects. **G1** `displacement()` is pure and returns
>   the NEIGHBOUR SLOT's own geometry rather than a height-plus-gap sum — which is what lets one
>   function serve a list and a 3-column grid, since in a uniform layout slot *k*'s geometry is rect
>   *k*'s. **G2** the lift scales the TILE, not its grid cell, so the cell's box — the geometry the hit
>   test was frozen from — never moves. **G4** autoscroll: band `min(20%, 96px)`, `p²` ramp to
>   ~600px/s, 200ms of edge dead time, rAF, on the nearest genuinely-scrollable ancestor. **G3** the
>   held commit, below. **G7/G8/G9/G10** selection kill + the one-shot capture-phase click guard;
>   `resize`/`visibilitychange` cancel and `contextmenu`/`dragstart` refused; a pick-up announcement and
>   — the one that was a real hole — an announcement on COMMIT, which the debounce used to swallow
>   whenever a drag was fast.
> · **The MACHINE is a pure reducer (`dragReduce`) with `phaseRef` as its synchronous read**, which is
>   also the admission latch (S3's pattern): `idle → press → drag → hold → idle`. Two arms carry the
>   design. A `drop` that never left its own slot goes straight home — there is nothing to commit. And
>   **`cancel` is REFUSED while holding**: Escape, a blur or a `pointercancel` may abandon a gesture,
>   none of them may abandon a write already on the wire. Release is whichever comes first of the
>   authoritative `orderKey` changing (in a **layout** effect, so the transforms clear in the very
>   commit that paints the new order — an ordinary effect paints one frame of the new order still
>   wearing the old displacement) and the write settling, in `finally`, refusal included.
> · **`write.move` ANSWERS now.** It was fire-and-forget; the held commit needs to know when to let go,
>   so it returns its `JobOutcome` the way the upload's register phase already did. It is the same
>   queued, recompute-at-send `moveBy` intent the ↑/↓ buttons enqueue — RELATIVE, not absolute, because
>   the position the owner dropped at is a fact about the list they were looking at. There is no second
>   write path for the drag.
> · **A drag can point where a write cannot go, so the GESTURE is clamped — deviation, and the one this
>   slice would have shipped a visible snap-back without.** The collation's trailing bundled tier is not
>   arrangeable (§2.3 ③), so a drag aimed at "the very bottom" past five bundled entries would have
>   committed as something else: the file landing several slots short a refetch later, and the bundled
>   row that happened to be at the drop index promoted into the deal. `lastExpressible` — the number
>   "Move to bottom" already used — is now EXPORTED and read by the gesture through a `limit` option, so
>   the drop clamps while the finger is still down. One rule, one implementation, and the e2e drives it
>   on a real 8-tile grid (three files + the bundled cast).
> · **`e2e/media-gallery.spec.ts`'s partial echo (the S4 rider) is closed, and it was hiding more than a
>   recoverable render error.** The mock now echoes the whole `SETTINGS` and every write-driving test
>   asserts `pageErrors`. Building it surfaced the interesting half: an echo that drops `notifications`
>   makes `useSaveSettings`'s own success path throw BEFORE it reaches the awaited media refetch — so
>   the mutation rejects, the index never refetches, and the queue's next intent is computed from a list
>   the server has already superseded. The invariant is the same one the queue states about itself;
>   what this shows is that a test double which is not the server's whole answer can violate it.
> · **Not built, deliberately: a TOUCH drag in the e2e.** Playwright's touchscreen API is `tap` only, so
>   a long-press drag would have to be hand-dispatched touch events — a mock of the gesture, asserting
>   our own event plumbing rather than the browser's. The long press, the scroll-intent abandon and the
>   activation slop are pinned in vitest with fake timers; how the hold FEELS under a thumb is an S6
>   probe, and §16 now carries it.

> **THE S5 REVIEW WAVE (Emma lane, blind; main-seat ruled 2026-08-25 — all 3 findings ACCEPTed with her
> lean fixes as written). Verdict was SHIP WITH FIXES, and two of the three are the same sentence: an
> INDEX IS ONLY A NAME FOR A ROW WHILE THE ORDER HOLDS STILL.**
>
> · **A same-length reorder walked straight through the guard (#1, MED).** `count` was the only thing
>   that aborted a stale gesture, so an interleaved queued write — or another device's refetch — turning
>   `[A,B,C]` into `[B,A,C]` mid-drag left `from`, the frozen rects and the row under the finger all
>   describing a list that no longer existed, while the consumer resolved `items[from]` from the new one:
>   the owner drags A and the write moves B. **`orderKey` now aborts an in-flight gesture as well as
>   releasing a held commit** (captured at press, compared in the same layout effect — and a consumer
>   that passes no signature, i.e. the fallback chains, keeps exactly the old length-only behaviour). The
>   second half is the boundary: `LibraryGrid` captures the ITEM at lift through a new `onPick`, and
>   `GalleryModal` is handed that item rather than looking one up again at drop. The abort makes the
>   index trustworthy; the capture makes trusting it unnecessary.
> · **`release()` acted on whichever hold was current, not its own (#2, MED).** Idempotent only while no
>   LATER hold existed — and one can: an earlier write's refetch releases this drag's hold before its own
>   promise settles, the surface goes live, the owner drags again, and then the first `finally` fires and
>   clears the second drag's transform and phase while its write is still on the wire. The refused-cancel
>   arm cannot catch it, because both calls are honest `released` signals about different commits. Each
>   hold is now a TOKEN and `release(expected)` no-ops unless it is still the current one; the layout
>   effect and the promise closure each pass their own.
> · **List mode had quietly gained an X-follow (#3, MED).** The extended hook handed the grid's
>   two-dimensional transform to every consumer, so a fallback row that crossed the 6px threshold and
>   then drifted sideways followed the pointer out of its own panel — while its target, chosen from Y
>   alone, correctly never moved. `axis: "list"` emits `translateY(dy)` again; the two-dimensional
>   transform is grid-only. **The existing arms could never have caught this** — they assert committed
>   indices, and the indices were right the whole time.
>
> Her coverage-honesty section named the four blind spots by name and all four are now armed: an
> `orderKey` mutation during an active drag, a second hold created between a release and its settlement,
> the list row's X transform as a VISUAL, and the pick-up identity. (The fourth, an e2e that interleaves
> writes, stays unbuilt on purpose: the spec waits for each write before the next drag by design, and
> making it not do so would be a race the test itself owns rather than the app.)
| S6 | owner device round: the parked 2026-08-12 round + EXIF portrait e2e · 413-mid-body over Tailscale HTTPS · Honor 20 HEIC probe · PWA-standalone picker survival · q0.85 eyeball · crop/framing/drag feel · Fennec expected-partials | owner acceptance |

> **THE S6 OWNER-ROUND FIX WAVE (2026-08-25/26) — W1–W4, four commits, all gates + the full e2e
> suite green. The owner drove the live build and found three things, which turned out to be two
> causes and one omission.**
>
> · **W1 — an order write says the whole section's order** (`bee042e`). The drag was dead in exactly
>   the section it matters most in, and the deal silently shrank behind a swap. Both are the tier
>   rule; §2.3 ③ is amended above and carries the whole record. `lastExpressible` + the drag's
>   `limit` option are deleted (`useDragReorder`'s only consumer was the gallery grid — no seam left
>   behind). Pinned: an EXACT-EXPRESSION property (for any from/to over any mix of tiers, collating
>   the write reproduces the requested order), the all-defaults section in both directions, and a
>   browser arm that drags downwards inside one.
> · **W2 — nothing a theme ships is left out of its gallery** (`f7d0f17`). Three pictures were in no
>   library: gacha's operator backdrop, frontier's badlands vista (both "the ladder's last rung, no
>   id addresses it" — sound about PINS, wrong about the LIBRARY) and `rook.webp`, a genuine orphan
>   whose manifest comment had claimed for a whole phase that it was "bundled for the gallery". Each
>   now carries its asset's own stem; `rook` is the cast's tail after `lyra`, so positions 0–3 are
>   unchanged. **Both ladders lose their hard-coded last rung**, which was the other half of the bug:
>   it outranked the In-use switch, so retiring the backdrop would have left the gallery saying
>   "nothing in use" while the surface kept painting it (Emma's S2 review #2, in the two places the
>   pool had no member to be honest with). `offersBundled` guards the stub degrade as everywhere
>   else; both surfaces degrade cleanly with no art (the operator block keeps its plate and scrim,
>   the map its scrim and label).
> · **W3 — the built-in defaults the gallery never showed** (`c195211`). `banner.webp` belongs to no
>   role folder, so both backdrop SEATS said "none pinned" beside an empty box; they show it now
>   through `MediaSlotDef.builtin` (§6.6). And the twelve cosmos service banners, which lived in a
>   private FE array outside the media system entirely, became the `kit/service-banners` bundled tier
>   with a **"Built-in rotation"** card: order is rotation order, In-use takes a banner out of it, no
>   upload and no delete (a file dropped in that folder binds to a SERVICE). `CosmosHostDetail` deals
>   from what the library resolved. A `named` role whose bundled ids are a SET rather than keys says
>   so (`MediaRotationDef`) — a gallery that guessed would be right for frontier's stack and wrong
>   here. `kit/ownerArt.ts` stops treating bundled rows as binding candidates, which matters now that
>   an order write can list them.
> · **W4 — Restore defaults** (this commit): §6.6's action, its transform (`restoreDefaults` +
>   `defaultsRestorable`, both pure and index-decidable) and its confirm.
>
> **Deviations + judgment calls, recorded rather than swallowed:**
>
> · **`rook.webp` was registered, not deleted.** The other honest answer to an orphan is to remove
>   the file; `art.ts` had stated the intent ("stays bundled for the G5 gallery") so the fix realises
>   it. It changes the deal only on a fleet of SIX or more (position 5 was `pegasus`, is now `rook`).
> · **`vapor-logo.png` is out of scope, deliberately.** It is theme CHROME in the kit AppBar's
>   `brandMark` slot — the same slot the kit's own accent dot fills — not a default for any role, and
>   it is ALREADY overridable: an owner file in `kit/brand` outranks it (`AppBar.tsx`). Making it a
>   bundled entry of `kit/brand` would list it as a default under cosmos, minimal and gacha, which do
>   not paint it. vapor's inline SVG skyline/sun are markup, not files. The minimal theme ships no
>   art; `public/` holds PWA icons, not theme art.
> · **A latent crash fixed in passing** (W3's commit): the post-drag click guard scheduled its own
>   removal on a timer that outlived the hook, so a torn-down document could be dereferenced 50 ms
>   later — an uncaught `document is not defined` that failed the whole vitest run under gate
>   contention, and how it was found. The pending removal is held at the hook and the unmount disarms
>   it outright; clearing the timer alone would have left the guard armed to eat the next real click.
> · **The rotation section is pinned as SECTIONS, not as a render.** `mediaSections` emits it with
>   its exact capability set under test; its card and grid are the generic ones every pool section
>   already exercises, and a kit-namespace render test would have had to stand up the fleet key
>   source to reach it.
>
> **Review close-out (2026-08-26).** Main-seat audit over the whole diff, then the Emma-lane blind
> round (sol high, `--ignore-rules`): **zero new findings, "RESOLVED — READY"** — all seven seeded
> areas judged sound at mechanism level, FE + focused BE suites re-run by the reviewer herself. The
> one audit wart worth code closed in `533de17`: a refused order intent (row gone by send time) no
> longer writes `sweep: true` — all three refusal arms share `moveBy`'s states-no-order rule, pinned
> in one test; confirm round RESOLVED. Recorded, NOT fixed by ruling: the post-drag click guard's
> 50 ms cross-disarm race between two completed drags — two real gestures cannot fit the window, and
> each guard also self-disarms on its first click, so the worst case is one swallowed tap.
>
> **W5 — the hero seat dies; the carousel deals its own opener (owner prose ruling 2026-08-26,
> built same day, `15b769f`).** The owner read the gallery's map against the screen and named the
> seam: "Hero slide" and "Fleet backdrop" were two sections showing one picture, the picture itself
> was in no library, and gacha has no hero surface outside the banner. The rulings: the backdrop and
> the first slide are DIFFERENT images · gacha does not need the hero image · hiding banner images
> removes only their slides, and slide 1 stays on the backdrop image.
>
> As built: `banner.webp` joins the `banner` pool as its FIRST bundled member (banner · b2 · b3) — an
> ordinary, orderable, retirable entry, the W2/W3 class closed for the one picture those waves had
> left inside a seat. *(Order corrected same day: the build first put it LAST, over-reading
> "backdrop and first slide differ" as a demand that the shipped DEFAULTS differ — the owner
> clarified it meant the MECHANISM: the default look keeps ONE picture on both surfaces, each
> independently changeable. Leading, the fence snapshot is byte-identical to the pre-W5 record — a
> fresh install renders exactly what always shipped.)* The first slide keeps the frozen PICKUP copy and its fixed key and DEALS the
> pool's first usable member (`bannerScenes` — the one split, whole members riding down); the rest
> are the scenes, titled by position over the rest; the wallpaper ladder is only the EMPTY-POOL
> fallback, so the carousel never loses its opener. The `hero` seat/pin die everywhere
> (`RosterSlots.hero` · `heroArt` · the registry seat row · `GACHA_SLOTS`), `activeSeat`'s
> fallback-key chain went with them, and D54/§5.3's "both surfaces show one picture" coupling is
> REVERSED: a kit background now moves the backdrop and not the carousel. FIXED IN PASSING: scene
> slides dropped their member's `focus`/`rev` (`art: { url: scene.url }`) — a framing point set on a
> banner image did nothing at all; the member now rides down whole, pinned by a two-object-positions
> fleet arm.
>
> Judgment calls, recorded: a hand-authored legacy `hero:` pin now fails Settings validation at
> LOAD (refuses boot, not merely the write) — the ruled loud unknown-key class, both real configs
> verified to hold no such pin · the backdrop seat's builtin display row and the pool's `banner`
> entry stay INDEPENDENT switches over one asset (the seat's last rung is the ASSET, not the pool —
> hiding the pool entry retires the slide and leaves the backdrop default standing, per the owner's
> "slide one stays the backdrop image") · the E0 equality fence was re-taken for the FIRST time —
> for a ruled behaviour change, not a refactor; the delta is exactly three `src` attributes
> rotating, recorded in the fence header. **Review: main-seat audit clean → Emma-lane blind round
> (sol high, `--ignore-rules`) SHIP, ZERO findings, open sweep empty.** Gate green per commit
> (BE 1,991 · FE 2,552). Docs amended with this ruling: D54 · MEDIA_PLAN §12 · GACHA_PLAN
> (roster example + §6.4).
>
> **W6 — order is the only priority + the gallery redesign (owner rulings 2026-08-26, prose;
> D66 = the D-entry; built same day, `bf0dc41` + `a5b7816`).** The owner's feel talk on the
> gallery's controls, run to its end: "the active toggle and the active button are confusing…
> we don't need two systems to do one thing" · order decides app-wide · one-tap activation on
> the tile · the ◆ marker "should be more explicit — let's go with Default" · the detail's
> controls "look generic — icons on top of the image" · the section descriptions confusing
> (a second clarification: the CARDS' titles/hints, not just per-image text).
>
> Commit 1, the sweep: `MediaCaps.activate` dies; every POOL pin deleted (gacha `reel_figure` ·
> frontier `hero` · kit `background`/`brand` — four ladder spots in `themes/frontier/ownerArt`,
> `theme-engine/kit/ownerArt` ×2 constants + 2 resolvers) with `firstUsable`'s pin parameter and
> the S2 three-valued eligibility machinery; seats REFUSE what their source tier cannot honour
> rather than repairing it. Backend `FRONTIER_SLOTS`/`KIT_SLOTS` = (), `GACHA_SLOTS` =
> (wallpaper, oracle). Builder judgment calls, main-seat-ACCEPTED: **`MediaCaps.promote`**
> (move-to-top alone) for the scoped KEY/FAMILY sections that deliberately cannot reorder — the
> duplicate tie-break stays settleable and promote is an order write, not a second system · the
> seat-refuses reading (the lost un-hide-on-pin repair was reachable only through a stale cache).
>
> Commit 2, the redesign + the words: the tile corner ✓ is a real In-use toggle (a SIBLING of
> the tile button — no nested buttons; `aria-pressed`; a press on it can never lift the tile,
> pinned by test) · ◆ → a "Default" text chip · the winner keeps the accent outline · ItemDetail
> rebuilt image-forward (R59's AOSP/Signal preview pattern + the field's floating-toolbar shape):
> the picture is the panel, back floats on a scrim, and a floating pill carries [To top · Up ·
> Down · To bottom | Framing | Delete] — "To top" IS activation now, so the verb and the reorder
> are one button; seats show "Use here"/"Clear" instead of the position cluster; icons are
> hand-inlined lucide geometry per the house pattern (lucide-react is NOT a dep — the CLAUDE.md
> claim is wrong). The copy system: In use = membership · Active = painted (chip + outline) ·
> Default = ships with the app; `used for "X"`/`matched by its filename` replace "bound by";
> advisories state consequences; the SR line and every "Set as active" sentence rewritten.
> **Section cards get owner-facing labels** (`MediaRoleDef.label`, additive) with the role
> folder as a mono subtitle: Characters · Banner slides · Transition figure · Operator backdrop ·
> Rig cards · Map cover · Comms stack · Service icons · Service banners · Machine pictures ·
> Background · Logo (was the misleading "App icon") — and the operator name-clash is resolved
> (the SEAT is now "Operator character"). Hints rewritten to lead with what the thing is.
>
> Verification: full gate green per commit (BE 1,990 · FE 2,553 · the whole Playwright suite
> re-run, 305) · main-seat audit of both judgment calls + a live 390px screenshot round on the
> dev stack (grid, chips, corners, the pill's overhang — the two layout spots the builder could
> not eyeball, both sound).
>
> **W6 review close-out (2026-08-26, three rounds to an explicit RESOLVED).** Emma-lane blind
> round (sol high, `--ignore-rules`): **SHIP WITH FIXES, 2 MED**, everything else sound at
> mechanism level (scoped promote · corner/drag isolation · resolver parity · e2e honesty; 335
> tests run by the reviewer). ① the seat's send-time check proved presence, not RESOLUTION — the
> §2.3 stem/id collision let "Use here" write a pin that bound the EARLIER namesake; ② both
> In-use controls captured the RENDERED hidden, so a rapid double-tap enqueued the same absolute
> write twice. Fixed `4eaaea4` (main-seat, small): the pin check resolves the name through the
> dealt tier's own rule and refuses on mismatch or unusable (stash-verified arm); `toggleHidden`
> derives the target at SEND so queued toggles COMPOSE — one intent, both controls. **Confirm
> round: both RESOLVED + 1 chained MED**, and the main seat OVERRULED her prescription with the
> paint rule: she read the check as stricter than `activeSeat` (which skipped unusable
> namesakes), but the truth of a seat is what `slotEntry`→`toWideArt` PAINTS — first name-match
> of the dealt tier, nothing if unusable — so it was `activeSeat` lying (hidden-row pins too);
> aligned to the paint rule in `74872ed`, two paint-parity arms. **Her check of the overrule
> CONFIRMED it correct** and chained one deeper (the same class in `activeOraclePool`: overridden
> on the pin's mere PRESENCE while the paint falls through an unresolvable pin to the pool) —
> closed `b241d33` at the honest layer: the pure resolver emits the override as a CLAIM beside
> the pool's own pick, and the WIRING — the one place holding both roles — resolves the seat and
> honours or drops it. **Final round: RESOLVED, (a)(b) verified, ZERO new findings** (181 tests
> run by the reviewer). Gate green per commit; tip = BE 1,990 · FE 2,559.
>
> **W7 — membership never moves a picture (owner rulings 2026-08-26, prose, the re-poke of the W6
> gallery; D66's amendment is the D-entry).** Three bugs, one root: `toggleHidden` on a BUNDLED row
> in an unswept section listed that row to carry `hidden: true`, and a listed entry (a) collates
> FIRST — so the unticked image jumped to the top of the grid — and (b) survived the un-hide as a
> bare `{bundled: id}`, the section's sole own-tier member, so `ladderRows`' own-replaces-fallback
> rule collapsed the whole deal to that one picture (every fleet host painted it; only it wore the
> active outline).
>
> The rulings, in the owner's own terms: **"an unticked image must not jump or vanish"** — it dims
> where it stands, in place, and re-ticking puts it back in use from the same place *(first stated as
> a sink to the bottom, then amended the same hour to no movement at all: order is entirely the
> owner's to arrange through the drag / ↑↓ / To top, and no membership tap may touch it)*; the active
> outline should be **ONE clean ring, on active images only**; the corner tick is **too big**; and
> since the off image no longer moves, its **off state must be unmistakable in place** at 110 px over
> busy art.
>
> Built: switching OFF where order is the priority system (`caps.reorder` — pools and the rotation,
> i.e. exactly the sections whose drag already sweeps) is an ORDER INTENT that states the order
> UNCHANGED — one write, `sweep` + `displayOrder(rows)` verbatim + `hidden: true` on its one entry,
> through the existing `writeFiles` spec machinery (§2.3 ③'s second amendment, above). A per-key
> gallery keeps the minimal write. Un-hiding keeps its minimal write plus the **bare-entry guard**,
> implemented in the transform layer where the tier rule already lives (`WriteSpec.bare`): an entry
> that would be left as bare `{bundled: id}` is DROPPED in any role whose bundled tier is not fully
> listed, so a legacy or hand-edited config cannot collapse a deal either. Cosmetics: `.mgal-tile.on`
> is one ~3px accent band (border + contiguous outer ring) instead of the three-edge stack;
> `.mgal-tile.sel` and the `selectedId` prop are DELETED as dead code (`GalleryModal` never passed
> one — the grid and the detail panel are never on screen together); `.mgal-use` is 24 px drawn (WCAG
> 2.5.8) with an `::after` inset extending the target to ~34 px, glyph at 12; the off image takes the
> app's own "not running" vocabulary — a deeper dim plus the grayscale every theme paints a sleeping
> machine with — rather than a third marker.
>
> **Resolver verification (read, not assumed).** `listed` is read in exactly three places
> (`ownTier` · `fallbackTier` · `defaultsRestorable`), so the whole sweep surface is
> `ladderRows`/`usableLadderRows`: gacha `activeCast`/`activeScenes`/`activePool`/`activeOraclePool`
> + `activeSeat`, frontier `activeRigs`/`activeHero` (`activeStackLayer` is per-key and tier-blind),
> cosmos `activeBannerSet` and its consumer `bundledSetFrom` (both `shown`-only — sweep-neutral), kit
> `activePool`/`activeNamedKey` + `roleFiles` (bundled rows filtered out by construction). A
> fully-listed bundled tier resolves to the SAME deal the fallback tier did, in the same order,
> wherever the owner's tier is otherwise empty — i.e. every virgin section, which is the state the
> defect lived in. **The one residual is the amendment's own documented cost, unchanged from W1 and
> now reachable by one more gesture**: in a MIXED section (owner files beside unlisted defaults) any
> order write puts the defaults into the owner's tier, so the deal grows — a drag did that already,
> and an untick now does too. Restore defaults is the way back.
>
> Verification: full gate green (BE 1,992 · FE 2,569, +10) · the media e2e specs re-run locally on
> the built artifact, 19/19 mobile. New pins: the untick sweeps + states the order verbatim; the
> round trip (untick → re-tick) leaves everything listed in the ORIGINAL order, nothing hidden, the
> whole cast dealt; a disk row takes the same rule; a non-order section keeps the minimal write; the
> guard drops a bare entry in an unswept role, keeps a non-bare one, keeps a bare one in a SWEPT role
> (dropping it would move the picture), and never touches a disk entry; the grid's off state (dim +
> hollow corner + unchanged position, checked against the written order) and the ring-means-active
> triple (active / in use / off, three looks); and the browser proof through the server's own
> collation. Stash-verified: 4 of the new unit pins fail without the transform change.

> **W8 — the whole-feature council's accepted findings + the Restore re-rule (2026-08-26).** The round
> was a WHOLE-FEATURE one, not a slice review: the Emma blind lane over the built feature (4 MED, all
> accepted as fixed) and an adversarial DESIGN lens over the same surface, reconciled by the main seat
> into one brief. What it found is one family of defect — *a claim made from state that is not
> authoritative, or from a second implementation of a question that already has an answer* — in eight
> places.
>
> **The queue's two holes.** `filesBlock` turned a MISSING role into an authoritative EMPTY list, so a
> queued intent draining after a refetch that no longer describes the role (the namespace flipped
> disabled, the folder was replaced out of band) computed against `[]` and could persist `files: []` —
> wiping the order, the switched-off entries, the framing points and the binding keys in one save. It
> refuses now, on KEY PRESENCE rather than non-emptiness, because an empty-but-present role is a real
> writable state (the first upload's register phase writes into exactly that). The server side was
> verified rather than assumed: `build_index` emits a key for EVERY registry role whatever the folder
> holds, and `test_role_dirs_are_created_at_app_construction` already pins it across all three
> namespaces including the one that ships no bundled art. And each namespace's queue was serialized
> only against ITSELF while every save adopts the PUT's whole-document echo into the SHARED
> `["settings"]` cache — with a Conf tab mounting all three namespaces, an older echo could land after
> a newer one and the next recompute-at-send read superseded per-item fields. One module-scoped LANE
> now holds the recompute-and-send step exclusive app-wide; the per-namespace queues are unchanged.
>
> **Two claims the ring made that the paint did not.** A drag encodes its drop as a RELATIVE delta and
> the queue replays it at SEND, so admitting a gesture while an earlier move is in flight lands the tile
> beside a neighbour the gesture never saw — the grid's drag admission takes `&& !busy` (the ↑/↓ pair
> is untouched: a ±1 step composes with whatever moved under it, which is what the recompute is for).
> And the DEALT resolvers (gacha `activeCast`, frontier `activeRigs`) ringed rows that cannot paint: a
> broken file keeps its deal POSITION — dropping it would re-deal every host after it, and that rule is
> untouched — but the host it was dealt to paints the placeholder, so the tile now reads "in use · will
> not paint" with the problem badge and no ring. Verified rather than assumed for the third dealt
> resolver: cosmos's `activeBannerSet` holds only bundled rows, and `bundled_row` never sets `unusable`.
>
> **The design lens's four.** gacha's single-pick `poolRows` read the DEALT half of the §2.3 tier pair,
> so a `reel/` folder of nothing but broken files BLANKED the transition figure while frontier's
> identically-worded map cover fell back to shipped art — it takes `usableLadderRows` now, the same
> first-wins rule, changing paint and gallery together in that edge (the accepted semantic). The FAMILY
> card re-derived "which file answers this key" with the generic name classifier while the ladder
> excludes the bundled tier: the two agreed only until a bundled id matched a service key
> (`banner-03` is both a shipped rotation id and an ordinary service kind), so the card asks the
> SECTION's own resolver now — the keys stay the source's, the file is the ladder's answer, bound to
> the wire's `slots` in the wiring where `active` is already resolved (`SectionView.activeForKey`). The
> kit's pool resolver gained the `.filter((f) => f.bundled == null)` its paint twin `roleFiles` has
> (latent today, pinned so it stays impossible). And `MediaSlotDef.seat` is DELETED: every shipped slot
> set it and a non-seat pin has been forbidden since D66, so the field and its `if (slot.seat !== true)
> continue;` guard were a compat rung — a pin IS a seat, and the row is the claim (the no-legacy-seams
> rule).
>
> **F4 — the sentence the gallery was missing.** The tiles say which entries are in use and which one
> is active; nothing said whether that meant ONE picture, a rotation or a whole set, and the answer
> differs per role. One line in the scope block, DERIVED from `active.mode` rather than hand-written
> twenty times: *"The first in-use image is the one shown." · "In-use images are dealt across the
> machines in this order." · "Every in-use image is shown, in this order."* A seat gets none (it has no
> In-use and no order — its reading is the pin, and its own hint states the ladder), nor does the
> unassigned bucket or a role the registry never described.
>
> **W8+ — a KEY gallery rang nothing** (BUILDER-FOUND during F5, main-seat ACCEPTED into the same
> wave). A `family` role has ONE section for the whole family — its keys come from the live fleet, so
> a section-level `active` would have to mean all of them at once, and there is none — so the modal,
> which read `view.active`, drew no ring in ANY per-key gallery of the kit's three named roles. The
> owner's standing "the ring shows what is used" contract, silently broken in exactly the galleries
> where a file's binding is least obvious (a stem match, a `key` override, a shadowed duplicate). F5
> had just put the per-key resolver on the `SectionView`, which made the fix two lines: the modal
> resolves ONE `ActiveArt` per SCOPE — the role's per-key ladder for a key scope, the section's own
> otherwise — and the grid, the detail panel and the reading line all read that one derivation. It is a
> provable no-op for a STATIC-key section (frontier's stack): that section's `active` IS
> `activeForKey(key)` over the same rows and slots, and no per-key resolver ever sets
> `overriddenBySlot`, which is the only thing the wiring rewrites.
>
> **The owner rulings that arrived mid-wave.**
> · **Restore defaults is re-ruled** — "put them first and activate them and you deactivate the other
>   ones — as if the defaults are the one selected, and I just uploaded the other images that are
>   there." It is an ORDER intent now; §6.6 carries the whole rule and why the S6 drop-to-fallback
>   mechanism could not express it. Copy re-written in the gallery's one language, both sentences.
> · **The DEALT ring is CLOSED as-is**, no code change: the ring means *in the deal* — not necessarily
>   on a machine when there are not enough machines to go round.
>
> **REJECTED, with reasons** (recorded so they are not re-proposed): switching the untick-sweep
> discriminator from `caps.reorder` to `caps.promote` — it would sweep a whole named role from a
> key-scope untick, which is the very listing §2.3 ③ refuses for a role that binds by NAME; exposing
> frontier's per-card fallback ids in `ActiveArt` — the ring is about THIS library, and a card's own
> bundled rung is not a row of it; and any change to `heroRow`'s foreign-id check, which is unreachable
> by construction (the collation emits only registry-known bundled ids). **Still owner-pending and
> untouched: typed `RowId` pins.** *(RULED at W9 below, 2026-08-26 — and ruled as the config's own
> union rather than as the internal `RowId` spelling.)*
>
> Verification: full gate green (BE 1,992 · FE 2,580, +11). New pins, one per fix: the queue's
> role-refusal (silent, and NOT the stale-refetch discard) · two namespaces' drains sharing one lane ·
> no drag admission while a write is in flight, and the same press lifting the tile once it settles ·
> the dealt ring on gacha and frontier (with the deal itself asserted unchanged beside it) · the
> all-broken pool falling back on both gacha pools · the kit pool's bundled exclusion · the family
> card's key row against a bundled id that matches a service key · a kit key gallery ringing the file
> the ladder bound and only it (a shadowed duplicate beside it, one `aria-current`), and ringing
> nothing where the key's only candidate cannot paint · the reading line per mode and its
> absence on a seat · the seat-flag deletion re-stated as "every slot emits a seat SECTION" · and the
> re-ruled restore (registry order on top and un-hidden, the owner's files below and switched off with
> their fields whole, the key scope touching only its layer, and the untick round trip after it).
> Stash-verified: ten of the new pins fail without their fix.

> **W9 — a pin names the config's own IDENTITY UNION (owner ruling 2026-08-26, main-seat-final).**
> The one item W8 left owner-pending, ruled — and ruled one notch better than it was asked. The
> question was "should a pin persist the internal `RowId` (`f:lyra.webp` / `b:lyra`)"; the answer is
> that config already HAS an identity idiom and the pin should simply be it:
>
> ```yaml
> slots:
>   oracle:    {bundled: lyra}       # a shipped entry, by registry id
>   wallpaper: {name: lyra.webp}     # an owner file, by FILENAME (not stem — stem collisions die too)
> ```
>
> **Union object over prefixed string, for less future debt.** A `RowId` string would have been the
> smaller diff and a worse config: it is a SPELLING (`f:`/`b:` is an internal comparison key that the
> front end mints and no owner would guess), it needs its own parser and its own escaping question the
> moment a filename contains a colon, and it is closed — the day a pin grows a second dimension there
> is nowhere to put it but a sibling map keyed by the same slot name, which is the shape the
> 2026-06-24 extend-don't-migrate directive bans. The union object is the thing the owner already
> reads three lines above it in the same file, it is parsed by the parser `files` entries already
> have (`entryId` / the shared `MediaIdentity` base), and the next dimension is an optional field
> with a default. It also validates the way `files` does — the `bundled` arm against the ids the
> seat's SOURCE role ships, which is what taught the backend registry `MediaSlot.source` (the same
> bare-tuple → object upgrade `MediaRole` got at D65, done while it was two entries).
>
> **What it deletes.** The ambiguity was never merely a UX wart: a pin held a STEM, and two identity
> spaces answered to one (`lyra.webp`'s stem and the bundled id `lyra`) while two files could share a
> stem inside one of them. Everything built to cope with that is gone — `libraryItems`' `pinnable`
> arm and its `pinned` set, the seat's half of `duplicateNote`, the "first name-match" wording in all
> three readers of the paint rule, and the send-time *resolve-the-name-then-compare-it-back* dance in
> `write.pin` (which is now "is this row dealt, and can it paint"). The state is unrepresentable
> rather than detectable, so the detector went with it. `libraryItems`' **key-shadow** duplicate is a
> different mechanism (defect #4 — two files claiming one named-role KEY) and is untouched.
>
> **The migration arm the purity contract forced: BUNDLED-TYPE-OR-DROP.** A step is pure by contract
> and `Context` carries no `$CTRLB_HOME`, so a legacy stem cannot be resolved to the FILENAME the
> `{name}` arm holds. Registry-known ids are typed (`{bundled: <id>}` — the registry is code); every
> other legacy pin is DROPPED and DECLARED in `Plan.consumes`, which is the migration's own warning
> channel (`--check`/`--apply` list it as a consumed legacy key). Persisting a
> forever-dangling `{name: "lyra"}` under a "verified" stamp would be an owner-visible lie in a file
> they may open; an unpinned seat falls to its own ladder and is one tap to fix. A stem under an
> UNKNOWN slot key is left where it was — folding it would convert the "W6" retirements' loud refusal
> into a silent deletion. Both arms are golden-tested, under the pre-fold AND the already-folded
> shape, with the standing re-run-is-a-no-op postcondition on each. **Step 2 is unreleased**
> (`v1.7.6` ships `VERSION` 1), so this is an amendment, not a new step.
>
> Verification: full gate green (BE 1,996 · FE 2,582). New pins: the pin validator (both arms, null,
> and six refusals incl. the retired bare stem and a `bundled` the source role does not ship) · the
> registry invariant that every slot binds from a role of its own namespace · both migration arms
> under both shapes + idempotency + the consumed-key report · `activeSeat` binding the EXACT row where
> a file `lyra.webp` and the bundled id `lyra` coexist (named for what it is: the ambiguity is now
> unrepresentable) · a cleared/malformed pin marking nothing · both write shapes end-to-end. Retargeted
> rather than deleted: the "duplicate name" collision note (now: no note, and both entries separately
> pinnable) and the send-time namesake REFUSAL (now: the tap lands, and the refusals that remain are
> the tier ones). Stash-verified: the seat-resolution and write-shape pins fail without the change.
>
> **W9 RIDER — the duplicate badge is scoped to roles that BIND BY NAME (main-seat ACCEPTED,
> builder-found).** The same deletion, one level down. `libraryItems`' key-shadow arm ran for every
> section, so a POOL holding `a.png` beside `a.webp` was told *"Two files answer to 'a'. The one higher
> in the list wins — move this one to the top to use it."* Both sentences described a MECHANISM — the
> bare-stem pin, which reached whichever of them the collation listed first — and typed pins removed
> it: a pool binds by POSITION, nothing addresses its entries by name, so there was no winner to name
> and no tie to break. A warning that outlived what it warned about is noise wearing a warning's
> clothes. The precondition is now one fact from the section descriptor (`MediaRoleDef.kind ===
> "named"`, passed down for the reason every theme fact is — this module holds no registry import), so
> defect #4's real case is **byte-identical** wherever the mechanism is alive: a `named` role's per-key
> ladder, where a shadowed file genuinely paints nowhere. Pinned as an ABSENCE (a pool's stem clash
> shows no note and both entries stay ordinary, switchable, arrangeable members), stash-verified.
>
> **W9 CONFIRM ROUNDS — both lenses closed, and the tail they converged on.** Emma's lane returned
> **"RESOLVED WITH NEW FINDINGS"** (four, two chained); the design lens returned **F1–F7 all
> CONFIRMED-RESOLVED**, conceded F6, and said **"SHIP once NC1/NC2 land"**. The two arrived
> *independently at the same prescription* for the scoped restore, which is the tail's first fix:
>
> · **A SCOPED restore must not SWEEP** (`restoreDefaults` → `touched: first, sweep: within ===
>   undefined`). The sweep is what makes a stated order the whole SECTION's, and a scoped restore
>   speaks for one key's layer — so sweeping listed every OTHER key's bundled row into the owner's own
>   tier as a side effect. That is not cosmetic: tier membership decides what a later upload replaces,
>   so restoring frontier's `cube` re-tiered `platform-mid`/`platform-base` and a subsequent drop into
>   `stack/` would have composited over them instead of replacing the fallback. Listing the covered
>   defaults is `touched`'s own job — the ids the write explicitly acted on — and out-of-scope rows
>   that were ALREADY listed survive as held entries. The unscoped restore still sweeps, because there
>   the stated order genuinely is the whole section's; both arms are pinned.
> · **NC1 — the restore affordance gates on the SCOPE's defaults, not the ROLE's**
>   (`rows.some((r) => r.bundled != null)`). The kit's `service-banners` role carries cosmos's
>   twelve-banner ROTATION, so every per-service KEY gallery passed a role-level `def.bundled.length >
>   0` while holding no bundled row of its own — offering a "Restore defaults" whose only reachable
>   effect was to switch the owner's banner off and put nothing back. The rows on screen answer it
>   exactly. Pinned both ways (the key scope has none, the rotation scope still does).
> · **F5 minor — the dead shape deleted.** `deriveKeyBindings` returned a generic file classification
>   (`binding`) beside its key rows and filled each row's `file` from it; F5 moved the family card onto
>   the role's own §2.4 ladder, and the sole caller has passed `[]` ever since. Computed over nothing,
>   read by nobody, and still shaped like load-bearing code. The field, the `files` parameter that only
>   fed it and the never-set `file` field are gone. **`classifyNamed`/`NamedBinding` are NOT** — that is
>   the answer's implementation rather than the husk, it keeps its own describe block, and every
>   file-side assertion the derive tests carried is already covered there verbatim. *(Residual for the
>   main seat: with `binding` gone, `classifyNamed` has no production caller left — a separate ruling,
>   not this tail's to make.)*
>
> **Emma's MED lane-stall finding is RULED RECORDED-NOT-FIXED.** A hung settings PUT now holds the
> app-wide media lane, where pre-W8 it held one namespace's queue — a real widening. The fix is not a
> timeout at this call site: `useSettings.ts` already records the standing gap in two places ("the kit
> grows a global request timeout"), and a per-call timer here would be the second idiom for a question
> that must have one home. **Owned by Phase 19's reliability packet.** Her other three findings are
> closed by this tail. The design lens's **F6 overrule is CONCEDED** on the stronger mechanism
> argument: the minimal write lists the disk tier ahead of a touched bundled row, so the key-grid jump
> it feared cannot occur.
>
> **W9 RIDER — the ESLint accounting is honest again** (QUALITY.md, the count's only home): `49` had
> been stale since 2026-08-20; the real figure is **78** (`refs` 38 · `only-export-components` 23 ·
> `set-state-in-effect` 16 · `exhaustive-deps` 1), and the growth is Phase 21's own surfaces — 14 of
> the `refs` are `GalleryModal.tsx`'s focus-trap and drag latches. **It predates W9** (measured 78 with
> and without the change) and is recorded as such so the delta is attributed rather than absorbed. **No
> warning was fixed** — F13 stays trigger-gated.
>
> **W10 — the gallery second pass: edit-in-place, framing on defaults, the layout cleanup (owner
> rulings 2026-08-26, prose; design researched to the least-future-debt bar, main-seat-final).**
> The owner's round after the W7–W9 sign-off: ① the modal ✕ sits below the circle's centre ② no way
> to re-frame/re-crop after upload — and no Framing on ANY image in Characters/Banner slides (their
> folders are empty, so every entry is bundled and the bundled exclusion bit at 100%) ③ the gallery
> body stacks five text blocks above the grid, three of them redundant ④ the owner's standing bar:
> maximal reuse, no over-engineering — and, mid-design, an explicit directive that **edit must be a
> standalone capability, not an upload appendage**.
>
> **⑴ The ✕.** `.pm-x` renders a literal `✕` character; a text glyph centres its LINE BOX, not its
> ink, so it rides the baseline low in all five `.pm` modals. Fix: a hand-inlined SVG X (lucide `x`
> geometry, the house icon pattern) in a new shared `components/icons.tsx`, used by all five call
> sites. Verified visually on dev after the build (the owner's ask).
>
> **⑵ The gallery layout** (approved in prose): the GRID LEADS. Header keeps title + ✕ and gains ONE
> status line folding the count and the mode sentence (`8 images · dealt to machines in this order` —
> stays the section's one `role="status"` live region). Exceptional notices only above the grid
> (failure row · dangling pin · seat built-in). Bottom cluster, in order: the dashed **Add an image**
> row → one mono line merging the path with its purpose (`or copy files into media/gacha/reel/`) →
> **Restore defaults** as a quiet text button, its `<small>` explainer DELETED (the confirm dialog
> already says it). DELETED as redundant: the role hint (verbatim on the section card underneath) and
> the standalone `mgal-scope`/`mgal-count` paragraphs. The empty-state copy flips "above" → "below".
>
> **⑶ Edit-in-place — the standalone job machine.** `useMediaUpload`'s front half (guard ladder →
> crop step → export) MOVES into a shared `useImageJob` machine: *source File in → guard → CropModal
> → export worker → bytes out*, owning the one latch, the phase words and the failure row. DELIVERY
> is the pluggable tail (plain strategy injection, not a framework): the **upload** consumer keeps
> its exact semantics (mint → PUT walking suffixes on 409 → register through the write queue,
> two-phase resume/reconcile — code transfers verbatim); the **edit** consumer is new and smaller:
> fetch the stored bytes (`revUrl`) → the same front half → **conditional PUT to the SAME filename**
> → invalidate `["media", ns]`. No register (the entry keeps its config identity), so order/in-use/
> key survive untouched, and the revision change auto-stales any stored focal — the framing sheet's
> existing "Framing was reset" path absorbs the consequence with zero new code.
> **The backend arm:** the PUT accepts an **`X-Expected-Revision`** request header (house precedent:
> `X-Providers-Rev`; deliberately NOT `If-Match` — the media mount's GETs already serve Starlette's
> own ETag, a DIFFERENT validator, and a second meaning for the same header on one URL space is a
> false HTTP promise). Header present + target exists + index revision matches → `os.replace` instead
> of `os.link`, fsync, **200** with the fresh row (create stays 201); mismatch or no target → **412**
> ("the picture changed on the server — reopen it and try again"). 412, not 409, ON PURPOSE: 409 is
> the create-path's suffix-walk trigger and the two meanings must never share a code. No header →
> today's create-only 409, byte-identical. This REVIVES the council-1 "revision-preconditioned
> overwrite" in library-model form (§13 row added).
> **Entry point:** an edit (crop) icon floating top-right of the detail stage, mirroring `mgal-back`,
> gated like Delete (owner files only, not unusable, `caps.upload`). **Recorded residuals:** each
> re-crop re-encodes the stored bytes (q0.85 generation loss; crop-of-the-crop — the original is not
> kept, by the additive-library ruling); a lost-response retry reads as 412 and the copy says reopen
> (the accepted two-devices class).
>
> **⑷ Framing on bundled entries — the recorded H3 seam, built.** The config already carries `focal`
> on every bundled entry; the mode-is-a-property-of-the-item design was built for this. Changes:
> `focalState` learns a bundled row's point is keyed to nothing (bundled bytes are content-hashed by
> the build and immutable under a running app) — a valid point reads `set`, stored `rev: ""`; the
> `item.bundled` refusals in `setFocal` and `canFrame` drop; roster `toEntry`/`toNamed` prefer a LIVE
> owner point (centred) over the shipped hand-tuned string (proportional) — absent a point the
> shipped look stays BYTE-IDENTICAL, and "Clear framing" restores it. The FramingSheet works as-is
> (it resolves bundled URLs via `tileUrl` and measures natural size itself).
> **Dims for the centred math** (bundled rows carry none on the wire): the ASSET-RECORD convention —
> R57's field survey is unanimous that focal values store bare fractions and dimensions live with the
> asset record (Sanity/Craft/Umbraco/Kirby), and our wire rows already follow it. So the roster's
> bundled entries/scenes gain `width`/`height` — numbers `art.ts`'s own export recipe ALREADY records
> (640×854 characters · 1240×700 scenes) — promoted to fields and pinned by an HONESTY TEST that
> reads the real asset files with `readImageHeader` (fs + the existing pure parser; drift becomes a
> failing test, not a silent mis-frame). The rejected shapes, recorded: dims inside the stored focal
> (mixes asset metadata into a user choice, two dim sources by row type, against the field
> convention) · runtime natural-size measurement (paint jump, complexity in the one mapping hook).
> **Recorded residual:** a future release that re-arts a bundled id under the same name inherits the
> owner's point un-warned — the same acceptance the hand-tuned strings have always had.
>
> **Test obligations (§11 discipline):** the job machine's latch/phase/failure states with both
> deliveries · backend replace arm (match replaces + re-describes · mismatch 412 · headerless-exists
> 409 unchanged · revision moves) · `focalState` bundled cases · `setFocal` transform on a bundled id
> · roster override assembly (live point → centred with dims · none → shipped proportional,
> byte-identical) · the dims honesty test · e2e media specs re-run locally (the layout reorder moves
> selectors).
>
> **W10 AS-BUILT + REVIEW RECORD (2026-08-26, review-CLOSED).** Opus-built from the block above as
> six commits `b2d40a5`…`d6a08fc` (a pre-fix first: the Restore-defaults e2e was still pinned to the
> PRE-W8 write — a stale-pin burn only the release-tag CI run would have caught; then the ✕ + layout ·
> the machine split, upload tail moved verbatim with its own suite passing unmodified · the replace
> arm + `useMediaEdit` + the Edit glyph · bundled framing + `BUNDLED_SIZES` + the dims honesty test —
> **which caught the recipe's own numbers wrong on day one**: `lyra.webp` is 535×740 and `rook.webp`
> 640×740, `withoutEnlargement` passed both sources through). Builder judgment calls all
> main-seat-ACCEPTED (the shared `Glyph` frame's move to `components/icons.tsx` · the `mgal-title`
> header stack · the loader `FileSource` admission form · `jobBusy` as its own prop · CropModal's
> aspect off the job). Main-seat audit riders `b951827`: `.path` genuinely monospace (the card
> comments claimed mono; no rule ever set the face) + the art.ts recipe comment corrected to point at
> the roster's authoritative records. Live 390px screenshot round on dev delivered (✕ centred · the
> ruled layout · Framing on a bundled default · the Edit pencil on an owner file).
> **The Emma-lane blind round (sol high, `--ignore-rules`): SHIP WITH FIXES — 4 MED, zero HIGH**, and
> the load-bearing areas explicitly cleared (the replace arm · bundled framing incl. the seat path
> through `slotEntry()`/`toWideArt()` · the edit byte chain · focus/trap; open sweep "none"). All four
> accepted, fixed as `dcec78c`: ① `JobFailure.abandon` — dismissed-or-replaced failures release the
> upload's pending Blob, the failure's own retry never does (the `failureRef` sync twin tells the two
> clears apart) ② the edit's own `replace` phase + copy ③ the folder line absent on rotation scope +
> the empty state promises only a rendered Add row ④ the failure row is `role=alert`, the header line
> stays the one `status`. **Confirm round (resumed session): all four RESOLVED with line-proof, NEW
> defects "none"** — she re-checked the risky orderings (retry-vs-abandon, replacing-admission latch
> order, cancel-during-crop, double-fail) unprompted. Full gate green at tip (BE 2,002 · FE 2,619/157).
> W10 residuals stand as recorded in the block above.

## 13. Research reconciliation (v2 rows; v1 rows stand except where struck)

| finding | source | ruling |
|---|---|---|
| v1 Replace/Cancel · `?overwrite` · revision cleanup · order-patch rider · `write_enabled` | R55/R56 + council 1 | SUPERSEDED (library model) — **the revision-preconditioned overwrite REVIVED by W10** as the edit-in-place `X-Expected-Revision` arm (create-only PUT unchanged) |
| v1 focal deferred · accordion disclosures | R56 | SUPERSEDED (owner; R59) |
| clamped-centred math + the s≤1 guard as contract | R57 §5 + Emma #1 | ACCEPTED |
| reticle control · editable-later · previews · `{x,y}` storage · rev-keying | R57 §9 | ACCEPTED (rev-key restored by Opus M2) |
| per-item mapping mode (proportional bundled · centred owner) | council H3 | ACCEPTED — supersedes "one rule everywhere" with "one FUNCTION everywhere" |
| extend `useDragReorder`; held-commit | R58 | ACCEPTED (+ the explicit error release, Emma #8) |
| 3-col grid · full-screen modal · preview-card entry · explicit set-active · two corners · detail panel | R59 §11 | ACCEPTED |
| defaults below a labelled divider | R59 §11.5 | DEVIATION recorded (§6.6): ours are reorderable by owner ruling |
| "currently painted" marker for dealt pools | R59 §6.4 | NON-BUILD (word-in-header adopted) |
| server manifest for migration parity | Emma #2 fix | ROAD NOT TAKEN — fallback-tier collation (§2.3/§2.4) achieves parity config-pure |
| server revision tokens for `files` writes | Emma #3 fix | ROAD NOT TAKEN — client serialization at the chokepoint; two-device residual accepted |

## 14. Council record — round 1 (2026-08-24 morning, on v1)

Emma BUILD WITH CHANGES (9 MED + 1 LOW + 2 confirm catches → all-RESOLVED); adversarial Opus
BUILD WITH CHANGES (3 HIGH/7 MED/3 LOW/3 sweep + 3 confirm pins → "RESOLVED overall"); one
partial overrule (standalone phase doc). Surviving catches: the two-tier predicate, the
`.part`/persist ladder, the fixture fence, free-ratio (H1), house-primitive reuse (H2), per-role
export (L1). The v1 six-module decomposition (H3) is superseded by §12's larger pinned map.
Findings superseded by the owner's model change are struck in §13 — the premise moved, not the
catches.

## 15. Council record — round 2 (2026-08-24, on THIS rewrite; confirm rounds CLOSED, both lenses final-RESOLVED)

**Emma lane (blind, sol high; correctness/security): BUILD WITH CHANGES — 1 HIGH + 9 MED.**
E1 focal singularity (HIGH) → folded §5 (guard = contract). E2 migration needs FS facts → fix
RE-DERIVED (fallback-tier collation, §2.3/§2.4; her manifest = road not taken); **her confirm
round caught the re-derivation incomplete — the wire lacked the listed-vs-fallback fact, so
ladders couldn't implement their predicates without a config side-channel; closed by §2.3 ④
(`listed` on every row · hidden rows present-but-marked · resolver purity) + the §11 E2 arm.** E3 files-list
lost update → RE-DERIVED lean (serialized chokepoint queue, §4; tokens = road not taken;
two-device residual accepted). E4 two-phase upload retry → folded §4. E5 history orphan → folded
§6.2 (single closer). E6 bundled framing jump → folded §5/§6.6 (non-framable v1). E7 suffix vs
255 bytes → folded §2.5. E8 drag error release → folded §7. E9 aria-checked → folded §6.5.
E10 identity invariants → folded §2.2. Sound list: collation determinism, pin tie-break
determinism, v7-under-v6 rollback refusal, verb design, DELETE-first degrade, #8
index/mount consistency (now moot per M5), contain-exclusion, cross-role write composition.

**Adversarial Opus (architecture/design): SHIP WITH CHANGES — 5 HIGH + 8 MED + 3 sweep.**
H1 active-resolution seam → folded §2.4. H2 collation chokepoint + wire → folded §2.3.
H3 focal three-patterns → folded §5 (item-mode; S4 re-sized). H4 FE module map → folded §12
(+ zero-net-lines acceptance). H5 derived-key card explosion + unbound files → folded §6.1
(⚠ owner eyeball: refines the uniform-scope ruling). M1 seat capabilities → folded §2.1/§6.4.
M2 focal rev-key → folded §2.2. M3 decode budget + SW bound re-base → folded §6.3. M4 preview
geometry → PARTIAL (coarse-by-design + "examples" caption + invariant tests where exact; CSS-var
inversion = road not taken; rider ACCEPTED: retire `MediaSlotDef.bundled`, S0). M5 defect-#8
re-ruling → folded §3/§8. M6 Packet ④/⑤ notes → folded §9. M7 key-vs-stem precedence → folded
§2.2. M8 latch residue → folded §4. Sweep: `collation: "library-v1"` (folded §2.3) · `hidden`
rename (folded §2.2) · pin stem/id note (folded §2.3). Incidental: the all-unusable-role parity
arm → folded §11.

**Main-seat notes:** two Emma prescriptions re-derived leaner per the standing calibration (take
the finding, re-derive the fix); H5 refines an owner ruling and is flagged for the owner's
eyeball in §6.1/§10; E6+H3 compose (item-mode carries bundled-proportional; framing hidden on
bundled).

**Confirm rounds (2026-08-24):**
- **Emma: 9/10 CONFIRMED-RESOLVED on the first pass; her E2 confirm caught the re-derivation
  incomplete** (the wire lacked the listed-vs-fallback fact) → closed by §2.3 ④ →
  **final micro-confirm: "CONFIRMED-RESOLVED … Final verdict on v2.1 — RESOLVED."**
- **Opus: 14/16 CONFIRMED-RESOLVED; 2 blockers + 4 rider residuals, all folded:** the same wire
  fact (H2 — landed §2.3 ④ concurrently with his read) · **cross-lens ① first-drag tier
  promotion** (whole-list writes would sweep the fallback tier into the fleet deal) → the
  tier-preserving-writes rule, §2.3 · **cross-lens ② pin-beats-pool phantom** → `overriddenBy`
  on the resolver return, §2.4/§6.1 · H1 rider (import direction + derived FE bundled ids,
  §2.4/S0) · H4 rider (descriptors live in the registry, `lib/` stays theme-free, §12) ·
  M4 ask (type-doc caption, S0) · sweep-② rider (`hidden` vs `unusable` opposite treatments,
  §2.2). **His final confirm caught the tier rule one clause too broad** (uniform tier
  preservation made a drag below an unlisted SSH-dropped file inexpressible — visible snap-back
  on the owner's populated tree) → **split by kind, §2.3 ③** (disk rows sweepable, order-only
  effect; bundled rows never) → **final confirm: "CONFIRMED-RESOLVED … Final verdict: RESOLVED —
  the plan is ready to build; no blockers remain from the architecture/design lens."**

**COUNCIL ROUND 2: CLOSED, both lenses at an explicit final RESOLVED (2026-08-24).**

## 16. Device-round probes (S6)

EXIF portrait end-to-end · 413-mid-body over Tailscale Serve HTTPS · does the Honor 20 produce
HEIC · PWA-standalone survival across the picker activity · jpeg q0.85 eyeball · crop/framing/
drag feel · Fennec expected-partials · the Back-gesture close on device.

> **S4 riders (2026-08-25) — three probes the desktop half cannot answer.**
> · **RETICLE FEEL ON TOUCH.** The whole control is a pan under a fixed square, and its two numbers are
>   guesses until a thumb is on them: `RETICLE_FRACTION` (0.3 of the stage's short axis, floored at 64 px)
>   and `TAP_SLOP` (6 px — a tap that moved further is a drag, and the click a drag leaves behind must not
>   re-place the point). Ask on device: is the square big enough to aim with and small enough to see past;
>   does tap-to-place ever fire when the owner meant to drag; is the corner actually reachable now that the
>   pan runs to half the picture. There are no arrow keys on a phone, so the previews are the only
>   compensator for a fingertip being ~11% of the picture wide (R57 §2.3).
> · **PREVIEW HONESTY ON THE REAL DESTINATIONS.** The three `characters` previews are declared COARSE
>   (capsule card 3/4 · promo slide 390/232 · magazine cover 9/16, the last two measured at 390 px). The
>   question is not whether they are exact — they are captioned "Previews are examples" precisely because
>   they are not — but whether they are USEFUL: set a point on the phone, then walk the fleet, the dossier,
>   the poster and the cover and say whether the previews predicted what happened. If one of the three
>   teaches nothing, it is a row to drop; if a fourth window keeps surprising, it is a row to add.
>   **First owner datapoint (2026-08-26, the W10 desktop round):** the banner preview reads "a little
>   more white vertically" than the real slide — the recorded at-390px approximation showing itself
>   (`.gc-banner` is a FIXED 232px tall, so on a wider viewport the real slide is shorter than
>   390/232); framing outcomes still judged good, and the owner weighed the gap as minor at preview
>   size. The refinement candidate if this probe upgrades it: compute height-involved aspects from
>   the LIVE viewport (`innerWidth/232`) instead of the pinned 390 — still an example, honest per
>   device. Rule it on the phone, not before.
> · **PER-WINDOW CORRECTNESS ON THE MULTI-WINDOW CAST.** The claim S4 exists to make: ONE library entry,
>   framed once, staying framed in eight differently-shaped windows. Drive it on the real cast — a
>   portrait with a face high in the frame, a landscape with the subject off to one side — across all
>   three fleet layouts, the dossier's portrait AND its watermark, and the operator backdrop. **And the
>   one that is expected to look WEAKER: the fleet backdrop**, which cannot measure itself and falls back
>   to proportional alignment (see §12's S4 as-built). Is that visible through the scrim, and does the
>   owner mind?

> **S5 riders (2026-08-25) — three probes only a thumb can answer.**
> · **THE LONG PRESS.** Touch activates on a 500ms hold (Android's `ViewConfiguration` long-press
>   timeout and iOS's `minimumPressDuration`, which agree) with 10pt of slop (Apple's
>   `allowableMovement`) — and every one of those numbers is somebody else's, chosen because the field
>   agrees rather than because we measured a thumb on THIS grid. Ask on device: does the hold land
>   before the owner gives up on it, and does the lift READ as a lift when it does (the tile scales
>   1.02 and takes a shadow — is that visible at 110px, or does it need the shadow to grow rather than
>   the tile)? A haptic tick on activation is the field's other answer and is deliberately NOT built:
>   it is an OS-level effect with no house switch behind it, and inventing one for a 3ms buzz is the
>   wrong order of operations.
> · **DRAG vs SCROLL.** The whole compromise of a body-grab is that a swipe must still scroll: movement
>   before the hold lands ABANDONS the gesture and hands the pointer back to the page. Drive the grid
>   the way a phone gets driven — flick to scroll, hold to drag — and say whether either ever steals
>   the other. The failure to watch for is the *near miss*: a hold that lands just as the finger starts
>   to move, which is a drag the owner meant as a scroll.
> · **AUTOSCROLL, one-handed.** Band `min(20% of the modal body, 96px)`, `p²` ramp to ~600px/s, 200ms
>   of dead time before the first pixel. On a full library the owner has to drag a tile from the bottom
>   of a long grid to the top: is the band reachable with the thumb that is already holding the tile,
>   is 600px/s the difference between "it moves" and "it flings", and does the 200ms of dead time stop
>   an ordinary pass near the edge from scrolling at all? These are the numbers R58 §3.7 said were
>   worth 5× disagreement across four shipped libraries — ours is a reading of that spread, not a
>   measurement.

> **S3b riders (2026-08-25).**
> · **EXIF portrait is ALREADY ANSWERED on the desktop half** — the built app against the real dev
>   backend stored an `Orientation=6` 400×200 JPEG as a **200×400** file with EXIF/XMP gone (JFIF + a
>   ~470-byte sRGB ICC left, exactly as R54 §3.5 measured), and the e2e now asserts both in-browser.
>   What is left for the device is the PHONE's own decoder on the phone's own photo.
> · **NEW PROBE — the guard's DOUBLE DECODE.** §4's ladder ends in a `createImageBitmap` proof, and
>   the worker then decodes the same file again to export it: two full decodes per pick, ~192 MB of
>   peak RGBA apiece on the owner's 48 MP camera. Desktop cost is invisible (55–190 ms); a mid-range
>   Android is 4–8× slower on this work and Chrome caps decoded bytes at `totalRAM / 25`. **Time one
>   48 MP pick on the Honor 20**: if the proof rung is what hurts, the recorded alternative is to let
>   the crop modal's own `<img>` load BE the proof (it already decodes, and its `onerror` is the same
>   verdict) at the cost of surfacing an undecodable file one step later.
