import { KitComposer } from "./Composer";
import { SendArrowheadIcon } from "./icons";
import type { ComposerSlots } from "./types";

// The BORDERLESS composer variant (A2c — owner addition at the A2b eyeball, 2026-07-11): the stacked
// KitComposer — frosted surface and spacing kept — with the outline removed, elevation-led separation,
// icon-forward controls, the soft blurred-square send, and the SHARED arrowhead send glyph (the owner's
// showcase pick, via KitComposer's internal `sendIcon` seam). Styling lives in `.kit-composer.borderless`
// (kit.css); the owner's original "ghost" intent — the transparent `ghost` variant stayed in the catalog
// as "Sleek". Same wrapper seam as GhostComposer: pure CSS + internal props, no fork.
export function BorderlessComposer(slots: ComposerSlots = {}) {
  return (
    <KitComposer rootClass="borderless" sendIcon={<SendArrowheadIcon size={20} />} {...slots} />
  );
}
