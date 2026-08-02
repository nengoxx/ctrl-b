import type { ComponentType, ReactNode } from "react";

// Composer composition contract (D30). Two orthogonal axes, both theme-selected via DefaultRoot props
// (mirroring the existing `Fleet` injection):
//
//   • STYLE  — the composer VARIANT component (`ComposerVariant`): KitComposer (stacked, default) ·
//              the future SheetComposer (vapor-style peek) · … . All variants share the headless
//              `useComposer()` controller — only markup/style differ — so a new style is a new component,
//              never new logic. Registered in `variants.ts` + selected via the per-theme `composer` setting
//              the `ThemedComposer` resolver reads (D31/§14.14) — NOT a DefaultRoot prop.
//   • ADDONS — optional `ComposerSlots` content composed INTO the chosen variant (slot-based composition,
//              the Radix/Headless-UI pattern — not boolean config flags). The plan pill is the first addon.
//              Selected via `DefaultRoot composerSlots={…}`.
//
// A variant decides WHERE each slot renders (its layout); the theme decides WHAT fills it (the addon). New
// addons add a named slot here — purely additive, no churn to existing variants/themes.

/** Optional content a theme composes into a composer variant. A base theme passes none. */
export interface ComposerSlots {
  /** Start of the controls row, left of mic/send — e.g. the plan pill. */
  controlsStart?: ReactNode;
  /** A positioned sibling above the composer — e.g. the plan sheet peeking from the composer's top edge. */
  overlay?: ReactNode;
  /** The input's PLACEHOLDER copy. Not a slot but a scalar override, and it lives on this object for the
   *  reason the house rule gives (extend the one theme→composer contract with an optional field rather
   *  than growing a second parallel channel beside it). Omitted → each variant's own default, unchanged:
   *  the stacked composer's "How can I help you today?", the sheet/line row's short "Message". gacha is the
   *  first filler (its prototype's `コマンド入力…`, D52 — an extension BEYOND D52's closed list, requested
   *  by the owner at the round-4 eyeball). Merge semantics in `mergeComposerSlots`: last defined wins, and
   *  the theme is the last source DefaultRoot passes. */
  placeholder?: string;
}

/** A composer variant component (the STYLE axis). Receives the theme's chosen slots. */
export type ComposerVariant = ComponentType<ComposerSlots>;
