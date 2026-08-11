import { useRegisterSW } from "virtual:pwa-register/react";

import { pushToast } from "../store/toast";

// F26 — the service-worker update prompt. vite-plugin-pwa runs `registerType: "prompt"`
// (vite.config.ts — the plugin default, and the ONLY mode that fires `onNeedRefresh`; under
// autoUpdate the register client skipWaits + force-reloads on its own and this component is
// dead code, which is exactly how it shipped until the 2026-08-11 flip).
//
// The flow: after a deploy, the next registration check finds the new worker, which installs
// and WAITS — the old build keeps serving, self-consistent, from its own precache (no
// stale-chunk 404s while it waits). `onNeedRefresh` fires on that waiting worker and pushes a
// sticky info toast; tapping "refresh" calls `updateServiceWorker(true)`, which messages the
// waiting worker to skipWaiting — its takeover fires the register client's `controlling`
// listener, which reloads the page onto the new build. Dismissing the toast means "later":
// the old build runs on, and the waiting worker also activates by itself once every client
// closes (a fully-closed PWA updates on its next cold open, toast or no toast).
//
// Renders nothing — it's a hook host.

export function SwUpdatePrompt() {
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      pushToast("// new version available", "info", {
        action: { label: "refresh", onClick: () => void updateServiceWorker(true) },
        sticky: true,
      });
    },
  });
  return null;
}
