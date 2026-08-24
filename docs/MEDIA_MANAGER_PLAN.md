# MEDIA_MANAGER_PLAN — the media manager: in-app upload · crop · delete · the gallery redesign

**Status: COUNCIL-CLOSED 2026-08-24 (§11: Emma correctness lens 10 findings + 2 confirm catches →
all-RESOLVED · adversarial Opus design lens 3 HIGH/7 MED/3 LOW/3 sweep + 3 confirm interaction
pins → "RESOLVED overall"; every finding folded, one PARTIAL overrule recorded). OWNER RULINGS
PENDING (§9) — nothing builds until the owner's decision session rules.** Owner directive (2026-08-24): this ships **before Phase 19 completes** — an explicit
forward-ruling on the Packet ④ (`core/media.py`) / Packet ⑤ (gallery FE) overlap. Evidence =
**R54** (crop/picker client) · **R55** (upload backend) · **R56** (gallery UX), all bought, verified
and curated 2026-08-24. Locks as **D65** (amending D52 §5.4 + D53). Parent read-side records:
MEDIA_PLAN.md (D53/D54) stays the authority on namespaces/roles/kinds.

## 0. Goal (owner's words, condensed)

For every custom-art surface: **upload images directly from the phone** (an image picker, no camera
path), **crop at upload or use as-is**, **delete**, and **reorder for priority** — all inside the
Conf galleries, each gallery collapsed under its own drop-down so the Theme-art/Shared-art groups
stay uncluttered, with a **separate upload button per image/icon section** (no global upload, no
typing binding keys). Easy to manage and understand.

## 1. The security reversal (D65) — the one locked thing this plan changes

D52 §5.4 ruled "no write API, ever" because the app has no auth and the tailnet is the boundary.
**The owner reverses that for typed media writes.** The original concern was real and R55 §2
sharpened it into the actual mechanism: the danger was never "someone on the tailnet" (the owner's
own devices) — it is the owner's **browser**, which executes other people's JavaScript all day, and
a cross-origin `POST` of `multipart/form-data` is **CORS-safelisted**: no preflight, the write
lands, from any website. The fix is free and structural:

- **The write endpoints take a raw body via `PUT` and `DELETE`** — never multipart, never `POST`.
  Non-safelisted verbs force a CORS preflight; we run no CORS middleware (verified: zero hits) and
  answer no `Access-Control-Allow-Origin`, so a cross-origin browser write dies before it is sent.
  Same protection `PUT /api/settings` already enjoys, now by recorded design rather than accident.
- Writes land **only** in registered `$CTRLB_HOME/media/<ns>/<role>/` dirs (the same
  `MEDIA_NAMESPACES` + `media_health` gates the read side uses); bytes are validated with the
  existing `probe_image` **before** the file reaches its final name; extension must agree with the
  probed format; a streamed byte counter enforces the cap (`Content-Length` is not trusted); a
  rejected upload leaves zero bytes behind.
- **A whole-feature kill switch** (`media_write.enabled` — it gates BOTH verbs, §2/§5) per the standing enable/disable
  requirement — a posture reversal you can switch back off.
- **No server-side image processing, still.** No Pillow, no decode. The crop runs on the phone; the
  server receives finished png/jpg/webp bytes and probes their headers, exactly as it does for SSH
  drops. (R55: no peer in class magic-byte-validates uploads at all — we keep the stronger gate.)
- SECURITY_MODEL gains a §2.x for the write surface, **including the premise correction**: the §CSRF
  "no session to steal" reasoning does not cover unauthenticated *writes*; the safelisted-verb
  analysis is the operative rule. The existing `POST /api/voice/stt` (`UploadFile`) is the one
  standing instance of the safelisted class — **dispositioned to the Phase 19 register**
  (HARDENING_PLAN §8.2), not fixed here (fix-in-owning-phase).
