import { useEffect, useRef } from "react";

import { useUISlice } from "../../store/ui";
import { useThemeSetting } from "../../theme-engine/settings";
import { speedMultiplier } from "./motion";

// The cosmos starfield (C1) — a fixed, full-viewport canvas of twinkling stars behind the see-through Kit
// shell (cosmos.css positions it at z 0). Ported from prototypes/.../cosmos.html (star params + the
// `a + sin(t·tw+ph)·0.18` twinkle), wrapped in the same perf discipline as Waveform (§14.11): dpr capped
// at 2, viewport-sized backing store + explicit CSS px size (resized on window/visualViewport 'resize'),
// ~30fps cap, no per-frame layout/style reads.
//
// Two differences from Waveform: (1) it's a PERSISTENT full-screen layer (mounted once at CosmosRoot,
// survives tab switches), so it pauses on `document.hidden` rather than IntersectionObserver; (2) animation
// runs only when the GLOBAL `ui.motion` is "full" (reduced-motion always wins for a11y), at the
// `motionSpeed` tempo (motion.ts). When paused it paints ONE static base-alpha frame (stars still visible,
// just still). `animate`/tempo are read through refs so toggling a setting re-arms the loop WITHOUT
// regenerating (reshuffling) the star field.
export function CosmosStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motion = useUISlice((s) => s.motion);
  const speed = useThemeSetting<string>("cosmos", "motionSpeed");
  // Gated by the GLOBAL Motion lever only (the per-theme orbitalMotion switch was redundant with it and was
  // removed — see index.tsx). Reduced-motion always wins for a11y.
  const animate = motion === "full";

  // Live values the rAF reads each frame — so a tempo change is smooth and an on/off toggle doesn't
  // re-run the setup effect (which would regenerate the random star field).
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const multRef = useRef(1);
  multRef.current = speedMultiplier(speed);

  // start/stop/repaint published by the setup effect, driven by the [animate] effect below.
  const ctrl = useRef<{ start: () => void; stop: () => void; repaint: () => void } | null>(null);

  // Setup: runs ONCE (mount). Owns the canvas, the star field, and the loop machinery.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const getDpr = () => Math.min(window.devicePixelRatio || 1, 2); // read fresh (desktop browser zoom changes it)
    const FRAME_MS = 1000 / 30; // ~30fps — twinkle is slow, reads smooth, halves frame work vs vsync
    // Positions are NORMALIZED [0,1] (scaled by w/h at paint time) so a resize REMAPS the field instead of
    // regenerating it — the Android URL bar sliding during scroll (a height-only change) never reshuffles
    // the sky. Radius is absolute (device px).
    type Star = { nx: number; ny: number; r: number; a: number; tw: number; ph: number };
    let stars: Star[] = [];
    let w = 0; // backing-store px (CSS px × dpr); drawn in device px (no setTransform)
    let h = 0;
    let genW = -1; // viewport CSS width the field was last generated at — regenerate only when WIDTH changes
    let raf = 0;
    let running = false;
    let last = 0;
    let color = "#ffffff";

    // --star is a token (swappable later for an accent/picker option); constant in C1, so read ONCE at
    // setup (below), never per frame (efficiency). NOTE: a future star-color setting must call this from a
    // reactive path (effect dep), not rely on this one-time read.
    function readColor() {
      color = getComputedStyle(canvas!).getPropertyValue("--star").trim() || "#ffffff";
    }
    // Backing store + EXPLICIT CSS pixel size. A <canvas> is a REPLACED element, so `position:fixed; inset:0`
    // does NOT stretch it — without an explicit CSS size it renders at its intrinsic (attribute) size in CSS
    // px = cssW×dpr, overflowing on dpr>1 screens (Android) so only the left 1/dpr is on-screen (sparse +
    // left-shifted). Setting style width/height to the viewport (the prototype's `cv.style.width`) makes the
    // backing store map 1:1 to the screen at every dpr. (dpr=1 desktop coincidentally matched, hence "fine on PC".)
    function resizeCanvas() {
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      const d = getDpr();
      w = canvas!.width = Math.round(cssW * d);
      h = canvas!.height = Math.round(cssH * d);
      canvas!.style.width = cssW + "px";
      canvas!.style.height = cssH + "px";
    }
    function generate() {
      const cssW = window.innerWidth;
      // ~1 star / 4000 css px², capped so a 4K desktop stays cheap. Radius is power-skewed (random²) so most
      // stars are tiny and large ones are rare + scattered (no distracting clumps); ≤~0.78 css px.
      const n = Math.min(Math.floor((cssW * window.innerHeight) / 4000), 800);
      stars = Array.from({ length: n }, () => ({
        nx: Math.random(),
        ny: Math.random(),
        r: (Math.random() ** 2 * 0.62 + 0.16) * getDpr(),
        a: Math.random() * 0.45 + 0.12,
        tw: Math.random() * 0.018 + 0.003,
        ph: Math.random() * 6.28,
      }));
      genW = cssW;
    }
    function paint(now: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = color;
      const twinkle = running; // animated frames oscillate alpha; a static frame sits at base alpha
      const mult = multRef.current;
      for (const s of stars) {
        const a = s.a + (twinkle ? Math.sin(now * s.tw * mult + s.ph) * 0.18 : 0);
        ctx!.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
        ctx!.beginPath();
        ctx!.arc(s.nx * w, s.ny * h, s.r, 0, 6.28);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }
    function draw(now: number) {
      if (!running) return; // a stop() canceled us
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return; // throttle to ~30fps
      last = now;
      paint(now);
    }
    function start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(draw);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    resizeCanvas();
    generate();
    readColor();
    paint(0); // initial static frame; the [animate] effect starts the loop if motion is on
    ctrl.current = { start, stop, repaint: () => paint(0) };

    // Re-size on viewport changes: window 'resize' = rotation / desktop drag; visualViewport 'resize' =
    // Android URL bar + soft keyboard. Skip genuine no-ops; regenerate the field only when WIDTH changes
    // (rotation/desktop) — a height-only change just rescales via normalized positions, no reshuffle.
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    const onResize = () => {
      const cw = window.innerWidth;
      const ch = window.innerHeight;
      if (cw === lastW && ch === lastH) return;
      lastW = cw;
      lastH = ch;
      resizeCanvas();
      if (cw !== genW) generate();
      // resizeCanvas() cleared the backing store — repaint NOW rather than waiting for the next (throttled)
      // rAF frame, which would composite a blank frame mid-resize (flicker during an Android URL-bar slide).
      // `running` is captured in paint(): a running frame twinkles, a paused one settles on the static frame.
      paint(performance.now());
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    // Persistent full-screen layer → pause when the PWA is backgrounded (no IntersectionObserver: it's
    // always "on screen"). Resume only if animation is currently enabled.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (animateRef.current) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      ctrl.current = null;
    };
  }, []);

  // Drive the loop from the (reactive) animation gate. Runs on mount + whenever `animate` flips. Tempo
  // changes don't reach here (read via multRef) so they never restart the loop / reshuffle the field.
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    if (animate && !document.hidden) c.start();
    else {
      c.stop();
      c.repaint(); // settle on a static base-alpha frame
    }
  }, [animate]);

  return <canvas ref={canvasRef} className="cosmos-stars" aria-hidden />;
}
