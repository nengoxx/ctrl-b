// Cosmos camera (C2b-2) — zoom-follow on selection. The `.cosmos-camera` element carries ONE transform
// that composes the fit-to-stage scale (C2a-fix) with a zoom + translate that centers the selected planet
// and FOLLOWS it as it orbits. This hook is the single owner of that transform (CosmosFleet no longer sets
// it inline) — so React re-renders and the rAF can't fight over it.
//
// Smoothness (web-researched, see the C2b plan): the steady orbit stays on the GPU (WAAPI, C2b-1); the
// camera is interaction-driven, so a rAF is appropriate here. It reads the selected planet's orbit position
// ANALYTICALLY from the animation's `currentTime` (a layout-free read) — never getBoundingClientRect — and
// eases with frame-rate-independent exponential damping (Rory Driscoll): cur → target by `1 - e^(-rate·dt)`.

import { useLayoutEffect, useRef, type RefObject } from "react";

import { angleAt, type OrbitSpec } from "./orbit";

const FOLLOW_RATE = 7; // damping rate (1/s) — higher = snappier catch-up; 7 ≈ a smooth ~0.4s settle
const SETTLE_S = 0.001; // scale within this of target → settled
const SETTLE_PX = 0.3; // translate within this (px) of target → settled

// Moon-dive (Slice 2a): tapping the central moon zooms the camera INTO it (center, x=y=0) then navigates to
// Agent. A stronger zoom than the planet follow so the moon fills the view as it goes; DIVE_MS is how long
// the dive plays before the tab switch (≈ the camera's ~0.4s settle so the zoom is most of the way there).
// The orbital stage's CSS opacity fade is kept in sync with DIVE_MS in cosmos.css.
export const DIVE_ZOOM = 4; // dive scale = fitScale × this (vs FOLLOW_ZOOM 2.2 for a planet select)
export const DIVE_MS = 300; // dive duration before navigate("agent")

export interface CameraState {
  s: number;
  tx: number;
  ty: number;
}

/** A planet's position (px, in camera space) at a given orbit time — center + R·(cos,sin)(angle). */
export function planetXY(spec: OrbitSpec, currentTimeMs: number): { x: number; y: number } {
  const a = angleAt(spec, currentTimeMs);
  return { x: Math.cos(a) * spec.radius, y: Math.sin(a) * spec.radius };
}

/** The camera transform that centers `(px,py)` at the live-zone center (stage center + `centerOffsetY`,
 *  which lifts the system above the composer), zoomed by `zoomScale`. */
export function followTarget(
  px: number,
  py: number,
  zoomScale: number,
  centerOffsetY = 0,
): CameraState {
  return { s: zoomScale, tx: -zoomScale * px, ty: centerOffsetY - zoomScale * py };
}

/** Frame-rate-independent exponential damping (Rory Driscoll) — approach `target` from `cur` over `dtMs`. */
export function damp(cur: number, target: number, rate: number, dtMs: number): number {
  return target + (cur - target) * Math.exp(-rate * (dtMs / 1000));
}

function settled(a: CameraState, b: CameraState): boolean {
  return (
    Math.abs(a.s - b.s) < SETTLE_S &&
    Math.abs(a.tx - b.tx) < SETTLE_PX &&
    Math.abs(a.ty - b.ty) < SETTLE_PX
  );
}

export interface CameraOpts {
  active: boolean; // Fleet tab showing — don't run the rAF for a hidden tab
  selected: string | null; // selected host id (null = no zoom; rest at fit)
  specByKey: Map<string, OrbitSpec>; // each orbit target's spec (for the analytic position)
  animationsRef: RefObject<Map<string, Animation>>; // live orbit handles (read currentTime)
  fitScale: number; // the idle (no-selection) scale from the fit-to-stage measure
  zoomMult: number; // selected scale = fitScale × this
  centerOffsetY: number; // lift the system to the live-zone center (between appbar + composer), px
  orbitAnimating: boolean; // is the orbit actually moving — so we only keep the rAF alive to TRACK motion
  dive: boolean; // moon-dive in progress — overrides selection, eases to a center zoom (DIVE_ZOOM)
}

