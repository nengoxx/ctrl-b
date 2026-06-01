import { useMutation, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, postJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import { useScopedQuery } from "./useScopedQuery";

// Phase 7c-b. MCP + OpenAPI server lists are managed through dedicated CRUD endpoints (not the
// settings PUT) and applied between agent turns. The status carries per-server discovery summaries
// + a `dirty` flag (pending changes not yet re-discovered).

export interface ServerSummary {
  server: string;
  tools: number;
  error: string | null;
}
export interface IntegrationsStatus {
  mcp: ServerSummary[];
  openapi: ServerSummary[];
  dirty: boolean;
}

export interface McpServer {
  name: string;
  transport: string; // "streamable_http" | "stdio"
  enabled: boolean;
  risk: string;
  url: string;
  headers: Record<string, string>;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface OpenApiServer {
  name: string;
  base_url: string;
  spec_url: string;
  enabled: boolean;
  risk: string;
  api_key: string | null; // masked on read
  auth_scheme: string;
  auth_header: string;
  headers: Record<string, string>;
  include: string[];
}

export type IntegrationKind = "mcp" | "openapi";

/** MCP/OpenAPI discovery status. Scoped to Conf — the 15s polling interval used to run while the
 *  user was on Fleet/Agent doing nothing with integrations; now it only runs when Conf is open. */
export function useIntegrationsStatus() {
  return useScopedQuery<IntegrationsStatus>("conf", {
    queryKey: ["integrations"],
    queryFn: () => getJSON<IntegrationsStatus>("/api/integrations/status"),
    refetchInterval: 15_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["settings"] }); // server lists live in the config
    qc.invalidateQueries({ queryKey: ["integrations"] }); // status/dirty
  };
}

/** Create or update a server. `name === null` → create (POST); otherwise update (PUT). */
export function useSaveServer(kind: IntegrationKind) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ name, body }: { name: string | null; body: Record<string, unknown> }) =>
      name
        ? putJSON(`/api/integrations/${kind}/${encodeURIComponent(name)}`, body)
        : postJSON(`/api/integrations/${kind}`, body),
    onSuccess: () => {
      invalidate();
      pushToast("Saved · applies on next chat or tap Rediscover", "info");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

export function useDeleteServer(kind: IntegrationKind) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => del(`/api/integrations/${kind}/${encodeURIComponent(name)}`),
    onSuccess: () => {
      invalidate();
      pushToast("Removed · applies on next chat or tap Rediscover", "info");
    },
    onError: (e: Error) => pushToast(e.message || "Delete failed", "err"),
  });
}

export function useRediscover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJSON<IntegrationsStatus>("/api/integrations/rediscover", {}),
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["actions"] }); // the agent toolset changed
      const n = [...status.mcp, ...status.openapi].reduce((a, s) => a + s.tools, 0);
      pushToast(`Rediscovered · ${n} tool${n === 1 ? "" : "s"}`, "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Rediscover failed", "err"),
  });
}