- **Recorded residual — DNS rebinding (Emma council #3):** the preflight argument protects
  cross-ORIGIN writes; a rebinding attack makes the request same-origin against the raw LAN
  `0.0.0.0:5433` bind (Host is never validated), and CORS never runs. This is a property of the
  WHOLE API today (`PUT /api/settings` included), not of the new endpoints — so it lands in
  SECURITY_MODEL as a named residual **plus a Phase 19 register row** with the lean app-wide fix
  named (Starlette `TrustedHostMiddleware` allowlisting emma's names/IPs), rather than a bespoke
  media-route guard. The plan's CORS invariant is also pinned by tests (§6) and an architecture
  guard: adding CORS middleware without revisiting D65 must fail a test.
- The read-side docstrings that assert "there must never be a write API here"
  (`core/media.py` header, `api/media.py` header, `MediaGallery.tsx` header) are rewritten to keep
  the original reasoning and record what changed the answer (R55 §9 ②) — the doc-truth rule.

## 2. The backend write API (R55's contract, adopted)

```
PUT    /api/media/{ns}/files/{role}/{filename}[?overwrite=<revision>]
       Content-Type: image/png | image/jpeg | image/webp · body = raw image bytes
    -> 201 MediaFile (describe_file — the existing wire model) · 200 when overwrite replaced
    -> 404 unknown ns/role · namespace disabled · (DELETE) not there
       409 name exists and no overwrite given — the detail carries the existing file's
           revision; ALSO 409 when the given overwrite revision no longer matches (the file
           changed or vanished since the client saw it — re-offer, don't clobber)
       413 streamed bytes exceeded the cap (detail names the limit, never the true size)
       415 extension not allowlisted, or probed bytes disagree with the extension
       422 filename not representable, or empty body
       503 media_write.enabled is off (BOTH verbs — the kill switch gates DELETE too)

DELETE /api/media/{ns}/files/{role}/{filename}[?revision=<revision>]
    -> 204 | 404 | 503 · 409 when a revision is given and the file on disk no longer matches it
       (it was replaced since the caller observed it — refuse, don't destroy the newer bytes)
```

- **Overwrite is revision-preconditioned, never a bare flag (Emma council #2):** the 409 hands the
  client the existing file's `revision`; the Replace retry sends it back
  (`?overwrite=<revision>` — If-Match semantics on the identity token the wire already carries).
  A stale confirmation left open on one device can no longer clobber a newer replace or resurrect
  a concurrent delete — both re-409. The stat→replace micro-window that remains without a lock is
  an **accepted residual** (single owner, atomic `os.replace` — the file is always one complete
  version of one upload); a global write lock is the recorded road not taken.

- **Shared URL with the read mount is safe** (verified: Starlette records a method mismatch as
  `Match.PARTIAL` and keeps looking — GET falls through to the mount; the router is already
  registered before the mounts in `create_app`).
- **Persist pipeline** (R55 §4.4, order load-bearing): validate address → `mkstemp(dir=role_dir,
  prefix=".upload-", suffix=".part")` → `fchmod 0o644` (match SSH-drop modes) → stream+count → 413
  on excess → `flush`+`fsync(fd)` → `probe_image(tmp)` → 415 on mismatch → `os.link` (no-clobber,
  409 on `FileExistsError`) or `os.replace` (overwrite) → unlink tmp → `fsync_dir(role_dir)` →
  return `describe_file(dest, ns, role)`. **The `.part` suffix is load-bearing**: `list_role`
  filters on extension alone, so an allowlisted-suffix temp would appear in a concurrent index and
  take a pool position (R55 §4.2).
- **Filename rules = TWO tiers, one home (`core/media.py`), and the split is upgrade-safety
  (Emma council #1):** the **addressable** predicate (non-empty, not `.`/`..`, no `/` or `\`) is
  today's `config.py` order-list semantics extracted verbatim — the config validator adopts it with
  **no tightening**, so a config that boots today boots after the upgrade (files like `.hero.png`
  or NFD names that the read side already lists and orders stay valid there; an upgrade test pins
  one such entry). The **upload-admission** predicate composes on top for new writes only:
  NFC-required (reject, don't rewrite — a rewritten stem in a named role binds to nothing), no
  `<>:"|?*` and no C0 controls or DEL (the client's Windows set + DEL), **no U+FFFD** (uvicorn decodes malformed percent-encodings with
  replacement, so `bad%FF.png` would otherwise silently create a name differing from the requested
  bytes — Emma #8), no leading dot, no trailing dot/space, stdlib **`ntpath.isreserved`** for the
  DOS-device class (a hand-rolled set misses `con.foo.png` and superscript aliases — Emma #9),
  ≤255 UTF-8 **bytes** (measured `NAME_MAX`), extension ∈ `ALLOWED_TYPES`.
  **Reject with the reason, never sanitize into something else.**
- **DELETE touches no config** (verified: dangling `order` names drop silently at `list_role` and
  self-heal on the next reorder; a dangling pin renders "(missing)" for the owner to clear). Guards:
  the read side's `is_served_file` (third consumer of the one rule), 204/404 split, `fsync_dir`.
- **Boot sweep:** `ensure_media_dirs` gains a ~5-line sweep of stale `.part` files (a hard kill
  mid-upload leaves one; nothing else ever would).
- **Concurrency needs no lock**: per-request `mkstemp` + atomic `link`/`replace` — the filesystem
  primitive is the lock (R55 §8.1).
- **Reuse ledger** (everything but the streaming writer exists): `MEDIA_NAMESPACES` ·
  `media_health` · `ALLOWED_TYPES` · `probe_image` · `is_served_file` · `describe_file` · `role_dir`
  · `fsutil._fsync_dir` promoted to public `fsync_dir` (keeps the OS-branch allowlist count — a
  re-derived dir-fsync would add a fifth branch and fail `test_arch_invariants_qh9`).

## 3. The client pipeline: pick → guard → crop-or-as-is → export → upload (R54, adopted)

- **Picker:** hidden `<input type="file" accept="image/png,image/jpeg,image/webp">` (explicit types
  — routes to the Android photo picker on Chrome 13+ and seeds `EXTRA_MIME_TYPES` on both browsers;
  still a hint, so validation stands). No `capture` attribute — **note the owner's "no camera"
  ruling is honored as "we build no camera path"; both Android browsers add a camera source to
  their chooser regardless, and that cannot be suppressed** (R54 §5.1). `input.value = ""` reset in
  the change handler (the classic cancel-then-repick dead-end). Desktop drag-drop + paste ride along
  (~15 lines, phone-inert).
- **Input guard, before any decode:** byte cap → header-parsed dimensions cap → HEIC/TIFF/SVG
  refused **by name** (Android does not transcode images; neither engine decodes HEIC; no wasm
  decoder — a `heic2any`-class bundle would dwarf the app). Then `createImageBitmap(file)` as the
  decodability proof; its rejection is the catch-all. **The client header reader is scoped to the
  DIMENSION read only** (format identity is `createImageBitmap`'s job) **and fenced (Opus council
  M7):** it is the one place the repo holds two parsers of one byte format, so a **shared fixture
  corpus** feeds both — the same image files drive the pytest `probe_image` arms and a vitest arm
  asserting identical (w, h) verdicts — a dimension-only reader has no format verdict to
  compare (Opus confirm); drift fails a test instead of shipping.
- **Crop step (R56 §5 + R54 §2):** immediate modal on pick — **`react-easy-crop@6.2.3`** (8.60 KB
  gzip measured, no dep tree, the only candidate with real pinch-zoom, crop rect already in source
  pixels; adoption riders: `aria` via `cropperProps`, a visible zoom slider, CSS imported with
  `disableAutomaticStylesInjection`). **The window opens FREE-RATIO — at the image's own aspect —
  for every role in v1 (Opus council H1):** the draft's fixed-aspect windows were checked against
  the CSS they claimed to describe and were wrong on all three declared roles — `kit-svcicon` and
  the brand mask paint `contain` (nothing crops; a forced 1:1 would make the owner cut a wordmark
  that letterboxes fine today), and the service-banner's crop geometry is adopter-variable
  (`--kit-banner-size/pos`, the D54 A2 contract) so it belongs to the theme, not the role. Because
  crop is destructive, a wrong declared aspect permanently discards pixels a surface would have
  used. The per-role/per-key `hint` prose carries the shape guidance it already carries; if a
  shape guide is ever wanted it lands where the geometry lives (`MediaKeyDef.aspect` for the
  frontier stack) — recorded, not built. **The window opens at the image's own rect; confirming untouched IS "use as is"** — two
  verbs, one ✓ (the Telegram shape — no product ships a skip button; its cover-fit-default
  idea, restated for a free-ratio window).
  Cancel unwinds totally.
- **Export (R54 §8, the probe-grounded rules):** in a Worker (`OffscreenCanvas.convertToBlob` —
  the main-thread pipeline drops ~4 frames on Gecko); **`ctx.drawImage(src, sx,sy,sw,sh, …)` and
  never `createImageBitmap`'s crop-rect form** (Chromium returns the wrong region on EXIF-rotated
  photos — probed, and Chromium's own `TODO(crbug.com/40773069)` says so); output capped to the
  role's registry `pixels` bound (≤4 MP ⇒ 60× under every canvas limit); two-step downscale past
  3×; `bmp.close()` everywhere; a one-pixel readback verifies the canvas actually painted (Chromium
  fails oversize canvases **silently**); **`blob.type` is read back and names the file's extension**
  (an unsupported `toBlob` type silently yields PNG — probed).
- **Always re-encode — "as is" is a crop rect covering the whole image, not a bypass.** One path
  applies the crop, normalizes to the allowlist, caps pixels, and **strips EXIF/GPS/XMP** (measured
  in both engines — the owner's home coordinates never land in the media tree, and the server needs
  no Pillow to strip them). Format policy: alpha-possible sources → `image/webp` q0.90, else
  `image/jpeg` q0.85 (the measured knee); fall back deliberately on an unexpected `blob.type`.
  **Per-role export override (Opus council L1):** an optional `export?: {type?, quality?}` beside
  `bounds` in the registry, defaulting to the two globals — `brand` (painted as a CSS MASK: only
  alpha is read, and lossy WebP rings a hard silhouette's edge) and the frontier `stack` (layer
  art) declare `image/png`. Same additive per-role shape the bounds already proved (Opus M6).
  **For a lossless export type the byte step-down is SKIPPED** (Opus confirm ③ — PNG has no
  quality axis): the upload proceeds and the advisory badge is the message, the plan's own honest
  fallback; one test arm pins it.
- **Named roles get the invisible "upload as":** the per-key upload affordance (the key panel row's
  button) names the file after its key — the owner never types a stem. Pool roles keep the picked
  file's sanitized stem. **Key-collision rule (Emma council #4):** the per-key flow checks for an
  existing file binding that key by NORMALIZED STEM (reusing `classifyNamed` — the gallery already
  computes it), not by exact filename: `cube.png` on disk + a new `cube.webp` upload is a REPLACE
  of the binding, not a fresh 201 beside a stale winner. The flow confirms, uploads the new file
  first, then deletes the old one (publish-before-delete — a failure leaves the old art intact;
  the one-request window where both exist and collation picks is an accepted flicker). **The
  cleanup DELETE is revision-conditioned (Emma confirm, new MED):** it carries the old file's
  revision as observed when the flow began; a 409 (someone replaced that file during the crop
  flow — a window spanning the whole confirmation, not the accepted micro-window) leaves BOTH
  files on disk, and the gallery's existing duplicate diagnostics make that visible and
  recoverable — never data loss. **And cleanup is SKIPPED when the final filename equals the old
  one** (Emma confirm 2): a same-name Replace is already the overwrite — its own success changed
  the revision, so a conditioned cleanup there would be a guaranteed false 409.
- **Upload:** `fetch` PUT with the blob; `["media", ns]` invalidation on success (the existing
  key). **The retry payload is the exported Blob + its final name/type — never the original
  `File`** (Emma council #6: retrying the source would bypass crop, the pixel cap, format
  normalization and the EXIF/GPS strip); the `File` is released after export, and a
  backgrounded-PWA eviction losing the transient retry is ordinary in-memory-state behavior.
  409 → a Replace / Cancel prompt (re-PUT with `overwrite=<revision>` from the 409's detail).
- **One job per role section (Emma council #5; scope pinned by Opus M9):** every admission path
  for a section — header button, per-key buttons, drop, paste — is disabled from pick until the
  job's terminal success/failure. This is a **second, per-section flag composed with** the
  existing gallery-global `busy` (`save.isPending` — correctly global, it guards the one settings
  PUT), **not a widening of it**: an export in role A must not block a reorder in role B. Queue
  depth is 1 in v1 (single-file pick, §9 Q9) — `multiple` would turn the latch into a queue and
  change nothing else. A second pick can never replace an in-flight job's `File`, revoke its
  preview URL, or receive a late worker callback aimed at the first.
- **Pool stem collisions get the same guard as named keys (Opus council sweep ①):** every pin
  addresses a STEM and every pin sources from a pool, so two files sharing a stem
  (`wallpaper.png` + a new `wallpaper.webp`) make a pin ambiguous — the `MediaFile.name` docstring
  already calls this a foot-gun. A pool upload whose normalized stem matches an existing file
  runs the same Replace / Cancel flow (Replace = publish-then-conditioned-delete of the other
  stem-holder), so the one-tap path cannot mint routine duplicates SSH drops only minted rarely.
  **And a pool Replace that changes the filename patches the `order` list in place (Opus confirm
  ②):** `order` holds FILENAMES — the dangling old name self-heals, but the NEW file would fall to
  the collation tail, and on a first-wins pool (background/brand/hero/oracle) that silently
  changes which picture paints. `useMediaUpload` substitutes new-for-old through the gallery's
  existing `patch({roles: {[role]: {order}}})` write (~3 lines at the chokepoint the gallery
  already owns). Named-key Replace needs none — order is only a tie-break there and the loser is
  deleted.
- **Post-encode byte check (Emma council #7, fix re-derived):** encoding size is entropy-driven,
  so the role's `bytes` bound can be exceeded below its pixel cap. The exporter makes ONE quality
  step-down retry when over; if still over, the upload proceeds and the existing advisory badge
  reports it — the bounds are advisories by design ("an oversize icon still paints"), and a hard
  client reject would make uploads stricter than SSH drops for no server-side reason. The §6
  "uploads never trip the badges" invariant is DROPPED for the honest version: the step-down is
  unit-tested, the badge stays the message.
- **NO `MediaRoleDef.aspect` in v1** (Opus council H1 — see the crop-step bullet above: the draft's
  three declared aspects were wrong against their own CSS; free-ratio everywhere, hints carry
  guidance, `MediaKeyDef.aspect` recorded as the future home). The one registry addition is the
  per-role `export` override above. Focal point stays out of v1 as an additive per-role capability
  (§9 Q6).

## 4. The gallery redesign (R56 adopted; house inventory pinned by the Opus council)

- **Role disclosures reuse what the repo already owns (Opus council H2 — the draft re-derived
  three house primitives):** collapse state = **`store/collapse`'s `useCollapsed`**
  (localStorage-backed, the persisted-collapse store ConfGroup itself uses), keyed
  `media-<ns>-<role>` — NOT a parallel map in `UIState` (that would be "different code for similar
  things"); the header's disclosure semantics = **`lib/disclosure`'s `disclosureToggle`** (the D25
  keyboard-operable contract). The role header is lightweight NEW markup only because ConfGroup's
  header forbids interactive children (D25 nested-interactive) and this header needs the upload
  button as a **sibling** of the disclosure control. One drop-down per role (the owner's ruling),
  multi-open (never auto-collapse siblings), all collapsed on first visit. **The collapsed header
  is a status line** — `<role> · n files` plus a warning badge whenever the section holds an
  unusable file, a `no match`, or a pin naming a missing file (GOV.UK's summary slot). **And the
  problem chip surfaces one level up too:** the namespace's existing `ConfGroup` `right` slot
  (today `media/<ns>/`) gains the warning badge, so a broken file is visible before EITHER
  disclosure level is opened (the galleries already sit inside collapsed ConfGroups — a role-level
  chip alone would die behind the group fold). **Auto-open is a pinned rule, not a "may" (Opus
  sweep ③):** a persisted collapse key always wins; auto-open applies only when the role has NO
  persisted key and holds a problem; it never writes back.
- **The FE decomposition is pinned (Opus council H3 — a silent brief beside the ConfTab monolith
  invites another):** `MediaGallery.tsx` (the ns shell: index query, settings save, pins —
  unchanged in kind) · `MediaRoleSection.tsx` (disclosure + status header + list) ·
  `MediaFileRow.tsx` (thumb, badges, move buttons, `⋯` menu) · `CropModal.tsx` (react-easy-crop +
  zoom slider + the aria riders + the object-URL lifecycle) · `hooks/useMediaUpload.ts` (the
  per-section job state machine: pick → guard → crop → export → PUT → invalidate, plus the latch,
  the 409 Replace flow, failure list, retry — unit-testable with no DOM) · `lib/imageExport.ts` +
  its worker module (guard, drawImage pipeline, format policy — pure, fixture-tested). The `⋯`
  menu's chrome is the kit's ONE existing popover shell, not a new menu look.
- **The list stays a list** (rows are half diagnostic text; a 3-column grid at 390 px cannot hold
  it). **↑/↓ stay permanently** — WCAG 2.2 SC 2.5.7 names adjacent move buttons as *the* conforming
  reorder pattern — with hit areas fixed to ≥44 px (SC 2.5.8), plus **Move to top / Move to
  bottom** in a per-row `⋯` menu (the 30-item fix, WCAG-blessed). Handle-drag is deferred polish
  (§9 Q8): if ever built it reuses `useDragReorder`, handle-only `touch-action: none`, never
  long-press-lift (the Pointer Events snapshot rule makes that structurally fragile).
- **Upload affordances:** one button per role-disclosure header; the empty state becomes a
  **placeholder card** carrying the existing sentence and the `media/<ns>/<role>/` path (the SSH
  route remains documented — it stays the exact-bytes path, since uploads are always re-encoded);
  the card becomes tappable in S3b, when there is a flow to tap into (Opus M10 — S2 ships no dead
  affordance). Named roles: per-key buttons in the key panel. No in-grid "+" tile (no reference
  product ships one). **Every upload affordance renders only when the server says writes are on:**
  `MediaIndex` gains a `write_enabled` boolean (Opus M4 — the same server-authority shape as the
  existing `disabled`/`reason` pair, zero new queries), so a killed switch degrades to today's
  SSH-only gallery instead of a cropper that dies on a 503. **The model default is `False`, set
  `True` by `build_index` from `media_write.enabled`** (Opus confirm ①): `disabled_index` builds
  from two arguments and would otherwise report writes-on for a namespace whose tree is not even
  mounted — safe-by-default makes the disabled path right by construction.
- **Delete:** per-row via the `⋯` menu → **the house confirm host** — `store/confirm`'s
  `requestConfirm({title, body, confirmLabel: "Delete", danger: true})` + the existing
  `ConfirmDialog` (already the destructive-remove path for agents/skills/servers, F17 focus work
  done; Opus H2 — no second modal implementation). Filename in the title, "cannot be
  undone" bolded, destructive-styled **Delete** (never "OK"), dismissive on the left. The manual
  delete sends **no** revision (the owner deletes a NAME deliberately; today's 204/404 semantics);
  only the automated Replace-flow cleanup conditions on `?revision=` (§3). **No undo
  toast** (no trash ⇒ no honest undo; M3 forbids the timed variant on web) and **no
  don't-ask-again**. The row vanishing on refetch is the inline feedback.
- **Progress:** one **indeterminate** indicator per section while its upload is in flight (LAN
  post-crop uploads are sub-second; `fetch` has no upload progress and doesn't need it here);
  per-file rows appear **only on failure** with retry + dismiss (retry re-uses the held blob).
  After success the existing index refetch paints the row with its badges already
  computed — the upload flow feeds the badge vocabulary instead of duplicating it (R56 §7.3).
- **Rider bug fix:** gallery thumbs switch to `revUrl(f.url, f.revision)` — the SW's
  StaleWhileRevalidate cache is URL-keyed, so an in-place replace currently paints stale bytes; the
  helper exists and the gallery is the one consumer not using it (R55 §8.4). **And the
  `ctrlb-media` cache's `maxEntries: 64` is raised in the same commit as the upload flow (Opus
  sweep ②):** replaces now mint fresh `?rev=` keys routinely, and a populated install already sits
  near that budget — one number, one comment, or the symptom is cold-start thumbs.

## 5. Config (§9 Q1–Q3 pend; the shape below is the recommendation)

```yaml
media_write:           # top-level, additive — no migration (R47 §4 precedent). Named for the
  enabled: true        #   OPERATION (Opus M6): `enabled: false` answers 503 on BOTH verbs —
  max_bytes: 8388608   #   a kill switch that leaves DELETE live would be a reversal you cannot
                       #   actually switch off. 8 MB (Opus M7): anchored on the actual producer —
                       #   the client always re-encodes (largest role bound 1.5 MB, generous
                       #   multiple); exact oversized bytes take the SSH route (§4). gt=0, the
                       #   voice.stt shape; the detail never echoes the true size.
```

Inside `media:` is not an option without restructuring — its keys are namespace-validated. The
green-field fold (`media: {namespaces:…, write:…}`) is recorded as the road not taken: a real
schema migration of an owner-populated prod key, for a purely cosmetic gain. Client-side ceilings
(the 40 MP input decode guard, export quality/format defaults) live as named registry constants
beside the advisory bounds — the same "a knob nobody would turn" rule that put the bounds there.
The FE reads the switch as `MediaIndex.write_enabled` (§4) — server authority, no config coupling
in the gallery.

## 6. Test obligations

BE: the R55 §6 pin list (delete-vs-order/pins config untouched · symlink 404 · double-delete
204→404 · traversal/encoded-separator 404 · `.part` invisible to index and mount) + streamed-cap
413 with temp cleanup on both Content-Length and chunked bodies + probe-reject 415 leaves no bytes
+ `os.link` 409 vs revision-preconditioned overwrite (match → 200 · stale/vanished → 409) + mode
0644 + the TWO-tier predicate (upgrade test: an order entry legal today — `.hero.png`-class —
still boots · malformed percent-encoding `%FF` → 422, tested apart from encoded separators ·
`con.png`/`con.foo.png`/`COM¹.png` all 422 via `ntpath.isreserved`) + sweep-on-boot +
kill-switch 503 **on both verbs** + `write_enabled` false in the index while killed AND on a
disabled namespace (the safe-default arm) + **the no-CORS invariant** (Emma #10: an evil-Origin `OPTIONS` preflight for
PUT/DELETE gets no `Access-Control-Allow-Origin`; plus an architecture guard that fails if CORS
middleware is ever added without revisiting D65) + revision-conditioned DELETE (match → 204 ·
replaced-since-observed → 409, file untouched). FE: role-disclosure persistence via `store/collapse` + collapsed
warning badge (role header AND the ConfGroup `right` chip) + the pinned auto-open rule ·
affordances hidden when `write_enabled` is false · per-key upload naming + the normalized-stem
collision Replace path (named keys AND pools) · the section admission latch (a second pick during export is refused — the
state-machine test) · crop-modal state machine (cancel unwinds, same-file re-pick fires,
object-URL revoke discipline per R54 §6.1) · export worker (dimensions + `blob.type` asserted —
**never bytes**, the engines differ; the one-step quality step-down when over the role's byte
bound) · 409→Replace flow carries the revision · retry uses the exported Blob, never the source
`File` · failure-row retry/dismiss · `revUrl` thumbs. E2E: one gallery round-trip (upload →
appears with badges → reorder → delete) on the dev backend. Stylelint: the `image-orientation`
disallow rule (R54 sweep ② — the two engines read the property off different elements; one stray
rule would rotate exports on exactly one engine).

## 7. Slices

| slice | content | gate |
|---|---|---|
| S0 | D65 entry (+ in-place AMENDMENT pointers on D52/D53, the D54 §12 precedent) · SECURITY_MODEL §2.x · docstring truth pass (3 headers) · **MEDIA_PLAN §0/§7 amendment** (they assert "no write API anywhere" — the doc-truth class) · **SPEC.md** API inventory + the read-only line · **CLAUDE.md doc-map row** for this plan (AGENTS.md carries no per-plan map — Opus confirm) · **RESEARCH.md pin row** for react-easy-crop@6.2.3 (the first runtime dep beyond react/query) · ROADMAP H2 → pointer here · TODO phase · HARDENING §8.2 rows (STT class · DNS-rebinding/TrustedHost · the forward-ruling note) | docs-only commit |
| S1 | the write API: two-tier filename predicate · streaming writer in `core/media.py` · PUT/DELETE routes (revision preconditions) · `media_write` config + `MediaIndex.write_enabled` · `.part` boot sweep · `fsync_dir` promotion · BE tests | full gate + curl round on dev |
| S2 | gallery restructure on the pinned decomposition: role disclosures (`useCollapsed` + `disclosureToggle`) + status headers + the ConfGroup `right` chip · `⋯` menu (kit popover shell; move top/bottom · delete via `requestConfirm`) · ≥44 px hit areas · empty-state card (non-tappable yet) · `revUrl` fix + the SW `maxEntries` raise | full gate + gallery e2e |
| S3a | the pure half: `lib/imageExport` + the worker + the input guard + the format policy + the shared-fixture fence — fixture-tested, wired to nothing | full gate |
| S3b | the wiring: picker + `CropModal` + `useMediaUpload` (latch · 409 Replace · failure rows · retry) + per-key & pool stem-collision flows + the empty card goes tappable | full gate + e2e arm |
| S4 | the owner device round (the parked 2026-08-12 round folds in here: real drops, real-touch reorder, crop feel, HEIC refusal wording, R54/R56's named device probes) | owner acceptance |
| S5? | handle-drag reorder via `useDragReorder` — only if the device round asks for it | own round |

Each slice: Opus build from a pinned brief → main-seat audit → Emma-lane review → owner eyeball
(the standing cadence).

## 8. Research reconciliation (main-seat rulings on the three dossiers)

| finding | source | ruling |
|---|---|---|
| multipart POST is CORS-safelisted ⇒ drive-by write; use raw-body PUT/DELETE | R55 §2 | **ACCEPTED** — the shape-picking finding (§1/§2) |
| R54's state machine names "R55's multipart POST" | R54 §6.2 | **stale cross-reference, overruled** — PUT wins |
| `UploadFile` spools to `/tmp` (RAM on emma) before the handler runs | R55 §1.1 | **ACCEPTED** — second, independent argument for the raw stream |
| streamed counter is the only honest cap; 413 mid-body verified | R55 §3 | **ACCEPTED**, cap in config (voice.stt shape) |
| `.part` temps; extension-only index filter trap | R55 §4.2 | **ACCEPTED** |
| one shared bare-filename predicate (config.py + upload) | R55 §5.1 | **ACCEPTED** (no-duplication rule) |
| 409 + `?overwrite=1`; auto-suffix rejected | R55 §5.3 | **ACCEPTED**; UI = Replace/Cancel (§9 Q7) |
| DELETE touches no config; `(missing)` is pins-only | R55 §6 | **ACCEPTED**, verified in code |
| gallery thumbs need `revUrl` | R55 §8.4 | **ACCEPTED** (rider fix, S2) |
| STT endpoint is the existing safelisted-class instance | R55 §2 | **ACCEPTED → Phase 19 register**, not fixed here |
| react-easy-crop ①, with the three adoption riders | R54 §2.6 | **ACCEPTED** (deps-OK memory; 8.6 KB vs ~200 lines of gesture code) |
| `drawImage` never the crop-rect form; worker export; read `blob.type`; silent-canvas readback | R54 §3–§4, §10① | **ACCEPTED wholesale** — probe-grounded |
| always re-encode (EXIF/GPS strip; allowlist normalization) | R54 §3.4/§6.2 | **ACCEPTED**; SSH stays the exact-bytes path, stated in the gallery copy |
| refuse HEIC by name; no wasm decoder | R54 §5.2 | **ACCEPTED** |
| stylelint `image-orientation` disallow | R54 sweep ② | **ACCEPTED** (cheap fence, invisible-bug class) |
| buttons are WCAG's named reorder pattern; drag = optional, handle-only | R56 §3 | **ACCEPTED**; drag deferred to S5-on-ask |
| cover-fit default = "use as is"; no skip button | R56 §5 | **ACCEPTED**, composed with R54's always-re-encode |
| modal delete confirm; no undo toast; no suppress-checkbox | R56 §6 | **ACCEPTED** |
| header upload + tappable empty card; no in-grid tile | R56 §4 | **ACCEPTED** |
| accordion: multi-open, persisted, status in header, auto-open-once on problem | R56 §8 | **ACCEPTED**; persistence home CORRECTED by the Opus council (H2): `store/collapse`, the house's persisted-collapse store — R56 guessed `UIState` without finding it |
| focal point is a per-role capability for variable-ratio surfaces only | R56 §9 | **ACCEPTED as deferral** (§9 Q6) — `kit/background` is the one candidate |
| Immich: indeterminate group progress; failure rows w/ retry; no Wake Lock | R56 §7 | **ACCEPTED** (Wake Lock divergence recorded) |

## 9. Open owner questions (the clean-session agenda; REC = the standing recommendation)

1. **Kill-switch default** — `media_write.enabled`: REC **ON** (the verb choice already closes the
   drive-by class; the switch exists for posture, not as the gate). It gates BOTH verbs.
2. **Config home** — REC the additive top-level `media_write:` block; the `media:` fold is a real
   prod migration for cosmetics.
3. **`max_bytes` default** — REC **8 MB** (Opus council M7: anchored on the actual producer — the
   client always re-encodes, largest role bound 1.5 MB; exact oversized bytes take the SSH route).
4. **Input decode guard** — REC 40 MP (every phone camera through 48 MP-binned; refuses 108/200 MP
   modes); 24 MP is the stricter defensible alternative.
5. **The crop window is free-ratio for EVERY role in v1** (Opus council H1 made this the rule, not
   the exception — the draft's three fixed-aspect roles were wrong against their own CSS). REC:
   ratify; aspect-preset chips or per-key destination shapes are recorded future options.
6. **Focal point** — REC: not in v1; recorded as an additive `MediaRoleDef` capability;
   `kit/background` (viewport-filling) is the only role the field's discriminator says wants one.
7. **Collision UI** — REC Replace / Cancel only (no keep-both; auto-suffix binds to nothing in
   named roles and silently re-deals pools). Applies to named keys AND pool stem collisions.
8. **Reorder beyond the buttons** — REC not in v1; buttons + move-to-top/bottom. If the device
   round wants more, the options in order of field confidence (R56 §11.2): a per-section
   **Reorder mode** (the iOS lever — removes the drag/scroll conflict), then handle-drag via
   `useDragReorder` (S5).
9. **Multi-file pick** — REC single-file per pick in v1 (each pick flows through one crop modal);
   `multiple` turns the per-section latch into a queue and changes nothing else, later, if real
   use wants batch.
10. **Phase/version** — REC: new TODO phase (next free number), rides the 1.7.x line per the
    version policy.

## 10. Device-round probes owed (named by the dossiers; fold into S4)

EXIF orientation of a real portrait phone photo through the full pipeline (R56 sweep ③ / R54 §3) ·
the 413-mid-body behavior over Tailscale Serve HTTPS from mobile browsers (R55 §10) · whether the
owner's phone produces HEIC (decides the refusal message's prominence, R54 §11.3) · PWA-standalone
survival across the photo-picker activity (R54 §11.4) · jpeg q0.85 eyeball on 2–3 real art files
(R54 §11.5) · crop feel + Fennec expected-partials.

## 11. Council record (2026-08-24 — the pre-build design round)

**Emma lane (blind, gpt-5.6-sol high; correctness/security lens): BUILD WITH CHANGES — 9 MED +
1 LOW, every finding ruled, none dropped:**

| # | finding (condensed) | ruling |
|---|---|---|
| 1 | one strict predicate would break existing configs at boot (`.hero.png`/NFD in `order`) | **ACCEPTED** → two-tier predicate: addressable (config, today's semantics verbatim) + upload-admission (strict, new writes only); upgrade test (§2) |
| 2 | a stale Replace confirm clobbers a newer replace / resurrects a delete; bare `overwrite=1` underspecified | **ACCEPTED, fix re-derived leaner**: revision-preconditioned `?overwrite=<revision>` (If-Match semantics on the wire's existing token) instead of her global write lock; stat→replace micro-window = accepted residual (§2) |
| 3 | DNS rebinding defeats the preflight argument on the raw LAN bind (conf 0.72) | **ACCEPTED as register item**: app-wide property, not media-specific → SECURITY_MODEL residual + Phase 19 row naming `TrustedHostMiddleware` (§1) |
| 4 | named-role uploads collide by BINDING KEY across extensions without a 409 (`cube.png` vs new `cube.webp`) | **ACCEPTED**: per-key flow detects by normalized stem (`classifyNamed` reuse), Replace confirm, publish-before-delete (§3) |
| 5 | a second pick can replace an in-flight job's state | **ACCEPTED**: per-section admission latch, pick→terminal (§3) |
| 6 | "retry holds the original File" contradicts the always-re-encode pipeline | **ACCEPTED** (a real internal contradiction of the draft): retry payload = exported Blob + final name/type only (§3) |
| 7 | pixel cap ≠ byte bound; the "never trips badges" test invariant cannot hold | **ACCEPTED, fix re-derived**: one quality step-down retry, then upload WITH the advisory badge — her hard reject would contradict the bounds' advisory-by-design charter; the invariant test dropped (§3/§6) |
| 8 | malformed `%FF` percent-encoding arrives as U+FFFD and silently mints a different name | **ACCEPTED**: U+FFFD rejected in upload-admission (§2) |
| 9 | hand-rolled DOS-device set misses `con.foo.png` / `COM¹.png` | **ACCEPTED**: stdlib `ntpath.isreserved` (§2) |
| 10 | the no-CORS assumption is load-bearing and untested | **ACCEPTED**: evil-Origin preflight test + an anti-CORS-middleware architecture guard (§6) |

Her sound-areas note confirms: no request shape makes PUT preflight-free; `no-cors`/forms/WebSockets
do not reopen the class; the `.part` ordering and `os.link` no-clobber are sound; a 503 kill-switch
surfacing as an ordinary failure row is acceptable.

**Emma confirm rounds (three, to all-RESOLVED):** round 1 — #1–#3, #5–#10 RESOLVED; both
re-derivations upheld in terms (#2: the compare→replace micro-window "is exactly the documented
residual… a lock is disproportionate"; #7: "a hard rejection would contradict the existing
SSH-drop and advisory-bound contract"); one NEW MED (0.97), accepted verbatim — the #4 Replace
flow's cleanup DELETE was unconditional while its stale window spans the whole crop flow → the
cleanup DELETE became revision-conditioned (`?revision=`, 409 leaves both files, duplicate
diagnostics make it recoverable). Round 2 — #4 RESOLVED, one edge: a same-filename Replace would
guarantee a false 409 from its own cleanup → cleanup skipped when final filename == old filename
(adopted verbatim); manual per-row delete confirmed unaffected. Round 3 — **"RESOLVED overall."**

**Adversarial Opus (architecture/design lens): BUILD WITH CHANGES — 3 HIGH · 7 MED · 3 LOW +
3 sweep items; every load-bearing claim main-seat re-verified against the code before folding
(store/collapse · disclosureToggle · requestConfirm · the kit CSS geometry · SW maxEntries).**
Its summary judgement, accepted: the backend half was grounded; the FE half had adopted R54/R56
recommendations "without checking them against what this repo already owns and against what its
own CSS does."

| finding | ruling |
|---|---|
| H1: `MediaRoleDef.aspect` wrong on all three declared roles (svcicon/brand paint `contain`; banner geometry is adopter-variable per D54 A2) — a wrong aspect destructively discards pixels | **ACCEPTED** — no role aspect in v1; free-ratio everywhere; hints carry guidance; `MediaKeyDef.aspect` recorded as the future home (§3/§9 Q5) |
| H2: §4 re-derived `store/collapse`, `disclosureToggle`, `requestConfirm`; missed that galleries already sit inside collapsed ConfGroups | **ACCEPTED** — all three house primitives named in §4; the ns-level ConfGroup `right` slot carries the warning chip; new markup only where D25 forces it |
| H3: no FE decomposition pinned beside the ConfTab-monolith precedent | **ACCEPTED** — the six-module decomposition pinned in §4; `useMediaUpload` + `lib/imageExport` are DOM-free by construction |
| M4: the kill switch had no read path to the UI | **ACCEPTED** — `MediaIndex.write_enabled` (§4/§5) |
| M5: S0 missed MEDIA_PLAN §0/§7, SPEC.md, the doc-map row, RESEARCH.md's pin row, D52/D53 amendment pointers | **ACCEPTED** — S0 row expanded (§7) |
| M6: `media_upload` misnamed; must gate DELETE | **ACCEPTED** — `media_write`, 503 on both verbs (§2/§5) |
| M7: 30 MB cap justified by a consumer §4 routes to SSH | **ACCEPTED** — 8 MB, producer-anchored (§5/§9 Q3) |
| M8: the client header probe forks `probe_image` with no fence | **ACCEPTED** — dimension-read only + the shared fixture corpus (§3) |
| M9: "serial queue" vs the latch; "widened busy" inverts scope | **ACCEPTED** — queue depth 1; per-section flag composed with the global `busy` (§3) |
| M10: S3 monolith-shaped; S2's tappable card has no target; R56's Reorder-mode option dropped from Q8 | **ACCEPTED** — S3a/S3b split; card tappable at S3b; Q8 lists Reorder mode first (§7/§9) |
| L1: one global export quality wrongs the mask/layer roles | **ACCEPTED** — per-role `export?: {type?, quality?}`; `brand`/`stack` declare png (§3) |
| L2: doc name/vocab — fold into MEDIA_PLAN §13, or point both ways; "section" is a taken word | **PARTIAL** — fold OVERRULED (phase plans with council records + slice ladders are their own docs: GACHA/PROMPTS/CORE_MEMORY precedent; MEDIA_PLAN stays the namespace authority and gains the two-way pointer in S0); vocabulary ACCEPTED: "role disclosures", keys `media-<ns>-<role>` |
| L3 (sweep ③): the accordion's three opening rules could contradict | **ACCEPTED** — pinned: persisted key wins · auto-open only with no key + a problem · no write-back (§4) |
| sweep ①: pool uploads mint routine stem duplicates; pins address stems | **ACCEPTED** — the same normalized-stem Replace/Cancel guard on pool uploads (§3) |
| sweep ②: `?rev=` churn vs the SW cache's 64 entries | **ACCEPTED** — `maxEntries` raised in the S3b commit (§4) |

**Opus confirm round: "RESOLVED overall"** — every H/M/L/sweep individually RESOLVED; the L2
overrule judged to stand on its own precedent ("three instances against my one"). Five closing
pins from the round, all folded: the §1 `media_write` name residue · the doc-map row is
CLAUDE.md's alone (AGENTS.md carries no per-plan map) · the fixture fence asserts (w, h) only (a
dimension-only reader has no format verdict) · **interaction ①**: `MediaIndex.write_enabled`
defaults `False`, set by `build_index` — `disabled_index` right by construction · **interaction
②**: a pool Replace that changes the filename substitutes new-for-old in the `order` list (else
a first-wins pool silently changes winners) · **interaction ③**: lossless export types skip the
byte step-down (PNG has no quality axis); the badge is the message. Cleared as non-interactions:
the pool stem-guard preserves pin resolution by construction; the ConfGroup `right` chip is
D25-legal (non-interactive).

**Council verdict of record: BUILD WITH CHANGES from both lenses → all changes folded → both
lenses confirm-closed RESOLVED. The plan is build-ready pending the §9 owner rulings.**
