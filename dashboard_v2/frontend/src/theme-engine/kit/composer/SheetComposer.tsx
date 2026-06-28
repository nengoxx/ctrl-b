import { KitComposer } from "./Composer";
import type { ComposerSlots } from "./types";

// ⚠️ STUB — NOT YET IMPLEMENTED (D30). Placeholder for the future "vapor-peek" composer VARIANT: a composer
// styled like a bottom sheet PEEKING up from the screen bottom with rounded top edges — the vapor `.composer`
// look, but WITHOUT any drag (purely the appearance). It exists now only to PROVE the variant seam: a theme
// can already select it via `DefaultRoot Composer={SheetComposer}`, and it composes the same `ComposerSlots`
// (controlsStart/overlay) as every variant.
//
// Until it's styled it simply DELEGATES to the default `KitComposer`, so selecting it changes nothing yet
// (no breakage). TODO(SheetComposer): give it its own markup + `.kit-composer.sheet` peek/rounded styles,
// reusing the headless `useComposer()` controller (never re-implement composer logic) — see THEME_ENGINE.
export function SheetComposer(slots: ComposerSlots = {}) {
  return <KitComposer {...slots} />;
}
