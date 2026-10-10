import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { ApiError, del, getJSON, patchJSON } from "../api/client";
import { conversationRemoved, onThreadListsStale, returnToChat } from "../store/chat";
import { pushToast } from "../store/toast";
import { getUI, useUISlice } from "../store/ui";
import type { ThreadSummary } from "../types";

// D84 §6 "Query vs store" (DESIGN §13 as amended): the thread LIST is ordinary server state — one
// infinite query `['threads', agent]` per agent — while the MESSAGES stay in `store/chat` with the SSE
// reducer. Its consumers (S9b): the chat header's conversations button (the §5 dot, from the FIRST page —
// enabled whenever the home is known) and the per-home conversations sheet (every loaded page, "Show older"
// fetching the next). Rename and delete are this layer's mutations.

/** One page of an agent's conversations — the sheet's page size (§4: `limit=50`; the route caps 1..200). */
export const THREADS_PAGE = 50;

/** The keyset cursor for the page AFTER `row` (§4: `before=<updated_at ISO>,<id>` for `ORDER BY
 *  updated_at DESC, id DESC`) — the ISO carries `+00:00`, so it goes through `encodeURIComponent`
 *  (`threadsPath`). "Show older" reads the page after the LAST row loaded (`useThreads`' next param). */
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

/** The cached shape of one agent's list: its loaded pages, newest first, and each page's cursor. */
export type ThreadPages = InfiniteData<ThreadSummary[], string | undefined>;

/** ONE agent's conversations, newest first, each with its five summary fields (§4) — an INFINITE query:
 *  page one is `?agent=<slug>&limit=50`, and a page that came back FULL (`THREADS_PAGE` rows) has a next
 *  page, read from its last row's keyset cursor ("Show older"); a short page is the end. Keyed
 *  `['threads', agent]`, so the ONE bridge below (`['threads']`, a prefix) refreshes every cached agent's
 *  list when the store learns the lists are stale — an infinite query refetches EVERY loaded page in
 *  order, each cursor re-derived from the fresh page before it (TanStack v5), which is wanted.
 *
 *  NO `maxPages`: its forward fetch drops page ONE — the newest rows, the header dot's source. The
 *  always-on header's cost is bounded instead by `trimThreads` when the sheet closes (back to page one).
 *  The `QueryClient` defaults stand (a focus refetch = one page after the trim): before S10's `thread`
 *  frames (which will invalidate this key) that refetch is the dot's only freshness off the chat tab. */
export function useThreads(agent: string, opts?: { enabled?: boolean }) {
  return useInfiniteQuery<
    ThreadSummary[],
    Error,
    ThreadPages,
    readonly [string, string],
    string | undefined
  >({
    queryKey: ["threads", agent],
    queryFn: ({ pageParam }) => getJSON<ThreadSummary[]>(threadsPath(agent, { before: pageParam })),
    initialPageParam: undefined,
    getNextPageParam: (last) =>
      last.length === THREADS_PAGE ? beforeCursor(last[last.length - 1]) : undefined,
    enabled: opts?.enabled ?? true,
  });
}

/** Every loaded row, newest first — the ONE flattening the header's dot and the sheet's rows share. A page
 *  that is not a list (a malformed answer) contributes nothing rather than throwing in a render. */
export function flattenThreads(data: ThreadPages | undefined): ThreadSummary[] {
  return data?.pages.flatMap((p) => (Array.isArray(p) ? p : [])) ?? [];
}

/** Back to the FIRST page — the sheet's close path: "Show older" grows the cached list, and the header's
 *  query (always enabled) would otherwise refetch every page it ever loaded on each invalidation.
 *  FENCED against an in-flight refetch (Sol S9B-02): an infinite refetch keeps the page count it started
 *  with and would write every page back after the trim, so that exact query is CANCELLED first (its state
 *  reverts to the pre-fetch pages, then trimmed) and — since the cancel threw its fresh rows away —
 *  refetched at one page for the observers still on it (the header's dot); an IDLE query is trimmed
 *  synchronously (no cancel, no await). `keep` = "a sheet is showing this list again": judged after a
 *  microtask (so a StrictMode re-mount counts) and again after a cancel; while it holds, the pages are
 *  left alone. */
