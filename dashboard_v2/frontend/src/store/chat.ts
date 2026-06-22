// Agent chat state (Phase 4a + 4b). Dependency-free external store, same shape as store/ui.ts.
// Chat is not TanStack Query — it's a streaming reducer (DESIGN §13): a single active thread,
// messages appended/patched by id as SSE events arrive. The shared composer and the Agent tab both
// read it. 4b adds the tool-call loop: assistant turns can span multiple messages (a tool step then
// a summary step), tool calls render as command bubbles, and a confirm-gated call suspends the turn
// until `resumeCall(execute|dismiss)` reopens the stream (DESIGN §5.3, §12).

import { useSyncExternalStore } from "react";

import { clearAudioCache } from "../lib/audioController";
import type { Privilege } from "../lib/privilege";
import type { ChatMessage, Part, PlanStep, RunState, Thread, ToolResult } from "../types";
import { setConnection } from "./connection";

export type ChatStatus = "idle" | "streaming" | "error";

interface ChatState {
  threadId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  streamingId: string | null; // the message currently receiving deltas (drives caret/dots)
  // `/privilege <level>` session override (A1/D16), null → follow the agent's own privilege. Reactive
  // (unlike sessionMode/sessionAgent) so the chip reflects it; session-scoped, so `/clear` keeps it.
  sessionPrivilege: Privilege | null;
}

let state: ChatState = {
  threadId: null,
  messages: [],
  status: "idle",
  streamingId: null,
  sessionPrivilege: null,
};
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

// Sticky agent for this session, set by `/agent <name>` (7d). `null` → the thread's / configured
// default AgentDef. Per-message only (not persisted on the thread) — like sessionMode, a resume
// finishes on the default agent.
let sessionAgent: string | null = null;
export function setSessionAgent(name: string | null): void {
  sessionAgent = name;
}

// Sticky session privilege override, set by `/privilege <level>` (A1/D16). Reactive (lives in
// ChatState) so the PrivilegeChip can render it; `null` → the resolved agent's own privilege.
export function setSessionPrivilege(p: Privilege | null): void {
  set({ sessionPrivilege: p });
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

/** Read the current chat status imperatively (non-reactive) — for callers outside render, e.g. the
 *  mic auto-send guarding against firing into an in-flight turn (which would be silently dropped). */
export function getChatStatus(): ChatStatus {
  return state.status;
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
    // Backend was down at load time. Reset `loaded` so the next initChat (or the F16
    // reconnect-triggered reloadChat) can retry — otherwise the chat would be stuck empty
    // until a full page refresh.
    loaded = false;
  }
}

/** Reconcile the chat after the SSE feed reconnects (hooks/useEvents.ts, F16). Re-fetches the
 *  current thread's messages so anything that arrived during the drop reappears; falls back to
 *  `initChat()` when there's no thread yet (cold start during a disconnect). Skips entirely while
 *  a turn is streaming so we don't yank messages out from under an in-flight reply. */
