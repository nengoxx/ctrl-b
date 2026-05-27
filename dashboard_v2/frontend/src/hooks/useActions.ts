import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, postJSON } from "../api/client";
import { requestConfirm } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { ActionSpec, Host, InvokeResponse } from "../types";

// Phase 2 action wiring. The registry (GET /api/actions) tells us which actions are confirm-gated,
// so the UI doesn't hardcode it (D8 ethos). The server still runs its single-use confirm-token
// dance underneath — the dialog is UX, the token is enforcement (DESIGN §14).

export type FleetAction = "wake" | "shutdown" | "ping";

const ACTION_NAME: Record<FleetAction, string> = {
  wake: "wake_host",
  shutdown: "shutdown_host",
  ping: "ping_host",
};

/** The action registry. Rarely changes — long stale time. */
export function useActionSpecs() {
  return useQuery({
    queryKey: ["actions"],
    queryFn: () => getJSON<ActionSpec[]>("/api/actions"),
    staleTime: 5 * 60_000,
  });
}

/** Optimistically flip one host's online flag in the ['hosts'] cache. */
function patchHostOnline(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  online: boolean,
): void {
  qc.setQueryData<Host[]>(["hosts"], (cur) =>
    cur?.map((h) =>
      h.id === id && h.status ? { ...h, status: { ...h.status, online } } : h,
    ),
  );
}

/**
 * Run wake/shutdown/ping against a host with: confirm dialog for the high-risk one, a busy
 * indicator for the duration, optimistic offline-flip + rollback for shutdown, and an outcome
 * toast. `wake` doesn't optimistically show "online" (a woken host takes time to boot — that
 * would be a lie that reverts); its optimism is the busy state, reconciled by the next poll.
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

  const run = useCallback(
    async (action: FleetAction, host: Host) => {
      const name = ACTION_NAME[action];
      const spec = specs?.find((s) => s.name === name);
      const needsConfirm = spec ? spec.confirm || spec.risk === "high" : action === "shutdown";

      if (needsConfirm) {
        const ok = await requestConfirm({
          title: `Shut down ${host.name}?`,
          confirmLabel: "Shut down",
          danger: true,
        });
        if (!ok) return;
      }

      const prev = qc.getQueryData<Host[]>(["hosts"]);
      if (action === "shutdown") patchHostOnline(qc, host.id, false);

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
        } else {
          if (prev) qc.setQueryData(["hosts"], prev); // rollback optimistic flip
          pushToast(r?.summary || r?.error || "action failed", "err");
        }
      } catch (e) {
        if (prev) qc.setQueryData(["hosts"], prev);
        pushToast((e as Error).message, "err");
      } finally {
        setBusyId(host.id, false);
        qc.invalidateQueries({ queryKey: ["hosts"] }); // reconcile with reality on next sweep
      }
    },
    [qc, specs, setBusyId],
  );

  return { run, busy };
}
