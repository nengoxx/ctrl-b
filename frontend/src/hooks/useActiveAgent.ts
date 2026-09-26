import { effectiveAgent } from "../lib/composer";
import { useStickyAgent, useThreadAgent } from "../store/chat";
import { useAgentRoster } from "./useAgents";

// WHO THE NEXT MESSAGE RUNS AS — the server's routing ladder, mirrored, as ONE subscription every
// surface that has to answer that question takes: the agent backdrop (`useActiveBackdrop`) and the
// composer tools menu's checked row. The ladder itself is the pure `lib/composer#effectiveAgent`
// (the sticky pin when it is set — `/agent`, the gallery's Talk, the tools menu's agent rows,
// one seam, `pinStickyAgent` — else the OPEN THREAD's own D11 pin, else the resolved default); this
// hook is what feeds it the SAME three inputs everywhere, which is the only way two surfaces can keep
// answering the same question the same way.
//
// The agent list is the always-on ROSTER QUERY (`useAgentRoster`, the `["agents"]` key every agent
// write invalidates) — never `lib/composer`'s module-level `/agent` validation set. That Set is
// best-effort by design (filled once at import, refreshed only by a save, and it keeps whatever it had
// when a load fails), so a menu drawn from it after a failed first load — the PWA opening from its
// shell while Tailscale is still connecting — listed no agent and checked the default row while the
// backdrop, drawn from the retrying query, painted the pinned character (the sticky slice's review
// round, 2026-09-24). The query retries, refetches on focus, and is invalidated by every roster write.
//
// `null` = the resolved default: the caller decides what that means for it (`useAgentArt`'s
// `art(null)` resolves the default's slug in exactly one place; the menu checks its default row).

/** The active agent's slug, or `null` for the resolved default. Reactive over all three rungs. */
export function useActiveAgent(): string | null {
  const sticky = useStickyAgent();
  // …and the OPEN THREAD's pin, the ladder's second rung (reactive: opening another conversation must
  // repaint, exactly as switching character does; it arrives LATE from `openThread`'s list read).
  const thread = useThreadAgent();
  // `undefined` until the roster lands — `effectiveAgent` judges nothing before then (D75 amendment).
  return effectiveAgent(sticky, thread, useAgentRoster().data?.agents);
}
