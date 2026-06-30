import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import type { McpServer, OpenApiServer } from "./useIntegrations";
import { useScopedQuery } from "./useScopedQuery";

// Phase 7a. The settings doc is the whole masked config; the Conf forms read/write the slices they
// expose (server + inference here). Typed loosely — only the edited groups are modelled; the rest
// round-trips opaquely so a partial PUT never has to mirror the entire backend Settings shape.

export interface InferenceEndpoint {
  base_url: string;
  api_key: string | null; // masked on read (e.g. "ab…yz"); echo unchanged to keep the stored secret
  model: string;
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
  server: { host: string; port: number; poll_seconds: number; feature_cycle_seconds: number; debug: boolean };
  inference: {
    default_mode: string;
    request_timeout_s: number;
    system_prompt: string;
    system_prompt_append: string; // 7e-a additive axis — appended as its own system message
    failover: boolean; // D18 — selected endpoint fails → walk the local↔cloud + fallbacks chain
    local: InferenceEndpoint;
    cloud: InferenceEndpoint;
    fallbacks: InferenceEndpoint[]; // D18 — extra ordered endpoints tried after local↔cloud
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
}

/** Full config (secrets masked). Conf-only data — scoped to the Conf tab so we don't fetch while
 *  the user is on Fleet/Agent. Re-entry to Conf force-refreshes (refetchOnMount: 'always' inside
 *  useScopedQuery), so the cache stays fresh whenever the user actually looks at it. */
export function useSettings() {
  return useScopedQuery<SettingsDoc>("conf", {
    queryKey: ["settings"],
    queryFn: () => getJSON<SettingsDoc>("/api/settings"),
    staleTime: 30_000,
  });
}

/** Save a partial settings patch. Invalidates the cache + toasts; surfaces a restart note. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => putJSON<SaveResult>("/api/settings", patch),
    onSuccess: (res) => {
      qc.setQueryData(["settings"], res.settings); // adopt the server's masked echo immediately
      qc.invalidateQueries({ queryKey: ["health"] }); // poll cadence/port may have changed
      qc.invalidateQueries({ queryKey: ["voice-status"] }); // a Voice edit flips mic/TTS availability (6b)
      if (res.restart_required.length) {
        pushToast(`Saved · restart to apply: ${res.restart_required.join(", ")}`, "info");
      } else {
        pushToast("Settings saved", "ok");
      }
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
