import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, postJSON, putJSON } from "../api/client";
import type { Privilege } from "../lib/privilege";
import { pushToast } from "../store/toast";
import { useScopedQuery } from "./useScopedQuery";

// A3 slice 3 (D49 / AUTOMATIONS_PLAN §D-6) — scheduled automations, the data layer for the Conf
// group + its editor sheet. Mirrors `useHostMutations`: dedicated CRUD mutations, ONE invalidator, a
// toast per outcome. The write path deliberately differs from the hosts one — automations live in
// SQLite behind `AutomationService`, not in `config.yaml` behind `settings_write_lock` (§D-1: an
// agent-writable record must never be able to brick the config-validated boot) — so nothing here
// touches the `["settings"]` cache.

export type QuestionPolicy = "skip" | "use_default";
export type ThreadMode = "fresh" | "rolling";
export type RunStatus = "running" | "ok" | "error" | "timed_out" | "interrupted" | "missed";
export type RunTrigger = "scheduled" | "manual";

/** One stored automation — the backend `Automation` record verbatim (times are ISO strings). */
export interface Automation {
  id: string;
  name: string;
  schedule: string; // 5-field cron
  tz: string; // always a real IANA key — the server resolves a blank one at save
  prompt: string;
  enabled: boolean;
  agent: string | null; // null = the default agent, resolved per run
  privilege: Privilege | null; // null = the resolved agent's own level
  question_policy: QuestionPolicy;
  thread_mode: ThreadMode;
  thread_id: string | null;
  timeout_s: number | null; // null = `automations.default_timeout_s`
  next_run_at: string | null; // null = never claimed (i.e. disabled)
  rev: number;
  created_at: string;
  updated_at: string;
}

/** One execution. `read_at === null` is the unread marker the history + the row badge key on. */
export interface AutomationRun {
  id: string;
  automation_id: string;
  trigger: RunTrigger;
  scheduled_for: string | null;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  error: string | null;
  thread_id: string | null;
  read_at: string | null;
}

/** A list row: the record plus the echoes only the server can compute (cron → English, next fires). */
export interface AutomationView {
  automation: Automation;
  schedule_text: string;
  next_fires: string[]; // empty for a disabled row, or one whose schedule this build can't evaluate
  last_run: AutomationRun | null;
  unread_runs: number;
  running: boolean;
}

/** The list envelope. The four feature-level facts exist so the editor never hardcodes what config
 *  owns (§D-7): the cap, the zone a blank `tz` means, the timeout a blank field means, and whether
 *  the scheduler is even armed. */
export interface AutomationsDoc {
  automations: AutomationView[];
  enabled: boolean; // `automations.enabled` — off = nothing fires on a schedule (run-now still works)
  busy: boolean; // a run is executing right now → run-now would 409 (concurrency 1 is GLOBAL)
  max_count: number;
  server_tz: string;
  default_timeout_s: number;
}

/** The ONE write shape — the backend's `AutomationDraft`, shared by POST, PUT and the agent tool. */
export interface AutomationDraft {
  name: string;
  schedule: string;
  prompt: string;
  tz: string | null;
  agent: string | null;
  privilege: Privilege | null;
  question_policy: QuestionPolicy;
  thread_mode: ThreadMode;
  timeout_s: number | null;
  enabled: boolean;
}

/** What a cron would mean — advisory, always a 200 (see the backend's `SchedulePreview`). */
export interface SchedulePreview {
  valid: boolean;
  error: string | null;
  field: string | null; // "schedule" | "tz" — which input the message belongs to
  tz: string;
  describe: string | null;
  next_fires: string[];
}

/** Seed a draft from a stored automation (edit) or from nothing (create). One place, so the two
 *  paths cannot disagree about what a new automation's defaults are — they are the record's. */
export function draftOf(a: Automation | null): AutomationDraft {
  return {
    name: a?.name ?? "",
    schedule: a?.schedule ?? "0 9 * * *",
    prompt: a?.prompt ?? "",
    tz: a?.tz ?? null,
    agent: a?.agent ?? null,
    privilege: a?.privilege ?? null,
    question_policy: a?.question_policy ?? "use_default",
    thread_mode: a?.thread_mode ?? "fresh",
    timeout_s: a?.timeout_s ?? null,
    enabled: a?.enabled ?? true,
  };
}

/** How often the two automation reads re-poll WHILE something is actually running.
 *
 *  Run-now is 202-detached (§D-6): the request returns the instant the run is claimed, so the client
 *  gets no completion signal at all — without this the status chip and the history would sit on
 *  "running" until the owner left and re-entered the tab. The interval is armed ONLY while the data
 *  itself says a run is live, so the idle cost stays exactly zero. UI cadence, deliberately not a
 *  server-provided value: nothing about it belongs in config. */
const RUNNING_POLL_MS = 3_000;

