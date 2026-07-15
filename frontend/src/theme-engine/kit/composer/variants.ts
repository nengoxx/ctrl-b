import type { ComposerVariant } from "./types";
import { KitComposer } from "./Composer";
import { LineComposer } from "./LineComposer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer LAYOUT registry (D31/§14.14) — the three REAL variant components. STABLE
// module-level refs — never built in render. "stacked" = the default KitComposer; "sheet" = the docked
// SheetComposer (A2); "line" = the Telegram-style single-row LineComposer (Phase E, owner-confirmed
// 2026-07-11). The old CSS-only `borderless`/`ghost` entries were thin `rootClass` wrappers around KitComposer
// — CHROME, not layout — so F5 slice B split them into the `composerSkin` axis (the `glass`/`sleek` skins in
// kit.css keyed on body[data-composer-skin]); KitComposer no longer needs wrapper components. Add a layout by
// adding a row here (+ listing its id in a theme's `composer` setting options). A bespoke per-theme composer
// would register from its theme module; today all variants are Kit-eager. (Additive rows only — never
// restructures.)
export const composerVariants: Record<string, ComposerVariant> = {
  stacked: KitComposer,
  sheet: SheetComposer,
  line: LineComposer,
};
// "stacked" | "sheet" | "line"
export type ComposerLayout = keyof typeof composerVariants;
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = "stacked";
