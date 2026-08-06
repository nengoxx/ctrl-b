import { chipBackground } from "../lib/chipBackground";

// Vapor segmented control — the `.seg` recipe (vapor.css, D7). Extracted (D23): this was copy-pasted
// in AgentsEditor / ServerListEditor / ConfTab. Generic over the option value so callers keep their
// literal-union types (a plain-string caller infers `T = string`). The richer tri-state agent-access
// control with a default marker + read-only/small variants is a separate component — see `ModeSeg`.
//
// An option may carry an optional `swatch` (D52 §4.9, G6) — the same DATA shape `PaletteModel.accents`
// uses — which renders a colour chip inside the chip. Absent → no extra node.
//
// A11y (F5 Gate A5): the container is a labelled `role="group"` (Primer/Workday segmented-control pattern —
// deliberately NOT a radiogroup/tablist, so there's no roving-tabindex machinery: every option stays a
// tab-stop) and each option carries `aria-pressed` to announce the current selection. `label` is the group's
// accessible name — required-ish: callers pass the nearby visible setting label so AT reads e.g. "Mode, group".
export function Seg<T extends string>(props: {
  current: T;
  onPick: (v: T) => void;
  options: { val: T; label: string; swatch?: string | string[] }[];
  /** Accessible name for the group (the adjacent visible setting label). Optional only because a handful of
   *  call sites sit under a directly-associated visible label; pass it wherever a name isn't otherwise wired. */
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.val}
          className={o.val === props.current ? "active" : ""}
          aria-pressed={o.val === props.current}
          onClick={() => props.onPick(o.val)}
        >
          {/* The optional COLOUR CHIP (D52 §4.9 ledger, G6): an option that carries a `swatch` shows what
              it picks. Rendered through `Swatches`' own `chipBackground()` so the two chip surfaces share
              one interpretation of the data (single colour/gradient → one chip; string[] → conic pie).
              `aria-hidden`: the option's own label is already its accessible name, and a colour read out
              as a hex string is noise. NO node at all when `swatch` is absent — every seg row that
              predates this renders byte-identically. */}
          {o.swatch !== undefined && (
            <span className="seg-chip" style={chipBackground(o.swatch)} aria-hidden />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}