/** Every automation + its echoes. Conf-scoped (the group and its sheet are the only consumers), so
 *  it pauses off-tab and force-refreshes on re-entry — `useScopedQuery`'s policy. `busy` is the
 *  server's own "a run is executing" fact, so the poll follows the run rather than a timer. */
export function useAutomations() {
  return useScopedQuery<AutomationsDoc>("conf", {
    queryKey: ["automations"],
    queryFn: () => getJSON<AutomationsDoc>("/api/automations"),
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data?.busy ? RUNNING_POLL_MS : false),
  });
}

/** One automation's run history — lazy by id (gated on the open sheet), so a plain `useQuery`.
 *  Polls on the same rule as the list: only while a row it is showing is still `running`. */
export function useAutomationRuns(id: string | null) {
  return useQuery<AutomationRun[]>({
    queryKey: ["automation-runs", id],
    queryFn: () => getJSON<AutomationRun[]>(`/api/automations/${id}/runs`),
    enabled: !!id,
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === "running") ? RUNNING_POLL_MS : false,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (id?: string | null) => {
    void qc.invalidateQueries({ queryKey: ["automations"] });
    // The history is keyed per automation, so a run/mark-read has to name the one it changed;
    // `undefined` (create/delete) leaves the per-id caches alone — there is nothing stale in them.
    if (id) void qc.invalidateQueries({ queryKey: ["automation-runs", id] });
  };
}

export function useCreateAutomation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (draft: AutomationDraft) => postJSON<Automation>("/api/automations", draft),
    onSuccess: (a) => {
      invalidate();
      pushToast(`Added ${a.name}`, "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Add failed", "err"),
  });
}

export function useUpdateAutomation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: AutomationDraft }) =>
      putJSON<Automation>(`/api/automations/${id}`, draft),
    onSuccess: (a) => {
      invalidate(a.id);
      pushToast(`Saved ${a.name}`, "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

export function useDeleteAutomation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => del(`/api/automations/${id}`),
    onSuccess: () => {
      invalidate();
      pushToast("Automation removed", "ok");
    },
    // 409 = a run of it is active (or one of its threads has a live turn); the server's message says
    // which and what to do about it, so it is surfaced verbatim rather than flattened to "failed".
    onError: (e: Error) => pushToast(e.message || "Delete failed", "err"),
  });
}

/** The list row's switch. A dedicated endpoint, not a PUT: the row has no draft to send, and enabling
 *  is where the server recomputes a strictly-future slot. */
export function useSetAutomationEnabled() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      postJSON<Automation>(`/api/automations/${id}/enabled`, { enabled }),
    onSuccess: (a) => invalidate(a.id),
    onError: (e: Error) => pushToast(e.message || "Could not change the switch", "err"),
  });
}

/** Start a run now. The endpoint answers 202 the moment the run is CLAIMED — it does not wait for the
 *  turn — so the toast says "started", and the outcome shows up in the history (and in the run's
 *  thread, live, if the owner opens it). */
export function useRunAutomationNow() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => postJSON<AutomationRun>(`/api/automations/${id}/run-now`, {}),
    onSuccess: (run) => {
      invalidate(run.automation_id);
      pushToast("Run started", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Could not start the run", "err"),
  });
}

/** Clear a run's unread marker. Silent (no toast): it is a side effect of reading the history, not an
 *  action the owner asked for. */
export function useMarkRunRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ runId }: { runId: string; automationId: string }) =>
      postJSON<AutomationRun>(`/api/automations/runs/${runId}/read`, {}),
    onSuccess: (_run, vars) => invalidate(vars.automationId),
  });
}

/** Debounce a value by `ms`. Local to this hook file because the ONE thing that needs it is the
 *  live schedule preview: it is a server round-trip per keystroke otherwise. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** How long the editor waits after a keystroke before asking the server what the cron means. Long
 *  enough that typing a whole expression is one request, short enough to feel live. */
const PREVIEW_DEBOUNCE_MS = 300;

/** The editor's live schedule preview. Advisory by contract — the endpoint always answers 200, so an
 *  invalid expression arrives as `valid:false` data (rendered inline) rather than a query error.
 *  Disabled while the field is blank: there is nothing to preview, and the server would only echo
 *  "a schedule is required" at a field the owner has not filled in yet. */
export function useSchedulePreview(schedule: string, tz: string | null) {
  const debouncedSchedule = useDebounced(schedule.trim(), PREVIEW_DEBOUNCE_MS);
  const debouncedTz = useDebounced((tz ?? "").trim(), PREVIEW_DEBOUNCE_MS);
  return useQuery<SchedulePreview>({
    queryKey: ["schedule-preview", debouncedSchedule, debouncedTz],
    queryFn: () =>
      postJSON<SchedulePreview>("/api/automations/schedule-preview", {
        schedule: debouncedSchedule,
        tz: debouncedTz || null,
      }),
    enabled: debouncedSchedule.length > 0,
    staleTime: 30_000,
  });
}
