import type { MouseEvent } from "react";

import type { Host } from "../types";

// One fleet row + its expandable dropdown (kv detail + wake/stop buttons), ported from
// vapor.html renderDevices(). Services land in Phase 3 (shows the empty state until then);
// the wake/stop mask-icon buttons are rendered now but wired to real actions in Phase 2.

const EQ_ON = [8, 16, 22, 12, 20, 10, 18, 14];

interface Props {
  host: Host;
  index: number;
  featured: boolean;
  open: boolean;
  onToggle: () => void;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

export function DeviceRow({ host, index, featured, open, onToggle }: Props) {
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms ?? null;
  const sub = online ? `${host.os_type} · ${ping != null ? `${ping}ms` : "online"}` : `${host.os_type} · asleep`;

  return (
    <div
      className={
        "dev " +
        (online ? "on" : "off") +
        (featured ? " featured" : "") +
        (open ? " open" : "")
      }
      data-i={index}
      data-name={host.name}
    >
      <div className="top" onClick={onToggle}>
        <span className="led" />
        <div className="info">
          <div className="name">{host.name}</div>
          <div className="sub">{sub}</div>
        </div>
        <div className="eq">
          {EQ_ON.map((h, i) =>
            online ? <i key={i} style={{ height: `${h}px` }} /> : <i key={i} />,
          )}
        </div>
        {online ? (
          <button
            className="act stop"
            data-act="shutdown"
            aria-label={`shutdown ${host.name}`}
            onClick={stop}
          />
        ) : (
          <button
            className="act wake"
            data-act="wake"
            aria-label={`wake ${host.name}`}
            onClick={stop}
          />
        )}
        <span className="chev">›</span>
      </div>
      <div className="dropdown">
        <div className="no-svc">// no services declared on this machine</div>
        <div className="details">
          <div className="kvgrid">
            <div className="k">ip</div>
            <div className="v">{host.ip}</div>
            <div className="k">mac</div>
            <div className="v mac">{host.mac ?? "—"}</div>
            <div className="k">ssh</div>
            <div className="v">
              {host.ssh_username ? `${host.ssh_username}@${host.ip}:${host.ssh_port}` : "—"}
            </div>
            <div className="k">os</div>
            <div className={`v os-${host.os_type}`}>{host.os_type}</div>
          </div>
        </div>
        <div className="dropfoot">
          <button onClick={stop}>$ ping</button>
          <button onClick={stop}>› ssh</button>
          {online ? (
            <a
              className="open"
              href={`http://${host.ip}`}
              target="_blank"
              rel="noopener"
              onClick={stop}
            >
              ↗ http://{host.ip}
            </a>
          ) : (
            <button onClick={stop}>wake</button>
          )}
        </div>
      </div>
    </div>
  );
}
