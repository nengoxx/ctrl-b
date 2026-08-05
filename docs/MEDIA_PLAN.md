# MEDIA_PLAN — media namespaces v2: frontier art + kit service icons (v1.5.0)

**Status: DRAFT 2026-08-05 — council round pending (Codex correctness + Opus architecture lens),
then D-entry + TODO slices.** Owner directive: this ships IN v1.5.0 as a finished product — no
deferred seams, no dead code left behind. Builds directly on the G5 media surface
(GACHA_PLAN §7.6 as-built; §5.2–§5.4 + §10.4 are the parent design).

## 0. Goal

Extend the G5 owner-media system beyond gacha, completing it as the kit-wide art mechanism:

1. **frontier** namespace — the rig ("computer") art, the hero image, and the three-layer
   floating-cube stack become owner-droppable.
2. **kit** namespace — per-SERVICE icons, keyed by service name, rendered by every theme's
   service rows (cosmos stays feature-closed: it consumes a kit feature, it is not reopened).
3. The client-side assignment machinery generalizes from gacha-private to `lib/` — the
   rule-of-two moment (gacha + frontier) has arrived.

Out of scope: any new write/upload path (option (b) stands), server-side image processing,
per-host art binding (R3's spirit: art is visual, never linked to a specific PC).

## 1. What already generalizes (verified, G5 as-built)

- Backend: a namespace is a ROW in `core/media.py:MEDIA_NAMESPACES` — mount, index, `revision`,
  health/degrade, hardening are ns-agnostic. **Delta = two registry rows.**
- SW: the runtimeCaching matcher is `/^\/api\/media\/[^/]+\/files\//` — already any-namespace.
- Gallery: `MediaGallery` is descriptor-driven (`ThemeDef.media`); no per-theme UI code.
- The DEGRADE-NEVER-BRICK health law and the `is_served_file` predicate apply unchanged.

## 2. The assignment taxonomy — three kinds, closed set

Every consumer of owner media resolves files by exactly one of:

| kind | rule | G5 precedent | new consumers |
|---|---|---|---|
| **pool** | ordered list (collation, gallery-reorderable), positional deal + `i mod N` cycling | gacha `characters/`, `banner/`, `reel/` | frontier `rigs/` |
| **slots** | named positions; DEFAULT by well-known filename, gallery pin overrides; fallback per §5.3 (never crash) | gacha `slots` (reel_figure, wallpaper, hero) | frontier `stack/` (`cube` · `platform-mid` · `platform-base`) |
| **keyed** | filename STEM matches an external key, casefold exact (`jellyfin.png` → service "jellyfin"); no match = file idle (gallery annotates) | — (new) | kit `services/` |

The backend index stays kind-agnostic (it lists files + metadata per role). Kind lives in the
frontend descriptor and the shared resolver. This taxonomy is asserted complete: pool covers
order-based, slots covers position-based, keyed covers name-based — a consumer needing none of
these is not owner media.

## 3. The namespace map (end state)

```
$CTRLB_HOME/media/
  gacha/     {characters, banner, wallpaper, reel, oracle}/     (shipped, G5)
  frontier/  {rigs, hero, stack}/
  kit/       {services}/
```

- `frontier/rigs/` — pool. Replaces the bundled `index % 6` deal source; bundled rig1–6 remain
  the per-role fallback (empty folder ⇒ today's look, byte-identical).
- `frontier/hero/` — slots with a single slot `hero` (first-file default, pin overrides) — the
  same shape gacha wallpaper ships today. Side effect: the long-reserved "final hero art"
  becomes a file drop.
- `frontier/stack/` — slots ×3. Filename-convention defaults: `cube.*`, `platform-mid.*`,
  `platform-base.*` (stem match, casefold); anything else sits idle with a gallery annotation.
  Per-slot bundled fallback (a partial drop composites owner cube over bundled platforms —
  deliberate: layers are independent).
- `kit/services/` — keyed by service NAME (config service names, casefold stem match). No
  bundled fallback: absent icon = today's icon-less row. `kit` is a REAL namespace in the same
  registry — same mount hardening, health, caching; nothing special-cased.

## 4. Config re-home — RULING PROPOSED (the one migration, taken now while it is free)

G5 persisted gallery state under `themes.gacha.…` (`themes.<ns>.roles.<role>.order` + slots).
With `kit` as a namespace that home becomes a lie (`themes.kit` — kit is not a theme). Proposed:

```yaml
media:                    # top-level, keyed by NAMESPACE — mirrors MEDIA_NAMESPACES
  gacha:
    roles: {characters: {order: […]}}
    slots: {reel_figure: …}
  frontier:
    slots: {cube: …}
  kit: {}
```

`themes.gacha` keeps genuine THEME settings (starMode etc.). **Cost of the re-home: zero** —
nothing is released (prod = v1.4.6 pre-media); dev configs are hand-touched. Doing it later
costs a real config migration. Per the no-legacy-seams law: the fold is total — the Settings
models, gallery writes, and index read path all move; no `themes.<ns>` media key survives, no
compat shim. (Council: verify no other reader of `themes.gacha` media keys exists.)

## 5. Frontend architecture

- **`lib/media.ts`** (new): the ONE resolver — `poolAssign(files, order, i)` (cycling),
  `slotResolve(slots, files, defaults)` (pin → filename-default → bundled fallback),
  `keyedLookup(files, key)` (casefold stem). gacha's `roster.ts` REFACTORS onto it and its
  private copies are deleted (no parallel implementation survives — the §7.6 `toCutoutArt`
  retirement is the precedent). `useMediaIndex` stays the one query.
- **Descriptor v2** (`ThemeDef.media`): each role gains `kind: "pool" | "slots" | "keyed"`,
  optional `slotNames`, `hint` text, and `ref` dimensions (taken from the bundled reference
  asset — the gallery shows "authored for ~1150×975" style guidance; frontier's geometry
  expectations make this matter more than gacha's did).
- **The kit namespace's descriptor** does not belong to any ThemeDef — it registers on the kit
  side (same shape, owned by the ConfTab/kit layer). The gallery lists it under its own
  heading. (Council: cleanest registration point — ThemeDef-shaped constant in the kit module,
  not a per-theme copy.)
- **`useServiceIcons()`**: one hook over the kit index — returns `Map<name, {url, revision}>`;
  consumers render an `<img>` when present. Surfaces (enumerate + verify at build): the
  host-detail service rows of gacha/cosmos/frontier/vapor + the default kit detail — every
  surface rendering `lib/hostDetail`'s services list. Icon markup is per-theme (each theme
  styles its own row; the HOOK is shared, the JSX is not — matches the hostDetail split).
- **Gallery v2**: pool UI is shipped; slots UI = per-slot picker (the reel_figure pin
  precedent, generalized); keyed UI = the file list cross-referenced against live service
  names (fleet data is already in the query cache) with "no service named X" / "no icon for Y"
  annotations. Idle-file annotation is shared across kinds.
- **Frontier consumers**: `present.ts` deals from the pool resolver (bundled fallback);
  `FrontierFleet` hero + `FrontierAgent` stack read slot resolutions. **The dead appearance
  read dies**: `present.ts:64` reads `host.appearance.frontier.image` (RIG_KEYS) — the write
  path/picker was never built (GACHA_PLAN §5.3 records it). Candidate deletion per the owner's
  no-unnecessary-code directive. (Council: confirm zero writers/readers elsewhere before the
  axe.)

## 6. Backend deltas (small, by design)

Registry rows `frontier: ("rigs", "hero", "stack")`, `kit: ("services",)`. Existing tests
parametrize over namespaces where behavior is generic; role-specific arms only where a shape
differs. No index-shape change: `{roles, slots}` already carries everything the three kinds
need (slots CONFIG moves per §4 but the wire keeps serving resolved slot state as today).

## 7. Security posture (unchanged, restated for the record)

Same read-only mount, same allowlist/nosniff/no-cache/symlink rules, same degrade law, for
both new namespaces. `kit/services/` icons render in MORE places, but they are same-origin
`<img>` sources from the hardened mount — no new surface class. No write API anywhere.

## 8. Slices + gates (inside v1.5.0, sequenced BEFORE G6 palettes)

| slice | content | gate |
|---|---|---|
| M1 | `lib/media.ts` + descriptor v2 + the config re-home (total fold) + gacha refactored onto it — behavior-identical (screenshot/e2e pin) | gate + gacha e2e unchanged |
| M2 | frontier namespace: registry row, descriptor, rigs/hero/stack consumers, dead appearance read deleted | gate + owner eyeball (drop art on dev) |
| M3 | kit services: registry row, `useServiceIcons`, every service-row surface, gallery keyed UI + cross-ref | gate + owner eyeball on ≥2 themes |
| — | then G6 palettes → release v1.5.0 | |

Each slice: Opus build → main-seat audit → Codex → owner eyeball (the standing cadence).

## 9. Test obligations (delta over G5's)

Pool/slot/keyed resolver unit matrix (incl. cycling, partial stack, casefold stems, idle
files) · config re-home models (absent `media:` boots clean; gallery round-trip) · frontier
fallback byte-identity (empty folders ⇒ bundled) · per-theme icon-row arms (icon present /
absent / broken URL → row degrades to today's look) · gallery slots + keyed UI arms ·
namespace-parametrized backend arms for the two new rows.

## 10. Open questions — ✅ ALL RULED (owner, 2026-08-05)

1. ~~Stack filename convention~~ → **NAMED files** (`cube.*` / `platform-mid.*` /
   `platform-base.*`), per the REC — self-documenting, order-proof.
2. ~~Sequencing~~ → **M1–M3 BEFORE G6 palettes** — the art system completes first, then the
   cosmetic pass, then release.
