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
// Import-cycle note (benign, inherited from `ThemedComposer`): surface → settings → registry → themes/* →
// a Root → surface. ESM-safe because nothing is CALLED at module top-level during the cycle (`useThemeSetting`
// runs only at render); the same live-binding pattern `settings.ts` and `resolve.ts#rootFor` document.

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
   *  in render is the classic way to do this by accident). */
  readonly variants: Record<string, ComponentType<P>>;
  /** Add a variant. ADDITIVE only — a surface's catalog grows, it never restructures; a theme still has to
   *  list the id in its own `seg` setting before a user can pick it (that per-theme capability list is what
   *  `resolveThemeSetting` enforces for free). */
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
 */
export function createSurface<P extends object>(
  name: string,
  defaultId: string,
  fallback: ComponentType<P>,
): Surface<P> {
  // ONE registry object per surface, created at module init and mutated only by `register` — so its entries
  // are the stable references §14.14 requires, and `Themed` can look a variant up without rebuilding a map.
  const variants: Record<string, ComponentType<P>> = { [defaultId]: fallback };

  function useVariantId(): string {
    const theme = useUISlice((s) => s.theme);
    // `useThemeSetting` is generic over `ThemeSettingValue` (string | boolean); a surface setting is a seg
    // (string). It returns `undefined` at runtime when the theme declares no `<name>` key at all — the
    // `id &&` guard catches that, and `id in variants` catches an id the registry doesn't hold (a variant
    // from a newer build, a theme-owned one whose chunk hasn't registered yet).
    const id = useThemeSetting<string>(theme, name);
    return id && id in variants ? id : defaultId;
  }

  function Themed(props: P & { layout?: VariantId }) {
    const resolved = useVariantId();
    // `layout` is the resolver OVERRIDE, not a slot — it must not reach the variant (a variant's props are
    // its own contract). The cast is the price of a generic rest: TS knows the remainder is
    // `Omit<P & {layout?}, "layout">`, which is `P` for every real `P` (no surface's props are named `layout`).
    const { layout, ...slots } = props;
    const Variant = variants[layout ?? resolved] ?? fallback;
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
