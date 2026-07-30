import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F1 — the foreground-notification engine. Everything the feature promises is a GATE, so this pins
// the gate: the pure `shouldNotify` matrix, then the mounted hook end-to-end (a bus publish → a
// browser notification, or not) including the replay de-dupe that keeps a re-attached turn silent.

const h = vi.hoisted(() => ({ prefs: undefined as NotificationPrefsLike }));

/** Whatever the mocked `useNotificationPrefs` should hand back this test — including `undefined`
 *  (the not-yet-loaded state the gate must survive). */
type NotificationPrefsLike =
  | {
      enabled: boolean;
      events: { agent_input: boolean; turn_done: boolean; action_failed: boolean };
    }
  | undefined;

vi.mock("../../src/hooks/useNotificationPrefs", () => ({
  useNotificationPrefs: () => ({ data: h.prefs }),
}));

import {
  notificationPermission,
  notificationsSupported,
  shouldNotify,
  useForegroundNotifications,
} from "../../src/hooks/useForegroundNotifications";
import { publishNotify, type NotifySignal } from "../../src/lib/notifyBus";

const ALL_ON = {
  enabled: true,
  events: { agent_input: true, turn_done: true, action_failed: true, automation_done: true },
};

const signal = (over: Partial<NotifySignal> = {}): NotifySignal => ({
  cls: "agent_input",
  key: "perm:call-1",
  title: "Approval needed",
  body: "shutdown_host is waiting",
  focus: "agent",
  ...over,
});

// ── a controllable stand-in for the browser API (jsdom implements none of it) ───────────────────
interface FakeNotification {
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
  close: () => void;
}
let shown: FakeNotification[] = [];

function installNotificationApi(permission: NotificationPermission) {
  class Fake {
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      public title: string,
      public options: NotificationOptions = {},
    ) {
      shown.push(this);
    }
    static permission: NotificationPermission = permission;
    static requestPermission = vi.fn(() => Promise.resolve(permission));
  }
  Object.defineProperty(window, "Notification", {
    value: Fake,
    configurable: true,
    writable: true,
  });
}

function removeNotificationApi() {
  // `delete window.Notification` is the only way to make the `"Notification" in window` probe false —
  // which is exactly the plain-HTTP (non-secure-context) shape this must survive.
  delete (window as unknown as Record<string, unknown>).Notification;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => {
  shown = [];
  h.prefs = ALL_ON;
  installNotificationApi("granted");
  setVisibility("hidden");
});
afterEach(() => {
  // `globals: false` means Testing Library's auto-cleanup never registers — without this every
  // `renderHook` above stays mounted and its bus subscription keeps firing into the next test.
  cleanup();
  removeNotificationApi();
});

// ── the pure matrix ────────────────────────────────────────────────────────────────────────────

describe("shouldNotify · the gate matrix", () => {
  const env = {
    supported: true,
    visibility: "hidden" as DocumentVisibilityState,
    permission: "granted" as NotificationPermission | "unsupported",
  };

  it("passes when every gate is satisfied", () => {
    expect(shouldNotify(signal(), ALL_ON, env)).toBe(true);
  });

  it("blocks when the API is absent (plain-HTTP origin)", () => {
    expect(shouldNotify(signal(), ALL_ON, { ...env, supported: false })).toBe(false);
  });

  it("blocks when the master switch is off — whatever the per-class toggles say", () => {
    expect(shouldNotify(signal(), { ...ALL_ON, enabled: false }, env)).toBe(false);
  });

  it("blocks when prefs haven't loaded yet", () => {
    expect(shouldNotify(signal(), undefined, env)).toBe(false);
  });

  it("blocks only the class whose toggle is off", () => {
    const prefs = { enabled: true, events: { ...ALL_ON.events, agent_input: false } };
    expect(shouldNotify(signal({ cls: "agent_input" }), prefs, env)).toBe(false);
    expect(shouldNotify(signal({ cls: "turn_done" }), prefs, env)).toBe(true);
    expect(shouldNotify(signal({ cls: "action_failed" }), prefs, env)).toBe(true);
    expect(shouldNotify(signal({ cls: "automation_done" }), prefs, env)).toBe(true);
  });

  it("blocks while the page is visible (the toast UI already told the user)", () => {
    expect(shouldNotify(signal(), ALL_ON, { ...env, visibility: "visible" })).toBe(false);
  });

  it("blocks without a granted permission", () => {
    expect(shouldNotify(signal(), ALL_ON, { ...env, permission: "denied" })).toBe(false);
    expect(shouldNotify(signal(), ALL_ON, { ...env, permission: "default" })).toBe(false);
  });
});

// ── the capability probes ──────────────────────────────────────────────────────────────────────

describe("capability probes", () => {
  it("reports the live permission when the API exists", () => {
    expect(notificationsSupported()).toBe(true);
    expect(notificationPermission()).toBe("granted");
  });

  it("reports unsupported — and never throws — on an origin without the API", () => {
    removeNotificationApi();
    expect(notificationsSupported()).toBe(false);
    expect(notificationPermission()).toBe("unsupported");
  });
});

// ── the mounted engine ─────────────────────────────────────────────────────────────────────────

