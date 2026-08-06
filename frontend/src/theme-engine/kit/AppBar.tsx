import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { NavMenu } from "../../components/NavMenu";
import { useAppChrome } from "../../hooks/useAppChrome";
import { useSections } from "../../hooks/useSections";
import { useConnection } from "../../store/connection";
import { useUISlice, type AppbarMode } from "../../store/ui";
import { ownerArtUrl, useKitBrandArt } from "./ownerArt";

// Kit app bar (D29 §14.4) — token-driven, `.kit-*` classes. Same capability as vapor's AppBar (brand +
// live-feed badge + auto-TTS toggle) via the SAME headless controller (useAppChrome) + connection store;
// only the markup/icons differ. Reskin themes get this through DefaultRoot. Inline SVG icons (portable
// across themes) rather than vapor's CSS-mask icons.

// `brandMeta` = the theme-fillable brand subtitle slot (D30 slot composition; frontier's live rig count —
// F1 pre-flight ruling 2026-07-12). TOGGLE-GATED since the G6.3 refinement (owner 2026-08-06): the bar is
// icon + title only by default — "too much text" — and `ui.appbarSubtitleVisible` (the synced "Bar subtitle"
// Appearance switch, default OFF) is what brings a theme's own subtitle back. Two independent conditions,
// deliberately: the SWITCH is the owner's global appetite for the line, the SLOT is whether this theme has
// one to show. The kit's old static "dashboard" default stays dead — a theme that fills nothing renders
// nothing in EITHER state, so the switch can never conjure text the theme didn't author.
// `brandMark` = the same slot pattern one line up: the brand's LEADING MARK. Omitted → the Kit's own accent
// dot (what every theme shows today). A theme passes a NODE — vapor's gradient-ring lozenge (D51 §4.1 / R15).
// The Kit deliberately knows nothing about what the node is: no `loz` enum, no ring/logo/spin knowledge here;
// whatever the theme renders, this slot just leads the brand row.
// `brandText` = the THIRD member of the same slot family (D52 / GACHA_PLAN §4.3): the brand WORDMARK itself.
// The kit row rendered the literal `ctrl·b` hardcoded; gacha's ruled katakana wordmark needs it fillable.
// Omitted → that same literal, so every other theme renders byte-identically.
//
// THE MARK HAS A THIRD RUNG SINCE G6.3: the owner's own file (`media/kit/brand/`) OUTRANKS the theme's
// `brandMark`, which outranks the kit dot. Owner art beating theme art is the D54 A5 matrix's rule for
// every kit role — this is the app bar's row of it — and it is the reason the role is worth having: the
// mark is painted as a CSS MASK over `--kit-brand-fill` (default `--accent-fill`), so ONE silhouette
// dropped in once is re-tinted by each theme's own accent instead of being a picture that suits one skin.
// Empty folder ⇒ `undefined` ⇒ the two old rungs, unchanged.
// `appbarMode` is threaded so the `transparent` mode can stamp a `.transparent` modifier — kit.css null-paints
// the bar (no fill/border/shadow/backdrop-filter) + squares its icon buttons in that mode only.
export function KitAppBar({
  brandMeta,
  brandMark,
  brandText,
  appbarMode,
}: {
  brandMeta?: ReactNode;
  brandMark?: ReactNode;
  brandText?: ReactNode;
  appbarMode?: AppbarMode;
}) {
  const { ttsAuto, ttsConfigured, toggleAutoTts } = useAppChrome();
  const conn = useConnection();
  // The owner's global appetite for the subtitle line (synced appearance, default OFF). A plain slice read
  // like every other store consumer in this component — not a prop — because it is a GLOBAL lever, not
  // something a theme decides: threading it through every Root would make each theme able to disagree.
  const subtitleOn = useUISlice((s) => s.appbarSubtitleVisible);
  // `?rev=`-stamped like every other CSS-painted owner role (`ownerArtUrl`): the mask is a background-ish
  // paint with no element to re-key, so overwriting the file in place must move the URL or the decoded
  // silhouette survives the repair. One shared `["media","kit"]` query — no request of its own.
  const brandUrl = ownerArtUrl(useKitBrandArt());
  // Pure `useSections` consumer (the NavBar precedent): read the off-bar-and-unhosted partition so the nav
  // menu can DOCK here when the layout produces one (D35 §F0 fixup).
  const { menu } = useSections();

  return (
    <div className={"kit-appbar" + (appbarMode === "transparent" ? " transparent" : "")}>
      <div className="kit-brand">
        {brandUrl !== undefined ? (
          // Percent-encoded by the server (`core.media.file_url`), so no quote or backslash reaches the
          // CSS token. `aria-hidden`: it is the brand's ornament — the wordmark beside it is the name.
          <span
            className="kit-brand-mark"
            aria-hidden
            style={{ "--kit-brand-mask": `url("${brandUrl}")` } as CSSProperties}
          />
        ) : (
          (brandMark ?? <span className="dot" aria-hidden />)
        )}
        {brandText ?? "ctrl·b"}
        {subtitleOn && brandMeta != null && <span className="meta">{brandMeta}</span>}
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

// Auto-TTS flash — vapor's `.tts-toast` rebuilt kit-wide (owner ruling 2026-08-02; the original died
// with the bespoke appbar at D51 V4). Flashes "auto-tts on/muted" for 1.1 s on toggles only, keyed on
// the VALUE CHANGE (prev ref), not a first-run flag: a mounted-flag skip flashes once at load under
// StrictMode's dev double-effect (refs survive the simulated remount — the old vapor code had that
// latent quirk). Effect-driven rather than onClick-driven, and a SEPARATE component that DefaultRoot
// mounts UNCONDITIONALLY in its overlay zone (not inside KitAppBar): every toggle source must echo —
// the bar's button AND the Conf tab's TTS switch — including under the `off`/`minimal` appbar modes
// where the bar (and its button) doesn't render at all (Codex R1 on the rebuild slice).
export function KitTtsFlash() {
  const { ttsAuto } = useAppChrome();
  const [flash, setFlash] = useState<{ on: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTts = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevTts.current;
    prevTts.current = ttsAuto;
    if (prev === null || prev === ttsAuto) return;
    setFlash({ on: ttsAuto });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1100);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ttsAuto]);

  return (
    // Stay-mounted (the kit overlay contract) so the fade transition can run; pointer-events:none in
    // kit.css. aria-hidden: a purely visual echo of the toggle's own state reporting (the button's
    // aria-pressed / the Conf switch) — announcing it too would double the SR feedback.
    <div
      className={"kit-tts-toast" + (flash ? " show" : "") + (flash && !flash.on ? " off" : "")}
      aria-hidden="true"
    >
      <b>auto-tts</b> {flash?.on === false ? "muted" : "on"}
    </div>
  );
}
