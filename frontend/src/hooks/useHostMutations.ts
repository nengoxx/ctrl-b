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

/** Full `HostIn` body from a loaded Host DTO. The hosts PUT is NOT a PATCH — `_apply_fields`
 *  omit-preserves ONLY vpn_host/ssh_prefer_vpn (D47); every other omitted field would reset to its
 *  HostIn default (os_type→linux, mac/ssh_username/role/services DELETED, ssh_port→22). So a fill
 *  must send the whole host back. Blank ssh_password = keep the stored secret; tags [] = leave tags
 *  untouched — both per the editor's own toPayload contract. */
function hostToPayload(
  h: Host,
): HostPayload & { vpn_host: string | null; ssh_prefer_vpn: boolean } {
  return {
    name: h.name,
    ip: h.ip,
    vpn_host: h.vpn_host ?? null,
    ssh_prefer_vpn: h.ssh_prefer_vpn ?? false,
    mac: h.mac ?? null,
    ssh_username: h.ssh_username ?? null,
    ssh_password: "", // "" → keep existing secret
    ssh_port: h.ssh_port,
    os_type: h.os_type,
    role: h.role ?? null,
    tags: [],
    services: h.services ?? [],
  };
}

/**
 * Fetch VPN-address proposals and auto-fill every host whose `vpn_host` is empty — EXCEPT the host
 * whose editor row is currently open (`skipId`); its unsaved draft was seeded at mount, so a fill
 * would be silently discarded on the next keystroke/save. Existing (differing) addresses are NEVER
 * overwritten (compared case-insensitively — MagicDNS labels are casefolded). Applies go through the
 * same per-host PUT + `["hosts"]`/`["settings"]` invalidation as a manual edit, invalidated ONCE
 * after the batch.
 *
 * Each apply sends the FULL host body (`hostToPayload` + the proposed vpn_host), built from a host
 * list fetched FRESH inside the mutation — never from a possibly-stale query cache/prop, since a
 * full-body PUT would faithfully write back any staleness. Residual (accepted, single-user app):
 * a concurrent edit landing inside the sub-second fetch→PUT window is last-writer-wins, same as the
 * manual editor.
 */
export function useDiscoverVpn() {
  const invalidate = useInvalidate();
  return useMutation<VpnDiscoveryOutcome, Error, { skipId: string | null }>({
    mutationFn: async ({ skipId }) => {
      const res = await getJSON<VpnDiscoveryResponse>("/api/hosts/vpn-discovery");
      if (!res.ok) {
        return { ok: false, reason: res.reason || "discovery failed", lines: [], summary: "" };
      }
      const fresh = await getJSON<Host[]>("/api/hosts");
      const byId = new Map(fresh.map((h) => [h.id, h]));
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
              // Result host missing from the fresh list — never PUT a guessed body.
              lines.push({ name: r.name, status: "failed" });
            } else {
              const line: VpnApplyLine = { name: r.name, status: "filled", proposed: r.proposed };
              lines.push(line);
              applies.push(
                putJSON<Host>(`/api/hosts/${r.id}`, {
                  ...hostToPayload(host),
                  vpn_host: r.proposed,
                }).catch(() => {
                  line.status = "failed"; // one failed PUT stays per-host; the batch never rejects
                }),
              );
            }
          }
        } else if (current.toLowerCase() === r.proposed.toLowerCase()) {
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
