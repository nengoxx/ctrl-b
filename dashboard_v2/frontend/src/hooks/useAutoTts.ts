import { useEffect, useRef } from "react";

import { toggle as playMessage } from "../lib/audioController";
import { useChat } from "../store/chat";
import type { ChatMessage } from "../types";
import { useUISlice } from "../store/ui";
import { useVoiceStatus } from "./useVoiceStatus";

// Phase 6b-2 — auto read-aloud. When a chat turn *finishes* (status streaming→idle) and the AppBar
// auto-TTS toggle is on (and TTS is configured), speak the just-completed assistant reply via the
// shared audio controller. Gated on the status transition rather than on `messages` changing, so
// loading history (or a plan edit) never replays an old reply — only a freshly-completed turn fires.

/** The latest assistant turn's reply text — scanning back only to the user boundary, so we consider
 *  the *current* turn's final message, not an older reply. Returns null if that turn ended without
 *  text (a tool-only step), or — in buffered mode (D17) — while it's still the empty placeholder.
 *  This keeps auto-TTS from speaking a stale reply when the completion fires before the reload lands. */
function finalReply(messages: ChatMessage[]): { id: string; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return null; // reached the turn start with no assistant text
    if (m.role !== "assistant") continue;
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    return text ? { id: m.id, text } : null;
  }
  return null;
}

export function useAutoTts(): void {
  const { messages, status } = useChat();
  const ttsAuto = useUISlice((s) => s.ttsAuto);
  const ttsOk = useVoiceStatus().data?.tts ?? false;
  const prevStatus = useRef(status);
  const spokenId = useRef<string | null>(null);

  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    // Only act on the moment a turn completes. History hydration / plan edits keep status === "idle",
    // so they never satisfy this (was must have been "streaming").
    if (was !== "streaming" || status !== "idle") return;
    if (!ttsAuto || !ttsOk) return;
    const reply = finalReply(messages);
    if (!reply || reply.id === spokenId.current) return;
    spokenId.current = reply.id;
    void playMessage(reply.id, reply.text);
  }, [status, messages, ttsAuto, ttsOk]);
}
