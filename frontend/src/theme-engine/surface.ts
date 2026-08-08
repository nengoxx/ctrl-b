// The generic user-selectable SURFACE factory (D31 / THEME_ENGINE §14.14). A Surface is a region backed by
// one headless controller with interchangeable presenter VARIANTS, and §14.14 gives variant selection two
// mechanisms: Root-pinned prop injection (one variant per theme, no registry) and user-selectable (an open
// registry + a per-theme `seg` capability setting + a fallback-safe resolver). This file is the second one,
// factored out.
//
// It is deliberately CONCRETE-FIRST, as §14.14 required: the machinery was written for Composer alone in
// 2026-07-11 and is extracted here — unchanged in behavior — because Fleet has become the SECOND
// user-selectable surface (GACHA_PLAN §12.6 ruling 1: gacha offers three fleet layouts, which is the
// graduation trigger D31 names). Two identical concretes, so the rule of three is satisfied by extraction
// rather than by speculation. `kit/composer/variants.ts` + `ThemedComposer.tsx` are now thin skins over it,
// and their tests are the refactor's fence.
//
// ENGINE level: this may read `settings.ts` and `store/ui`; it must never import a kit component or a theme
// component. An INSTANCE lives beside its fallback variant — the composer's in `kit/composer/`, gacha's in
// `themes/gacha/` (D31's "vapor registers its own bespoke variants" clause: a theme-owned variant is
// first-class, and a theme-private one has no business in kit space).
//
// ⚠ IMPORT-CYCLE RULE — the E0 review's HIGH, corrected here. This graph is a REAL ESM cycle:
// `variants → surface → settings → registry → themes/vapor → VaporRoot → DefaultRoot → ThemedComposer →
// variants`. Which module the loader enters it from decides which bindings are still in their temporal dead
// zone while a module body runs, so a file inside the cycle must not depend on any particular entry order.
//
// The rule is NOT "don't CALL anything at module scope" (the older note here said that, and it is too weak).
// It is: **a module in the cycle may declare and import, but must never READ THROUGH a binding from the
// cycle at module scope** — no property access, no call, no destructure. `export const ThemedComposer =
// composerSurface.Themed` violated exactly that: entering at `variants.ts` reached it with `composerSurface`
// declared-but-uninitialized and threw `Cannot read properties of undefined`. Deferring the read to render
// time fixes it, because every module in the graph has finished evaluating by then — the same live-binding
// discipline `settings.ts` (registry read inside the hook body) and `resolve.ts#rootFor` already follow.
// `tests/theme-engine/importOrder.test.ts` pins the hostile entry order permanently.

import { createElement, type ComponentType } from "react";

import { useUISlice } from "../store/ui";
import { useThemeSetting } from "./settings";

/** A variant id — a key of a surface's open registry. `string | number` because that is what `keyof` a
 *  string-index record yields (JS object keys coerce numbers); every id a theme actually declares is a
 *  string, and the resolver only ever returns one. */
export type VariantId = string | number;

/** One user-selectable surface: its registry, the `register` seam, the resolver hook, and the component
 *  that renders the resolved variant. */
