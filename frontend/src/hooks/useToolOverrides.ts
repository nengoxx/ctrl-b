import { useMutation, useQueryClient } from "@tanstack/react-query";

import { putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import type { ToolOverride } from "../types";

// Persist per-tool overrides (Phase 8b, D22). One mutation shared by the Tools-tab catalog (batched
// description + tri-state mode) and the run cards' inline description edit (a single tool), so an
// edit in either place writes the same `tool_overrides` map and reaches the other. The backend
// deep_merge keeps the untouched axis, so a partial entry (just `description`) preserves `agent_mode`.
//
// Invalidates every cache that renders an effective spec: the run cards (["tools"]), the catalog +
// agent toolset (["actions"]), and the settings doc.
export function useSaveToolOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrides: Record<string, ToolOverride>) =>
      putJSON("/api/settings", { tool_overrides: overrides }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tools"] });
      void qc.invalidateQueries({ queryKey: ["actions"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
      pushToast("Tool settings saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
