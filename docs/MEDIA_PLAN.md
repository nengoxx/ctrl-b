# MEDIA_PLAN — media namespaces v2: frontier art + kit service icons (v1.5.0)

**Status: ✅ COUNCIL-SETTLED 2026-08-05 (draft → Codex READY WITH CHANGES + Opus lens SHIP
WITH CHANGES → reconciled, §11 → BOTH confirm rounds folded: Opus all-RESOLVED + the two
wire facts kept (probed format, unusable reason); Codex all-RESOLVED + the service-collision
share rule + the pinned JS normalization). Recorded as D53; build slices = TODO M1a–M3.** Owner directives: ships IN v1.5.0 as a finished product — no deferred seams,
no dead code, no unnecessary code; NAMED stack files; media slices BEFORE G6 palettes. Builds
on the G5 surface (GACHA_PLAN §7.6 as-built; §5.2–§5.4 + §10.4 are the parent design).

## 0. Goal

Extend the G5 owner-media system beyond gacha, completing it as the kit-wide art mechanism:

1. **frontier** namespace — rig ("computer") art, the hero image, and the three-layer
   floating-cube stack become owner-droppable.
2. **kit** namespace — per-SERVICE icons, keyed by service identity, rendered by every
   service-row surface (cosmos stays feature-closed: it consumes a kit feature).
3. The client-side assignment machinery generalizes from gacha-private into `lib/` + a
   front-end media REGISTRY (the rule-of-two moment: gacha + frontier).

Out of scope: any write/upload path (option (b) stands) · server-side image processing ·
per-host art binding (R3's spirit). **Known limitation, stated:** two hosts with same-named
services share one icon — per-host binding is out of scope by design.

## 1. What already generalizes (verified, G5 as-built)

- Backend: a namespace is a ROW in `core/media.py:MEDIA_NAMESPACES` — mount, index,
  `revision`, health/degrade, hardening are ns-agnostic. **Delta = two registry rows.**
- SW: the runtimeCaching matcher is `/^\/api\/media\/[^/]+\/files\//` — already any-namespace.
- The wire already carries stems, filenames, revision, unusable state, and configured slots
  (Codex-verified) — **no index-shape change.**
- The DEGRADE-NEVER-BRICK law and the `is_served_file` predicate apply unchanged.

## 2. The public model — TWO kinds (council H1 ruling), operations underneath (Codex H1)

**Public taxonomy (descriptor + gallery + config): `pool` | `named`.**

| kind | rule | consumers |
|---|---|---|
| **pool** | the ordered list (server collation, gallery-reorderable) | gacha characters/banner/wallpaper/reel/oracle · frontier rigs · frontier hero |
| **named** | files bind to NAMES by casefolded stem match; the KEY SOURCE is either a static list (descriptor `keys`) or data-derived (service identities) | frontier stack (`cube` · `platform-mid` · `platform-base`) · kit services |

"slots"/pins keep their shipped meaning ONLY: a config pin binding a pool entry into a special
role (reel_figure, wallpaper, hero) — the word is not reused for anything else. Frontier hero
is a **pool** (first-usable wins, pin overrides) — identical to gacha wallpaper, no
single-slot special case (Opus LOW, accepted).

**The resolver layer is OPERATIONS, not one function per kind (Codex H1 — gacha's shipped
semantics are not one rule):** `lib/media.ts` exposes small composable operations —
`orderedUsable` (scenes: the whole list) · `cycleAssign` (characters/rigs: position-preserving
`i mod N` over the ordered list, unusable entries HOLD their position so a broken file cannot
re-deal the fleet — the shipped gacha invariant) · `firstUsable` (wallpaper/oracle/hero) ·
`resolveNamed` (stem→key with the fallback chain pin → default → bundled) · `keyFor`
(the normalization below). Consumers compose these; gacha's wide-ladder/focus/cutout
semantics stay in gacha and compose on top (the ossification fence — Opus, sound-with-a-line).
**Gacha parity is a NAMED test obligation:** scenes, unusable-position preservation,
wallpaper fallback, reel bundled replacement — behavior-identical after the lift (Codex H1).

## 3. The namespace map (end state)

```
$CTRLB_HOME/media/
  gacha/     {characters, banner, reel, oracle}/                (shipped, G5)
  frontier/  {rigs, hero, stack}/
  kit/       {services, service-banners, hosts, background, brand}/
```

> **End-state amendments since this map was drawn.** `kit/` grew to five roles (M4's three +
> G6.3's `brand` — §12 and §12.1). `gacha/wallpaper/` was **REMOVED at G6.3** (owner ruling
> 2026-08-06, §12.1 ②): the fleet backdrop's drop-in home is the shared `kit/background/`, and
> what stayed gacha's is the `wallpaper` PIN, which sources from `characters/`. Everything below
> and in §2 is the as-built record of the shape at the time it was written — a role's pin key and
> its role folder are validated independently on both ends, so a pin outliving a folder is an
> ordinary shape (`reel_figure` has always sourced from another role).

- `frontier/rigs/` — pool, `cycleAssign` over the fleet's display order (self first —
  `useFleet` order, Codex-verified fit); bundled rig1–6 = per-role fallback (empty ⇒
  byte-identical today).
