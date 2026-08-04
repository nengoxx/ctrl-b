import { useEffect, useMemo, useState } from "react";

import { setGachaReelRunning } from "../../store/gachaReel";
import { useUISlice } from "../../store/ui";
import { reelFigureArt } from "./roster";
import { useGachaRoster } from "./useGachaRoster";

// The gacha TAB REEL (M1) — five vertical slats sweeping top→bottom over the whole shell on every section
// change, plus the character FIGURE that rides them (D52 / GACHA_PLAN §10.1; G0 built the mechanism, G4
// added the figure).
//
// M1 IS THE PRIMARY EFFECT and must be complete without View Transitions: the plan's standing posture is
// that M2 (the root cross-fade under the reel) is progressive enhancement, droppable without ceremony. So
// this component depends on nothing but the tab value.
//
// ── THE START, and why there is no hook at the nav chokepoint ────────────────────────────────────────────
// The prototype fires its reel just BEFORE mutating the tab, but its own no-VT path runs both in the same
// pre-paint task — behaviorally identical to a PASSIVE same-frame start (the research verdict that dropped
// the planned pre-navigation kit hook). So this subscribes to the same `useUISlice(s => s.tab)` binding the
// section bodies use: one store notification, one commit, one paint — the sweep and the content swap land
// together, with no effect and no `useLayoutEffect` in the path.
//
// `key={tab}` REMOUNTS the overlay on every change, which is the React-clean equivalent of the prototype's
// `void reel.offsetWidth` reflow poke: a CSS animation on a freshly mounted node always starts at frame 0,
// so hammering the tab bar restarts the sweep instead of leaving a half-finished one running.
//
// ── THE BOOT LATCH ───────────────────────────────────────────────────────────────────────────────────────
// A reel on app boot (or on every theme switch INTO gacha, which remounts this Root) would be a transition
// announcing nothing. `bootTab` is the tab at mount; the overlay renders only once the user has actually
// moved off it. `everSwitched` then makes that sticky, so returning to the boot tab later still reels.
// State, not a ref: the first switch is armed by the render-time comparison — the effect only records the
// fact — so the reel still starts in the SAME commit as the tab change.
//
// The MOTION GATE is the outer component, and the latch lives in a child it mounts (Codex G0 #5). Keeping
// both in one component leaked a reel: tab changes made under reduced motion still armed the latch, so the
// moment the owner turned motion back ON — an appearance toggle, not a navigation — the overlay mounted and
// swept for a tab switch that had happened minutes earlier. Unmounting the latch with the gate means motion
// coming back re-boots it against the CURRENT tab: nothing animates until the user actually navigates.
export function GachaReel() {
  // The app's OWN motion axis (`body[data-motion]`), never the OS media query — reduced motion removes the
  // reel entirely rather than shortening it. gacha.css carries the same gate as a CSS belt.
  const motion = useUISlice((s) => s.motion);
  if (motion === "reduced") return null;
  return <GachaReelSweep />;
}

/** The sweep's total on-screen life: the 520 ms slat animation plus the last slat's 120 ms stagger (the
 *  `.gc-reel` block in gacha.css). Kept beside the component that mounts the node rather than in the store,
 *  because it is a property of THIS animation — a second reel-shaped effect would bring its own. */
const REEL_TOTAL_MS = 640;

/** The identity of a piece of art FOR THE FAILURE LATCH: which file, and which bytes of it. Owner media
 *  is mutable in place, so the URL alone would keep a repaired file latched (Codex F6); bundled art is
 *  content-hashed and carries no revision, which is correct — it cannot change under a running app. */
function artKey(art: { url: string; rev?: string }): string {
  return `${art.url}\u0000${art.rev ?? ""}`;
}

