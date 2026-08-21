// The in-app notification bus (F1) — a dep-free, React-free emitter between the two live streams
// that KNOW something happened and the one engine that decides whether to raise a browser
// notification about it.
//
// Why a bus at all, rather than the producers calling the engine directly: the producers are the SSE
// event listener (`hooks/useEvents`) and the chat turn reducer (`store/chat`). The reducer in
// particular is a plain module that must stay free of React and of any hook's lifetime — it runs
// inside a fetch-driven stream, not a render. Publishing a value and letting a mounted engine
// subscribe keeps that boundary intact and keeps ALL the policy (prefs, visibility, permission,
// de-dupe) in exactly one place — which is the point: a second gate somewhere else is how a
// "notifications are off" bug is born.
//
// This is NOT `store/createStore`: there is no state to snapshot here, nothing renders from it, and a
// signal is an EVENT (each publish must be delivered once) rather than a value React can re-read.
// createStore's `getSnapshot` contract is the wrong shape for that, so this stays a plain listener
// set — the same primitive, minus the state it doesn't have.

/** Which per-event preference (`notifications.events.*`) governs a signal. Mirrors the backend
 *  `NotificationEventsCfg` field names one-for-one, so the gate is a direct key lookup. */
export type NotifyClass =
  "agent_input" | "turn_done" | "action_failed" | "automation_done" | "host_up_down";

export interface NotifySignal {
  /** The preference key that gates this signal. */
  cls: NotifyClass;
  /** Stable identity for the underlying occurrence — the engine's de-dupe key AND the browser
   *  notification `tag` (so a re-delivery coalesces onto the same notification instead of stacking).
   *  MUST be derived from durable ids (callId / turn id / Event id), never a timestamp: a re-attach
   *  replays frames the user was already notified about, and the key is what makes that silent. */
  key: string;
  title: string;
  body: string;
  /** Tapping the notification focuses the window; when set, it also switches to this tab. Set by the
   *  agent-side classes and by a host up/down (which lands on Fleet) — a fleet action FAILURE still
   *  leaves it unset, being legible from wherever the user was. */
  focus?: "agent" | "fleet";
}

type Listener = (signal: NotifySignal) => void;

const listeners = new Set<Listener>();

/** Subscribe to signals; returns the unsubscribe. */
export function onNotify(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Publish a signal to every subscriber. Cheap and safe to call with nothing mounted (the common
 *  case — notifications are off by default, so no engine subscribes): it iterates an empty set. */
export function publishNotify(signal: NotifySignal): void {
  for (const l of listeners) l(signal);
}
