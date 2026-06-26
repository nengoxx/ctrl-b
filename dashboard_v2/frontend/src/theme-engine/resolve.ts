// Slot resolution (Phase 11 / D28 §9.4). `resolveSlot(name) = registry[theme].slots[name] ??
// BASE.slots[name] ?? Missing`. vapor fills every slot → never reaches BASE/Missing in T0.
//
// Resolution is CACHED per theme in a module-level map (§12 "module-level slot map") so the resolved
// object identity is stable across renders — the ThemeProvider context value only changes when the
// active theme actually switches, not on every render. Avoids context fan-out.

import type { ComponentType } from "react";

import { BASE } from "./base";
import { registry } from "./registry";
import type { SlotName, ThemeDef, ThemeId, ThemeSlots } from "./types";

// Every slot resolves to *something* (vapor/BASE/Missing) — so the resolved set is total.
export type ResolvedSlots = ThemeSlots;

const SLOT_NAMES: SlotName[] = [
  "AppBar",
  "Composer",
  "TabBar",
  "FleetView",
  "AgentView",
  "UtilsView",
  "ConfShell",
];

// Dev-only safety net: a slot neither the theme nor BASE provides renders nothing + warns once. In T0
// vapor fills all 7, so this never fires; it guards a future theme that omits a slot BASE can't fill.
function missingSlot(name: SlotName): ComponentType<unknown> {
  return function MissingSlot() {
    if (import.meta.env.DEV) {
      console.warn(`[theme-engine] no component for slot "${name}" (theme + BASE both empty)`);
    }
    return null;
  };
}

function resolveSlots(def: ThemeDef | undefined): ResolvedSlots {
  const out = {} as Record<SlotName, ComponentType<never>>;
  for (const name of SLOT_NAMES) {
    const c = def?.slots[name] ?? BASE.slots[name] ?? missingSlot(name);
    out[name] = c as ComponentType<never>;
  }
  return out as ResolvedSlots;
}

const cache = new Map<ThemeId, ResolvedSlots>();

export function slotsFor(theme: ThemeId): ResolvedSlots {
  let r = cache.get(theme);
  if (!r) {
    r = resolveSlots(registry[theme]);
    cache.set(theme, r);
  }
  return r;
}

// The context default (§9.4): the BASE-only resolution (all-Missing in T0). The ThemeProvider always
// supplies a real theme's slots, so this is only a safety net for a consumer rendered outside it.
export const BASE_SLOTS: ResolvedSlots = resolveSlots(undefined);
