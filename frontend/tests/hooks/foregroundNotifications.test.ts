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
  events: { agent_input: true, turn_done: true, action_failed: true },
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
