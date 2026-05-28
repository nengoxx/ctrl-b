import type { MouseEvent } from "react";

import type { FleetAction } from "../hooks/useActions";
import type { Host, Service } from "../types";

// One fleet row + its expandable dropdown (services + kv detail + wake/stop buttons), ported from
// vapor.html renderDevices(). Phase 3 fills the dropdown's service list: each service is the
// Vapor `.svc-row` (led + name + host:port addr + ↗/— arrow linking to the service URL when up),
// falling back to the "no services declared" empty state. Phase 2 wires the wake/stop/ping
// buttons to real actions via `onAction`; `busy` drives the ◐ spinner (.dev.busy .sub::after).

const EQ_ON = [8, 16, 22, 12, 20, 10, 18, 14];

interface Props {
  host: Host;
  services: Service[];
  index: number;
  featured: boolean;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onAction: (action: FleetAction) => void;
}

/** Stop a button click from also toggling the row open/closed. */
function act(e: MouseEvent, fn: () => void) {
  e.stopPropagation();
  fn();
}

export function DeviceRow({ host, services, index, featured, open, busy, onToggle, onAction }: Props) {
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms ?? null;
  const svcCount = services.length ? ` · ${services.length} svc` : "";
  const sub = online
    ? `${host.os_type} · ${ping != null ? `${ping}ms` : "online"}${svcCount}`
    : `${host.os_type} · asleep${svcCount}`;

  return (
    <div
      className={
        "dev " +
        (online ? "on" : "off") +
        (featured ? " featured" : "") +
        (open ? " open" : "") +
        (busy ? " busy" : "")
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
          {/* Online shows TWO action buttons (reboot + shutdown), so trim the bars to make room;
              offline (wake only) keeps the full set. */}
          {(online ? EQ_ON.slice(0, 5) : EQ_ON).map((h, i) =>
            online ? <i key={i} style={{ height: `${h}px` }} /> : <i key={i} />,
          )}
        </div>
        {online ? (
          <div className="acts">
            <button
              className="act reboot"
              data-act="reboot"
              aria-label={`reboot ${host.name}`}
              disabled={busy}
              onClick={(e) => act(e, () => onAction("reboot"))}
            />
            <button
              className="act stop"
              data-act="shutdown"
              aria-label={`shutdown ${host.name}`}
              disabled={busy}
              onClick={(e) => act(e, () => onAction("shutdown"))}
            />
          </div>
        ) : (
          <button
            className="act wake"
            data-act="wake"
            aria-label={`wake ${host.name}`}
            disabled={busy}
            onClick={(e) => act(e, () => onAction("wake"))}
          />
        )}
        <span className="chev">›</span>
      </div>
      <div className="dropdown">
        {services.length === 0 ? (
          <div className="no-svc">// no services declared on this machine</div>
        ) : (
          services.map((s) => {
            const svcOn = !!s.status?.online;
            const addr = `${host.name}:${s.port ?? "—"}`;
            return svcOn && s.url ? (
              <a
                key={s.id}
                className="svc-row on"
                href={s.url}
                target="_blank"
                rel="noopener"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="led" />
                <div className="info">
                  <div className="name">{s.name}</div>
                  <div className="addr">{addr}</div>
                </div>
                <span className="arrow">↗</span>
              </a>
            ) : (
              <div key={s.id} className="svc-row off">
                <span className="led" />
                <div className="info">
                  <div className="name">{s.name}</div>
                  <div className="addr">{addr}</div>
                </div>
                <span className="arrow">—</span>
              </div>
            );
          })
        )}
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
          <button onClick={(e) => act(e, () => onAction("ping"))}>$ ping</button>
          <button onClick={(e) => e.stopPropagation()}>› ssh</button>
          {online ? (
            <a
              className="open"
              href={`http://${host.ip}`}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
            >
              ↗ http://{host.ip}
            </a>
          ) : (
            <button disabled={busy} onClick={(e) => act(e, () => onAction("wake"))}>
              wake
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
