import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, postForm, putJSON } from "../api/client";
import { loadAgents } from "../lib/composer";
import type { Privilege } from "../lib/privilege";
import { pushToast } from "../store/toast";
import { CONF_SECTIONS, useScopedQuery } from "./useScopedQuery";

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
  // ── Phase 23 / D70 (ROLEPLAY_PLAN §3.1) — the roleplay half of an agent, flat and all optional on
  // the backend. Declared here so the editor's draft is TYPED over them; they already round-tripped
  // through the index signature below, and `pickFields` spreads the rest, so every one of them reaches
  // `PUT /agents/{name}` whether or not a form edits it yet.
  duties: "agent" | "conversational"; // which duties prompt rides in the head (§4.1)
  greeting: string; // `first_mes` — the seeded opening message; "" → none
  alt_greetings: string[]; // `alternate_greetings`, stored so an imported card round-trips losslessly
  example_dialogue: string; // `mes_example` — `<START>`-delimited turns, kept in the ST format verbatim
  scenario: string;
  post_history: string; // `post_history_instructions` — emitted AFTER the history (§4.2)
  user_name: string; // per-agent `{{user}}` override; "" → the persona name → "User"
  avatar: string; // an entry name in the `agents/avatars` library (§8.1); "" → none
  background: string; // an entry name in `agents/backgrounds`; "" → the theme default
  voice: string; // TTS voice id (ruling 21); "" → the global `voice.tts` chain
  lorebooks: string[]; // attached book slugs (§6.5)
  card: Record<string, unknown>; // the import stash — provenance, NEVER prompt-facing (§5.3)
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
 *  backend's). ONE source of truth for that projection: ConfTab builds `AgentGlobals`'s `cfg` prop
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

/** One agent's SHOWCASE facts, as `GET /agents` publishes them (D70 §10-S4 — the backend's
 *  `_SUMMARY_FIELDS`). Everything else about an agent stays behind `GET /agents/{name}`.
 *
 *  `avatar`/`background` are library ENTRY NAMES in the `agents` media namespace, not URLs: turning
 *  one into a URL + focal point is the media index's join, and `hooks/useAgentArt` is where it
 *  happens — once, for the picker, the who-line and the gallery alike. */
export interface AgentSummary {
  title: string;
  description: string;
  avatar: string;
  background: string;
  voice: string;
}

/** `GET /api/agents` — the names, the resolved default, and one summary per agent (the default
 *  included, so `default` can be looked up in the map).
 *
 *  `summaries` is declared OPTIONAL for the reason the media wire fields are: a client can be handed a
 *  pre-D70 response (a service-worker cache from before an update, an e2e mock) and every consumer
 *  degrades to the name-only rendering rather than throwing. The server always sends it. */
export interface AgentListing {
  agents: string[];
  default: string;
  summaries?: Record<string, AgentSummary>;
}

/** Discovered specialist names + the resolved default slug (tab-scoped — Conf-only data). */
export function useAgentList() {
  return useScopedQuery<AgentListing>(CONF_SECTIONS, {
    queryKey: ["agentlist"],
    queryFn: () => getJSON("/api/agents"),
    staleTime: 30_000,
  });
}

/** The resolved default agent slug + specialist names, always-on (not Conf-scoped). The Agent tab
 *  uses `default` to attribute per-turn agents on assistant bubbles (7e-c) — a turn is labelled only
 *  when its `agent` differs from this. Reuses the `["agents"]` key the agent mutations invalidate. */
export function useAgentRoster() {
  return useQuery<AgentListing>({
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

/** Everything that renders an agent, refreshed after an agent write — the ONE definition of "the
 *  roster changed". Exported because a settings save is an agent write too: the root default's def
 *  lives in `agent.defaults` and `agent.default_agent` picks the resolved default, both through
 *  `PUT /api/settings` (`useSaveSettings` calls this). */
export function invalidateAgents(qc: ReturnType<typeof useQueryClient>, name?: string) {
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

/** What an import DID, as `POST /api/agents/import` reports it (D70 §5.1 — the backend's
 *  `_import_report`). Every field is shown: what mapped is the reassurance, and what was STASHED,
 *  STRIPPED or warned about is the part the owner cannot discover any other way.
 *
 *  `post_history` rides verbatim on purpose: it is the highest-leverage text a card can inject — it
 *  lands closest to generation — so the one place it must not be invisible is the report of the import
 *  that accepted it. */
export interface ImportReport {
  container: string;
  fields_mapped: string[];
  stashed_keys: string[];
  stripped_paths: string[];
  warnings: string[];
  post_history: string;
}

/** The created agent plus its report — the `201` body. */
export interface ImportResult extends AgentFull {
  report: ImportReport;
}

/** Import a character card as a new agent (§5). MULTIPART, one `file` field — a card is a FILE the
 *  owner picks, and `postForm` is the one helper that sends one.
 *
 *  It invalidates exactly what a create does, PLUS the `agents` media index: a card's embedded avatar
 *  lands in the `agents/avatars` library on the way in, so the gallery that is about to paint the new
 *  card has to re-read it or the picture would appear only after a reload. No success toast — the
 *  REPORT is the outcome, and a toast over it would say less at the same moment. */
export function useImportAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return postForm<ImportResult>("/api/agents/import", form);
    },
    onSuccess: (res) => {
      invalidateAgents(qc, res.name);
      void qc.invalidateQueries({ queryKey: ["media", "agents"] });
    },
    onError: (e: Error) => pushToast(e.message || "Import failed", "err"),
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
