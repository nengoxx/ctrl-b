import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The MOUNTED live-feed listener (F1 + A3 14d) — the half `notifyFromEvents.test.ts` cannot reach: that
// file pins the pure frame→signal mapping, this one pins what the SSE listener DOES with a frame.
//
// Two properties, both load-bearing:
//   * A finished automation run invalidates the automations caches. Run-now is 202-DETACHED (§D-6), so a
//     client gets no completion response at all — without this the Conf list would sit on "running" until
//     the owner left and re-entered the tab.
//   * INVALIDATION HAPPENS BEFORE the notification, unconditionally. The notify path is strictly additive
//     and must never be able to cost a cache refresh — a throw from a subscriber must not eat one.
//
// A stub EventSource captures the listener the hook registers; frames are then delivered synchronously,
// so there are no timers and nothing to flake on.

import { useEventStream } from "../../src/hooks/useEvents";
import { onNotify, type NotifySignal } from "../../src/lib/notifyBus";

type Listener = (e: MessageEvent<string>) => void;

const listeners: Record<string, Listener[]> = {};

class EventSourceStub {
  static readonly CLOSED = 2;
  readyState = 1;
  constructor(public url: string) {}
  addEventListener(type: string, cb: Listener) {
    (listeners[type] ??= []).push(cb);
  }
  close() {}
}

function emit(payload: Record<string, unknown>) {
  const frame = { data: JSON.stringify(payload) } as MessageEvent<string>;
  for (const cb of listeners.event ?? []) cb(frame);
}

/** Mount the hook with a real QueryClient, capturing every invalidated key in order. */
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys: string[] = [];
  vi.spyOn(qc, "invalidateQueries").mockImplementation((filters) => {
    keys.push(JSON.stringify(filters?.queryKey ?? []));
    return Promise.resolve();
  });
  function Probe() {
    useEventStream();
    return null;
  }
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  render(createElement(wrapper, null, createElement(Probe)));
  return keys;
}

const captured: NotifySignal[] = [];
const unsub = onNotify((s) => captured.push(s));
afterAll(unsub);

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  (globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub;
});
afterEach(() => {
  cleanup();
  captured.length = 0;
  vi.restoreAllMocks();
});

const runFrame = (over: Record<string, unknown> = {}) => ({
  id: "ev-1",
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

describe("useEventStream · what a live frame invalidates", () => {
  it("refreshes the automations list AND that automation's history when a run finishes", () => {
    const keys = mount();
    emit(runFrame());
    expect(keys).toContain(JSON.stringify(["automations"]));
    expect(keys).toContain(JSON.stringify(["automation-runs", "auto-1"]));
  });

  it("leaves the automations caches alone for an ordinary fleet event", () => {
    const keys = mount();
    emit({ id: "ev-2", action: "wake_host", target: "corsair", status: "ok" });
    expect(keys).toEqual([
      JSON.stringify(["hosts"]),
      JSON.stringify(["services"]),
      JSON.stringify(["events"]),
    ]);
  });

  it("still refreshes the list when the frame names no automation (nothing to key the history on)", () => {
    const keys = mount();
    emit(runFrame({ origin_id: null, target: null }));
    expect(keys).toContain(JSON.stringify(["automations"]));
    expect(keys.some((k) => k.startsWith('["automation-runs"'))).toBe(false);
  });

  it("invalidates BEFORE it notifies — a notification must never cost a cache refresh", () => {
    const order: string[] = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(qc, "invalidateQueries").mockImplementation((filters) => {
      order.push(`invalidate:${JSON.stringify(filters?.queryKey ?? [])}`);
      return Promise.resolve();
    });
    const stop = onNotify((s) => order.push(`notify:${s.cls}`));
    function Probe() {
      useEventStream();
      return null;
    }
    render(
      createElement(
        ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: qc }, children),
        null,
        createElement(Probe),
      ),
    );
    emit(runFrame());
    stop();
    expect(order[order.length - 1]).toBe("notify:automation_done");
    expect(order.filter((s) => s.startsWith("invalidate:"))).toHaveLength(5); // 3 fleet + 2 automations
  });
});
