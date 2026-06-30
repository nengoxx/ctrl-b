// Vapor on/off toggle — the `.switch`/`.knob` recipe (vapor.css, D7). Extracted (D23): this was
// copy-pasted byte-identical in AgentsEditor / MemoryEditor / SkillsEditor / ConfTab.
export function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={"switch" + (on ? " on" : "")} onClick={onToggle}>
      <div className="knob" />
    </div>
  );
}
