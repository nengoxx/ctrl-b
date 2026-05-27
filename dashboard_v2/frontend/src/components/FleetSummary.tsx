import type { Host } from "../types";

// Fleet summary strip — awake count, average ping over online hosts, poll cycle.

interface Props {
  hosts: Host[];
  pollSeconds: number;
}

export function FleetSummary({ hosts, pollSeconds }: Props) {
  const awake = hosts.filter((h) => h.status?.online);
  const pings = awake.map((h) => h.status?.ping_ms).filter((p): p is number => p != null);
  const avg = pings.length ? pings.reduce((a, b) => a + b, 0) / pings.length : 0;

  return (
    <div className="summary">
      <div className="s">
        <div className="v">
          {awake.length}
          <small>/{hosts.length}</small>
        </div>
        <div className="l">awake</div>
      </div>
      <div className="s cyan">
        <div className="v">
          {avg.toFixed(1)}
          <small>ms</small>
        </div>
        <div className="l">avg ping</div>
      </div>
      <div className="s violet">
        <div className="v">
          {pollSeconds}
          <small>s</small>
        </div>
        <div className="l">poll cycle</div>
      </div>
    </div>
  );
}
