import { type KeyboardEvent, useRef } from "react";

// The chip paint rule lives in `lib/` — `Seg` draws the same chip for its own optional `swatch` (D52 G6).
import { chipBackground } from "../lib/chipBackground";

// Palette swatch picker (D29 §14.4) — a radiogroup of color chips, the visual counterpart to `Seg` for the
// Appearance "Palette" axis. Web-researched against the W3C APG radio pattern + React-Aria/Telerik swatch
// guidance: a color chip alone is ambiguous to screen readers, so each radio is aria-labelled by the
// palette NAME, the selected chip shows a RING (not just a tint), and focus roves with the arrow keys
// (only the selected chip is tabbable). Dual-skin like Seg/Switch: `.swatches`/`.sw`/`.sw-chip` are styled
// under both `[data-skin=vapor]` (extras.css) and `.kit` (kit.css), token-driven.
//
// An option's `swatch` is a single CSS color/gradient → one chip, OR a string[] → a conic multi-token
// preview (the seam for richer "design framework" palettes). Omitted → a neutral chip.
//
// An option may also carry `accent` — the palette's flat accent colour — and then the chip is an OVAL whose
// right band is that colour over the swatch (G6.3, owner ruling 2026-08-06: a gradient alone previews the
// scenery, not the hue every control will take). The oval geometry is CSS (`.sw-chip`) and the two-part
// paint is `chipBackground`; nothing here branches on it, so a theme that declares no `accent` renders the
// same single-swatch chip it always has, just in the wider shape.

export interface SwatchOption {
  val: string;
  label: string;
  swatch?: string | string[];
  /** The variant's flat `--accent`, banded over the swatch. Omitted → a plain swatch-only chip. */
  accent?: string;
}

export function Swatches(props: {
  current: string;
  options: SwatchOption[];
  onPick: (v: string) => void;
  /** Accessible name for the radiogroup (the row's label, e.g. "Palette"). */
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedIdx = props.options.findIndex((o) => o.val === props.current);

  // Arrow-key roving (W3C APG radio pattern): move selection + focus to the prev/next chip, wrapping.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    // Seed so the FIRST arrow lands on index 0 when nothing is selected yet (Right from -1 → 0; Left → last).
    const from = selectedIdx < 0 ? (fwd ? -1 : 0) : selectedIdx;
    const nextIdx = (from + (fwd ? 1 : -1) + props.options.length) % props.options.length;
    props.onPick(props.options[nextIdx].val);
    ref.current?.querySelectorAll<HTMLButtonElement>("button.sw")[nextIdx]?.focus();
  };

  return (
    <div
      className="swatches"
      role="radiogroup"
      aria-label={props.ariaLabel}
      ref={ref}
      onKeyDown={onKeyDown}
    >
      {props.options.map((o, i) => {
        const sel = o.val === props.current;
        return (
          <button
            key={o.val}
            type="button"
            role="radio"
            aria-checked={sel}
            aria-label={o.label}
            title={o.label}
            className={"sw" + (sel ? " active" : "")}
            // Roving tabindex: only the selected chip is tabbable (the first when none match, so the group
            // is always reachable). Arrows move within once focused.
            tabIndex={sel || (selectedIdx < 0 && i === 0) ? 0 : -1}
            onClick={() => props.onPick(o.val)}
          >
            <span className="sw-chip" style={chipBackground(o.swatch, o.accent)} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
