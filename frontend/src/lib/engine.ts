// Engine detection — the frontend's FIRST browser-engine branch. Modeled on the backend's closed
// OS-branch allowlist (ARCHITECTURE §6): a single, greppable predicate, NOT a scattered set of
// userAgent sniffs. The rule mirrors that allowlist's discipline — keep the consumer list SHORT and
// DOCUMENTED, and every consumer keys off `body[data-engine="gecko"]` (a CSS attribute), never a JS
// re-check. Consumers today (THEME_ENGINE §14.11):
//   • cosmos.css `.cosmos-planet::before` — grain `mix-blend-mode: overlay` → plain `normal` at lower
//     alpha (per-frame blend on always-orbiting planets defeats WebRender's tile cache; Gate B 2026-07-15).
//   • (the sheet `[data-settling]` blur-drop was a consumer for a day — tried + reverted, owner eyeball:
//     the frost pop-in at settle read worse than the slide chop. Record: cosmos.css bs-sheet section.)
//
// FEATURE-detect, not UA-parse: `-moz-appearance` is a Gecko-only CSS property, so `CSS.supports`
// answering true is a positive engine signal that can't be spoofed by a UA string and won't drift as
// Chromium/WebKit evolve. Guarded for non-browser envs (vitest's node bootstrap before jsdom, SSR):
// no `CSS` global → not Gecko, no throw.
export const isGecko: boolean =
  typeof CSS !== "undefined" && CSS.supports("-moz-appearance", "none");
