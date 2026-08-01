import { type PointerEvent } from "react";

import { useNowPlaying } from "../hooks/useAppChrome";

// Phase 6b-2 — the floating TTS mini-player. Minimal but functional (owner-locked 2026-06-22): a
// play/pause icon (the accent gradient, like the mic), a waveform seek scrubber, the remaining time,
// and a dismiss ✕ — no skip, no speed. A frosted pill that floats just below the appbar (fixed,
// centered — CSS in extras.css), shown only while a clip is loaded. Net-new markup (no vapor.html
// source) — styled from vapor tokens so it adapts across dark/aqua/ember. One player at a time.
//
// The scrubber is a ChatGPT-style WAVEFORM (a row of bars that fill with the accent as the clip plays,
// no thumb) instead of a range bar+dot. The bar heights are a fixed decorative pattern — NOT the real
// audio amplitude (owner: "just a visual"). Still a real slider: tap/drag or arrow-keys to seek.

const BAR_COUNT = 32;
// Deterministic pseudo-random in [0,1) — keeps the pattern fixed (never reshuffles between renders).
const rand = (n: number): number => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
// Each bar: a fixed decorative height + its OWN shimmer phase (delay) and speed (duration), so while
// playing they bounce INDEPENDENTLY (an equalizer look) instead of the whole shape stretching in unison.
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const v = Math.sin(i * 0.7) * 0.5 + Math.sin(i * 1.9 + 1.3) * 0.3 + Math.sin(i * 0.31) * 0.2;
  return {
    h: 0.28 + Math.abs(v) * 0.72, // 0.28..1.0 of the track height (the static silhouette)
    delay: -rand(i) * 2.6, // random phase (negative → already mid-cycle when playback starts)
    dur: 1.3 + rand(i + 13) * 1.3, // 1.3..2.6s — varied (slow, gentle) speed so they never sync up
  };
});

function fmt(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function MiniPlayer() {
  // All transport state + actions come from the headless now-playing controller (D29 §14.2); this
  // component is pure presentation, styled by the shared kit rules (kit.css `.mini-player*` — vapor's
  // flat-positioned copy died at D51 V5, which is what let the kit's :has() yields fire). Self-hides
  // when nothing's docked.
  const np = useNowPlaying();
  if (!np.active) return null;

  // Seek to the x-position under the pointer (0..1 of the track width). seekFraction clamps internally.
  const seekFromEvent = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    np.seek((e.clientX - r.left) / r.width);
  };

  return (
    <div className="mini-player" role="group" aria-label="read-aloud player">
      <button
        type="button"
        className={"mp-play" + (np.playing ? " playing" : "")}
        aria-label={np.playing ? "pause" : "play"}
        disabled={np.loading}
        onClick={np.togglePlay}
      />
      <div
        className={
          "mp-wave" + (np.seekDisabled ? " disabled" : "") + (np.playing ? " playing" : "")
        }
        role="slider"
        aria-label="seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(np.fraction * 100)}
        aria-disabled={np.seekDisabled || undefined}
        tabIndex={np.seekDisabled ? -1 : 0}
        onPointerDown={(e) => {
          if (np.seekDisabled) return;
          e.currentTarget.setPointerCapture(e.pointerId); // capture so a drag past the edge keeps seeking
          seekFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (!np.seekDisabled && e.buttons === 1) seekFromEvent(e); // only while pressed (drag)
        }}
        onKeyDown={(e) => {
          if (np.seekDisabled) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            np.seek(np.fraction + 0.05);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            np.seek(np.fraction - 0.05);
          }
        }}
      >
        {BARS.map((b, i) => (
          // A bar is "played" (accent) once the clip's progress passes its center. Its own delay +
          // duration (set inline) desync the scaleY shimmer (CSS, while playing) so the bars bounce
          // independently rather than the whole silhouette stretching together.
          <i
            key={i}
            className={(i + 0.5) / BAR_COUNT <= np.fraction ? "on" : ""}
            style={{
              height: `${Math.round(b.h * 100)}%`,
              animationDelay: `${b.delay.toFixed(2)}s`,
              animationDuration: `${b.dur.toFixed(2)}s`,
            }}
          />
        ))}
      </div>
      <span className="mp-time" aria-hidden>
        {np.loading ? "···" : `-${fmt(np.remaining)}`}
      </span>
      <button type="button" className="mp-close" aria-label="close player" onClick={np.dismiss} />
    </div>
  );
}
