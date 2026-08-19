// F1 channel 1 — the WORKER half of the notification tap. Loaded into the generated Workbox worker
// via `workbox.importScripts` (see vite.config.ts, which also content-hashes the URL); plain JS at
// top level, because `importScripts()` is synchronous and the listener must be registered during the
// worker's very first script evaluation (the spec snapshots its "set of event types to handle" right
// after that evaluation returns — R45 §1.3).
//
// It exists because on Android BOTH engines throw on the `Notification` constructor, so
// `useForegroundNotifications` raises every notification through `registration.showNotification()` —
// and a SW-shown notification's activation is delivered ONLY here. The page's own `onclick` never
// fires on the phone, which is the primary client. Before this file the tap informed but never
// navigated ("tapping lands on the Android home screen").
//
// The page half is `src/hooks/useForegroundNotifications.ts`: it puts `{focus, key}` into
// `options.data` (which survives the tray) and owns the ONE router both paths call.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      // `includeUncontrolled` defaults to FALSE, and it is load-bearing here rather than cosmetic:
      // `registerType:"prompt"` ships no `clientsClaim()`, so the first page load after an install is
      // UNCONTROLLED — and that is exactly the page most likely to be showing notifications.
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer a real top-level window; an iframe client would receive the message but is not what the
      // owner is being summoned back to. `|| all[0]` keeps the odd engine that reports no frameType.
      const client = all.find((c) => c.frameType !== "nested") || all[0];
      if (client) {
        // ROUTE FIRST, focus second, and never let focus's failure skip the routing. On Firefox
        // Android `client.focus()` does not foreground an installed PWA (Bugzilla 1880000, still NEW)
        // and may reject outright; `postMessage` has no transient-activation requirement, so the tab
        // switch must not ride on focus succeeding. Then even on the broken engine the owner arrives
        // on the agent tab whenever they reach the app by any route.
        client.postMessage({ type: "ctrlb:notification-click", focus: data.focus });
        try {
          await client.focus();
        } catch {
          // no transient activation, or the engine bug above — the routing already landed
        }
        return;
      }
      // No live client: the page died. `tab` is PERSISTED in `ctrlb.ui`, so a bare "/" would restore
      // whatever tab was last used — the fallback would silently fail its one job. `?tab=agent` is the
      // instruction for this open; `store/ui.ts#consumeTabParam` reads and strips it at boot.
      await self.clients.openWindow(data.focus === "agent" ? "/?tab=agent" : "/");
    })(),
  );
});
