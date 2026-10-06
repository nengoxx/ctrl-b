import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useActionSpecs } from "../hooks/useActions";
import { useAgentArt, type AgentArt } from "../hooks/useAgentArt";
import type { AgentChat } from "../hooks/useAgentChat";
import { AUTOMATIONS_GROUP_ID, fmtWhen } from "../hooks/useAutomations";
import { useOverlayBackGuard } from "../hooks/useOverlayBackGuard";
import { toggle as playMessage, usePlayback, type Speaker } from "../lib/audioController";
import { fillComposer } from "../lib/composer";
import { modalKeyDown } from "../lib/focusTrap";
import { Markdown } from "../lib/markdown";
import { planFrom } from "../lib/plan";
import { createStickLatch } from "../lib/stickToBottom";
import {
  alwaysEligibleFor,
  answerQuestion,
  applyProposal,
  deleteMessage,
  editMessage,
  isUnsent,
  regenerate,
  removeSteer,
  resumeCall,
  selectAlternate,
  // The text-part join moved to the store when the call screen became its second reader (owner ask
  // 2026-09-22) — one filter, so "what was said" cannot mean two things.
  textOf,
} from "../store/chat";
import { openConfGroup } from "../store/groupScroll";
import { requestPrompt } from "../store/prompt";
import { pushToast } from "../store/toast";
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
import { BotWhoLine, type VariantNav, type WhoAction } from "./chatAttribution";
import { ArrowDownIcon, PencilIcon, XIcon } from "./icons";

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
 *  D62/D25: the who-line's metrics disclosure toggles on its IDENTITY run only (`BotWhoLine`, owner
 *  2026-09-24) — this button sits outside that zone, so a tap here reaches nothing else. */
function TtsButton({ id, text, speaker }: { id: string; text: string; speaker: Speaker }) {
  const mine = usePlayback((p) => (p.id === id ? p.status : "idle"));
  const playing = mine === "playing";
  const loading = mine === "loading";
  return (
    <button
      type="button"
      className={"tts-play" + (playing ? " playing" : "") + (loading ? " loading" : "")}
      aria-label={playing ? "pause read-aloud" : "read aloud"}
      title={playing ? "pause" : "read aloud"}
      onClick={() => {
        // D70 §8.5 — read it in the turn's OWN agent's voice; a null agent ⇒ the global chain (voice.py's
        // `_voice_id` resolves the default on an absent agent, so the field is simply omitted). The
        // speaker's `actions` is the duties gate on the ear (session-51 polish #6).
        void playMessage(id, text, speaker);
      }}
    />
  );
}

