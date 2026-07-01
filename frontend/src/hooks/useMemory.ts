import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";

// Phase 7e-d-3 — the Conf Memory panel's raw read/overwrite path. Per-agent `memories/MEMORY.md`
// (incl. `default` → root) via `/api/agents/{name}/memory`, and the global `memories/USER.md` via
// `/api/memory/user`. Both share the `{content}` shape, so one slot abstraction drives every file
// editor (mirrors the skills file API; blank content clears the file). The agent's own structured
// edits go through the `memory` tool (7e-d-2) — these are the owner's manual edits, uncapped.

/** The config.yaml `memory.*` block (caps + toggles), edited via PUT /api/settings. */
export interface MemoryCfg {
  enabled: boolean;
  user_profile_enabled: boolean;
  auto_write: boolean;
  consolidation_nudge: boolean;
  consolidation_nudge_pct: number;
  memory_char_limit: number;
  user_char_limit: number;
  state_enabled: boolean; // D27-B — per-agent emotional STATE.md (opt-in)
  state_char_limit: number;
  reflection_enabled: boolean; // D27-C — periodic "save anything worth remembering" nudge (opt-in)
  reflection_interval: number;
}

/** One editable memory file: the global user profile or a single agent's memory. `key` is the React
 *  + query-cache id; `cap` is the live char limit for the usage counter. */
export interface MemorySlot {
  key: string; // "user" | `agent:${slug}`
  label: string;
  sublabel: string;
  url: string; // GET + PUT share the endpoint
  cap: number;
}

export function userSlot(cap: number): MemorySlot {
  return {
    key: "user",
    label: "User profile",
    sublabel: "memories/USER.md · shared across agents",
    url: "/api/memory/user",
    cap,
  };
}

export function agentSlot(slug: string, isDefault: boolean, cap: number): MemorySlot {
  return {
    key: `agent:${slug}`,
    label: slug,
    sublabel: isDefault ? "memories/MEMORY.md · root agent" : `agents/${slug}/MEMORY.md`,
    url: `/api/agents/${encodeURIComponent(slug)}/memory`,
    cap,
  };
}

/** One agent's emotional `STATE.md` (D27-B) — the store-keyed route, gated by `state_enabled`. */
export function stateSlot(slug: string, isDefault: boolean, cap: number): MemorySlot {
  return {
    key: `state:${slug}`,
    label: `${slug} · state`,
    sublabel: isDefault
      ? "STATE.md · root agent emotional state"
      : `agents/${slug}/STATE.md · emotional state`,
    url: `/api/agents/${encodeURIComponent(slug)}/memory/state`,
    cap,
  };
}

/** The raw file text for one slot — fetched lazily when its editor row is opened. */
export function useMemoryContent(slot: MemorySlot | null) {
  return useQuery({
    queryKey: ["memory-file", slot?.key],
    queryFn: () => getJSON<{ content: string }>(slot!.url),
    enabled: !!slot,
    staleTime: 0,
  });
}

/** Overwrite a slot's file (blank content clears it). Adopts the server echo into the cache. */
export function useSaveMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, content }: { slot: MemorySlot; content: string }) =>
      putJSON<{ content: string }>(slot.url, { content }),
    onSuccess: (res, v) => {
      qc.setQueryData(["memory-file", v.slot.key], { content: res.content });
      pushToast(v.content.trim() ? "Memory saved" : "Memory cleared", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
