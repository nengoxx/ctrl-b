import { useRegisterSW } from "virtual:pwa-register/react";

import { pushToast } from "../store/toast";

// F26 — service-worker autoUpdate prompt. vite-plugin-pwa is configured with
// `registerType: "autoUpdate"` (vite.config.ts) so a new SW downloads in the background
// after a deploy but waits for the next reload to take over. Without a prompt, the user
// stays on the stale `index.html` indefinitely — and the moment they click the lazy Conf
// tab they hit a stale-chunk-hash 404 that surfaces inside the Slice-6 ErrorBoundary.
//
// This component listens for `onNeedRefresh` (fires when the new SW has finished installing
// and is waiting) and pushes a sticky info toast with a "refresh" action. Tapping refresh
// calls `updateServiceWorker(true)` — that tells the waiting SW to skip waiting, take over,
// and reload the page so the new build is live. Tapping the toast body elsewhere dismisses
// without updating (the user said "later") and the toast doesn't re-show until the next
// reload-triggered SW activation cycle.
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
