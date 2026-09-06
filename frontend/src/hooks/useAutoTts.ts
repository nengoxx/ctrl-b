import { useEffect, useRef } from "react";

import { dismiss, endTurnSpeak, feedReadAlong, usePlayback } from "../lib/audioController";
import { useChat } from "../store/chat";
import type { ChatMessage } from "../types";
import { useUISlice } from "../store/ui";
import { useVoiceStatus } from "./useVoiceStatus";

// Phase 6b-2 — auto read-aloud. When a chat turn *finishes* (status streaming→idle) and the AppBar
// auto-TTS toggle is on (and TTS is configured), speak the just-completed assistant reply via the
// shared audio controller. Gated on the status transition rather than on `messages` changing, so
// loading history (or a plan edit) never replays an old reply — only a freshly-completed turn fires.
//
// C3 S2 — READ-ALONG. With the owner's toggle on, this is also the FEEDER: the effect already re-runs
// once per delta (`useChat()` returns a new state object per token), so it tests the UN-FED SUFFIX of
// the streaming reply for a boundary char — a strict superset of "this delta carried one", hence
// immune to React batching two deltas into one render — and hands the raw markdown to the controller,
// which owns the whole planning pipeline. This hook stays a THIN gate: the four gates, the boundary
// test, and the per-turn "the user stopped it" latch. Turn end goes through `endTurnSpeak` and never
// `toggle`, which for an already-docked message would PAUSE the reply instead of finishing it.

/** Sentence end or any line break — the boundaries `lib/ttsChunks` itself splits on. */
const BOUNDARY = /[.!?…\n]/;

/** The latest assistant turn's reply text — scanning back only to the user boundary, so we consider
 *  the *current* turn's final message, not an older reply. Returns null if that turn ended without
 *  text (a tool-only step), or — in buffered mode (D17) — while it's still the empty placeholder.
 *  This keeps auto-TTS from speaking a stale reply when the completion fires before the reload lands.
 *  Mid-stream it is the same answer one delta at a time, and its TEXT-part filter is what keeps
 *  reasoning and tool output out of the synth (the store keeps those as separate parts). */
function finalReply(
  messages: ChatMessage[],
): { id: string; text: string; agent: string | null } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return null; // reached the turn start with no assistant text
    if (m.role !== "assistant") continue;
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    // D70 §8.5 — the turn's agent rides along so the read is spoken in ITS voice; null on a default
    // turn, which is what makes the request omit the field and fall back to the global chain.
    return text ? { id: m.id, text, agent: m.agent ?? null } : null;
  }
  return null;
}

export function useAutoTts(): void {
  const { messages, status } = useChat();
  const ttsAuto = useUISlice((s) => s.ttsAuto);
  const voice = useVoiceStatus().data;
  const ttsOk = voice?.tts ?? false;
  const chunking = voice?.tts_chunking;
  // The docked message id. It is the one signal that says the user STOPPED this turn's read-along:
  // dismiss (✕) and muting auto-TTS both undock it, and tapping another bubble docks that one.
  const dockedId = usePlayback((p) => p.id);
  const prevStatus = useRef(status);
  const spokenId = useRef<string | null>(null);
  /** What this turn has fed: the message id, the exact markdown (the flush's fallback when the turn's
   *  last message never becomes text-bearing), and whether the player ever docked it — an undock
   *  after that is the "user stopped" gate D63 named but no controller flag expresses. */
  const fed = useRef<{ id: string; text: string; agent: string | null; docked: boolean } | null>(
    null,
  );
  const abandoned = useRef(false);
  const prevTtsOk = useRef(ttsOk);

  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (was !== "streaming" && status === "streaming") {
      fed.current = null; // a new turn starts with clean read-along bookkeeping
      abandoned.current = false;
    }
    if (fed.current) {
      if (dockedId === fed.current.id) fed.current.docked = true;
      else if (fed.current.docked) abandoned.current = true;
    }
    // TTS going away mid-turn (a Conf save disabling it, a provider edit) would otherwise strand an
    // OPEN session: the gate below skips the flush as well as the feed, so the queue would sit on the
    // read-along latch showing "playing" forever. Stop it the way every other stop does — muting
    // auto-TTS already dismisses (`toggleAutoTts`), which is why only the `ttsOk` edge is handled.
    const lostTts = prevTtsOk.current && !ttsOk;
    prevTtsOk.current = ttsOk;
    if (lostTts && fed.current && dockedId === fed.current.id) {
      abandoned.current = true;
      dismiss();
    }
    if (!ttsAuto || !ttsOk) return;

    // The terminal edge: idle OR error. An errored turn never passes through "idle" (`failStream` and
    // `done{state:"error"}` both settle on "error"), which would leave an open session hanging — and
    // its partial text stays in the bubble, so it is spoken exactly like a Stop (owner ruling 1).
    // ONE flush per turn: `spokenId` collapses the `error` frame and the `done(error)` behind it.
    if (was === "streaming" && (status === "idle" || status === "error")) {
      if (abandoned.current) return; // the user stopped this reply's audio — don't start it again
      const reply = finalReply(messages);
      // A final assistant message that never became text-bearing (a tool-only step, or one that
      // errored before its first delta) would otherwise strand the preamble already being read.
      const target = reply ?? fed.current;
      if (!target || target.id === spokenId.current) return;
      spokenId.current = target.id;
      void endTurnSpeak(target.id, target.text, target.agent);
      return;
    }
    if (status !== "streaming") return;

    // ── the feed (read-along) ──
    if (!chunking?.read_along || chunking.mode === "off" || abandoned.current) return;
    const live = finalReply(messages);
    if (!live) return;
    const already = fed.current?.id === live.id ? fed.current.text.length : 0;
    if (!BOUNDARY.test(live.text.slice(already))) return;
    fed.current = {
      id: live.id,
      text: live.text,
      agent: live.agent,
      docked: fed.current?.id === live.id && fed.current.docked,
    };
    feedReadAlong(live.id, live.text, live.agent);
  }, [status, messages, ttsAuto, ttsOk, chunking, dockedId]);
}
