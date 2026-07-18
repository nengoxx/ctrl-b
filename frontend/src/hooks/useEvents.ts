import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
    function invalidateLiveCaches() {
      void qc.invalidateQueries({ queryKey: ["hosts"] });
      void qc.invalidateQueries({ queryKey: ["services"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
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

      es.addEventListener("event", invalidateLiveCaches);
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
