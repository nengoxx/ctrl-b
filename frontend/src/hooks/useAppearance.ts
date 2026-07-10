// Cross-device appearance sync (Phase 11 / D28 §9.11, extended M3 §14.3) — BUILT DAY 1.
//
// Backend-authoritative, server-stamped LWW; localStorage is the instant cache + offline truth. Three
// pieces: a lightweight ALWAYS-ON read (`useAppearance` — a plain useQuery, NOT useScopedQuery: it must
// fetch on mount regardless of the active tab, since the full settings doc is Conf-scoped), a
// reconcile-on-mount hook (`useAppearanceSync`, mounted once in App), and the optimistic write
// (`useSaveAppearance`, used by the Conf picker).
//
// The synced unit is {theme, mode, accent, motion, perf, themeSettings} — one LWW stamp covers all of
// them (owner directive 2026-06-26: motion + perf are device levers but kept consistent across devices;
// themeSettings carries each theme's namespaced options). The WIRE uses snake_case `theme_settings`
// (matching the existing `updated_at`); the store uses camelCase `themeSettings` — bridged here.

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJSON, putJSON } from "../api/client";
import { stableStringify } from "../lib/stableStringify";
import {
  getUI,
  setUI,
  stripLegacyAppbar,
  type Motion,
  type Perf,
  type ThemeSettingsMap,
} from "../store/ui";
import { pushToast } from "../store/toast";
import { registry } from "../theme-engine/registry";
import { switchTheme } from "../theme-engine/switchTheme";
import type { Mode, ThemeId } from "../theme-engine/types";

export interface AppearanceDoc {
  theme: string;
  mode: string;
  accent: string;
  // The M3 fields are nullable: the server defaults them to null ("unseeded") so a pre-M3 doc (which
  // already has a stamped updated_at) doesn't look authored — reconcile then keeps local via `?? local`.
  motion: string | null;
  perf: string | null;
  theme_settings: ThemeSettingsMap | null; // snake on the wire (mirrors AppearanceCfg); → store `themeSettings`
  updated_at: string | null; // server-stamped; carried for a future conflict check (none built — LWW)
}

/** The local appearance selection the reconcile compares against (a `getUI()` projection). */
export interface AppearanceLocal {
  theme: string;
  mode: string;
  accent: string;
  motion: string;
  perf: string;
  themeSettings: ThemeSettingsMap;
}

/** The fields the reconcile applies (server-wins). Skin-change goes through `switchTheme`; the rest are
 *  instant `setUI`. */
