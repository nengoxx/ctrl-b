import type { ComposerVariant } from "./types";
import { BorderlessComposer } from "./BorderlessComposer";
import { KitComposer } from "./Composer";
import { GhostComposer } from "./GhostComposer";
import { LineComposer } from "./LineComposer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer registry (D31/§14.14). STABLE module-level refs — never built in render.
// "stacked" = the default KitComposer; "borderless" = stacked minus the outline (A2c, owner addition);
// "ghost" = the sleek transparent GhostComposer (A2b); "sheet" = the docked SheetComposer (A2); "line" = the
// Telegram-style single-row LineComposer (Phase E, owner-confirmed 2026-07-11 — a REAL component variant, not
// a wrapper). The pure-CSS variants (borderless/ghost) are thin `rootClass` wrappers around KitComposer — no
// fork. Add a variant by adding a row here (+ listing its id in a theme's `composer` setting options). A
// bespoke per-theme composer would register from its theme module; today all variants are Kit-eager.
// (Additive rows only — this module never restructures.)
export const composerVariants: Record<string, ComposerVariant> = {
  stacked: KitComposer,
  borderless: BorderlessComposer,
  ghost: GhostComposer,
  sheet: SheetComposer,
  line: LineComposer,
};
// "stacked" | "borderless" | "ghost" | "sheet" | "line"
export type ComposerLayout = keyof typeof composerVariants;
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = "stacked";
