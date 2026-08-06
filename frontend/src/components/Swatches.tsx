import { type CSSProperties, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";

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

  // BALANCED wrap (owner, 2026-08-06): flex wrapping fills lines greedily (eight chips broke 6/2), and a
  // chip stretched to fill its line distorts the selection ring — so the container is a GRID and the
  // column count is computed here, the one thing CSS cannot do. When every chip fits one line the grid is
  // `max-content` columns, visually the old inline row. When it can't, the rows are balanced
  // (8 → 4/4, 7 → 4/3) and `[data-wrapped]` switches the CSS to full-width `1fr` cells — and because a
  // grid never shrinks below its tracks, the `.confrow`'s own wrap-below-the-label mechanism (the seg's
  // path, owner 2026-07-11) triggers naturally first, giving the balanced lines the whole row.
  // Measured from the PARENT's width via ResizeObserver (the kit's standing pattern for real geometry —
  // `--appbar-h` et al); zero-width measurements (jsdom, display:none) bail to the single-line default.
  const n = props.options.length;
  const [cols, setCols] = useState(n);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    // `typeof ResizeObserver` is this hook's house guard (CosmosFleet's stage measure carries the same
    // one): jsdom ships no ResizeObserver, so without it every suite that renders a Conf Appearance row
    // throws at layout-effect time. In a real browser it is always defined, so the guard costs nothing,
    // and the environment it bails out of is exactly the one the `slot <= 0` bail below already targets —
    // no layout ⇒ the single-line default.
    if (!el || !parent || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const first = el.querySelector<HTMLButtonElement>("button.sw");
      const slot = first?.offsetWidth ?? 0;
      const ps = getComputedStyle(parent);
      const avail = parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
      if (slot <= 0 || avail <= 0) return; // no layout (jsdom / hidden) → keep the single-line default
      const gap = parseFloat(getComputedStyle(el).columnGap) || 8;
      const maxCols = Math.max(1, Math.floor((avail + gap) / (slot + gap)));
      setCols(maxCols >= n ? n : Math.ceil(n / Math.ceil(n / maxCols)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [n]);

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
      style={{ "--sw-cols": cols } as CSSProperties}
      data-wrapped={cols < n || undefined}
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
