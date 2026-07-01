// Vapor on/off toggle — the `.switch`/`.knob` recipe (vapor.css, D7). Extracted (D23): this was
// copy-pasted byte-identical in AgentsEditor / MemoryEditor / SkillsEditor / ConfTab.
export function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      className={"switch" + (on ? " on" : "")}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        // Keyboard-operable like a native switch: Enter/Space toggle (Space would
        // otherwise scroll the page, so preventDefault).
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="knob" />
    </div>
  );
}
