import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, putJSON } from "../api/client";
import { loadAgents } from "../lib/composer";
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

/** Global compaction knobs surfaced in the Conf UI (D42 + the D60 Tier-1 clearing gate). The
 *  remaining CompactionCfg fields (clear_keep_steps, threshold_tokens, summarizer, reserve_output, …)
 *  stay YAML-only — a partial PUT deep-merges, so they round-trip untouched. Percents are stored as
 *  fractions (threshold_frac 0.5–0.95; clear_trigger_pct 0–1). */
export interface CompactionCfg {
  enabled: boolean;
  threshold_frac: number; // fire when est. context > window × this (schema 0.5–0.95; shown ×100 as a %)
  keep_recent_tokens: number; // token floor kept unfolded
  clear_output_min_tokens: number; // tool-output trim floor
  clear_trigger_pct: number; // D60: clear only above this fraction of the chain's smallest window
  clear_min_reclaim_tokens: number; // D60: skip a trim reclaiming less than this
  clear_exclude_tools: string[]; // D60: tools whose results are never cleared
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

/** Project the settings doc's `agent` section onto the editor's view model (the defaults mirror the
 *  backend's). ONE source of truth for that projection: ConfTab builds the AgentsEditor's `cfg` prop
 *  with it, and the editor re-projects a save ECHO (`res.settings.agent`) through the same function so
 *  its draft-epoch seed is byte-comparable with the prop that lands a render later (v1.3.1). */
export function pickAgentSection(section: Partial<AgentSectionCfg> | undefined): AgentSectionCfg {
  return {
    default_agent: section?.default_agent ?? "",
    default_title: section?.default_title ?? "",
    global_subagent_limit: section?.global_subagent_limit ?? 6,
    subagent_clamp_privilege: section?.subagent_clamp_privilege ?? true,
    auto_rotate: section?.auto_rotate ?? false,
    auto_rotate_min_overlap: section?.auto_rotate_min_overlap ?? 2,
    streaming: section?.streaming ?? "auto",
    // D42/D60 — global compaction defaults (per-agent overrides stay YAML-only). Defaults mirror
    // CompactionCfg's backend defaults; only these knobs are surfaced.
    compaction: {
      enabled: section?.compaction?.enabled ?? true,
      threshold_frac: section?.compaction?.threshold_frac ?? 0.85,
      keep_recent_tokens: section?.compaction?.keep_recent_tokens ?? 4096,
      clear_output_min_tokens: section?.compaction?.clear_output_min_tokens ?? 500,
      clear_trigger_pct: section?.compaction?.clear_trigger_pct ?? 0.5,
      clear_min_reclaim_tokens: section?.compaction?.clear_min_reclaim_tokens ?? 1024,
      clear_exclude_tools: section?.compaction?.clear_exclude_tools ?? [
        "task_plan",
        "memory",
        "core_memory",
      ],
    },
  };
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
  // SYS-9.2: also refresh the composer's MODULE-LEVEL `/agent` set (loaded once at import), the way a
  // settings save refreshes `loadProviders` and a skill CRUD refreshes `loadSkills`. Without this an
  // agent added/renamed/removed here isn't seen by the verb router (the `/agent <name>` "configured?"
  // check + the resolved default) until a full page reload. Best-effort; a cheap GET.
  void loadAgents();
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