export async function reloadChat(): Promise<void> {
  if (state.status === "streaming") return;
  try {
    if (state.threadId) {
      const msgs = (await (await fetch(`/api/threads/${state.threadId}/messages`)).json()) as ChatMessage[];
      set({ messages: msgs });
    } else {
      loaded = false;
      await initChat();
    }
  } catch {
    /* still unreachable — next reconnect signal will try again */
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
  clearAudioCache(); // 6b-2: revoke this thread's TTS blobs + stop any playback
  set({ threadId: null, messages: [], status: "idle", streamingId: null });
}

function emptyAssistant(id: string, agent: string | null = null): ChatMessage {
  return {
    id,
    thread_id: state.threadId ?? "",
    role: "assistant",
    parts: [{ type: "text", text: "" }],
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    agent,
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
        // Per-turn agent attribution (7e-c): the server stamps which AgentDef is producing this
        // turn so a live specialist turn is labelled immediately, not only after a reload.
        const agent = (data.agent as string | null) ?? null;
        if (!claimed && placeholderId) {
          set({
            messages: state.messages.map((m) => (m.id === placeholderId ? { ...m, id, agent } : m)),
            streamingId: id,
          });
          claimed = true;
        } else {
          set({ messages: [...state.messages, emptyAssistant(id, agent)], streamingId: id });
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
      case "tool.question":
        // A2 — the `question` builtin is asking the owner. The prompt is already on the tool_call's
        // args (from part.added); just flip the state so the answer bubble renders its input.
        setCallState(data.callId as string, "awaiting_answer");
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

    // D17 — buffered (non-streaming) turn: the server returned one JSON payload instead of an SSE
    // stream (agent.streaming=off, or a non-streaming client). The turn already persisted its
    // message, so re-read the thread to render the bot reply + any confirm/question bubble (both
    // render from the persisted call state) — seeding the confirm token from the payload so a
    // buffered confirm stays resumable (it's the one thing not persisted). No parallel render path.
    if (res.headers.get("content-type")?.includes("application/json")) {
      const payload = (await res.json()) as Record<string, any>;
      if (payload.threadId) set({ threadId: payload.threadId as string });
      const perm = payload.permission as { callId?: string; token?: string } | undefined;
      if (perm?.callId && perm.token) confirmTokens[perm.callId] = perm.token;
      // Clear the streaming placeholder so reloadChat (which skips while "streaming") runs.
      set({ status: "idle", streamingId: null });
      await reloadChat();
      if (payload.state === "capped") pushSystemNote("// reached the step limit — send a message to continue");
      if (payload.state === "error") set({ status: "error" });
      return;
    }

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
    // F20 — the loop exits when the underlying stream closes. If the server sent a `done`
    // (or `error`) event before closing, `settled` is true and there's nothing more to do.
    // Otherwise the connection was cut mid-flight (backend killed / network drop / proxy
    // timeout) — treat it as a failure so the F20 retry affordance lands instead of silently
    // marking the chat idle with no signal. Also signal the connection store so the F16
    // badge appears immediately, even before EventSource notices the TCP drop on its own.
    if (!settled) {
      setConnection("reconnecting");
      failStream("connection interrupted");
    }
  } catch (e) {
    // Cross-channel reconnect signal (F16): if this looks like a backend-unreachable error
    // (fetch network failure, or a 502/503/504 from Vite's proxy when the upstream is gone),
    // flip the connection state so the badge appears at the same time the chat error does.
    // The SSE event stream is authoritative — its own `open` will clear "reconnecting" the
    // moment it reconnects, so a transient false-positive here is self-healing. We don't
    // signal on 4xx (it's a real semantic error from the backend, not unreachability).
    if (isLikelyUnreachable(e)) setConnection("reconnecting");
    failStream((e as Error).message);
  }
}

function isLikelyUnreachable(e: unknown): boolean {
  // Native fetch network errors (DNS, connection refused, abort) surface as TypeError.
  if (e instanceof TypeError) return true;
  // Our own `throw new Error('<url> → <status>')` for !res.ok. Any 5xx is a
  // backend-side problem (in dev, Vite's proxy returns 500 when the upstream is down —
  // I empirically verified this — not 502 like a typical reverse proxy). Treating all
  // 5xx as "unreachable for badge purposes" is honest: even a legit 500 means the
  // backend is in trouble, and the SSE event stream's authoritative `open` event will
  // clear the badge the moment things recover. A 4xx is a real semantic error — leave
  // the badge alone.
  if (e instanceof Error && /→ 5\d\d$/.test(e.message)) return true;
  return false;
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
    {
      text: body,
      thread_id: state.threadId,
      mode,
      skills,
      agent: sessionAgent,
      privilege: state.sessionPrivilege,
      stream: true, // the PWA always prefers streaming; the server's agent.streaming=off can override (D17)
    },
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

/** `!<cmd>` — the guarded shell escape hatch (Phase 5). POST the command to `/api/exec`; the server
 *  runs it on the backend host and persists the command + result into the thread as a tool_call +
 *  tool result pair, so a re-read renders it as a command bubble (and the agent sees it next turn).
 *  Mirrors the D17 buffered path: set the thread id, then `reloadChat()` — no parallel render path. */
export async function runShell(command: string): Promise<void> {
  try {
    const res = await fetch("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, thread_id: state.threadId }),
    });
    if (res.status === 403) {
      pushSystemNote("// shell exec is disabled (Conf → Shell → user exec)");
      return;
    }
    if (!res.ok) throw new Error(`exec → ${res.status}`);
    const data = (await res.json()) as { threadId: string };
    if (data.threadId) set({ threadId: data.threadId });
    await reloadChat();
  } catch {
    pushSystemNote("// shell exec failed — backend unreachable?");
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

/**
 * F20 — retry the most recent failed turn (e.g. when the chat SSE dropped mid-stream because
 * of a network flake or backend restart). Re-runs the user's last message from scratch.
 *
 * Not a byte-level resume: the partial assistant work (intermediate tool results, half-written
 * replies) from the failed turn is discarded. The matching backend "resume" endpoint
 * (/api/agent/resume) is specifically for confirm-gated suspension; there's no
 * resume-from-drop endpoint. Phase B (server-side Last-Event-Id) would close that gap but is
 * not in this slice.
 *
 * Walks back to the user message that started the failed turn, truncates the message log to
 * before it, and calls sendMessage(text). Re-running a turn re-runs any side effects it
 * performs (e.g. an agent wake action); mostly benign in chat context, but worth noting.
 *
 * No-op while streaming (you'd be double-firing). The button is only rendered on the LAST
 * message when status === "error", so this should never see a non-error tail.
 */
export function retryLastTurn(): void {
  if (state.status === "streaming") return;
  const lastIdx = state.messages.length - 1;
  const last = state.messages[lastIdx];
  if (!last || last.role !== "assistant") return;
  const errPart = last.parts.find((p) => p.type === "error");
  if (!errPart || errPart.type !== "error" || !errPart.retryable) return;
  // Walk back to the user message that started this turn.
  let userIdx = lastIdx - 1;
  while (userIdx >= 0 && state.messages[userIdx].role !== "user") userIdx--;
  if (userIdx < 0) return;
  const userMsg = state.messages[userIdx];
  const textPart = userMsg.parts.find((p) => p.type === "text");
  if (!textPart || textPart.type !== "text") return;
  // Truncate to just before the user message; sendMessage will re-add it.
  set({
    messages: state.messages.slice(0, userIdx),
    status: "idle",
    streamingId: null,
  });
  void sendMessage(textPart.text);
}

// Proposals being applied/dismissed right now — guards a double-tap of Approve/Dismiss (the POST is
// not instant and the bubble stays mounted until the result patch lands).
const applyingProposals = new Set<string>();

/** Patch the tool_result (and, when applied, its tool_call state) for `callId` with the server's
 *  resolved result — clears `data.proposed`, so the bubble's Approve/Dismiss affordance disappears. */
function patchResult(callId: string, result: ToolResult, applied: boolean): void {
  set({
    messages: state.messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) => {
        if (p.type === "tool_result" && p.call_id === callId) return { ...p, result };
        if (applied && p.type === "tool_call" && p.call_id === callId)
          return { ...p, state: "ok" as RunState };
        return p;
      }),
    })),
  });
}

