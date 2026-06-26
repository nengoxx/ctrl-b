// Cross-device appearance sync (Phase 11 / D28 §9.11) — BUILT DAY 1.
//
// Backend-authoritative, server-stamped LWW; localStorage is the instant cache + offline truth. Three
// pieces: a lightweight ALWAYS-ON read (`useAppearance` — a plain useQuery, NOT useScopedQuery: it must
// fetch on mount regardless of the active tab, since the full settings doc is Conf-scoped), a
// reconcile-on-mount hook (`useAppearanceSync`, mounted once in App), and the optimistic write
// (`useSaveAppearance`, used by the Conf picker).

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { getUI, setUI } from "../store/ui";
import { pushToast } from "../store/toast";
import { switchTheme } from "../theme-engine/switchTheme";
import type { Mode, ThemeId } from "../theme-engine/types";

export interface AppearanceDoc {
  theme: string;
  mode: string;
  accent: string;
  updated_at: string | null; // server-stamped; carried for a future conflict check (none built — LWW)
}

const KEY = ["appearance"] as const;

/** The active appearance selection — a plain always-on query (fetches on mount on any tab). */
export function useAppearance() {
  return useQuery<AppearanceDoc>({
    queryKey: KEY,
    queryFn: () => getJSON<AppearanceDoc>("/api/appearance"),
    staleTime: 30_000,
  });
}

/** Pure reconcile decision (compare-then-set, server wins — §9.11). Returns the fields to apply, or
 *  `null` for a no-op. **Server wins ONLY when it has a recorded preference (`updated_at != null`)** —
 *  an UNWRITTEN server has no opinion, so the local (localStorage) selection is kept rather than reverted
 *  to the backend defaults (otherwise the owner's existing local pref would be wiped on the first load
 *  after this feature ships; the server gets seeded the next time the picker is touched). A matching
 *  value also returns null (no re-apply → no flash). Pure → unit-tested directly. */
export function reconcileAppearance(
  server: AppearanceDoc,
  local: { theme: string; mode: string; accent: string },
): { theme: ThemeId; mode: Mode; accent: string } | null {
  if (server.updated_at == null) return null; // server has no opinion → keep local
  if (server.theme === local.theme && server.mode === local.mode && server.accent === local.accent) {
    return null; // already matches → no-op
  }
  return { theme: server.theme as ThemeId, mode: server.mode as Mode, accent: server.accent };
}

/** Reconcile the `ui` store against the server selection (§9.11). Mounted once in App (always-on). A
 *  differing SKIN goes through `switchTheme` so the theme bundle loads before it applies (mode/accent are
 *  instant). With the optimistic write below (which updates this cache on change), a just-made local
 *  change is never reverted. */
export function useAppearanceSync(): void {
  const { data } = useAppearance();
  useEffect(() => {
    if (!data) return;
    const local = getUI();
    const next = reconcileAppearance(data, local);
    if (!next) return;
    if (next.theme !== local.theme) {
      void switchTheme(next.theme, { mode: next.mode, accent: next.accent });
    } else {
      setUI({ mode: next.mode, accent: next.accent });
    }
  }, [data]);
}

export interface AppearancePatch {
  theme: ThemeId;
  mode: Mode;
  accent: string;
}

/** Optimistic, scope-serialized write of the appearance selection (§9.11). The Conf picker calls this
 *  AFTER applying locally (setUI/switchTheme). The optimistic cache update keeps the always-on reconcile
 *  consistent (it never reverts the change); the mutation scope serializes rapid toggles in order; the
 *  PUT pauses+auto-resumes offline (TanStack networkMode:"online" default). Idempotent full patch. */
export function useSaveAppearance() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: "appearance" },
    mutationFn: (patch: AppearancePatch) => putJSON<unknown>("/api/settings", { appearance: patch }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY }); // stop an in-flight GET from clobbering the new value
      const prev = qc.getQueryData<AppearanceDoc>(KEY);
      qc.setQueryData<AppearanceDoc>(KEY, (old) => ({
        theme: patch.theme,
        mode: patch.mode,
        accent: patch.accent,
        updated_at: old?.updated_at ?? null,
      }));
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev); // roll back the optimistic cache
      pushToast("Couldn't sync appearance", "err");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY }); // adopt the server's stamped value
    },
  });
}
