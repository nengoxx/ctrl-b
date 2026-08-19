/// <reference types="node" />
// ^ reads a source file from disk; the tests tsconfig pins `types:["vitest"]`, so node's globals are
//   pulled in explicitly here (the svgFilterWaivers/themeContract precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// A text sweep over `vite.config.ts` — the cheapest way to pin a build-config shape nothing else can
// observe (the generated worker only exists after a real `vite build`). Same posture as the backend's
// `test_arch_invariants_qh9.py` config pins.

const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("the notify-sw import is wired, and cache-busted", () => {
  it("imports the helper into the generated Workbox worker", () => {
    expect(
      /importScripts:\s*\[[^\]]*notify-sw\.js/.test(config),
      "workbox.importScripts is how public/notify-sw.js reaches the generated worker (R45 §1.1) —\n" +
        "  without it the notification tap is dead on Android again.",
    ).toBe(true);
  });

  it("carries a content hash in the import URL", () => {
    // The import is fetched through the ORDINARY HTTP cache (`updateViaCache` defaults to "imports")
    // and dist files are served with no `Cache-Control`, so a heuristically-fresh cached copy can be
    // frozen into a brand-new worker for its whole life (R45 §2.2). The `?v=` is the fix; a tidy-up
    // that drops it reintroduces a bug that only ever shows up on a real device, weeks later.
    expect(/importScripts:\s*\[[^\]]*notify-sw\.js\?v=/.test(config)).toBe(true);
    expect(config).toContain("createHash");
  });
});
