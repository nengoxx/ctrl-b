import { useLayoutEffect } from "react";

import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useThemeSetting } from "../../theme-engine/settings";
import { useUISlice } from "../../store/ui";
import { FleetTab } from "./FleetTab";
import { VaporMark } from "./VaporMark";
import type { Skyline } from "./index";

// The vapor theme's Root (D29 §14.7 · D51 V4 — THE PIVOT). Vapor took cosmos's shape: a THIN Root over
// **DefaultRoot**, which now owns every piece of shell plumbing VaporRoot used to hand-roll — the `.kit`
// dvh flex column, the scroller (`#app-scroll`) + its scroll-reset/group-scroll handoff + scrollKeep, the
// keep-mounted `active`-gated section bodies, the lazy-Conf latch with its ErrorBoundary/Suspense fallbacks,
// the `--appbar-h`/`--composer-h` measurements, the Conf-chunk prefetch, the SECTION LAYOUT partition
// (bar/menu/hosted + the hosted-section boot coercion — vapor honors all three presets since D51 V6
// retired its `layouts:["4-tab"]` waiver; nothing coerces a layout any more), and the overlays
// (MiniPlayer/Toasts/Confirm/Prompt/SwUpdate). This file is what stays VAPOR:
//
//   • the Root-pinned **FleetTab** — vapor's bespoke Fleet (hero, skyline, waveform, device rows) is
//     bespoke-by-right under D31/§1.1 (owner §5 Q2: "Fleet stays as-is"), injected through DefaultRoot's
//     `bodies` body-override map exactly as cosmos pins CosmosFleet. Agent/Utils/Conf are the SHARED bodies.
//   • the **brandMark** slot content (`<VaporMark/>` — the gradient-ring lozenge), the kit AppBar's
//     theme-fillable leading mark (D51 §4.1).
//   • `body[data-skyline]` — vapor's decorative horizon axis (a `ThemeDef.settings` value, M3 §14.3), which
//     the KEPT Fleet's CSS keys off. Root-owned like MinimalRoot's `data-density`: written before paint,
//     cleared on unmount so a switched-to skin can't inherit it. (`data-loz` moved to the mark node itself
//     at this slice — the component that renders the lozenge owns its own setting.)
//   • the composer/plan/skin/outlines choices, which are DATA now: vapor declares the four kit axis/seg
//     descriptors in its ThemeDef (index.tsx, R19), so the `sheet` composer + the `pinned` plan resolve
//     through the shared resolvers with no code here.
//
// Gone with the pivot (their legacy copies are deleted in the follow-up commit, D51 §3 V4): vapor's bespoke
// `components/{AppBar,Composer,TabBar}`, the in-tab `PinnedPlan` + its `isVapor` gate in AgentTab, and the
// `body.no-composer` padding hook (the kit shell is an in-flow flex column — an absent composer just reflows
// the column, so there is no bottom-padding bookkeeping to do).
export function VaporRoot() {
  // The global chrome lever (visible/transparent/off/minimal) — read here and handed down, the cosmos
  // shape. Under DefaultRoot vapor gets `minimal` (the floating NavMenu) for free; it used to fall back
  // to `off` because its bespoke bar had no menu.
  const appbarMode = useUISlice((s) => s.appbarMode);

  // vapor's decorative `body[data-skyline]` axis is THEME-OWNED (M3 §14.3): it comes from vapor's
  // `ThemeDef.settings`, written here (not by the core ui store) so the core stops knowing vapor-specific
  // attrs. useLayoutEffect → set before paint (the CSS keys hard off the value, so a missing attr would
  // show both skylines for a frame). Cleared on unmount so a switched-to skin can't inherit a stale attr.
  const skyline = useThemeSetting<Skyline>("vapor", "skyline");
  useLayoutEffect(() => {
    const b = document.body;
    b.dataset.skyline = skyline;
    return () => {
      delete b.dataset.skyline;
    };
  }, [skyline]);

  return (
    <DefaultRoot appbarMode={appbarMode} bodies={{ fleet: FleetTab }} brandMark={<VaporMark />} />
  );
}
