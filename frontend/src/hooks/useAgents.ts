import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, putJSON } from "../api/client";
import type { Privilege } from "../lib/privilege";
import { pushToast } from "../store/toast";
import { useScopedQuery } from "./useScopedQuery";

export type { Privilege }; // re-export so existing `import { Privilege } from "../hooks/useAgents"` keeps working

// Phase 7e-c (D14). Agents are folder-only: discovered via `GET /api/agents`, each managed through
// the file-per-agent API (`GET/PUT/DELETE /api/agents/{name}` for agent.yaml + `…/soul` for SOUL.md).
// The default/root agent (`name = "default"`) is the workspace itself — its fields map to the
// config.yaml `agent.defaults` block + `agent.default_title` (saved via PUT /api/settings), its
// persona to the root SOUL.md. Specialists map to their own folder. One unified editor drives both.

/** The reasoning-effort ladder (D42 A10) — the universal field convention. `null`/absent = inherit. */
export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** A model pointer + per-call config (D42 + A11/D48 C7-b). `provider`/`model` select the backend +
 *  model against the unified registry; the three call-config fields are the A10 output/reasoning
 *  surfaces, threaded per-agent (setModel). Typed — no index signature (any extra server keys still
 *  round-trip verbatim through the spread merge). */
export interface ModelRef {
  provider: string | null; // ""/null inherits the inference default; else a provider name
  model: string | null; // blank inherits the provider's model (or its sole catalog model)
  max_tokens?: number | null; // output budget (kwargs into stream_chat/complete); null = uncapped/inherit
  reasoning_effort?: ReasoningEffort | null; // reasoning ladder; null = inherit / leave to the endpoint
  reasoning_tokens?: number | null; // D45: explicit budget — OVERRIDES the ladder on budget-speaking
  // endpoints (llama.cpp, OpenRouter); ignored on effort-only ones (OpenAI), and ignored outright when
  // the ladder is "off" (off is ABSOLUTE). null = the ladder decides
}

/** Global compaction knobs surfaced in the Conf UI (D42). The remaining CompactionCfg fields
 *  (clear_keep_steps, threshold_tokens, summarizer, reserve_output, …) stay YAML-only — a partial
 *  PUT deep-merges, so they round-trip untouched. Percent is stored as a fraction (0.5–0.95). */
export interface CompactionCfg {
  enabled: boolean;
  threshold_frac: number; // fire when est. context > window × this (schema 0.5–0.95; shown ×100 as a %)
  keep_recent_tokens: number; // token floor kept unfolded
  clear_output_min_tokens: number; // tool-output trim floor
}

export interface AgentDef {
  name: string; // slug = folder name; the stable /agent id
  title: string; // optional display name (UI only); "" → show the slug
  description: string; // short routing summary the auto-router matches against (7e-g); persona stays in SOUL.md
  prompt: string; // persona = SOUL.md (read-only here; edited via the soul endpoint)
  prompt_append: string;
  inherit_append: boolean;
  model: ModelRef;
  tools: string[] | "*";
  skills: string[] | "*";
  privilege: Privilege;
  compaction: unknown; // not edited here — preserved on round-trip (unknown already admits null)
  routing: unknown; // D43 — the failure-fallback routing block; not edited here, preserved on round-trip (YAML-only)
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
  auto_rotate: boolean; // auto-route a turn to the best-matching specialist when no /agent is pinned (7e-g)
  auto_rotate_min_overlap: number; // min matching tokens for an auto-route pick
  streaming: "auto" | "on" | "off"; // dual-mode chat delivery (D17): on=always SSE, off=always buffered, auto=honor client
  compaction: CompactionCfg; // D42 — the GLOBAL default compaction knobs (per-agent overrides stay YAML-only)
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
 *  `prompt`, and the unedited `compaction`/`routing`). Written to agent.yaml (specialist) or
 *  `agent.defaults` (default). `title` is excluded for the default agent by the caller (it maps to
 *  `default_title`). `routing` (D43) is excluded like `compaction`: the editor never sends it, so the
 *  YAML block survives the file-API deep-merge untouched (no UI in v1 — the Omit precedent). */
export type AgentFields = Omit<AgentDef, "name" | "prompt" | "compaction" | "routing">;

export function pickFields(a: AgentDef): AgentFields {
  const { name: _n, prompt: _p, compaction: _c, routing: _r, ...rest } = a;
  return rest;
}

/** Discovered specialist names + the resolved default slug (tab-scoped — Conf-only data). */
export function useAgentList() {
  return useScopedQuery<{ agents: string[]; default: string }>("conf", {
    queryKey: ["agentlist"],
    queryFn: () => getJSON("/api/agents"),
    staleTime: 30_000,
  });
}

/** The resolved default agent slug + specialist names, always-on (not Conf-scoped). The Agent tab
 *  uses `default` to attribute per-turn agents on assistant bubbles (7e-c) — a turn is labelled only
 *  when its `agent` differs from this. Reuses the `["agents"]` key the agent mutations invalidate. */
export function useAgentRoster() {
  return useQuery<{ agents: string[]; default: string }>({
    queryKey: ["agents"],
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
  void qc.invalidateQueries({ queryKey: ["agentlist"] });
  if (name) void qc.invalidateQueries({ queryKey: ["agent", name] });
  void qc.invalidateQueries({ queryKey: ["actions"] }); // a toolset/agent change
  void qc.invalidateQueries({ queryKey: ["agents"] }); // the composer's /agent reference list
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
      void qc.invalidateQueries({ queryKey: ["agent", v.name] });
      pushToast("Persona saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
