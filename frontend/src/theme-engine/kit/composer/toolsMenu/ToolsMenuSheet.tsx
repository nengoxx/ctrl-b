import { useEffect } from "react";

import { FocalFace } from "../../../../components/FocalFace";
import { useActiveAgent } from "../../../../hooks/useActiveAgent";
import { useAgentArt, type AgentArt } from "../../../../hooks/useAgentArt";
import { DEFAULT_AGENT, useAgentRoster } from "../../../../hooks/useAgents";
import {
  defaultAgentPin,
  getKnownSkills,
  pinSessionAgent,
  useVerbsVersion,
} from "../../../../lib/composer";
import { useThreadAgent } from "../../../../store/chat";
import { releaseComposerOverlay, useComposerOverlayOpen } from "../../../../store/composerOverlay";
import {
  clearComposerSkills,
  toggleComposerSkill,
  useComposerSkills,
} from "../../../../store/composerSkills";

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
// Two sections, two lifetimes (D75 ruling, 2026-09-24):
//   • AGENT  — radio: the ACTIVE agent, STICKY. A row is the same switch `/agent <name>` and the agents
//     gallery's Talk button flip (`lib/composer#pinSessionAgent` → `store/chat` `sessionAgent`), so it
//     holds until switched again. The "default" row clears the pin — or, inside a thread that carries its
//     own D70 §4.2 pin, pins the default BY NAME, because a clear would let the thread's agent resurface.
//   • SKILLS — checkboxes: the discovered skills, ticked for the NEXT message only (`store/composerSkills`,
//     spent on dispatch).
// The skills read the composer's own verb set (`lib/composer`), the same source `/<skill>` routes from — so
// the menu can never offer a skill the router wouldn't accept, and it costs no extra fetch. The AGENTS read
// the always-on ROSTER QUERY (`useAgentRoster`) — the same source the backdrop paints by — and NOT the
// composer's module-level `/agent` set: that Set is best-effort (filled once at import, refreshed only by
// a save, kept as-is on a failed load), so after a failed first load it listed no agent and checked the
// default row while the backdrop painted the pinned character (the sticky slice's review, 2026-09-24).
// `useActiveAgent` is the one subscription both surfaces take for the checked row.

/** The panel element id — one composer is mounted at a time, like `#composer-suggest`/`#cmd-input`. */
export const TOOLS_SHEET_ID = "composer-tools";

const AGENTS_LABEL_ID = "composer-tools-agents";
const SKILLS_LABEL_ID = "composer-tools-skills";
/** The shared `name` binding the agent rows into ONE native radio group (see `AgentRow`). Document-unique
 *  by the same rule as the ids above: one composer is mounted at a time. */
const AGENT_RADIO_NAME = "composer-tools-agent";

