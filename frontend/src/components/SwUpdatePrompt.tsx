import { useEffect } from "react";
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
  // EVERY tab follows an approved takeover (Codex SW-round MED). Activation is registration-wide,
  // but the register client only reloads the tab whose toast was tapped — a second same-origin tab
  // would keep the old shell, whose unvisited lazy chunks 404 once activation cleans the old
  // precache. `controllerchange` fires in every controlled tab when the new worker takes over
  // (and only then: no clientsClaim in the prompt build, so a first install never triggers it) —
  // the once-latch is because the initiating tab hears both this and the client's own reload.
  // This is autoUpdate-parity, not new protection: the auto client reloaded every tab too.
  useEffect(() => {
    let reloaded = false;
    const onTakeover = () => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker?.addEventListener("controllerchange", onTakeover);
    return () => navigator.serviceWorker?.removeEventListener("controllerchange", onTakeover);
  }, []);
  return null;
}