describe("useForegroundNotifications · end to end", () => {
  it("raises a notification for a passing signal, tagged with the de-dupe key", () => {
    renderHook(() => useForegroundNotifications());
    publishNotify(signal());
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Approval needed");
    expect(shown[0].options.tag).toBe("perm:call-1");
    expect(shown[0].options.body).toBe("shutdown_host is waiting");
    expect(shown[0].options.icon).toBe("/icon-192.png");
  });

  it("de-dupes a REPLAYED frame — a re-attached turn never re-notifies", () => {
    renderHook(() => useForegroundNotifications());
    publishNotify(signal()); // live
    publishNotify(signal({ body: "same call, replayed after reconnect" })); // reattachTurn replay
    expect(shown).toHaveLength(1);
  });

  it("still notifies for a DIFFERENT occurrence of the same class", () => {
    renderHook(() => useForegroundNotifications());
    publishNotify(signal({ key: "perm:call-1" }));
    publishNotify(signal({ key: "perm:call-2" }));
    expect(shown).toHaveLength(2);
  });

  it("stays silent when notifications are disabled", () => {
    h.prefs = { ...ALL_ON, enabled: false };
    renderHook(() => useForegroundNotifications());
    publishNotify(signal());
    expect(shown).toHaveLength(0);
  });

  it("stays silent — and does not throw — with no Notifications API at all", () => {
    removeNotificationApi();
    renderHook(() => useForegroundNotifications());
    expect(() => publishNotify(signal())).not.toThrow();
    expect(shown).toHaveLength(0);
  });

  it("unsubscribes on unmount (no notification from a torn-down engine)", () => {
    const { unmount } = renderHook(() => useForegroundNotifications());
    unmount();
    publishNotify(signal());
    expect(shown).toHaveLength(0);
  });

  it("clicking an agent-side notification focuses the window and routes to the Agent tab", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const { setUI, getUI } = await import("../../src/store/ui");
    setUI({ tab: "fleet" });
    renderHook(() => useForegroundNotifications());
    publishNotify(signal({ focus: "agent" }));
    shown[0].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(getUI().tab).toBe("agent");
  });

  it("the service-worker fallback keeps ONE permanent readiness observer — timeouts accumulate nothing", async () => {
    // Android throws `TypeError` on the constructor, so the SW path is the only one there. But
    // `serviceWorker.ready` is specified to never reject and to settle only once a worker CONTROLS the
    // page — on an origin where registration failed or is disabled it hangs forever.
    //
    // The shape this pins (verify-5, fix 4): ONE subscription to `ready`, ever. The previous shape
    // raced `ready` against a timeout and CLEARED the memo when the timeout won, so each later signal
    // re-subscribed — every timed-out race leaving its loser reaction attached to a promise that never
    // settles. N buzzes ⇒ N retained chains. `ready` settles at most once, so one permanent observer
    // is bounded by construction, and it caches the registration so a LATE worker is still found
    // without re-subscribing. The counters below are what discriminates the two shapes.
    vi.useFakeTimers();
    class Throwing {
      constructor() {
        throw new TypeError("Illegal constructor"); // the literal Android behavior
      }
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn();
    }
    Object.defineProperty(window, "Notification", { value: Throwing, configurable: true });

    let accesses = 0;
    let subscriptions = 0;
    const pending = new Promise<ServiceWorkerRegistration>(() => undefined); // never settles
    // A thenable that COUNTS subscriptions and hands back a real never-settling promise, so the count
    // reflects our code's `.then` on `ready` and nothing else.
    const neverReady = {
      then: () => {
        subscriptions++;
        return pending;
      },
    } as unknown as Promise<ServiceWorkerRegistration>;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      get() {
        accesses++;
        return { ready: neverReady };
      },
    });

    try {
      renderHook(() => useForegroundNotifications());
      publishNotify(signal({ key: "perm:t1:a" }));
      publishNotify(signal({ key: "perm:t1:b" }));
      publishNotify(signal({ key: "perm:t1:c" }));
      expect(accesses).toBe(1);
      expect(subscriptions).toBe(1); // three signals, ONE reaction on the dead promise

      // Past the transport timeout the shared wait resolves null and the chain completes: nothing is
      // shown, no timer is left holding the loop — and further signals reuse the same wait rather than
      // re-arming a fresh race (the old shape's `accesses`/`subscriptions` would tick to 2 here).
      await vi.advanceTimersByTimeAsync(10_000);
      expect(shown).toHaveLength(0);
      publishNotify(signal({ key: "perm:t1:d" }));
      publishNotify(signal({ key: "perm:t1:e" }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(accesses).toBe(1);
      expect(subscriptions).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(shown).toHaveLength(0);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
      vi.useRealTimers();
    }
  });

  it("a fleet-side notification click focuses but does NOT yank the user off their tab", async () => {
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const { setUI, getUI } = await import("../../src/store/ui");
    setUI({ tab: "fleet" });
    renderHook(() => useForegroundNotifications());
    publishNotify(signal({ cls: "action_failed", key: "event:e1", focus: undefined }));
    shown[0].onclick?.();
    expect(getUI().tab).toBe("fleet");
  });
});
