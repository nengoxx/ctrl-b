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
//   • `placeholder`   — a SCALAR override, so there is nothing to compose: the LAST source that defines it
//     wins, which is the theme (DefaultRoot passes its `composerSlots` last). Undefined everywhere leaves
//     it undefined, and each variant falls back to its own copy.
//
// A `null`-rendering node still counts as a contribution (the plan pill renders null with no plan) — that's
// deliberate: variants gate on the SLOT being populated and collapse the empty wrapper in CSS
// (`.sheet-controls:empty` / `.line-controls:empty`), so the merge never needs to know what a node renders.

/** One contribution: its node, tagged with the ARGUMENT position of the source it came from. */
type Contribution = [at: number, node: ReactNode];

/** Fragment a slot's contributions into one node — `undefined` when nothing contributed (so a variant's
 *  `{controlsStart && …}` wrapper gate still works), otherwise ALWAYS the same shape: a keyed list.
 *
 *  One shape for one and for many (Codex, round 2): returning the bare node for a single contributor made
 *  the slot's element TYPE depend on how many sources happened to contribute, so a change that alters the
 *  count — flipping the plan placement, swapping a theme — remounted the SURVIVING contributions (React
 *  reconciles a fragment against a bare node as a replacement, blowing away their state). Nothing is lost
 *  by always fragmenting: a Fragment renders no DOM, so the variants' `{controlsStart && …}` gates and the
 *  `:empty` collapse rules see exactly what they saw before.
 *
 *  The key is the SOURCE's argument position, not the index in the filtered list — that's what stays put
 *  when a source drops out (menu 0 · plan 1 · theme 2 → menu 0 · theme 2, and both keep their instances). */
function joinSlot(nodes: Contribution[]): ReactNode {
  if (nodes.length === 0) return undefined;
  return nodes.map(([at, n]) => <Fragment key={at}>{n}</Fragment>);
}

/** Compose composer addons into one `ComposerSlots`. `undefined` sources are skipped, so a caller can pass
 *  a conditional contribution inline (`inline ? kitPlanComposerSlots : undefined`). */
export function mergeComposerSlots(...sources: (ComposerSlots | undefined)[]): ComposerSlots {
  const controlsStart: Contribution[] = [];
  const overlay: Contribution[] = [];
  let placeholder: string | undefined;
  sources.forEach((src, at) => {
    if (!src) return;
    if (src.controlsStart !== undefined) controlsStart.push([at, src.controlsStart]);
    if (src.overlay !== undefined) overlay.push([at, src.overlay]);
    if (src.placeholder !== undefined) placeholder = src.placeholder;
  });
  return { controlsStart: joinSlot(controlsStart), overlay: joinSlot(overlay), placeholder };
}
