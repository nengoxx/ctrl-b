import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";

// Phase 7e-b. The baked DEFAULT_SYSTEM_PROMPT text (GET /api/agent/default-prompt, added in 7e-a),
// used to back the PromptModal's [Load default] / [Restore default] on the *replace* prompt fields
// (Conf → Inference → System prompt, Conf → Agents → per-agent Prompt). It never changes at runtime,
// so it's fetched once and cached forever; consumers read `data ?? ""`.

export function useDefaultPrompt() {
  return useQuery({
    queryKey: ["agent", "default-prompt"],
    queryFn: async () => (await getJSON<{ text: string }>("/api/agent/default-prompt")).text,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
