// Section-layout system v1 (D35 / FRONTIER_PLAN §1) — the curated presets + the pure partition/resolve
// helpers. Sibling to `tabs.ts` and held to the SAME purity constraints: NO component imports (it's read by
// `useSections`, TabBar/KitNavBar/NavMenu — the same pure-consumer chain), and the theme `registry` is read
// at CALL time only (inside the functions), never at module init — so the `layout → registry → themes/* →
// Root → …` import chain is benign (live ESM bindings, exactly the `settings.ts#resolveThemeSetting`
// pattern). Principle: functionality = modules; layout = modes that recompose WHERE modules live.

import { registry } from "./registry";
import type { LayoutId, LayoutPreset, SectionPlacement, TabDef, TabId, ThemeId } from "./types";

// The DOM id (and collapse key) of the utils-in-Conf hosted group — the FIRST curated hosting pair (Axis B,
// D35: concrete-first, generalized only if a second pair appears; D70 §8.4a IS that second pair). Lives HERE
// (the shared, non-lazy layout module) rather than in ConfTab so the eager nav chokepoint
// (`useSections.navigate`) can name the scroll-to-group target without pulling the lazy Conf chunk. ConfTab
// renders `<ConfGroup id={…}>` from this same constant → one source, no string duplication.
export const HOSTED_UTILS_GROUP_ID = "utils-hosted";
// …and the agents GALLERY's hosted group (D70 §8.4a), for exactly the same reasons. A distinct id from the
// `agents` GLOBALS group Conf already carries (`agent.*` defaults/routing), which is why it is suffixed.
export const HOSTED_AGENTS_GROUP_ID = "agents-hosted";

// ── SATELLITE SECTIONS (D70 §8.4a) ───────────────────────────────────────────────────────────────────
// The core four (fleet/agent/utils/conf) are governed by the curated count presets below. A SATELLITE is a
// section that never appears in a preset and instead carries a per-section PLACEMENT, composed over the
// resolved preset at ONE seam (`composeLayout`). The vocabulary is the partition's own three buckets — no
// new nav concept:
//   · `conf`   — hosted in its host section (the Axis-B mechanism), rendered as a ConfGroup.
//   · `button` — off-bar AND unhosted: the menu affordance carries it (docked action / floating launcher,
//                per the D35 docking rule + collapse ladder). This bucket is the ABSENCE of an effect.
//   · `tab`    — spliced onto the bar immediately after `after` (a promotion: it is a destination, and the
//                settings cluster keeps the rightmost seats).
// The `SectionPlacement` vocabulary itself lives in `types.ts` (the store types its lever with it and must
// not import this registry-reading module — see that type's note).

/** The placement vocabulary as a runtime allowlist — the membership check the lever's parse-don't-validate
 *  healing needs (TS types are erased; a persisted blob can hold anything). Ordered widest→narrowest home. */
export const SECTION_PLACEMENTS: readonly SectionPlacement[] = ["conf", "button", "tab"];

interface SatelliteDef {
  /** The host section under `conf` placement (the hosting map's value). */
  host: TabId;
  /** The DOM id of the ConfGroup the host renders it in — the scroll-to-group target. */
  groupId: string;
  /** Bar anchor under `tab` placement: spliced immediately AFTER this section id. */
  after: TabId;
  /** The placement when the lever holds nothing (or something this build doesn't know). */
  fallback: SectionPlacement;
}

/** The satellite registry — `agents` only today (D70 §8.4a; the lorebooks recipe is future work, and a
 *  second satellite is one entry here plus the additive edits §8.4a enumerates). Declaration order is the
 *  order `composeLayout` applies them in and the order `placementKey` prints them in. */
export const SATELLITES: Partial<Record<TabId, SatelliteDef>> = {
  // The agents/characters gallery. DEFAULT `conf` — the owner's "hidden by default, like the tools tab".
  agents: { host: "conf", groupId: HOSTED_AGENTS_GROUP_ID, after: "agent", fallback: "conf" },
};

/** hosted section id → the DOM id of the ConfGroup that renders it. The map `useSections.navigate`'s
 *  comment reserved: one curated pair (utils, from the presets) plus every satellite's own group. DERIVED
 *  from `SATELLITES` rather than re-listed, so a satellite's group id has exactly one source. */
export const HOSTED_GROUP_IDS: Partial<Record<TabId, string>> = (() => {
  const out: Partial<Record<TabId, string>> = { utils: HOSTED_UTILS_GROUP_ID };
  for (const [id, sat] of Object.entries(SATELLITES)) out[id as TabId] = sat.groupId;
  return out;
})();

