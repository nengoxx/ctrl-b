import { useEffect, useRef } from "react";

import { useUISlice } from "../../store/ui";
import { useThemeSetting } from "../../theme-engine/settings";
import { speedMultiplier } from "./motion";

// The cosmos starfield (C1) — a fixed, full-viewport canvas of twinkling stars behind the see-through Kit
// shell (cosmos.css positions it at z 0). Ported from prototypes/.../cosmos.html (star params + the
// `a + sin(t·tw+ph)·0.18` twinkle), wrapped in the same perf discipline as Waveform (§14.11): dpr capped
// at 2, ResizeObserver-sized backing store, ~30fps cap, no per-frame layout/style reads.
//
// Two differences from Waveform: (1) it's a PERSISTENT full-screen layer (mounted once at CosmosRoot,
// survives tab switches), so it pauses on `document.hidden` rather than IntersectionObserver; (2) animation
// is cosmos-owned — it runs only when the GLOBAL `ui.motion` is "full" AND the per-theme `orbitalMotion`
// switch is on (reduced-motion always wins for a11y), at the `motionSpeed` tempo (motion.ts). When paused
// it paints ONE static base-alpha frame (stars still visible, just still). `animate`/tempo are read through
// refs so toggling a setting re-arms the loop WITHOUT regenerating (reshuffling) the star field.
export function CosmosStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motion = useUISlice((s) => s.motion);
  const orbital = useThemeSetting<boolean>("cosmos", "orbitalMotion");
  const speed = useThemeSetting<string>("cosmos", "motionSpeed");
  const animate = motion === "full" && orbital;

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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const FRAME_MS = 1000 / 30; // ~30fps — twinkle is slow, reads smooth, halves frame work vs vsync
    type Star = { x: number; y: number; r: number; a: number; tw: number; ph: number };
    let stars: Star[] = [];
    let w = 0; // backing-store px (CSS px × dpr); the canvas is drawn in device px (no setTransform), as the prototype does
    let h = 0;
    let raf = 0;
    let running = false;
    let last = 0;
    let color = "#ffffff";

    // --star is a token (swappable later for an accent/picker option); constant in C1, so read once here
    // + on re-arm, not per frame (efficiency). A future color setting adds itself as an effect dep.
    function readColor() {
      color = getComputedStyle(canvas!).getPropertyValue("--star").trim() || "#ffffff";
    }
    function size() {
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      w = canvas!.width = Math.round(cssW * dpr);
      h = canvas!.height = Math.round(cssH * dpr);
      // A DENSE, FINE field (owner: the prototype's ~1/9000 + radius≤1.2px read sparse + chunky, "zoomed
      // in"). ~1 star / 4000 css px², capped so a 4K desktop stays cheap; smaller radii (≤~0.78 css px).
      const n = Math.min(Math.floor((cssW * cssH) / 4000), 800);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 0.6 + 0.18) * dpr,
        a: Math.random() * 0.45 + 0.12,
        tw: Math.random() * 0.018 + 0.003,
        ph: Math.random() * 6.28,
      }));
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
        ctx!.arc(s.x, s.y, s.r, 0, 6.28);
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

    size();
    readColor();
    paint(0); // initial static frame; the [animate] effect starts the loop if motion is on
    ctrl.current = { start, stop, repaint: () => paint(0) };

    // The fixed canvas's box == the viewport; ResizeObserver catches rotation / window resize.
    const ro = new ResizeObserver(() => {
      size();
      if (!running) paint(0); // a running loop repaints next frame
    });
    ro.observe(canvas);

    // Persistent full-screen layer → pause when the PWA is backgrounded (no IntersectionObserver: it's
    // always "on screen"). Resume only if animation is currently enabled.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (animateRef.current) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      ro.disconnect();
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
