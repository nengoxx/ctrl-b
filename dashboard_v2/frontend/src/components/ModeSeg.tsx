import type { AgentMode } from "../types";

// The tri-state agent-access control (Phase 8b, D22) — a vapor `.seg` segmented control. Shared by
// the Tools-tab catalog (Section B, batched-save) and the run cards (Section A, immediate-save); both
// render the same three states and mark the tool's compile-time default with a dot (`.def`) so
// "pick the default" reads as "reset". `readOnly` renders it inert (run_shell, governed elsewhere).
export const MODES: { val: AgentMode; label: string }[] = [
  { val: "core", label: "core" },
  { val: "enabled", label: "on" },
  { val: "disabled", label: "off" },
];

export function ModeSeg(props: {
  value: AgentMode;
  def: AgentMode;
  readOnly?: boolean;
  onPick: (m: AgentMode) => void;
}) {
  return (
    <div className={"seg tcat-seg" + (props.readOnly ? " ro" : "")}>
      {MODES.map((m) => (
        <button
          key={m.val}
          type="button"
          disabled={props.readOnly}
          className={(m.val === props.value ? "active" : "") + (m.val === props.def ? " def" : "")}
          title={m.val === props.def ? `${m.label} · default` : m.label}
          onClick={() => !props.readOnly && props.onPick(m.val)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
