import { useState } from "react";

import { AgentRow, NewAgentRow } from "../components/AgentsEditor";
import { FocalImg } from "../components/FocalImg";
import { useAgentArt, type AgentArt } from "../hooks/useAgentArt";
import { DEFAULT_AGENT, useAgentList } from "../hooks/useAgents";
import { useAgentToolGrid } from "../hooks/useActions";
import { useDefaultPrompt } from "../hooks/useDefaultPrompt";
import { useSections } from "../hooks/useSections";
import { useSkills } from "../hooks/useSkills";
import { pinSessionAgent } from "../lib/composer";

// THE AGENTS GALLERY (D70 / ROLEPLAY_PLAN §8.4) — one home for every agent regardless of kind, and
// the section the per-agent editor moved OUT of Conf into. Conf keeps the `agent.*` globals and
// nothing else (`components/AgentGlobals`).
//
// **A card grid is a stated, priced divergence** (§8.4): the field defaults to LIST and treats grids
// as info-shedding density modes, which serves catalogs of hundreds — ctrl-b is single-user with a
// handful of agents and the owner asked for a showcase. So: two columns at phone width, each card a
// portrait through its FRAMING POINT (`FocalImg` + the resolver's `art.focus` — D65's real framing,
// not an `object-position` hack) over a name/sub plate. No list/grid toggle, no virtualization, no
// long-press semantics anywhere: every affordance is visible.
//
// **Two verbs, two homes** (§8.4, deliberately inverting the field's 3/3 primary-tap-talks
// convention): a card TAP opens that agent's editor, because this is a settings surface; TALK is its
// own visible button and drives exactly the seam the `/agent` composer verb drives
// (`lib/composer#pinSessionAgent`) before landing on the chat section through the one nav chokepoint.
// The Talk button is a SIBLING of the card, never its child — a button inside a button is invalid
// HTML (the media grid's own lesson).
//
// Structurally this is gacha's `.gc-track` PRECEDENT rebuilt kit-level on the semantic tokens; not one
// line of theme CSS is copied (the D31 rule). Everything it renders about an agent comes from the ONE
// summary+media join (`hooks/useAgentArt`), so the gallery, the composer's picker and the who-line
// avatar can never disagree about what an agent looks like.

/** The card's second line: what this agent IS, in the words the old list row used. A description is
 *  the agent's own sentence and wins; without one, the row says which agent it is. */
function subtitle(name: string, description: string, isDefault: boolean): string {
  if (description.trim()) return description;
  return isDefault ? "default agent · workspace root" : `/agent ${name}`;
}

/** One agent's card: the portrait (or the quiet initial tile that stands in for one) + the plate. */
function AgentCard(props: {
  art: AgentArt;
  description: string;
  isDefault: boolean;
  isResolvedDefault: boolean;
  onOpen: () => void;
  onTalk: () => void;
}) {
  const { art } = props;
  return (
    <li className="agal-cell">
      <button type="button" className="agal-card" onClick={props.onOpen}>
        <span className="agal-art">
          {art.avatar ? (
            <FocalImg
              className="agal-img"
              src={art.avatar.url}
              art={art.avatar.focus}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            // NO AVATAR — a letter tile rather than a silhouette or an empty box: the app ships no
            // character art at all, so a fresh install is ALL of these, and a grid of identical
            // person-glyphs would say less than the initials do. Tokens only, no picture to load.
            <span className="agal-mono" aria-hidden>
              {(art.title[0] ?? "?").toUpperCase()}
            </span>
          )}
        </span>
        <span className="agal-plate">
          <b className="agal-name">{art.title}</b>
          <small className="agal-sub">
            {subtitle(art.name, props.description, props.isDefault)}
          </small>
        </span>
        {props.isResolvedDefault && <span className="badge agal-badge">default</span>}
      </button>
      <button
        type="button"
        className="agal-talk"
        aria-label={`Talk to ${art.title}`}
        onClick={props.onTalk}
      >
        talk
      </button>
    </li>
  );
}

export function AgentsTab({ active }: { active: boolean }) {
  const { data: list } = useAgentList();
  const art = useAgentArt();
  const { navigate } = useSections();
  const { toolNames, toolModes } = useAgentToolGrid();
  const { data: skillList = [] } = useSkills();
  const { data: defaultPrompt = "" } = useDefaultPrompt();
  const [open, setOpen] = useState<string | null>(null);

  const specialists = (list?.agents ?? []).filter((n) => n !== DEFAULT_AGENT);
  const resolvedDefault = list?.default ?? DEFAULT_AGENT;
  // The root/default agent first, then the list route's own order. The default ALWAYS exists (it is
  // the workspace itself), which is why a fresh install shows one card rather than an empty state.
  const names = [DEFAULT_AGENT, ...specialists];
  const skillNames = skillList.map((s) => s.name);

  const talk = (name: string) => {
    // The `/agent` seam verbatim: the resolved default is a session-agent CLEAR (bare `/agent`),
    // anything else a pin. Then the ONE nav chokepoint, which is where the chat log lives.
    pinSessionAgent(name === resolvedDefault ? "" : name);
    navigate("agent");
  };

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-agents"
      data-screen-label="05 Agents"
      role="tabpanel"
      aria-labelledby="tabbtn-agents"
    >
      <div className="sec">
        <span className="num">05</span>
        <b>Agents</b>
        <span className="right">
          {names.length} agent{names.length === 1 ? "" : "s"}
        </span>
      </div>

      {open !== null ? (
        <div className="conf-card agal-detail">
          <button type="button" className="agal-back" onClick={() => setOpen(null)}>
            ‹ all agents
          </button>
          {/* The very row the list has always opened — one form, not a second one to keep in step. */}
          <AgentRow
            name={open}
            isDefault={open === DEFAULT_AGENT}
            isResolvedDefault={resolvedDefault === open}
            open
            onToggle={() => setOpen(null)}
            toolNames={toolNames}
            toolModes={toolModes}
            skillNames={skillNames}
            defaultPrompt={defaultPrompt}
          />
        </div>
      ) : (
        <>
          <div className="conf-card agal-actions">
            <NewAgentRow taken={specialists} onCreated={setOpen} />
          </div>
          <ul className="agal-grid">
            {names.map((name) => (
              <AgentCard
                key={name}
                art={art(name)}
                description={list?.summaries?.[name]?.description ?? ""}
                isDefault={name === DEFAULT_AGENT}
                isResolvedDefault={resolvedDefault === name}
                onOpen={() => setOpen(name)}
                onTalk={() => talk(name)}
              />
            ))}
          </ul>
        </>
      )}

      <div style={{ height: 24 }} />
    </div>
  );
}
