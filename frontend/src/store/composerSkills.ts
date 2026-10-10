// The composer tools/skills MENU's SKILLS selection (A6) — the ONE-SHOT set of skills ticked for the NEXT
// message. Sits beside `store/composer` (the draft) because it's the same class of thing: composer-local
// input state the send path consumes. Two deliberate deltas from the draft store, both semantic:
//
//   • NOT PERSISTED. A ticked skill is a "this message" decision — surviving a reload (or a PWA relaunch a
//     day later) would silently attach skills to a message the owner never ticked them for.
//   • SPENT ON DISPATCH. `takeComposerSkills()` reads AND clears in one step, so there is no window where a
//     send has gone out but the ticks are still showing. `lib/composer.runComposer` is the only caller —
//     a plain NL send takes them; an explicit `/verb` send CLEARS them without applying (the user routed
//     by hand, so the hand-routing wins).
//
// The menu's OTHER section — which agent — is not here: it is a NAVIGATION door, not a selection — a row
// opens that agent's conversation (`store/chat#openAgentConversation`, D84 §2 R16, the gallery's Talk
// takes the same door). Only the skills are a menu-held selection, and they are one-shot.
//
// Dep-free `createStore` (D23).

import { createStore } from "./createStore";

const NONE: string[] = [];

const { emit, useStore } = createStore();
let skills: string[] = NONE;

/** Tick/untick one skill for the next message. */
export function toggleComposerSkill(skill: string): void {
  skills = skills.includes(skill) ? skills.filter((s) => s !== skill) : [...skills, skill];
  emit();
}

/** Drop the ticks WITHOUT applying them — an explicit `/verb` send routes by hand and wins over the menu,
 *  and the menu's own "clear" row. */
export function clearComposerSkills(): void {
  if (skills.length === 0) return;
  skills = NONE;
  emit();
}

/** Read the ticked skills AND clear them: the send-dispatch chokepoint (a one-shot is spent by its
 *  message). */
export function takeComposerSkills(): string[] {
  const taken = skills;
  if (taken.length === 0) return taken;
  skills = NONE;
  emit();
  return taken;
}

/** Subscribe to the ticked skills. A STABLE reference (createStore's snapshot contract) — replaced whole
 *  on every change. */
export function useComposerSkills(): string[] {
  return useStore(() => skills);
}
