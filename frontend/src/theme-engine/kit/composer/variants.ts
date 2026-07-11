import type { ComposerVariant } from "./types";
import { KitComposer } from "./Composer";
import { GhostComposer } from "./GhostComposer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer registry (D31/§14.14). STABLE module-level refs — never built in render.
// "stacked" = the default KitComposer; "ghost" = the sleek borderless GhostComposer (a thin
// `.kit-composer.ghost` wrapper around KitComposer, landed by A2b); "sheet" = the docked SheetComposer. Add
// a variant by adding a row here (+ listing its id in a theme's `composer` setting options). A bespoke
// per-theme composer would register from its theme module; today all variants are Kit-eager. (Phase E adds
// `line`. Additive rows only — this module never restructures.)
export const composerVariants: Record<string, ComposerVariant> = {
  stacked: KitComposer,
  ghost: GhostComposer,
  sheet: SheetComposer,
};
export type ComposerLayout = keyof typeof composerVariants; // "stacked" | "ghost" | "sheet"
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = "stacked";
