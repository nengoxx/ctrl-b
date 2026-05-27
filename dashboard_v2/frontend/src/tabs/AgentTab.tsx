import { useEffect, useRef } from "react";

import { initChat, useChat } from "../store/chat";
import type { ChatMessage, Part } from "../types";

// Agent chat tab (Phase 4a). Renders the live thread from the chat store as Vapor bubbles
// (sys / user / bot), streaming token-by-token. A thinking model's reasoning shows in a dimmed
// collapsible above the answer. Tool/command bubbles + plan panels arrive in 4b/4d.

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

function Bubble({ m, streaming }: { m: ChatMessage; streaming: boolean }) {
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
  // assistant
  const err = errorOf(m.parts);
  const reasoning = reasoningOf(m.parts);
  const text = textOf(m.parts);
  // "working" = streaming but no answer text yet (cold-loading / reasoning / crunching the prompt).
  const working = streaming && !text && !err;
  return (
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
          <span>
            {text}
            {streaming && <span className="caret">▍</span>}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  active: boolean;
}

const SCROLLER_ID = "app-scroll";

export function AgentTab({ active }: Props) {
  const { messages, status } = useChat();
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

  const lastId = messages.length ? messages[messages.length - 1].id : null;

  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-agent" data-screen-label="02 Agent">
      <div className="sec">
        <span className="num">02</span>
        <b>Chat</b>
        <span className="right">one agent · one thread</span>
      </div>
      <div className="chat-log" id="chatlog">
        {!messages.length && (
          <div className="b sys">
            <div className="body">// new thread · ask me about the fleet</div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            streaming={status === "streaming" && m.role === "assistant" && m.id === lastId}
          />
        ))}
      </div>
    </div>
  );
}
