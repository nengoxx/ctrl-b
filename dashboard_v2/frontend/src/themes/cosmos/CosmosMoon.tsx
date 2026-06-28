import { useEffect, useRef } from "react";

import { useThemeSetting } from "../../theme-engine/settings";
import { useSections } from "../../hooks/useSections";
import { useUISlice } from "../../store/ui";
import { setCosmosDive } from "../../store/cosmosDive";
import { DIVE_MS } from "./camera";

// The central moon — the orbital fleet's core body, also the "open the Agent chat" affordance. Tapping it
// DIVES the camera into the moon (a center-zoom flourish; reuses the planet zoom machinery) while the orbital
// stage fades, then navigates to the Agent tab — a fast path, especially in minimal-nav where there's no tab
// bar. Reduced-motion skips the dive and navigates immediately. Deselect is NOT the moon's job anymore —
// that's an empty-space tap (the moon's old deselect was a pre-empty-tap workaround). Navigation always goes
// through the `useSections` chokepoint, never `setUI({tab})` directly. Two owner-requested variants, switched
// by the
// `moonStyle` per-theme setting (auto-rendered in Conf · Appearance) so they can be compared live:
//
//  • "cutout"  — the prototype's flat 2.5D white coin with a SEE-THROUGH "D" hole (even-odd path). The
//                accent corona (the .cosmos-core::before disc) glows through the hole. drop-shadow for lift.
//  • "carved"  — the current matte moon ball (kept verbatim in CSS), with the same "D" ENGRAVED into it.
//                The carved look = an SVG inner-shadow filter (CSS drop-shadow can't do inset; this is the
//                canonical debossed recipe: invert the alpha, blur+offset, flood, composite back over) plus
//                a light lower-lip drop-shadow in CSS — the same emboss logic the planet glyphs use.
//
// Both share one D geometry (the prototype's path) so there's a single source of truth. SVG ids are
// fixed/unique (only one moon renders at a time → no collision).

// The prototype coin: outer disc + inner "D", `fill-rule=evenodd` → the D is a hole (cutout variant).
const COIN_PATH =
  "M47,0 A47,47 0 1,0 47,94 A47,47 0 1,0 47,0 Z M44,19 L44,75 Q44,80.5 49.5,79 A38,33 0 0,0 49.5,15 Q44,13.5 44,19 Z";
// Just the inner "D" — drawn ON the ball as an engraved groove (carved variant).
const D_PATH = "M44,19 L44,75 Q44,80.5 49.5,79 A38,33 0 0,0 49.5,15 Q44,13.5 44,19 Z";

export function CosmosMoon() {
  const carved = useThemeSetting<string>("cosmos", "moonStyle") === "carved";
  const { navigate } = useSections();
  const motion = useUISlice((s) => s.motion);
  // Hold the pending dive→navigate timer so unmount can clear it (and reset the dive flag) if the moon goes
  // away mid-dive — e.g. the user navigates elsewhere before the timer fires.
  const diveTimer = useRef(0);
  useEffect(
    () => () => {
      if (diveTimer.current) clearTimeout(diveTimer.current);
      setCosmosDive(false);
    },
    [],
  );

  const onTap = () => {
    if (motion !== "full") {
      navigate("agent"); // reduced motion: no dive flourish, jump straight to chat
      return;
    }
    setCosmosDive(true); // CosmosFleet eases the camera into the moon + fades the stage
    diveTimer.current = window.setTimeout(() => {
      navigate("agent");
      setCosmosDive(false);
    }, DIVE_MS);
  };

  return (
    <button
      type="button"
      className={"cosmos-core " + (carved ? "carved" : "cutout")}
      aria-label="Open Agent chat"
      onClick={onTap}
    >
      {carved ? (
        <svg className="cosmos-carve" viewBox="0 0 94 94" aria-hidden="true">
          <defs>
            {/* Inner-shadow ("debossed") filter — dark recess at the top edge = light from above. */}
            <filter id="cosmosCarve" x="-30%" y="-30%" width="160%" height="160%">
              <feComponentTransfer in="SourceAlpha">
                <feFuncA type="table" tableValues="1 0" />
              </feComponentTransfer>
              <feGaussianBlur stdDeviation="1.4" />
              <feOffset dx="0" dy="1.2" result="off" />
              <feFlood floodColor="#000000" floodOpacity="0.55" result="col" />
              <feComposite in="col" in2="off" operator="in" />
              <feComposite in2="SourceAlpha" operator="in" />
              <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode />
              </feMerge>
            </filter>
          </defs>
          {/* A grey a shade darker than the ball mid-tone = the recessed floor; the filter carves its edge. */}
          <path d={D_PATH} fill="#86848f" filter="url(#cosmosCarve)" />
        </svg>
      ) : (
        <svg className="cosmos-coin" viewBox="0 0 94 94" aria-hidden="true">
          <defs>
            <linearGradient id="cosmosCoinGrad" x1="0" y1="0" x2="0.45" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.5" stopColor="#f1f1f5" />
              <stop offset="1" stopColor="#d6d6dd" />
            </linearGradient>
          </defs>
          <path d={COIN_PATH} fill="url(#cosmosCoinGrad)" fillRule="evenodd" />
        </svg>
      )}
    </button>
  );
}
