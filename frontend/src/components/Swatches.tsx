import { type CSSProperties, type KeyboardEvent, useRef } from "react";

// Palette swatch picker (D29 §14.4) — a radiogroup of color chips, the visual counterpart to `Seg` for the
// Appearance "Palette" axis. Web-researched against the W3C APG radio pattern + React-Aria/Telerik swatch
// guidance: a color chip alone is ambiguous to screen readers, so each radio is aria-labelled by the
// palette NAME, the selected chip shows a RING (not just a tint), and focus roves with the arrow keys
// (only the selected chip is tabbable). Dual-skin like Seg/Switch: `.swatches`/`.sw`/`.sw-chip` are styled
// under both `[data-skin=vapor]` (extras.css) and `.kit` (kit.css), token-driven.
//
// An option's `swatch` is a single CSS color/gradient → one chip, OR a string[] → a conic multi-token
// preview (the seam for richer "design framework" palettes). Omitted → a neutral chip.

export interface SwatchOption {
  val: string;
  label: string;
  swatch?: string | string[];
}

// Build the chip background: a neutral surface when unset, the value itself for a single color/gradient,
// or an equal-wedge conic-gradient "pie" previewing each color of a multi-token palette.
function chipBackground(swatch?: string | string[]): CSSProperties {
  if (!swatch) return { background: "var(--surface-2)" };
  if (!Array.isArray(swatch)) return { background: swatch };
  const n = swatch.length;
  const stops = swatch
    .map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}% ${(((i + 1) / n) * 100).toFixed(2)}%`)
    .join(", ");
  return { background: `conic-gradient(${stops})` };
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
            <span className="sw-chip" style={chipBackground(o.swatch)} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
