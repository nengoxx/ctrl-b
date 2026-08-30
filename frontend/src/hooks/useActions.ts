import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, postJSON } from "../api/client";
import { requestConfirm } from "../store/confirm";
import { beginPending, clearPending } from "../store/fleetPending";
import { pushToast } from "../store/toast";
import type { ActionSpec, AgentMode, Host, InvokeResponse } from "../types";

// Phase 2 action wiring. The registry (GET /api/actions) tells us which actions are confirm-gated,
// so the UI doesn't hardcode it (D8 ethos). The server still runs its single-use confirm-token
// dance underneath — the dialog is UX, the token is enforcement (DESIGN §14).

export type FleetAction = "wake" | "shutdown" | "reboot" | "ping";

const ACTION_NAME: Record<FleetAction, string> = {
  wake: "wake_host",
  shutdown: "shutdown_host",
  reboot: "reboot_host",
  ping: "ping_host",
};

/** Per-action confirm-dialog copy (the registry decides *whether* to confirm; this is just text). */
const CONFIRM_COPY: Partial<Record<FleetAction, { verb: string }>> = {
  shutdown: { verb: "Shut down" },
  reboot: { verb: "Reboot" },
};

/** The tri-state agent-access mode a tool's live `(agent_exposed, core)` represents — mirrors the
 *  backend `agent_mode_of` (Phase 8b, D22). The single client-side derivation, shared by the Tools-tab
 *  catalog and the AgentsEditor tick-grid mirror so the two never drift. */
export function agentModeOf(s: ActionSpec): AgentMode {
  return s.core ? "core" : s.agent_exposed ? "enabled" : "disabled";
}

/** The action registry. Rarely changes — long stale time. */
export function useActionSpecs() {
  return useQuery({
    queryKey: ["actions"],
    queryFn: () => getJSON<ActionSpec[]>("/api/actions"),
    staleTime: 5 * 60_000,
  });
}

/** The one `run` signature, shared with every surface that receives it as a prop. Resolves `true`
 *  only when the action reported ok — a cancelled confirm, a refusal and a transport error are all
 *  `false`. Errors are still HANDLED here (toast; never a rejection): the outcome exists for the
 *  pending-transition bookkeeping, not for callers to re-handle failures. */
export type FleetRun = (action: FleetAction, host: Host) => Promise<boolean>;

/**
 * Run wake/shutdown/ping against a host with: confirm dialog for the high-risk one, a busy
 * indicator for the request, a pending-transition record for the two power actions, and an outcome
 * toast.
 *
 * WAKE and SHUTDOWN mark the host PENDING in `store/fleetPending` at dispatch (cleared again if the
 * request fails — token-guarded, so a stale failure can't kill a newer action's record). That store
 * is what holds the assumed state through the boot/shutdown window: `useFleet` presents hosts
 * through it and keeps pending hosts action-busy, so the old optimistic cache flip — which the
 * settle-time refetch overwrote while the machine was still pingable, bouncing the card back online
 * — is gone rather than patched. The refetch below is now harmless to the presentation and still
 * right for ping.
 */
export function useFleetActions() {
  const qc = useQueryClient();
  const { data: specs } = useActionSpecs();
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const setBusyId = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const run = useCallback<FleetRun>(
    async (action, host) => {
      const name = ACTION_NAME[action];
      const spec = specs?.find((s) => s.name === name);
      const needsConfirm = spec
        ? spec.confirm || spec.risk === "high"
        : action === "shutdown" || action === "reboot";

      if (needsConfirm) {
        const verb = CONFIRM_COPY[action]?.verb ?? "Run";
        const ok = await requestConfirm({
          title: `${verb} ${host.name}?`,
          confirmLabel: verb,
          danger: true,
        });
        if (!ok) return false;
      }

      // The pending record starts at DISPATCH, not at the response: the WOL/SSH request round-trip
      // says nothing about the transition, and gacha's wake ceremony gates its theatre on this
      // record from its very first beat. A failure below hands the token back.
      const pendingToken =
        action === "wake" || action === "shutdown" ? beginPending(host.id, action) : null;

      setBusyId(host.id, true);
      try {
        let res = await postJSON<InvokeResponse>(`/api/actions/${name}`, {
          args: { host_id: host.id },
        });
        if (res.needs_confirm) {
          res = await postJSON<InvokeResponse>(`/api/actions/${name}`, {
            args: { host_id: host.id },
            confirm_token: res.confirm_token,
          });
        }
        const r = res.result;
        if (r && r.state === "ok") {
          pushToast(r.summary, "ok");
          return true;
        }
        if (pendingToken !== null) clearPending(host.id, pendingToken);
        pushToast(r?.summary || r?.error || "action failed", "err");
        return false;
      } catch (e) {
        if (pendingToken !== null) clearPending(host.id, pendingToken);
        pushToast((e as Error).message, "err");
        return false;
      } finally {
        setBusyId(host.id, false);
        void qc.invalidateQueries({ queryKey: ["hosts"] }); // reconcile with reality on next sweep
      }
    },
    [qc, specs, setBusyId],
  );

  return { run, busy };
}
