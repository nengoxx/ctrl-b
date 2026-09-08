import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useActionSpecs } from "../hooks/useActions";
import { useAgentArt, type AgentArt } from "../hooks/useAgentArt";
import type { AgentChat } from "../hooks/useAgentChat";
import { AUTOMATIONS_GROUP_ID, fmtWhen } from "../hooks/useAutomations";
import { useOverlayBackGuard } from "../hooks/useOverlayBackGuard";
import { toggle as playMessage, usePlayback } from "../lib/audioController";
import { fillComposer } from "../lib/composer";
import { modalKeyDown } from "../lib/focusTrap";
import { Markdown } from "../lib/markdown";
import { planFrom } from "../lib/plan";
import {
  alwaysEligibleFor,
  answerQuestion,
  applyProposal,
  removeSteer,
  resumeCall,
  retryLastTurn,
} from "../store/chat";
import { openConfGroup } from "../store/groupScroll";
import { useUISlice } from "../store/ui";
import type {
  AttachmentPart,
  ChatMessage,
  Part,
  PendingAttachment,
  ToolCallPart,
  ToolResult,
  WebSearchHit,
} from "../types";
import { BotWhoLine } from "./chatAttribution";
import { XIcon } from "./icons";

// The agent-chat LOG (F4) — the reusable `.chat-log` transcript, split out of AgentTab so a bespoke theme
// body can render the same thread without duplicating the bubble tree (D36: the chat class names are a
// pinned contract). The CALLER owns the `useAgentChat()` call and passes the derivation in (a body needs it
// anyway for plan placement — one derivation per body, not two). Renders the `.chat-log` div (`id=chatlog`)
// + the empty state + `messages.map(Bubbles)` — Vapor bubbles (sys / user / bot), streaming token-by-token,
// with a thinking model's reasoning in a dimmed collapsible; command/action bubbles (.b.cmd) pair a tool
// call with its result by call_id, and a confirm-gated call shows allow/edit/deny (DESIGN §12,
// vapor.html:1934). The scroll-stick-to-bottom lives here (it targets `#app-scroll`, the shell content pane).

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function reasoningOf(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "reasoning")
    .map((p) => p.text)
    .join("");
}
function textOf(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}
function errorOf(parts: Part[]): { message: string; retryable: boolean } | null {
  const e = parts.find((p) => p.type === "error");
  return e && e.type === "error" ? { message: e.message, retryable: e.retryable } : null;
}

// ── attachments in the transcript (D68 §7 — the ONE renderer branch) ─────────────────────────────

function attachmentsOf(parts: Part[]): AttachmentPart[] {
  return parts.filter((p) => p.type === "attachment");
}

