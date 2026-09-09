import type { FocalArt } from "../../lib/focalPosition";
import { useUISlice } from "../../store/ui";
import type { AgentBackdropMode } from "../types";

// THE AGENT BACKDROP (D70 §8.3, narrowed by the owner-confirmed §8.3a) — where the ACTIVE agent's art
// paints behind the chat, as ONE global appearance mode with three states. This file is the NON-COMPONENT
// half: the vocabulary, its heal, the outrank ladder and the store read. `AgentBackdrop.tsx` beside it is
// the layer that renders them.
//
// The split is the `SECTION_PLACEMENTS` shape one axis over — the placement vocabulary + `resolvePlacement`
// live in the pure `layout.ts`, not in a component — and it is what lets the Conf row read the healed mode
// without pulling a layer into the settings chunk.
//
// §14.11 posture, stated: the backdrop ANIMATES NOTHING. `full` shipped with a scroll-driven opacity walk
// (1 → a floor over a ramp token, one custom property per frame through the engine's guarded rAF); the
// owner ruled it out at the wave-3 feel round (2026-09-09, D70 §13-S6b) — the layer keeps its rest look at
// every offset — so the driver, its ramp/floor tokens and the motion/perf gates that existed only for it
// were deleted rather than parked. Nothing is left to gate: no filter, no scroll-driven CSS animation, no
// per-frame property, and no `will-change` layer for perf-lite to buy back. The ramp MATH still lives in
// `scrollProgress.ts` because gacha's oracle fade — a different surface, its own driver — still walks.

/** The mode vocabulary as a runtime allowlist — the membership check the healing below needs (TS types are
 *  erased; a persisted blob, or an appearance doc written by another build, can hold anything). Ordered
 *  widest→narrowest, default first. The `SECTION_PLACEMENTS` precedent, one axis over. */
export const AGENT_BACKDROP_MODES: readonly AgentBackdropMode[] = ["operator", "full", "off"];

/** Heal one stored value to a mode the app can actually render — PURE, and the same parse-don't-validate
 *  stance `resolvePlacement` takes for the satellite lever: the persist loader's defaults-merge and the
 *  appearance reconcile both pass a stored value through UNTYPED, so a value this build doesn't know (a
 *  rolled-back vocabulary, hand-edited localStorage, a nested number/null) reaches render time. Membership
 *  else `"operator"` — the default state, never "nothing paints", so a corrupt value can't silently look
 *  like the owner turned the feature off. ONE definition: the Appearance row, both tab bodies and every
 *  layer read the value through this. */
export function resolveAgentBackdrop(v: unknown): AgentBackdropMode {
  return AGENT_BACKDROP_MODES.includes(v as AgentBackdropMode)
    ? (v as AgentBackdropMode)
    : "operator";
}

/** What beats a THEME's own operator art on the agent-backdrop surface: `off` — the mode suppresses
 *  every picture, agent art and theme fallback alike (§8.3's F14 correction); `agent` — the ACTIVE
 *  agent's own `background` wins the resolution while that agent is active. */
export type BackdropOutrank = "off" | "agent";

/** §8.3's ladder as ONE pure statement, with two readers that cannot disagree (the S6 fix wave): the
 *  PAINT (a theme body resolving what to show — gacha's `GachaAgent`) and the REPORT (the media
 *  gallery saying which library picture is live — `useMediaLibrary`). `null` ⇒ the theme's own art is
 *  what paints.
 *
 *  It is stated here rather than inside gacha because the rule is the kit's: the agent's art wins the
 *  backdrop surface on every theme, and the mode governs all of them. A theme contributes the FALLBACK
 *  rung, never the ordering. */
export function backdropOutrank(
  mode: AgentBackdropMode,
  hasAgentArt: boolean,
): BackdropOutrank | null {
  if (mode === "off") return "off";
  return hasAgentArt ? "agent" : null;
}

/** The HEALED mode from the store — what every consumer (the two agent bodies, the Conf row) reads, so a
 *  row can never display a value the app is not actually rendering (the `themeRowValue` lesson). */
export function useAgentBackdropMode(): AgentBackdropMode {
  return resolveAgentBackdrop(useUISlice((s) => s.agentBackdrop));
}

/** One picture, ready to paint — the `BoundArt` shape `useAgentArt` publishes and the shape gacha's
 *  `ResolvedArt` already satisfies (its extra `rev` is the theme's own bookkeeping). Declared structurally
 *  rather than imported so this kit module depends on neither the agents hook nor a theme. */
export interface BackdropArt {
  url: string;
  focus?: FocalArt;
}
