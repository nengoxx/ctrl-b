import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, postJSON } from "../api/client";
import { pushToast } from "../store/toast";

// Phase 6c-2 — the in-app HTTPS control (Tailscale Serve). Status is an always-on read (tailscaled is
// the source of truth, DECISIONS D20); the toggle flips it through the audited backend action and
// adopts the fresh status the endpoint returns. Conf-tab data, but not heavy — a short staleTime keeps
// the panel honest if Serve is changed out-of-band (CLI).

export interface AccessStatus {
  available: boolean; // tailscale CLI present + daemon Running
  serving: boolean; // Serve is currently fronting our target_port
  url: string | null; // https://<device>.<tailnet>.ts.net (present whenever available)
  target_port: number;
  reason: string | null; // why unavailable (CLI missing / logged out)
  enabled: boolean; // whether the control surface is active (tailscale.enabled)
}

interface ServeResult extends AccessStatus {
  last?: { state: string; summary: string; error: string | null };
}

export function useAccessStatus() {
  return useQuery<AccessStatus>({
    queryKey: ["access-status"],
    queryFn: () => getJSON<AccessStatus>("/api/access/status"),
    staleTime: 15_000,
  });
}

export function useSetServe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enable: boolean) => postJSON<ServeResult>("/api/access/serve", { enable }),
    onSuccess: (data) => {
      qc.setQueryData(["access-status"], data); // adopt the endpoint's fresh status
      if (data.last && data.last.state !== "ok") {
        pushToast(`HTTPS change failed: ${data.last.error ?? data.last.summary}`, "err");
      } else {
        pushToast(data.serving ? "HTTPS enabled" : "HTTPS disabled", "ok");
      }
    },
    onError: (e: Error) => pushToast(e.message || "HTTPS toggle failed", "err"),
  });
}
