import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, putBytes, putJSON } from "../api/client";
import { DEFAULT_AGENT } from "../lib/agentSlug";
import { beginAgentsLoad, installAgents, loadAgents } from "../lib/composer";
import type { Privilege } from "../lib/privilege";
import { leaveDeletedHome } from "../store/chat";
import { pushToast } from "../store/toast";

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
  description: string; // one-line subtitle (gallery card + editor header); persona stays in SOUL.md
  prompt: string; // persona = SOUL.md (read-only here; edited via the soul endpoint)
  prompt_append: string;
  inherit_append: boolean;
  // ── Phase 23 / D70 (ROLEPLAY_PLAN §3.1) — the roleplay half of an agent, flat and all optional on
  // the backend. Declared here so the editor's draft is TYPED over them; they already round-tripped
  // through the index signature below, and `pickFields` spreads the rest, so every one of them reaches
  // `PUT /agents/{name}` whether or not a form edits it yet.
  duties: "agent" | "conversational"; // which duties prompt rides in the head (§4.1)
  greeting: string; // `first_mes` — the seeded opening message; "" → none
  greeting_enabled: boolean; // vault RP-001 — false → new threads start empty; the text is kept (and exported)
  alt_greetings: string[]; // `alternate_greetings`, stored so an imported card round-trips losslessly
  example_dialogue: string; // `mes_example` — `<START>`-delimited turns, kept in the ST format verbatim
  scenario: string;
  post_history: string; // `post_history_instructions` — emitted AFTER the history (§4.2)
  persona: string; // D78 — the OWNER's persona it talks to (a library slug); "" → the default
  avatar: string; // an entry name in the `agents/avatars` library (§8.1); "" → none
  background: string; // an entry name in `agents/backgrounds`; "" → the theme default
  voice: string; // TTS voice id (ruling 21); "" → the global `voice.tts` chain
  lorebooks: string[]; // attached book slugs (§6.5)
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

export { DEFAULT_AGENT } from "../lib/agentSlug"; // the root's slug lives in a leaf module (cycle-free)

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
  /** The agent's duties (ROLEPLAY_PLAN §4.1). The client reads it to gate the roleplay ACTION convention
   *  (single-`*` stage directions — the multi-line carry on screen, the drop in the ear): it applies to
   *  a `conversational` agent only (session-51 polish #6). `""` is the degraded name-only row (an
   *  agent whose folder will not load) — the same empty-string sentinel `voice` uses — and reads as
   *  "not conversational". */
  duties: "agent" | "conversational" | "";
}

/** `GET /api/agents` — the names, the resolved default, whether a default is CONFIGURED, and one
 *  summary per agent (the default included, so `default` can be looked up in the map).
 *
 *  `default` is what a bare thread RESOLVES to — the root when nothing is set; `default_set` says whether
 *  the owner SET one (`agent.default_agent` non-empty, D75 amendment). The two differ exactly when
 *  nothing is set: `default: "default", default_set: false`. The gallery's pill reads `default_set`; the
 *  tools menu's default row, the backdrop's fallback and every `/new`/thread-less home read `default`.
 *
 *  `summaries` is declared OPTIONAL for the reason the media wire fields are: a client can be handed a
 *  pre-D70 response (a service-worker cache from before an update, an e2e mock) and every consumer
 *  degrades to the name-only rendering rather than throwing. The server always sends it. */
export interface AgentListing {
  agents: string[];
  default: string;
  default_set?: boolean; // optional for the `summaries` reason above: absent reads as "none set"
  summaries?: Record<string, AgentSummary>;
}

/** EVERY agent the roster names, the root first and then the list route's own order — the one derivation
 *  the gallery's grid and both of its header counts (the standalone `.sec`, the Conf group) read, so a
 *  count can never disagree with the cards under it. The root is not in the route's `agents` (only
 *  specialist folders are) yet always exists, so it is here even before the listing has loaded. */
export function rosterNames(list: AgentListing | undefined): string[] {
  return [DEFAULT_AGENT, ...(list?.agents ?? []).filter((n) => n !== DEFAULT_AGENT)];
}

/** THE agent roster — the resolved default slug, the specialist names, the showcase summaries —
 *  always-on (not Conf-scoped), and the ONE query every surface reads it through (ISS-20, D79 §15.7):
 *  the gallery, the Conf globals/memory/automations editors, the chat's who-line, the tools menu and
 *  the backdrop. There used to be a second, Conf-scoped `["agentlist"]` query over the same
 *  `GET /api/agents`; two queries refetched separately, so after a default-agent change the gallery's
 *  pill and the menu's "default" row could disagree for the length of one refetch.
 *
 *  The price, accepted: this query keeps its 30 s stale window where the scoped one refetched on every
 *  tab entry — harmless, because every agent write (and every settings save) invalidates it, so no edit
 *  made here is ever shown stale. The Agent tab uses `default` to attribute per-turn agents on assistant
 *  bubbles (7e-c) — a turn is labelled only when its `agent` differs from this.
 *
 *  Every read is also INSTALLED into routing's module copy (`lib/composer#installAgents`, the
 *  `loadProviders` → `setAttachmentInfo` precedent): this query retries and refetches on focus, so it is
 *  what heals routing's roster (`lib/roster`) on the phone after a failed import-time `loadAgents`, and
 *  how a delete made on ANOTHER device reaches this one's roster sweep (D84 N2). */
