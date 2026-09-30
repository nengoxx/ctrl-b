import { afterEach, describe, expect, it } from "vitest";

import { newWakeLockState, releaseWakeLock, takeWakeLock } from "../../src/lib/wakeLock";

// lib/wakeLock — the screen lock both mic holders take (Phase 26 SP · P3, lifted from `useLiveCall`).
// The hooks' own suites pin WHEN each takes and releases it (`useLiveCallWiring.test.ts` — unchanged by
// the lift — and `dictationStreaming.test.ts`, incl. the handover order); what is pinned here is the
// lifted body itself, with no hook: idempotence, the one-request latch, the caller's fence, the
// feature detection, and a release that swallows the platform's own.

interface FakeLock {
  released: boolean;
  release: () => Promise<void>;
}

/** Install a Screen Wake Lock API whose requests park until the case resolves (or rejects) them. */
function install(): {
  requests: number;
  resolve: (i: number) => FakeLock;
  reject: (i: number) => void;
} {
  const waiting: { res: (l: FakeLock) => void; rej: (e: unknown) => void }[] = [];
  const api = {
    requests: 0,
    resolve: (i: number): FakeLock => {
      const lock: FakeLock = {
        released: false,
        release: async () => {
          lock.released = true;
        },
      };
      waiting[i].res(lock);
      return lock;
    },
    reject: (i: number): void => waiting[i].rej(new Error("NotAllowedError")),
  };
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: () => {
        api.requests += 1;
        return new Promise<FakeLock>((res, rej) => waiting.push({ res, rej }));
      },
    },
  });
  return api;
}

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

describe("lib/wakeLock — the lifted screen lock", () => {
  it("takes ONE lock and keeps it while wanted; a held lock is not re-requested", async () => {
    const api = install();
    const s = newWakeLockState();
    takeWakeLock(s, () => true);
    takeWakeLock(s, () => true); // in flight: the one-request latch (A1)
    expect(api.requests).toBe(1);
    const lock = api.resolve(0);
    await settle();
    expect(s.lock).toBe(lock);
    expect(s.pending).toBe(false);
    takeWakeLock(s, () => true); // held: idempotent
    expect(api.requests).toBe(1);
  });

  it("re-takes once the platform released it (a hidden page) — the call's return-to-foreground", async () => {
    const api = install();
    const s = newWakeLockState();
    takeWakeLock(s, () => true);
    api.resolve(0).released = true;
    await settle();
    takeWakeLock(s, () => true);
    expect(api.requests).toBe(2);
  });

  it("the caller's FENCE: a lock resolving when it is no longer wanted is released, never stored", async () => {
    const api = install();
    const s = newWakeLockState();
    let wanted = true;
    takeWakeLock(s, () => wanted);
    wanted = false; // the owner ended while the request was in flight
    const lock = api.resolve(0);
    await settle();
    expect(lock.released).toBe(true);
    expect(s.lock).toBeNull();
    expect(s.pending).toBe(false); // …and the latch is free for the next owner
  });

  it("a refused request frees the latch — never a holder locked out for life", async () => {
    const api = install();
    const s = newWakeLockState();
    takeWakeLock(s, () => true);
    api.reject(0);
    await settle();
    expect(s.pending).toBe(false);
    takeWakeLock(s, () => true);
    expect(api.requests).toBe(2);
  });

  it("no API ⇒ nothing happens, and no latch is armed on a promise that will never settle", () => {
    const s = newWakeLockState();
    takeWakeLock(s, () => true);
    expect(s).toEqual({ lock: null, pending: false });
  });

  it("release empties the slot first and swallows the platform's rejection", async () => {
    const api = install();
    const s = newWakeLockState();
    takeWakeLock(s, () => true);
    const lock = api.resolve(0);
    await settle();
    lock.release = () => Promise.reject(new Error("already released"));
    releaseWakeLock(s); // must not throw, and must not leave an unhandled rejection
    expect(s.lock).toBeNull();
    releaseWakeLock(s); // idempotent on an empty slot
    await settle();
  });

  it("two holders are two sentinels: releasing one leaves the other held", async () => {
    const api = install();
    const call = newWakeLockState();
    const dictation = newWakeLockState();
    takeWakeLock(call, () => true);
    takeWakeLock(dictation, () => true);
    const c = api.resolve(0);
    const d = api.resolve(1);
    await settle();
    releaseWakeLock(dictation);
    expect([c.released, d.released]).toEqual([false, true]);
  });
});
