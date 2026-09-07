import { useLayoutEffect, useRef } from "react";

import type { FocalArt } from "../../lib/focalPosition";
import { useUISlice } from "../../store/ui";
import { safeRafLoop } from "../safeRafLoop";
import type { AgentBackdropMode } from "../types";
import { parsePx, progressValue, scrollProgress } from "./scrollProgress";

// THE AGENT BACKDROP (D70 §8.3, narrowed by the owner-confirmed §8.3a) — where the ACTIVE agent's art
// paints behind the chat, as ONE global appearance mode with three states. This file is the NON-COMPONENT
// half: the vocabulary, its heal, the store read and the scroll driver. `AgentBackdrop.tsx` beside it is
// the layer that renders them.
//
// The split is the `SECTION_PLACEMENTS` shape one axis over — the placement vocabulary + `resolvePlacement`
// live in the pure `layout.ts`, not in a component — and it is what lets the Conf row read the healed mode
// without pulling a layer into the settings chunk.
//
// §14.11 posture, stated: nothing here animates `filter`, and no scroll-driven CSS animation is used. The
// walk is ONE custom property written per frame through the engine's guarded rAF, with every channel a
// `calc()` over it — so a scroll frame costs one property write and the compositor's own opacity work. The
// perf/motion gates are hand-authored (gacha's posture, since the app has no `.expensive-effect` class):
// `body[data-motion="reduced"]` parks the layer AT THE FLOOR and the driver does not run at all (a
// scroll-linked opacity ramp is motion), and `body[data-perf="lite"]` drops the `will-change` layer hint
// (its GPU-memory cost is the only thing lite has to buy back here — there is no blur to gate).

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

// The kit's ONE scroller — named here for the same reason ChatThread and GachaAgent name it: a body (or a
// layer inside one) reaches the shell's single content pane by id, and every driver must agree which pane
// that is.
const SCROLLER_ID = "app-scroll";
/** The property the walk writes; every `full` channel is a `calc()` over this ONE number. */
const P_VAR = "--kit-backdrop-p";
/** The walk LENGTH token. Read from CSS rather than hardcoded: it is a tunable, and a theme moves it by
 *  overriding the token in `@layer theme`. Parse failure ⇒ no ramp ⇒ the driver writes nothing and the
 *  layer stays at rest (`scrollProgress.ts#parsePx`'s null contract). */
const RAMP_VAR = "--kit-backdrop-ramp";

/**
 * Drive `--kit-backdrop-p` (0 → 1) from the shared scroller, and nothing else.
 *
 * Deliberately SMALLER than gacha's M7 driver, because the geometry is: the `full` layer is pinned to the
 * top of the tab, so its walk starts at the scroller's own origin — `base` is 0, there is nothing to
 * measure, and therefore no ResizeObserver, no anchor node and no remeasure frame (the three things M7
 * needs because its block sits in the flow under an app bar and a plan panel that both move it).
 *
 * What it keeps from that driver, because those parts are about the SCROLLER rather than the geometry:
 * a PASSIVE listener, ONE coalesced frame per burst through the engine's crash-guarded loop (`start()` is
 * a no-op while a frame is pending — that IS the throttle), the quantized-value guard so a sub-perceptual
 * move never dirties style, and property REMOVAL on teardown.
 */
export function useBackdropWalk(active: boolean, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = document.getElementById(SCROLLER_ID);
    if (!el || !scroller || !active || !enabled) return;
    const ramp = parsePx(getComputedStyle(el).getPropertyValue(RAMP_VAR));
    if (ramp === null) return; // no tunable → no walk (the layer renders at rest)
    let last = "";
    const write = () => {
      const value = progressValue(scrollProgress(scroller.scrollTop, 0, ramp));
      if (value === last) return;
      last = value;
      el.style.setProperty(P_VAR, value);
    };
    const loop = safeRafLoop(() => {
      write();
      return false;
    });
    const onScroll = () => loop.start();
    // The first write is SYNCHRONOUS, before the browser paints this mount: activating the tab on a thread
    // that is already scrolled must land walked rather than flash sharp for a frame.
    write();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      loop.stop();
      el.style.removeProperty(P_VAR);
    };
  }, [active, enabled]);
  return ref;
}
