import type { ComposerSlots } from "../types";
import { ToolsMenuSheet } from "./ToolsMenuSheet";
import { ToolsMenuTrigger } from "./ToolsMenuTrigger";

// The tools/skills MENU addon (A6), packaged as composer slots (D30) exactly like `kitPlanComposerSlots`.
// DefaultRoot merges it into every composer variant (`mergeComposerSlots`), so it's Kit chrome, not a
// per-theme opt-in — vapor keeps its frozen composer (D7). The nodes are static: trigger + panel
// self-subscribe to `store/composerOverlay` (open state) and `store/composerScope` (the arming), so the
// slot identities stay stable across renders and dropping them in needs no wiring.
export const kitToolsMenuSlots: ComposerSlots = {
  controlsStart: <ToolsMenuTrigger />,
  overlay: <ToolsMenuSheet />,
};
