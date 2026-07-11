import { KitComposer } from "./Composer";
import type { ComposerSlots } from "./types";

// The SLEEK borderless "ghost" composer variant (A2b, D30/D31, COMPOSER_SURFACE_PLAN §0) — the cheapest
// band: a thin wrapper that renders KitComposer's EXACT DOM + behaviour and adds the `.kit-composer.ghost`
// root class, which `.kit-composer.ghost` in kit.css restyles (transparent background + shadow, borderless
// buttons/pill, sleeker spacing) using SEMANTIC tokens only. No fork — same headless `useComposer()`, same
// slots, same a11y. Readability over scrolled content is carried by the GHOST-EXTENDED bottom scrim
// (`.kit-main:has(.kit-composer.ghost)::after` — the default scrim ends below the text band, so kit.css
// extends it through the composer zone) plus a resting-hairline/accent-on-focus field underline.
export function GhostComposer(slots: ComposerSlots = {}) {
  return <KitComposer rootClass="ghost" {...slots} />;
}
