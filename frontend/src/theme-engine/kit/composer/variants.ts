import type { ComposerVariant } from "./types";
import { KitComposer } from "./Composer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer registry (D31/§14.14). STABLE module-level refs — never built in render.
// "stacked" = the default KitComposer; "sheet" = the docked SheetComposer. Add a variant by adding a row
// here (+ listing its id in a theme's `composer` setting options). A bespoke per-theme composer would
// register from its theme module; today both variants are Kit-eager. (A2b adds `ghost` — a thin
// `.kit-composer.ghost` wrapper around KitComposer; Phase E adds `line`. Additive rows only — this module
// never restructures.)
export const composerVariants: Record<string, ComposerVariant> = {
  stacked: KitComposer,
  sheet: SheetComposer,
};
export type ComposerLayout = keyof typeof composerVariants; // "stacked" | "sheet"
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = "stacked";