/** `2.4 MB` / `640 KB` — the units a phone shows a file in (the `imageProbe` house spelling). */
function sizeText(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

/** The serving URL (§8). Built from the MESSAGE's thread and the part's exact stored name — the two
 *  facts the route matches a persisted part on; nothing else about the path is the client's. */
function attachmentUrl(threadId: string, name: string): string {
  return `/api/attachments/${encodeURIComponent(threadId)}/${encodeURIComponent(name)}`;
}

/** What one message actually sent: images PAINTED in the bubble (owner ruling §0b-2 — "I want this
 *  feature to be complete"), text/PDF as a quiet tappable chip that downloads.
 *
 *  The images are CSS-bounded rather than laid out from `width`/`height`: the part carries the stored
 *  pixel size, but the bubble is a fluid 88%-max column and the phone is the target. Tap opens the
 *  full-size view. */
function AttachedFiles({ message }: { message: ChatMessage }) {
  const files = attachmentsOf(message.parts);
  const [viewing, setViewing] = useState<AttachmentPart | null>(null);
  // Before the durable parts exist there may still be the OPTIMISTIC snapshot (D68 MED-6) — the same
  // branch, one message-shape earlier. The durable parts always win: the instant they arrive the
  // snapshot is stale (and its object URLs are being revoked).
  if (files.length === 0) return <PendingFiles files={message.pending_attachments ?? []} />;
  return (
    <div className="chat-attach">
      {files.map((file) => {
        const url = attachmentUrl(message.thread_id, file.name);
        return file.kind === "image" ? (
          <button
            type="button"
            className="chat-attach-shot"
            key={file.name}
            onClick={() => setViewing(file)}
            aria-label={`view ${file.name}`}
          >
            {/* `loading="lazy"`: a long thread can hold dozens of photos, and the log is a scroller. */}
            <img src={url} alt={file.name} loading="lazy" decoding="async" />
          </button>
        ) : (
          <a className="chat-attach-file" key={file.name} href={url}>
            <span className="chat-attach-kind">{file.kind === "pdf" ? "PDF" : "TXT"}</span>
            <span className="chat-attach-label">{file.name}</span>
            <span className="chat-attach-size">{sizeText(file.bytes)}</span>
          </a>
        );
      })}
      {viewing !== null && (
        <FullImage
          src={attachmentUrl(message.thread_id, viewing.name)}
          name={viewing.name}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/** The OPTIMISTIC half of the same branch (D68 MED-6): what the composer's rail was holding when this
 *  bubble was sent, shown the instant the bubble appears and replaced by the durable parts above the
 *  moment `reloadChat` lands. The same visual language — the picture painted, text/PDF as a quiet
 *  kind·name chip — off the LIVE object URL the rail handed over (`store/chat` owns the revoke).
 *
 *  What it deliberately does NOT have: a size, a link, a tap-to-open. None of those facts exist yet —
 *  the file has no stored name and no URL until the server claims it — and inventing them would be
 *  the fabricated `AttachmentPart` this snapshot exists to avoid. */
function PendingFiles({ files }: { files: readonly PendingAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="chat-attach" data-pending="">
      {files.map((file, at) =>
        file.kind === "image" && file.previewUrl !== undefined ? (
          // Two picked files can share a name, so the key is the position in a list that is written
          // once and never reordered.
          <span className="chat-attach-shot" key={at}>
            <img src={file.previewUrl} alt={file.name} />
          </span>
        ) : (
          <span className="chat-attach-file" key={at}>
            <span className="chat-attach-kind">{file.kind === "pdf" ? "PDF" : "TXT"}</span>
            <span className="chat-attach-label">{file.name}</span>
          </span>
        ),
      )}
    </div>
  );
}

/** The full-size view — the house `.pm` overlay primitives (the same shell PromptModal and the media
 *  gallery use) plus `useOverlayBackGuard`, so the Android BACK gesture closes the picture instead of
 *  leaving the app. NO new overlay machinery: the guard owns the one close primitive, `modalKeyDown`
 *  owns Escape + the focus loop, and the shell is `.pm-backdrop`/`.pm` with a `chat-shot` skin. */
function FullImage({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useOverlayBackGuard(true, onClose);
  useEffect(() => {
    const panel = panelRef.current;
    queueMicrotask(() => panel?.querySelector<HTMLElement>("button")?.focus());
  }, []);
  return (
    <div
      className="pm-backdrop chat-shot-pm"
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, close)}
      // Tap-anywhere-to-close is what a phone expects of a photo view; the panel stops the bubble so
      // a tap ON the picture (to look closer) never dismisses it.
      onClick={() => close()}
    >
      <div
        className="pm chat-shot"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <h3>{name}</h3>
          <button className="pm-x" aria-label="Close" onClick={close}>
            <XIcon />
          </button>
        </div>
        <img src={src} alt={name} />
      </div>
    </div>
  );
}

/** Render a tool call as a command-like line for the `$` pre block (Vapor `.b.cmd`). */
function callLine(call: ToolCallPart): string {
  const args = Object.entries(call.args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return args ? `${call.tool} ${args}` : call.tool;
}

/** A task_plan call in the transcript — just a timeline breadcrumb. The live, always-visible view is
 *  the pinned panel at the top of the chat (the model rewrites the whole list each call). */
function PlanBubble({ call, result }: { call: ToolCallPart; result: ToolResult | undefined }) {
  const plan = planFrom(call, result);
  const total = plan?.steps.length ?? 0;
  const done = plan?.steps.filter((s) => s.status === "done").length ?? 0;
  return (
    <div className="b sys plan-note">
      <div className="body">
        // plan · {done}/{total}
      </div>
    </div>
  );
}

/** Pull web_search hits from the executed result's `data.results` (empty if none / not a search). */
function hitsFrom(result: ToolResult | undefined): WebSearchHit[] {
  const r = (result?.data as { results?: WebSearchHit[] } | undefined)?.results;
  return Array.isArray(r) ? r : [];
}

/** Whether this result is a *pending* proposed write (7e-f-3): a `memory`/`skill_manage` call whose
 *  auto-write switch is off, returned `data.proposed`, and hasn't been approved/dismissed yet. */
function isProposed(result: ToolResult | undefined): boolean {
  return !!(result?.data as { proposed?: unknown } | undefined)?.proposed;
}

/** The record a confirmed `create_automation` returned (A3 §D-5, backend `_card`), narrowed to what the
 *  card RENDERS — the payload also carries the raw cron, which the human echo (`schedule_text`) replaces
 *  here. Every field below is validated at runtime; a field the card doesn't read isn't declared, so the
 *  type can't claim more than the parser proves. Times are ISO strings. */
interface AutomationCardData {
  id: string;
  name: string;
  schedule_text: string;
  tz: string;
  next_fire: string | null;
  thread_mode: string;
  enabled: boolean;
  agent: string | null;
}

/** Pull the created-automation card off a result's `data`, or null. Keyed on the SHAPE (`data.automation`,
 *  the `data.plan`/`data.results` pattern) rather than on the tool name, so a second writer of the same
 *  payload — or a rename of the tool — needs no change here.
 *
 *  EVERY field is checked, not just the identity pair (post-14d review, MED). `data` is persisted JSON
 *  replayed from the DB — a row written by another build, or hand-edited — and the card feeds a value
 *  straight into `Intl` (`tz`). A partial match that type-asserted its way through would render
 *  `undefined` into the bubble at best. Anything that isn't the whole shape simply isn't a card. */
function automationCardFrom(result: ToolResult | undefined): AutomationCardData | null {
  const a = (result?.data as { automation?: Record<string, unknown> } | undefined)?.automation;
  if (!a || typeof a !== "object") return null;
  const str = (v: unknown) => typeof v === "string";
  const ok =
    str(a.id) &&
    str(a.name) &&
    str(a.schedule_text) &&
    str(a.tz) &&
    str(a.thread_mode) &&
    typeof a.enabled === "boolean" &&
    (a.next_fire === null || str(a.next_fire)) &&
    (a.agent === null || str(a.agent));
  return ok ? (a as unknown as AutomationCardData) : null;
}

/** The persisted card a confirmed `create_automation` leaves in the transcript (§D-5): what was saved,
 *  when it will run, and one tap into the group that owns it. Deliberately read-only — the editor lives in
 *  Conf, and a second edit surface in the chat log would be a second implementation of the same form.
 *  Styling is the `.svc-card` recipe the run history already uses, plus one net-new name line. */
function AutomationCard({ card }: { card: AutomationCardData }) {
  // The next fire is rendered in the AUTOMATION's zone, like every other moment in this feature — a
  // schedule written "At 03:00, Europe/Madrid" must not read as 02:00 on a travelling phone.
  const when = card.next_fire ? `next ${fmtWhen(card.next_fire, card.tz)}` : "no upcoming run";
  const mode = card.thread_mode === "rolling" ? "one continuing thread" : "new thread each run";
  return (
    <div className="svc-card auto-made">
      <div className="auto-made-name">{card.name}</div>
      <div className="auto-run-when">
        {card.schedule_text} · {card.tz} · {when}
      </div>
      <div className="auto-run-when">
        {mode}
        {card.agent ? ` · ${card.agent}` : ""}
        {card.enabled ? "" : " · off"}
      </div>
      <div className="auto-made-foot">
        <button
          type="button"
          className="pm-alt"
          onClick={() => openConfGroup(AUTOMATIONS_GROUP_ID)}
        >
          Open in Conf ↗
        </button>
      </div>
    </div>
  );
}

/** web_search results as a collapsed-by-default disclosure: the bubble stays compact (just the
 *  "N web result(s)" summary line above), and the owner taps to reveal the actual links to check
 *  the sources. Links open in a new tab; rel guards against tab-nabbing. */
function SearchResults({ hits }: { hits: WebSearchHit[] }) {
  return (
    <details className="cmd-links">
      <summary>
        <span className="label">links</span>
        <span className="hint">{hits.length} · tap to view</span>
      </summary>
      <ol>
        {hits.map((h, i) => (
          <li key={i}>
            <a href={h.url} target="_blank" rel="noopener noreferrer nofollow">
              {h.title || h.url}
            </a>
            <span className="src">{h.engine ? ` · ${h.engine}` : ""}</span>
            {h.content && <p className="snip">{h.content}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The dimmed "thinking" disclosure (a thinking model's chain-of-thought). Shared by the bot text
 *  bubble and the command bubble so a thinking block renders with the tool call it produced. */
function ThinkBlock({ text, open }: { text: string; open?: boolean }) {
  return (
    <details className="think" open={open}>
      <summary>
        <span className="label">thinking</span>
        {!open && <span className="hint">tap to view</span>}
      </summary>
      <pre>{text}</pre>
    </details>
  );
}

/** Per-bubble read-aloud toggle (6b-2), in the assistant who-line. Just an icon: ▶ to play this
 *  reply, ⏸ while it's the one playing. Shares the single audio controller (one message at a time);
 *  the docked MiniPlayer hosts the scrubber. Subscribes only to *its own* status, so the ~4×/sec
 *  timeupdate that drives the player doesn't re-render every bubble.
 *
 *  D62/D25: the who-line around it is now tap-to-disclose, so this stops propagation — a nested
 *  control must not fire the row's toggle too (the DeviceRow breakout rule). */
function TtsButton({ id, text, agent }: { id: string; text: string; agent: string | null }) {
  const mine = usePlayback((p) => (p.id === id ? p.status : "idle"));
  const playing = mine === "playing";
  const loading = mine === "loading";
  return (
    <button
      type="button"
      className={"tts-play" + (playing ? " playing" : "") + (loading ? " loading" : "")}
      aria-label={playing ? "pause read-aloud" : "read aloud"}
      title={playing ? "pause" : "read aloud"}
      onClick={(e) => {
        e.stopPropagation();
        // D70 §8.5 — read it in the turn's OWN agent's voice; null ⇒ the global chain (voice.py's
        // `_voice_id` resolves the default on an absent agent, so the field is simply omitted).
        void playMessage(id, text, agent);
      }}
    />
  );
}

function CmdBubble({
  call,
  result,
  ts,
  reasoning,
}: {
  call: ToolCallPart;
  result: ToolResult | undefined;
  ts: string;
  reasoning?: string;
}) {
  const hits = call.tool === "web_search" ? hitsFrom(result) : [];
  const card = automationCardFrom(result);
  const awaiting = !result && call.state === "awaiting_confirm";
  const running = !result && (call.state === "pending" || call.state === "running");
  const okState = result?.state ?? call.state;
  const line = callLine(call);
  return (
    <div className={"b cmd" + (result ? " cmd-resolved" : "")}>
      <div className="who">assistant · {hm(ts)}</div>
      <div className="body">
        {/* The thinking that led to this call renders here so each reasoning block sits with its
            tool call (one assistant turn = think → act). Collapsed; tap to read. */}
        {reasoning && <ThinkBlock text={reasoning} />}
        {/* Collapsed by default so a tool call doesn't clutter the log — the tool name + outcome
            stay visible; tap to reveal the full command/args. Auto-open while awaiting confirm so
            the owner can review before approving. */}
        <details className="cmd-detail" open={awaiting}>
          <summary>
            <span className="preamble">{call.tool.replace(/_/g, " ")}</span>
            {awaiting && <span className="cmd-gate"> · confirm to run</span>}
            <span className="chev" aria-hidden>
              ▾
            </span>
          </summary>
          <pre>{line}</pre>
        </details>
        {awaiting && (
          <div className="actions">
            <button className="exec" onClick={() => void resumeCall(call.call_id, "execute")}>
              allow
            </button>
            {/* D44 W3 — the "always allow" grant: shown ONLY when the backend flagged this exact call
                as approval-eligible (scalar args, not a designer forced-confirm tool). Reuses the `.exec`
                allow-family styling (identical treatment in every theme — the chat tree is a pinned
                class contract, D36) with an `.exec-always` hook; a tap runs the call AND has the SERVER
                persist an args-exact grant (no FE settings write — the whole point of the resume verb).
                Short label so the 4-action row stays uncrowded at 390px. */}
            {alwaysEligibleFor(call.call_id) && (
              <button
                className="exec exec-always"
                title="always allow this exact command (persists a grant you can revoke in Tools)"
                onClick={() => void resumeCall(call.call_id, "execute_always")}
              >
                always
              </button>
            )}
            <button className="edit" onClick={() => fillComposer(line)}>
              edit
            </button>
            <button className="dismiss" onClick={() => void resumeCall(call.call_id, "dismiss")}>
              deny
            </button>
          </div>
        )}
        {running && <div className="cmd-result running">// running…</div>}
        {result && (
          <div className={"cmd-result " + okState}>
            // {result.summary}
            {result.error ? ` — ${result.error}` : ""}
          </div>
        )}
        {/* Captured stdout/stderr (run_shell, terminal_exec, file reads, …) — collapsed by default
            like the web_search links, so the bubble stays compact until the owner taps to read it.
            Skipped for web_search (its hits render below instead). */}
        {result?.output && hits.length === 0 && (
          <details className="cmd-output">
            <summary>
              <span className="label">output</span>
              <span className="chev" aria-hidden>
                ▾
              </span>
            </summary>
            <pre>{result.output}</pre>
          </details>
        )}
        {/* A proposed write (auto-write off): the owner approves it to perform the agent's write, or
            dismisses it. Reuses the confirm-bubble's action classes (D7). */}
        {isProposed(result) && (
          <div className="actions">
            <button className="exec" onClick={() => void applyProposal(call.call_id, "apply")}>
              approve
            </button>
            <button className="dismiss" onClick={() => void applyProposal(call.call_id, "dismiss")}>
              reject
            </button>
          </div>
        )}
        {hits.length > 0 && <SearchResults hits={hits} />}
        {/* A3 §D-5 — the created automation, rendered from the result's own payload, so it survives a
            reload with no extra state (the plan/web_search pattern). */}
        {card && <AutomationCard card={card} />}
      </div>
    </div>
  );
}

/** Chips rendered at most (mirrors `question.MAX_CHOICES`): the backend refuses a longer list at the
 *  tool boundary, so this only bounds a row persisted before that cap existed — a phone must never get a
 *  wall of buttons. Free text stays available for anything not shown. */
const MAX_CHOICE_CHIPS = 8;

/** A `question` call (A2): the agent asked the owner something and suspended. While awaiting, show the
 *  prompt + any offered choices as one-tap chips + a reply input (Send / Decline); once answered or
 *  declined, show the outcome. Sibling of PlanBubble — questions render their own bubble, not a CmdBubble.
 *
 *  The chips (A3 §D-3) read the DURABLE `call.args` — the same place `prompt` comes from — so they
 *  survive a reload and a re-attach with no new event, no store branch and no second component tree.
 *  They are strictly additive: free text still works, and a question that offers nothing renders exactly
 *  as it did before. `default` (what an unattended scheduled run would assume) is marked rather than
 *  pre-filled: the owner is here, so it is a hint, not a decision already made for them. */
function QuestionBubble({
  call,
  result,
  ts,
}: {
  call: ToolCallPart;
  result: ToolResult | undefined;
  ts: string;
}) {
  const prompt = typeof call.args.prompt === "string" ? call.args.prompt : "";
  const awaiting = !result && call.state === "awaiting_answer";
  // Defensive per element: `args` is whatever the model emitted (a REJECTED call still persists its
  // args, and an older row predates the backend's caps), so each entry is trimmed and non-strings /
  // blanks are dropped rather than rendered as an unpressable empty chip. Trimming here is what makes
  // the chips agree with the headless ladder, which compares against a trimmed `default` — `" emma "`
  // would otherwise render as a chip that never matches its own default. De-duped after trimming for
  // the same reason: two variants of one answer are one choice, and would collide as React keys.
  const choices = Array.isArray(call.args.choices)
    ? [
        ...new Set(
          call.args.choices
            .filter((c): c is string => typeof c === "string")
            .map((c) => c.trim())
            .filter((c) => c !== ""),
        ),
      ].slice(0, MAX_CHOICE_CHIPS)
    : [];
  const preferred = typeof call.args.default === "string" ? call.args.default.trim() : "";
  const [text, setText] = useState("");
  const send = () => {
    const a = text.trim();
    if (a) void answerQuestion(call.call_id, a);
  };
  return (
    <div className="b cmd question">
      <div className="who">assistant · {hm(ts)}</div>
      <div className="body">
        <div className="q-prompt">{prompt || "(question)"}</div>
        {awaiting ? (
          <>
            {choices.length > 0 && (
              <div className="q-choices">
                {choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={"q-chip" + (choice === preferred ? " preferred" : "")}
                    title={choice === preferred ? "the agent's suggested answer" : undefined}
                    onClick={() => void answerQuestion(call.call_id, choice)}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
            <div className="q-input-wrap">
              <input
                className="q-input"
                value={text}
                placeholder="type your answer…"
                aria-label="answer the agent's question"
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            {/* Edge-to-edge footer bar, identical to the confirm bubble's actions (.b.cmd .actions). */}
            <div className="actions">
              <button className="exec" onClick={send} disabled={!text.trim()}>
                send
              </button>
              <button className="dismiss" onClick={() => void resumeCall(call.call_id, "dismiss")}>
                decline
              </button>
            </div>
          </>
        ) : result ? (
          <div className={"cmd-result " + result.state}>
            //{" "}
            {result.state === "denied"
              ? "declined"
              : result.state === "skipped"
                ? "dismissed"
                : result.state === "cancelled"
                  ? "cancelled"
                  : result.output || result.summary}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// React.memo so a streamed token re-renders ONLY the streaming bubble, not the whole log: during text
// streaming the store preserves the identity of every non-streaming message (appendDelta returns the same
// `m` for them), and all the other props are referentially stable (resultFor is ref-backed below;
// resolvedDefault/ttsOn are config-derived; streaming/canRetry are `false` for completed bubbles), so the
// default shallow compare skips every settled bubble. (LibreChat-style per-message memoization.)
const Bubbles = memo(function Bubbles({
  m,
  streaming,
  resultFor,
  canRetry,
  onRetry,
  resolvedDefault,
  ttsOn,
  agentArt,
}: {
  m: ChatMessage;
  streaming: boolean;
  resultFor: (callId: string) => ToolResult | undefined;
  /** F20 — render the retry affordance on this assistant bubble. Only true on the latest
   * message when chat status === "error", so historical errors don't grow phantom buttons. */
  canRetry: boolean;
  /** Risk-aware retry handler (I4) — stable; auto-resends a retry-safe turn, else copies to composer. */
  onRetry: () => void;
  /** The resolved default agent slug (7e-c). An assistant turn is labelled with its `agent` only
   * when it differs from this — so default turns stay clean and specialist turns are attributed. */
  resolvedDefault: string | undefined;
  /** Whether TTS is configured (6b-2) — gates the per-bubble read-aloud toggle. */
  ttsOn: boolean;
  /** D70 §8.5 — the who-line avatar resolver, or `undefined` while the Appearance switch is off (which
   *  is how the whole feature turns into today's dot: nothing to resolve, nothing to draw). Stable like
   *  `resultFor` above, so threading it costs the memo nothing. */
  agentArt?: (name: string | null) => AgentArt;
}) {
  if (m.role === "tool") return null; // results render inside their command bubble (paired by id)

  if (m.role === "system") {
    return (
      <div className="b sys">
        <div className="body">{textOf(m.parts)}</div>
      </div>
    );
  }
  if (m.role === "user") {
    // D41 — a QUEUED steer (a mid-turn message/`!exec` waiting to drain into the live turn): render it
    // muted with a tappable "queued" chip. A single tap removes it (it's a queued draft, not a
    // destructive action — no confirm); if it already drained the DELETE resolves it to its sent form.
    const entryId = m.queued;
    const said = textOf(m.parts);
    // An attachment-only send persists with NO text part (D68 §7 — the model-facing placeholder is
    // the server's, at the wire), so the caption bubble is dropped rather than rendered empty. The
    // OPTIMISTIC snapshot counts the same way (MED-6): the bubble is showing files either way, and an
    // empty caption strip under them would flash for exactly as long as the send takes.
    const attached = attachmentsOf(m.parts).length + (m.pending_attachments?.length ?? 0);
    const caption = said !== "" || attached === 0;
    return (
      <div className={"b user" + (entryId ? " queued" : "")}>
        <div className="who">you · {hm(m.ts)}</div>
        {/* D68 §7 — what this turn attached, ABOVE its text (the wire order: the files are the
            subject, the caption is about them). Renders nothing on a message with no attachment
            part, which is every message before this feature and most after it. */}
        <AttachedFiles message={m} />
        {caption && <div className="body">{said}</div>}
        {entryId && (
          <button
            type="button"
            className="steer-chip"
            onClick={() => void removeSteer(entryId)}
            aria-label="remove queued message"
            title="queued — tap to remove"
          >
            queued
          </button>
        )}
      </div>
    );
  }

  // assistant: a bot text bubble (text/error/streaming) + one cmd bubble per tool call. The
  // reasoning that preceded a tool call rides INTO that call's bubble (think → act in one unit);
  // it only gets its own bot bubble when there's no tool call to host it (e.g. a plain answer, or
  // mid-stream before the call lands).
  const err = errorOf(m.parts);
  const reasoning = reasoningOf(m.parts);
  const text = textOf(m.parts);
  const calls = m.parts.filter((p): p is ToolCallPart => p.type === "tool_call");
  const working = streaming && !text && !err && !calls.length;
  // The first non-plan, non-question tool call hosts the thinking (plan + question render their own
  // bubbles, so reasoning rides into a CmdBubble or, failing that, the bot bubble).
  const reasoningHostId = calls.find(
    (c) => c.tool !== "task_plan" && c.tool !== "question",
  )?.call_id;
  const reasoningInBot = !!reasoning && !reasoningHostId;
  const showBot = !!(text || err || working || reasoningInBot);

  return (
    <>
      {showBot && (
        <div className="b bot">
          {/* D62 — the who-line now carries the serve attribution (endpoint chip + the tap-to-reveal
              metrics row) and owns its own disclosure state, so it lives in `chatAttribution`. The
              trailing extras stay here (they're ChatThread's own furniture) and ride in as children. */}
          <BotWhoLine
            m={m}
            label={m.agent && m.agent !== resolvedDefault ? m.agent : "assistant"}
            time={hm(m.ts)}
            // A null `agent` is a turn the DEFAULT agent ran (7e-c), so that is whose avatar it wears —
            // the resolver's own `null` contract.
            avatar={agentArt?.(m.agent ?? null).avatar}
          >
            {working && <span className="status-tag">{reasoning ? "thinking" : "working"}</span>}
            {/* Read-aloud toggle (6b-2): only on a settled text reply, and only when TTS is configured. */}
            {ttsOn && !streaming && text && (
              <TtsButton id={m.id} text={text} agent={m.agent ?? null} />
            )}
          </BotWhoLine>
          <div className="body">
            {reasoningInBot && <ThinkBlock text={reasoning} open={working} />}
            {err ? (
              <div className="chat-err">
                <span className="chat-err-msg">// {err.message}</span>
                {canRetry && err.retryable && (
                  <button
                    type="button"
                    className="chat-err-retry"
                    onClick={onRetry}
                    aria-label="Retry the last message"
                  >
                    retry
                  </button>
                )}
              </div>
            ) : working ? (
              <span className="dots" aria-label="working">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <span className="md">
                <Markdown text={text} />
                {streaming && text && <span className="caret">▍</span>}
              </span>
            )}
          </div>
        </div>
      )}
      {calls.map((c) =>
        c.tool === "task_plan" ? (
          <PlanBubble key={c.call_id} call={c} result={resultFor(c.call_id)} />
        ) : c.tool === "question" ? (
          <QuestionBubble key={c.call_id} call={c} result={resultFor(c.call_id)} ts={m.ts} />
        ) : (
          <CmdBubble
            key={c.call_id}
            call={c}
            result={resultFor(c.call_id)}
            ts={m.ts}
            reasoning={c.call_id === reasoningHostId ? reasoning : undefined}
          />
        ),
      )}
    </>
  );
});

interface Props {
  active: boolean;
  chat: AgentChat;
  /** The zero-messages placeholder. Omitted → the default `// new thread` sys bubble (byte-identical to
   *  vapor today); a bespoke body can pass its own node. */
  emptyState?: ReactNode;
}

const SCROLLER_ID = "app-scroll";

export function ChatThread({ active, chat, emptyState }: Props) {
  // The caller owns the `useAgentChat()` derivation (D29 §14.2) and passes it in — a body needs it anyway
  // for plan placement, so this avoids a second O(n) pairing. `resultByCall` is memoized there;
  // `resolvedDefault` attributes per-turn agents (7e-c); `ttsOn` gates the per-bubble read-aloud.
  const { messages, status, streamingId, resultByCall, resolvedDefault, ttsOn } = chat;
  // D70 §8.5 — the who-line avatar. ONE resolver for the whole log (a per-bubble hook would be two
  // query observers per message), and the Appearance switch is honored HERE by not handing one down at
  // all: off ⇒ every bubble takes the `.who::before` dot path with nothing resolved for it.
  const chatAvatars = useUISlice((s) => s.chatAvatarsVisible);
  const resolveArt = useAgentArt();
  const agentArt = chatAvatars ? resolveArt : undefined;
  // A STABLE result lookup so it doesn't break `Bubbles`' memo each token (`resultByCall` is re-derived
  // per delta → new identity). A ref holds the latest map; the callback identity never changes, and a
  // bubble re-renders (reading the fresh map) exactly when its own message identity changes — which
  // includes when a result lands (the store rebuilds the messages array on addToolResult).
  const resultByCallRef = useRef(resultByCall);
  resultByCallRef.current = resultByCall;
  const resultFor = useCallback((id: string) => resultByCallRef.current[id], []);
  // I4 — risk-aware retry. The catalog carries each tool's `retry_safe`; a stable handler feeds a
  // name→retry_safe lookup into the store's retry (unknown tool → unsafe). `retryLastTurn` then
  // auto-resends a read-only/idempotent turn but copies a mutating one to the composer for review.
  const { data: actionSpecs } = useActionSpecs();
  const onRetry = useCallback(() => {
    const safe = new Map((actionSpecs ?? []).map((s) => [s.name, s.retry_safe]));
    retryLastTurn((tool) => safe.get(tool) ?? false);
  }, [actionSpecs]);
  // The scroller is the app-shell content pane (`#app-scroll`), not the window — the composer/tab
  // bar are in-flow at the bottom of the shell. "Stick to bottom" only while the user is already
  // near the bottom, so streaming follows the bot without yanking them down if they scrolled up.
  const stick = useRef(true);

  const pin = () => {
    const el = document.getElementById(SCROLLER_ID);
    if (el && active && stick.current) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    const el = document.getElementById(SCROLLER_ID);
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Re-pin when the pane resizes (keyboard/toolbar via 100dvh) or the composer grows (typing).
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    const comp = document.getElementById("composer");
    if (comp) ro.observe(comp);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    pin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, active]);

  // Entering the tab always jumps to the newest message (rAF so the now-visible pane has laid out).
  useEffect(() => {
    if (!active) return;
    stick.current = true;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(SCROLLER_ID);
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  return (
    // A11y (F5 Gate A4) — the transcript is a live log region. `role="log"` marks it as a sequential
    // record (implicit aria-live=polite; set explicitly for Firefox/older AT), and `aria-busy` is TRUE
    // while a reply streams so AT holds off announcing until the turn settles — the completed reply is
    // announced ONCE when busy flips false, never per token (the MITRE/APG chatbot live-region pattern).
    <div
      className="chat-log"
      id="chatlog"
      role="log"
      aria-live="polite"
      aria-busy={status === "streaming"}
    >
      {!messages.length &&
        (emptyState ?? (
          <div className="b sys">
            <div className="body">// new thread · ask me about the fleet</div>
          </div>
        ))}
      {messages.map((m, i) => (
        <Bubbles
          key={m.id}
          m={m}
          streaming={status === "streaming" && m.id === streamingId}
          resultFor={resultFor}
          // F20 — only the latest message is eligible for retry, and only when chat is in
          // error state. Historical errors elsewhere in the log stay quiet.
          canRetry={i === messages.length - 1 && status === "error"}
          onRetry={onRetry}
          resolvedDefault={resolvedDefault}
          ttsOn={ttsOn}
          agentArt={agentArt}
        />
      ))}
    </div>
  );
}
