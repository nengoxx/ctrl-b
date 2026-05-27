// Agent chat tab. Phase 1 renders the Vapor chat shell with a static sample thread for visual
// fidelity (D7); the live agent loop, streaming, and command bubbles arrive in Phase 4. The
// shared composer is rendered by App (fleet + agent tabs).

interface Props {
  active: boolean;
}

export function AgentTab({ active }: Props) {
  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-agent" data-screen-label="02 Agent">
      <div className="sec">
        <span className="num">02</span>
        <b>Chat</b>
        <span className="right">one agent · one thread</span>
      </div>
      <div className="chat-log" id="chatlog">
        <div className="b sys">
          <div className="body">// agent chat lands in phase 4</div>
        </div>
        <div className="b user">
          <div className="who">you</div>
          <div className="body">is pegasus reachable?</div>
        </div>
        <div className="b bot">
          <div className="who">assistant</div>
          <div className="body">
            Pegasus replies in ~1.8 ms at 192.168.1.10. The fleet tab polls it live.
          </div>
        </div>
      </div>
    </div>
  );
}
