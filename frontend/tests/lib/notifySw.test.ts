import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `public/notify-sw.js` — the WORKER half of the notification tap (R45 §8.3). It is a plain script
// that registers one top-level listener on `self`, which makes it directly testable with no service
// worker runtime at all: stub `self`, import the file once, keep the captured handler, and drive it.
//
// E2E is not an option and this is the substitute: Playwright cannot click an OS notification
// (microsoft/playwright#23954 is the standing request), so the release checklist carries a manual
// device round instead and everything mechanical is pinned here.

interface FakeClient {
  frameType: string;
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

/** Swapped per test; the handler reads `self.clients` at call time, so one import serves every case. */
let clientsApi: {
  matchAll: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
};

const listeners = new Map<string, (e: unknown) => void>();

vi.stubGlobal("self", {
  addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
  get clients() {
    return clientsApi;
  },
});

// Imported ONCE, at module scope: the file caches like any other module, and the listener it registers
// closes over nothing, so re-importing (or `vi.resetModules()`) would buy nothing but a second handler.
await import("../../public/notify-sw.js");

afterAll(() => {
  vi.unstubAllGlobals();
});

const client = (over: Partial<FakeClient> = {}): FakeClient => ({
  frameType: "top-level",
  postMessage: vi.fn(),
  focus: vi.fn(() => Promise.resolve()),
  ...over,
});

/** Fire the captured handler with a synthetic NotificationEvent; resolves once the `waitUntil` work is
 *  done, which is where every assertion of consequence lives. */
async function tap(data: unknown): Promise<{ close: ReturnType<typeof vi.fn> }> {
  const handler = listeners.get("notificationclick");
  expect(handler, "the helper must register a top-level notificationclick listener").toBeDefined();
  const close = vi.fn();
  let waited: unknown = Promise.resolve();
  handler?.({
    notification: { close, data },
    waitUntil: (p: unknown) => {
      waited = p;
    },
  });
  await waited;
  return { close };
}

beforeEach(() => {
  clientsApi = { matchAll: vi.fn(() => Promise.resolve([])), openWindow: vi.fn() };
});

describe("notify-sw · a live window client", () => {
  it("closes the notification and posts the routing message", async () => {
    const c = client();
    clientsApi.matchAll = vi.fn(() => Promise.resolve([c]));
    const { close } = await tap({ focus: "agent", key: "perm:call-1" });
    expect(close).toHaveBeenCalled();
    expect(c.postMessage).toHaveBeenCalledWith({
      type: "ctrlb:notification-click",
      focus: "agent",
    });
    expect(c.focus).toHaveBeenCalled();
    expect(clientsApi.openWindow).not.toHaveBeenCalled();
  });

  it("still routes when focus() REJECTS — the Fennec case (Bugzilla 1880000)", async () => {
    // The single most valuable assertion in this file. On Firefox Android `focus()` does not
    // foreground an installed PWA and can reject outright; `postMessage` has no such dependency, so a
    // failed focus must neither skip the routing nor escape as an unhandled rejection.
    const c = client({ focus: vi.fn(() => Promise.reject(new Error("InvalidAccessError"))) });
    clientsApi.matchAll = vi.fn(() => Promise.resolve([c]));
    await expect(tap({ focus: "agent" })).resolves.toBeDefined();
    expect(c.postMessage).toHaveBeenCalledWith({
      type: "ctrlb:notification-click",
      focus: "agent",
    });
  });

  it("queries with includeUncontrolled — prompt mode ships no clientsClaim()", async () => {
    // Load-bearing, not cosmetic: the flag defaults to false, and without it `matchAll` returns an
    // empty list on the first (uncontrolled) load after an install — the load most likely to be
    // showing notifications. Pinned against a future "tidy-up".
    clientsApi.matchAll = vi.fn(() => Promise.resolve([client()]));
    await tap({ focus: "agent" });
    expect(clientsApi.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
  });

  it("prefers a top-level client over a nested (iframe) one", async () => {
    const nested = client({ frameType: "nested" });
    const top = client();
    clientsApi.matchAll = vi.fn(() => Promise.resolve([nested, top]));
    await tap({ focus: "agent" });
    expect(top.postMessage).toHaveBeenCalled();
    expect(nested.postMessage).not.toHaveBeenCalled();
  });
});

describe("notify-sw · no live client (the page died)", () => {
  it("opens the URL that carries the tab instruction for an agent-side signal", async () => {
    // A bare "/" would restore the PERSISTED last-used tab, so the fallback needs the param.
    await tap({ focus: "agent" });
    expect(clientsApi.openWindow).toHaveBeenCalledWith("/?tab=agent");
  });

  it("opens the fleet tab for a host up/down signal", async () => {
    await tap({ focus: "fleet" });
    expect(clientsApi.openWindow).toHaveBeenCalledWith("/?tab=fleet");
  });

  it("opens the plain app for a signal with no focus, or an unknown destination", async () => {
    await tap({ key: "event:e1" });
    expect(clientsApi.openWindow).toHaveBeenCalledWith("/");
    // Allowlisted, never interpolated blind: a real tab id that isn't a focus destination is not a URL
    // this builds — the value crossed the tray from another realm.
    await tap({ focus: "conf" });
    expect(clientsApi.openWindow).toHaveBeenLastCalledWith("/");
  });

  it("survives a notification with no data at all", async () => {
    await expect(tap(undefined)).resolves.toBeDefined();
    expect(clientsApi.openWindow).toHaveBeenCalledWith("/");
  });
});
