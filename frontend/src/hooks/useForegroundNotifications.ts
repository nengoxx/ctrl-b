import { useEffect, useRef } from "react";

import { onNotify, type NotifySignal } from "../lib/notifyBus";
import { setUI } from "../store/ui";
import { useNotificationPrefs, type NotificationPrefs } from "./useNotificationPrefs";

// F1 — the foreground notification engine. ONE hook, mounted once in <AppEngines/>, holding ALL the
// policy: it subscribes to `lib/notifyBus` and decides whether a signal becomes a browser
// notification. The producers (the SSE event listener, the chat turn reducer) only describe what
// happened — they never consult a preference, a permission or the page's visibility. That single
// chokepoint is deliberate: a second gate elsewhere is exactly how "I turned notifications off and it
// still buzzed" happens.
//
// Scope: FOREGROUND only (ROADMAP F1 channel 1) — the page must be alive (open, or backgrounded but
// not evicted) for its streams to be delivering signals in the first place. Closed-app delivery needs
// Web Push (service worker + VAPID) or an ntfy/bot relay; both are future channels and neither is
// wired here. The Conf copy says so plainly rather than implying a guarantee we don't make.
//
// Secure context: `window.Notification` is undefined on a plain-HTTP origin, exactly like the mic's
// `getUserMedia`. Reached over Tailscale Serve HTTPS everything works; reached over bare http the
// feature-detect below short-circuits and the Conf row renders disabled with the reason. Nothing here
// ever throws on an unsupported browser.

/** PWA icon shown on the notification (frontend/public). The 192px variant is the standard
 *  notification/launcher size — the same asset the manifest advertises. */
const ICON = "/icon-192.png";

/** How many recently-notified keys to remember for de-duplication. Sized for "a burst of turns and
 *  tool calls while the phone was in a pocket", not for history — the keys are only useful until the
 *  occurrence they name is long resolved, and an unbounded set would grow for the session's lifetime. */
const SEEN_MAX = 128;

/** True when this browser/origin exposes the Notifications API at all. Absent on a plain-HTTP origin
 *  (non-secure context) and on browsers without the API. Exported for the Conf row, so the capability
 *  test lives in ONE place rather than being re-sniffed at the UI. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** The browser's current grant state, or `"unsupported"` when there's no API to ask. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? window.Notification.permission : "unsupported";
}

/** Ask the browser for permission. MUST be called from a user gesture (Chrome/Firefox reject or
 *  auto-deny otherwise) — hence the Conf master switch calls it on the enable tap rather than the
 *  engine requesting it on mount. Resolves to the resulting state; never rejects. */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await window.Notification.requestPermission();
  } catch {
    // Safari <16 used the callback form and can throw on the promise form; treat any failure as
    // "still whatever it was" rather than letting it escape into the click handler.
    return window.Notification.permission;
  }
}

/** The gate, as a pure predicate over its inputs — extracted so the whole matrix is testable without
 *  a DOM, and so the ordering is readable in one glance. Cheapest/most-decisive checks first:
 *  capability → master switch → this signal's class → the page is not in front of the user →
 *  permission. */
export function shouldNotify(
  signal: NotifySignal,
  prefs: NotificationPrefs | undefined,
  env: {
    supported: boolean;
    visibility: DocumentVisibilityState;
    permission: NotificationPermission | "unsupported";
  },
): boolean {
  if (!env.supported) return false;
  if (!prefs?.enabled) return false;
  if (!prefs.events?.[signal.cls]) return false;
  // Visible ⇒ the user is looking at the app, and the toast/bubble UI already told them. A duplicate
  // OS notification on top of that is noise, and on desktop it steals focus attention for nothing.
  if (env.visibility !== "hidden") return false;
  return env.permission === "granted";
}

export function useForegroundNotifications(): void {
  const { data: prefs } = useNotificationPrefs();
  // Read prefs through a ref inside the subscription so the listener identity stays stable across
  // pref updates: a re-subscribe is a teardown + setup window, and signals are events (a missed one
  // is gone), so the subscription is installed exactly once per mount.
  const prefsRef = useRef<NotificationPrefs | undefined>(prefs);
  // Synced in an effect, not written during render (the `react-hooks/refs` rule): a ref write during
  // render is invisible to React and misbehaves under StrictMode's double-invoke. One commit's lag is
  // immaterial — the prefs only change when the owner saves the Conf form.
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    // Bounded FIFO of keys already notified this session. Guards the ONE case the producers can't:
    // `reattachTurn` REPLAYS a live turn's frames (permission/question/done) after a reconnect or a
    // cold load, so without this a phone that drops wifi mid-turn re-buzzes for approvals it already
    // announced. Keyed on the durable callId / turn id, which is why the bus insists on those.
    const seen = new Set<string>();
    const order: string[] = [];

    const unsub = onNotify((signal) => {
      if (
        !shouldNotify(signal, prefsRef.current, {
          supported: notificationsSupported(),
          visibility: document.visibilityState,
          permission: notificationPermission(),
        })
      )
        return;
      if (seen.has(signal.key)) return;
      seen.add(signal.key);
      order.push(signal.key);
      if (order.length > SEEN_MAX) {
        const evicted = order.shift();
        if (evicted !== undefined) seen.delete(evicted);
      }

      show(signal);
    });
    return unsub;
  }, []);
}

/** Raise the actual browser notification. Two paths, deliberately in this order:
 *
 *  1. `new Notification(...)` — the plain constructor. Gives us an `onclick` we can wire to
 *     focus + route, which is most of the value of a notification that asks for something.
 *  2. `registration.showNotification(...)` — the service-worker path, used ONLY when (1) throws.
 *     It has to exist because **Android throws `TypeError` on the constructor** (Chrome and Firefox
 *     both; the platform requires notifications to be owned by a service worker there) — and Android
 *     is the primary client for this app, so a constructor-only implementation would be dead exactly
 *     where it matters. This uses the registration the PWA ALREADY has (vite-plugin-pwa, autoUpdate);
 *     it adds no service-worker source, no config, no dependency.
 *
 *  The trade-off on path (2) is the click: a SW-shown notification's activation is delivered to the
 *  worker's `notificationclick` handler, and the generated Workbox worker has none — so on Android the
 *  notification informs but doesn't navigate. Accepted for this slice (it beats nothing, and the app
 *  is one tab away); a real handler is part of the Web Push channel, where a custom worker is
 *  required anyway.
 *
 *  Both paths are fully guarded: a notification that cannot be shown must never break the stream that
 *  produced the signal. */
function show(signal: NotifySignal): void {
  const options: NotificationOptions = { body: signal.body, tag: signal.key, icon: ICON };
  try {
    // `tag` = the de-dupe key: a same-tag notification REPLACES its predecessor in the tray rather
    // than stacking, which is the right behavior if the OS somehow re-delivers.
    const n = new window.Notification(signal.title, options);
    n.onclick = () => {
      window.focus();
      // Agent-side signals land the user where the thing that needs them is. `setUI` is the same
      // store call `lib/composer` uses to route a message to the Agent tab — not a second router.
      if (signal.focus === "agent") setUI({ tab: "agent" });
      n.close();
    };
  } catch {
    void navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(signal.title, options))
      .catch(() => undefined);
  }
}
