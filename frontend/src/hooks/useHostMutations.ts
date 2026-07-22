import { useMutation, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, postJSON, putJSON } from "../api/client";
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

// D3 Slice 3 — VPN-address discovery. The backend (`GET /api/hosts/vpn-discovery`) proposes a
// `vpn_host` per configured host from the overlay-network peer list (Tailscale today; the hook stays
// provider-neutral — only the UI label names Tailscale). READ-ONLY on the backend; this hook applies
// the safe fills (hosts whose current vpn_host is empty) via the EXISTING per-host PUT.

/** One matched host from the discovery endpoint (`results[]`). */
export interface VpnDiscoveryHostResult {
  id: string;
  name: string;
  current: string | null; // configured vpn_host today ("" / null = unset)
  proposed: string; // the discovered overlay address
  online: boolean;
}

/** Raw endpoint envelope: `ok:false` on daemon/CLI failure (`reason`), else matched `results` +
 *  `unmatched` host names. */
export interface VpnDiscoveryResponse {
  ok: boolean;
  reason?: string;
  results?: VpnDiscoveryHostResult[];
  unmatched?: string[];
}

/** Per-host outcome the UI renders inline under the button (transient — not persisted). */
export type VpnApplyStatus =
  "filled" | "already-set" | "differs" | "no-match" | "skipped" | "failed";
export interface VpnApplyLine {
  name: string;
  status: VpnApplyStatus;
  proposed?: string; // carried for `filled` / `differs` so the UI can show the value
}

/** Structured result of one discovery run — inline `lines` + the one-shot toast `summary`. */
export interface VpnDiscoveryOutcome {
  ok: boolean;
  reason?: string; // when ok=false (endpoint envelope error)
  lines: VpnApplyLine[];
  summary: string;
}

const APPLY_LABEL: Record<VpnApplyStatus, string> = {
  filled: "filled",
  "already-set": "already set",
  differs: "differs",
  "no-match": "no match",
  skipped: "skipped",
  failed: "failed",
};

/**
 * Fetch VPN-address proposals and auto-fill every host whose `vpn_host` is empty — EXCEPT the host
 * whose editor row is currently open (`skipId`); its unsaved draft was seeded at mount, so a fill
 * would be silently discarded on the next keystroke/save. Existing (differing) addresses are NEVER
 * overwritten. Applies go through the same per-host PUT + `["hosts"]`/`["settings"]` invalidation as
 * a manual edit, invalidated ONCE after the batch.
 *
 * The PUT body carries `{name, ip, vpn_host}` — the endpoint's `HostIn` requires name+ip, and
 * pydantic's `model_fields_set` omit-preserves keeps every other field (name equals the current name,
 * so no rename). A bare `{vpn_host}` body would 422.
 */
export function useDiscoverVpn() {
  const invalidate = useInvalidate();
  return useMutation<VpnDiscoveryOutcome, Error, { hosts: Host[]; skipId: string | null }>({
    mutationFn: async ({ hosts, skipId }) => {
      const res = await getJSON<VpnDiscoveryResponse>("/api/hosts/vpn-discovery");
      if (!res.ok) {
        return { ok: false, reason: res.reason || "discovery failed", lines: [], summary: "" };
      }
      const byId = new Map(hosts.map((h) => [h.id, h]));
      const lines: VpnApplyLine[] = [];
      const applies: Promise<unknown>[] = [];

      for (const r of res.results ?? []) {
        const current = (r.current ?? "").trim();
        if (current === "") {
          if (r.id === skipId) {
            lines.push({ name: r.name, status: "skipped" });
          } else {
            const host = byId.get(r.id);
            if (!host) {
              // Stale hosts prop — never PUT a guessed body (an empty ip would be WRITTEN server-side).
              lines.push({ name: r.name, status: "failed" });
            } else {
              // Minimal body: name+ip (required by HostIn) + the proposed vpn_host. Everything else is
              // omit-preserved server-side; name equals the current name, so no rename.
              const line: VpnApplyLine = { name: r.name, status: "filled", proposed: r.proposed };
              lines.push(line);
              applies.push(
                putJSON<Host>(`/api/hosts/${r.id}`, {
                  name: host.name,
                  ip: host.ip,
                  vpn_host: r.proposed,
                }).catch(() => {
                  line.status = "failed"; // one failed PUT stays per-host; the batch never rejects
                }),
              );
            }
          }
        } else if (current === r.proposed) {
          lines.push({ name: r.name, status: "already-set" });
        } else {
          lines.push({ name: r.name, status: "differs", proposed: r.proposed });
        }
      }
      for (const name of res.unmatched ?? []) lines.push({ name, status: "no-match" });

      await Promise.all(applies);

      const counts = lines.reduce<Record<string, number>>((a, l) => {
        a[l.status] = (a[l.status] ?? 0) + 1;
        return a;
      }, {});
      const order: VpnApplyStatus[] = [
        "filled",
        "failed",
        "already-set",
        "differs",
        "no-match",
        "skipped",
      ];
      const parts = order.filter((s) => counts[s]).map((s) => `${counts[s]} ${APPLY_LABEL[s]}`);
      const summary = `VPN discovery: ${parts.length ? parts.join(" · ") : "no hosts"}`;
      return { ok: true, lines, summary };
    },
    onSuccess: (outcome) => {
      if (!outcome.ok) {
        pushToast(`VPN discovery: ${outcome.reason ?? "failed"}`, "err");
        return;
      }
      if (outcome.lines.some((l) => l.status === "filled")) invalidate(); // once, after the batch
      pushToast(outcome.summary, outcome.lines.some((l) => l.status === "failed") ? "err" : "ok");
    },
    onError: (e: Error) => pushToast(e.message || "VPN discovery failed", "err"),
  });
}
