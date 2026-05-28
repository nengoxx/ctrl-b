// Agent chat state (Phase 4a + 4b). Dependency-free external store, same shape as store/ui.ts.
// Chat is not TanStack Query — it's a streaming reducer (DESIGN §13): a single active thread,
// messages appended/patched by id as SSE events arrive. The shared composer and the Agent tab both
// read it. 4b adds the tool-call loop: assistant turns can span multiple messages (a tool step then
// a summary step), tool calls render as command bubbles, and a confirm-gated call suspends the turn
// until `resumeCall(execute|dismiss)` reopens the stream (DESIGN §5.3, §12).

import { useSyncExternalStore } from "react";

import type { ChatMessage, Part, PlanStep, RunState, Thread, ToolResult } from "../types";

export type ChatStatus = "idle" | "streaming" | "error";

interface ChatState {
  threadId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  streamingId: string | null; // the message currently receiving deltas (drives caret/dots)
}

let state: ChatState = { threadId: null, messages: [], status: "idle", streamingId: null };
let loaded = false;
const listeners = new Set<() => void>();
// Confirm tokens from `tool.permission`, keyed by callId — sent back on resume(execute).
const confirmTokens: Record<string, string> = {};

// Sticky inference backend for this session, set by a bare `/local`//`/cloud` (4c). `null` → the
// server's configured default. A `/cloud <msg>` form forces one message via sendMessage's `mode`
// arg without touching this. Module-level (not reactive) — no UI reflects it yet.
export type ChatMode = "local" | "cloud";
let sessionMode: ChatMode | null = null;
export function setSessionMode(mode: ChatMode | null): void {
  sessionMode = mode;
}

