import { useEffect, useMemo, useRef, useState } from "react";

import { useAgentRoster } from "../hooks/useAgents";
import { fillComposer } from "../lib/composer";
import { Markdown } from "../lib/markdown";
import { PRIVILEGE_LEVELS, privilegeLabel, type Privilege } from "../lib/privilege";
import {
  answerQuestion,
  applyProposal,
  editPlan,
  initChat,
  resumeCall,
  retryLastTurn,
  setSessionPrivilege,
  useChat,
} from "../store/chat";
import type {
  ChatMessage,
  Part,
  Plan,
  PlanStep,
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

/** Pull the plan from a task_plan pair — prefer the executed result's `data.plan`, fall back to the
 *  call args so it renders the instant the call streams in (before the result lands). */
function planFrom(call: ToolCallPart, result: ToolResult | undefined): Plan | null {
  const fromResult = (result?.data as { plan?: Plan } | undefined)?.plan;
  if (fromResult && Array.isArray(fromResult.steps)) return fromResult;
  const fromArgs = call.args as { steps?: PlanStep[] };
  if (Array.isArray(fromArgs.steps)) return { steps: fromArgs.steps };
  return null;
}

/** The checklist itself (shared by the inline breadcrumb's expansion and the pinned panel). When
 *  `onToggle` is given (the live pinned panel), each step's dot is a button that flips done/undone;
 *  historical breadcrumbs omit it and stay read-only. */
function PlanSteps({ plan, onToggle }: { plan: Plan; onToggle?: (i: number) => void }) {
  return (
    <ul className="plan-steps">
      {plan.steps.map((s, i) => (
        <li key={i} className={"plan-step " + s.status}>
          {onToggle ? (
            <span
              className="tick tick-btn"
              role="button"
              tabIndex={0}
              aria-label={`toggle "${s.text}" ${s.status === "done" ? "incomplete" : "done"}`}
              onClick={() => onToggle(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(i);
                }
              }}
            />
          ) : (
            <span className="tick" aria-hidden />
          )}
          <span className="txt">{s.text}</span>
        </li>
      ))}
    </ul>
  );
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

/** The current plan as a minimized tab that hangs from the top of the chat and drops the checklist
 *  down when tapped. Sticky so it stays reachable while the transcript scrolls; collapsed by default
 *  (the dropdown overlays the chat, so opening it doesn't reflow the messages). */
function PinnedPlan({ plan }: { plan: Plan }) {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === "done").length;
  const [open, setOpen] = useState(false);
  // Clicking a step's dot toggles done/undone, persists, and the agent sees it next turn (4-plan-edit).
  const toggle = (i: number) =>
    void editPlan(
      plan.steps.map((s, j) =>
        j === i ? { ...s, status: s.status === "done" ? "pending" : "done" } : s,
      ),
    );
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
            <PlanSteps plan={plan} onToggle={toggle} />
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

function Bubbles({
  m,
  streaming,
  resultFor,
  canRetry,
  resolvedDefault,
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
}

/** The session privilege chip (A1/D16) in the chat section header: shows the active session override
 *  (or "default" = follow the agent's own privilege) and opens a small menu to change it. The
 *  `/privilege` composer verb sets the same sticky state; this is the tap-friendly setter for mobile. */
function PrivilegeChip() {
  const { sessionPrivilege } = useChat();
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
  const { messages, status, streamingId } = useChat();
  // Resolved default agent slug — assistant turns are labelled only when their agent differs (7e-c).
  const resolvedDefault = useAgentRoster().data?.default;
  // The scroller is the app-shell content pane (`#app-scroll`), not the window — the composer/tab
  // bar are in-flow at the bottom of the shell. "Stick to bottom" only while the user is already
  // near the bottom, so streaming follows the bot without yanking them down if they scrolled up.
  const stick = useRef(true);

  useEffect(() => {
    void initChat();
  }, []);

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

  // Pair tool results to their calls by id across the whole thread (live appends + reloaded
  // separate `tool` messages both land here). Also track the most-recent task_plan call → its plan
  // is the current one, shown in the pinned panel (the model rewrites the whole list each call).
  // Memoized: linear scan over every message every render gets pricey on long threads — only
  // recompute when `messages` actually changes.
  const { resultByCall, currentPlan } = useMemo(() => {
    const byCall: Record<string, ToolResult> = {};
    let latestPlanCall: ToolCallPart | null = null;
    for (const m of messages) {
      for (const p of m.parts) {
        if (p.type === "tool_result") byCall[p.call_id] = p.result;
        if (p.type === "tool_call" && p.tool === "task_plan") latestPlanCall = p;
      }
    }
    const plan = latestPlanCall ? planFrom(latestPlanCall, byCall[latestPlanCall.call_id]) : null;
    return { resultByCall: byCall, currentPlan: plan };
  }, [messages]);

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
      {currentPlan && currentPlan.steps.length > 0 && <PinnedPlan plan={currentPlan} />}
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
            resultFor={(id) => resultByCall[id]}
            // F20 — only the latest message is eligible for retry, and only when chat is in
            // error state. Historical errors elsewhere in the log stay quiet.
            canRetry={i === messages.length - 1 && status === "error"}
            resolvedDefault={resolvedDefault}
          />
        ))}
      </div>
    </div>
  );
}
