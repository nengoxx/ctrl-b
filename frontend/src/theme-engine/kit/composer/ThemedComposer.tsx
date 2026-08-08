import { composerSurface, type ComposerLayout } from "./variants";
import type { ComposerSlots } from "./types";

// The composer Surface's resolver + renderer — both thin skins over the shared `createSurface` instance in
// `variants.ts` since GACHA_PLAN §12.6 E0 factored the machinery out (Fleet is the second user-selectable
// surface, which is the extraction trigger §14.14 named). The behavior is unchanged: the same per-theme
// `composer` setting, the same validation, the same fallback to the registry's declared default.
//
// ⚠ Both exports read `composerSurface` INSIDE a function body, never at module scope. This file sits in a
// real ESM cycle — variants → surface → settings → registry → themes/vapor → VaporRoot → DefaultRoot →
// ThemedComposer → variants — and a module graph entered at `variants.ts` reaches this file with
// `composerSurface` declared but still in its temporal dead zone. `export const ThemedComposer =
// composerSurface.Themed` therefore threw `Cannot read properties of undefined` under that entry order (the
// E0 review's HIGH). The rule, stated in full in `surface.ts`: inside a cycle a module may declare and
// import, but must not READ THROUGH a cycle binding at module scope. `tests/theme-engine/importOrder.test.ts`
// pins it.

/** Resolve the active theme's chosen composer layout. Kept as its own named export because DefaultRoot ALSO
 *  keys its `--composer-h` measurement on the layout (it must re-measure on a live swap) and bespoke Roots
 *  read it too — a hook every Root can call, not a private detail of the component below. */
export function useComposerLayout(): ComposerLayout {
  return composerSurface.useVariantId();
}

/** Render the theme's composer variant. `layout` may be passed by a Root that already read it (DefaultRoot
 *  does, for its effect dep) so the measurement and the rendered bar can never disagree; omit it and the
 *  component resolves for itself. Fallback-safe — an unknown id renders KitComposer. */
export function ThemedComposer(props: ComposerSlots & { layout?: ComposerLayout }) {
  return <composerSurface.Themed {...props} />;
}
