import { afterAll, afterEach, describe, expect, it } from "vitest";

// F1 — the fleet-side source. The live activity SSE carries the whole domain `Event`; this maps the
// FAILURE states onto an `action_failed` signal and leaves everything else alone. Pinned as a pure
// function (`notifyForEvent`) against captured bus traffic — no EventSource, no React.

import { notifyForEvent } from "../../src/hooks/useEvents";
import { onNotify, type NotifySignal } from "../../src/lib/notifyBus";

const captured: NotifySignal[] = [];
const unsub = onNotify((s) => captured.push(s));

afterEach(() => {
  captured.length = 0;
});
// The bus is a module singleton; release the file's subscription so it can't leak into a later file
// sharing the worker.
afterAll(unsub);

const wire = (over: Record<string, unknown>) =>
  JSON.stringify({
    id: "ev-1",
    ts: "2026-07-29T00:00:00Z",
    actor: "user",
    action: "wake_host",
    target: "corsair",
    status: "ok",
    summary: null,
    ...over,
  });

describe("notifyForEvent · which RunStates are a failure", () => {
  it.each([
    ["error", "Action failed"],
    ["denied", "Action denied"],
    ["timeout", "Action timed out"],
  ])("%s → an action_failed signal titled %s", (status, title) => {
    notifyForEvent(wire({ status, summary: "no MAC configured for corsair" }));
    expect(captured).toHaveLength(1);
    expect(captured[0].cls).toBe("action_failed");
    expect(captured[0].title).toBe(title);
    expect(captured[0].body).toBe("no MAC configured for corsair");
    // Keyed on the durable Event id, so a re-delivery can't double-notify; and no tab hijack.
    expect(captured[0].key).toBe("event:ev-1");
    expect(captured[0].focus).toBeUndefined();
  });

  it.each(["ok", "pending", "running", "awaiting_confirm", "skipped", "cancelled"])(
    "%s is not a failure and stays silent",
    (status) => {
      notifyForEvent(wire({ status }));
      expect(captured).toHaveLength(0);
    },
  );
});

describe("notifyForEvent · body + robustness", () => {
  it("falls back to action · target when the Event carries no summary", () => {
    notifyForEvent(wire({ status: "error", summary: null }));
    expect(captured[0].body).toBe("wake_host · corsair");
  });

  it("falls back to just the action when there's no target either", () => {
    notifyForEvent(wire({ status: "error", summary: null, target: null }));
    expect(captured[0].body).toBe("wake_host");
  });

  it("swallows an unparseable frame instead of throwing into the stream listener", () => {
    expect(() => notifyForEvent("not json")).not.toThrow();
    expect(() => notifyForEvent("null")).not.toThrow();
    expect(() => notifyForEvent("[1,2]")).not.toThrow();
    expect(captured).toHaveLength(0);
  });
});
