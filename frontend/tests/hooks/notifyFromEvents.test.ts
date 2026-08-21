import { afterAll, afterEach, describe, expect, it } from "vitest";

// F1 — the fleet-side source. The live activity SSE carries the whole domain `Event`; this maps the
// FAILURE states onto an `action_failed` signal and leaves everything else alone. Pinned as a pure
// function (`notifyForEvent`) against captured bus traffic — no EventSource, no React.

import { notifyForEvent, runTerminalOf } from "../../src/hooks/useEvents";
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

// ── A3 14d — the automation-run source. The runner records ONE `automation_run` Event per terminal;
// that frame is both the `automation_done` notification and (in the stream listener) the trigger to
// invalidate the automations caches, since a 202-detached run has no completion response of its own.
// The predicate has to be exact: a TOOL call made INSIDE a run carries the same `run_id`.

const runWire = (over: Record<string, unknown>) =>
  JSON.stringify({
    id: "ev-9",
    ts: "2026-07-30T03:00:05Z",
    actor: "automation",
    action: "automation_run",
    target: "auto-1",
    status: "ok",
    summary: "nightly: the run completed",
    origin: "automation",
    origin_id: "auto-1",
    run_id: "run-7",
    ...over,
  });

describe("runTerminalOf · which frames are a finished run", () => {
  it("reads the run + automation ids off a terminal frame", () => {
    expect(runTerminalOf(runWire({}))).toEqual({
      runId: "run-7",
      automationId: "auto-1",
      title: "Automation finished",
      body: "nightly: the run completed",
      eventId: "ev-9",
    });
  });

  it("ignores a tool call made INSIDE a run — same run_id, different action", () => {
    expect(runTerminalOf(runWire({ action: "ping_host", status: "ok" }))).toBeNull();
  });

  it("ignores a run-shaped frame with no run id (nothing to key on)", () => {
    expect(runTerminalOf(runWire({ run_id: null }))).toBeNull();
  });

  it("ignores a non-terminal state — invalidate, don't announce", () => {
    expect(runTerminalOf(runWire({ status: "running" }))).toBeNull();
    expect(runTerminalOf(runWire({ status: "pending" }))).toBeNull();
  });

  it("falls back to `target` for the automation id when origin_id is absent", () => {
    expect(runTerminalOf(runWire({ origin_id: null }))?.automationId).toBe("auto-1");
  });

  it("survives an unparseable frame", () => {
    expect(runTerminalOf("not json")).toBeNull();
  });
});

describe("notifyForEvent · a finished automation run", () => {
  it.each([
    ["ok", "Automation finished"],
    ["error", "Automation failed"],
    ["timeout", "Automation timed out"],
    ["cancelled", "Automation interrupted"],
  ])("%s → an automation_done signal titled %s", (status, title) => {
    notifyForEvent(runWire({ status, summary: "nightly: the turn failed" }));
    expect(captured).toHaveLength(1); // never ALSO under action_failed
    expect(captured[0].cls).toBe("automation_done");
    expect(captured[0].title).toBe(title);
    expect(captured[0].body).toBe("nightly: the turn failed"); // the name leads the body
    // Keyed on the RUN, so a re-delivered frame coalesces onto the same notification.
    expect(captured[0].key).toBe("run:run-7");
    expect(captured[0].focus).toBeUndefined();
  });

  it("says something honest when the frame carried no summary", () => {
    notifyForEvent(runWire({ summary: null }));
    expect(captured[0].body).toBe("the run finished");
  });

  it("leaves a failed TOOL call inside a run on the action_failed class", () => {
    notifyForEvent(runWire({ action: "run_shell", status: "error", summary: "exit 1" }));
    expect(captured).toHaveLength(1);
    expect(captured[0].cls).toBe("action_failed");
    expect(captured[0].title).toBe("Action failed");
  });

  it("stays silent for a run frame that is still running", () => {
    notifyForEvent(runWire({ status: "running" }));
    expect(captured).toHaveLength(0);
  });
});

// ── D50 M5 — the monitor's confirmed host transitions. The backend records both directions with
// `status = OK` (a host going down is an observation, not a failed action), so the arm has to match on
// the ACTION name; matching on status would be both wrong and unbuildable.

const hostWire = (over: Record<string, unknown>) =>
  JSON.stringify({
    id: "ev-4",
    ts: "2026-08-21T10:00:00Z",
    actor: "system",
    action: "host_down",
    target: "corsair",
    status: "ok",
    summary: "detected down after 3 consecutive misses",
    origin: "system",
    ...over,
  });

describe("notifyForEvent · a host went down or came back", () => {
  it.each([
    ["host_down", "Host down"],
    ["host_up", "Host back up"],
  ])("%s → a host_up_down signal titled %s", (action, title) => {
    notifyForEvent(hostWire({ action }));
    expect(captured).toHaveLength(1);
    expect(captured[0].cls).toBe("host_up_down");
    expect(captured[0].title).toBe(title);
    // The host id IS the human name here, so it leads the body ahead of the evidence count.
    expect(captured[0].body).toBe("corsair — detected down after 3 consecutive misses");
    // Keyed on the Event, NOT the host: a down and a later up are two occurrences, both worth saying.
    expect(captured[0].key).toBe("event:ev-4");
    // Owner ruling 2026-08-20 — the tap opens the Fleet tab, with no per-host focus.
    expect(captured[0].focus).toBe("fleet");
  });

  it("does not ALSO file under action_failed — the arm returns, and the status is ok anyway", () => {
    notifyForEvent(hostWire({}));
    expect(captured).toHaveLength(1);
    expect(captured[0].cls).toBe("host_up_down");
  });

  it("names the host even when the frame carried no summary", () => {
    notifyForEvent(hostWire({ summary: null }));
    expect(captured[0].body).toBe("corsair — state changed");
  });

  it("falls back to the title when the frame named no host either", () => {
    notifyForEvent(hostWire({ target: null, summary: null }));
    expect(captured[0].body).toBe("Host down");
    expect(captured[0].key).toBe("event:ev-4");
  });

  it("keys on action:target when the frame carried no id", () => {
    notifyForEvent(hostWire({ id: null }));
    expect(captured[0].key).toBe("event:host_down:corsair");
  });
});