export function ToolsMenuSheet() {
  const open = useComposerOverlayOpen("menu");
  const ticked = useComposerSkills();
  // Re-derive when a loader installs a fresh set (a version, not the sets — createStore's snapshot
  // contract; see `useVerbsVersion`). Derived per render: the lists are tiny.
  useVerbsVersion();
  // Hand the overlay slot back on UNMOUNT (Codex, round 2). The panel is the composer's `overlay` slot, so
  // a tab or layout swap that drops the composer unmounts it — with the slot still naming "menu", nothing
  // else could claim the space and the menu would spring open again on the next mount. Guarded: if another
  // surface displaced us it owns the slot and keeps it. (The plan sheet's persistence is DELIBERATE — a
  // plan outlives the composer's mount; an open menu doesn't.)
  useEffect(() => () => releaseComposerOverlay("menu"), []);

  // The roster, and its resolved default — `DEFAULT_AGENT` stands in until the query lands (the gallery's
  // own fallback); the rows fill in on the same render the backdrop would.
  const roster = useAgentRoster().data;
  const agents = roster?.agents ?? [];
  const defaultAgent = roster?.default ?? DEFAULT_AGENT;
  const skills = getKnownSkills();
  // D70 §8.4 — the picker's rows lead with the agent's avatar where it has one. Resolved ONCE here and
  // threaded down: the rows are a `.map()`, and one resolver serves the whole group (`useAgentArt`).
  const art = useAgentArt();
  const armed = ticked.length > 0;
  // The radio group checks the ACTIVE agent: the server's routing ladder (`useActiveAgent`, the one
  // subscription the agent backdrop paints by) — the sticky pin, else the OPEN THREAD's own pin, else the
  // configured default. A pin that isn't a configured agent folds to the default row (the server's own
  // answer for an unknown name), and a pin AT the default's name — what the default row writes inside a
  // pinned thread — folds there too, so the default row reads checked in both of its representations.
  // Both pins are subscribed inside the hook: the sticky one because this panel WRITES it (a pick must
  // repaint the open group) and `/agent` or the gallery's Talk can move it from elsewhere; the thread pin
  // because it arrives on its own, from `openThread`'s LATE list read, and can land while the panel is up.
  const active = useActiveAgent() ?? defaultAgent;
  // …read here too, for what the default row WRITES (`defaultAgentPin`): a clear, or the default by name.
  const threadAgent = useThreadAgent();

  return (
    <div
      className={"tools-sheet" + (open ? " open" : "")}
      id={TOOLS_SHEET_ID}
      role="region"
      aria-label="active agent, and skills for the next message"
      inert={!open}
    >
      <div className="tools-sec">
        <div className="tools-lbl" id={AGENTS_LABEL_ID}>
          active agent
        </div>
        <div className="tools-list" role="radiogroup" aria-labelledby={AGENTS_LABEL_ID}>
          <AgentRow
            name={defaultAgent}
            tag="default"
            on={active === defaultAgent}
            pin={defaultAgentPin(threadAgent, defaultAgent)}
            avatar={art(null).avatar}
          />
          {agents.map((n) => (
            <AgentRow key={n} name={n} on={active === n} pin={n} avatar={art(n).avatar} />
          ))}
        </div>
      </div>
      <div className="tools-sec">
        <div className="tools-lbl" id={SKILLS_LABEL_ID}>
          skills · next message
        </div>
        {skills.length === 0 ? (
          <p className="tools-empty">// none discovered</p>
        ) : (
          <div className="tools-list" role="group" aria-labelledby={SKILLS_LABEL_ID}>
            {skills.map((n) => {
              const on = ticked.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={"tools-row" + (on ? " on" : "")}
                  onClick={() => toggleComposerSkill(n)}
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
      {/* Only when a skill IS ticked — an always-present "clear" reads as an action with nothing to do.
          It clears the skills alone: the agent is a standing switch, and its own "default" row is how it
          goes back. The panel never closes on a pick — agent + skills are usually chosen together, and
          the trigger is the close gesture. */}
      {armed && (
        <button type="button" className="tools-clear" onClick={clearComposerSkills}>
          clear
        </button>
      )}
    </div>
  );
}

/** One agent radio row. `pin` is what choosing it hands `pinSessionAgent` — the agent's name, or `""`
 *  (the session-pin CLEAR) for the default row outside a thread-pinned conversation.
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
  pin,
  avatar,
}: {
  name: string;
  tag?: string;
  on: boolean;
  pin: string;
  avatar: AgentArt["avatar"];
}) {
  return (
    <label className={"tools-row" + (on ? " on" : "")}>
      <input
        type="radio"
        className="tools-radio"
        name={AGENT_RADIO_NAME}
        checked={on}
        onChange={() => pinSessionAgent(pin)}
      />
      <span className="tools-tick" aria-hidden>
        {on ? "•" : ""}
      </span>
      {/* ADDITIVE, never a swap: the tick keeps the selection gutter (which is what lines the names
          up), and the picture leads the name. A row for an agent with no avatar is byte-identical to
          today's. The name is right beside it, so the picture is decoration — and since wave 3 it is a
          CIRCLE window like the who-line's, framed by the same measurement-free rule (`FocalFace`)
          instead of by a `ResizeObserver` per row. */}
      {avatar && <FocalFace className="tools-face" src={avatar.url} art={avatar.focus} />}
      <span className="tools-name">{name}</span>
      {tag && <span className="tools-tag">{tag}</span>}
    </label>
  );
}
