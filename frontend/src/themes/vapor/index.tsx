// The vapor theme module (Phase 11 v2 / D29). vapor is a normal theme now (no longer "frozen +
// separate") — it owns its whole presentation via `VaporRoot`. It is NO LONGER the default (D51 V0 handed
// that to cosmos), but it is still the one EAGER theme: its CSS is statically imported (theme/index.css,
// §14.6) so `loadStyles` is a no-op, and its fonts come from main.tsx. **The lazy flip was DROPPED at
// D51 V6, on measurement, not preference:** vapor's whole eager slice (tokens+vapor+extras+the 10
// @font-face blocks) is 26.5 KB raw / **5.3 KB gzipped** of the built entry CSS after V5's deletions, and
// the woff2 files are already usage-lazy (a browser fetches a face only when text needs it). Codex #3's
// preconditions — an internal @layer wrap, a font loader that awaits faces, a first-paint test on the
// persisted-vapor path — are real NEW MECHANISM for that; "no legacy seams / no mechanism for trivial
// bytes" wins, and vapor is the owner's daily driver, i.e. the path the flip would make SLOWER.
// Palette = the named accents (dark/aqua/ember) on the SHARED `body[data-accent]` axis (D51 V2); no
// `mode` axis (vapor is dark-only).

import { composerSkinSetting, outlinesSetting } from "../../theme-engine/kit/axes";
import { planPlacementSetting } from "../../theme-engine/kit/composer/plan/placement";
import { composerLayoutSetting } from "../../theme-engine/kit/composer/setting";
import type { ThemeDef } from "../../theme-engine/types";
import { VaporRoot } from "./VaporRoot";

// vapor's decorative axes — the values its `settings` (below) carry. Defined here (not in store/ui)
// since they're vapor-specific now: M3 moved them out of the core UI state into `ThemeDef.settings`.
export type Skyline = "city" | "mountains";
export type Loz = "logo" | "ring";

export const vapor: ThemeDef = {
  id: "vapor",
  label: "Vapor",
  Root: VaporRoot,
  palettes: {
    // Swatches = each accent's magenta→violet identity gradient (the `--accent-grad` two-stop, vapor.css).
    accents: [
      { id: "dark", label: "Vapor", swatch: "linear-gradient(135deg, #ff52d4, #a55cff)" },
      { id: "aqua", label: "Aqua", swatch: "linear-gradient(135deg, #5ce6ff, #6e7bff)" },
      { id: "ember", label: "Ember", swatch: "linear-gradient(135deg, #ff8a3d, #ffd75c)" },
    ],
    defaultAccent: "dark",
  },
  // Section-layout capability (D35 §F0). The `layouts: ["4-tab"]` WAIVER IS RETIRED (D51 V6, R13/Codex #11):
  // vapor declares no `layouts` field at all, so — like cosmos and frontier — ALL presets stay on offer (the
  // D35 ideal, "themes default, never restrict"). Nothing vapor-specific ever needed the restriction once the
  // V4 pivot put it on DefaultRoot: `fleet` is on the bar in every preset, so the Root-pinned FleetTab body
  // override is preset-independent, and the one hosted pair (utils→conf) lands in the SHARED ConfTab body,
  // whose vapor CSS died at V5. `defaultLayout` stays `4-tab` (vapor's native shape, and the value the
  // e2e contrast matrix's `bar` is drift-guarded against); 3-/2-tab are real, tested picks now
  // (tests/hooks/useSections.test.ts + e2e/layout.spec.ts drive vapor through both).
  defaultLayout: "4-tab",
  // Eager by RULING (D51 V6 — the lazy flip measured + dropped, see the header): the three sheets are
  // static @imports in theme/index.css, so there is nothing for switchTheme to load.
  loadStyles: () => Promise.resolve(),
  // Per-theme settings (§14.3) — auto-rendered in the Appearance picker, between the global Palette and the
  // global Motion/Blur levers. Two groups:
  //
  //  1. The FOUR SHARED kit axis/seg descriptors (D51 V4 / R19 — the cosmos precedent, themes/cosmos/
  //     index.tsx). Vapor MUST declare them now that it renders under DefaultRoot: undeclared, the resolvers
  //     would silently give it the kit-native defaults (stacked composer, `outline` skin, `inline` plan,
  //     outlines ON) with NO picker rows to change them. Declared, each renders its own Appearance row and
  //     the values below are vapor's real, chosen look.
  //  2. Vapor's own decoration (mark/hero/horizon/waveform): the `loz` seg feeds <VaporMark/> (the kit
  //     AppBar's `brandMark` slot); `skyline` → body[data-skyline] (VaporRoot); the two switches gate the
  //     kept Fleet's hero/waveform JSX subtree.
  settings: {
    // The composer LAYOUT (D31/A3) — vapor adopts the kit `sheet` ("Docked") variant, which IS vapor's own
    // rounded-dock bar rebuilt on the semantic tokens (SheetComposer was ported FROM vapor). Owner ruling
    // D51 §1.3. FIRST so it reads above the theme rows.
    composer: composerLayoutSetting("sheet"),
    // Composer SKIN (D37) — `outline`, the kit-native bordered bar, is the closest of the four to vapor's
    // dock: vapor.css paints `.composer` with a real 1px `--line-2` border + frost + an upward shadow, which
    // is exactly what the base (un-keyed) kit chrome does. The other three all REMOVE that border — glass
    // (borderless + deep elevation), bezel (borderless + lit inset edge), sleek (fully transparent bar) —
    // so any of them would drop a line vapor deliberately draws. No new skin is born here (plan §4.2: one
    // would have to be look-named and offered to every theme, and `outline` already fits).
    composerSkin: composerSkinSetting("outline"),
    // Plan placement (D31/A4) — `pinned`: vapor's plan has always been a collapsed tab hanging at the top of
    // the chat, and the kit's `PinnedPlanPanel` is that same idiom (this is what deletes vapor's in-tab
    // `PinnedPlan` + its `isVapor` gate, D51 hook ⑤).
    planPlacement: planPlacementSetting("pinned"),
    // Outlines axis — ON. Vapor's chat is NOT the borderless look: every chat surface carries a resting
    // border (user bubble 1px teal, bot bubble 1px accent, `.b.sys` dashed, the `.b.cmd` panel + its `$`
    // pre + action-row dividers — vapor.css §CHAT), so the kit's bordered chat chrome is the faithful one.
    outlines: outlinesSetting(true),
    loz: {
      type: "seg",
      label: "App mark",
      desc: "logo · spinning ring",
      options: [
        { val: "logo", label: "Logo" },
        { val: "ring", label: "Ring" },
      ],
      default: "logo",
    },
    heroOn: { type: "switch", label: "Sun & grid", desc: "animated hero scene", default: true },
    skyline: {
      type: "seg",
      label: "Horizon",
      desc: "city · mountains",
      options: [
        { val: "city", label: "City" },
        { val: "mountains", label: "Mountains" },
      ],
      default: "city",
    },
    waveformOn: {
      type: "switch",
      label: "Live waveform",
      desc: "ping graph on hero",
      default: true,
    },
  },
};
