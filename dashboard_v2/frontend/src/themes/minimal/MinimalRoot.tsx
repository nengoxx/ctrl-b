import { useLayoutEffect } from "react";

import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useThemeSetting } from "../../theme-engine/settings";

// minimal's Root (D29 §14.4) — a "reskin" theme, so its presentation IS the Kit scaffold; it only wires
// its per-theme settings into the scaffold. This is the canonical reskin-theme shape: read the settings,
// hand the STRUCTURAL ones to DefaultRoot as props, and apply the COSMETIC ones as attrs/tokens.
//
//  - `hideAppbar` (structural) → DefaultRoot prop (it decides whether to render the app bar).
//  - `density` (cosmetic) → a `body[data-density]` attr that minimal's tokens.css scopes `--density-pad`
//    off — the M3 `VaporRoot` precedent (settings → pre-paint body attr). The scaffold never sees it.

export function MinimalRoot() {
  const hideAppbar = useThemeSetting<boolean>("minimal", "hideAppbar");
  const density = useThemeSetting<string>("minimal", "density");

  // Pre-paint so the spacing is correct on the first frame (no reflow flash). Cleared on unmount so a
  // switched-to skin can't inherit minimal's stale attr (applyBodyAttrs doesn't own this one).
  useLayoutEffect(() => {
    document.body.dataset.density = density;
    return () => {
      delete document.body.dataset.density;
    };
  }, [density]);

  return <DefaultRoot hideAppbar={hideAppbar} />;
}
