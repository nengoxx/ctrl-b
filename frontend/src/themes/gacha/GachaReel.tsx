import { useEffect, useState } from "react";

import { setGachaReelRunning } from "../../store/gachaReel";
import { useUISlice } from "../../store/ui";

// The gacha TAB REEL (M1) — five vertical slats sweeping top→bottom over the whole shell on every section
// change (D52 / GACHA_PLAN §10.1; the reel FIGURE is G4, this is the mechanism).
//
// M1 IS THE PRIMARY EFFECT and must be complete without View Transitions: the plan's standing posture is
// that M2 (the root cross-fade under the reel) is progressive enhancement, droppable without ceremony. So
// this component depends on nothing but the tab value.
//
// ── THE START, and why there is no hook at the nav chokepoint ────────────────────────────────────────────
// The prototype fires its reel just BEFORE mutating the tab, but its own no-VT path runs both in the same
// pre-paint task — behaviorally identical to a PASSIVE same-frame start (the research verdict that dropped
// the planned pre-navigation kit hook). So this subscribes to the same `useUISlice(s => s.tab)` binding the
// section bodies use: one store notification, one commit, one paint — the sweep and the content swap land
// together, with no effect and no `useLayoutEffect` in the path.
//
// `key={tab}` REMOUNTS the overlay on every change, which is the React-clean equivalent of the prototype's
// `void reel.offsetWidth` reflow poke: a CSS animation on a freshly mounted node always starts at frame 0,
// so hammering the tab bar restarts the sweep instead of leaving a half-finished one running.
//
// ── THE BOOT LATCH ───────────────────────────────────────────────────────────────────────────────────────
// A reel on app boot (or on every theme switch INTO gacha, which remounts this Root) would be a transition
// announcing nothing. `bootTab` is the tab at mount; the overlay renders only once the user has actually
// moved off it. `everSwitched` then makes that sticky, so returning to the boot tab later still reels.
// State, not a ref: the first switch is armed by the render-time comparison — the effect only records the
// fact — so the reel still starts in the SAME commit as the tab change.
//
// The MOTION GATE is the outer component, and the latch lives in a child it mounts (Codex G0 #5). Keeping
// both in one component leaked a reel: tab changes made under reduced motion still armed the latch, so the
// moment the owner turned motion back ON — an appearance toggle, not a navigation — the overlay mounted and
// swept for a tab switch that had happened minutes earlier. Unmounting the latch with the gate means motion
// coming back re-boots it against the CURRENT tab: nothing animates until the user actually navigates.
export function GachaReel() {
  // The app's OWN motion axis (`body[data-motion]`), never the OS media query — reduced motion removes the
  // reel entirely rather than shortening it. gacha.css carries the same gate as a CSS belt.
  const motion = useUISlice((s) => s.motion);
  if (motion === "reduced") return null;
  return <GachaReelSweep />;
}

/** The sweep's total on-screen life: the 520 ms slat animation plus the last slat's 120 ms stagger (the
 *  `.gc-reel` block in gacha.css). Kept beside the component that mounts the node rather than in the store,
 *  because it is a property of THIS animation — a second reel-shaped effect would bring its own. */
const REEL_TOTAL_MS = 640;

function GachaReelSweep() {
  const tab = useUISlice((s) => s.tab);
  const [bootTab] = useState(tab);
  const [everSwitched, setEverSwitched] = useState(false);

  useEffect(() => {
    if (tab !== bootTab) setEverSwitched(true);
  }, [tab, bootTab]);

  const sweeping = everSwitched || tab !== bootTab;

  // Publish the sweep to the rest of the theme (G1): the pickup banner holds its auto-advance and cancels
  // any gesture while the slats are over the screen (§6.4 / the §10.3 "never coincide" line). Keyed on
  // `tab` as well as `sweeping`, so a second switch DURING a sweep re-arms the window from zero — the same
  // restart the `key={tab}` remount gives the animation itself. Both the timer and the flag are cleared on
  // unmount, which is also the reduced-motion and theme-switch path (the §10.5 cleanup ledger).
  useEffect(() => {
    if (!sweeping) return;
    setGachaReelRunning(true);
    const t = setTimeout(() => setGachaReelRunning(false), REEL_TOTAL_MS);
    return () => {
      clearTimeout(t);
      setGachaReelRunning(false);
    };
  }, [tab, sweeping]);

  if (!sweeping) return null;

  return (
    // aria-hidden + pointer-events:none (gacha.css): a purely decorative layer that must never intercept a
    // tap, and never announce itself — the tab bar's own `aria-selected` already reports the change.
    <div key={tab} className="gc-reel" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