function set(next: Partial<ChatState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Load the most-recent thread + its history once (on first Agent-tab mount). */
export async function initChat(): Promise<void> {
  if (loaded) return;
  loaded = true;
  // Don't clobber a session already in flight (e.g. local-only /help notes or a send that beat the
  // first Agent-tab mount) — only hydrate history into an empty log.
  if (state.messages.length || state.threadId) return;
  try {
    const threads = (await (await fetch("/api/threads")).json()) as Thread[];
    if (!threads.length) return;
    const t = threads[0];
    const msgs = (await (await fetch(`/api/threads/${t.id}/messages`)).json()) as ChatMessage[];
    set({ threadId: t.id, messages: msgs });
  } catch {
    /* offline / empty — start fresh; the first send creates a thread */
  }
}

/** Append a client-only message (system note or shell echo) — not persisted; gone on reload. Used
 *  by the composer router for `/help`, mode-switch notes, and the Phase-5 shell stub (lib/composer). */
function pushLocal(role: "system" | "user", text: string): void {
  set({
    messages: [
      ...state.messages,
      {
        id: `${role[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        thread_id: state.threadId ?? "",
        role,
        parts: [{ type: "text", text }],
        actor: role === "user" ? "user" : "system",
        ts: new Date().toISOString(),
        tokens: null,
        compacted: false,
      },
    ],
  });
}
export function pushSystemNote(text: string): void {
  pushLocal("system", text);
}
export function pushUserEcho(text: string): void {
  pushLocal("user", text);
}

/** `/clear`: drop back to a fresh, thread-less view. History stays in SQLite; the next send mints a
 *  new thread (the server creates one when `thread_id` is null). */
export function startNewThread(): void {
  set({ threadId: null, messages: [], status: "idle", streamingId: null });
}

function emptyAssistant(id: string): ChatMessage {
  return {
    id,
    thread_id: state.threadId ?? "",
    role: "assistant",
    parts: [{ type: "text", text: "" }],
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
  };
}

/** Append a text/reasoning delta onto the named message's matching part (creating it if absent). */
function appendDelta(id: string, kind: "text" | "reasoning", delta: string) {
  set({
    messages: state.messages.map((m) => {
      if (m.id !== id) return m;
      const parts = m.parts.slice();
      const idx = parts.findIndex((p) => p.type === kind);
      if (idx >= 0) {
        const cur = parts[idx] as { type: string; text: string };
        parts[idx] = { ...cur, text: cur.text + delta } as Part;
      } else if (kind === "reasoning") {
        parts.unshift({ type: "reasoning", text: delta });
      } else {
        parts.push({ type: "text", text: delta });
      }
      return { ...m, parts };
    }),
  });
}

/** Append a streamed part (a tool_call) to the named message. */
function addPart(id: string, part: Part) {
  set({
    messages: state.messages.map((m) => (m.id === id ? { ...m, parts: [...m.parts, part] } : m)),
  });
}

/** Flip the lifecycle state of the tool_call with this callId (wherever it lives). */
function setCallState(callId: string, runState: RunState) {
  set({
    messages: state.messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) =>
        p.type === "tool_call" && p.call_id === callId ? { ...p, state: runState } : p,
      ),
    })),
  });
}

/** Resolve a call: flip its tool_call state and attach the result part beside it. */
function addToolResult(callId: string, result: ToolResult) {
  delete confirmTokens[callId];
  set({
    messages: state.messages.map((m) => {
      if (!m.parts.some((p) => p.type === "tool_call" && p.call_id === callId)) return m;
      const parts = m.parts.map((p) =>
        p.type === "tool_call" && p.call_id === callId ? { ...p, state: result.state } : p,
      );
      parts.push({ type: "tool_result", call_id: callId, result });
      return { ...m, parts };
    }),
  });
}

/** Put an error into the streaming message (or a fresh bubble if none is in flight). */
function failStream(message: string) {
  const id = state.streamingId;
  const errPart: Part = { type: "error", message, retryable: true };
  if (id && state.messages.some((m) => m.id === id)) {
    set({
      messages: state.messages.map((m) => (m.id === id ? { ...m, parts: [errPart] } : m)),
      status: "error",
      streamingId: null,
    });
  } else {
    const m = emptyAssistant(`err-${Date.now()}`);
    m.parts = [errPart];
    set({ messages: [...state.messages, m], status: "error", streamingId: null });
  }
}

/**
 * Open an SSE turn (chat or resume) and reduce its events into the store. `placeholderId`, when
 * given (chat send), is an empty assistant bubble already shown for instant feedback — the first
 * `message.start` adopts it; later steps push fresh assistant messages.
 */
async function streamTurn(
  url: string,
  body: Record<string, unknown>,
  placeholderId?: string,
): Promise<void> {
  let claimed = !placeholderId; // resume has no placeholder to claim
  let settled = false;

  const handle = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "thread":
        set({ threadId: data.threadId as string });
        break;
      case "message.start": {
        const id = data.messageId as string;
        if (!claimed && placeholderId) {
          set({
            messages: state.messages.map((m) => (m.id === placeholderId ? { ...m, id } : m)),
            streamingId: id,
          });
          claimed = true;
        } else {
          set({ messages: [...state.messages, emptyAssistant(id)], streamingId: id });
        }
        break;
      }
      case "reasoning.delta":
        appendDelta(data.messageId as string, "reasoning", (data.delta as string) ?? "");
        break;
      case "text.delta":
        appendDelta(data.messageId as string, "text", (data.delta as string) ?? "");
        break;
      case "part.added":
        addPart(data.messageId as string, data.part as Part);
        break;
      case "tool.permission":
        if (data.token) confirmTokens[data.callId as string] = data.token as string;
        setCallState(data.callId as string, "awaiting_confirm");
        break;
      case "tool.result":
        addToolResult(data.callId as string, data.result as ToolResult);
        break;
      case "compaction":
        // Older turns were folded into a summary to stay within the context window (4e). Full
        // history stays in SQLite; surface a sys breadcrumb so the trim is visible, not silent.
        pushSystemNote(compactionNote(data.removed as number, data.truncated as boolean));
        break;
      case "message.end":
        break;
      case "error":
        failStream((data.message as string) ?? "agent error");
        settled = true;
        break;
      case "done":
        settled = true;
        // suspended / capped / completed all return the user to an interactive state. `capped` means
        // the loop hit its step limit mid-task — say so, so a long fan-out never looks silently stuck.
        if (data.state === "capped") {
          pushSystemNote("// reached the step limit — send a message to continue");
        }
        set({ status: data.state === "error" ? "error" : "idle", streamingId: null });
        break;
    }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error(`${url} → ${res.status}`);

    // SSE parser over the fetch byte stream. sse-starlette frames end in a blank line with CRLF
    // line endings (`\r\n\r\n`); tolerate bare `\n` too (the bug that hid live replies in 4a).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const FRAME = /\r?\n\r?\n/;
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = FRAME.exec(buf))) {
        const frame = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        let ev = "message";
        const dataLines: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        try {
          handle(ev, JSON.parse(dataLines.join("\n")));
        } catch {
          /* keepalive/ping or non-JSON frame — ignore */
        }
      }
    }
    if (!settled) set({ status: "idle", streamingId: null });
  } catch (e) {
    failStream((e as Error).message);
  }
}

/**
 * Send a user message and stream the assistant turn. Appends the user bubble + an empty assistant
 * placeholder (instant "…" feedback through the slow cold-load), then reduces the SSE turn — which
 * may run tools, suspend on a confirm bubble, or just answer.
 */
export async function sendMessage(
  text: string,
  opts?: { mode?: ChatMode; skills?: string[] },
): Promise<void> {
  const body = text.trim();
  if (!body || state.status === "streaming") return;
  // Per-message `/cloud <msg>` wins; else the sticky session mode; else the server default (null).
  const mode = opts?.mode ?? sessionMode ?? null;
  const skills = opts?.skills ?? []; // explicit /skill-name invocations (4.5)

  const tempUser: ChatMessage = {
    id: `local-${Date.now()}`,
    thread_id: state.threadId ?? "",
    role: "user",
    parts: [{ type: "text", text: body }],
    actor: "user",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
  };
  const placeholderId = `assist-${Date.now()}`;
  set({
    messages: [...state.messages, tempUser, emptyAssistant(placeholderId)],
    status: "streaming",
    streamingId: placeholderId,
  });

  await streamTurn(
    "/api/agent/chat",
    { text: body, thread_id: state.threadId, mode, skills },
    placeholderId,
  );
}

/** One-line sys breadcrumb for a compaction event (auto or manual). */
function compactionNote(removed: number, truncated: boolean): string {
  if (!removed) return "// nothing to compact yet";
  const tail = truncated ? " (summarizer unavailable — older messages dropped)" : "";
  return `// compacted ${removed} message${removed === 1 ? "" : "s"} into a summary${tail}`;
}

/** `/compact`: fold this thread's older turns into a summary now (manual compaction, 4e). Full
 *  history stays in SQLite; only the live working context shrinks. */
export async function compactThread(): Promise<void> {
  if (!state.threadId) {
    pushSystemNote("// nothing to compact yet");
    return;
  }
  try {
    const res = await fetch("/api/agent/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: state.threadId }),
    });
    if (!res.ok) throw new Error(`compact → ${res.status}`);
    const data = (await res.json()) as { removed: number; truncated?: boolean };
    // Compaction only shrinks the model's *working* context; the visible chat log keeps the full
    // history (the summary lives server-side for the next turn), so just drop a breadcrumb — same
    // as the auto path. No re-read: that would surface the raw summary mid-log beside the originals.
    pushSystemNote(compactionNote(data.removed, Boolean(data.truncated)));
  } catch {
    pushSystemNote("// compaction failed — try again");
  }
}

/** Apply a plan edit to the latest task_plan call+result in the local message list (immutably).
 *  Mirrors the backend's in-place update so the pinned panel re-derives instantly (optimistic). */
function applyPlanEdit(messages: ChatMessage[], steps: PlanStep[]): ChatMessage[] {
  let callId: string | null = null;
  for (const m of messages)
    for (const p of m.parts) if (p.type === "tool_call" && p.tool === "task_plan") callId = p.call_id;
  if (!callId) return messages;
  const done = steps.filter((s) => s.status === "done").length;
  const summary = steps.length ? `plan · ${done}/${steps.length} done` : "plan cleared";
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (p.type === "tool_call" && p.call_id === callId)
        return { ...p, args: { steps }, state: "ok" as RunState };
      if (p.type === "tool_result" && p.call_id === callId)
        return { ...p, result: { ...p.result, state: "ok" as RunState, summary, data: { plan: { steps } } } };
      return p;
    }),
  }));
}

/** Toggle/edit the working plan from the UI (clicking a step's dot). Optimistically updates the
 *  latest task_plan call+result locally, then persists; the agent sees it on its next turn. */
export async function editPlan(steps: PlanStep[]): Promise<void> {
  if (!state.threadId) return;
  const prev = state.messages;
  set({ messages: applyPlanEdit(state.messages, steps) });
  try {
    const res = await fetch("/api/agent/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: state.threadId, steps }),
    });
    if (!res.ok) throw new Error(`plan → ${res.status}`);
  } catch {
    set({ messages: prev }); // rollback the optimistic edit
    pushSystemNote("// could not update the plan");
  }
}

/** Resolve a suspended tool call (the command bubble's execute/dismiss) and continue the turn. */
export async function resumeCall(callId: string, decision: "execute" | "dismiss"): Promise<void> {
  if (state.status === "streaming" || !state.threadId) return;
  set({ status: "streaming" });
  await streamTurn("/api/agent/resume", {
    thread_id: state.threadId,
    call_id: callId,
    decision,
    confirm_token: confirmTokens[callId],
  });
}
