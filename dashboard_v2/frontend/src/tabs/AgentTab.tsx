import { memo, useCallback, useEffect, useRef, useState } from "react";

import { PlanSteps } from "../components/PlanSteps";
import { useAgentChat } from "../hooks/useAgentChat";
import { toggle as playMessage, usePlayback } from "../lib/audioController";
import { fillComposer } from "../lib/composer";
import { Markdown } from "../lib/markdown";
import { advanceStep, planFrom } from "../lib/plan";
import { PRIVILEGE_LEVELS, privilegeLabel, type Privilege } from "../lib/privilege";
import {
  answerQuestion,
  applyProposal,
  editPlan,
  resumeCall,
  retryLastTurn,
  setSessionPrivilege,
  useChatSlice,
} from "../store/chat";
import { useUISlice } from "../store/ui";
import type {
  ChatMessage,
  Part,
  Plan,
  ToolCallPart,
  ToolResult,
  WebSearchHit,
} from "../types";

// Agent chat tab (Phase 4a + 4b). Renders the live thread from the chat store as Vapor bubbles
// (sys / user / bot), streaming token-by-token, with a thinking model's reasoning in a dimmed
// collapsible. 4b adds command/action bubbles (.b.cmd): a tool the model wants to run, paired with
// its result by call_id; a confirm-gated call shows execute/edit/dismiss (DESIGN §12, vapor.html:1934).

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function reasoningOf(parts: Part[]): string {
  return parts.filter((p) => p.type === "reasoning").map((p) => p.text).join("");
}
function textOf(parts: Part[]): string {
  return parts.filter((p) => p.type === "text").map((p) => p.text).join("");
}
function errorOf(parts: Part[]): { message: string; retryable: boolean } | null {
  const e = parts.find((p) => p.type === "error");
  return e && e.type === "error" ? { message: e.message, retryable: e.retryable } : null;
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

/** VAPOR-ONLY (D30): the in-tab pinned plan — a minimized tab hanging from the top of the chat that drops
 *  the checklist down when tapped. Kit themes moved the plan into the composer (the `plan-pill` + peek
 *  `plan-sheet`) so the Agent tab can run its `kit-fade` entrance without a frosted surface inside it; vapor
 *  keeps this frozen (extras.css styles `.plan-pin`/`.plan-drop`). Sticky so it stays reachable while the
 *  transcript scrolls; collapsed by default (the dropdown overlays the chat, so it doesn't reflow messages). */
function PinnedPlan({ plan }: { plan: Plan }) {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === "done").length;
  const [open, setOpen] = useState(false);
  // Clicking a step's dot advances its status (pending → active → done → pending), persists, and the
  // agent sees it next turn (4-plan-edit). Three states so the owner can mark a step "in progress"
  // (active, the lit look) before "done" (✓), matching the states the agent sets itself. EXACTLY ONE
  // step is active at a time (the agent's own invariant): tapping a step to `active` demotes any other
  // active step back to pending — so a manual edit can't leave two steps lit as the current one.
  const cycle = (i: number) => void editPlan(advanceStep(plan.steps, i));
  return (
    <div className="plan-pin">
      <div className="plan-pin-wrap">
        <button
          type="button"
          className={"plan-pin-head" + (open ? " open" : "")}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="plan-title">plan</span>
          <span className="plan-count">
            {done}/{total}
          </span>
          <span className="chev" aria-hidden>
            ▾
          </span>
        </button>
        {open && (
          <div className="plan-drop">
            <PlanSteps plan={plan} onCycle={cycle} />
          </div>
        )}
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
 *  timeupdate that drives the player doesn't re-render every bubble. */
function TtsButton({ id, text }: { id: string; text: string }) {
  const mine = usePlayback((p) => (p.id === id ? p.status : "idle"));
  const playing = mine === "playing";
  const loading = mine === "loading";
  return (
    <button
      type="button"
      className={"tts-play" + (playing ? " playing" : "") + (loading ? " loading" : "")}
      aria-label={playing ? "pause read-aloud" : "read aloud"}
      title={playing ? "pause" : "read aloud"}
      onClick={() => void playMessage(id, text)}
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
            <span className="chev" aria-hidden>▾</span>
          </summary>
          <pre>{line}</pre>
        </details>
        {awaiting && (
          <div className="actions">
            <button className="exec" onClick={() => void resumeCall(call.call_id, "execute")}>
              execute
            </button>
            <button className="edit" onClick={() => fillComposer(line)}>
              edit
            </button>
            <button className="dismiss" onClick={() => void resumeCall(call.call_id, "dismiss")}>
              dismiss
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
              <span className="chev" aria-hidden>▾</span>
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
              dismiss
            </button>
          </div>
        )}
        {hits.length > 0 && <SearchResults hits={hits} />}
      </div>
    </div>
  );
}

/** A `question` call (A2): the agent asked the owner something and suspended. While awaiting, show the
 *  prompt + a reply input (Send / Dismiss); once answered/dismissed, show the outcome. Sibling of
 *  PlanBubble — questions render their own bubble, not a CmdBubble. */
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
                dismiss
              </button>
            </div>
          </>
        ) : result ? (
          <div className={"cmd-result " + result.state}>
            // {result.state === "skipped" ? "dismissed" : result.output || result.summary}
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
  resolvedDefault,
  ttsOn,
}: {
  m: ChatMessage;
  streaming: boolean;
  resultFor: (callId: string) => ToolResult | undefined;
  /** F20 — render the retry affordance on this assistant bubble. Only true on the latest
   * message when chat status === "error", so historical errors don't grow phantom buttons. */
  canRetry: boolean;
  /** The resolved default agent slug (7e-c). An assistant turn is labelled with its `agent` only
   * when it differs from this — so default turns stay clean and specialist turns are attributed. */
  resolvedDefault: string | undefined;
  /** Whether TTS is configured (6b-2) — gates the per-bubble read-aloud toggle. */
  ttsOn: boolean;
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
    return (
      <div className="b user">
        <div className="who">you · {hm(m.ts)}</div>
        <div className="body">{textOf(m.parts)}</div>
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
  const reasoningHostId = calls.find((c) => c.tool !== "task_plan" && c.tool !== "question")?.call_id;
  const reasoningInBot = !!reasoning && !reasoningHostId;
  const showBot = !!(text || err || working || reasoningInBot);

  return (
    <>
      {showBot && (
        <div className="b bot">
          <div className="who">
            {m.agent && m.agent !== resolvedDefault ? m.agent : "assistant"} · {hm(m.ts)}
            {working && <span className="status-tag">{reasoning ? "thinking" : "working"}</span>}
            {/* Read-aloud toggle (6b-2): only on a settled text reply, and only when TTS is configured. */}
            {ttsOn && !streaming && text && <TtsButton id={m.id} text={text} />}
          </div>
          <div className="body">
            {reasoningInBot && <ThinkBlock text={reasoning} open={working} />}
            {err ? (
              <div className="chat-err">
                <span className="chat-err-msg">// {err.message}</span>
                {canRetry && err.retryable && (
                  <button
                    type="button"
                    className="chat-err-retry"
                    onClick={retryLastTurn}
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

/** The session privilege chip (A1/D16) in the chat section header: shows the active session override
 *  (or "default" = follow the agent's own privilege) and opens a small menu to change it. The
 *  `/privilege` composer verb sets the same sticky state; this is the tap-friendly setter for mobile. */
function PrivilegeChip() {
  const sessionPrivilege = useChatSlice((s) => s.sessionPrivilege); // slice — don't re-render per token
  const [open, setOpen] = useState(false);
  const label = sessionPrivilege ? privilegeLabel(sessionPrivilege) : "Default";
  const pick = (p: Privilege | null) => {
    setSessionPrivilege(p);
    setOpen(false);
  };
  return (
    <span className="priv-chip-wrap">
      <button
        type="button"
        className={"priv-chip" + (sessionPrivilege ? " set" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`session privilege: ${label} — tap to change`}
        title="session privilege"
      >
        <span className="priv-dot" aria-hidden />
        <span className="priv-lbl">{label}</span>
        <span className="chev" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <button className="priv-backdrop" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
          <ul className="priv-menu" role="menu">
            {PRIVILEGE_LEVELS.map((l) => (
              <li key={l.val}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={sessionPrivilege === l.val}
                  className={sessionPrivilege === l.val ? "active" : ""}
                  onClick={() => pick(l.val)}
                >
                  {l.label}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!sessionPrivilege}
                className={!sessionPrivilege ? "active" : ""}
                onClick={() => pick(null)}
              >
                Default
              </button>
            </li>
          </ul>
        </>
      )}
    </span>
  );
}

interface Props {
  active: boolean;
}

const SCROLLER_ID = "app-scroll";

export function AgentTab({ active }: Props) {
  // All chat state + derivations + roster/voice context come from the headless controller (D29 §14.2).
  // `resultByCall`/`currentPlan` are memoized there; `resolvedDefault` attributes per-turn agents (7e-c);
  // `ttsOn` gates the per-bubble read-aloud. The init engine + auto-TTS run once in <AppEngines/> (§14.5),
  // not here. The scroll-stick-to-bottom below stays vapor-specific (it targets `#app-scroll`).
  const { messages, status, streamingId, resultByCall, currentPlan, resolvedDefault, ttsOn } =
    useAgentChat();
  // The in-tab pinned plan is vapor-only — kit themes render it in the composer (D30). Non-vapor (kit)
  // themes are the ones that use the kit composer + the `kit-fade` Agent entrance.
  const isVapor = useUISlice((s) => s.theme === "vapor");
  // A STABLE result lookup so it doesn't break `Bubbles`' memo each token (`resultByCall` is re-derived
  // per delta → new identity). A ref holds the latest map; the callback identity never changes, and a
  // bubble re-renders (reading the fresh map) exactly when its own message identity changes — which
  // includes when a result lands (the store rebuilds the messages array on addToolResult).
  const resultByCallRef = useRef(resultByCall);
  resultByCallRef.current = resultByCall;
  const resultFor = useCallback((id: string) => resultByCallRef.current[id], []);
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
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-agent"
      data-screen-label="02 Agent"
      role="tabpanel"
      aria-labelledby="tabbtn-agent"
    >
      <div className="sec">
        <span className="num">02</span>
        <b>Chat</b>
        <span className="right">
          <PrivilegeChip />
        </span>
      </div>
      {isVapor && currentPlan && currentPlan.steps.length > 0 && <PinnedPlan plan={currentPlan} />}
      <div className="chat-log" id="chatlog">
        {!messages.length && (
          <div className="b sys">
            <div className="body">// new thread · ask me about the fleet</div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubbles
            key={m.id}
            m={m}
            streaming={status === "streaming" && m.id === streamingId}
            resultFor={resultFor}
            // F20 — only the latest message is eligible for retry, and only when chat is in
            // error state. Historical errors elsewhere in the log stay quiet.
            canRetry={i === messages.length - 1 && status === "error"}
            resolvedDefault={resolvedDefault}
            ttsOn={ttsOn}
          />
        ))}
      </div>
    </div>
  );
}