// The curated presets (D35 point 2). `bar` order = tab-bar order; `hosted` = Axis-B hosting (utils→conf).
// A preset never adds/removes sections — only relocates them; `partitionSections` skips any id a given theme
// doesn't actually declare, so a preset naming a section a theme lacks is harmless.
export const LAYOUT_PRESETS: Record<LayoutId, LayoutPreset> = {
  "4-tab": { bar: ["fleet", "agent", "utils", "conf"] },
  "3-tab": { bar: ["fleet", "agent", "conf"], hosted: { utils: "conf" } },
  "2-tab": { bar: ["fleet", "agent"], hosted: { utils: "conf" } },
};

// The default supported set (a theme that omits `layouts` supports them all — the ratified ideal). Ordered
// widest→narrowest so it doubles as a stable iteration order.
export const ALL_LAYOUTS: LayoutId[] = ["4-tab", "3-tab", "2-tab"];

// A preset's "tab count" = its on-bar section count — the single source for the coercion distance metric
// (no parallel magic-number map: 4-tab→4, 3-tab→3, 2-tab→2 fall straight out of the `bar` arrays).
function tabCount(id: LayoutId): number {
  return LAYOUT_PRESETS[id].bar.length;
}

// Warn ONCE per (theme, lever) pair when a pick is coerced — a module-level Set of `${theme}:${key}` keys,
// so a mis-declared theme default or an unsupported user pick logs a single dev-console line, not a flood.
const warned = new Set<string>();
function warnCoercion(themeId: ThemeId, key: string, from: LayoutId, to: LayoutId): void {
  const seen = `${themeId}:${key}`;
  if (warned.has(seen)) return;
  warned.add(seen);
  console.warn(
    `[layout] theme "${themeId}" does not support "${from}" → coerced to nearest "${to}". ` +
      `Declare it in ThemeDef.layouts or change the pick.`,
  );
}

// The nearest supported preset by tab-count distance (tie → the LARGER count — prefer keeping sections on
// the bar). `supported` is non-empty (the caller guarantees it). Emits the one-time warn keyed on `key`.
function nearestSupported(
  target: LayoutId,
  supported: LayoutId[],
  themeId: ThemeId,
  key: string,
): LayoutId {
  const tc = tabCount(target);
  let best = supported[0];
  for (const s of supported) {
    const d = Math.abs(tabCount(s) - tc);
    const bd = Math.abs(tabCount(best) - tc);
    if (d < bd || (d === bd && tabCount(s) > tabCount(best))) best = s;
  }
  warnCoercion(themeId, key, target, best);
  return best;
}

// Resolve the global `ui.layout` lever against a theme's declared capability list (D35's DEDICATED
// warn-first layout-coercion resolver — deliberately NOT `resolveThemeSetting`, which guards per-theme
// seg/switch settings; this guards a global lever against a per-theme capability set). `auto` → the theme's
// declared default (itself coerced if a theme mis-declares a default outside its own supported set). An
// unsupported explicit pick → the nearest supported preset (+ one warn). Read at call time (live registry).
export function resolveLayout(themeId: ThemeId, lever: "auto" | LayoutId): LayoutId {
  const declared = registry[themeId]?.layouts;
  // A theme that omits `layouts` (or declares an empty set) supports them all — the ratified ideal.
  const supported = declared && declared.length > 0 ? declared : ALL_LAYOUTS;

  const rawDefault = registry[themeId]?.defaultLayout ?? "4-tab";
  const themeDefault = supported.includes(rawDefault)
    ? rawDefault
    : nearestSupported(rawDefault, supported, themeId, `default:${rawDefault}`);

  if (lever === "auto") return themeDefault;
  // Parse-don't-validate at the lever boundary (audit F0#1): the persist loader's defaults-merge passes any
  // stored `layout` string through UNTYPED, so a value this build doesn't know (a rolled-back newer preset,
  // hand-edited/corrupt localStorage) reaches here at render time — heal it to the theme default instead of
  // letting `tabCount` deref `LAYOUT_PRESETS[garbage].bar` and crash the whole render tree. This is the same
  // every-boot registry-membership stance as `coerceBootTheme` (validity ≠ schema version).
  if (!(lever in LAYOUT_PRESETS)) return themeDefault;
  if (supported.includes(lever)) return lever;
  return nearestSupported(lever, supported, themeId, lever);
}

