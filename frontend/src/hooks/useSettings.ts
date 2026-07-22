import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getJSON, getJSONWithHeader, putJSON } from "../api/client";
import { loadProviders } from "../lib/composer";
import { pushToast } from "../store/toast";
import type { McpServer, OpenApiServer } from "./useIntegrations";
import { useScopedQuery } from "./useScopedQuery";

// Phase 7a. The settings doc is the whole masked config; the Conf forms read/write the slices they
// expose (server + inference here). Typed loosely — only the edited groups are modelled; the rest
// round-trips opaquely so a partial PUT never has to mirror the entire backend Settings shape.

// A11 / D48 — the unified provider registry. `providers` is the ONE top-level map of connections, each
// carrying a name-keyed model catalog; every consumer section (inference here, voice/embeddings in
// Slice 2) points at a provider + model via a flat `{provider, model?}` ref. Wire dialect + max_tokens
// derivation stay on the provider (D45/D46). Voice/embeddings keep their legacy shape until Slice 2.

/** One catalog model. KEY (in `ProviderDoc.models`) is the clean display name; `id` defaults to the
 *  key. Role-scoped fields (voice/speed/language/format/dim) are schema-complete now but only consumed
 *  from Slice 2 on; any extra key round-trips unharmed. */
export interface ModelDoc {
  id?: string | null; // wire model id (defaults to the map key when unset/equal)
  context_window?: number | null; // D42 — chat window; null = auto (probe / threshold fallback)
  max_tokens_field?: "max_tokens" | "max_completion_tokens" | null; // C6 model-level override (chat)
  extra_body?: Record<string, unknown> | null; // chat-call passthrough (model-level home)
  dim?: number | null; // embeddings-scoped
  voice?: string | null; // TTS-scoped
  speed?: number | null; // TTS-scoped
  language?: string | null; // STT-scoped
  format?: string | null; // TTS-scoped
  [k: string]: unknown; // preserve any extra fields verbatim on round-trip
}

/** One provider connection + its model catalog. `api_key` masks on read (blank-keeps on PUT). */
export interface ProviderDoc {
  base_url: string;
  api_key: string | null; // masked on read; echo unchanged to keep the stored secret
  api_mode: "openai" | "llamacpp" | "openrouter" | "none";
  max_concurrent_requests?: number | null; // SERVER capacity (D40 semaphore keys here)
  retry_attempts?: number | null; // provider > global override
  max_tokens_field?: "max_tokens" | "max_completion_tokens" | null; // derived from api_mode when null
  models: Record<string, ModelDoc>;
  [k: string]: unknown; // preserve any extra fields verbatim on round-trip
}

/** A flat pointer into the registry: a provider + (optional, sole-model-omittable) clean model name. */
export interface SectionRef {
  provider: string;
  model: string | null;
}

// Voice (Phase 6) — one STT + one TTS service, each a primary→fallback failover chain (D18).
export interface VoiceEndpoint {
  base_url: string;
  api_key: string | null; // masked on read
  model: string;
  voice?: string; // TTS only — server voice id
}
interface VoiceServiceCommon {
  connect_timeout_s: number; // fail-fast on an unreachable endpoint → fall over
  timeout_s: number; // read window for the transcription/synthesis
  extra_body: Record<string, unknown>; // advanced passthrough (round-trips even without a UI control)
  primary: VoiceEndpoint;
  fallback: VoiceEndpoint;
}
export interface VoiceStt extends VoiceServiceCommon {
  language: string; // "" → auto-detect
  vad_filter: boolean; // skip silence
  hotwords: string; // space-separated recognition bias
  auto_send: boolean; // true → mic sends the transcript; false (default) → fill composer for review
}
export interface VoiceTts extends VoiceServiceCommon {
  format: string; // response_format/container (mp3 = universally seekable)
}

export interface SettingsDoc {
  server: {
    host: string;
    port: number;
    poll_seconds: number;
    feature_cycle_seconds: number;
    debug: boolean;
  };
  // A11 / D48 — the top-level connection registry (full card shape incl. base_url + masked api_key).
  providers: Record<string, ProviderDoc>;
  inference: {
    // Flat primary + ordered fallbacks (D48). Provider primary; model omittable iff the provider's
    // catalog has exactly one model. `default_mode` / local / cloud slots are RETIRED.
    provider: string | null;
    model: string | null;
    fallbacks: SectionRef[];
    request_timeout_s: number;
    system_prompt: string;
    system_prompt_append: string; // 7e-a additive axis — appended as its own system message
    failover: boolean; // walk the primary→fallbacks chain on failure
    retry_attempts?: number | null; // global retry (provider override wins); round-trips, no UI here
  };
  // Integration endpoints (Phase 7c-a) — scalar configs edited through this same settings PUT.
  searxng: { base_url: string; enabled: boolean; language: string | null };
  embeddings: {
    base_url: string;
    api_key: string | null; // masked on read
    model: string;
    enabled: boolean;
    dim: number | null;
  };
  open_terminal: {
    base_url: string;
    api_key: string | null; // masked on read
    enabled: boolean;
    exec_risk: string;
    write_risk: string;
    read_risk: string;
  };
  // Guarded local shell (Phase 5) — the `!<cmd>` escape hatch + the agent's run_shell gate.
  shell: {
    enabled: boolean;
    user_exec_enabled: boolean;
    agent_exec_enabled: boolean;
    workdir: string;
    timeout_s: number;
    max_output_chars: number;
  };
  voice: { enabled: boolean; stt: VoiceStt; tts: VoiceTts };
  mcp_servers: McpServer[]; // Phase 7c-b — managed via the integrations CRUD endpoints, read here
  openapi_servers: OpenApiServer[];
  [k: string]: unknown; // other sections (agent, …) — managed elsewhere
}

