import { composerSurface, type ComposerLayout } from "./variants";

// The composer Surface's resolver + renderer — both thin skins over the shared `createSurface` instance in
// `variants.ts` since GACHA_PLAN §12.6 E0 factored the machinery out (Fleet is the second user-selectable
// surface, which is the extraction trigger §14.14 named). The behavior is unchanged: the same per-theme
// `composer` setting, the same validation, the same fallback to the registry's declared default.

/** Resolve the active theme's chosen composer layout. Kept as its own named export because DefaultRoot ALSO
 *  keys its `--composer-h` measurement on the layout (it must re-measure on a live swap) and bespoke Roots
 *  read it too — a hook every Root can call, not a private detail of the component below. */
export function useComposerLayout(): ComposerLayout {
  return composerSurface.useVariantId();
}

/** Render the theme's composer variant. `layout` may be passed by a Root that already read it (DefaultRoot
 *  does, for its effect dep) so the measurement and the rendered bar can never disagree; omit it and the
 *  component resolves for itself. Fallback-safe — an unknown id renders KitComposer. */
export const ThemedComposer = composerSurface.Themed;
