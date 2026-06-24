// Vapor segmented control — the `.seg` recipe (vapor.css, D7). Extracted (D23): this was copy-pasted
// in AgentsEditor / ServerListEditor / ConfTab. Generic over the option value so callers keep their
// literal-union types (a plain-string caller infers `T = string`). The richer tri-state agent-access
// control with a default marker + read-only/small variants is a separate component — see `ModeSeg`.
export function Seg<T extends string>(props: {
  current: T;
  onPick: (v: T) => void;
  options: { val: T; label: string }[];
}) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button
          key={o.val}
          className={o.val === props.current ? "active" : ""}
          onClick={() => props.onPick(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
