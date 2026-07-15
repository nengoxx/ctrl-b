// Vapor segmented control — the `.seg` recipe (vapor.css, D7). Extracted (D23): this was copy-pasted
// in AgentsEditor / ServerListEditor / ConfTab. Generic over the option value so callers keep their
// literal-union types (a plain-string caller infers `T = string`). The richer tri-state agent-access
// control with a default marker + read-only/small variants is a separate component — see `ModeSeg`.
//
// A11y (F5 Gate A5): the container is a labelled `role="group"` (Primer/Workday segmented-control pattern —
// deliberately NOT a radiogroup/tablist, so there's no roving-tabindex machinery: every option stays a
// tab-stop) and each option carries `aria-pressed` to announce the current selection. `label` is the group's
// accessible name — required-ish: callers pass the nearby visible setting label so AT reads e.g. "Mode, group".
export function Seg<T extends string>(props: {
  current: T;
  onPick: (v: T) => void;
  options: { val: T; label: string }[];
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
          {o.label}
        </button>
      ))}
    </div>
  );
}
