// Section-layout system v1 (D35 / FRONTIER_PLAN §1) — the curated presets + the pure partition/resolve
// helpers. Sibling to `tabs.ts` and held to the SAME purity constraints: NO component imports (it's read by
// `useSections`, TabBar/KitNavBar/NavMenu — the same pure-consumer chain), and the theme `registry` is read
// at CALL time only (inside the functions), never at module init — so the `layout → registry → themes/* →
// Root → …` import chain is benign (live ESM bindings, exactly the `settings.ts#resolveThemeSetting`
// pattern). Principle: functionality = modules; layout = modes that recompose WHERE modules live.

import { registry } from "./registry";
import type { LayoutId, LayoutPreset, TabDef, TabId, ThemeId } from "./types";

// The DOM id (and collapse key) of the utils-in-Conf hosted group — the ONE curated hosting pair (Axis B,
// D35: concrete-first, generalized only if a second pair appears). Lives HERE (the shared, non-lazy layout
// module) rather than in ConfTab so the eager nav chokepoint (`useSections.navigate`) can name the
// scroll-to-group target without pulling the lazy Conf chunk. ConfTab renders `<ConfGroup id={…}>` from this
// same constant → one source, no string duplication.
export const HOSTED_UTILS_GROUP_ID = "utils-hosted";

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
