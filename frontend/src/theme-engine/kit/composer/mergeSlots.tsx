import { Fragment, type ReactNode } from "react";

import type { ComposerSlots } from "./types";

// Composer slot MERGE (D30) — compose SEVERAL addon contributions into the one `ComposerSlots` object a
// variant receives. Until A6 there was exactly one contributor (the inline plan), so DefaultRoot picked a
// single source and a documented limitation stood: a theme-passed `composerSlots` was silently DROPPED
// whenever the plan was inline. The tools/skills menu is the second (rule of three's second sighting, and
// the one that makes the drop a real bug), so the pick becomes a merge and the limitation dies.
//
// Merge semantics, one per slot's own nature:
//   • `controlsStart` — a ROW of controls: sources are FRAGMENTED in argument order (first source = leading
//     edge). Every variant renders the slot inside its own flex row, so ordering is the whole contract.
//   • `overlay`       — positioned SIBLINGS above the composer: sources are STACKED in argument order. They
//     are mutually exclusive at runtime (store/composerOverlay opens one at a time), so DOM order only
//     settles equal-z-index ties; earlier sources paint first.
//
// A `null`-rendering node still counts as a contribution (the plan pill renders null with no plan) — that's
// deliberate: variants gate on the SLOT being populated and collapse the empty wrapper in CSS
// (`.sheet-controls:empty` / `.line-controls:empty`), so the merge never needs to know what a node renders.

/** Fragment a slot's contributions into one node — `undefined` when nothing contributed (so a variant's
 *  `{controlsStart && …}` wrapper gate still works), the bare node when exactly one did. */
function joinSlot(nodes: ReactNode[]): ReactNode {
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  // Index keys are correct here: the composition is positional and fixed for a given set of sources.
  return nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

/** Compose composer addons into one `ComposerSlots`. `undefined` sources are skipped, so a caller can pass
 *  a conditional contribution inline (`inline ? kitPlanComposerSlots : undefined`). */
export function mergeComposerSlots(...sources: (ComposerSlots | undefined)[]): ComposerSlots {
  const controlsStart: ReactNode[] = [];
  const overlay: ReactNode[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.controlsStart !== undefined) controlsStart.push(src.controlsStart);
    if (src.overlay !== undefined) overlay.push(src.overlay);
  }
  return { controlsStart: joinSlot(controlsStart), overlay: joinSlot(overlay) };
}
