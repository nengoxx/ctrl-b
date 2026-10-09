import { useEffect, useRef } from "react";

import { FocalFace } from "../../../../components/FocalFace";
import { useHomeAgent } from "../../../../hooks/useActiveAgent";
import { useAgentArt, type AgentArt } from "../../../../hooks/useAgentArt";
import { DEFAULT_AGENT, useAgentRoster } from "../../../../hooks/useAgents";
import { useOutsideDismiss } from "../../../../hooks/useOutsideDismiss";
import { getKnownSkills, useVerbsVersion } from "../../../../lib/composer";
import { openAgentConversation } from "../../../../store/chat";
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
// Two sections, two lifetimes:
//   • AGENTS — the ROSTER DOOR (D84 §2 R16, R38, O4): every activation of a row — the already-checked one
//     included — opens that agent's LATEST conversation, or mints it a greeted one
//     (`store/chat#openAgentConversation`, the same door the agents gallery's Talk takes). The CHECKED row
//     is the open conversation's HOME agent ("the conversation you are in", R38) — never the responder an
//     `/agent <name>` set: who ANSWERS shows on the backdrop, the who-line, and `/agent`'s own note.
//   • SKILLS — checkboxes: the discovered skills, ticked for the NEXT message only (`store/composerSkills`,
//     spent on dispatch).
// The skills read the composer's own verb set (`lib/composer`), the same source `/<skill>` routes from — so
// the menu can never offer a skill the router wouldn't accept, and it costs no extra fetch. The AGENTS read
// the always-on ROSTER QUERY (`useAgentRoster`) — the same source the backdrop paints by — and NOT the
// routing's module copy (`lib/roster`): that copy is best-effort (filled at import, refreshed by a save,
// kept as-is on a failed load), so after a failed first load it listed no agent and checked the default
// row while the backdrop painted the pinned character (the D75 slice's review, 2026-09-24). The checked
// row is fed by `useHomeAgent` (the conversation's HOME, R38) over that same query; the backdrop by
// `useActiveAgent` (who answers).

/** The panel element id — one composer is mounted at a time, like `#composer-suggest`/`#cmd-input`. */
export const TOOLS_SHEET_ID = "composer-tools";
/** The trigger's id — declared HERE, beside the panel's, because the trigger already imports from this
 *  module and the panel needs it too (the outside-tap exclusion, the focus return after a pick). */
export const TOOLS_TRIGGER_ID = "composer-tools-trigger";

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
  // LIGHT DISMISS (owner, 2026-10-01): a pointer going down outside the panel closes it, and still does its
  // own job (the shared hook's NavMenu contract). The TRIGGER counts as inside: it is a separate slot, and
  // its own click toggles — a close on its pointerdown would have that click re-open the menu.
  useOutsideDismiss(
    open,
    (t) =>
      !!document.getElementById(TOOLS_SHEET_ID)?.contains(t) ||
      !!document.getElementById(TOOLS_TRIGGER_ID)?.contains(t),
    () => releaseComposerOverlay("menu"),
  );
  // Set by an ARROW keydown in the agent group: the browser's arrow-key radio navigation dispatches a
  // `click` on the newly checked radio, and that is browsing, not a pick — so it must not close the panel.
  // SPENT by the click it guards (a held arrow re-sets it on every repeat keydown), and also cleared on
  // the group's keyup (an arrow that moved nothing — a one-row group), on a pointer going down on it, and
  // whenever the panel opens: a keyup can land elsewhere (a discard confirm took focus mid-keypress, an
  // outside tap closed the panel), and a stale guard would swallow the next real pick's close.
  const arrowNav = useRef(false);
  useEffect(() => {
    if (open) arrowNav.current = false;
  }, [open]);
  /** An agent row was ACTIVATED (tap, Space, a TalkBack double-tap — the checked row included): the owner
   *  picked who to talk to, so the panel closes (owner, 2026-10-01; skills keep it open — several are
   *  ticked together), and that agent's conversation opens. Focus goes back to the trigger, as NavMenu's
   *  close does: the radio it sat on is now inside an inert panel. An arrow-key BROWSE is not a pick: it
   *  neither closes the panel nor opens anything. */
  const picked = (name: string): void => {
    if (arrowNav.current) {
      arrowNav.current = false;
      return;
    }
    releaseComposerOverlay("menu");
    document.getElementById(TOOLS_TRIGGER_ID)?.focus();
    void openAgentConversation(name);
  };

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
  // The radio group checks the open conversation's HOME (R38 — `useHomeAgent`, folded through the same
  // roster query: a home off the roster reads as the configured default's row, ISS-51's paint; the
  // thread-less view's home-to-be IS the default). Subscribed, because the home can arrive on its own —
  // from `openThread`'s LATE list read — while the panel is up, and a door opened elsewhere moves it.
  const home = useHomeAgent() ?? defaultAgent;
  // THE ROWS (D75 amendment code round): the ROOT first — it is never in the roster's `agents`, so it
  // needs its own row — then each specialist, ONCE. The resolved default's row (the root, or a specialist
  // promoted to the default) carries the "default" tag, meaning "what a bare conversation resolves to";
  // the root row, when it is NOT that, reads "root" (its slug is "default", and two rows reading
  // "default" was the code round's catch).
  const rows = [DEFAULT_AGENT, ...agents.filter((n) => n !== DEFAULT_AGENT)];

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
        <div
          className="tools-list"
          role="radiogroup"
          aria-labelledby={AGENTS_LABEL_ID}
          onKeyDown={(e) => {
            if (e.key.startsWith("Arrow")) arrowNav.current = true;
          }}
          onKeyUp={() => (arrowNav.current = false)}
          onPointerDown={() => (arrowNav.current = false)}
        >
          {rows.map((n) => (
            <AgentRow
              key={n}
              name={n}
              title={roster?.summaries?.[n]?.title || n}
              tag={n === defaultAgent ? "default" : n === DEFAULT_AGENT ? "root" : undefined}
              on={home === n}
              avatar={art(n).avatar}
              onPick={() => picked(n)}
            />
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
          goes back. A skill tick keeps the panel open (several ride one message); an agent pick closes it. */}
      {armed && (
        <button type="button" className="tools-clear" onClick={clearComposerSkills}>
          clear
        </button>
      )}
    </div>
  );
}

/** One agent radio row — a ROSTER DOOR: activating it (`onPick`, the already-checked row included) opens
 *  the agent's conversation. The radio's own `onChange` deliberately does NOTHING (O4): it fires only on a
 *  CHANGE, so a door hung on it would skip the checked row; the native input stays for its a11y (below),
 *  and its accessible description says what activation does ("open <Name>'s conversation").
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
  title,
  tag,
  on,
  avatar,
  onPick,
}: {
  name: string;
  /** The display name (the agent's `title`, else its slug) — the accessible description's `<Name>`. */
  title: string;
  tag?: string;
  on: boolean;
  avatar: AgentArt["avatar"];
  /** Every activation, the already-checked row included (`onChange` fires only on a change). */
  onPick: () => void;
}) {
  return (
    <label className={"tools-row" + (on ? " on" : "")}>
      <input
        type="radio"
        className="tools-radio"
        name={AGENT_RADIO_NAME}
        checked={on}
        aria-description={`open ${title}'s conversation`}
        onClick={onPick}
        // A controlled radio needs a handler; the door is `onClick` (every activation), never this.
        onChange={() => {}}
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
