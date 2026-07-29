import { useEffect } from "react";

import {
  getDefaultAgent,
  getKnownAgents,
  getKnownSkills,
  useVerbsVersion,
} from "../../../../lib/composer";
import { getSessionAgent } from "../../../../store/chat";
import { releaseComposerOverlay, useComposerOverlayOpen } from "../../../../store/composerOverlay";
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
//   • AGENT  — radio: the configured specialists plus a "default" row (arms `agent: null`, which BEATS a
//     sticky `/agent <name>` for this one message — see store/composerScope's tri-state).
//   • SKILLS — checkboxes: the discovered skills, ticked into the next message's `skills`.
// Both read the composer's own verb sets (`lib/composer`), the same source `/agent`/`/<skill>` route from —
// so the menu can never offer something the router wouldn't accept, and it costs no extra fetch.

/** The panel element id — one composer is mounted at a time, like `#composer-suggest`/`#cmd-input`. */
export const TOOLS_SHEET_ID = "composer-tools";

const AGENTS_LABEL_ID = "composer-tools-agents";
const SKILLS_LABEL_ID = "composer-tools-skills";
/** The shared `name` binding the agent rows into ONE native radio group (see `AgentRow`). Document-unique
 *  by the same rule as the ids above: one composer is mounted at a time. */
const AGENT_RADIO_NAME = "composer-tools-agent";

export function ToolsMenuSheet() {
  const open = useComposerOverlayOpen("menu");
  const scope = useComposerScope();
  // Re-derive when a loader installs a fresh set (a version, not the sets — createStore's snapshot
  // contract; see `useVerbsVersion`). Derived per render: the lists are tiny.
  useVerbsVersion();
  // Hand the overlay slot back on UNMOUNT (Codex, round 2). The panel is the composer's `overlay` slot, so
  // a tab or layout swap that drops the composer unmounts it — with the slot still naming "menu", nothing
  // else could claim the space and the menu would spring open again on the next mount. Guarded: if another
  // surface displaced us it owns the slot and keeps it. (The plan sheet's persistence is DELIBERATE — a
  // plan outlives the composer's mount; an open menu doesn't.)
  useEffect(() => () => releaseComposerOverlay("menu"), []);

  if (!open) return null;
  const agents = getKnownAgents();
  const skills = getKnownSkills();
  const armed = scope.agent !== undefined || scope.skills.length > 0;
  // The radio group must tell the TRUTH about where the next message goes: the armed pick if the menu armed
  // one, else the sticky `/agent <name>` a plain send would use, else the configured default. Reading the
  // sticky pick non-reactively is safe — it only changes by SENDING `/agent …`, and typing that `/` hands
  // the overlay slot to the suggest popover, which unmounts this panel; reopening re-reads.
  const effectiveAgent = scope.agent !== undefined ? scope.agent : getSessionAgent();

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
          <AgentRow
            name={getDefaultAgent()}
            tag="default"
            on={effectiveAgent === null}
            value={null}
          />
          {agents.map((n) => (
            <AgentRow key={n} name={n} on={effectiveAgent === n} value={n} />
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

/** One agent radio row. `value` is what gets armed — `null` for the default/root agent.
 *
 *  A NATIVE `<input type="radio">` (Codex, round 2), not a `role="radio"` button: the ARIA role promises
 *  arrow-key selection within the group, and hand-rolling that (roving tabindex + Home/End + wrap) is a
 *  widget the browser already ships. Same-`name` inputs give it for free, along with checked state and the
 *  one-tab-stop-per-group behaviour. The input is sr-only (kit.css, the `.bs-close-sr` recipe) and the row
 *  it sits in stays the visual — a `<label>` wrapper, so the whole row is still the hit target and the row
 *  text is still the accessible name. Its keyboard ring is drawn on the row (`:has()`, kit.css). */
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
    <label className={"tools-row" + (on ? " on" : "")}>
      <input
        type="radio"
        className="tools-radio"
        name={AGENT_RADIO_NAME}
        checked={on}
        onChange={() => setScopeAgent(value)}
      />
      <span className="tools-tick" aria-hidden>
        {on ? "•" : ""}
      </span>
      <span className="tools-name">{name}</span>
      {tag && <span className="tools-tag">{tag}</span>}
    </label>
  );
}