export async function trimThreads(
  qc: QueryClient,
  agent: string,
  keep: () => boolean = () => false,
): Promise<void> {
  await Promise.resolve();
  if (keep()) return;
  const key = ["threads", agent] as const;
  const toFirstPage = (): void =>
    void qc.setQueryData<ThreadPages>(key, (d) =>
      d && d.pages.length > 1
        ? { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) }
        : d,
    );
  // IDLE (Sol S9B-04): trim right here, synchronously — no cancel, no await, so no window in which an
  // invalidation could start an N-page refetch that writes N pages back after the trim.
  if (qc.isFetching({ queryKey: key, exact: true }) === 0) {
    toFirstPage();
    return;
  }
  // FETCHING: cancel it (its state reverts to the pre-fetch pages), trim, and refetch at one page.
  // RECORDED, cost-only: a second invalidation landing inside this cancel's await can restart an
  // N-page fetch; the next close trims it again.
  await qc.cancelQueries({ queryKey: key, exact: true });
  if (!keep()) toFirstPage();
  void qc.refetchQueries({ queryKey: key, exact: true, type: "active" });
}

/** A conversation's status dot (D84 §5, §7): needs-you (a parked confirm/question) over running over
 *  unread; `null` = none. The SAME states and priority the roster dots read (S10 — an agent's
 *  `summaries[name].status` has this very shape). Every surface renders it as ONE kit-wide disc,
 *  `<span class="thread-dot" data-state=…>` (kit.css), positioned by its host. */
export type ThreadDot = "needs-you" | "running" | "unread";
export function threadDot(
  row: Pick<ThreadSummary, "awaiting" | "running" | "unread">,
): ThreadDot | null {
  if (row.awaiting) return "needs-you";
  if (row.running) return "running";
  if (row.unread) return "unread";
  return null;
}

/** A dot's state in WORDS — the accessible description of a row or card that carries one (the disc
 *  itself is decoration, `aria-hidden`). One map for the sheet rows, the tools-menu rows and the cards. */
export const THREAD_DOT_WORDS: Record<ThreadDot, string> = {
  "needs-you": "needs you",
  running: "a reply is running",
  unread: "unread",
};

/** The header button's dot (§5): the strongest dot among the home's conversations OTHER than the open one
 *  — the open view's own activity is on screen already. */
export function headerDot(rows: readonly ThreadSummary[], openId: string | null): ThreadDot | null {
  let best: ThreadDot | null = null;
  for (const row of rows) {
    if (row.id === openId) continue;
    const dot = threadDot(row);
    if (dot === "needs-you") return dot;
    if (dot === "running" || (dot === "unread" && best === null)) best = dot;
  }
  return best;
}

/** Rename a conversation (`PATCH /api/threads/{id}` `{title}`) — `title` is the trimmed text, `null` when
 *  empty (back to the derived label). A failure is TOASTED — visible over the open sheet (owner ruling;
 *  a chat note would sit under it) — and the row stays; either way the lists refetch (a 404 row goes). */
export function useRenameThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string | null }) =>
      patchJSON<ThreadSummary>(`/api/threads/${encodeURIComponent(id)}`, { title }),
    onError: (e: Error) => pushToast(e.message || "Rename failed", "err"),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["threads"] }),
  });
}

/** Delete a conversation (`DELETE /api/threads/{id}`). A 404 is DONE (deleted elsewhere — the row is gone
 *  either way: one success path, no error toast). Success → `conversationRemoved` (the open one moves to
 *  the home's next latest with its draft + rail, B8/E6; another's slots are dropped). A refusal — the 409
 *  while a turn runs, its busy sentence is the `ApiError` message — is toasted and the row stays. Either
 *  way the lists refetch, and the roster (its `summaries[name].status`). */
export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      del(`/api/threads/${encodeURIComponent(id)}`).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return;
        throw e;
      }),
    onSuccess: (_d, id) => conversationRemoved(id),
    onError: (e: Error) => pushToast(e.message || "Delete failed", "err"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["agents"] });
    },
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
