import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import { useScopedQuery } from "./useScopedQuery";
import type { PromptPair, PromptsDoc } from "../types";

// The prompt registry (Phase 18 / D56). `GET /api/prompts` is read-only — the registry rows plus the
// owner's customization; writes go through the ordinary settings PUT, because `prompts:` is a normal
// config section (§7 L-4) and there is exactly one write path into config.yaml.

/** The registry + the owner's overrides. Conf-scoped like its sibling group feeds (`useAutomations`/
 *  `useAgents`): paused off-tab, force-refreshed on Conf re-entry — so an edit saved from ANOTHER
 *  device is picked up when the owner comes back to Conf here, instead of a long-stale cache backing
 *  a last-write-wins save (Codex MED; no 409 gate by design, freshness is the mitigation). */
export function usePrompts() {
  return useScopedQuery<PromptsDoc>("conf", {
    queryKey: ["prompts"],
    queryFn: () => getJSON<PromptsDoc>("/api/prompts"),
    // 0, not the sibling 10s: ConfTab is KEEP-mounted, so the hook's `refetchOnMount: "always"`
    // never re-fires and the enabled-edge only refetches when STALE — a >0 staleTime would let a
    // quick tab-hop edit a cache another device just outdated and LWW-save it back (Codex confirm
    // round). Always-stale = every Conf re-entry reconciles; cached rows still paint instantly.
    staleTime: 0,
  });
}

/** Persist prompt customizations — the `useSaveToolOverrides` shape, one batched map per Save.
 *
 *  The pairs carry the RAW textarea values: the server normalizes a blank field to absent and drops an
 *  entry left with none (§7 L-4/L-5), so a both-blank pair IS the restore — one save shape, no client
 *  sentinel. Whole-entry replace, so every changed id sends BOTH fields (a field-level merge would make
 *  "I cleared the append" mean "keep the old append"). */
export function useSavePromptOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrides: Record<string, PromptPair>) =>
      putJSON("/api/settings", { prompts: overrides }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["prompts"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
      pushToast("Prompts saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

/** The Conf group's header summary. Array-proved like `automationsSummary`: this dereferences a
 *  NETWORK payload, and a malformed doc must degrade to the quiet label rather than throw inside
 *  ConfTab's render and take every group down with it. */
export function promptsSummary(doc: PromptsDoc | undefined): string {
  if (!doc || !Array.isArray(doc.prompts)) return "model-facing texts";
  const n = doc.prompts.filter((p) => p.is_customized).length;
  return n ? `${n} customized` : "model-facing texts";
}
