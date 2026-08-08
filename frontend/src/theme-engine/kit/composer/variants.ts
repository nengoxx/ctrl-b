import { createSurface } from "../../surface";
import type { ComposerSlots, ComposerVariant } from "./types";
import { KitComposer } from "./Composer";
import { LineComposer } from "./LineComposer";
import { SheetComposer } from "./SheetComposer";

// The user-selectable composer LAYOUT surface (D31/§14.14) — the three REAL variant components. "stacked" =
// the default KitComposer; "sheet" = the docked SheetComposer (A2); "line" = the Telegram-style single-row
// LineComposer (Phase E, owner-confirmed 2026-07-11). The old CSS-only `borderless`/`ghost` entries were thin
// `rootClass` wrappers around KitComposer — CHROME, not layout — so F5 slice B split them into the
// `composerSkin` axis (the `glass`/`sleek` skins in kit.css keyed on body[data-composer-skin]); KitComposer no
// longer needs wrapper components. Add a layout with one `register` row here (+ listing its id in a theme's
// `composer` setting options). A bespoke per-theme composer would register from its theme module; today all
// variants are Kit-eager. (Additive rows only — never restructures.)
//
// The registry + resolver themselves now come from the shared `createSurface` factory (GACHA_PLAN §12.6 E0):
// Fleet became the second user-selectable surface, which is the extraction trigger §14.14 named, so this file
// is the composer's CONCRETE — its ids, its components, its default — over generic machinery. The exports
// below keep their old names, types and values, so nothing that imports them changed. The factory owns the
// stable-module-level-refs rule the map used to state here (a fresh identity per render would remount the
// composer and reset its controller state).
export const composerSurface = createSurface<ComposerSlots>("composer", "stacked", KitComposer);
composerSurface.register("sheet", SheetComposer);
composerSurface.register("line", LineComposer);

export const composerVariants: Record<string, ComposerVariant> = composerSurface.variants;
// "stacked" | "sheet" | "line"
export type ComposerLayout = keyof typeof composerVariants;
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = composerSurface.defaultId;
