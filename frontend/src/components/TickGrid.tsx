import type { AgentMode } from "../types";

// The allowlist CHIP GRID — one wrapping row of toggle chips over a discovered set of names. Four
// surfaces render it (an agent's tools, an agent's skills, the roleplay default-tools list, and the
// D70 §6.5 lorebook attachment picker), which is why it lives in its own module rather than in the
// agent editor it grew up in: the lorebook picker is exported from `LorebooksEditor`, which the agent
// form imports, so leaving the grid in `AgentsEditor` would have made the two files a cycle.
//
// `modes` (8b, D22) mirrors the Tools-tab tri-state onto the per-agent selection grid: a globally
// **disabled** tool shows locked-off (it can't be granted), a **core** tool locked-on (it's always
// available regardless of the allowlist). Only **enabled** tools are interactive. The skills grid
// passes no `modes` → every entry stays interactive.
export function TickGrid({
  all,
  selected,
  onToggle,
  modes,
  labels,
  missing,
}: {
  all: string[];
  selected: Set<string>;
  onToggle: (n: string) => void;
  modes?: Record<string, AgentMode>;
  /** What to DRAW for a name whose identity is not its label — a lorebook is picked by slug and
   *  displayed by its book name. Absent (tools, skills) ⇒ the name is the label. */
  labels?: Record<string, string>;
  /** Names that are SELECTED but no longer discovered — a lorebook an agent still lists after the
   *  book file was deleted. The caller appends them to `all` so they keep rendering: a picker that
   *  silently dropped them would delete the attachment on the next save, which no one asked for. */
  missing?: ReadonlySet<string>;
}) {
  if (!all.length) return <div className="agent-empty">none discovered</div>;
  return (
    <div className="tick-grid">
      {all.map((n) => {
        const mode = modes?.[n];
        const locked = mode === "core" || mode === "disabled";
        const gone = missing?.has(n) ?? false;
        const on = mode === "core" ? true : mode === "disabled" ? false : selected.has(n);
        const title = gone
          ? "not found — untick to remove it"
          : mode === "core"
            ? "always available (core) — set in Tools tab"
            : mode === "disabled"
              ? "globally disabled — set in Tools tab"
              : undefined;
        return (
          <button
            key={n}
            type="button"
            disabled={locked}
            title={title}
            className={
              "tick" + (on ? " on" : "") + (locked ? " locked" : "") + (gone ? " gone" : "")
            }
            onClick={() => !locked && onToggle(n)}
          >
            {labels?.[n] ?? n}
          </button>
        );
      })}
    </div>
  );
}
