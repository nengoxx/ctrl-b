// Cosmos orbit engine (C2b-1) — makes the planets revolve around the moon.
//
// WHY this shape (web-researched, see COSMOS_HANDOFF / the C2b plan): the steady orbit must stay smooth on
// Firefox-Android even while the main thread is busy (the 5s fleet poll, React re-renders). `transform` is
// GPU-composited everywhere; CSS motion-path (`offset-path`) is NOT composited on Firefox, so it's out. So
// each planet gets a compositor `transform` animation via the **Web Animations API** (element.animate) —
// WAAPI gives us handles to pause/resume, set `playbackRate` (tempo) live, and read `currentTime` (the
// C2b-2 camera-follow reads it analytically, no layout). We animate pure TRANSLATE around the circle (a
// 36-gon, visually a circle) so the glyph never rotates — no rotating-arm + counter-rotation needed. Frame 0
// equals present()'s static (x,y), so freezing (motion off / reduced-motion / off-tab) ↔ animating is seamless.

import { useEffect, useRef, type RefObject } from "react";

import { GOLDEN_ANGLE } from "./present";

// ── Tuning (named consts — tweakable; the owner may expose some later) ──
const ORBIT_KEYFRAMES = 36; // steps around the circle; 36 = 10° chords, ≤~0.6px off a 150px ring (imperceptible)
const ORBIT_BASE_PERIOD_MS = 90_000; // a full revolution at the reference radius, playbackRate 1 (gentle)
const ORBIT_RADIUS_REF = 96; // radius (px) at which the base period applies
const ORBIT_RADIUS_EXP = 1.15; // outer planets orbit a bit slower (mild Kepler-ish), per-planet mode only
const DECOR_PERIOD_FACTOR = 1.4; // the decorative Pluto drifts a touch slower than a host at its radius

/** A planet's orbit: full-circle period, spin direction, starting angle (= its golden-angle slot), radius. */
export interface OrbitSpec {
  periodMs: number;
  direction: 1 | -1;
  phaseRad: number;
  radius: number;
}

export type OrbitStyle = "perPlanet" | "rigid" | "off";

function periodForRadius(radius: number): number {
  return ORBIT_BASE_PERIOD_MS * Math.pow(radius / ORBIT_RADIUS_REF, ORBIT_RADIUS_EXP);
}

/**
 * Per-host orbit spec. Phase = the host's golden-angle slot (matches present()), so the orbit's frame 0 IS
 * the current static position. Planets all orbit the SAME direction (prograde) — like a real solar system,
 * where every planet shares the disk's spin (retrograde planets essentially don't exist); they still read as
 * de-synced because the period grows with radius (outer = slower) and each starts at its golden-angle phase.
 * In `rigid` mode every planet also shares one period (the whole system turns in lockstep). `off` returns the
 * same specs as `perPlanet` — the orbit is frozen by the caller's animate gate (paused at frame 0 = static),
 * not here. All INDEX-derived, so adding a host never changes existing planets' motion.
 */
export function orbitParams(index: number, radius: number, style: OrbitStyle): OrbitSpec {
  const phaseRad = index * GOLDEN_ANGLE;
  if (style === "rigid") return { periodMs: ORBIT_BASE_PERIOD_MS, direction: 1, phaseRad, radius };
  return { periodMs: periodForRadius(radius), direction: 1, phaseRad, radius };
}

/** Orbit spec for the decorative outer "Pluto" — its own (slow) drift, independent of the host index. */
export function decorOrbitSpec(phaseRad: number, radius: number): OrbitSpec {
  return { periodMs: periodForRadius(radius) * DECOR_PERIOD_FACTOR, direction: 1, phaseRad, radius };
}

/** The angle (rad) a spec is at, at a given elapsed time — used by the C2b-2 camera follow (analytic, no DOM). */
export function angleAt(spec: OrbitSpec, elapsedMs: number): number {
  return spec.phaseRad + spec.direction * (elapsedMs / spec.periodMs) * 2 * Math.PI;
}

/** The 36-step translate keyframes tracing the orbit circle. Frame 0 = (R·cosφ, R·sinφ) = present()'s
 *  static (x,y) for the same host, so animate/freeze are seamless. Pure translate → glyph stays upright. */
export function orbitKeyframes(spec: OrbitSpec): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let k = 0; k <= ORBIT_KEYFRAMES; k++) {
    const a = angleAt(spec, (k / ORBIT_KEYFRAMES) * spec.periodMs);
    const x = Math.cos(a) * spec.radius;
    const y = Math.sin(a) * spec.radius;
    frames.push({ transform: `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` });
  }
  return frames;
}

/** One orbit target: a stable key (host id / "__pluto") + its spec. */
export interface OrbitTarget {
  key: string;
  spec: OrbitSpec;
}

/**
 * Drive the orbit animations imperatively (WAAPI) over a set of registered elements. Returns a stable
 * per-key ref-callback registrar — the caller does `ref={register(key)}` on each orbiting element.
 *
 * Two effects: one (re)builds the animations when the target SET/specs change (e.g. fleet change, orbitStyle
 * flip), creating each paused at frame 0 (= its static position); the other plays/pauses + sets the live
 * `playbackRate` (tempo) when the gate or speed changes. Freezing = pause (holds in place). jsdom-safe: skips
 * elements without `.animate`. The orbit handles are exposed via `animationsRef` for the C2b-2 follow.
 */
export function useCosmosOrbit(
  targets: OrbitTarget[],
  animate: boolean,
  playbackRate: number,
): {
  register: (key: string) => (el: Element | null) => void;
  animationsRef: RefObject<Map<string, Animation>>;
} {
  const nodes = useRef(new Map<string, Element>());
  const cbs = useRef(new Map<string, (el: Element | null) => void>());
  const animations = useRef(new Map<string, Animation>());

  const register = (key: string) => {
    let cb = cbs.current.get(key);
    if (!cb) {
      cb = (el: Element | null) => {
        if (el) nodes.current.set(key, el);
        else nodes.current.delete(key);
      };
      cbs.current.set(key, cb);
    }
    return cb;
  };

  // Signature of the target set + specs — rebuild only when something structural changes.
  const sig = targets
    .map((t) => `${t.key}:${t.spec.periodMs}:${t.spec.direction}:${t.spec.phaseRad.toFixed(4)}:${t.spec.radius}`)
    .join("|");

  // (Re)build the animations (paused at frame 0). Runs after commit, so the ref callbacks have populated nodes.
  useEffect(() => {
    for (const a of animations.current.values()) a.cancel();
    animations.current.clear();
    for (const t of targets) {
      const el = nodes.current.get(t.key);
      if (!el || typeof el.animate !== "function") continue;
      const anim = el.animate(orbitKeyframes(t.spec), {
        duration: t.spec.periodMs,
        iterations: Infinity,
        easing: "linear",
      });
      anim.pause(); // start frozen at frame 0; the gate effect plays it if enabled
      animations.current.set(t.key, anim);
    }
    return () => {
      for (const a of animations.current.values()) a.cancel();
      animations.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig captures the targets/specs identity
  }, [sig]);

  // Play/pause + live tempo. Depends on `sig` too so it re-applies after a rebuild.
  useEffect(() => {
    for (const a of animations.current.values()) {
      a.playbackRate = playbackRate;
      if (animate) a.play();
      else a.pause();
    }
  }, [sig, animate, playbackRate]);

  return { register, animationsRef: animations };
}
