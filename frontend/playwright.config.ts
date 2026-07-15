import { defineConfig, devices } from "@playwright/test";

// e2e + a11y layer (DECISIONS D24) — drives the REAL built artifact (`npm run build && npm run
// preview`), with `/api` mocked at the browser level (deterministic, no backend/LLM orchestration;
// the real API contract is covered by the backend test suite). Deliberately SEPARATE from
// vitest.config.ts + the app build: specs live in `e2e/*.spec.ts` (not `tests/` or `src/`), all deps
// are devDependencies, so `npm run build` output is byte-identical with or without this file.
//
// Mobile-first viewport (390px) is the primary target — the app is designed phone-first and the owner
// uses Android; a desktop project guards the wider layout too.

const PORT = 4173; // vite preview default
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // axe scans are CPU-bound; one preview server + many concurrent scans thrashes. A modest cap keeps
  // renders from starving (8-wide flaked content waits even at a 15s timeout).
  workers: 3,
  timeout: 60_000,
  // axe scans are CPU-heavy and run concurrently; give content waits room under that contention so a
  // slow render isn't mistaken for a failure (the 5s default flaked the Tools content wait under load).
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE,
    serviceWorkers: "block", // the built app registers a PWA SW; block it so cached assets never flake tests
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 5"] } }, // ~393px — the real target
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Desktop Gecko — SCOPED to the kit-render smoke (testMatch) so total e2e runtime stays bounded: it
    // gives the per-theme boot + tab sweep a second engine (≈ partial §14.11 cross-engine automation).
    // The axe scans + the deep frontier interaction locks (frontier-render) stay Chromium-only; the real
    // Fennec/Chrome perf pass is the manual on-device Gate B (docs/FRONTIER_PLAN.md §9).
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /kit-render/ },
  ],
  // Build the real artifact and serve it exactly as prod does (static dist). `/api` is mocked in-test.
  webServer: {
    command: "npm run build && npm run preview",
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
