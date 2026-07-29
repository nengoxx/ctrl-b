// Vapor on/off toggle — the `.switch`/`.knob` recipe (vapor.css, D7). Extracted (D23): this was
// copy-pasted byte-identical in AgentsEditor / MemoryEditor / SkillsEditor / ConfTab.
//
// `label` is REQUIRED (a11y, WCAG 4.1.2 / axe `aria-toggle-field-name`): a `role="switch"` with no
// accessible name is announced as just "switch, on" — the label says WHAT it toggles. Required so the
// type checker rejects any unlabelled Switch (drift-proof). (Future: convert the div to a native
// `<button role="switch">` — see ROADMAP; deferred for the visual-regression risk on the `.switch` CSS.)
//
// `disabled` (F1) marks a switch whose value is real config but which can't be operated RIGHT NOW —
// the per-event notification toggles while the master switch is off. It's `aria-disabled` + inert
// handlers rather than a hidden row, because the value still matters and hiding it would make the
// section's layout jump on every master toggle. Removed from the tab order (a control you can't
// operate shouldn't be a tab stop), styled by the `[aria-disabled="true"]` attribute selector in
// extras.css (vapor) + kit.css (every kit theme) — no new class name to keep in sync.
export function Switch({
  on,
  onToggle,
  label,
  disabled = false,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  const fire = () => {
    if (!disabled) onToggle();
  };
  return (
    <div
      className={"switch" + (on ? " on" : "")}
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={fire}
      onKeyDown={(e) => {
        // Keyboard-operable like a native switch: Enter/Space toggle (Space would
        // otherwise scroll the page, so preventDefault).
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      }}
    >
      <div className="knob" />
    </div>
  );
}
