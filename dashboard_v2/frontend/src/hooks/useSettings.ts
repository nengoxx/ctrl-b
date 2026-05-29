import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import type { McpServer, OpenApiServer } from "./useIntegrations";

// Phase 7a. The settings doc is the whole masked config; the Conf forms read/write the slices they
// expose (server + inference here). Typed loosely — only the edited groups are modelled; the rest
// round-trips opaquely so a partial PUT never has to mirror the entire backend Settings shape.

export interface InferenceEndpoint {
  base_url: string;
  api_key: string | null; // masked on read (e.g. "ab…yz"); echo unchanged to keep the stored secret
  model: string;
}

export interface SettingsDoc {
  server: { host: string; port: number; poll_seconds: number; debug: boolean };
  inference: {
    default_mode: string;
    request_timeout_s: number;
    system_prompt: string;
    local: InferenceEndpoint;
    cloud: InferenceEndpoint;
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
  mcp_servers: McpServer[]; // Phase 7c-b — managed via the integrations CRUD endpoints, read here
  openapi_servers: OpenApiServer[];
  [k: string]: unknown; // other sections (agent, …) — managed elsewhere
}

export interface SaveResult {
  settings: SettingsDoc;
  restart_required: string[];
}

/** Full config (secrets masked). Changes rarely; refetched on save via invalidation. */
export function useSettings() {
  return useQuery({
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
      if (res.restart_required.length) {
        pushToast(`Saved · restart to apply: ${res.restart_required.join(", ")}`, "info");
      } else {
        pushToast("Settings saved", "ok");
      }
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
