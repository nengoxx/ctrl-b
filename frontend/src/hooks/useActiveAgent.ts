import { effectiveAgent, homeAgent } from "../lib/composer";
import { useResponder, useThreadAgent } from "../store/chat";
import { useAgentRoster } from "./useAgents";

// WHO THE NEXT MESSAGE RUNS AS — the server's routing ladder, mirrored, as ONE subscription every
// surface that has to answer that question takes: the agent backdrop (`useActiveBackdrop`) and any
// active-agent surface. The ladder itself is the pure `lib/composer#effectiveAgent` (D84 §6: the
// RESPONDER when one is set — `/agent <name>`, R45 — else the open conversation's HOME, else the
// configured default); this hook is what feeds it the SAME three inputs everywhere, which is the only
// way two surfaces can keep answering the same question the same way. The tools menu's CHECKED row is
// NOT this answer (R38): it checks the conversation's HOME (`useHomeAgent`), whoever answers.
//
// The agent list is the always-on ROSTER QUERY (`useAgentRoster`, the `["agents"]` key every agent
// write invalidates) — never `lib/composer`'s module-level `/agent` validation set. That Set is
// best-effort by design (filled once at import, refreshed only by a save, and it keeps whatever it had
// when a load fails), so a menu drawn from it after a failed first load — the PWA opening from its
// shell while Tailscale is still connecting — listed no agent and checked the default row while the
// backdrop, drawn from the retrying query, painted the pinned character (the D75 slice's review
// round, 2026-09-24). The query retries, refetches on focus, and is invalidated by every roster write.
//
// `null` = the resolved default: the caller decides what that means for it (`useAgentArt`'s
// `art(null)` resolves the default's slug in exactly one place).

/** The active agent's slug, or `null` for the resolved default. Reactive over all three rungs. */
export function useActiveAgent(): string | null {
  const responder = useResponder();
  // …and the open conversation's HOME, the ladder's second rung (reactive: opening another conversation
  // must repaint; it can arrive LATE from `openThread`'s list read).
  const thread = useThreadAgent();
  // `undefined` until the roster lands — `effectiveAgent` judges nothing before then (§12.3 M3).
  return effectiveAgent(responder, thread, useAgentRoster().data?.agents);
}

/** The open conversation's HOME agent folded through the roster (`null` = the configured default) — the
 *  tools menu's CHECKED row (R38: "the conversation you are in"). The same roster query, the same fold
 *  as `useActiveAgent`'s home rung. */
export function useHomeAgent(): string | null {
  return homeAgent(useThreadAgent(), useAgentRoster().data?.agents);
}
