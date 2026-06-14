import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import { useScopedQuery } from "./useScopedQuery";

// Phase 7e-c (D14). Agents are folder-only: discovered via `GET /api/agents`, each managed through
// the file-per-agent API (`GET/PUT/DELETE /api/agents/{name}` for agent.yaml + `…/soul` for SOUL.md).
// The default/root agent (`name = "default"`) is the workspace itself — its fields map to the
// config.yaml `agent.defaults` block + `agent.default_title` (saved via PUT /api/settings), its
// persona to the root SOUL.md. Specialists map to their own folder. One unified editor drives both.

export type Privilege = "readonly" | "confirm" | "auto_low" | "full";

export interface ModelRef {
  mode: string | null; // ""/null/local/cloud — blank inherits inference.default_mode
  model: string | null; // blank inherits the endpoint's model
}

export interface AgentDef {
  name: string; // slug = folder name; the stable /agent id
  title: string; // optional display name (UI only); "" → show the slug
  prompt: string; // persona = SOUL.md (read-only here; edited via the soul endpoint)
  prompt_append: string;
  inherit_append: boolean;
  model: ModelRef;
  tools: string[] | "*";
  skills: string[] | "*";
  privilege: Privilege;
  compaction: unknown | null; // not edited here — preserved on round-trip
  max_iterations: number;
  max_repeat_calls: number;
  max_calls_per_tool: number;
  max_stall_iterations: number;
  max_subagent_depth: number;
  max_concurrent_subagents: number;
  [k: string]: unknown; // preserve any extra fields verbatim
}

/** Config-level agent globals (config.yaml `agent.*`), edited through PUT /api/settings. */
export interface AgentSectionCfg {
  default_agent: string;
  default_title: string;
  global_subagent_limit: number;
  subagent_clamp_privilege: boolean;
}

/** The `default` slug — the workspace-root / generalist agent (no agent.yaml). */
export const DEFAULT_AGENT = "default";

export interface AgentFull {
  name: string;
  is_default: boolean;
  agent: AgentDef;
  soul: string;
}

/** The AgentDef fields the editor manages (everything except the slug `name`, the SOUL-backed
 *  `prompt`, and the unedited `compaction`). Written to agent.yaml (specialist) or `agent.defaults`
 *  (default). `title` is excluded for the default agent by the caller (it maps to `default_title`). */
export type AgentFields = Omit<AgentDef, "name" | "prompt" | "compaction">;

export function pickFields(a: AgentDef): AgentFields {
  const { name: _n, prompt: _p, compaction: _c, ...rest } = a;
  return rest as AgentFields;
}

/** Discovered specialist names + the resolved default slug (tab-scoped — Conf-only data). */
export function useAgentList() {
  return useScopedQuery<{ agents: string[]; default: string }>("conf", {
    queryKey: ["agentlist"],
    queryFn: () => getJSON("/api/agents"),
    staleTime: 30_000,
  });
}

/** One agent's resolved def + persona. Lazy by-id (gated on the open row), so a plain useQuery. */
export function useAgent(name: string | null) {
  return useQuery<AgentFull>({
    queryKey: ["agent", name],
    queryFn: () => getJSON(`/api/agents/${name}`),
    enabled: !!name,
    staleTime: 30_000,
  });
}

function invalidateAgents(qc: ReturnType<typeof useQueryClient>, name?: string) {
  qc.invalidateQueries({ queryKey: ["agentlist"] });
  if (name) qc.invalidateQueries({ queryKey: ["agent", name] });
  qc.invalidateQueries({ queryKey: ["actions"] }); // a toolset/agent change
  qc.invalidateQueries({ queryKey: ["agents"] }); // the composer's /agent reference list
}

/** Create or update a specialist's agent.yaml. */
export function useSaveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, agent }: { name: string; agent: Partial<AgentFields> }) =>
      putJSON(`/api/agents/${name}`, { agent }),
    onSuccess: (_d, v) => {
      invalidateAgents(qc, v.name);
      pushToast("Agent saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

/** Delete a specialist agent's folder. */
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => del(`/api/agents/${name}`),
    onSuccess: (_d, name) => {
      invalidateAgents(qc, name);
      pushToast("Agent removed", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Remove failed", "err"),
  });
}

/** Write an agent's SOUL.md persona directly (file-backed; blank → falls back to the baked default). */
export function useSaveAgentSoul() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      putJSON(`/api/agents/${name}/soul`, { content }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["agent", v.name] });
      pushToast("Persona saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
