import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SwitchTarget } from "../../src/theme-engine/switchTheme";

// switchTheme's ③ (rejection eviction on the `loaded` Map) + ⑤ (in-flight dedupe / supersede guard),
// §14.15.1. Both live on MODULE-LEVEL state (`loaded`, `latest`, `inFlight`), so each case resets the
// module graph (`vi.resetModules()` + a fresh dynamic import — the store/ui + switchTheme instances must
// come from the SAME reset cycle or `getUI()` reads a different store than switchTheme writes). The theme
// registry is mocked with controllable loaders (a deferred per invocation) so we drive resolve/reject and
// count imports; that also keeps cosmos's canvas imports out of jsdom. jsdom has no `startViewTransition`,
// so switchTheme takes the instant path — the apply is synchronous after the await, asserted via getUI().

type FakeDef = { loadStyles: () => Promise<void> };

const { mockRegistry } = vi.hoisted(() => {
  const mockRegistry: Record<string, FakeDef | undefined> = {};
  return { mockRegistry };
});

vi.mock("../../src/theme-engine/registry", () => ({
  registry: mockRegistry,
  registeredThemes: () => [],
}));

/** A controllable loader: each call returns a fresh deferred so a re-import (post-eviction) is drivable
 *  independently. `fn.mock.calls.length` = number of imports. */
function loader() {
  const calls: Array<{ resolve: () => void; reject: () => void }> = [];
  const fn = vi.fn<() => Promise<void>>(() => {
    let resolve!: () => void;
    let reject!: () => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = () => {
        res();
      };
      reject = () => {
        rej(new Error("load failed"));
      };
    });
    calls.push({ resolve, reject });
    return promise;
  });
  return { fn, calls };
}

function target(): SwitchTarget {
  return { mode: "dark", accent: "aqua" };
}

async function loadModules() {
  const sw = await import("../../src/theme-engine/switchTheme");
  const ui = await import("../../src/store/ui");
  return { ...sw, getUI: ui.getUI, setUI: ui.setUI };
}

beforeEach(() => {
  for (const k of Object.keys(mockRegistry)) delete mockRegistry[k];
  vi.resetModules(); // reset switchTheme's `loaded`/`latest`/`inFlight` + a fresh ui store
});

describe("ensureThemeLoaded — ③ rejection eviction", () => {
  it("evicts a rejected load so a retry re-invokes the loader (call count 2) and can succeed", async () => {
    const l = loader();
    mockRegistry.minimal = { loadStyles: l.fn };
    const { ensureThemeLoaded } = await loadModules();

    const p1 = ensureThemeLoaded("minimal");
    l.calls[0].reject();
    await expect(p1).rejects.toBeTruthy();
    expect(l.fn).toHaveBeenCalledTimes(1);

    const p2 = ensureThemeLoaded("minimal"); // evicted → re-imports (not the cached rejection)
    expect(l.fn).toHaveBeenCalledTimes(2);
    l.calls[1].resolve();
    await expect(p2).resolves.toBeUndefined();
  });
});

describe("switchTheme — ⑤ in-flight guard", () => {
  it("dedupes two same-target calls while the load is pending (one load, one apply)", async () => {
    const l = loader();
    mockRegistry.minimal = { loadStyles: l.fn };
    const { switchTheme, getUI, setUI } = await loadModules();
    setUI({ theme: "vapor" });

    const t = target();
    const a = switchTheme("minimal", t);
    const b = switchTheme("minimal", { ...t }); // structurally identical target → same dedupe key
    expect(b).toBe(a); // joined the in-flight switch (same promise)
    expect(l.fn).toHaveBeenCalledTimes(1);

    l.calls[0].resolve();
    await a;
    await b;
    expect(getUI().theme).toBe("minimal");
    expect(l.fn).toHaveBeenCalledTimes(1); // still exactly one load
  });

  it("a superseding call (different target) wins; the superseded target never applies", async () => {
    const lm = loader();
    const lc = loader();
    mockRegistry.minimal = { loadStyles: lm.fn };
    mockRegistry.cosmos = { loadStyles: lc.fn };
    const { switchTheme, getUI, setUI } = await loadModules();
    setUI({ theme: "vapor" });

    const a = switchTheme("minimal", target()); // X
    const b = switchTheme("cosmos", target()); // Y — different key → supersedes X via the token

    lm.calls[0].resolve(); // resolve X's load FIRST — it must still bail (superseded)
    await a;
    expect(getUI().theme).not.toBe("minimal");
    expect(getUI().theme).toBe("vapor");

    lc.calls[0].resolve();
    await b;
    expect(getUI().theme).toBe("cosmos"); // only the winner applied
  });

  it("a failed target is immediately retryable (inFlight cleared in finally + ③ cache evicted)", async () => {
    const l = loader();
    mockRegistry.minimal = { loadStyles: l.fn };
    const { switchTheme, getUI, setUI } = await loadModules();
    setUI({ theme: "vapor" });

    const a = switchTheme("minimal", target());
    l.calls[0].reject();
    await a; // resolves via the toast path — stayed on the working theme
    expect(getUI().theme).toBe("vapor");
    expect(l.fn).toHaveBeenCalledTimes(1);

    const b = switchTheme("minimal", target()); // retry: not deduped (finally cleared), cache evicted
    expect(l.fn).toHaveBeenCalledTimes(2); // loader re-invoked
    l.calls[1].resolve();
    await b;
    expect(getUI().theme).toBe("minimal");
  });
});