export interface AppearanceApply {
  theme: ThemeId;
  mode: Mode;
  accent: string;
  motion: Motion;
  perf: Perf;
  themeSettings: ThemeSettingsMap;
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
 *  value also returns null (no re-apply → no flash). Pure → unit-tested directly. A server field absent
 *  (a pre-M3 doc) falls back to the local value for that field — that field just has no recorded opinion.
 *
 *  `isRegistered` is an INJECTED predicate (item ⑥ / §14.15.1-A ⑥+): "does this build know how to render
 *  that skin id?". It's a parameter rather than a direct `registry` read so the function stays pure and
 *  unit tests can stub it without pulling the theme registry (incl. cosmos's canvas imports) into jsdom.
 *  When the server names an UNREGISTERED skin it has "no renderable opinion" on the skin, so we HOLD the
 *  whole skin-triple {theme,mode,accent} at local (they're skin-scoped and atomic per skin) while STILL
 *  applying the global/namespaced motion/perf/themeSettings (unknown theme_settings keys stay inert). This
 *  function only ever RETURNS an apply — it never writes a held/coerced value back to the server (the
 *  caller performs NO PUT for a reconcile; §14.15.2 explicit-user-action-only invariant). */
export function reconcileAppearance(
  server: AppearanceDoc,
  local: AppearanceLocal,
  isRegistered: (id: string) => boolean,
): AppearanceApply | null {
  if (server.updated_at == null) return null; // server has no opinion → keep local
  const motion = server.motion ?? local.motion;
  const perf = server.perf ?? local.perf;
  // Strip the dead per-theme `hideAppbar` (now the global appbarMode) so a stale SYNCED copy can't re-dirty
  // local each load (it's already stripped from local by the migration → compares clean, no spurious apply;
  // a later appearance save then propagates the clean value to the server).
  const themeSettings = stripLegacyAppbar(server.theme_settings ?? local.themeSettings);
  // Compute the EFFECTIVE next skin-triple BEFORE the equality gate: server's if the skin is registered,
  // else hold local's (item ⑥). Doing it here means a held triple + a matching motion-trio correctly falls
  // through to the null no-op below (no spurious apply loop when the ONLY difference is an unrenderable skin).
  const skinOk = isRegistered(server.theme);
  const theme = skinOk ? server.theme : local.theme;
  const mode = skinOk ? server.mode : local.mode;
  const accent = skinOk ? server.accent : local.accent;
  if (
    theme === local.theme &&
    mode === local.mode &&
    accent === local.accent &&
    motion === local.motion &&
    perf === local.perf &&
    stableStringify(themeSettings) === stableStringify(local.themeSettings)
  ) {
    return null; // already matches → no-op
  }
  return {
    theme: theme as ThemeId,
    mode: mode as Mode,
    accent,
    motion: motion as Motion,
    perf: perf as Perf,
    themeSettings,
  };
}

/** Reconcile the `ui` store against the server selection (§9.11). Mounted once in App (always-on). A
 *  differing SKIN goes through `switchTheme` so the theme bundle loads before it applies (the rest are
 *  instant). With the optimistic write below (which updates this cache on change), a just-made local
 *  change is never reverted. */
export function useAppearanceSync(): void {
  const { data } = useAppearance();
  useEffect(() => {
    if (!data) return;
    const ui = getUI();
    const local: AppearanceLocal = {
      theme: ui.theme,
      mode: ui.mode,
      accent: ui.accent,
      motion: ui.motion,
      perf: ui.perf,
      themeSettings: ui.themeSettings,
    };
    // Real registry predicate for the reconcile skin door (item ⑥). Importing `registry` here is fine —
    // this module already pulls it transitively via `switchTheme`.
    const next = reconcileAppearance(data, local, (id) => registry[id as ThemeId] != null);
    if (!next) return;
    if (next.theme !== local.theme) {
      // The double-switch this branch can trigger is LIVE (minimal + cosmos are registered, so a SKIN
      // mismatch really occurs): a self-initiated `pickTheme` optimistically writes the appearance cache,
      // which re-fires this effect while `switchTheme`'s async bundle-load is still pending → `local.theme`
      // is stale → this branch calls `switchTheme` again. Item ⑤'s SUPERSEDE guard (§14.15.1) — NOT the
      // same-target dedupe — is what collapses it to a single applied View Transition: the two calls carry
      // DIFFERENT targets (the reconcile fills motion/perf/themeSettings; the pick omits them, SwitchTarget
      // §14.3), so the dedupe key differs; the monotonic token inside `switchTheme` then lets only the LAST
      // call apply its VT. This branch stays as-is — it routes a differing SKIN through `switchTheme` so the
      // theme bundle loads before it applies (the rest are instant `setUI`).
      void switchTheme(next.theme, {
        mode: next.mode,
        accent: next.accent,
        motion: next.motion,
        perf: next.perf,
        themeSettings: next.themeSettings,
      });
    } else {
      setUI({
        mode: next.mode,
        accent: next.accent,
        motion: next.motion,
        perf: next.perf,
        themeSettings: next.themeSettings,
      });
    }
  }, [data]);
}

export interface AppearancePatch {
  theme: ThemeId;
  mode: Mode;
  accent: string;
  motion: Motion;
  perf: Perf;
  themeSettings: ThemeSettingsMap;
}

/** Build the full appearance patch from the current `ui` store — every appearance write sends the whole
 *  doc (idempotent full patch), so a single field change carries the rest unchanged. */
export function currentAppearancePatch(): AppearancePatch {
  const ui = getUI();
  return {
    theme: ui.theme,
    mode: ui.mode,
    accent: ui.accent,
    motion: ui.motion,
    perf: ui.perf,
    themeSettings: ui.themeSettings,
  };
}

/** Optimistic, scope-serialized write of the appearance selection (§9.11). The Conf picker calls this
 *  AFTER applying locally (setUI/switchTheme/setThemeSetting). The optimistic cache update keeps the
 *  always-on reconcile consistent (it never reverts the change); the mutation scope serializes rapid
 *  toggles in order; the PUT pauses+auto-resumes offline (TanStack networkMode:"online" default). */
export function useSaveAppearance() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: "appearance" },
    mutationFn: (patch: AppearancePatch) =>
      putJSON<unknown>("/api/settings", {
        appearance: {
          theme: patch.theme,
          mode: patch.mode,
          accent: patch.accent,
          motion: patch.motion,
          perf: patch.perf,
          theme_settings: patch.themeSettings, // camel store → snake wire
        },
      }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY }); // stop an in-flight GET from clobbering the new value
      const prev = qc.getQueryData<AppearanceDoc>(KEY);
      qc.setQueryData<AppearanceDoc>(KEY, (old) => ({
        theme: patch.theme,
        mode: patch.mode,
        accent: patch.accent,
        motion: patch.motion,
        perf: patch.perf,
        theme_settings: patch.themeSettings,
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
