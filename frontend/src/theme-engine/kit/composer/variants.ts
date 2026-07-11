import type { ComposerVariant } from "./types";
import { BorderlessComposer } from "./BorderlessComposer";
import { KitComposer } from "./Composer";
import { GhostComposer } from "./GhostComposer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer registry (D31/§14.14). STABLE module-level refs — never built in render.
// "stacked" = the default KitComposer; "borderless" = stacked minus the outline (A2c, owner addition);
// "ghost" = the sleek transparent GhostComposer (A2b); "sheet" = the docked SheetComposer (A2). The pure-CSS
// variants (borderless/ghost) are thin `rootClass` wrappers around KitComposer — no fork. Add a variant by
// adding a row here (+ listing its id in a theme's `composer` setting options). A bespoke per-theme composer
// would register from its theme module; today all variants are Kit-eager. (Phase E adds `line`. Additive
// rows only — this module never restructures.)
export const composerVariants: Record<string, ComposerVariant> = {
  stacked: KitComposer,
  borderless: BorderlessComposer,
  ghost: GhostComposer,
  sheet: SheetComposer,
};
export type ComposerLayout = keyof typeof composerVariants; // "stacked" | "borderless" | "ghost" | "sheet"
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = "stacked";
