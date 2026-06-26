import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config — deliberately SEPARATE from vite.config.ts so the production build is never touched:
// the `test` block (jsdom env, setup, includes) is read only by `vitest`, never by `vite build`. Test
// files live in `tests/` (outside `src`), so they're never imported by the app → never bundled, and
// the app tsconfig (`include: ["src"]`) never typechecks them. All test packages are devDependencies.
// Net effect: `npm run build` output is byte-identical with or without this file present.
export default defineConfig({
  plugins: [react()],
  // Test-only alias: stub vite-plugin-pwa's virtual module (unavailable in jsdom). Lives here, NOT in
  // vite.config.ts, so the production build is unaffected (the real module is exercised by e2e).
  resolve: {
    alias: {
      "virtual:pwa-register/react": fileURLToPath(
        new URL("./tests/stubs/pwa-register-react.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: false, // explicit imports from "vitest" — no global injection, no tsconfig globals types
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Reliability: reset spies/mocks between every test so state never leaks across cases.
    clearMocks: true,
    restoreMocks: true,
  },
});
