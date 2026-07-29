// The composer tools/skills MENU selection (A6) — the ONE-SHOT scope armed for the NEXT message: which
// agent it runs on and which skills are active for it. Sits beside `store/composer` (the draft) because
// it's the same class of thing: composer-local input state the send path consumes. Two deliberate deltas
// from the draft store, both semantic:
//
//   • NOT PERSISTED. An armed one-shot is a "this message" decision — surviving a reload (or a PWA
//     relaunch a day later) would silently re-point a message the owner never armed.
//   • SPENT ON DISPATCH. `takeComposerScope()` reads AND clears in one step, so there is no window where a
//     send has gone out but the arming is still showing. `lib/composer.runComposer` is the only caller —
//     a plain NL send takes it; an explicit `/verb` send CLEARS it without applying (the user routed by
//     hand, so the hand-routing wins).
//
// `agent: null` = the configured default agent (the menu's "default" row) — the same null-means-default
// convention as `sessionAgent`/`sessionMode` in store/chat. Dep-free `createStore` (D23).

import { createStore } from "./createStore";

export interface ComposerScope {
  /** One-shot agent for the next message; `null` = the configured default. */
  agent: string | null;
  /** Skills armed for the next message (the menu's ticks). Empty = none. */
  skills: string[];
}

const EMPTY: ComposerScope = { agent: null, skills: [] };

const { emit, useStore } = createStore();
let scope: ComposerScope = EMPTY;

/** Arm (or, with `null`, un-arm) the one-shot agent for the next message. */
export function setScopeAgent(agent: string | null): void {
  if (scope.agent === agent) return;
  scope = { ...scope, agent };
  emit();
}

/** Tick/untick one skill for the next message. */
export function toggleScopeSkill(skill: string): void {
  const on = scope.skills.includes(skill);
  scope = {
    ...scope,
    skills: on ? scope.skills.filter((s) => s !== skill) : [...scope.skills, skill],
  };
  emit();
}

/** Drop the arming WITHOUT applying it — an explicit `/verb` send routes by hand and wins over the menu. */
export function clearComposerScope(): void {
  if (scope === EMPTY) return;
  scope = EMPTY;
  emit();
}

/** Read the armed scope AND clear it: the send-dispatch chokepoint (a one-shot is spent by its message). */
export function takeComposerScope(): ComposerScope {
  const taken = scope;
  clearComposerScope();
  return taken;
}

/** Read the armed scope imperatively (non-reactive, no clear) — for callers outside render. */
export function getComposerScope(): ComposerScope {
  return scope;
}

/** Subscribe to the armed scope. A STABLE reference (createStore's snapshot contract) — replaced whole
 *  on every change, so consumers may read `.agent`/`.skills` straight off it. */
export function useComposerScope(): ComposerScope {
  return useStore(() => scope);
}
