import { NavMenu } from "../../components/NavMenu";
import { useAppChrome } from "../../hooks/useAppChrome";
import { useSections } from "../../hooks/useSections";
import { useConnection } from "../../store/connection";

// Kit app bar (D29 §14.4) — token-driven, `.kit-*` classes. Same capability as vapor's AppBar (brand +
// live-feed badge + auto-TTS toggle) via the SAME headless controller (useAppChrome) + connection store;
// only the markup/icons differ. Reskin themes get this through DefaultRoot. Inline SVG icons (portable
// across themes) rather than vapor's CSS-mask icons.

export function KitAppBar() {
  const { ttsAuto, ttsConfigured, toggleAutoTts } = useAppChrome();
  const conn = useConnection();
  // Pure `useSections` consumer (the NavBar precedent): read the off-bar-and-unhosted partition so the nav
  // menu can DOCK here when the layout produces one (D35 §F0 fixup).
  const { menu } = useSections();

  return (
    <div className="kit-appbar">
      <div className="kit-brand">
        <span className="dot" aria-hidden />
        ctrl·b
        <span className="meta">dashboard</span>
      </div>
      {conn !== "connected" && (
        <div
          className={`kit-conn ${conn}`}
          role="status"
          aria-live="polite"
          title={conn === "reconnecting" ? "Reconnecting to live feed…" : "Live feed offline"}
        >
          <span className="dot" aria-hidden />
          <span>{conn === "reconnecting" ? "reconnecting" : "offline"}</span>
        </div>
      )}
      {ttsConfigured && (
        <button
          className={"kit-iconbtn" + (ttsAuto ? "" : " muted")}
          title={ttsAuto ? "auto-tts on — tap to mute" : "auto-tts muted — tap to enable"}
          aria-pressed={ttsAuto}
          aria-label="auto text-to-speech"
          onClick={toggleAutoTts}
        >
          {ttsAuto ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <path d="M23 9l-6 6M17 9l6 6" />
            </svg>
          )}
        </button>
      )}
      {/* The docking rule (D35 §F0 fixup, 2026-07-12) + the M3 top-app-bar trailing-action convention: when
          the resolved layout partitions sections into the menu, the nav affordance docks HERE as the
          trailing action rather than floating — "the menu affordance docks to the chrome that exists". */}
      {menu.length > 0 && <NavMenu docked />}
    </div>
  );
}
