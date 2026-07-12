// The vapor theme module (Phase 11 v2 / D29). vapor is a normal theme now (no longer "frozen +
// separate") — it owns its whole presentation via `VaporRoot` and stays the DEFAULT until each other
// theme is verified. Its CSS is loaded eagerly (theme/index.css, the default — see §14.6), so
// `loadStyles` is a no-op; its fonts come from index.html. Palette = the named accents (dark/aqua/
// ember) on the `body[data-theme]` axis; no `mode` axis (vapor is dark-only).

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
  // Section-layout capability (D35 §F0): vapor waivers to its native 4-tab set ONLY — a visible,
  // ladder-owned waiver (assimilation ladder, THEME_ENGINE §14.15.3). VaporRoot is bespoke and never
  // consumes the section registry / presets, so its byte-identity under F0 is structural, not incidental;
  // this declaration merely makes the picker coerce any 3-/2-tab pick back to 4-tab while frozen.
  defaultLayout: "4-tab",
  layouts: ["4-tab"],
  loadStyles: () => Promise.resolve(), // vapor.css is eager (the default theme), already loaded
  // Per-theme settings (§14.3) — vapor's hero decoration, auto-rendered in the Appearance picker. The
  // Appearance group renders these between the global Palette and the global Motion/Blur levers. seg →
  // body[data-skyline]/[data-loz] (written by VaporRoot); switch → gates the hero/waveform JSX subtree.
  settings: {
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
