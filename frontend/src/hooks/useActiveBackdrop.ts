import { effectiveAgent } from "../lib/composer";
import { useSessionAgent, useThreadAgent } from "../store/chat";
import { useAgentArt, type BoundArt } from "./useAgentArt";
import { useAgentRoster } from "./useAgents";

// WHICH agent's art the backdrop paints (D70 §8.3a item 2) — the one answer every backdrop consumer
// takes, so the rule lives once instead of in each theme's body.
//
// THE RULE, and what it deliberately excludes:
//   · the ACTIVE agent is the SERVER's routing ladder, mirrored (`lib/composer#effectiveAgent`): the
//     sticky session pin when it is set, else the OPEN THREAD's own D11 pin, else the resolved default
//     (whose own art may paint — a fresh install with art on the default agent shows it). The thread rung
//     is what wave 1c added: booting into a thread pinned to a character replied as that character while
//     this surface still painted the default (owner glance 2026-09-08), and §8.3a's rule is that the
//     surface belongs to whoever the NEXT message runs as — so it has to read what actually routes it;
//   · that agent's OWN ART WINS, in one order: its bound `background` first, its `avatar` standing in when
//     no background is bound (owner ruling 2026-09-08 — a character card import binds only the avatar, and
//     the owner expects that picture behind the chat rather than the theme's default). Only the agent's own
//     two bindings are ever read: nothing here reaches for another agent's art or a theme's;
//   · a per-bubble `m.agent` NEVER drives it. The transcript can hold turns from several agents; the
//     backdrop is ONE image for the surface, and the surface belongs to whoever the next message runs as;
//   · the composer's ONE-SHOT armed pick (`store/composerScope`) does not flip it either. A single-message
//     target is not a change of operator — only switching characters (Talk / `/agent`) is. This module
//     importing neither `composerScope` nor the message list is what enforces both exclusions.
//
// `null` is handed to `useAgentArt`'s resolver on purpose rather than resolved here: `art(null)` already
// means "whichever agent a bare turn runs as", so the default's slug is looked up in exactly one place.

/** The ACTIVE agent's bound `background`, its `avatar` when it binds no background, or `undefined` when
 *  there is neither to paint — the agent binds nothing, binds entries the library no longer holds, or binds
 *  ones the owner switched off / the server cannot read (all three already folded by `useAgentArt`).
 *  `undefined` is the whole "no backdrop" signal: the kit layer mounts nothing, and gacha falls through to
 *  its own oracle ladder.
 *
 *  The fallback lives HERE and nowhere lower: `AgentArt.background` stays the truthful binding, because the
 *  picker and the who-line read the two fields separately. This is also the ONE statement the paint and the
 *  gallery's outranked REPORT both take (`tabs/AgentTab`, `themes/gacha/GachaAgent`, `hooks/useMediaLibrary`),
 *  so an avatar standing in as the backdrop is reported live by exactly the same rule that paints it. */
export function useActiveBackdrop(): BoundArt | undefined {
  const art = useAgentArt();
  const sticky = useSessionAgent();
  // …and the OPEN THREAD's pin, the ladder's second rung (reactive: opening another conversation must
  // repaint, exactly as switching character does).
  const thread = useThreadAgent();
  // The SPECIALIST list, from the same always-on query `useAgentArt` reads (one observer's worth of data,
  // shared by key) — not `getKnownAgents()`, whose module-level Set is non-reactive and so could not
  // repaint the backdrop when an agent is created or renamed.
  const agents = useAgentRoster().data?.agents;
  const a = art(effectiveAgent(sticky, thread, agents ?? []));
  return a.background ?? a.avatar;
}
