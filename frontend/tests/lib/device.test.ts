import { afterEach, describe, expect, it, vi } from "vitest";

// lib/device — THIS browser profile's device id (S11 (c), owner ruling 2026-10-14: only the device that
// started a turn auto-speaks it). Minted once, persisted, READ BACK; `null` whenever storage cannot keep
// it (then no header is sent and every reply is the unknown arm). Resolved once per document, so every
// arm buys a fresh module — a new page load — over the storage it wants (`liveSocket`'s client-id tests).

type Mod = typeof import("../../src/lib/device");
const ID = /^[0-9a-f]{32}$/;

/** A Map-backed `Storage` — enough of the interface for the persist helpers. */
function memoryStorage(store: Map<string, string>): Storage {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

/** A fresh page load over `storage`. */
async function pageLoad(storage: unknown): Promise<Mod> {
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  return import("../../src/lib/device");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/device — the profile's device id", () => {
  it("a FRESH profile mints a 32-hex id, persists it, and answers the SAME one every call", async () => {
    const store = new Map<string, string>();
    const mod = await pageLoad(memoryStorage(store));
    const id = mod.deviceId();
    expect(id).toMatch(ID);
    expect(JSON.parse(store.get("ctrlb.device")!)).toBe(id);
    expect(mod.deviceId()).toBe(id);
  });

  it("…and the same id survives a RELOAD — persistent, unlike the live call's per-tab id", async () => {
    const store = new Map<string, string>();
    const before = (await pageLoad(memoryStorage(store))).deviceId();
    const after = (await pageLoad(memoryStorage(store))).deviceId();
    expect(before).toMatch(ID);
    expect(after).toBe(before);
  });

  it("a stored value of any other shape is RE-MINTED, never sent", async () => {
    const store = new Map([["ctrlb.device", JSON.stringify("not-an-id")]]);
    const id = (await pageLoad(memoryStorage(store))).deviceId();
    expect(id).toMatch(ID);
    expect(JSON.parse(store.get("ctrlb.device")!)).toBe(id);
  });

  it("storage that THROWS ⇒ null (no header — every reply reads as unknown)", async () => {
    const broken = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {},
    };
    expect((await pageLoad(broken)).deviceId()).toBeNull();
  });

  it("a write that does not HOLD (a full quota) ⇒ null: the read-back refuses an id no reload could keep", async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect((await pageLoad(full)).deviceId()).toBeNull();
  });

  it("isDeviceId accepts exactly the minted shape", async () => {
    const mod = await pageLoad(memoryStorage(new Map()));
    expect(mod.isDeviceId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(mod.isDeviceId("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(mod.isDeviceId("0123456789abcdef")).toBe(false);
    expect(mod.isDeviceId(null)).toBe(false);
    expect(mod.isDeviceId(undefined)).toBe(false);
  });
});
