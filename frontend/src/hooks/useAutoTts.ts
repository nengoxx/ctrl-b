import { useCallback, useEffect, useRef } from "react";

import {
  audioPending,
  audioPlaying,
  audioStopped,
  dismiss,
  endTurnSpeak,
  feedReadAlong,
  getTurnStops,
  holdWhileHidden,
  subscribePlayback,
  touchHoldProgress,
  useCallVoice,
  usePlayback,
  type Speaker,
} from "../lib/audioController";
import { useChat } from "../store/chat";
import type { ChatMessage } from "../types";
import { useUISlice } from "../store/ui";
import { useAgentArt } from "./useAgentArt";
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
//
// ISS-73 ① — THE REPLY HOLD. The same eligibility also decides whether a HIDDEN page is held awake for
// this turn (`audioController.holdWhileHidden("reply")`, the D73 keepalive on the mouth's own context):
// a pocketed phone otherwise froze before the reply could speak, and it only played on the return. Armed
// iff TTS is up ∧ the owner's auto-TTS is on ∧ the hold's switch (`tts_background.keepalive`) ∧ the turn
// was not stopped (`abandoned`, re-read every pass) ∧ its owned audio was not refused or paused while
// the turn still streamed (`mouthStopped`, code round row 2) ∧ the page is hidden ∧ the reply is still
// PENDING: the turn streaming, or the audio this turn handed the controller loading/playing
// (`audioPending`). Everything else releases it — the page visible, a stop, a textless end (nothing was
// handed over), a failure or the end of playback (the controller's terminal status: `paused`/`idle`,
// never a chunk's own `ended`), a view swap (its reset reads `idle`). A LIVE CALL is excluded by the
// controller itself (code round row 6 — one place for both reasons). The idle bound lives with the hold;
// this hook feeds it PROGRESS: each applied stream frame (`touchHoldProgress`).

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
  const { messages, status, foreignTurn } = useChat();
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
  const fed = useRef<{ id: string; text: string; speaker: Speaker; docked: boolean } | null>(null);
  // WHO each reply is read as: the agent picks the voice, and its duties decide whether `*…*` spans are
  // roleplay actions the ear may drop (session-51 polish #6). Resolved through the one agent resolver
  // (the roster the bubbles already read), never a second roster query.
  const agentArt = useAgentArt();
  const abandoned = useRef(false);
  /** The controller's turn-stop count as this turn began (LIVE-001): a call's stop (`dismissTurn`) bumps
   *  it, and a bump mid-turn is the SAME "the user stopped it" as an undock — but one that needs nothing
   *  docked and no message id, so a stop that lands while the turn is still thinking (before any chunk,
   *  before `message.start` renames the placeholder, between tool rounds) silences the whole turn. */
  const turnStops = useRef(getTurnStops());
  const prevTtsOk = useRef(ttsOk);
  // D71 §4.5 — a live CALL forces this feeder on for its own turns: read-along is how a call sounds like
  // a call, and the owner's Conf rows are left exactly as they are. Its own gate (`audioController`)
  // holds it shut until the turn that was streaming at call start has settled, so a reply the owner was
  // reading silently is never picked up half-way through.
  const callSpeaks = useCallVoice();
  // ISS-73 ① — the hold's two knobs, flattened to primitives so a refetch carrying equal values re-runs nothing.
  // Absent (an older backend) → no hold: nothing here invents the switch or the bound.
  const holdKeep = voice?.tts_background?.keepalive === true;
  const holdIdleS = voice?.tts_background?.idle_s ?? 0;
  /** The message id this TURN handed the controller (a read-along feed, or the turn-end flush) — the
   *  audio the hold waits for once the stream is over. Null at each turn's start: an older reply the
   *  owner replays is not this turn's business. */
  const owned = useRef<string | null>(null);
  /** The owned audio was REFUSED or PAUSED by the owner while the turn still streamed (code round row 2,
   *  Sol M1): the turn's hold is over — the stream alone must not keep a page awake for a reply that is
   *  not going to speak. Latched for the turn (reset with `owned`), read by `applyHold`. */
  const mouthStopped = useRef(false);
  /** The turn-level half of the hold's predicate, recomputed per pass; `applyHold` adds the two live
   *  halves (the page's visibility, the mouth's status) at the moment it runs. */
  const hold = useRef({ eligible: false, streaming: false, idleS: 0 });
  /** The `messages` the last pass saw — a NEW array while streaming is an applied frame (progress). */
  const lastFrame = useRef(messages);

  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (was !== "streaming" && status === "streaming") {
      fed.current = null; // a new turn starts with clean read-along bookkeeping
      owned.current = null; // …and owns no audio yet (ISS-73 ①)
      mouthStopped.current = false;
      // A turn the OTHER device started, attached here by the visible M11 re-attach, starts "already
      // stopped" (owner ruling 2026-10-10 — two devices side by side must not both speak): the latch
      // silences the feed AND the terminal flush. Every other turn starts loud (`foreignTurn` false).
      abandoned.current = foreignTurn;
      turnStops.current = getTurnStops();
    }
    if (getTurnStops() !== turnStops.current) abandoned.current = true;
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
    // The turn this render is about — hoisted because both the feed and the terminal edge need it.
    const reply = finalReply(messages);
    const live = reply && {
      id: reply.id,
      text: reply.text,
      speaker: { agent: reply.agent, actions: agentArt(reply.agent).actions },
    };
    // The override's first bypass: `ttsAuto` (the AppBar toggle). It only ever ADDS a voice — this
    // gate never silences anything. (What DOES silence a pre-call reply is the call DOOR's one-time
    // `dismiss()` at start, whose undock arms `abandoned` above and keeps that turn silent — the
    // feeder just observes it like any other dismissal.)
    if ((!ttsAuto && !callSpeaks) || !ttsOk) return;

    // The terminal edge: idle OR error. An errored turn never passes through "idle" (`failStream` and
    // `done{state:"error"}` both settle on "error"), which would leave an open session hanging — and
    // its partial text stays in the bubble, so it is spoken exactly like a Stop (owner ruling 1).
    // ONE flush per turn: `spokenId` collapses the `error` frame and the `done(error)` behind it.
    if (was === "streaming" && (status === "idle" || status === "error")) {
      if (abandoned.current) return; // the user stopped this reply's audio — don't start it again
      // A final assistant message that never became text-bearing (a tool-only step, or one that
      // errored before its first delta) would otherwise strand the preamble already being read.
      const target = live ?? fed.current;
      if (!target || target.id === spokenId.current) return;
      spokenId.current = target.id;
      owned.current = target.id; // ISS-73 ①: the hold now waits on this reply's audio
      void endTurnSpeak(target.id, target.text, target.speaker);
      return;
    }
    if (status !== "streaming") return;

    // ── the feed (read-along) ──
    // The override's second bypass: `read_along` itself. What it does NOT bypass is `mode === "off"` —
    // with chunking off there is nothing to split a growing reply into, so §4.5's stated fallback
    // applies: the call still works, the reply just speaks whole at turn end through the branch above.
    if (
      !chunking ||
      chunking.mode === "off" ||
      (!chunking.read_along && !callSpeaks) ||
      abandoned.current
    )
      return;
    if (!live) return;
    const already = fed.current?.id === live.id ? fed.current.text.length : 0;
    if (!BOUNDARY.test(live.text.slice(already))) return;
    fed.current = {
      id: live.id,
      text: live.text,
      speaker: live.speaker,
      docked: fed.current?.id === live.id && fed.current.docked,
    };
    owned.current = live.id; // ISS-73 ①: what the hold waits on once the stream ends
    feedReadAlong(live.id, live.text, live.speaker);
  }, [status, foreignTurn, messages, ttsAuto, ttsOk, chunking, dockedId, callSpeaks, agentArt]);

  // ── ISS-73 ① — the reply hold (see the header) ──
  /** Hold or release, from the turn-level half the effect below keeps current plus the two LIVE halves
   *  read now. Stable, so the page's `visibilitychange` and the playback store can call it directly —
   *  a hide, a return, the mouth finishing, none of which re-renders this hook (and must not: it runs
   *  in the app shell). Idempotent: the controller only acts on an edge. */
  const applyHold = useCallback(() => {
    const t = hold.current;
    const id = owned.current;
    // Row 2: a `paused` owned reply WHILE the queue is open is a refusal or the owner's pause, never a
    // seam or a gap (`audioStopped`'s contract) — latch it, so the stream frames that follow cannot
    // re-arm a hold for a reply that has stopped.
    if (t.streaming && id !== null && audioStopped(id)) mouthStopped.current = true;
    // …and UNLATCH when it plays again (code round row 16): only a PLATFORM pause (a transient focus loss
    // Chrome resumes) comes back to `playing` on its own — a refusal or an owner pause stays latched.
    else if (id !== null && audioPlaying(id)) mouthStopped.current = false;
    const pending = t.streaming || (id !== null && audioPending(id));
    const hidden = document.visibilityState === "hidden";
    holdWhileHidden("reply", t.eligible && !mouthStopped.current && pending && hidden, t.idleS);
  }, []);

  // Declared AFTER the feeder's effect on purpose: effects run in order, so this pass reads the
  // `abandoned`/`owned` the feeder has just written for the same render.
  useEffect(() => {
    const eligible = ttsOk && ttsAuto && holdKeep && !abandoned.current;
    // PROGRESS for the hold's idle bound: a new `messages` array while streaming is a stream frame the
    // store applied (the store makes one per frame — the same fact the feeder's per-delta re-run rides).
    // Only for a turn this hook would hold for (rulings row 13, the Qwen lane's Q6): the bound is
    // page-wide, and a FOREIGN or stopped turn's frames must not keep an upload's hold alive past it.
    if (
      status === "streaming" &&
      messages !== lastFrame.current &&
      eligible &&
      !mouthStopped.current
    )
      touchHoldProgress();
    lastFrame.current = messages;
    hold.current = { eligible, streaming: status === "streaming", idleS: holdIdleS };
    applyHold();
  }, [
    status,
    foreignTurn,
    messages,
    ttsAuto,
    ttsOk,
    chunking,
    dockedId,
    callSpeaks,
    agentArt,
    holdKeep,
    holdIdleS,
    applyHold,
  ]);

  // The two live halves' own edges, subscribed once: the page hiding/returning (the call's own pattern,
  // `useLiveCall`), and the mouth's status moving (`subscribePlayback` — synchronous, no render). The
  // unmount releases this hook's reason, whatever it held.
  useEffect(() => {
    document.addEventListener("visibilitychange", applyHold);
    const unsubscribe = subscribePlayback(applyHold);
    return () => {
      document.removeEventListener("visibilitychange", applyHold);
      unsubscribe();
      holdWhileHidden("reply", false);
    };
  }, [applyHold]);
}
