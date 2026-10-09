import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getJSON } from "../api/client";
import { onThreadListsStale, returnToChat } from "../store/chat";
import { getUI, useUISlice } from "../store/ui";
import type { ThreadSummary } from "../types";

// D84 §6 "Query vs store" (DESIGN §13 as amended): the thread LIST is ordinary server state — one
// `useQuery(['threads', agent])` per agent — while the MESSAGES stay in `store/chat` with the SSE reducer.
// The per-agent conversations sheet (S9) is this hook's consumer; S7b builds the hook with no UI.

/** One page of an agent's conversations — the sheet's page size (§4: `limit=50`; the route caps 1..200). */
export const THREADS_PAGE = 50;

/** The keyset cursor for the page AFTER `row` (§4: `before=<updated_at ISO>,<id>` for `ORDER BY
 *  updated_at DESC, id DESC`) — the ISO carries `+00:00`, so it goes through `encodeURIComponent`
 *  (`threadsPath`). The PAGING SEAM: S9's "Show older" builds its next read from the last row it holds
 *  (a `useInfiniteQuery` over the same key, or a second read appended in place) — the first page is all
 *  this hook reads today. */
export function beforeCursor(row: Pick<ThreadSummary, "updated_at" | "id">): string {
  return `${row.updated_at},${row.id}`;
}

/** `GET /api/threads?agent=<slug>&limit=<n>[&before=<cursor>]` — every part encoded. A slug NOT on the
 *  roster answers `[]` (§12.3 M7: an orphaned home is listed nowhere). */
export function threadsPath(agent: string, opts?: { limit?: number; before?: string }): string {
  const q = [
    `agent=${encodeURIComponent(agent)}`,
    `limit=${opts?.limit ?? THREADS_PAGE}`,
    ...(opts?.before === undefined ? [] : [`before=${encodeURIComponent(opts.before)}`]),
  ];
  return `/api/threads?${q.join("&")}`;
}

/** ONE agent's conversations, newest first, each with its five summary fields (§4) — the first page.
 *  Keyed `['threads', agent]`, so the ONE bridge below (`['threads']`, a prefix) refreshes every cached
 *  agent's list when the store learns the lists are stale. `enabled` lets the sheet read only while open. */
export function useThreads(agent: string, opts?: { enabled?: boolean }) {
  return useQuery<ThreadSummary[]>({
    queryKey: ["threads", agent],
    queryFn: () => getJSON<ThreadSummary[]>(threadsPath(agent)),
    enabled: opts?.enabled ?? true,
  });
}

/** THE ONE BRIDGE between the chat store and the server-state cache (D84 §6; S6's recorded obligation —
 *  "S7's thread-list hook MUST subscribe to `onThreadListsStale`"). Mounted ONCE, at the shell root
 *  (`AppEngines`, beside `useForegroundNotifications`) — nothing else subscribes:
 *    · the store PUBLISHES "the thread lists are stale" (a 404 on a door, the R29 path, every successful
 *      seen write — O10) and this invalidates `['threads']` (every agent's list) + `['agents']` (the
 *      roster's per-agent `status`, R25). A plain module cannot reach the QueryClient, hence the bus.
 *    · the seen write's RETURN trigger (R30, Sol F2): the ONE `visibilitychange` listener + the one
 *      `ui.tab` subscription — becoming visible while the chat tab is on screen, or the chat tab coming
 *      back while the page is visible, runs `returnToChat` (the refetch, THEN the seen write on the
 *      refreshed view). One mount, one teardown; not one listener per component. */
export function useThreadListsBridge(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      onThreadListsStale(() => {
        void qc.invalidateQueries({ queryKey: ["threads"] });
        void qc.invalidateQueries({ queryKey: ["agents"] });
      }),
    [qc],
  );
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === "visible" && getUI().tab === "agent") void returnToChat();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const tab = useUISlice((s) => s.tab);
  const prevTab = useRef(tab);
  useEffect(() => {
    const was = prevTab.current;
    prevTab.current = tab;
    if (tab === "agent" && was !== "agent" && document.visibilityState === "visible")
      void returnToChat();
  }, [tab]);
}
