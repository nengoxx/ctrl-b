import { describe, expect, it } from "vitest";

import { pairResults, planFrom } from "../../src/lib/plan";
import type { ChatMessage, Part, ToolCallPart, ToolResult } from "../../src/types";

// lib/plan — the pure task_plan helpers the Agent-chat controller (useAgentChat) memoizes and the vapor
// PlanBubble shares. Behavior-locked here so the M2.3 extraction can't silently drift the pairing/plan rules.

function msg(id: string, role: ChatMessage["role"], parts: Part[]): ChatMessage {
  return { id, thread_id: "t", role, parts, actor: role, ts: "2026-01-01T00:00:00Z", tokens: null, compacted: false };
}
function call(callId: string, tool: string, args: Record<string, unknown> = {}): ToolCallPart {
  return { type: "tool_call", call_id: callId, tool, args, state: "pending" };
}
function result(state: ToolResult["state"], extra: Partial<ToolResult> = {}): ToolResult {
  return { state, summary: "", data: {}, output: null, error: null, artifacts: [], duration_ms: null, ...extra };
}

describe("planFrom", () => {
  it("prefers the executed result's data.plan", () => {
    const c = call("c1", "task_plan", { steps: [{ text: "from args", status: "pending" }] });
    const r = result("ok", { data: { plan: { steps: [{ text: "from result", status: "done" }] } } });
    expect(planFrom(c, r)?.steps[0].text).toBe("from result");
  });

  it("falls back to the call args when there's no result yet (renders before the call resolves)", () => {
    const c = call("c1", "task_plan", { steps: [{ text: "step", status: "pending" }] });
    expect(planFrom(c, undefined)?.steps).toEqual([{ text: "step", status: "pending" }]);
  });

  it("returns null when neither side carries steps", () => {
    expect(planFrom(call("c1", "task_plan", {}), undefined)).toBeNull();
  });
});

describe("pairResults", () => {
  it("pairs every tool result to its call by id across the thread", () => {
    const messages = [
      msg("a1", "assistant", [call("c1", "wake_host"), call("c2", "check_service")]),
      msg("t1", "tool", [{ type: "tool_result", call_id: "c1", result: result("ok", { summary: "woke" }) }]),
      msg("t2", "tool", [{ type: "tool_result", call_id: "c2", result: result("error", { summary: "down" }) }]),
    ];
    const { resultByCall } = pairResults(messages);
    expect(resultByCall.c1.summary).toBe("woke");
    expect(resultByCall.c2.state).toBe("error");
  });

  it("currentPlan tracks the MOST-RECENT task_plan call (the model rewrites the whole list each call)", () => {
    const messages = [
      msg("a1", "assistant", [call("p1", "task_plan", { steps: [{ text: "old", status: "done" }] })]),
      msg("a2", "assistant", [call("p2", "task_plan", { steps: [{ text: "new", status: "pending" }] })]),
    ];
    const { currentPlan } = pairResults(messages);
    expect(currentPlan?.steps).toEqual([{ text: "new", status: "pending" }]);
  });

  it("currentPlan prefers the latest plan call's RESULT data over its args", () => {
    const messages = [
      msg("a1", "assistant", [call("p1", "task_plan", { steps: [{ text: "args", status: "pending" }] })]),
      msg("t1", "tool", [
        { type: "tool_result", call_id: "p1", result: result("ok", { data: { plan: { steps: [{ text: "result", status: "done" }] } } }) },
      ]),
    ];
    const { currentPlan } = pairResults(messages);
    expect(currentPlan?.steps[0]).toEqual({ text: "result", status: "done" });
  });

  it("currentPlan is null when the thread has no task_plan call", () => {
    const { currentPlan, resultByCall } = pairResults([msg("a1", "assistant", [call("c1", "wake_host")])]);
    expect(currentPlan).toBeNull();
    expect(resultByCall).toEqual({});
  });
});
