import { useEffect, useRef, useState } from "react";

import { fillComposer } from "../lib/composer";
import { Markdown } from "../lib/markdown";
import { initChat, resumeCall, useChat } from "../store/chat";
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
function errorOf(parts: Part[]): string | null {
  const e = parts.find((p) => p.type === "error");
  return e && e.type === "error" ? e.message : null;
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

/** The checklist itself (shared by the inline breadcrumb's expansion and the pinned panel). */
function PlanSteps({ plan }: { plan: Plan }) {
  return (
    <ul className="plan-steps">
      {plan.steps.map((s, i) => (
        <li key={i} className={"plan-step " + s.status}>
          <span className="tick" aria-hidden />
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
            <PlanSteps plan={plan} />
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

function CmdBubble({
  call,
  result,
  ts,
}: {
  call: ToolCallPart;
  result: ToolResult | undefined;
  ts: string;
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
        <div className="preamble">
          {call.tool.replace(/_/g, " ")}
          {awaiting && <span className="cmd-gate"> · confirm to run</span>}
        </div>
        <pre>{line}</pre>
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
        {hits.length > 0 && <SearchResults hits={hits} />}
      </div>
    </div>
  );
}

function Bubbles({
  m,
  streaming,
  resultFor,
}: {
  m: ChatMessage;
  streaming: boolean;
  resultFor: (callId: string) => ToolResult | undefined;
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

  // assistant: a bot text bubble (if any text/reasoning/error or still working) + one cmd bubble
  // per tool call.
  const err = errorOf(m.parts);
  const reasoning = reasoningOf(m.parts);
  const text = textOf(m.parts);
  const calls = m.parts.filter((p): p is ToolCallPart => p.type === "tool_call");
  const working = streaming && !text && !err && !calls.length;
  const showBot = !!(reasoning || text || err || working);

  return (
    <>
      {showBot && (
        <div className="b bot">
          <div className="who">
            assistant · {hm(m.ts)}
            {working && <span className="status-tag">{reasoning ? "thinking" : "working"}</span>}
          </div>
          <div className="body">
            {reasoning && (
              <details className="think" open={working}>
                <summary>
                  <span className="label">thinking</span>
                  {!working && <span className="hint">tap to view</span>}
                </summary>
                <pre>{reasoning}</pre>
              </details>
            )}
            {err ? (
              <span className="chat-err">// {err}</span>
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
        ) : (
          <CmdBubble key={c.call_id} call={c} result={resultFor(c.call_id)} ts={m.ts} />
        ),
      )}
    </>
  );
}

interface Props {
  active: boolean;
}

const SCROLLER_ID = "app-scroll";

export function AgentTab({ active }: Props) {
  const { messages, status, streamingId } = useChat();
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
  const resultByCall: Record<string, ToolResult> = {};
  let latestPlanCall: ToolCallPart | null = null;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool_result") resultByCall[p.call_id] = p.result;
      if (p.type === "tool_call" && p.tool === "task_plan") latestPlanCall = p;
    }
  }
  const currentPlan = latestPlanCall
    ? planFrom(latestPlanCall, resultByCall[latestPlanCall.call_id])
    : null;

  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-agent" data-screen-label="02 Agent">
      <div className="sec">
        <span className="num">02</span>
        <b>Chat</b>
        <span className="right">one agent · one thread</span>
      </div>
      {currentPlan && currentPlan.steps.length > 0 && <PinnedPlan plan={currentPlan} />}
      <div className="chat-log" id="chatlog">
        {!messages.length && (
          <div className="b sys">
            <div className="body">// new thread · ask me about the fleet</div>
          </div>
        )}
        {messages.map((m) => (
          <Bubbles
            key={m.id}
            m={m}
            streaming={status === "streaming" && m.id === streamingId}
            resultFor={(id) => resultByCall[id]}
          />
        ))}
      </div>
    </div>
  );
}
