import { useActiveAgent } from "./useActiveAgent";
import { useAgentArt, type BoundArt } from "./useAgentArt";

// WHICH agent's art the backdrop paints (D70 §8.3a item 2) — the one answer every backdrop consumer
// takes, so the rule lives once instead of in each theme's body.
//
// THE RULE, and what it deliberately excludes:
//   · the ACTIVE agent is the SERVER's routing ladder, mirrored (`lib/composer#effectiveAgent`): the
//     sticky pin when it is set (`/agent`, the gallery's Talk, the composer tools menu's agent
//     rows — one seam, `pinStickyAgent`), else the OPEN THREAD's own D11 pin, else the resolved default
//     (whose own art may paint — a fresh install with art on the default agent shows it). The thread rung
//     is what wave 1c added: booting into a thread pinned to a character replied as that character while
//     this surface still painted the default (owner glance 2026-09-08), and §8.3a's rule is that the
//     surface belongs to whoever the NEXT message runs as — so it has to read what actually routes it;
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
// THE LADDER ITSELF LIVES IN `lib/composer` (`effectiveAgent`, over `validStickyAgent`), and the ONE
// subscription that feeds it — the sticky pin, the thread pin, the roster QUERY — is `useActiveAgent`,
// taken by this hook AND by the tools menu's checked row, which is the only way those two can keep
// answering the same question the same way.

/** The ACTIVE agent's bound `background`, its `avatar` when it binds no background, or `undefined` when
 *  there is neither to paint — the agent binds nothing, binds entries the library no longer holds, or binds
 *  ones the owner switched off / the server cannot read (all three already folded by `useAgentArt`).
 *  `undefined` is the whole "no backdrop" signal: the kit layer mounts nothing, and gacha falls through to
 *  its own oracle ladder.
 *
 *  The fallback lives HERE and nowhere lower: `AgentArt.background` stays the truthful binding, because the
 *  picker and the who-line read the two fields separately. This is also the ONE statement the paint and the
 *  gallery's outranked REPORT both take (`tabs/AgentTab`, `themes/gacha/GachaAgent`, `hooks/useMediaLibrary`),
 *  so an avatar standing in as the backdrop is reported live by exactly the same rule that paints it — and
 *  the call screen wears it too, because a call's turns route by the same ladder. */
export function useActiveBackdrop(): BoundArt | undefined {
  const art = useAgentArt();
  const a = art(useActiveAgent());
  return a.background ?? a.avatar;
}
