import { createSurface } from "../../theme-engine/surface";
import { GachaTrack, type GachaTrackProps } from "./GachaTrack";

// THE FLEET SURFACE — gacha's fleet LAYOUT registry (GACHA_PLAN §12.6 ruling 1). Fleet graduated from
// Root-pinned to user-selectable at E0 because gacha genuinely offers a fleet CHOICE, which is D31's own
// graduation trigger; the generic machinery is `theme-engine/surface.ts`, and this is its second concrete.
//
// GACHA-OWNED, deliberately. D31's "vapor registers its own bespoke variants" clause pre-authorizes a
// theme-registered variant, and these three are not portable: a poster built on `--gc-*` tokens, gacha's
// shear geometry and gacha's rarity hues renders under no other theme. Every other theme stays Root-pinned
// and untouched (`DefaultRoot`'s `DEFAULT_BODIES`, `GachaRoot`'s `BODIES`) — this surface swaps the track
// BODY inside gacha's own Fleet, not the Fleet a Root mounts.
//
// THE CAP IS THREE (owner: "maximum three… I don't wanna clutter the app"): capsule + poster (E1) + cover
// (E2). Concept C is PARKED, not killed — no fourth variant without an owner ruling, and the `fleetLayout`
// seg's option list is what enforces it (`resolveThemeSetting` only resolves an id the theme declared).
//
// `capsule` is the seeded default and the fallback, so today every resolution lands on GachaTrack: E0 ships
// the seam with NO settings row at all (§12.6: "no lying options" — `fleetLayout` stays undeclared until the
// layout it names exists).
export const fleetSurface = createSurface<GachaTrackProps>("fleetLayout", "capsule", GachaTrack);