/**
 * Approve or dismiss a proposed write (7e-f-3) — the chat bubble's affordance for a `memory` /
 * `skill_manage` call that returned `data.proposed` (its auto-write switch is off). Approve performs
 * the write the agent proposed; dismiss drops it. Both resolve the proposal server-side (so a reload
 * doesn't resurrect the buttons) and patch the local result. A failed apply (over cap / stale memory)
 * leaves the proposal pending and drops a breadcrumb.
 */
export async function applyProposal(callId: string, decision: "apply" | "dismiss"): Promise<void> {
  if (!state.threadId || applyingProposals.has(callId)) return;
  applyingProposals.add(callId);
  try {
    const res = await fetch("/api/agent/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: state.threadId, call_id: callId, decision }),
    });
    if (!res.ok) throw new Error(`apply → ${res.status}`);
    const data = (await res.json()) as { result: ToolResult; applied: boolean };
    if (decision === "apply" && !data.applied) {
      // Gate denied / write failed (over cap, stale old_text) — proposal stays pending.
      pushSystemNote(`// not applied — ${data.result.error ?? data.result.summary}`);
      return;
    }
    patchResult(callId, data.result, data.applied);
  } catch {
    pushSystemNote(`// could not ${decision} the proposal — try again`);
  } finally {
    applyingProposals.delete(callId);
  }
}

/** Answer a suspended `question` (A2) and continue the turn — the owner's reply becomes the call's
 *  result the model reads next. Mirrors `resumeCall` (dismiss a question reuses that path). */
export async function answerQuestion(callId: string, answer: string): Promise<void> {
  if (state.status === "streaming" || !state.threadId || !answer.trim()) return;
  set({ status: "streaming" });
  await streamTurn("/api/agent/resume", {
    thread_id: state.threadId,
    call_id: callId,
    decision: "answer",
    answer,
    privilege: state.sessionPrivilege,
    stream: true,
  });
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
    // Carry the session privilege across the resume (A1/D16) so the continuation gates at the same
    // level the suspended turn used — a lowered session can't silently revert to the agent default.
    privilege: state.sessionPrivilege,
    stream: true,
  });
}