- `frontier/hero/` — pool, `firstUsable` + pin. The long-reserved "final hero art" becomes a
  file drop.
- `frontier/stack/` — named, static keys `cube`/`platform-mid`/`platform-base` (owner-ruled
  NAMED convention); per-key bundled fallback (partial drops composite owner-over-bundled —
  deliberate; the geometry consequences are per-key GUIDANCE, §5 registry, and the 8
  owner/bundled combinations are a test matrix — Codex MED).
- `kit/services/` — named, keys derived from service identity (§5). No bundled fallback:
  absent = today's icon-less row. The namespace name stays **`kit`** (Opus suggested
  `shared/`; overruled — `kit` is this repo's established vocabulary and renaming invites
  registry/path drift; the gallery header documents the folder).

## 4. Config re-home — RULED (the fold is total; no migration code for a never-shipped shape)

G5 persisted gallery state under `themes.<ns>` — with `kit` as a namespace that home is a lie,
and (Opus H3, Codex-verified) `ThemesCfg` exists SOLELY for media state: genuine theme settings
live at `appearance.theme_settings`. So the fold **deletes the `themes:` model family
entirely** — `ThemesCfg`/`GachaThemeCfg`/`GachaSlotsCfg` are replaced by ONE ns-generic model:

```yaml
media:                       # top-level, keyed by NAMESPACE — mirrors MEDIA_NAMESPACES
  gacha:    {roles: {characters: {order: […]}}, slots: {reel_figure: …}}
  frontier: {slots: {…}}     # (pins; stack named-bindings need no config — stems ARE the binding)
  kit:      {}
```

`media: dict[str, MediaNsCfg]`, validated against the registry — no per-namespace pydantic
class, no `isinstance` branch (the banned sibling shape one layer down — Opus H3).

**Migration ruling (Codex H3 raised it; ruled lean):** the `themes.<ns>` media keys have NEVER
existed in a tagged release (prod = v1.4.6, pre-media) — so NO migration code ships for them.
The fold = models deleted + every reader/writer moved (index read `api/media.py:149`, gallery
write `MediaGallery.tsx:69`, tests) + the TWO dev configs hand-cleaned (an M1a checklist
item). `Settings` is extra-tolerant, so a stray old key in a hand-authored config is inert
cruft, not a hazard — **one test pins that intent** (a config carrying old `themes.gacha`
media keys boots with them IGNORED and the gallery writes only `media:`). Codex's
migration/preflight machinery is overruled for a shape that never shipped; the D-entry
records this so the update chain's schema history stays honest.

## 5. Frontend architecture

