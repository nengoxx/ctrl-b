import { useEffect, useRef } from "react";

import { useUISlice } from "../../store/ui";
import { safeRafLoop } from "../../theme-engine/safeRafLoop";

// Live ping waveform — the canvas draw loop ported verbatim from vapor.html. Reads themed RGB
// from CSS custom properties each frame so it tracks theme switches. Latest online/ping are held
// in a ref so the RAF loop is set up once (not torn down on every poll).
//
// NOT memoized: this component's render body must run on every parent render so that
// `stateRef.current = { online, ping }` stays in sync with the latest props. With a `memo()`
// wrapper, two hosts with identical ping values (very common on LAN — corsair/g5 both at 1ms)
// would cause the memo to bail on a featured-cycle, freezing the ref and the RAF loop on the
// previous host's snapshot. The outer `NowPanel` (in Hero.tsx) is the memo barrier that saves
// work; this component's render itself is trivial (a canvas + two legend divs).

interface Props {
  online: boolean;
  ping: number | null;
}

export function Waveform({ online, ping }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<Props>({ online, ping });
  stateRef.current = { online, ping };
  // §14.11 — the ambient ripple is an animation, so gate it on the app's motion flag (not the OS query;
  // CLAUDE.md). Under reduced-motion we draw a STATIC frame (repainted on data change, see below) and
  // never schedule the rAF. `motion` is an effect dep → toggling it in Conf tears down + re-sets the loop.
  const motion = useUISlice((s) => s.motion);
  // Reduced-motion repaint hook: with no loop running, a featured-host swap (the 6s carousel) would
  // otherwise leave a stale frame. The main effect publishes a one-shot repaint here; the prop-change
  // effect below calls it so the static frame stays correct (online↔offline, ping) without animating.
  const repaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    // Cap the ambient ripple at ~30fps — it reads as perfectly smooth there and halves the per-frame
    // work vs vsync (~60fps). `t` advances proportionally more per drawn frame so the wave keeps the
    // same on-screen speed as the old 60fps loop (Firefox-Android especially feels the saved frames).
    const FRAME_MS = 1000 / 30;
    // `running` = "the canvas is on screen" (the IntersectionObserver gate below), NOT "the loop is
    // ticking" — under reduced-motion we're on-screen with no loop, and `repaintRef` keys off that.
    let running = false;
    let last = 0; // last drawn-frame timestamp (FPS throttle)
    let frame = 0; // drawn-frame counter (colors refresh cadence)
    let t = 0;
    let w = 0; // cached CSS size (set in sizeCanvas) — avoids a per-frame getBoundingClientRect reflow
    let h = 0;
    let colors = { a: "255, 82, 212", b: "165, 92, 255" }; // cached themed RGB (refreshed ~1×/s, below)

    function readColors() {
      const s = getComputedStyle(document.body);
      colors = {
        a: (s.getPropertyValue("--accent-rgb") || "255, 82, 212").trim(),
        b: (s.getPropertyValue("--accent-rgb-2") || "165, 92, 255").trim(),
      };
    }

    function sizeCanvas() {
      const r = canvas!.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); // reset+scale (avoids compounding on resize)
    }

    function paint() {
      ctx!.clearRect(0, 0, w, h);
      const { online, ping } = stateRef.current;
      const c = colors;

      if (!online) {
        ctx!.fillStyle = "rgba(200,155,224,0.4)";
        ctx!.font = "10px JetBrains Mono";
        ctx!.fillText("// no echo · host asleep", 12, h / 2 + 4);
        t += 0.1;
        return;
      }

      ctx!.strokeStyle = `rgba(${c.a},0.06)`;
      ctx!.lineWidth = 1;
      for (let y = 0; y < h; y += 16) {
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
        ctx!.stroke();
      }

      const grad = ctx!.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `rgba(${c.a},0.15)`);
      grad.addColorStop(0.4, `rgba(${c.a},0.9)`);
      grad.addColorStop(1, `rgba(${c.b},0.9)`);
      ctx!.strokeStyle = grad;
      ctx!.lineWidth = 1.6;
      ctx!.shadowColor = `rgba(${c.a},0.5)`;
      ctx!.shadowBlur = 6;
      ctx!.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const phase = x * 0.06 + t;
        const noise =
          Math.sin(phase) * 0.6 + Math.sin(phase * 2.3) * 0.25 + Math.sin(phase * 5.1) * 0.12;
        const amp = (ping || 2) * 6;
        const y = h / 2 + noise * amp;
        x === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y);
      }
      ctx!.stroke();
      ctx!.shadowBlur = 0;

      ctx!.strokeStyle = "rgba(255,230,247,0.07)";
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.moveTo(0, h / 2);
      ctx!.lineTo(w, h / 2);
      ctx!.stroke();

      t += 0.12;
    }

    // Crash-safe loop (§14.15.1-A rider c): a throwing frame stops + reports once instead of erroring per
    // frame (an error boundary can't catch a rAF fault). Throttle-skips return void → keep scheduling.
    const loop = safeRafLoop((now: number) => {
      if (now - last < FRAME_MS) return; // skip this vsync frame — throttle to ~30fps
      last = now;
      if (frame++ % 30 === 0) readColors(); // refresh themed colors ~1×/s, not every frame (style flush)
      paint();
    });

    function start() {
      if (running) return;
      running = true;
      sizeCanvas();
      readColors();
      if (motion === "reduced") {
        paint(); // one static frame, no loop — respects reduced-motion (the wave just sits still)
        return;
      }
      last = 0;
      loop.start();
    }

    // Published for the reduced-motion prop-change effect: redraw a single frame from current state,
    // but only while the canvas is on-screen (the loop, when it runs in full-motion mode, owns redraws).
    repaintRef.current = () => {
      if (!running) return;
      readColors();
      paint();
    };
    function stop() {
      running = false;
      loop.stop();
    }

    // Only run the loop while the canvas is actually on screen. The Fleet tab is ALWAYS mounted (just
    // `display:none` on other tabs), and the hero scrolls away — without this the loop would burn the
    // main thread ~30×/s even when you can't see it. IntersectionObserver reports a display:none /
    // scrolled-off canvas as not-intersecting, so it cleanly pauses + resumes.
    const io = new IntersectionObserver((entries) => {
      if (entries[entries.length - 1].isIntersecting) start();
      else stop();
    });
    io.observe(canvas);

    // Re-size the backing store whenever the canvas's box changes — including 0→N when the Fleet tab
    // becomes visible (the original blank-waveform fix). Sizes unconditionally (cheap, and keeps the
    // canvas correct even while the loop is paused) and refreshes the cached w/h the loop reads.
    const ro = new ResizeObserver(() => sizeCanvas());
    ro.observe(canvas);
    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      repaintRef.current = null;
    };
  }, [motion]);

  // Reduced-motion only: repaint the static frame when the featured host's data changes (the rAF that
  // would reflect it isn't running). Full-motion mode no-ops here — its loop already redraws each frame.
  useEffect(() => {
    if (motion === "reduced") repaintRef.current?.();
  }, [online, ping, motion]);

  return (
    <div className="waveform">
      <canvas ref={canvasRef} />
      <div className="legend">// live ping · ICMP echo</div>
      {/* CONTRACT tokens, not vapor privates (D51 V3): `--accent` aliases `--magenta` and `--text-3`
          aliases `--ink-faint`, both declared on <body> in themes/vapor/tokens.css — so each resolves
          to the IDENTICAL per-accent value these reads had before (the aliases sit at/below the
          body[data-accent] palette overrides, and this span inherits from <body>). The canvas's
          `--accent-rgb`/`-2` getComputedStyle reads above stay vapor-private: they're rgb-TRIPLE
          tokens with no contract equivalent (their promotion is the V4 rider). */}
      <div className="legend-r">
        {online ? (
          <span style={{ color: "var(--accent)" }}>● rec</span>
        ) : (
          <span style={{ color: "var(--text-3)" }}>○ idle</span>
        )}
      </div>
    </div>
  );
}