// Resolve ONE satellite's placement lever — PURE, and the same parse-don't-validate stance `resolveLayout`
// takes for the layout lever: the persist loader's defaults-merge passes any stored value through UNTYPED,
// so a value this build doesn't know (a rolled-back vocabulary, hand-edited/corrupt localStorage, a nested
// number/null) reaches here at render time. A membership check against `SECTION_PLACEMENTS` heals it to the
// satellite's own fallback instead of letting an unknown bucket silently render the section NOWHERE.
// Exported so the Conf control can display the value the app actually uses (the `themeRowValue` lesson: a
// row that renders the RAW override lies about the app's state).
export function resolvePlacement(id: TabId, lever: SectionPlacement | undefined): SectionPlacement {
  const sat = SATELLITES[id];
  if (!sat) return "button"; // not a satellite → no placement effects at all (the bucket that does nothing)
  return SECTION_PLACEMENTS.includes(lever as SectionPlacement)
    ? (lever as SectionPlacement)
    : sat.fallback;
}

// Compose the satellite placements over a resolved preset — the ONE seam D70 §8.4a adds, PURE (no store
// read; the caller passes the lever map) and with `useSections` its single caller, so no policy lives in
// the hook. Never mutates the preset: `LAYOUT_PRESETS` entries are module constants shared by every render.
//
// Returns the composed preset PLUS a `key`: a STABLE SEMANTIC string ("agents:conf") naming the resolved
// composition. Effects that must re-run when the page RESHAPES under an unchanged preset id (DefaultRoot's
// scroll-cache clear, its hosted-coercion effect) key on that string — never on the freshly-allocated
// preset object, which changes identity every render.
export function composeLayout(
  preset: LayoutPreset,
  placements: Partial<Record<TabId, SectionPlacement>> | undefined,
): { preset: LayoutPreset; key: string } {
  // The lever map itself is untrusted (a persisted `sectionPlacement: null` or a string would reach here) —
  // one typeof guard, then the per-value membership check in `resolvePlacement` does the rest.
  const levers = typeof placements === "object" && placements !== null ? placements : {};
  let bar = preset.bar;
  let hosted = preset.hosted;
  const key: string[] = [];
  for (const [rawId, sat] of Object.entries(SATELLITES)) {
    const id = rawId as TabId;
    const placement = resolvePlacement(id, levers[id]);
    key.push(`${id}:${placement}`);
    if (placement === "conf") {
      // Hosting supersedes the menu (the partition's own rule), so a hosted satellite can never ALSO show
      // as a nav affordance — the owner's never-in-two-places constraint falls out of the existing buckets.
      hosted = { ...hosted, [id]: sat.host };
    } else if (placement === "tab") {
      // Spliced immediately after its anchor; appended when the anchor isn't on this preset's bar (a
      // narrower preset that drops it) so a promotion never silently vanishes.
      const at = bar.indexOf(sat.after);
      bar = at < 0 ? [...bar, id] : [...bar.slice(0, at + 1), id, ...bar.slice(at + 1)];
    }
    // `button` = off-bar and unhosted: no effect at all, which is exactly what that bucket means.
  }
  return { preset: { bar, ...(hosted ? { hosted } : {}) }, key: key.join(" ") };
}

// The partition a resolved preset induces over a theme's section defs — PURE (no store/registry read; the
// caller passes the resolved inputs). `bar` = the on-bar defs in preset order (any preset id the theme
// doesn't declare is skipped); `menu` = defs that are off-bar AND unhosted, in DEF order (Axis A: the menu
// affordance lists exactly these — hosting supersedes the menu); `hosted` = the preset's hosting map passed
// through. `appbarMinimal` unifies "1-tab mode IS minimal": it treats the effective bar as [] (so every
// unhosted section falls to the menu), matching today's `appbarMode: "minimal"` → NavMenu-lists-all behavior.
export function partitionSections(
  defs: TabDef[],
  preset: LayoutPreset,
  appbarMinimal: boolean,
): { bar: TabDef[]; menu: TabDef[]; hosted: Partial<Record<TabId, TabId>> } {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const hosted = preset.hosted ?? {};
  const effectiveBar = appbarMinimal ? [] : preset.bar;
  // preset order, skipping any id this theme doesn't declare (a preset may name more than a theme has).
  const bar: TabDef[] = [];
  for (const id of effectiveBar) {
    const def = byId.get(id);
    if (def) bar.push(def);
  }
  const onBar = new Set(bar.map((d) => d.id));
  // def order; off-bar AND unhosted only (hosted sections render inside their host, not in the menu).
  const menu = defs.filter((d) => !onBar.has(d.id) && !(d.id in hosted));
  return { bar, menu, hosted };
}
