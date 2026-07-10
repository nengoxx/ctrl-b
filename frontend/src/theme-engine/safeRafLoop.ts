// safeRafLoop — the engine-owned requestAnimationFrame loop that every canvas theme drives its animation
// through. Why it exists: React error boundaries CANNOT catch a throw inside a requestAnimationFrame
// callback — the tick fires outside React's render/commit phase (async), so a faulting canvas/animation frame
// either kills the loop silently or, if it reschedules the next frame before it throws, errors on EVERY frame.
// This helper wraps the tick body in try/catch so a fault degrades gracefully: the loop stops for good, the
// last painted frame stays on screen (the app + theme chrome keep working), and the error is routed to the
// global sink ONCE via reportError() — never once-per-frame. An unguarded `requestAnimationFrame(tick)` loop
// inside a theme is therefore an anti-pattern; THIS is the pattern future canvas themes (frontier is next)
// adopt (§14.15.1-A rider c). See App.tsx item ② — the render-tree boundary explicitly does NOT cover rAF.

export interface SafeRafLoop {
  /** Begin ticking. No-op if already running (never spawns a second, competing loop). */
  start(): void;
  /** Cancel any pending frame and stop. Safe to call when not running (idempotent). */
  stop(): void;
  /** True while a frame is scheduled — flips false on stop(), a `false`-returning tick, or a throwing tick. */
  readonly running: boolean;
}

// reportError is the standard global error sink (WHATWG HTML) — window.onerror + the browser console/devtools
// pick it up. jsdom and older runtimes may not implement it, so feature-detect and fall back to console.error
// (the repo's error-logging idiom — see ThemeProvider / ErrorBoundary).
function reportFault(err: unknown): void {
  if (typeof globalThis.reportError === "function") globalThis.reportError(err);
  else console.error(err);
}

/**
 * A crash-safe rAF loop. `tick` runs inside try/catch every frame; return `false` to stop the loop cleanly
 * (covers "ease until settled" patterns) — any other return (including `undefined`) schedules the next frame.
 * A THROW stops the loop PERMANENTLY (never schedules another frame → no error-per-frame) and reports once,
 * leaving the visual state untouched (the canvas simply freezes on its last frame; the app is unaffected).
 */
export function safeRafLoop(tick: (now: DOMHighResTimeStamp) => boolean | void): SafeRafLoop {
  let id = 0; // pending frame handle (0 = none scheduled)
  let running = false;

  const frame = (now: DOMHighResTimeStamp): void => {
    id = 0; // the browser has consumed this callback; nothing is pending until we reschedule below
    let cont: boolean | void;
    try {
      cont = tick(now);
    } catch (err) {
      // A boundary can't reach here. Stop for good — never reschedule — and degrade gracefully.
      running = false;
      reportFault(err);
      return;
    }
    // A `false` return, or a re-entrant stop() during the tick, ends the loop; anything else keeps it alive.
    if (cont === false || !running) {
      running = false;
      return;
    }
    id = requestAnimationFrame(frame);
  };

  return {
    start(): void {
      if (running) return; // already looping — a second start() must not spawn a parallel loop
      running = true;
      id = requestAnimationFrame(frame);
    },
    stop(): void {
      running = false;
      if (id) cancelAnimationFrame(id);
      id = 0;
    },
    get running(): boolean {
      return running;
    },
  };
}
