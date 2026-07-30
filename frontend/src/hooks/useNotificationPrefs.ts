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
}

export interface NotificationPrefs {
  /** Master switch. False (the default) ⇒ nothing fires, whatever `events` says. */
  enabled: boolean;
  events: NotificationEvents;
}

export function useNotificationPrefs() {
  return useQuery<NotificationPrefs>({
    queryKey: ["notification-prefs"],
    queryFn: () => getJSON<NotificationPrefs>("/api/notifications"),
    staleTime: 60_000,
  });
}
