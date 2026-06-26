// The theme registry (Phase 11 / D28 §9.3). Only BUILT themes appear here — adding a theme is one row
// here + one self-contained module (the north star). T0 = vapor only; the rest of the ThemeId union
// is declared in types.ts and lands in its own Tn slice.

import type { ThemeDef, ThemeRegistry } from "./types";
import { vapor } from "./vapor";

export const registry: ThemeRegistry = {
  vapor,
};

/** The registered (built) themes, for the Conf Appearance picker. T0 = [vapor]; grows per Tn slice. */
export function registeredThemes(): ThemeDef[] {
  return Object.values(registry).filter((d): d is ThemeDef => d != null);
}
