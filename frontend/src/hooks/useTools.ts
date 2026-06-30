import { useQuery } from "@tanstack/react-query";

import { getJSON, postJSON } from "../api/client";
import type { ToolInvokeResponse, UtilTool } from "../types";

// The Tools-tab utility cards (`GET /api/tools`). The registry's util set is fixed at startup, so
// this is a one-shot fetch (no polling) — unlike fleet/services. One query feeds the whole tab.
export function useTools() {
  return useQuery({
    queryKey: ["tools"],
    queryFn: () => getJSON<UtilTool[]>("/api/tools"),
    staleTime: Infinity,
  });
}

/** Run a utility tool. Resolves to its executed `ToolResult` (+ audit event), or throws on
 *  4xx/5xx with FastAPI's `detail` as the message (surfaced as a toast by the caller). */
export function runTool(name: string, args: Record<string, unknown>) {
  return postJSON<ToolInvokeResponse>(`/api/tools/${name}`, { args });
}
