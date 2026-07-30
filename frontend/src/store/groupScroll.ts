// Transient scroll-handoff store (D35 §F0) — the one-hop channel that carries "after you land on the host
// section, scroll to (and expand) this group" from `useSections.navigate` (the nav chokepoint, which sets
// it when it coerces a hosted-section navigation to its host) to the host body (ConfTab, which consumes +
// clears it). A dep-free external store on the shared `createStore` binding (D23), same shape as
// `store/collapse`. It is TRANSIENT by design: never persisted, never synced — it lives only for the tick
// between a coerced navigate and the host's scroll effect. `target` is a DOM element id (a ConfGroup id).

import { createStore } from "./createStore";
import { setUI } from "./ui";

const { emit, useStore } = createStore();
let target: string | null = null;

/** Arm the handoff: after the host section mounts, scroll to (and expand) the group with this DOM id. */
export function setGroupScrollTarget(id: string): void {
  target = id;
  emit();
}

/** Clear the handoff once consumed (or if abandoned). No-op emit when already clear. */
export function clearGroupScrollTarget(): void {
  if (target === null) return;
  target = null;
  emit();
}

/** Deep-link to a Conf group: land on the Conf tab and arm the handoff, so the tab expands + scrolls to
 *  that group as it mounts. The same two calls `useSections.navigate` makes when it coerces a hosted
 *  navigation — named once so a link INTO a settings group (the chat's created-automation card) is not a
 *  second, hand-rolled version of the routing that already exists. Not a router: `setUI` is the only
 *  navigation this app has. */
export function openConfGroup(id: string): void {
  setUI({ tab: "conf" });
  setGroupScrollTarget(id);
}

/** Non-reactive read — for effects that must PEEK the pending target without subscribing (DefaultRoot's
 *  scroll-reset skips its `scrollTo(0,0)` when a target is pending, read via this getter, not a hook). */
export function getGroupScrollTarget(): string | null {
  return target;
}

/** Reactive subscription — the host body (ConfTab) watches this to run its expand+scroll effect. */
export function useGroupScrollTarget(): string | null {
  return useStore(() => target);
}
