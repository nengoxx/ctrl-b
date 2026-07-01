import { useMutation, useQueryClient } from "@tanstack/react-query";

import { del, postJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import type { Host, HostServiceCfg } from "../types";

// Phase 7b. Add / edit / delete machines in config.yaml via the dedicated hosts CRUD endpoints.
// The payload mirrors the backend `HostIn`: a blank `ssh_password` means "keep the stored secret".

export interface HostPayload {
  name: string;
  ip: string;
  mac?: string | null;
  ssh_username?: string | null;
  ssh_password?: string | null; // "" / omitted on update = keep existing
  ssh_port: number;
  os_type: string;
  role?: string | null;
  tags?: string[];
  services: HostServiceCfg[];
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["hosts"] });
    void qc.invalidateQueries({ queryKey: ["settings"] }); // computers section changed
  };
}

export function useCreateHost() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: HostPayload) => postJSON<Host>("/api/hosts", p),
    onSuccess: (h) => {
      invalidate();
      pushToast(`Added ${h.name}`, "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Add failed", "err"),
  });
}

export function useUpdateHost() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: HostPayload }) =>
      putJSON<Host>(`/api/hosts/${id}`, payload),
    onSuccess: (h) => {
      invalidate();
      pushToast(`Saved ${h.name}`, "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

export function useDeleteHost() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => del(`/api/hosts/${id}`),
    onSuccess: () => {
      invalidate();
      pushToast("Machine removed", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Delete failed", "err"),
  });
}