export interface SaveResult {
  settings: SettingsDoc;
  restart_required: string[];
  warnings: string[]; // D48 C9 — non-fatal notices (skill shadows, catalog hazards); render inline
  providers_rev: string; // D48 C2 — post-write providers fingerprint (the next PUT's base)
}

/** The settings PUT payload: a partial doc plus the two D48 transport siblings. `provider_renames`
 *  + `providers_base` are stripped server-side (never persisted); `providers_base` MUST accompany any
 *  `providers` map (even unchanged) so a concurrent full-map replacement can 409 instead of clobbering. */
export interface SavePatch {
  [k: string]: unknown;
  provider_renames?: Record<string, string>;
  providers_base?: string;
}

/** The naked, non-secret provider view (GET /api/providers) — the composer's `/<provider>` source +
 *  the Conf/AgentsEditor pickers' catalog + the boot/lenient warnings. NO api_key, NO base_url. */
export interface ProvidersInfo {
  providers: Record<string, { api_mode: string; models: string[] }>;
  rev: string; // providers fingerprint (informational here; the Conf PUT base rides GET /api/settings — FR2-1)
  sections: {
    inference: {
      provider: string | null;
      model: string | null;
      fallbacks: { provider: string; model: string | null }[];
    };
  };
  reserved_verbs: string[];
  verbs: string[]; // composer-routable provider names
  warnings: string[];
}

/** Full config (secrets masked). Conf-only data — scoped to the Conf tab so we don't fetch while
 *  the user is on Fleet/Agent. Re-entry to Conf force-refreshes (refetchOnMount: 'always' inside
 *  useScopedQuery), so the cache stays fresh whenever the user actually looks at it. */
export function useSettings() {
  const qc = useQueryClient();
  return useScopedQuery<SettingsDoc>("conf", {
    queryKey: ["settings"],
    queryFn: async () => {
      // FR2-1 — read the providers fingerprint off the SAME response (the `X-Providers-Rev` header) and
      // stash it under ["settings","providers-rev"] so the Conf draft can bind its concurrency base to the
      // exact settings snapshot it seeds from. ONE request; the doc body stays the query data (C9 naked).
      const { data, header } = await getJSONWithHeader<SettingsDoc>(
        "/api/settings",
        "X-Providers-Rev",
      );
      qc.setQueryData(["settings", "providers-rev"], header);
      return data;
    },
    staleTime: 30_000,
  });
}

/** The providers fingerprint that rode in on the last `GET /api/settings` (its `X-Providers-Rev`
 *  header, stashed by `useSettings`). This is the Conf draft's concurrency base — bound to the SAME
 *  snapshot the draft seeds from, NOT the independently-fetched `useProviders().rev` (FR2-1, closing the
 *  read-skew). A read-only cache subscription: it never fetches (the settings queryFn + a save populate
 *  the key); it re-renders consumers when either does. */
export function useSettingsProvidersRev(): string | null {
  const { data } = useQuery<string | null>({
    queryKey: ["settings", "providers-rev"],
    queryFn: () => null, // never runs (enabled:false) — the key is written by useSettings/useSaveSettings
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? null;
}

/** The provider registry view (D48). Conf-scoped like useSettings — consumed by the Providers +
 *  Inference sections (pickers, warnings, base rev) and the AgentsEditor picker. The composer keeps
 *  its own module-level `knownProviders` (refreshed on save), so verbs work from any tab. */
export function useProviders() {
  return useScopedQuery<ProvidersInfo>("conf", {
    queryKey: ["providers"],
    queryFn: () => getJSON<ProvidersInfo>("/api/providers"),
    staleTime: 30_000,
  });
}

/** Save a partial settings patch. Invalidates the cache + toasts; surfaces a restart note. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SavePatch) => putJSON<SaveResult>("/api/settings", patch),
    onSuccess: (res) => {
      qc.setQueryData(["settings"], res.settings); // adopt the server's masked echo immediately
      // FR2-1 — keep the providers base rev PAIRED with the settings echo (the same key the settings
      // queryFn writes), so a follow-up save's epoch capture reads the fresh post-write base even before
      // the providers refetch resolves. The base is sourced from the settings snapshot, not ["providers"].
      qc.setQueryData(["settings", "providers-rev"], res.providers_rev);
      void qc.invalidateQueries({ queryKey: ["health"] }); // poll cadence/port may have changed
      void qc.invalidateQueries({ queryKey: ["voice-status"] }); // a Voice edit flips mic/TTS availability (6b)
      void qc.invalidateQueries({ queryKey: ["providers"] }); // D48 — a save may add/rename/drop providers (fresh names/warnings)
      void loadProviders(); // refresh the composer's module-level `/<provider>` verb set (best-effort)
      if (res.restart_required.length) {
        pushToast(`Saved · restart to apply: ${res.restart_required.join(", ")}`, "info");
      } else {
        pushToast("Settings saved", "ok");
      }
    },
    onError: (e: Error, patch) => {
      // FX15 (Codex#12): the providers-conflict path applies ONLY to a 409 whose patch actually carried
      // the `providers` map (a full-map replacement conflict). The agent-busy 409 (a tool_overrides save
      // mid-turn) and every other error keep the generic toast with their own detail message.
      if (e instanceof ApiError && e.status === 409 && "providers" in patch) {
        // FX11 (Codex#3): the Conf draft holds the epoch-captured providers base, which does NOT advance
        // while the draft is dirty — so a blind retry keeps 409ing (no silent clobber of a concurrent
        // addition) until the user reloads/navigates and the draft reseeds clean at the fresh base.
        pushToast("Providers changed elsewhere — reload the tab to pick up the new state", "err");
        return;
      }
      pushToast(e.message || "Save failed", "err");
    },
  });
}
