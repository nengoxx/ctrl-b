import { validSessionAgent } from "../lib/composer";
import { useSessionAgent } from "../store/chat";
import { useAgentArt, type BoundArt } from "./useAgentArt";
import { useAgentRoster } from "./useAgents";

// WHICH agent's art the backdrop paints (D70 §8.3a item 2) — the one answer every backdrop consumer
// takes, so the rule lives once instead of in each theme's body.
//
// THE RULE, and what it deliberately excludes:
//   · the ACTIVE agent is the sticky session pin when it names a configured agent, else the resolved
//     default (whose own `background` may paint — a fresh install with art on the default agent shows it);
//   · a per-bubble `m.agent` NEVER drives it. The transcript can hold turns from several agents; the
//     backdrop is ONE image for the surface, and the surface belongs to whoever the next message runs as;
//   · the composer's ONE-SHOT armed pick (`store/composerScope`) does not flip it either. A single-message
//     target is not a change of operator — only switching characters (Talk / `/agent`) is. This module
//     importing neither `composerScope` nor the message list is what enforces both exclusions.
//
// `null` is handed to `useAgentArt`'s resolver on purpose rather than resolved here: `art(null)` already
// means "whichever agent a bare turn runs as", so the default's slug is looked up in exactly one place.

/** The ACTIVE agent's bound `background`, or `undefined` when there is none to paint — the agent binds
 *  nothing, binds an entry the library no longer holds, or binds one the owner switched off / the server
 *  cannot read (all three already folded by `useAgentArt`). `undefined` is the whole "no backdrop" signal:
 *  the kit layer mounts nothing, and gacha falls through to its own oracle ladder. */
export function useActiveBackdrop(): BoundArt | undefined {
  const art = useAgentArt();
  const sticky = useSessionAgent();
  // The SPECIALIST list, from the same always-on query `useAgentArt` reads (one observer's worth of data,
  // shared by key) — not `getKnownAgents()`, whose module-level Set is non-reactive and so could not
  // repaint the backdrop when an agent is created or renamed.
  const agents = useAgentRoster().data?.agents;
  return art(validSessionAgent(sticky, agents ?? [])).background;
}
