import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import { preloadableRoot } from "../../src/theme-engine/lazyRoot";

// preloadableRoot's rejection-eviction (§14.15.1-A ③+): a rejected chunk import resets the memoized
// `pending`, so a re-attempt re-imports (unlike React.lazy's permanent rejection cache). While pending,
// repeated `preload()` returns the SAME promise (Suspense identity contract). preloadableRoot has no
// module-level state (state is per instance), so no resetModules/registry mock is needed here.

const FakeRoot: ComponentType = () => createElement("div");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("preloadableRoot", () => {
  it("resets `pending` on rejection so a second preload re-imports (call count 2), then succeeds", async () => {
    const d1 = deferred<{ default: ComponentType }>();
    const d2 = deferred<{ default: ComponentType }>();
    const load = vi
      .fn<() => Promise<{ default: ComponentType }>>()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);

    const { preload } = preloadableRoot(load);

    const first = preload();
    d1.reject(new Error("chunk blip"));
    await expect(first).rejects.toThrow("chunk blip");
    expect(load).toHaveBeenCalledTimes(1);

    // Evicted → the next attempt re-invokes the loader instead of re-throwing the cached rejection.
    const second = preload();
    expect(load).toHaveBeenCalledTimes(2);
    d2.resolve({ default: FakeRoot });
    await expect(second).resolves.toBeUndefined();
  });

  it("returns the SAME promise identity while pending (import fires once)", () => {
    const d = deferred<{ default: ComponentType }>();
    const load = vi.fn<() => Promise<{ default: ComponentType }>>().mockReturnValue(d.promise);

    const { preload } = preloadableRoot(load);
    const a = preload();
    const b = preload();
    expect(a).toBe(b); // Suspense dedupes on thrown-promise identity
    expect(load).toHaveBeenCalledTimes(1);

    d.resolve({ default: FakeRoot }); // settle so nothing dangles
    return a;
  });
});