export function useAgentRoster() {
  return useQuery<AgentListing>({
    queryKey: ["agents"],
    queryFn: async () => {
      const gen = beginAgentsLoad(); // claimed BEFORE the fetch — see `installAgents`' generation guard
      const data = await getJSON<AgentListing>("/api/agents");
      installAgents(data, gen);
      return data;
    },
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
  if (name) void qc.invalidateQueries({ queryKey: ["agent", name] });
  void qc.invalidateQueries({ queryKey: ["actions"] }); // a toolset/agent change
  void qc.invalidateQueries({ queryKey: ["agents"] }); // the composer's /agent reference list
  // D79 / §15.5 — the lorebook shelf's `used_by` line is a fact about AGENTS (who links a book), so an
  // agent write — a link, an unlink, a delete, the root's `agent.defaults` — must refresh it too.
  void qc.invalidateQueries({ queryKey: ["lorebooks"] });
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

/** What an import DID, as `PUT /api/agents/import` reports it (D70 §5.1 — the backend's
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

/** Import a character card as a new agent (§5). The owner's picked `File` goes up as a RAW-BODY PUT
 *  (`putBytes`) — a `File` is a `Blob`, so there is nothing to wrap. Never multipart, never POST: the
 *  verb is what forces the preflight this app answers with no ACAO, so a hostile page on another
 *  origin cannot land a card in the owner's agent surface (R73 / SECURITY_MODEL §2.9).
 *
 *  It invalidates exactly what a create does, PLUS the `agents` media index: a card's embedded avatar
 *  lands in the `agents/avatars` library on the way in, so the gallery that is about to paint the new
 *  card has to re-read it or the picture would appear only after a reload. No success toast — the
 *  REPORT is the outcome, and a toast over it would say less at the same moment. */
export function useImportAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => putBytes<ImportResult>("/api/agents/import", file),
    onSuccess: (res) => {
      invalidateAgents(qc, res.name);
      void qc.invalidateQueries({ queryKey: ["media", "agents"] });
    },
    onError: (e: Error) => pushToast(e.message || "Import failed", "err"),
  });
}

/** What `DELETE /api/agents/{name}` DID (D79 / ISS-24, ROLEPLAY_PLAN §15.6): what it removed (the
 *  folder, the default memory directory), what it deliberately KEPT (a delete never cascades to a book
 *  or a picture — owner), and what it BROKE — an automation pinned to the slug fails at its next fire,
 *  so it is named now rather than discovered then. Every field optional: an older server answers with
 *  no body at all, and the toast then says only what it always said. */
export interface AgentDeleteReport {
  /** The deleted slug (the route echoes it) — names the memory dir a failed step left. */
  name?: string;
  /** `true` without `?conversations=true`; WITH it, how many conversations went (D84 F6). */
  deleted?: boolean | number;
  /** The cascade's filesystem steps (D84 §4 step 3 — `?conversations=true` only): each `"ok"`,
   *  `"absent"` (nothing was there), `"kept"` (`memory` only — a custom `memory_dir`, ISS-24), or the
   *  step's ERROR — not rolled back, and a re-run finishes it ("delete again to finish"). */
  folder?: string;
  memory?: string;
  attachments?: string;
  removed?: string[];
  /** `memory` = a CUSTOM `memory_dir` the delete deliberately LEFT in place (only the default
   *  `memories/agents/<slug>` is removed) — usually empty. */
  kept?: { books?: string[]; art?: string[]; memory?: string[] };
  broken?: { automations?: string[] };
}

/** A step answer that is NOT a failure: done, nothing there, or a custom memory dir left by design. */
const STEP_FINE = new Set(["ok", "absent", "kept"]);
const stepFailed = (v: string | undefined): v is string =>
  typeof v === "string" && !STEP_FINE.has(v);

/** The delete's toast, from its report. Three clauses ask the owner to act — a broken automation
 *  (repoint it), memories left on disk (the confirm promised the memory folder goes; a custom one did
 *  not), and a cascade step that FAILED (D84 §4 — the conversations are gone but the folder ("delete
 *  again to finish"), the memory dir (named) or an attachment dir (the boot sweep's) is not) — so a report carrying any makes the toast
 *  STICKY: a 3 s toast is not how either should be learned. `deleted` (a number with the cascade) says
 *  how many conversations went; `uncounted` = the count read failed, so the second confirm was never
 *  asked and the conversations were left (the delete still ran — it says so). */
