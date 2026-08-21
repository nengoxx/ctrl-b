import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";

// F1 — the notification preference probe. `GET /api/notifications` returns the `notifications` config
// block (`{enabled, events}`) and nothing else; there are no secrets in it, so it needs no masking.
//
// Always-on (not Conf-scoped), on the `useVoiceStatus` pattern and for the same reason: the consumer
// is `useForegroundNotifications`, an app-global engine mounted in <AppEngines/>, so it must work on
// Fleet/Agent/Utils — while `useSettings` deliberately only fetches while the Conf tab is active.
// Cheap + cached; a Conf save invalidates `["notification-prefs"]` (see useSaveSettings) so toggling
// notifications takes effect without a reload.

export interface NotificationEvents {
  agent_input: boolean;
  turn_done: boolean;
  action_failed: boolean;
  /** A3 14d — a scheduled (or run-now) automation run reached a terminal, however it ended. */
  automation_done: boolean;
  /** F1/D50 M5 — the monitor confirmed a fleet host went down or came back. ONE class for both
   *  directions, matched on the Event's ACTION name (`host_up`/`host_down`), never on its status. */
  host_up_down: boolean;
}

/** The per-class defaults, mirroring `NotificationEventsCfg`'s all-True fields. Exported because BOTH
 *  read boundaries (this probe and the Conf draft) have to fill them in, and one literal in two places
 *  is how a new class silently arrives OFF on one of them. */
export const NOTIFICATION_EVENT_DEFAULTS: NotificationEvents = {
  agent_input: true,
  turn_done: true,
  action_failed: true,
  automation_done: true,
  host_up_down: true,
};

export interface NotificationPrefs {
  /** Master switch. False (the default) ⇒ nothing fires, whatever `events` says. */
  enabled: boolean;
  events: NotificationEvents;
}

/** Fill in every class the payload didn't name. Field-merge rather than a whole-object fallback: a
 *  response from a backend that predates a class simply omits its key, and the engine's gate
 *  (`!prefs.events?.[cls]`) reads a missing key as OFF — so the owner would see the row ON and get
 *  nothing. An explicit `false` from the server always survives; only holes are filled. */
export function withEventDefaults(prefs: NotificationPrefs): NotificationPrefs {
  return { ...prefs, events: { ...NOTIFICATION_EVENT_DEFAULTS, ...prefs.events } };
}

export function useNotificationPrefs() {
  return useQuery<NotificationPrefs>({
    queryKey: ["notification-prefs"],
    queryFn: async () => withEventDefaults(await getJSON<NotificationPrefs>("/api/notifications")),
    staleTime: 60_000,
  });
}
