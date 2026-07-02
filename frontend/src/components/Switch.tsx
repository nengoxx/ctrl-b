// Vapor on/off toggle — the `.switch`/`.knob` recipe (vapor.css, D7). Extracted (D23): this was
// copy-pasted byte-identical in AgentsEditor / MemoryEditor / SkillsEditor / ConfTab.
//
// `label` is REQUIRED (a11y, WCAG 4.1.2 / axe `aria-toggle-field-name`): a `role="switch"` with no
// accessible name is announced as just "switch, on" — the label says WHAT it toggles. Required so the
// type checker rejects any unlabelled Switch (drift-proof). (Future: convert the div to a native
// `<button role="switch">` — see ROADMAP; deferred for the visual-regression risk on the `.switch` CSS.)
export function Switch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <div
      className={"switch" + (on ? " on" : "")}
      role="switch"
      aria-checked={on}
      aria-label={label}
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
