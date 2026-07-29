import {
  getDefaultAgent,
  getKnownAgents,
  getKnownSkills,
  useVerbsVersion,
} from "../../../../lib/composer";
import { useComposerOverlayOpen } from "../../../../store/composerOverlay";
import {
  clearComposerScope,
  setScopeAgent,
  toggleScopeSkill,
  useComposerScope,
} from "../../../../store/composerScope";

// The tools/skills MENU panel (A6) — the `overlay` slot half of the addon. Geometry is the plan sheet's
// idiom (a positioned SIBLING of `.kit-composer`, anchored off the measured `--composer-h`, tucking behind
// the composer's rounded top); the two never collide because `store/composerOverlay` opens exactly one
// composer overlay at a time. Content + state only here — the anchor/frost live in kit.css (`.tools-sheet`,
// grouped with `.plan-sheet`).
//
// Mount policy follows the SUGGEST popover, not the plan sheet: it renders NOTHING when closed rather than
// staying mounted under `aria-hidden`. A permanently-mounted panel full of buttons behind `aria-hidden` is
// the `aria-hidden-focus` violation (the plan sheet dodges it only because it unmounts with the plan, which
// this menu never does) — and a menu has no "peek" state worth animating out of.
//
// Two sections, two one-shot semantics for the NEXT message only (nothing here is sticky — `/agent <name>`
// remains the sticky switch):
//   • AGENT  — radio: the configured specialists plus a "default" row (`agent: null`).
//   • SKILLS — checkboxes: the discovered skills, ticked into the next message's `skills`.
// Both read the composer's own verb sets (`lib/composer`), the same source `/agent`/`/<skill>` route from —
// so the menu can never offer something the router wouldn't accept, and it costs no extra fetch.

/** The panel element id — one composer is mounted at a time, like `#composer-suggest`/`#cmd-input`. */
export const TOOLS_SHEET_ID = "composer-tools";

const AGENTS_LABEL_ID = "composer-tools-agents";
const SKILLS_LABEL_ID = "composer-tools-skills";

export function ToolsMenuSheet() {
  const open = useComposerOverlayOpen("menu");
  const scope = useComposerScope();
  // Re-derive when a loader installs a fresh set (a version, not the sets — createStore's snapshot
  // contract; see `useVerbsVersion`). Derived per render: the lists are tiny.
  useVerbsVersion();

  if (!open) return null;
  const agents = getKnownAgents();
  const skills = getKnownSkills();
  const armed = scope.agent !== null || scope.skills.length > 0;

  return (
    <div
      className="tools-sheet"
      id={TOOLS_SHEET_ID}
      role="region"
      aria-label="agent and skills for the next message"
    >
      <div className="tools-sec">
        <div className="tools-lbl" id={AGENTS_LABEL_ID}>
          agent
        </div>
        <div className="tools-list" role="radiogroup" aria-labelledby={AGENTS_LABEL_ID}>
          <AgentRow name={getDefaultAgent()} tag="default" on={scope.agent === null} value={null} />
          {agents.map((n) => (
            <AgentRow key={n} name={n} on={scope.agent === n} value={n} />
          ))}
        </div>
      </div>
      <div className="tools-sec">
        <div className="tools-lbl" id={SKILLS_LABEL_ID}>
          skills
        </div>
        {skills.length === 0 ? (
          <p className="tools-empty">// none discovered</p>
        ) : (
          <div className="tools-list" role="group" aria-labelledby={SKILLS_LABEL_ID}>
            {skills.map((n) => {
              const on = scope.skills.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={"tools-row" + (on ? " on" : "")}
                  onClick={() => toggleScopeSkill(n)}
                >
                  <span className="tools-tick" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <span className="tools-name">{n}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* Only when something IS armed — an always-present "clear" reads as an action with nothing to do.
          Picking stays sticky-until-sent, so the panel never closes on a pick: agent + skills are usually
          armed together, and the trigger is the close gesture. */}
      {armed && (
        <button type="button" className="tools-clear" onClick={clearComposerScope}>
          clear
        </button>
      )}
    </div>
  );
}

/** One agent radio row. `value` is what gets armed — `null` for the default/root agent. */
function AgentRow({
  name,
  tag,
  on,
  value,
}: {
  name: string;
  tag?: string;
  on: boolean;
  value: string | null;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={"tools-row" + (on ? " on" : "")}
      onClick={() => setScopeAgent(value)}
    >
      <span className="tools-tick" aria-hidden>
        {on ? "•" : ""}
      </span>
      <span className="tools-name">{name}</span>
      {tag && <span className="tools-tag">{tag}</span>}
    </button>
  );
}
