// The gacha tab-REEL "is sweeping" signal (D52 / GACHA_PLAN §6.4 + §10.3). Store-backed via the dep-free
// `createStore` factory (D23), the same shape as `frontierSelection`/`cosmosSelection` — one writer
// (`GachaReel`, which owns the overlay's lifetime) and one reader today (the pickup banner), with no
// prop-drilling between two components that live in different subtrees: the reel is a Root SIBLING of
// `DefaultRoot`, the banner is inside the Fleet body.
//
// WHY THE BANNER NEEDS IT (the §6.4 timer matrix + the §10.3 budget table): the reel is five full-width
// slats sweeping the whole shell, and it fires on the very tab change that reveals the Fleet. "Never
// coincide: the reel with a banner auto-advance" is a ruled line in the GPU budget — so the banner holds
// its timer while the reel runs and cancels any gesture in flight (the overlay is `pointer-events: none`,
// so the banner has to disable ITSELF; nothing else stops a finger mid-sweep).

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let running = false;

/** Mark the reel as sweeping / done. Idempotent — only emits on a real change. */
export function setGachaReelRunning(on: boolean): void {
  if (on !== running) {
    running = on;
    emit();
  }
}

/** Whether the tab reel is mid-sweep. */
export function useGachaReelRunning(): boolean {
  return useStore(() => running);
}
