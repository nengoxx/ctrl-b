import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";

// Phase 7e-d-3 — the Conf Memory panel's raw read/overwrite path. Per-agent `memories/MEMORY.md`
// (incl. `default` → root) via `/api/agents/{name}/memory`, and the global `memories/USER.md` via
// `/api/memory/user`. Both share the `{content}` shape, so one slot abstraction drives every file
// editor (mirrors the skills file API; blank content clears the file). The agent's own structured
// edits go through the `memory` tool (7e-d-2) — these are the owner's manual edits, uncapped.

/** The tier-2 long-term slot's own caps (config.yaml `memory.longterm.core.*`, D57 §6.1 + D60's
 *  `recall_min_charge_chars`). The Conf disclosure edits exactly these six fields and nothing else. */
export interface CoreMemoryCfg {
  root: string; // relative → under the memory dir; absolute honored (and then unversioned)
  index_char_limit: number;
  topic_char_limit: number;
  recall_char_limit: number;
  recall_min_charge_chars: number; // D60: the minimum one read/search charges against the cap
  consolidation_nudge_pct: number;
}

/** The tier-2 slot (D57). `backend` is the ONLY switch — null = off — so the enable switch writes it
 *  and there is no sibling bool to keep in sync. A future backend is a new value + a nested cfg. */
export interface LongTermCfg {
  backend: "core" | null;
  core: CoreMemoryCfg;
}

/** What the corpus actually found on disk (`GET /api/memory/core/status`) — derived, never config,
 *  which is why it has its own read-only route instead of riding the settings doc. */
export interface CoreMemoryStatus {
  enabled: boolean;
  root: string | null; // null → the configured root was refused (see the server log)
  topics: number;
  skipped: number;
  anomalies: string[];
  index_chars: number;
  index_char_limit: number;
  index_pct: number;
}

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
  longterm: LongTermCfg; // D57 — the tier-2 slot, nested inside `memory:` (never a top-level key)
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

/** The tier-2 corpus's scan status — fetched only while the Core Memory disclosure is open, and
 *  refetched on mount so a hand-edited or freshly copied-in corpus shows its real state (the scan is
 *  cached server-side behind the file signature, so an unchanged corpus costs a stat sweep). */
export function useCoreMemoryStatus(open: boolean) {
  return useQuery({
    queryKey: ["core-memory-status"],
    queryFn: () => getJSON<CoreMemoryStatus>("/api/memory/core/status"),
    enabled: open,
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
