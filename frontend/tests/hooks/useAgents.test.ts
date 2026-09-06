import { describe, expect, it } from "vitest";

import { pickFields, type AgentDef } from "../../src/hooks/useAgents";

// useAgents — the managed-fields projection. `pickFields` is exactly what the AgentsEditor sends as the
// PUT payload (`agent: pickFields(draft)`) and what its dirty-check compares, so anything it DROPS is
// never written by the UI and survives the file-API deep-merge untouched. D43: the `routing` YAML block
// joins `compaction` in that dropped set (no routing UI in v1 — the Omit precedent).

/** A minimal AgentDef carrying both preserved-on-round-trip blocks (compaction + the D43 routing). */
function defWith(routing: unknown): AgentDef {
  return {
    name: "helper",
    title: "Helper",
    description: "",
    prompt: "persona",
    prompt_append: "",
    inherit_append: false,
    // the D70 roleplay half — declared on `AgentDef` since S4, and part of what `pickFields` must keep
    duties: "agent",
    greeting: "",
    alt_greetings: [],
    example_dialogue: "",
    scenario: "",
    post_history: "",
    user_name: "",
    avatar: "",
    background: "",
    voice: "",
    lorebooks: [],
    card: {},
    model: { provider: null, model: null },
    tools: "*",
    skills: "*",
    privilege: "confirm",
    compaction: { enabled: true, threshold_frac: 0.8 },
    routing,
    max_iterations: 20,
    max_repeat_calls: 3,
    max_calls_per_tool: 10,
    max_stall_iterations: 3,
    max_subagent_depth: 2,
    max_concurrent_subagents: 2,
  };
}

describe("pickFields — routing preserved on round-trip (D43)", () => {
  it("drops the routing block from the managed fields (never sent → YAML round-trips untouched)", () => {
    const routing = {
      lead: { mode: "cloud", model: "big" },
      failure_threshold: 2,
      fallback_turns: 2,
    };
    const fields = pickFields(defWith(routing)) as Record<string, unknown>;
    expect("routing" in fields).toBe(false); // excluded like compaction — the editor won't clobber it
    expect("compaction" in fields).toBe(false); // the precedent it mirrors
    expect("name" in fields).toBe(false);
    expect("prompt" in fields).toBe(false);
    // The genuinely-managed fields still project through.
    expect(fields.title).toBe("Helper");
    expect(fields.max_iterations).toBe(20);
  });

  it("a routing block never contributes to the dirty diff (excluded both sides)", () => {
    const a = pickFields(defWith({ lead: { mode: "cloud", model: "big" }, fallback_turns: 2 }));
    const b = pickFields(defWith({ lead: { mode: "local", model: "small" }, fallback_turns: 5 }));
    // Only routing differs between the two defs; since pickFields drops it, the projections match →
    // editing routing (via YAML) never registers as an unsaved UI change.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
