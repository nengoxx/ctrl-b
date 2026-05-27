import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";
import type { Host, ServerInfo } from "../types";

interface Health {
  status: string;
  version: string;
  schema_version: number;
  server: ServerInfo;
}

/** Server info (poll cadence, port). Rarely changes — long stale time. */
export function useServerInfo() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => getJSON<Health>("/api/health"),
    select: (h) => h.server,
    staleTime: 60_000,
  });
}

/** Fleet + derived status, polled at the configured cadence (DESIGN.md §13). */
export function useHosts(pollSeconds: number) {
  return useQuery({
    queryKey: ["hosts"],
    queryFn: () => getJSON<Host[]>("/api/hosts"),
    refetchInterval: Math.max(1, pollSeconds) * 1000,
  });
}
