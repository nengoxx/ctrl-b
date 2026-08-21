import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { publishNotify } from "../lib/notifyBus";
import { reconcileChat } from "../store/chat";
import { setConnection } from "../store/connection";

// Subscribe to the live activity feed (SSE). Any recorded Event — a UI action now, an agent or
// automation action later — refreshes the fleet so all open clients converge. The canonical
// history is always GET /api/events.
//
// F16 — surface connection state to the UI so a tailnet flake (phone walks out of wifi range,
// backend restart, server unreachable) is visible at a glance.
//
// Reconnection model — IMPORTANT nuance:
//
//  - The browser's built-in EventSource only auto-reconnects while `readyState === CONNECTING`.
//    A *partial* drop (TCP idle timeout, brief packet loss) stays in CONNECTING and the
//    browser retries every ~3s on its own.
//
//  - But when the backend is killed (or Vite's dev proxy returns 502 because the upstream is
//    down), EventSource sees a bad HTTP response and transitions to `CLOSED` — at which point
//    the browser STOPS retrying. The connection is dead until the page is reloaded OR we
//    create a new EventSource.
//
//    Without manual recovery, a single backend restart would silently kill the live feed
//    until the user notices and reloads. That's the exact opposite of what F16 promises.
//
//  - So on `error` with `readyState === CLOSED`, we close the old EventSource and schedule a
//    fresh `connect()` with **exponential backoff** (1s → 2s → 4s … capped at 30s). The
//    `setConnection("reconnecting")` badge stays up during the whole retry loop. A successful
//    `open` resets the backoff and triggers the missed-events reconciliation.
//
//    "disconnected" remains in the ConnectionState type as a future-proofing slot (e.g. for a
//    "stream paused by user" toggle), but isn't currently entered — the manual retry means
//    we're always optimistic.

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

// F1 — the `RunState`s that make a recorded Event a FAILURE worth notifying about. Mirrors
// backend `domain/enums.py`: `error` (something broke), `denied` (the gate refused, or the action
// couldn't run — e.g. wake_host with no MAC), `timeout` (gave up waiting). Deliberately NOT
// `cancelled` (the owner interrupted it — they know) or `skipped` (a no-op outcome), and obviously
// not the in-flight states (`pending`/`running`/`awaiting_*`), which resolve into one of these.
const FAILED_STATES: Record<string, string> = {
  error: "Action failed",
  denied: "Action denied",
  timeout: "Action timed out",
};

// A3 14d — the ACTION name the automation runner records one Event under when a run reaches a
// terminal (backend `AutomationService.record_run_event`). Together with a non-null `run_id` it is the
// whole predicate: a TOOL call made *inside* an automation run also carries that run id (attribution,
// 14a), so the run's own lifecycle row is identified by the action name, never by the id alone.
const AUTOMATION_RUN_ACTION = "automation_run";

// How each terminal `RunState` of a RUN reads. `ok` is the only success; the three failures keep the
// word "automation" so the notification says what ended, and they stay in the `automation_done` class
// rather than falling through to `action_failed` — the automation toggle governs automation noise, and
// one run must never raise two notifications. `skipped` (a misfired slot) is absent on purpose: the
// claim writes those rows inside its own transaction and records no Event for them.
const RUN_TERMINALS: Record<string, string> = {
  ok: "Automation finished",
  error: "Automation failed",
  timeout: "Automation timed out",
  cancelled: "Automation interrupted",
};

// F1/D50 M5 — the monitor's CONFIRMED host transitions, and how each one reads. Matched on the ACTION
// name and never on `status` (which is `OK` in both directions, deliberately: the backend observed the
// transition successfully and owns no notify policy). One class for both directions — a host's
// liveness is one concern the owner arms or silences as a whole.
const HOST_TRANSITIONS: Record<string, string> = {
  host_up: "Host back up",
  host_down: "Host down",
};

/** The subset of the domain `Event` (backend `domain/event.py`) this client reads off the wire.
 *  Everything optional: the parse is defensive by design — a frame we can't understand must
 *  invalidate caches like always and simply not notify. */
