import { useUISlice } from "../../../store/ui";
import { useThemeSetting } from "../../settings";
import { KitComposer } from "./Composer";
import { composerVariants, DEFAULT_COMPOSER_LAYOUT, type ComposerLayout } from "./variants";
import type { ComposerSlots } from "./types";

// Resolve the active theme's chosen composer layout → its variant component. Reads the per-theme `composer`
// setting (undefined when the theme doesn't declare it → fallback). Exposed as a hook so DefaultRoot can ALSO
// key its `--composer-h` measurement on the layout (re-measure on a live swap). Usable by any Root.
export function useComposerLayout(): ComposerLayout {
  const theme = useUISlice((s) => s.theme);
  // `useThemeSetting` is generic over `ThemeSettingValue` (string | boolean); the composer setting is a seg
  // (string). It returns `undefined` at runtime when the theme declares no `composer` key — the `id &&` guard
  // catches that (and any unknown id) → the registry's declared default.
  const id = useThemeSetting<string>(theme, "composer");
  return id && id in composerVariants ? id : DEFAULT_COMPOSER_LAYOUT;
}

// `layout` may be passed so a Root that ALREADY reads the layout (DefaultRoot needs it for its effect dep)
// hands the same value down; bespoke Roots can omit it and let the hook resolve. (Hooks can't be
// conditional, so this component always subscribes via `useComposerLayout` — the prop picks which value
// WINS, it doesn't save the subscription; the store read is O(1) and identical, so that's fine.)
//
// Import-cycle note (benign): ThemedComposer → settings → registry → themes/* → DefaultRoot → ThemedComposer.
// ESM-safe because nothing is *called* at module top-level during the cycle (`useThemeSetting` is only
// invoked at render); this mirrors the documented benign cycle in `settings.ts`. `variants.ts` imports only
// Kit components (no theme imports), so the registry seeds cleanly.
export function ThemedComposer({ layout, ...slots }: ComposerSlots & { layout?: ComposerLayout }) {
  const resolved = useComposerLayout();
  const Variant = composerVariants[layout ?? resolved] ?? KitComposer; // fallback-safe
  return <Variant {...slots} />;
}
