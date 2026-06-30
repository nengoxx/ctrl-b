// Vitest stub for `virtual:pwa-register/react` (vite-plugin-pwa's virtual module). That module only
// exists in a Vite build, so the jsdom test env can't resolve it — and since M0 the registry → vapor
// `VaporRoot` → `SwUpdatePrompt` chain pulls it into any test that imports the theme registry. This
// stub mirrors the hook's return shape; the REAL service-worker behaviour is exercised by the e2e
// suite (which builds + serves the actual app). Aliased in vitest.config.ts (test-only — the
// production build never sees it).

export function useRegisterSW(_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, registration?: ServiceWorkerRegistration) => void;
  onRegisterError?: (error: unknown) => void;
}) {
  return {
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