export interface Surface<P> {
  /** The per-theme setting KEY this surface resolves against (`composer`, `fleetLayout`, …). */
  readonly name: string;
  /** The id the fallback is seeded under — what an unknown, stale or unregistered value degrades to. */
  readonly defaultId: string;
  /** The OPEN registry, `{id: Component}`. Read it, and add to it only through `register`. The component
   *  references are STABLE module-level ones by construction: a fresh identity per render would remount the
   *  variant's subtree and reset the controller state under it (§14.14's explicit hazard — a `lazy()` built
   *  in render is the classic way to do this by accident).
   *
   *  A NULL-PROTOTYPE object, and every lookup goes through `Object.hasOwn`: variant ids arrive from
   *  persisted, cross-device-synced user data, and on a plain object `toString`/`constructor`/`__proto__`
   *  would resolve to inherited junk (or let a written id reach `Object.prototype`). With no prototype there
   *  is nothing to inherit and nothing to pollute — the same posture the settings pipeline's
   *  validate-don't-cast rule takes one layer up. */
  readonly variants: Record<string, ComponentType<P>>;
  /** Add a variant. ADDITIVE only — a surface's catalog grows, it never restructures; a theme still has to
   *  list the id in its own `seg` setting before a user can pick it (that per-theme capability list is what
   *  `resolveThemeSetting` enforces for free).
   *
   *  CONTRACT: registration happens at MODULE SCOPE only — a variant's module registers it as it loads, and
   *  `switchTheme`'s preload guarantees a theme's chunk has run before its Root renders. The registry is
   *  deliberately NOT reactive: nothing subscribes to it, so a `register` call made after a consumer has
   *  already rendered will not re-render anything and is UNSUPPORTED. (It is also unnecessary — a late
   *  variant has no way to be selected, since the theme must declare its id in a `seg` setting first.) */
  register(id: string, Component: ComponentType<P>): void;
  /** The active theme's chosen variant id, validated: the theme's `<name>` setting resolved through the
   *  settings pipeline, kept only if the registry actually holds it, else `defaultId`. Exposed as a hook
   *  because a Root sometimes needs the same value for its own effects (DefaultRoot re-measures
   *  `--composer-h` on a layout swap). Usable by ANY Root — kit or bespoke. */
  useVariantId(): string;
  /** Render the resolved variant. `layout` may be passed by a caller that ALREADY read the id, so the two
   *  cannot disagree; omit it and this resolves for itself. (Hooks can't be conditional, so this always
   *  subscribes — the prop picks which value WINS, it doesn't save the subscription; the store read is O(1)
   *  and identical, so that is fine.) Fallback-safe: an id with no component renders `fallback`. */
  Themed: ComponentType<P & { layout?: VariantId }>;
}

/**
 * Build a surface. `name` is the per-theme setting key, `defaultId` the id the `fallback` is seeded under.
 *
 * ```ts
 * const composer = createSurface<ComposerSlots>("composer", "stacked", KitComposer);
 * composer.register("sheet", SheetComposer);   // stable module-level ref
 * // <composer.Themed {...slots}/> → active theme → its "composer" setting → variant, fallback-safe
 * ```
 *
 * `P` is constrained to reserve `layout`: it is the resolver OVERRIDE `Themed` consumes, so a variant props
 * shape that declared its own `layout` slot would have it silently eaten. `layout?: never` makes that a
 * compile error at the `createSurface` call rather than a mystery at runtime.
 */
export function createSurface<P extends object & { layout?: never }>(
  name: string,
  defaultId: string,
  fallback: ComponentType<P>,
): Surface<P> {
  // ONE registry object per surface, created at module init and mutated only by `register` — so its entries
  // are the stable references §14.14 requires, and `Themed` can look a variant up without rebuilding a map.
  // NULL-PROTOTYPE (see `Surface.variants`): ids come from synced user data, so the map must have no
  // inherited keys to resolve to and no `Object.prototype` to write through.
  const variants = Object.create(null) as Record<string, ComponentType<P>>;
  variants[defaultId] = fallback;

  /** The registered component for an id, or the fallback. `Object.hasOwn` rather than a bare index read, so
   *  the guarantee is stated rather than inherited from how the object happened to be built. */
  const variantFor = (id: VariantId): ComponentType<P> =>
    (Object.hasOwn(variants, id) ? variants[id as string] : undefined) ?? fallback;

  function useVariantId(): string {
    const theme = useUISlice((s) => s.theme);
    // `useThemeSetting` is generic over `ThemeSettingValue` (string | boolean); a surface setting is a seg
    // (string). It returns `undefined` at runtime when the theme declares no `<name>` key at all — the
    // `id &&` guard catches that, and `Object.hasOwn` catches an id the registry doesn't hold (a variant
    // from a newer build, a theme-owned one whose chunk hasn't registered yet, `toString`).
    const id = useThemeSetting<string>(theme, name);
    return id && Object.hasOwn(variants, id) ? id : defaultId;
  }

  function Themed(props: P & { layout?: VariantId }) {
    const resolved = useVariantId();
    // `layout` is the resolver OVERRIDE, not a slot — it must not reach the variant (a variant's props are
    // its own contract). Both casts are the price of a generic rest: TS knows the remainder is
    // `Omit<P & {layout?}, "layout">`, which IS `P` because the constraint reserves the key, and it narrows
    // `layout` itself to `never` inside this body for the same reason.
    const { layout, ...slots } = props;
    const Variant = variantFor((layout as VariantId | undefined) ?? resolved);
    return createElement(Variant, slots as unknown as P);
  }
  Themed.displayName = `Themed(${name})`;

  return {
    name,
    defaultId,
    variants,
    register(id: string, Component: ComponentType<P>) {
      variants[id] = Component;
    },
    useVariantId,
    Themed,
  };
}
