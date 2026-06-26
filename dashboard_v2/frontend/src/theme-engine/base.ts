// BASE chrome — the token-driven shared module that is the slot-resolution FALLBACK (§9.2/§9.4).
//
// ⏱️ T0 ships an EMPTY stub. In T0 only vapor is registered, and vapor fills EVERY slot, so the
// `?? BASE.slots[name]` fallback is never hit (proven by the byte-for-byte acceptance test). The real
// BASE token-driven chrome — AppBar/Composer/TabBar/Conf rows/ChatBubble/HostDetail consuming the
// semantic-token contract, the OKLCH mode×accent matrix, the NowMonitoring+Waveform slot — is built
// in T1 (with minimal, "base made concrete"). Until then this is just the resolution wiring.

import type { ThemeSlots } from "./types";

export interface BaseChrome {
  slots: Partial<ThemeSlots>;
}

export const BASE: BaseChrome = {
  slots: {}, // empty until T1
};
