import { routedAgent } from "../lib/composer";
import { useSessionAgent, useThreadAgent } from "../store/chat";
import { previewAgent, useComposerScope } from "../store/composerScope";
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
//   · …and the composer's ONE-SHOT ARMED PICK OUTRANKS that whole ladder (owner re-ruling 2026-09-22,
//     superseding §8.3a's exclusion of it): arming an agent in the tools menu is the owner saying who
//     the next message runs as, and the surface that belongs to "whoever the next message runs as" must
//     therefore SHOW them — before sending, which is the point of arming. So this module imports
//     `composerScope` BY DESIGN now. THE PREVIEW HOLDS THROUGH THAT MESSAGE'S OWN TURN (review round
//     C2, amending the re-ruling's first shape): the one-shot is spent at DISPATCH, and reverting there
//     put the ladder's face up for exactly the turn the armed agent was answering — an ordinary thread
//     carries no pin, so the preview collapsed to the DEFAULT at the send moment and never came back.
//     So the pick is read at its two stages — `agent` while armed, `spent` while its message is in
//     flight — and the ladder takes the surface back when that send settles. One-shot is unchanged as a
//     ROUTING rule; what changed is only how long the surface tells the truth about it;
//   · that agent's OWN ART WINS, in one order: its bound `background` first, its `avatar` standing in when
//     no background is bound (owner ruling 2026-09-08 — a character card import binds only the avatar, and
//     the owner expects that picture behind the chat rather than the theme's default). Only the agent's own
//     two bindings are ever read: nothing here reaches for another agent's art or a theme's;
//   · a per-bubble `m.agent` NEVER drives it, and that exclusion STANDS. The transcript can hold turns from
//     several agents; the backdrop is ONE image for the surface, and the surface belongs to whoever the
//     next message runs as. This module importing no message list is what enforces it.
//
// `null` is handed to `useAgentArt`'s resolver on purpose rather than resolved here: `art(null)` already
// means "whichever agent a bare turn runs as", so the default's slug is looked up in exactly one place.
//
// THE LADDER ITSELF LIVES IN `lib/composer` (`routedAgent`, review round C3), beside `effectiveAgent` and
// `validSessionAgent` it is built from — one pure claim about routing, taken by this hook AND by the tools
// menu's checked row, which is the only way those two can keep answering the same question the same way.

/** The ACTIVE agent's bound `background`, its `avatar` when it binds no background, or `undefined` when
 *  there is neither to paint — the agent binds nothing, binds entries the library no longer holds, or binds
 *  ones the owner switched off / the server cannot read (all three already folded by `useAgentArt`).
 *  `undefined` is the whole "no backdrop" signal: the kit layer mounts nothing, and gacha falls through to
 *  its own oracle ladder.
 *
 *  The fallback lives HERE and nowhere lower: `AgentArt.background` stays the truthful binding, because the
 *  picker and the who-line read the two fields separately. This is also the ONE statement the paint and the
 *  gallery's outranked REPORT both take (`tabs/AgentTab`, `themes/gacha/GachaAgent`, `hooks/useMediaLibrary`),
 *  so an avatar standing in as the backdrop is reported live by exactly the same rule that paints it.
 *
 *  `armedPick` is the ONE thing a consumer may differ on (review round C1): whether the composer's pick
 *  belongs in the answer at all. It does for every surface that paints or reports the CHAT — the gallery's
 *  outranked report included, because its whole job is to say what the chat surface is showing. It does
 *  NOT for the CALL screen: a call's turns go out through `sendCallTranscript`, which deliberately never
 *  spends the one-shot, so an armed pick is an agent that call will not route to and a face it must not
 *  wear. One parameter, defaulting to the common case, rather than a second hook. */
export function useActiveBackdrop(armedPick = true): BoundArt | undefined {
  const art = useAgentArt();
  const sticky = useSessionAgent();
  // …and the OPEN THREAD's pin, the ladder's second rung (reactive: opening another conversation must
  // repaint, exactly as switching character does).
  const thread = useThreadAgent();
  // The one-shot, reactive for the same reason both pins are: arming it has to repaint NOW — the
  // preview is the feature (the store hands back a stable reference, its own snapshot contract).
  // Subscribed even where it is not read, because a hook may not be called conditionally; the cost is
  // one no-op render on the call screen if the owner arms a pick mid-call, and the alternative is a
  // second hook saying the same thing.
  const scope = useComposerScope();
  // THE PICK AT WHICHEVER STAGE IT IS IN: armed, else held for the message it was spent on, else nothing
  // — `previewAgent`, the store's own statement of it (review F4), so no consumer grows a private `??`.
  const pick = armedPick ? previewAgent(scope) : undefined;
  // The SPECIALIST list, from the same always-on query `useAgentArt` reads (one observer's worth of data,
  // shared by key) — not `getKnownAgents()`, whose module-level Set is non-reactive and so could not
  // repaint the backdrop when an agent is created or renamed.
  const agents = useAgentRoster().data?.agents;
  const a = art(routedAgent(pick, sticky, thread, agents ?? []));
  return a.background ?? a.avatar;
}
