// Agent-chat controller (D29 §14.2) — headless: the agent thread's reactive state + derivations + the
// roster/voice context a chat presentation needs, with NO markup, so every theme's chat view reuses it.
// Two parts, mirroring useFleet's shape: a once-only INIT engine (`useChatInit`, mounted in <AppEngines/>)
// and a pure CONSUMER hook (`useAgentChat`) any AgentView reads.
//
// What it does NOT own:
// - The chat *loop* + *actions* live in `store/chat.ts` (the streaming reducer: send/resume/answer/
//   applyProposal/editPlan/retry/setSessionPrivilege). This controller COMPOSES that store; it does not
//   re-implement it. Bubble sub-components import those stable module-level actions directly (like
//   `fillComposer`/`playMessage` already are) — a deep bubble can't call this hook (it would re-run the
//   O(n) derivation per bubble), and prop-drilling the actions is worse than the direct singleton import.
// - `send` — that's the shared composer's job (useComposer → runComposer); not duplicated here.
// - The scroll stick-to-bottom + the bubble markup stay in the theme presentation (vapor: AgentTab).

import { useEffect, useMemo } from "react";

import { pairResults } from "../lib/plan";
import { initChat, useChat, type ChatStatus } from "../store/chat";
import type { ChatMessage, Plan, ToolResult } from "../types";
import { useAgentRoster } from "./useAgents";
import { useVoiceStatus } from "./useVoiceStatus";

// ── Init engine (call ONCE, above the theme Root — <AppEngines/>) ────────────────────────────────

/** Load the most-recent thread + its history once, on app mount. Hoisted out of the Agent tab (D29
 *  §14.5) so chat history hydrates regardless of which theme/section is showing — `initChat` is
 *  idempotent (guards on `loaded`), so an already-in-flight session is never clobbered. */
export function useChatInit(): void {
  useEffect(() => {
    void initChat();
  }, []);
}

// ── Consumer hook (any AgentView reads this) ─────────────────────────────────────────────────────

export interface AgentChat {
  messages: ChatMessage[];
  status: ChatStatus;
  streamingId: string | null;
  /** Tool results paired to their calls by id (live appends + reloaded `tool` messages). */
  resultByCall: Record<string, ToolResult>;
  /** The current task_plan (the most-recent one — the model rewrites the whole list each call). */
  currentPlan: Plan | null;
  /** The resolved default agent slug (7e-c) — a turn is attributed only when its `agent` differs. */
  resolvedDefault: string | undefined;
  /** Whether TTS is configured (6b-2) — gates the per-bubble read-aloud toggle. */
  ttsOn: boolean;
}

export function useAgentChat(): AgentChat {
  const { messages, status, streamingId } = useChat();
  const resolvedDefault = useAgentRoster().data?.default;
  const ttsOn = useVoiceStatus().data?.tts ?? false;
  // Linear scan over every message; memoize so a token delta doesn't re-pair on long threads.
  const { resultByCall, currentPlan } = useMemo(() => pairResults(messages), [messages]);
  return { messages, status, streamingId, resultByCall, currentPlan, resolvedDefault, ttsOn };
}
