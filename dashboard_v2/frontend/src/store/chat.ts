// Agent chat state (Phase 4a). Dependency-free external store, same shape as store/ui.ts. Chat is
// not TanStack Query — it's a streaming reducer (DESIGN §13): a single active thread, messages
// appended/patched by id as SSE events arrive. The shared composer and the Agent tab both read it.

import { useSyncExternalStore } from "react";

import type { ChatMessage, Part, Thread } from "../types";

export type ChatStatus = "idle" | "streaming" | "error";

interface ChatState {
  threadId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
}

let state: ChatState = { threadId: null, messages: [], status: "idle" };
let loaded = false;
const listeners = new Set<() => void>();

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

/** Replace the in-flight assistant message (matched by id) with patched parts. */
function patchMessage(id: string, parts: Part[]) {
  set({
    messages: state.messages.map((m) => (m.id === id ? { ...m, parts } : m)),
  });
}

/**
 * Send a user message and stream the assistant reply. Appends the user bubble optimistically,
 * then a placeholder assistant bubble that fills in as `text`/`reasoning` deltas arrive. Reasoning
 * and answer are distinct parts so the UI can dim the chain-of-thought.
 */
export async function sendMessage(text: string): Promise<void> {
  const body = text.trim();
  if (!body || state.status === "streaming") return;

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
  // Add the user bubble AND an empty assistant placeholder up front, so there's instant feedback
  // (the "…" working indicator) the moment you hit send — before the network even responds, and
  // through the model's slow cold-load / reasoning, until the first token lands.
  const assistantId = `assist-${Date.now()}`;
  const placeholder: ChatMessage = {
    id: assistantId,
    thread_id: state.threadId ?? "",
    role: "assistant",
    parts: [{ type: "text", text: "" }],
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
  };
  set({ messages: [...state.messages, tempUser, placeholder], status: "streaming" });

  let reasoning = "";
  let answer = "";
  let settled = false; // a terminal `done`/`error` event arrived (vs the stream just ending)

  const rebuild = (): Part[] => {
    const parts: Part[] = [];
    if (reasoning) parts.push({ type: "reasoning", text: reasoning });
    parts.push({ type: "text", text: answer });
    return parts;
  };

  const handle = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "thread":
        set({ threadId: data.threadId as string });
        break;
      case "reasoning.delta":
        reasoning += (data.delta as string) ?? "";
        patchMessage(assistantId, rebuild());
        break;
      case "text.delta":
        answer += (data.delta as string) ?? "";
        patchMessage(assistantId, rebuild());
        break;
      case "error":
        patchMessage(assistantId, [
          { type: "error", message: (data.message as string) ?? "agent error", retryable: true },
        ]);
        settled = true;
        set({ status: "error" });
        break;
      case "done":
        settled = true;
        set({ status: data.state === "error" ? "error" : "idle" });
        break;
    }
  };

  try {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ text: body, thread_id: state.threadId }),
    });
    if (!res.ok || !res.body) throw new Error(`chat → ${res.status}`);

    // SSE parser over the fetch byte stream. sse-starlette frames end in a blank line with CRLF
    // line endings (`\r\n\r\n`); tolerate bare `\n` too. Splitting on `\n\n` alone misses every
    // frame — the bug that made replies show only after a reload.
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
    if (!settled) set({ status: "idle" }); // stream ended without a terminal event
  } catch (e) {
    patchMessage(assistantId, [
      { type: "error", message: (e as Error).message, retryable: true },
    ]);
    set({ status: "error" });
  }
}
