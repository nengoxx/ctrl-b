import { dismiss, seekFraction, togglePlay, usePlayback } from "../lib/audioController";

// Phase 6b-2 — the docked TTS mini-player. Minimal but functional (owner-locked 2026-06-22): a
// play/pause button, a draggable+clickable seek bar, the remaining time, and a dismiss ✕ — no skip,
// no speed. Renders in-flow above the composer (App.tsx) only while a clip is docked, so it naturally
// sits "docked" at the bottom on any tab while audio plays. Net-new markup (no vapor.html source) —
// styled entirely from vapor tokens (extras.css) so it adapts across dark/aqua/ember; vapor.css
// untouched (D7). One player at a time (the controller is a singleton).

function fmt(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function MiniPlayer() {
  const id = usePlayback((p) => p.id);
  const status = usePlayback((p) => p.status);
  const current = usePlayback((p) => p.current);
  const duration = usePlayback((p) => p.duration);

  if (!id) return null;

  const loading = status === "loading";
  const playing = status === "playing";
  const frac = duration > 0 ? Math.min(1, current / duration) : 0;
  const pct = `${frac * 100}%`;
  const remaining = duration > 0 ? duration - current : 0;

  return (
    <div className="mini-player" role="group" aria-label="read-aloud player">
      <button
        type="button"
        className={"mp-play" + (playing ? " playing" : "")}
        aria-label={playing ? "pause" : "play"}
        disabled={loading}
        onClick={togglePlay}
      />
      <input
        type="range"
        className="mp-seek"
        min={0}
        max={1}
        step={0.001}
        value={frac}
        aria-label="seek"
        disabled={loading || duration <= 0}
        onChange={(e) => seekFraction(parseFloat(e.target.value))}
        // Filled-progress look: accent up to the thumb, faint track after. Themed via vapor tokens.
        style={{
          background: `linear-gradient(to right, rgb(var(--accent-rgb)) ${pct}, var(--line-2) ${pct})`,
        }}
      />
      <span className="mp-time" aria-hidden>
        {loading ? "···" : `-${fmt(remaining)}`}
      </span>
      <button type="button" className="mp-close" aria-label="close player" onClick={dismiss} />
    </div>
  );
}