export function deleteToast(
  report: AgentDeleteReport | undefined,
  opts?: { uncounted?: boolean },
): {
  text: string;
  sticky: boolean;
} {
  // What a failed step asks of the owner differs (F1, D84 §4 step 4): only a FOLDER failure leaves a row
  // to delete again (the re-run also finishes the memory dir); once the folder went the agent is off the
  // roster, so a memory dir it left is named for the owner, and an attachment dir — which no re-run can
  // name, its row is gone — is reclaimed by the boot sweep.
  const folderFailed = stepFailed(report?.folder);
  const failed: string[] = [];
  if (folderFailed)
    failed.push(`its folder could not be removed: ${report?.folder} — delete again to finish`);
  else if (stepFailed(report?.memory))
    failed.push(
      `its memory folder${report?.name ? ` memories/agents/${report.name}` : ""} was left: ${report?.memory}`,
    );
  if (stepFailed(report?.attachments))
    failed.push(
      `some attachments were left (${report?.attachments}) — reclaimed at the next start`,
    );
  const parts = [folderFailed ? "Agent not fully removed" : "Agent removed"];
  if (typeof report?.deleted === "number")
    parts.push(`${report.deleted} conversation${report.deleted === 1 ? "" : "s"} deleted`);
  parts.push(...failed);
  if (opts?.uncounted) parts.push("its conversations could not be counted, so none were deleted");
  const books = report?.kept?.books ?? [];
  const art = report?.kept?.art ?? [];
  const memory = report?.kept?.memory ?? [];
  const automations = report?.broken?.automations ?? [];
  if (books.length > 0) parts.push(`kept lorebooks: ${books.join(", ")}`);
  if (art.length > 0) parts.push(`kept art: ${art.join(", ")}`);
  if (memory.length > 0) parts.push(`kept memories: ${memory.join(", ")}`);
  if (automations.length > 0)
    parts.push(`automations left without an agent (repoint them): ${automations.join(", ")}`);
  return {
    text: parts.join(" · "),
    sticky: automations.length > 0 || memory.length > 0 || failed.length > 0,
  };
}

/** The count read's page — the route's ceiling (`limit` 1..200): the confirm's number, not the sheet's
 *  page. A count AT the ceiling is shown as "200+" (`AgentsEditor`). */
export const COUNT_CEILING = 200;

/** How many conversations `name` HOMES (D84 R41 — the agent delete's second confirm): the length of its
 *  `GET /api/threads?agent=<name>` list, non-archived only (an automation's rolling run thread is never in
 *  the cascade). Throws when the read fails: the caller then asks no second confirm and sends no flag. */
export async function countAgentConversations(name: string): Promise<number> {
  const rows = await getJSON<unknown>(
    `/api/threads?agent=${encodeURIComponent(name)}&limit=${COUNT_CEILING}`,
  );
  if (!Array.isArray(rows)) throw new Error("/api/threads?agent → not a list");
  return rows.length;
}

/** What one agent delete asks for (the mutation variable): `conversations` = the D84 F6 cascade flag
 *  (`?conversations=true` — the second confirm's OK); `uncounted` = the count read failed (no second
 *  confirm, no flag — the toast says so). */
export interface AgentDeleteRequest {
  name: string;
  conversations: boolean;
  uncounted?: boolean;
}

/** Delete a specialist agent's folder (and its default memory directory — ISS-24), and — with the
 *  flag — its conversations (D84 R41/F6, one request, server-side). A 409 (one of them has a reply
 *  running: NOTHING was deleted) toasts the server's own sentence (B18). On success:
 *    · the roster refreshes (`invalidateAgents` — another device's responder/home sweep rides its own
 *      roster refresh, N2/M7; this device's responder arm is the same sweep);
 *    · N3 — when the deleted agent was the OPEN conversation's HOME, this device moves to the configured
 *      default's latest AT ONCE (`leaveDeletedHome`; latched in a call, M8) — on BOTH branches of the
 *      second confirm and on the no-count path: the conversation is gone or orphaned either way. No
 *      "deleted" toast — the delete's own toast speaks. */
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, conversations }: AgentDeleteRequest) =>
      del<AgentDeleteReport | undefined>(
        `/api/agents/${encodeURIComponent(name)}${conversations ? "?conversations=true" : ""}`,
      ),
    onSuccess: (report, { name, uncounted }) => {
      invalidateAgents(qc, name);
      void qc.invalidateQueries({ queryKey: ["threads"] }); // its sheet (and any cached list) is gone
      const { text, sticky } = deleteToast(report, { uncounted });
      pushToast(text, "ok", { sticky });
      leaveDeletedHome(name);
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
