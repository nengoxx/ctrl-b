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
// …AND THE TAKE STASHES WHAT IT SPENT (review round C2, the D70 §8.3a addendum's amended shape). Arming an
// agent previews their art on the chat surface (the backdrop reads this store), and a one-shot spent at
// DISPATCH collapsed that preview at the send moment: the armed message is then answered by the armed
// agent while the surface paints whoever the ladder resolves to — an ordinary thread carries no pin, so it
// paints the DEFAULT, for exactly the turn the preview was promising. The pick is therefore not dropped but
// MOVED: `spent` holds it while the message it belongs to is in flight, and `runComposer` releases it when
// that send settles. One-shot is unchanged as a routing rule — `spent` arms nothing and rides no wire; it
// is only the answer to "whose turn is on screen right now". The stash is part of the TAKE for the reason
// the take exists at all: a window where the pick is neither armed nor held is a frame of the wrong face.
//
// THE HOLD IS TOKEN-OWNED (fix-wave round 2 — Maya and the architecture lens converged blind on the
// value-equality guard): every stash bumps a generation and the release names the generation it was
// given, so an older send settling can never release a newer send's hold — including two sends armed at
// the SAME agent, which a value compare cannot tell apart. Three consequences, each a rule:
//   • the take stashes ONLY when the caller says this send owns the turn (`stash` — a D41 steer's POST
//     settles at the 202, long before the steered reply, so a steer must never hold the surface);
//   • a take that spends NOTHING preserves a live hold (stash what it SPENT — an unarmed steer
//     dispatched mid-flight must not repaint the armed turn under itself);
//   • `clearComposerScope` no longer touches `spent` (amending this header's first shape): the menu's
//     clear row means "un-arm the NEXT message", and a hold belongs to a send already in flight — only
//     that send's settle releases it. The `/verb` path needs nothing more either: its clear drops the
//     arming, and any live hold still dies at its own send's settle.
//
// The agent is TRI-STATE, not nullable (Codex, round 2). "Nothing armed" and "armed at the configured
// default" are different messages once a sticky `/agent <name>` is in play: with only `string | null`,
// picking the menu's default row was indistinguishable from never opening the menu, so the send fell back
// to the sticky agent while the menu showed "default" checked. So:
//
//   • `undefined` — UNTOUCHED. The send falls back to the sticky `/agent` pick (or the server default).
//   • `null`      — explicitly armed "the configured default": it OVERRIDES a sticky pick for this one
//                   message. On the wire that is `agent: null`, which the chat endpoint already accepts
//                   as "no explicit agent" (it then resolves its own default — zero backend change).
//   • a string    — an armed specialist.
//
// Dep-free `createStore` (D23).

import { createStore } from "./createStore";

export interface ComposerScope {
  /** One-shot agent for the next message — tri-state: `undefined` untouched · `null` explicitly the
   *  configured default · a name = that specialist. See the header. */
  agent: string | null | undefined;
  /** Skills armed for the next message (the menu's ticks). Empty = none. */
  skills: string[];
  /** The agent pick an IN-FLIGHT applied send consumed — the same tri-state, one step later in its life
   *  (`undefined` = nothing held). Read through `previewAgent` and by nobody else: it arms no send and
   *  reaches no wire. Stashed by a `takeComposerScope(true)`, released by `releaseSpent` with the hold
   *  token that take returned, when that send settles. */
  spent: string | null | undefined;
}

/** What `takeComposerScope` hands the dispatch: the arming it consumed, plus the HOLD TOKEN when the
 *  take stashed the pick (`null` = nothing stashed — nothing to release). Deliberately NOT the scope
 *  shape: `spent` never rides along, because by the time a caller could read it it may be someone
 *  else's live hold (review sweep). */
export interface TakenScope {
  agent: string | null | undefined;
  skills: string[];
  hold: number | null;
}

const EMPTY: ComposerScope = { agent: undefined, skills: [], spent: undefined };

const { emit, useStore } = createStore();
let scope: ComposerScope = EMPTY;
/** The hold generation — bumped by every stash, named by every release. Module state beside `scope`
 *  for the reason `scope` is: one writer file, no persistence. */
let holdSeq = 0;

/** Arm the one-shot agent for the next message — a name, or `null` for "the configured default, even if
 *  a sticky `/agent` says otherwise". Un-arming entirely is `clearComposerScope` (the menu's clear row). */
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

/** Drop the arming WITHOUT applying it — an explicit `/verb` send routes by hand and wins over the menu,
 *  and the menu's own "clear" row. The HELD pick stays (fix-wave round 2, amending this function's first
 *  shape): a hold belongs to a send already in flight, and "clear" is about the NEXT message — stealing
 *  the hold repainted the surface under a turn the gesture had nothing to do with. Only the owning
 *  send's settle releases it (`releaseSpent`). */
export function clearComposerScope(): void {
  if (scope.agent === undefined && scope.skills.length === 0) return;
  scope = { ...scope, agent: undefined, skills: [] };
  emit();
}

/** Read the armed scope AND clear it: the send-dispatch chokepoint (a one-shot is spent by its message).
 *  With `stash` true the agent pick MOVES to `spent` in the same step — see the header — and the
 *  returned `hold` names the generation `releaseSpent` must be given when that send settles. `stash`
 *  false is the caller saying this send does NOT own the turn (a D41 steer: its POST settles at the
 *  202, before the steered reply exists) — the pick is consumed for routing but holds nothing, and a
 *  hold already live is left standing. A take that spends no pick stashes nothing either way (stash
 *  what it SPENT). The skills never stash: nothing reads them after dispatch. */
export function takeComposerScope(stash: boolean): TakenScope {
  const taken = scope;
  const stashing = stash && taken.agent !== undefined;
  scope = { agent: undefined, skills: [], spent: stashing ? taken.agent : scope.spent };
  if (stashing) holdSeq++;
  emit();
  return { agent: taken.agent, skills: taken.skills, hold: stashing ? holdSeq : null };
}

/** Release the held pick — but only for the send that owns it: a `hold` older than the last stash is a
 *  send whose pick was already superseded, and its settle must not take the newer send's hold down.
 *  `runComposer`'s `finally` is the only caller: a refused or failed send reverts the surface
 *  immediately, a streaming one holds it until `done`. */
export function releaseSpent(hold: number): void {
  if (hold !== holdSeq || scope.spent === undefined) return;
  scope = { ...scope, spent: undefined };
  emit();
}

/** WHOSE face the chat surface previews right now — the pick at whichever stage it is in: armed, else
 *  held for the message it was spent on, else `undefined` = nobody (the routing ladder's turn). One
 *  expression, exported from beside the two fields it reads (review F4), so the arm → send → settle
 *  sequence cannot fall between them and no consumer grows its own `??` chain. */
export function previewAgent(s: ComposerScope): string | null | undefined {
  return s.agent !== undefined ? s.agent : s.spent;
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
