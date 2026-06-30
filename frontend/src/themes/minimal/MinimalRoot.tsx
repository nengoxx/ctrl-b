import { useLayoutEffect } from "react";

import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useThemeSetting } from "../../theme-engine/settings";
import { useUISlice } from "../../store/ui";

// minimal's Root (D29 §14.4) — a "reskin" theme, so its presentation IS the Kit scaffold; it only wires
// its settings into the scaffold. This is the canonical reskin-theme shape: read the settings, hand the
// STRUCTURAL ones to DefaultRoot as props, and apply the COSMETIC ones as attrs/tokens.
//
//  - `appbarMode` (structural) → the GLOBAL `ui.appbarMode` lever (visible/off/minimal; all themes) → DefaultRoot prop.
//  - `density` (cosmetic, per-theme) → a `body[data-density]` attr minimal's tokens.css scopes
//    `--density-pad` off — the M3 `VaporRoot` precedent (settings → pre-paint body attr).

export function MinimalRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  const density = useThemeSetting<string>("minimal", "density");

  // Pre-paint so the spacing is correct on the first frame (no reflow flash). Cleared on unmount so a
  // switched-to skin can't inherit minimal's stale attr (applyBodyAttrs doesn't own this one).
  useLayoutEffect(() => {
    document.body.dataset.density = density;
    return () => {
      delete document.body.dataset.density;
    };
  }, [density]);

  return <DefaultRoot appbarMode={appbarMode} />;
}