- **The FE media REGISTRY owns descriptors (Opus H2 — the inversion).** One module mirrors the
  backend: `MEDIA_NS: Record<ns, MediaNsDef>` — roles with `kind`, static `keys`, per-role
  HINT text and per-role ADVISORY bounds (see below). A theme CONTRIBUTES its row; the `kit`
  row lives in the registry itself (no ThemeDef-shaped orphan). ConfTab renders
  `applicableNs(activeTheme)` = the active theme's ns + the always-on `kit` ns — **this fixes
  a real draft bug: gating the gallery on `ThemeDef.media` made the kit gallery unreachable
  under vapor/cosmos/minimal** (three of five themes) while their rows rendered icons.
  `ThemeDef.media` shrinks to the theme→ns link.
- **Advisory policy moves CLIENT-side, per-role (composing Opus M6 + the `ref` deletion):**
  the backend index stops shipping `warnings[]` — it serves FACTS; the gallery derives
  warnings from the registry's per-role bounds (an icon role warns at kilobytes, a wallpaper
  role at megapixels — one global constant serves neither). **The facts-only line keeps two
  SERVER determinations on the wire (Opus confirm condition):** the PROBED format
  (header-derived — the client compares it to the extension for mismatch warnings) and a
  machine-readable `reason` on `unusable` (so "wrong extension" and "unreadable" stay
  distinct messages). Size/WxH-derived codes (oversize, huge dimensions) are client-derived.
  The structured `ref` dims field is DELETED (nothing computes on it); per-key geometry
  guidance for the stack is hint TEXT carried per key (Codex's per-slot metadata need, met
  without a dead field).
- **`lib/media.ts`** — the operations of §2 (`orderedUsable` · `cycleAssign` · `firstUsable`
  · `resolveNamed` · `keyFor`). Every operation takes the index's server-ordered list
  directly; NO client-side `order` parameter (the config projection is server-side — one
  source of truth; Opus LOW).
