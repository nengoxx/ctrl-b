import { useEffect, useState } from "react";

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
export function GachaReel() {
  const tab = useUISlice((s) => s.tab);
  const motion = useUISlice((s) => s.motion);
  const [bootTab] = useState(tab);
  const [everSwitched, setEverSwitched] = useState(false);

  useEffect(() => {
    if (tab !== bootTab) setEverSwitched(true);
  }, [tab, bootTab]);

  // The app's OWN motion axis (`body[data-motion]`), never the OS media query — reduced motion removes the
  // reel entirely rather than shortening it. gacha.css carries the same gate as a CSS belt.
  if (motion === "reduced") return null;
  if (!everSwitched && tab === bootTab) return null;

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
