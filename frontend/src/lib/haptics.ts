// DECORATIVE HAPTICS — the one `navigator.vibrate` call site (lifted from `useMicGesture`, Phase 24 S11,
// so the call surfaces buzz through the same guard instead of a second copy).

/** Decorative haptics only (R69 §7 [V] / risk 3): on Firefox for Android `navigator.vibrate()` RETURNS
 *  TRUE and does nothing, and there is no feature detection that can tell — so every buzz here strictly
 *  accompanies a state change the UI has already painted, and the return value is never consulted. */
export function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no Vibration API — the visible state change is the real signal */
  }
}