interface WireEvent {
  id?: unknown;
  action?: unknown;
  target?: unknown;
  status?: unknown;
  summary?: unknown;
  /** Attribution (14a): the automation-run id, preserved through every descendant of a run. */
  run_id?: unknown;
  /** The initiator's id within its kind — for a run frame, the automation's id. */
  origin_id?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A finished automation run, as read off one live Event frame — or `null` for every other frame.
 *  Exported so the stream listener can invalidate the automations caches off the SAME predicate the
 *  notification uses (one definition of "a run just ended", not two that can drift). */
export interface RunTerminalFrame {
  runId: string;
  /** The automation the run belongs to — `""` when the frame didn't name one (nothing to key on). */
  automationId: string;
  /** The `RUN_TERMINALS` title for its state. */
  title: string;
  body: string;
  eventId: string;
}

function parseEvent(raw: string): WireEvent | null {
  try {
    const ev = JSON.parse(raw) as WireEvent;
    return ev !== null && typeof ev === "object" ? ev : null;
  } catch {
    return null; // unparseable frame — cache invalidation already happened; nothing to read
  }
}

/** Read a terminal automation-run frame off one raw Event, or `null`. Pure, so both consumers (the
 *  notification below and the listener's cache invalidation) agree by construction. */
export function runTerminalOf(raw: string): RunTerminalFrame | null {
  const ev = parseEvent(raw);
  return ev && runTerminalOfEvent(ev);
}

/** The predicate itself, on an already-parsed frame — so `notifyForEvent` reads a frame ONCE and both
 *  of its arms share that parse. */
function runTerminalOfEvent(ev: WireEvent): RunTerminalFrame | null {
  const runId = str(ev.run_id);
  if (str(ev.action) !== AUTOMATION_RUN_ACTION || !runId) return null;
  const title = RUN_TERMINALS[str(ev.status)];
  if (!title) return null; // a state this build doesn't read as terminal — invalidate, don't announce
  return {
    runId,
    automationId: str(ev.origin_id) || str(ev.target),
    title,
    // The backend's run summary already leads with the automation's NAME ("nightly: the run
    // completed"), which is what makes the body legible on its own; the title says how it ended.
    body: str(ev.summary) || "the run finished",
    eventId: str(ev.id),
  };
}

/** Turn one live Event frame into a notification signal, when it is one. Split out of the listener so
 *  the mapping (which states, which text) is unit-testable without an EventSource. */
export function notifyForEvent(raw: string): void {
  const ev = parseEvent(raw);
  if (!ev) return; // unparseable frame — cache invalidation already happened; nothing to announce
  const run = runTerminalOfEvent(ev);
  if (run) {
    publishNotify({
      cls: "automation_done",
      // Keyed on the RUN, not the Event: the run is the occurrence being announced, and it is the
      // durable id a re-delivery would repeat.
      key: `run:${run.runId}`,
      title: run.title,
      body: run.body,
      // No `focus`: a run's result is legible from Conf → Automations whenever the owner gets to it,
      // and the run happened while they were elsewhere by definition.
    });
    return; // never also under `action_failed` — see RUN_TERMINALS
  }
  const host = HOST_TRANSITIONS[str(ev.action)];
  if (host) {
    const where = str(ev.target);
    publishNotify({
      cls: "host_up_down",
      // The Event id again: two genuine transitions of one host (down, then up) must BOTH notify, so
      // the key names the occurrence, not the host — only a re-delivered frame is silenced.
      key: `event:${str(ev.id) || `${str(ev.action)}:${where}`}`,
      title: host,
      // The frame carries no friendly name, and in this app the host id IS the human name (corsair,
      // emma…) — so the body stays pure, with no query-cache lookup.
      body: where ? `${where} — ${str(ev.summary) || "state changed"}` : str(ev.summary) || host,
      // The one class whose answer lives on ONE tab (owner ruling 2026-08-20): the tap opens Fleet,
      // with no per-host focus.
      focus: "fleet",
    });
    return; // status is OK both ways, so the failure arm couldn't fire — the return says so structurally
  }
  const title = FAILED_STATES[str(ev.status)];
  if (!title) return;
  const action = str(ev.action) || "action";
  const target = str(ev.target);
  publishNotify({
    cls: "action_failed",
    // The Event id is the durable identity of this record, so a re-delivery can't double-notify.
    key: `event:${str(ev.id) || `${action}:${target}`}`,
    title,
    body: str(ev.summary) || (target ? `${action} · ${target}` : action),
    // No `focus`: a fleet action failure is legible from any tab, and yanking the user off the
    // Agent tab mid-conversation to look at it would be worse than leaving them where they are.
  });
}

export function useEventStream(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;
    let wasDown = false;
    let cancelled = false;

    // Per-event invalidation: only the live fleet caches that the activity feed actually mutates
    // (a recorded Event is a host/service/action change). Cheap; runs on every event.
    //
    // F1 — the payload used to be ignored entirely (the frame was a pure "something changed" ping).
    // It carries the whole domain Event, so it's also the fleet-side notification source: parse it
    // and publish a signal for the failure states. Invalidation runs FIRST and unconditionally — the
    // notification path is strictly additive and must never be able to cost us a cache refresh.
    function onEvent(e: MessageEvent<string>) {
      void qc.invalidateQueries({ queryKey: ["hosts"] });
      void qc.invalidateQueries({ queryKey: ["services"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
      // A3 14d — a run that just ended is the ONE thing the automations caches cannot learn on their
      // own: run-now answers 202 the moment the run is claimed, so a detached run has no completion
      // response to invalidate off. This frame is that signal, so the Conf list goes live the moment a
      // run finishes; the list's poll-while-`busy` (useAutomations) stays as the fallback for a client
      // that missed the frame. Invalidation stays FIRST and unconditional, as above.
      const run = runTerminalOf(e.data);
      if (run) {
        void qc.invalidateQueries({ queryKey: ["automations"] });
        // The history is keyed per automation — invalidate it only when the frame named one.
        if (run.automationId)
          void qc.invalidateQueries({ queryKey: ["automation-runs", run.automationId] });
      }
      notifyForEvent(e.data);
    }

    // Reconcile after a reconnect: invalidate ALL React Query caches (settings, integrations,
    // agents, skills, …) since any of them could have changed during the drop, and trigger the
    // chat reducer to reload too (it's not a React Query consumer). Disabled-by-tab queries
    // just become stale and refetch when their tab next becomes active — no wasted requests.
    function reconcileAfterReconnect() {
      void qc.invalidateQueries();
      // Reload + probe-for-a-live-turn (D39): a feed reconnect usually means the chat stream died
      // too — if a detached turn is still running, re-attach live instead of leaving a static view.
      void reconcileChat();
    }

    function connect() {
      if (cancelled) return;
      es = new EventSource("/api/events/stream");

      es.addEventListener("open", () => {
        setConnection("connected");
        backoffMs = INITIAL_BACKOFF_MS; // reset on any successful open
        if (wasDown) {
          reconcileAfterReconnect();
          wasDown = false;
        }
      });

      es.addEventListener("error", () => {
        wasDown = true;
        setConnection("reconnecting");
        // CONNECTING → browser is still retrying on its own; leave it alone.
        // CLOSED → browser gave up; schedule a manual retry with backoff.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(connect, backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
      });

      es.addEventListener("event", onEvent);
    }

    // F16 — global React Query cache observer as a second connection-health signal. The
    // browser's EventSource is unreliable at detecting silent connection drops mid-session
    // (TCP-level RESET sometimes doesn't propagate through Vite's dev proxy fast enough),
    // so a TLS-clean "everything's fine, no events flowing" state can hide a dead backend.
    // React Query's hosts poll fires every poll-cadence seconds, so the cache reflects
    // backend reachability within a few seconds regardless of what EventSource thinks.
    //
    // Rule: if ANY cache entry is in error state → "reconnecting". When all entries recover
    // (or new successful ones arrive) AND nothing is errored → "connected". The SSE's own
    // setConnection calls compose into the same state; whichever signal updates last wins,
    // but since they generally agree (backend healthy ⇔ no errors), oscillation is rare.
    const cache = qc.getQueryCache();
    const unsubCache = cache.subscribe(() => {
      const anyError = cache.getAll().some((q) => q.state.status === "error");
      if (anyError) setConnection("reconnecting");
      else setConnection("connected");
    });

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      es = null;
      unsubCache();
      setConnection("connected");
    };
  }, [qc]);
}
