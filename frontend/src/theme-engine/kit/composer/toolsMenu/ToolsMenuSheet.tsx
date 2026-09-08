import { useEffect } from "react";

import { FocalImg } from "../../../../components/FocalImg";
import { useAgentArt, type AgentArt } from "../../../../hooks/useAgentArt";
import {
  effectiveAgent,
  getDefaultAgent,
  getKnownAgents,
  getKnownSkills,
  useVerbsVersion,
} from "../../../../lib/composer";
import { getSessionAgent, getThreadAgent } from "../../../../store/chat";
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
// composer overlay at a time. Content + state only here — the chrome lives in kit.css (`.tools-sheet`: the
// shared POPOVER SHELL + the composer-anchored geometry, and its per-`composerSkin` dress, §14.16).
//
// Mount policy follows the SUGGEST popover, and both now follow the PLAN SHEET: the panel stays MOUNTED and
// toggles `.open` (kit.css), so the close gets the same .2s slide as the open — a panel that unmounts on
// close can only ever animate its enter. What makes that safe is `inert`, never `aria-hidden`: a permanently
// mounted panel full of buttons behind `aria-hidden` IS the `aria-hidden-focus` violation, while `inert`
// takes the closed panel out of tab order AND the accessibility tree (React 19 exposes it as a real boolean
// prop; BottomSheet applies the same thing imperatively to its below-the-fold content). `pointer-events:
// none` on the closed shell is the pointer half of the same contract.
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

  const agents = getKnownAgents();
  const skills = getKnownSkills();
  // D70 §8.4 — the picker's rows lead with the agent's avatar where it has one. Resolved ONCE here and
  // threaded down: the rows are a `.map()`, and one resolver serves the whole group (`useAgentArt`).
  const art = useAgentArt();
  const armed = scope.agent !== undefined || scope.skills.length > 0;
  // The radio group must tell the TRUTH about where the next message goes: the armed pick if the menu armed
  // one, else the ladder a plain send would route by — the sticky `/agent <name>`, else the OPEN THREAD's
  // own pin (wave 1c: a thread pinned to a character routes there, and the group used to check the default
  // row over it), else the configured default. Reading both pins non-reactively is safe — the sticky one
  // changes by SENDING `/agent …`, and typing that `/` hands the overlay slot to the suggest popover, which
  // CLOSES this panel; the thread pin changes only by opening another conversation or `/clear`, neither of
  // which happens with this panel up. Reopening re-reads. (That still holds now the panel stays mounted:
  // `open` flipping IS a re-render of this component, so reopening re-reads exactly as remounting used to.)
  //
  // A pin that isn't a CONFIGURED agent reads as the default row (Codex, verify round) — the
  // `effectiveAgent` ladder over `validSessionAgent`, shared with the agent backdrop since D70 S6 (see its
  // note in `lib/composer.ts`, which mirrors the server's own routing line). DISPLAY only: neither pin and
  // no send path is touched, and `armed` (the dot) still keys off the one-shot alone.
  const routedAgent =
    scope.agent !== undefined
      ? scope.agent
      : effectiveAgent(getSessionAgent(), getThreadAgent(), agents);

  return (
    <div
      className={"tools-sheet" + (open ? " open" : "")}
      id={TOOLS_SHEET_ID}
      role="region"
      aria-label="agent and skills for the next message"
      inert={!open}
    >
      <div className="tools-sec">
        <div className="tools-lbl" id={AGENTS_LABEL_ID}>
          agent
        </div>
        <div className="tools-list" role="radiogroup" aria-labelledby={AGENTS_LABEL_ID}>
          <AgentRow
            name={getDefaultAgent()}
            tag="default"
            on={routedAgent === null}
            value={null}
            art={art}
          />
          {agents.map((n) => (
            <AgentRow key={n} name={n} on={routedAgent === n} value={n} art={art} />
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
 *  D70 §8.4 — the name is LED by the agent's avatar as a small circle when it has one; an agent with no
 *  art (every agent before this phase) renders exactly the row it always did.
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
  art,
}: {
  name: string;
  tag?: string;
  on: boolean;
  value: string | null;
  art: (name: string | null) => AgentArt;
}) {
  const avatar = art(value).avatar;
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
      {/* ADDITIVE, never a swap: the tick keeps the selection gutter (which is what lines the names
          up), and the picture leads the name. A row for an agent with no avatar is byte-identical to
          today's. `alt=""` — the name is right beside it, so the image is decoration. */}
      {avatar && (
        <FocalImg
          className="tools-face"
          src={avatar.url}
          art={avatar.focus}
          alt=""
          draggable={false}
        />
      )}
      <span className="tools-name">{name}</span>
      {tag && <span className="tools-tag">{tag}</span>}
    </label>
  );
}