function GachaReelSweep() {
  const tab = useUISlice((s) => s.tab);
  // The FIGURE's art (G4), through the theme's ONE art resolver — a roster `reel_figure:` pin, else the
  // owner's `media/gacha/reel/` cutout, else the first bundled entry carrying one, else nothing at all
  // (`reelFigureArt`, §5.2). `null` is a first-class outcome, not a defect: the reel must be complete
  // WITHOUT the figure, so this is a plain conditional render.
  // MEMOISED on the roster: the ladder builds a fresh object for the bundled rung, so without this the
  // warm-up effect below would see a new-but-equal `figure` every render and re-fetch on each one.
  const roster = useGachaRoster();
  const figureArt = useMemo(() => reelFigureArt(roster), [roster]);
  // `perf: lite` DROPS the figure — the same call gacha.css makes (`body[data-perf="lite"] .gc-reel-figure`),
  // but made HERE as well, because CSS can only hide the node: the component would still warm the image and
  // mount an element the owner asked not to pay for. The gate is read from the store rather than the body
  // attribute so it re-renders when the Appearance switch flips (Codex G4 F2b).
  const perf = useUISlice((s) => s.perf);
  const [bootTab] = useState(tab);
  const [everSwitched, setEverSwitched] = useState(false);
  // The DEGRADATION LATCH: a cutout that cannot be fetched or decoded (a corrupt drop, a pruned asset) would
  // otherwise mount a broken <img> and animate it — the sweep would carry a torn icon across the screen. Once
  // the image is known bad the reel runs on its slats alone, which is the same complete effect a roster with
  // no cutout already gives (Codex G4 F2a).
  //
  // ART-SCOPED, which is the G5 carry (the G4 Codex confirm note): the latch was a boolean while the art was
  // a module constant that could not change under it. Now the art comes from the media index, so a boolean
  // would be a TRAP — the owner fixes a broken cutout and the theme stays figure-less until a reload,
  // because a fact about the OLD file is still latched.
  //
  // Keying on the URL alone was only HALF the fix (Codex F6): the owner's usual repair is to overwrite
  // `cut.webp` IN PLACE, which changes nothing about the URL — and the URL must stay stable anyway, or the
  // SW's media cache would miss on every poll. So the key is the index's (url, revision) pair: replacing
  // the bytes clears the latch, while the file that is actually broken is never retried.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const figure =
    figureArt !== null && perf !== "lite" && artKey(figureArt) !== failedKey ? figureArt : null;
  // Both PRIMITIVES, and both are what the warm-up below depends on (Codex W5): a refetch that returns
  // an equal-but-new listing rebuilds the roster object, so depending on `figure` itself would re-warm
  // art that did not change. url + revision is the identity that actually matters.
  const figureKey = figure === null ? null : artKey(figure);
  const figureUrl = figure === null ? null : figure.url;

  useEffect(() => {
    if (tab !== bootTab) setEverSwitched(true);
  }, [tab, bootTab]);

  // WARM the figure once, at mount. The overlay only exists for the ~640 ms of a sweep, so without this the
  // very FIRST tab change would fetch and decode a fresh image inside the animation it is supposed to be
  // riding — the one sweep that shows an empty reel. One request, no DOM, cache-served from then on
  // (`key={tab}` remounts the <img> every sweep, which is exactly what a warm cache is for).
  //
  // The warm-up doubles as the PROBE: it is the one fetch that happens outside a sweep, so a failure here
  // trips the latch before the first reel ever runs. The `Image` is retained by this effect's cleanup so it
  // cannot be collected between `src` and the event that would report the failure.
  //
  // Keyed on the art's IDENTITY STRING, not the resolved object: the art now arrives from a query, and a
  // refetch that returns the same listing would re-run a whole warm-up on a new-but-equal object.
  useEffect(() => {
    if (figureUrl === null || figureKey === null) return;
    const warm = new Image();
    warm.onerror = () => setFailedKey(figureKey);
    warm.src = figureUrl;
    return () => {
      warm.onerror = null;
    };
  }, [figureKey, figureUrl]);

  const sweeping = everSwitched || tab !== bootTab;

  // Publish the sweep to the rest of the theme (G1): the pickup banner holds its auto-advance and cancels
  // any gesture while the slats are over the screen (§6.4 / the §10.3 "never coincide" line). Keyed on
  // `tab` as well as `sweeping`, so a second switch DURING a sweep re-arms the window from zero — the same
  // restart the `key={tab}` remount gives the animation itself. Both the timer and the flag are cleared on
  // unmount, which is also the reduced-motion and theme-switch path (the §10.5 cleanup ledger).
  useEffect(() => {
    if (!sweeping) return;
    setGachaReelRunning(true);
    const t = setTimeout(() => setGachaReelRunning(false), REEL_TOTAL_MS);
    return () => {
      clearTimeout(t);
      setGachaReelRunning(false);
    };
  }, [tab, sweeping]);

  if (!sweeping) return null;

  return (
    // aria-hidden + pointer-events:none (gacha.css): a purely decorative layer that must never intercept a
    // tap, and never announce itself — the tab bar's own `aria-selected` already reports the change.
    <div key={tab} className="gc-reel" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
      {/* AFTER the slats, as the prototype has it (index.html:42) — the figure rides ON the sweep, so
          paint order alone puts it above them; no z-index inside the overlay. `alt=""` is belt-and-braces
          under an `aria-hidden` parent, and the glow is BAKED INTO the asset (§10.1 rider: a static
          `drop-shadow()` on a large moving image re-rasterizes per frame on Gecko).
          `onError` is the LAST line of the degradation latch, not interactivity: the warm-up normally catches
          a bad asset first, but a cache that goes bad afterwards is reported only here. */}
      {figure && (
        <img
          className="gc-reel-figure"
          src={figure.url}
          alt=""
          decoding="async"
          onError={() => setFailedKey(artKey(figure))}
        />
      )}
    </div>
  );
}