function CmdBubble({
  call,
  result,
  ts,
  who,
  reasoning,
}: {
  call: ToolCallPart;
  result: ToolResult | undefined;
  ts: string;
  /** The turn's who-line name (`whoLabel`) — the same one its text bubble carries (session-51 #1, Q1b). */
  who: string;
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
      <div className="who">
        {who} · {hm(ts)}
      </div>
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
  who,
}: {
  call: ToolCallPart;
  result: ToolResult | undefined;
  ts: string;
  /** The turn's who-line name (`whoLabel`) — the same one its text bubble carries (session-51 #1, Q1b). */
  who: string;
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
      <div className="who">
        {who} · {hm(ts)}
      </div>
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

// ── D81 — the owner's message actions (retry · swap · edit · delete) ─────────────────────────────
// The store owns every route; these are the two view-side pieces with no state of their own, so they
// are module-level (a stable identity for `Bubbles`' memo without a `useCallback`).

/** EDIT — the house full-page editor (`requestPrompt`: back-guard, focus trap, phone-safe; no new
 *  overlay). A user message's editor also carries its DELETE (owner ruling ③: one control on the user's
 *  name line), which cancels the edit and hands over to the store's own confirm. An unchanged text saves
 *  nothing. A save the server did NOT take (busy, folded, blank, a turn started) re-opens the editor on
 *  the words the owner typed, with a toast — the store's note says why (D81 fix wave 1). */
function openEditor(m: ChatMessage, draft?: string): void {
  const before = textOf(m.parts);
  const own = m.role === "user";
  void requestPrompt({
    title: own ? "Edit your message" : "Edit this reply",
    value: draft ?? before,
    mono: false,
    saveLabel: "Save",
    ...(own ? { danger: { label: "Delete message", run: () => void deleteMessage(m.id) } } : {}),
  }).then(async (next) => {
    if (next === null || next === before) return;
    if (await editMessage(m.id, next)) return;
    pushToast("The edit wasn't saved — your text is back in the editor", "err");
    openEditor(m, next);
  });
}

/** DELETE — the store asks the one confirm tap and resolves the unit server-side. */
function deleteOne(m: ChatMessage): void {
  void deleteMessage(m.id);
}

/** SWAP — show variant `n` of the tail reply. */
function selectOne(hostId: string, n: number): void {
  void selectAlternate(hostId, n);
}

/** The who-line NAME of an assistant turn (session-51 polish #1, owner-ruled Q1a): a character with a
 *  `title` shows it — the default agent included, which the 7e-c rule used to hide behind
 *  "assistant". An untitled agent keeps the 7e-c look: "assistant" for the resolved default (and a
 *  bare `null` turn, which IS the default), its slug for a specialist. Read off `titled`, never by
 *  comparing `title` to the slug (the resolver folds a missing title into the slug). */
function whoLabel(
  agent: string | null,
  art: AgentArt,
  resolvedDefault: string | undefined,
): string {
  if (art.titled) return art.title;
  return agent && agent !== resolvedDefault ? agent : "assistant";
}

// React.memo so a streamed token re-renders ONLY the streaming bubble, not the whole log: during text
// streaming the store preserves the identity of every non-streaming message (appendDelta returns the same
// `m` for them), and all the other props are referentially stable (resultFor is ref-backed below;
// resolvedDefault/ttsOn are config-derived; streaming/canRetry are `false` for completed bubbles), so the
// default shallow compare skips every settled bubble. (LibreChat-style per-message memoization.)
const Bubbles = memo(function Bubbles({
  m,
  streaming,
  idle,
  locked,
  resultFor,
  canRetry,
  onRegenerate,
  resolvedDefault,
  ttsOn,
  agentArt,
  avatars,
}: {
  m: ChatMessage;
  streaming: boolean;
  /** D81 — no turn is streaming, so the owner's message actions may show. One flag for the whole log
   *  (it flips twice per turn, and every bubble re-renders then — never per token). */
  idle: boolean;
  /** D81 fix wave 1 — an UNSENT bubble follows this message (a send the server never took): the reply
   *  above it is not the tail from the owner's side, so it offers no retry and no `›` past the end. */
  locked: boolean;
  resultFor: (callId: string) => ToolResult | undefined;
  /** F20 — render the retry affordance on this assistant bubble. Only true on the latest
   * message when chat status === "error", so historical errors don't grow phantom buttons. */
  canRetry: boolean;
  /** D81 — RETRY as a new variant (I4 risk-aware: the store confirms before re-running a reply that
   *  ran a non-retry-safe tool) — stable. The F20 pill and the disclosure's `retry` both call it. */
  onRegenerate: (hostId: string) => void;
  /** The resolved default agent slug (7e-c): an UNTITLED agent's turn is labelled with its slug only
   * when it differs from this — see `whoLabel` (session-51 #1: a titled agent always shows its title). */
  resolvedDefault: string | undefined;
  /** Whether TTS is configured (6b-2) — gates the per-bubble read-aloud toggle. */
  ttsOn: boolean;
  /** D70 §8.5 — the agent resolver, handed down ALWAYS: the who-line NAME reads it whatever the
   *  Appearance switch says (session-51 #1 — avatars off ≠ names off). Stable like `resultFor` above,
   *  so threading it costs the memo nothing. */
  agentArt: (name: string | null) => AgentArt;
  /** The Appearance switch (`chatAvatarsVisible`): off ⇒ no avatar is drawn and every bubble takes
   *  the `.who::before` dot path. A boolean, so it is memo-stable too. */
  avatars: boolean;
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
        <div className="who">
          you · {hm(m.ts)}
          {m.edited ? " · edited" : ""}
          {/* D81 — the ONE control on the owner's name line: edit (its sheet also holds delete). The
              line is `row-reverse`, so the last child sits at the far end from the dot. Never on a
              client-only row (no server id yet) or while a turn streams. */}
          {idle && !m.local && (
            <button
              type="button"
              className="who-edit"
              aria-label="edit your message"
              onClick={() => openEditor(m)}
            >
              <PencilIcon size={12} />
            </button>
          )}
        </div>
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
  // A null `agent` is a turn the DEFAULT agent ran (7e-c), so that is who it resolves to — the
  // resolver's own `null` contract. One resolution serves the name (every bubble of the turn) and the
  // avatar (only while the Appearance switch is on).
  const art = agentArt(m.agent ?? null);
  const who = whoLabel(m.agent ?? null, art, resolvedDefault);
  const showBot = !!(text || err || working || reasoningInBot);
  // D81 — the owner's actions on a DURABLE reply row, only while no turn streams. `retry` + the counter
  // hang off the tail's host (`reply`, the server's annotation); `edit` needs text to edit (a folded row
  // is refused by the server, so it is not offered); `delete` takes the whole reply (the server's unit).
  const acting = idle && !m.local;
  const reply = acting ? m.reply : undefined;
  const actions: WhoAction[] = acting
    ? [
        ...(reply && !locked
          ? [{ label: "retry", aria: "retry this reply", run: () => onRegenerate(m.id) }]
          : []),
        ...(text && !m.compacted
          ? [{ label: "edit", aria: "edit this reply", run: () => openEditor(m) }]
          : []),
        { label: "delete", aria: "delete this reply", run: () => deleteOne(m), danger: true },
      ]
    : [];
  const variant: VariantNav | undefined =
    reply && reply.count > 1
      ? {
          n: reply.n,
          count: reply.count,
          onPrev: reply.n > 1 ? () => selectOne(m.id, reply.n - 1) : undefined,
          // `›` on the last variant writes a new one (ST's swipe past the end) — not while locked.
          onNext:
            reply.n < reply.count
              ? () => selectOne(m.id, reply.n + 1)
              : locked
                ? undefined
                : () => onRegenerate(m.id),
        }
      : undefined;

  return (
    <>
      {showBot && (
        <div className="b bot">
          {/* D62 — the who-line now carries the serve attribution (endpoint chip + the tap-to-reveal
              metrics row) and owns its own disclosure state, so it lives in `chatAttribution`. The
              trailing extras stay here (they're ChatThread's own furniture) and ride in as children. */}
          <BotWhoLine
            m={m}
            label={who}
            time={hm(m.ts)}
            avatar={avatars ? art.avatar : undefined}
            actions={actions}
            variant={variant}
          >
            {working && <span className="status-tag">{reasoning ? "thinking" : "working"}</span>}
            {/* Read-aloud toggle (6b-2): only on a settled text reply, and only when TTS is configured. */}
            {ttsOn && !streaming && text && (
              <TtsButton
                id={m.id}
                text={text}
                speaker={{ agent: m.agent ?? null, actions: art.actions }}
              />
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
                    onClick={() => onRegenerate(m.id)}
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
                {/* Q2b — a settled reply italicizes an action the model never closed; mid-stream it
                    stays literal until the closer arrives (session-51 #2). */}
                <Markdown text={text} settled={!streaming} actions={art.actions} />
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
          <QuestionBubble
            key={c.call_id}
            call={c}
            result={resultFor(c.call_id)}
            ts={m.ts}
            who={who}
          />
        ) : (
          <CmdBubble
            key={c.call_id}
            call={c}
            result={resultFor(c.call_id)}
            ts={m.ts}
            who={who}
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

/** Did a scroller NESTED inside the pane take this wheel? True when any element between the event's
 *  target and the pane can still scroll up — it moved, the pane did not, so the wheel is no intent to
 *  leave the bottom (ISS-66 review F2; use-stick-to-bottom's `handleWheel` asks the same question). */
function nestedScrollerTookIt(target: EventTarget | null, pane: HTMLElement): boolean {
  for (let n = target instanceof Element ? target : null; n && n !== pane; n = n.parentElement)
    if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
  return false;
}

// ── the bubble-arrival animation (owner ask 2026-09-21: the WhatsApp-class appear) ───────────────
// The store marks LIVE appends with the client-only `fresh` flag (types.ts — the `queued` class), so
// bulk loads/reloads never animate. What this layer adds is the once-and-only-once discipline:
//   · the decision LATCHES at mount (a streaming bubble re-renders per token, and a class that
//     dropped after the first paint would cancel the animation it started);
//   · a module-level ledger of ids that already animated, so a pane remount (tab/theme switch)
//     re-rendering the same fresh messages does not replay them. Grows one id per live message per
//     session — session-bounded, like the store's own raw-line caches.
// One wrapper per MESSAGE (display: contents — no box, the log's layout is untouched) because a
// single message renders several `.b` roots (the reply + its command bubbles); the stylesheet
// animates `.b-wrap.arrive > .b`, motion-gated like every kit animation. The "everything shifts up"
// half of the WhatsApp feel is the existing stick-to-bottom pin — growth scrolls, nothing else moves.
const arrivedIds = new Set<string>();

function ArriveWrap({ id, fresh, children }: { id: string; fresh?: true; children: ReactNode }) {
  const [arrive] = useState(() => fresh === true && !arrivedIds.has(id));
  useEffect(() => {
    if (arrive) arrivedIds.add(id);
  }, [arrive, id]);
  return <div className={arrive ? "b-wrap arrive" : "b-wrap"}>{children}</div>;
}

export function ChatThread({ active, chat, emptyState }: Props) {
  // The caller owns the `useAgentChat()` derivation (D29 §14.2) and passes it in — a body needs it anyway
  // for plan placement, so this avoids a second O(n) pairing. `resultByCall` is memoized there;
  // `resolvedDefault` attributes per-turn agents (7e-c); `ttsOn` gates the per-bubble read-aloud.
  const { messages, status, streamingId, resultByCall, resolvedDefault, ttsOn } = chat;
  // D70 §8.5 — ONE agent resolver for the whole log (a per-bubble hook would be two query observers
  // per message), handed down always: it answers the who-line NAME (session-51 #1) as well as the
  // avatar. The Appearance switch gates only the AVATAR — off ⇒ every bubble takes the `.who::before`
  // dot path, but still shows the agent's name.
  const chatAvatars = useUISlice((s) => s.chatAvatarsVisible);
  const agentArt = useAgentArt();
  // D81 fix wave 1 — the last UNSENT bubble's index: every message before it is `locked` (no retry).
  let lastUnsent = -1;
  for (let i = messages.length - 1; i >= 0; i--)
    if (isUnsent(messages[i])) {
      lastUnsent = i;
      break;
    }
  // …and the last ROW that is not a note (a client breadcrumb): the F20 pill's host. A refusal's own note
  // (`// a turn is already running…`) lands after the error it refused, and must not hide its retry.
  let lastRow = messages.length - 1;
  while (lastRow >= 0 && messages[lastRow].role === "system") lastRow--;
  // A STABLE result lookup so it doesn't break `Bubbles`' memo each token (`resultByCall` is re-derived
  // per delta → new identity). A ref holds the latest map; the callback identity never changes, and a
  // bubble re-renders (reading the fresh map) exactly when its own message identity changes — which
  // includes when a result lands (the store rebuilds the messages array on addToolResult).
  const resultByCallRef = useRef(resultByCall);
  resultByCallRef.current = resultByCall;
  const resultFor = useCallback((id: string) => resultByCallRef.current[id], []);
  // I4 — risk-aware retry. The catalog carries each tool's `retry_safe`; a stable handler feeds a
  // name→retry_safe lookup into the store's regenerate (unknown tool → unsafe), which asks one confirm
  // tap before re-running a reply that ran a mutating tool (D81 — a new take may repeat the action).
  const { data: actionSpecs } = useActionSpecs();
  const onRegenerate = useCallback(
    (hostId: string) => {
      const safe = new Map((actionSpecs ?? []).map((s) => [s.name, s.retry_safe]));
      void regenerate(hostId, (tool) => safe.get(tool) ?? false);
    },
    [actionSpecs],
  );
  // STICK TO BOTTOM (ISS-66) — the scroller is the app-shell content pane (`#app-scroll`), not the window;
  // the composer/tab bar float over its bottom. Streaming follows the reply until the owner scrolls UP,
  // and from then on nothing moves until they come back down to the end, send, or tap the ↓ pill. The
  // rule is ONE direction-latched controller (`lib/stickToBottom.ts`, R102 §7) — never a position band
  // re-read per scroll event, which the per-chunk pins below swallowed (the old 140 px rule: a drag had
  // to clear the whole band between two chunks or be yanked back). The call overlay's captions are its
  // second consumer.
  const [latch] = useState(createStickLatch);
  // The pill's visibility, MIRRORED from the latch — set only when it changes, never per scroll event.
  const [escaped, setEscaped] = useState(false);
  const shownEscaped = useRef(false);
  const mirror = () => {
    const e = latch.isEscaped();
    if (e === shownEscaped.current) return;
    shownEscaped.current = e;
    setEscaped(e);
  };

  const pin = () => {
    const el = document.getElementById(SCROLLER_ID);
    if (el && active) latch.pin(el);
  };

  // The re-stick, deliberate: the ↓ pill's tap (and the two triggers below, which share it).
  const stickNow = () => {
    const el = document.getElementById(SCROLLER_ID);
    if (!el) return;
    latch.stick(el);
    mirror();
  };
  // The pill's tap: re-stick, but first hand focus to the LOG (`tabIndex={-1}`) — the pill unmounts on
  // this very tap, and a keyboard activation would otherwise drop focus to <body> (review round №1, F7).
  // Never the composer: focusing it opens the keyboard on Android. `preventScroll` because the stick
  // below owns the scroll position.
  const jump = () => {
    document.getElementById("chatlog")?.focus({ preventScroll: true });
    stickNow();
  };

  useEffect(() => {
    // ONLY while this tab shows: the scroller is SHARED with every other section, and another section's
    // scrolling must never move the latch (it is re-born on the next tab entry anyway).
    if (!active) return;
    const el = document.getElementById(SCROLLER_ID);
    if (!el) return;
    const onScroll = () => {
      latch.onScroll(el);
      mirror();
    };
    // Desktop intent: a wheel turned up escapes before its scroll lands (touch has no wheel — on the
    // phone the escape comes from the scroll direction alone). Only a wheel that can move THIS pane
    // (review round №1, F2): a ctrl+wheel is a zoom, and a wheel bubbling out of a nested scroller that
    // still had room above (a command's `.cmd-output > pre`) was consumed there — the pane never moved.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || nestedScrollerTookIt(e.target, el)) return;
      latch.onWheel(e.deltaY, el);
      mirror();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    // Re-pin when the pane resizes (keyboard/toolbar via 100dvh) or the composer grows (typing) — and
    // when the LOG itself grows after a pin (owner report 2026-09-23: "back on the agent tab it sits
    // slightly scrolled up"). The tab-entry jump below measures `scrollHeight` one frame after the
    // switch, but bubble images, lazy art and late layout keep adding height after that frame, and a
    // scroller's own box does not change when its content does — only the log's box does. Each pin is
    // a no-op while the owner has escaped.
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    const comp = document.getElementById("composer");
    if (comp) ro.observe(comp);
    const log = document.getElementById("chatlog");
    if (log) ro.observe(log);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Every change of the log follows (a no-op while escaped) — EXCEPT a SEND, which re-sticks: typed,
  // dictated (the auto-send skips `useComposer().send`, so this keys on the LOG, not the send seam: audit
  // §9) or a mid-stream steer. A send is a fresh USER row among the rows APPENDED since the last run —
  // never just the newest row: an idle `sendMessage` appends `[tempUser, placeholder]` in ONE set
  // (`store/chat.ts`), so the newest row is the assistant's (review round №1, F1). "Fresh" is the store's
  // live-append mark (a reload or a thread switch never carries it), and only GROWTH counts: a queued
  // steer that drains is RENAMED in place (`resolveSteerBubble` adopts the server id) — same length,
  // nothing appended, nobody sent anything.
  const seenLen = useRef(0);
  useEffect(() => {
    const prevLen = seenLen.current;
    seenLen.current = messages.length;
    const sent = messages.slice(prevLen).some((m) => m.role === "user" && m.fresh === true);
    if (sent && active) stickNow();
    else pin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, active]);

  // Entering the tab always jumps to the newest message (rAF so the now-visible pane has laid out) — and
  // re-births the latch: whatever it last sampled belongs to the scroller's other owners since.
  useEffect(() => {
    if (!active) return;
    latch.reset();
    mirror();
    const id = requestAnimationFrame(stickNow);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      {/* A11y (F5 Gate A4) — the transcript is a live log region. `role="log"` marks it as a sequential
          record (implicit aria-live=polite; set explicitly for Firefox/older AT), and `aria-busy` is TRUE
          while a reply streams so AT holds off announcing until the turn settles — the completed reply is
          announced ONCE when busy flips false, never per token (the MITRE/APG chatbot live-region
          pattern). */}
      <div
        className="chat-log"
        id="chatlog"
        role="log"
        aria-live="polite"
        aria-busy={status === "streaming"}
        // Programmatically focusable only (never in the tab order): the ↓ pill hands focus here.
        tabIndex={-1}
      >
        {!messages.length &&
          (emptyState ?? (
            <div className="b sys">
              <div className="body">// new thread · ask me about the fleet</div>
            </div>
          ))}
        {messages.map((m, i) => (
          <ArriveWrap key={m.id} id={m.id} fresh={m.fresh}>
            <Bubbles
              m={m}
              streaming={status === "streaming" && m.id === streamingId}
              idle={status !== "streaming"}
              locked={i < lastUnsent}
              resultFor={resultFor}
              // F20 — only the latest message (notes aside) is eligible for retry, and only when chat
              // is in error state. Historical errors elsewhere in the log stay quiet.
              canRetry={i === lastRow && status === "error"}
              onRegenerate={onRegenerate}
              resolvedDefault={resolvedDefault}
              ttsOn={ttsOn}
              agentArt={agentArt}
              avatars={chatAvatars}
            />
          </ArriveWrap>
        ))}
      </div>
      {/* JUMP TO LATEST (ISS-66) — only while the owner has scrolled away from a following thread. A
          ZERO-HEIGHT sticky pin after the log (the `.kit-backdrop-pin` precedent), so it takes no flow
          space and never changes `#chatlog`'s box — the log's ResizeObserver must not see it toggle. It
          rests on the scroller's content-box edge (`bottom: 0`), i.e. on top of the pane's bottom PAD,
          which every theme already sizes to clear its own composer with 12 px to spare (gacha's includes
          its floating nav), and it rides the pane when the keyboard shrinks it. The tab wrapper's display:none hides it off this section. */}
      {active && escaped && (
        <div className="kit-jump-pin">
          <button type="button" className="kit-jump" aria-label="Jump to latest" onClick={jump}>
            <ArrowDownIcon />
          </button>
        </div>
      )}
    </>
  );
}
