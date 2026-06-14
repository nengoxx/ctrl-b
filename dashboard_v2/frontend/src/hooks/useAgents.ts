import { useMutation, useQueryClient } from "@tanstack/react-query";

import { putJSON } from "../api/client";
import { pushToast } from "../store/toast";

// Phase 7d-b. Agent definitions (Settings.agents[]) + the agent-section scalars are edited through
// the existing PUT /api/settings: the whole `agents` list is replaced wholesale (deep_merge replaces
// lists), and the `agent` section is deep-merged. The full agent objects (from GET /api/settings)
// round-trip so fields the form doesn't expose (compaction, extra) survive untouched.

export type Privilege = "readonly" | "confirm" | "auto_low" | "full";

export interface ModelRef {
  mode: string | null; // ""/null/local/cloud — blank inherits inference.default_mode
  model: string | null; // blank inherits the endpoint's model
}

export interface AgentDef {
  name: string;
  prompt: string;
  prompt_append: string; // 7e-a — appended after the base; emitted as its own system message
  inherit_append: boolean; // 7e-a — when false, ignore the global inference.system_prompt_append
  model: ModelRef;
  tools: string[] | "*";
  skills: string[] | "*";
  privilege: Privilege;
  compaction: unknown | null; // not edited here — preserved on round-trip
  max_iterations: number;
  max_repeat_calls: number;
  max_calls_per_tool: number;
  max_stall_iterations: number;
  max_subagent_depth: number;
  max_concurrent_subagents: number;
  [k: string]: unknown; // preserve any extra fields verbatim
}

export interface AgentSectionCfg {
  default_agent: string;
  global_subagent_limit: number;
  subagent_clamp_privilege: boolean;
}

/** A blank agent with the AgentDef defaults (mirrors domain/agent.py). */
export function blankAgent(name = ""): AgentDef {
  return {
    name,
    prompt: "",
    prompt_append: "",
    inherit_append: true,
    model: { mode: "", model: "" },
    tools: "*",
    skills: "*",
    privilege: "confirm",
    compaction: null,
    max_iterations: 16,
    max_repeat_calls: 2,
    max_calls_per_tool: 6,
    max_stall_iterations: 2,
    max_subagent_depth: 2,
    max_concurrent_subagents: 3,
  };
}

/** Persist the agents list + agent-section scalars in one PUT. Invalidates settings (the source of
 *  the agents list), actions (a toolset/agent change), and the composer's /api/agents reference. */
export function useSaveAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { agents: AgentDef[]; agent: Partial<AgentSectionCfg> }) =>
      putJSON("/api/settings", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      pushToast("Agents saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}
