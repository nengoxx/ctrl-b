import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let raf = 0;
    let t = 0;

    function sizeCanvas() {
      const r = canvas!.getBoundingClientRect();
      canvas!.width = r.width * dpr;
      canvas!.height = r.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); // reset+scale (avoids compounding on resize)
    }

    function wfColors() {
      const s = getComputedStyle(document.body);
      return {
        a: (s.getPropertyValue("--accent-rgb") || "255, 82, 212").trim(),
        b: (s.getPropertyValue("--accent-rgb-2") || "165, 92, 255").trim(),
      };
    }

    function draw() {
      const r = canvas!.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      ctx!.clearRect(0, 0, w, h);
      const { online, ping } = stateRef.current;
      const c = wfColors();

      if (!online) {
        ctx!.fillStyle = "rgba(200,155,224,0.4)";
        ctx!.font = "10px JetBrains Mono";
        ctx!.fillText("// no echo · host asleep", 12, h / 2 + 4);
        t += 0.05;
        raf = requestAnimationFrame(draw);
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

      t += 0.06;
      raf = requestAnimationFrame(draw);
    }

    sizeCanvas();
    draw();
    // Re-size the backing store whenever the canvas's box changes — crucially including 0→N when the
    // ALWAYS-MOUNTED Fleet tab becomes visible. `window.resize` alone missed this: if the canvas first
    // mounted while Fleet was `display:none` (the user's last tab wasn't Fleet), `sizeCanvas` set a
    // 0-pixel buffer and never re-ran on the later tab switch, so the live-ping waveform stayed blank
    // until a reload/window-resize. A ResizeObserver catches the show + any layout change.
    const ro = new ResizeObserver(() => sizeCanvas());
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="waveform">
      <canvas ref={canvasRef} />
      <div className="legend">// live ping · ICMP echo</div>
      <div className="legend-r">
        {online ? (
          <span style={{ color: "var(--magenta)" }}>● rec</span>
        ) : (
          <span style={{ color: "var(--ink-faint)" }}>○ idle</span>
        )}
      </div>
    </div>
  );
}