- **Kit `ServiceIcon` component (Opus M1 + Codex's latch):** ONE component owns the degrade
  logic — error latch keyed `(url, revision)` (the G5 reel-latch pattern: in-place replacement
  recovers, same-revision failure stays latched), null-guard, token-styled sizing under `.kit`
  hooks. The five service-row surfaces (gacha, cosmos, frontier, vapor `DeviceRow`, kit
  `Fleet` — Codex-verified complete) each place the element and style it; none copies the
  failure behavior.
- **`useServiceIcons` query policy (Opus M3 — distinct from the gallery's):** long staleTime,
  no focus refetch, silent degrade to no-icons on error. The gallery keeps fresh-on-entry.
  Both policies stated in code.
- **Service-icon KEY (composing Opus M2 + Codex H2; normalization PINNED at the confirm
  round):** `keyFor(service) = normalize(service.kind ?? service.name)` where `normalize(s)
  = s.normalize("NFC").toLowerCase()` — **the contract IS JavaScript semantics** (JS has no
  full Unicode casefold; `ß`/final-sigma cases resolve per `toLowerCase`, and the tests pin
  JS behavior, not casefold ideals). Keys are computed CLIENT-side only, so one
  implementation exists by construction (the server's `casefold-natural` collation orders
  listings; it never computes keys). A file binds when `normalize(stem)` equals the key.
  Keys containing path separators or other non-stem-representable characters cannot have
  icons (documented; the gallery says so). Collisions: two FILES reaching one key →
  **first-in-server-index-order wins**; two SERVICES collapsing to one key → **both share
  the winning file** (services are not in the media index — there is no service winner;
  Codex confirm refinement). The gallery flags EVERY collision and every unmatched file. No
  explicit binding config (rejected: a new config surface for a homelab icon feature).
- **The keyed gallery owns its data dependency (Opus M5):** it fetches the fleet/services
  itself; annotations render as "unknown" while pending — never a false "no service named X".
- **Frontier consumers:** `present.ts` deals rigs via `cycleAssign`; `FrontierFleet` hero via
  `firstUsable`; `FrontierAgent` stack via `resolveNamed`. **The `appearance.frontier.image`
  override is RETIRED — an intentional breaking retirement, not a dead-code deletion (Codex
  MED corrected the draft):** it has a live reader (`present.ts:61`), a config pass-through,
  and a round-trip test, but no UI writer has ever existed and the rigs pool replaces its
  purpose in R3's spirit. The reader dies; the D28 appearance blob and frontier `x/y` KEEP
  working; the d28 test drops only its `image` arm; a hand-authored `image` key becomes inert
  (same extra-tolerance argument as §4). Recorded in the D-entry.

## 6. Backend deltas (small, by design)

Registry rows `frontier: ("rigs", "hero", "stack")`, `kit: ("services",)`; the `media:`
config model of §4; `warnings[]` removed from the wire (§5 advisory move). Existing generic
tests parametrize over the three namespaces.

## 7. Security posture (unchanged, restated)

Same read-only mount, allowlist/nosniff/no-cache/symlink rules, degrade law, for both new
namespaces. Icons render in more places but are same-origin `<img>` from the hardened mount —
no new surface class. No write API anywhere.

## 8. Slices + gates (council M4 re-slice; BEFORE G6 — owner-ruled)

| slice | content | gate |
|---|---|---|
| M1a | the config re-home ALONE (ns-generic model, `themes:` family deleted, readers/writers moved, dev configs hand-cleaned, ignored-old-keys test) — no behavior change | gate + gallery round-trip e2e |
| M1b | `lib/media.ts` operations + the FE registry inversion (+ ConfTab `applicableNs`) + gacha refactored on top — behavior-identical (the §2 parity arms) + backend `warnings[]` removal with the gallery taking over | gate + gacha e2e unchanged |
| M2 | frontier: registry rows (BE+FE), descriptor kinds land with their second consumer, rigs/hero/stack consumers, the `image` retirement, stack combo matrix | gate + owner eyeball (drop art on dev) |
| M3 | kit services: registry row, `keyFor`, `ServiceIcon`, five surfaces, keyed gallery UI + collision/unmatched annotations | gate + owner eyeball on ≥2 themes + automated icon arms on all five |
| ◐ M4 | **the KIT ART SYSTEM (D54, owner-ruled 2026-08-06 — BUILT same night; §12 below is the record).** Three more kit roles (`service-banners` · `hosts` · `background`) + the parent-surface primitives + the generic derived-key gallery model + the DefaultRoot background layer + cosmos as first adopter | gate + populated opt-out arms + owner device round (pre-v1.5.0, owner-ruled) |
| ◐ M4b | **the G6.3 delta (owner device round 2026-08-06; §12.1 is the record).** The `brand` role (owner-droppable app-bar mark, masked + accent-tinted) + ONE home for the backdrop: gacha consumes `kit/background` and its own `wallpaper/` role is REMOVED, pin kept | gate + owner device round |
| — | then G6 palettes → v1.5.0 (M4 rides the same release — owner re-ruled 2026-08-06) | |

Each slice: Opus build → main-seat audit → Codex → owner eyeball (the standing cadence).

## 9. Test obligations (Codex's expanded list, adopted)

Gacha parity: scenes · unusable-position deal stability · wallpaper/oracle fallback ·
reel bundled replacement — behavior-identical through M1b. Config: old-keys-ignored ·
`media:` round-trip · absent section boots clean. Named: stem normalization (NFC, casefold,
unicode) · every collision class (file/file, service/service, ext ties) with the
first-wins winner pinned · unrepresentable keys annotated. Frontier: self-first rig order ·
all 8 partial-stack combinations · empty-folder byte-identity. Icons: present / absent /
broken URL / in-place replacement recovery, automated across ALL FIVE renderers (not
eyeball-only) · `useServiceIcons` policy (no focus refetch). Namespace-degrade isolation
(one ns disabled, others healthy). Gallery: per-role advisory derivation · collision +
unmatched + unknown-pending annotations.

## 10. Owner rulings (2026-08-05)

1. Stack files: **NAMED** (`cube.*` / `platform-mid.*` / `platform-base.*`).
2. Sequence: **M-slices before G6 palettes.**

## 11. Council reconciliation (the record — findings → rulings)

| finding | source | ruling |
|---|---|---|
| Taxonomy = 2 kinds (`pool`/`named`), not 3; "slots"=pins only | Opus H1 | **ACCEPTED** (§2) |
| "pool" is not one operation — gacha ships four semantics | Codex H1 | **ACCEPTED, composed** with H1: kinds are the public model, operations are the resolver (§2) + parity arms |
| FE registry owns descriptors; kit gallery unreachable on 3/5 themes under ThemeDef gating | Opus H2 | **ACCEPTED** (§5) — real draft bug |
| `themes:` model family is dead after the fold — delete it, one ns-generic model | Opus H3 | **ACCEPTED** (§4) |
| "cost zero" fold needs migration/preflight for surviving old keys | Codex H3 | **PARTIAL — machinery OVERRULED** (never-shipped shape ⇒ no migration code); accepted: the reader/writer inventory, hand-clean checklist, ignored-old-keys test (§4) |
| Keyed stems can't address every service name; collisions undefined | Codex H2 | **ACCEPTED via normalization branch** (§5 `keyFor`, first-wins, gallery flags; binding config REJECTED) |
| Key on `kind ?? name`, not name alone | Opus M2 | **ACCEPTED, composed** into `keyFor` |
| One kit `ServiceIcon`, not five JSX copies of degrade | Opus M1 | **ACCEPTED** (§5) |
| Icon degrade needs the (url,revision) latch + replacement recovery | Codex MED | **ACCEPTED, composed** into `ServiceIcon` |
| `useServiceIcons` needs its own stated query policy | Opus M3 | **ACCEPTED** (§5) |
| Re-slice M1a/M1b; descriptor v2 lands with its second consumer | Opus M4 | **ACCEPTED** (§8) |
| Keyed gallery must own its services data dependency | Opus M5 | **ACCEPTED** (§5) |
| Advisory thresholds per-role, not global | Opus M6 | **ACCEPTED + extended**: advisory policy moves client-side entirely; backend ships facts (§5/§6) |
| Stack needs per-slot geometry guidance; 8-combo matrix | Codex MED | **ACCEPTED** as per-key hint text + the test matrix (§3/§9) — structured `ref` still deleted (Opus LOW) |
| `appearance.frontier.image` is NOT dead — pass-through + round-trip test | Codex MED | **ACCEPTED as reframe**: intentional breaking RETIREMENT, recorded; `x/y` keep (§5) |
| §9 test list missing the highest-risk arms | Codex MED | **ACCEPTED wholesale** minus migration-precedence (moot per H3 ruling) (§9) |
| `ref` dims delete · `poolAssign` drops `order` · hero=pool | Opus LOW | **ACCEPTED** (§5/§2) |
| `kit/` → `shared/` on the owner-facing path | Opus LOW | **OVERRULED** — `kit` is house vocabulary; gallery header documents it (§3) |
| Same-name services share an icon — state it | Opus LOW | **ACCEPTED** (§0) |
| *Confirm round:* facts-only wire must keep the PROBED format + a machine-readable `unusable` reason (server determinations) | Opus confirm | **ACCEPTED** (§5) |
| *Confirm round:* service/service collisions have no index-order winner — both share the winning file | Codex confirm | **ACCEPTED** (§5) |
| *Confirm round:* pin the normalization — JS `toLowerCase` after NFC IS the contract (no full casefold in JS; client-side-only keys) | Codex confirm | **ACCEPTED** (§5) |
| *Confirm round:* stale `poolAssign` name in §5 | both | **FIXED** (§5 names the §2 operations) |

## 12. M4 — THE KIT ART SYSTEM (D54; owner-ruled 2026-08-06, ✅ BUILT same night — this section is the as-built record)

**The want (owner, verbatim intent):** not seams — the complete owner-droppable art system, part
of the kit so any current or future theme uses it cleanly: per-service BANNER images (what cosmos
ships bundled), per-machine "PC images", and a faded whole-app BACKGROUND — beside the M3 icons.

**The rulings:** banners render in the KIT (kit rows natively; any theme adoptable) with cosmos
first (DEAL-THEN-OVERRIDE over its bundled pool — one drop changes exactly its own row) · PC
images are THEME-SPECIFIC adoption (cosmos first: a faded background of the host-detail sheet;
no image + no theme default ⇒ untouched) · the background is the gacha-wallpaper mechanism
generalized (faded, a synced visibility setting, renders only when an image exists); frontier's
hero and gacha's banner/wallpaper roles stay theme-custom · everything DORMANT: empty folders ⇒
byte-identical. **Ships BEFORE v1.5.0** (owner re-ruling; rides the gacha release).

**The design went through a Codex PRE-BUILD council round (BUILD WITH CHANGES, no HIGH — all
seven adopted):** A1 ONE generic derived-key gallery model (source adapters over `keySource`;
the service-shaped path deleted) · A2 the parent-surface primitive API pinned (pure helpers →
`{className, style}` or nothing; mechanics-only variable-driven kit classes; the adopter owns
every colour — no hardwired row base) · A3 background opt-out = an optional DefaultRoot PROP
(`kitBackground={false}` on the three scenery themes; "the theme does not mount the layer") ·
A4 visibility = `kit_background_visible`, a nullable SYNCED appearance field (unseeded
convention; default ON) · A5 the SURFACE-SCOPED precedence matrix (each kit surface: owner file
→ that surface's own theme default → nothing; theme-owned surfaces never consult kit roles;
full-app scenery is exclusive) · A6 opt-out proven POPULATED (all five roots, jsdom + e2e) ·
A7 host keys = the machine NAME (rename ⇒ unmatched + on-screen remedy; no art_id).

**As built (the implementer's report is authoritative; headline deltas):** adapter renamed
`kit/ownerArt.ts` (the frontier `ownerArt.ts` precedent) · NEW `MediaRoleDef.asset` — the noun is
ROLE-shaped, two roles share the `services` source · distinct CSS vars per role (custom
properties inherit; the host-art sheet is an ancestor of banner rows) · kit art classes never use
the `background` shorthand (theme layer wins per-property; two shorthand→`background-color`
conversions rode along) · `.kit-host-art` = a low-opacity `::before` (keeps cosmos's glass
translucent) · `.kit-bg` = fixed, z-index −1 inside an `isolation: isolate`d shell that goes
`background-color: transparent` only `:has(> .kit-bg)` — the layer paints its own opaque `--bg`
· kit namespace gallery title → "Shared art". Recorded nuance: `isolation` on `.kit` exists only
while the layer is mounted; a future PARTICIPATING theme with a Root-sibling overlay (the gacha
reel idiom) would stack that sibling above the shell — all three sibling-overlay themes opt out
today. **Post-build Codex round: SHIP WITH FIXES (1 MED + 3 LOW, all taken):** the MED was
cosmos's chevron-vs-drag-strip regression re-created by `isolation` on the host-art sheet
(adopter override + a populated click-through e2e); the LOWs: result-memoized resolutions ·
`?rev=` cache-buster for owner-file overwrite-in-place · the appearance docstring.

**Owner manual (the gallery hints are the on-screen copy):** `$CTRLB_HOME/media/kit/` —
`services/<kind>.png` icons · `service-banners/<kind>.png` banners · `hosts/<machine-name>.png`
PC images · `background/` any images, pick/order in the gallery · `brand/` a transparent PNG for
the app-bar mark (see §12.1); the "Shared background" switch lives in Conf → Appearance.

### 12.1 · G6.3 delta — the `brand` role, and what the background hint now says

Two amendments from the **2026-08-06 owner device round** (the G6.3 fidelity wave). Both are
additive: no config shape moves, no existing file changes meaning.

**① The new kit role — `brand` (the app-bar mark).** A SECOND kit pin (bringing the registry to
**7** across the three namespaces — gacha 4 + frontier 1 + kit 2) and a FIFTH kit role folder, and the
`background` shape exactly: a POOL with a first-wins pick and one `slots` pin (`KIT_ROLES` +
`KIT_SLOTS` in `core/media.py`; the registry-driven ensure-dir / mounts / index pick it up with no
other backend change). What is new is only how it is PAINTED: `KitAppBar` renders the file as a CSS
**mask** over `--kit-brand-fill` (defaulting to `--accent-fill`, the K2 precedent), so **only the
file's alpha is read** and every theme tints one dropped silhouette with its own accent instead of
the owner needing a picture per skin. A theme with a brand gradient of its own points
`--kit-brand-fill` at it. Precedence in the brand row is the A5 matrix's ordinary rule — **owner file
→ the theme's `brandMark` slot → the kit's accent dot** — and an empty folder leaves the bar
byte-identical to the pre-G6.3 one. Advisory bounds are `ICON_ART` (it paints at ~18px, so the
background's 4 MP ceiling would never warn). SVG stays banned by the locked allowlist: transparent
**PNG/WebP** only.

| role | kind | keys | pin | painted by |
|---|---|---|---|---|
| `brand` | pool | — (position is the assignment) | `slots.brand` | `KitAppBar` (`.kit-brand-mark`, CSS mask over `--kit-brand-fill`) |

**② ONE HOME FOR THE BACKDROP — the `gacha/wallpaper/` role is REMOVED.** This landed in two steps
on the same day, and the second overrode the first.

*The bug.* The M4 copy ended *"Themes with scenery of their own ignore it"*, which was true of the
shared LAYER and false of the picture: the owner dropped a file into `kit/background/`, saw nothing
happen under gacha — whose scenery is exclusive, so it passes `kitBackground={false}` (A5) — and read
the app as broken.

*The first fix* made the kit background a RUNG of gacha's own wallpaper ladder, under gacha's
`wallpaper/` folder. *The owner then ruled against keeping both:* **"just having the background in
the kit is the better approach — no duplicated systems."** So `wallpaper` left `GACHA_ROLES`
outright. A CLEAN removal, no compat rung and no migration: media v2 has never shipped to prod, so
there is no owner data on disk and nothing to fold (the no-legacy-seams rule).

*The end state.* The fleet backdrop's ladder is exactly three rungs —

> **the gacha `wallpaper` PIN (a CAST portrait, wide-cropped) → the shared `kit/background` → the
> bundled scene.**

The pin is what survives, and deliberately: binding a character to the backdrop is a theme-specific
idea the kit has no equivalent of, whereas "a big picture behind the app" is one idea that deserves
one folder. `GACHA_SLOTS` therefore still holds `wallpaper` with its role folder gone —
`Settings._known_media_namespaces_roles_and_slots` validates a pin against `row.slots` and never
against `row.roles`, so a pin sourced from another role is an ordinary shape here (`reel_figure`
has always been one). `heroArt` reads the same ladder, since §5.3 forbids the backdrop and the hero
slide resolving to different pictures.

*The copy.* The `background` hint now states both halves — the **Appearance switch turns off the
shared layer**, and **a theme with its own scenery paints the picture on its own backdrop, under
its own switch** — and the gacha `wallpaper` PIN carries the first per-pin `hint` in the registry
(`MediaSlotDef.hint`, rendered under the select), because with its folder gone there is nowhere else
in the gallery to read where the backdrop comes from, and the pins section's generic line
("overriding that folder's own first pick") is no longer the whole truth for it. **The general
contract for a future scenery theme:** adopt the shared picture as the last OWNER rung of your own
ladder — above your bundled art, below anything the owner aimed at you specifically — and do not
grow a private twin of `kit/background`.

**Owner manual addendum:** `media/kit/brand/` — drop a transparent PNG/WebP silhouette; the first
image wins, or pin one in Conf → Shared art → *App icon*. Only the shape is used; the colour is the
active theme's accent. Drop nothing and the app bar keeps the mark it has today. **`media/gacha/`
no longer has a `wallpaper/` folder**: put the fleet backdrop in `media/kit/background/`, or pin a
character to it in Conf → Theme art → *Fleet backdrop*.
