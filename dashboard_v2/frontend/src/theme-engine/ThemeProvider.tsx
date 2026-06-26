// ThemeProvider + useThemeSlot (Phase 11 / D28 §9.4). Reads the active theme from the `ui` store,
// resolves its slot set (cached, stable identity per theme), and exposes it via context. Consumers
// (App, and BASE components in T1+) read a slot with `useThemeSlot("FleetView")`.
//
// Lazy CSS/font loading is NOT done here — the `switchTheme` path (switchTheme.ts, §9.12) loads the
// next theme's bundle BEFORE committing the `ui` change, so by the time the active theme flips its
// CSS is already applied. vapor's CSS is always-loaded (layer frozen), so T0 never loads anything.

import { createContext, useContext, type ReactNode } from "react";

import { useUISlice } from "../store/ui";
import { BASE_SLOTS, slotsFor, type ResolvedSlots } from "./resolve";
import type { SlotName } from "./types";

// Default = BASE-only resolution (all-Missing in T0). The provider always supplies a real theme's
// slots; this default only catches a consumer rendered outside the provider.
const SlotContext = createContext<ResolvedSlots>(BASE_SLOTS);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUISlice((s) => s.theme);
  const slots = slotsFor(theme); // cached → stable identity unless `theme` changes
  return <SlotContext value={slots}>{children}</SlotContext>;
}

/** Read a single resolved slot component for the active theme. */
export function useThemeSlot<K extends SlotName>(name: K): ResolvedSlots[K] {
  return useContext(SlotContext)[name];
}

/** Read the whole resolved slot set (App, the slot host, renders several at once). */
export function useThemeSlots(): ResolvedSlots {
  return useContext(SlotContext);
}
