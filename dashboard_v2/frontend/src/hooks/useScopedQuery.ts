import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useTabActive, type Tab } from "../store/ui";

// Tab-scoped query (Slice 5 / F1 in docs/UI_AUDIT.md).
//
// PAUSES the query (and any refetchInterval it carries) while the owning tab is inactive, and
// FORCES `refetchOnMount: 'always'` so the user always sees fresh data on tab re-entry. Cached
// data shows instantly while the fresh fetch is in flight — switching to the paused tab feels
// instant (no spinner, no flicker), just brief background reconciliation to truth.
//
// ┌─ USE FOR ───────────────────────────────────────────────────────────────────────────────────
// │  Data that the user only views/edits from one specific tab AND that doesn't change behind
// │  their back (no external mutator). Examples: settings, agents, skills, integration status.
// │
// │  Future tabs (memory, prompts, automations, …) get the same pause/refetch policy from one
// │  source by calling `useScopedQuery(<their tab name>, …)`. No per-tab boilerplate.
// └─
//
// ┌─ DO NOT USE FOR ────────────────────────────────────────────────────────────────────────────
// │  - State the user expects to be live regardless of where they are: fleet hosts, services,
// │    health, the SSE event stream.
// │  - Streaming state (chat) — that's a reducer, not a TanStack query.
// │  - Lazy by-id fetchers that already gate on `enabled: !!id` (their gating is finer-grained
// │    than tab-level; no need to compose).
// └─
//
// Composability with `options.enabled`:
//   `false` → respected, the query stays disabled regardless of tab.
//   `true` / `undefined` → query enabled when the tab is active.
//   Function form (TanStack v5) → coerced to truthy; if you need conditional `enabled` *and*
//     tab scoping, gate the callsite instead (`if (cond) useScopedQuery(...)` won't work due to
//     hook rules — instead lift the condition into a boolean and AND it with the active tab).
export function useScopedQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  tab: Tab,
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  const active = useTabActive(tab);
  return useQuery({
    ...options,
    enabled: active && options.enabled !== false,
    refetchOnMount: "always",
  });
}