/**
 * Drive `.cosmos-camera`'s transform. Idle (no selection) → `scale(fitScale)`; selected → ease to the zoom
 * that centers the planet, then track it each frame. The rAF runs only while the tab is active AND we're
 * either following a selection or still easing toward idle; once settled at idle it stops (the final
 * transform stays). Off-tab → snap to the target without animating. A layout effect sets the first frame
 * before paint (no un-scaled flash, since CosmosFleet stopped setting the transform inline).
 */
export function useCameraFollow(cameraRef: RefObject<HTMLElement | null>, opts: CameraOpts): void {
  const cur = useRef<CameraState>({ s: opts.fitScale, tx: 0, ty: opts.centerOffsetY });
  const raf = useRef(0);
  const last = useRef(0);
  const live = useRef(opts);
  live.current = opts;

  useLayoutEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;

    const apply = () => {
      const c = cur.current;
      cam.style.transform = `translate(${c.tx.toFixed(2)}px, ${c.ty.toFixed(2)}px) scale(${c.s.toFixed(4)})`;
    };
    // Returns the camera target + whether we're actively following a real (present) selected planet.
    const computeTarget = (): { target: CameraState; following: boolean } => {
      const { dive, selected, specByKey, fitScale, zoomMult, animationsRef, centerOffsetY } =
        live.current;
      // Moon-dive wins over any selection: ease to a strong zoom centered on the moon (system center, 0,0).
      // `following: false` → no orbit tracking; the rAF eases there and stops (we navigate mid-ease anyway).
      if (dive) {
        return {
          target: followTarget(0, 0, fitScale * DIVE_ZOOM, centerOffsetY),
          following: false,
        };
      }
      const spec = selected ? specByKey.get(selected) : undefined;
      if (!spec) return { target: { s: fitScale, tx: 0, ty: centerOffsetY }, following: false };
      const anim = animationsRef.current?.get(selected!);
      const t = typeof anim?.currentTime === "number" ? anim.currentTime : 0;
      const { x, y } = planetXY(spec, t);
      return { target: followTarget(x, y, fitScale * zoomMult, centerOffsetY), following: true };
    };
    const tick = (now: number) => {
      const dt = last.current ? now - last.current : 16;
      last.current = now;
      const { target, following } = computeTarget();
      cur.current = {
        s: damp(cur.current.s, target.s, FOLLOW_RATE, dt),
        tx: damp(cur.current.tx, target.tx, FOLLOW_RATE, dt),
        ty: damp(cur.current.ty, target.ty, FOLLOW_RATE, dt),
      };
      apply();
      // Keep ticking only while there's motion to TRACK (a present planet whose orbit is animating) or while
      // still easing toward the target; otherwise snap + stop (no idle spin when frozen/deselected/stale).
      const tracking = following && live.current.orbitAnimating;
      if (live.current.active && (tracking || !settled(cur.current, target))) {
        raf.current = requestAnimationFrame(tick);
      } else {
        cur.current = target;
        apply();
        raf.current = 0;
        last.current = 0;
      }
    };

    cancelAnimationFrame(raf.current);
    last.current = 0;
    if (!opts.active || typeof requestAnimationFrame === "undefined") {
      cur.current = computeTarget().target; // off-tab (or no rAF env): snap, no animation
      apply();
      return;
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // Restart the loop when the tab visibility, selection, idle scale, center offset, or orbit-motion state
    // changes (the last so it re-arms to track once the orbit starts, or settles+stops when it freezes).
    // Specs are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.active,
    opts.selected,
    opts.fitScale,
    opts.zoomMult,
    opts.centerOffsetY,
    opts.orbitAnimating,
    opts.dive,
  ]);
}
