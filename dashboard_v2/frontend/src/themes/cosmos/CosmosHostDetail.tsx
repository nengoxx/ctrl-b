import type { FleetAction } from "../../hooks/useActions";
import { relativeTime } from "../../lib/relativeTime";
import type { Host, Service } from "../../types";

// Cosmos host-detail sheet content (C3b) — rendered inside the shared <BottomSheet> (C3a). The host NAME is
// the dotted-glass hero (replaces the prototype's ping line-graph, owner directive), then a COMPACT meta grid
// (small, not big stat tiles), an action bar, and the services list. A PURE presentation of `useFleet` data:
// it takes the host + its services + the `run`/`busy` action handles from CosmosFleet — no data fetching, no
// store access. Cosmos-specific markup (D7/§10.1: each presentation owns its markup; the shared part is
// `useFleet` + the action chokepoint). The meta is a {label,value} ARRAY so future real telemetry (uptime/
// load/temp) slots in additively. Fields mirror the Kit's DeviceRow (IP/MAC/Last seen/Ping) + services.

interface Props {
  host: Host;
  services: Service[];
  busy: boolean; // host action in flight (disables the bar)
  run: (action: FleetAction, host: Host) => Promise<void>;
  titleId: string; // aria-labelledby target the sheet points at (the host name)
}

// "Alive / time-alive" (uptime) is DEFERRED — the backend doesn't collect boot time yet; the slot shows "—"
// and is wired so it becomes additive later (COSMOS_HANDOFF §10.4 / memory cosmos-uptime-deferred).
const ALIVE_PLACEHOLDER = "—";

export function CosmosHostDetail({ host, services, busy, run, titleId }: Props) {
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms ?? null;
  const upCount = services.filter((s) => s.status?.online).length;

  // Online → "alive" (uptime, deferred → "—"); offline → last seen. Shown next to the status, no caption.
  const aliveOrSeen = online ? ALIVE_PLACEHOLDER : relativeTime(host.status?.last_seen);
  const svcCount = services.length > 0 ? `${upCount}/${services.length}` : null;

  return (
    <div className="cosmos-hd">
      {/* data-bs-peek: the PEEK detent ends here — the sheet opens showing the name + this compact info
          (status · alive/seen · services, then the id line); drag-up reveals the actions + services. */}
      <div className="hd-head" data-bs-peek>
        <h2 className="hd-name" id={titleId}>
          {host.name}
        </h2>
        <div className="hd-row">
          <span className={"hd-status" + (online ? " on" : "")}>
            <span className="led" aria-hidden />
            <span className="t">
              {online ? "online" : "asleep"}
              {host.role ? ` · ${host.role}` : ""}
            </span>
          </span>
          <span className="hd-glance">
            <span>{aliveOrSeen}</span>
            {svcCount && <span>{svcCount}</span>}
          </span>
        </div>
        {/* ping · ip · mac — values only (no captions; the units/format make each self-evident), one muted line */}
        <div className="hd-ids">
          <span>{online && ping != null ? `${ping} ms` : "—"}</span>
          <span>{host.ip}</span>
          <span>{host.mac ?? "—"}</span>
        </div>
      </div>

      {/* action bar — Wake when offline; Reboot + Shutdown when online; Ping always. The typed-action `run`
          handles the confirm dialog (shutdown/reboot) + optimistic flips + toasts; `busy` disables the bar. */}
      <div className="hd-actions">
        {online ? (
          <>
            <button className="hd-act" disabled={busy} onClick={() => run("reboot", host)}>
              Reboot
            </button>
            <button className="hd-act danger" disabled={busy} onClick={() => run("shutdown", host)}>
              Shut down
            </button>
          </>
        ) : (
          <button className="hd-act wake" disabled={busy} onClick={() => run("wake", host)}>
            Wake
          </button>
        )}
        <button className="hd-act" disabled={busy} onClick={() => run("ping", host)}>
          Ping
        </button>
      </div>

      <div className="hd-svcs-head">
        <span>Services</span>
        <span className="grow" />
        {services.length > 0 && <span className="n">{upCount} up</span>}
      </div>
      <div className="hd-svcs">
        {services.length === 0 ? (
          <div className="hd-svc-empty">No services on this world</div>
        ) : (
          services.map((s) => {
            const svcOn = !!s.status?.online;
            const addr = `${host.name}:${s.port ?? "—"}`;
            return svcOn && s.url ? (
              <a key={s.id} className="hd-svc on" href={s.url} target="_blank" rel="noopener">
                <span className="led" aria-hidden />
                <span className="nm">
                  <span className="name">{s.name}</span>
                  <span className="addr">{addr}</span>
                </span>
                <span className="arrow" aria-hidden>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17 17 7M9 7h8v8" />
                  </svg>
                </span>
              </a>
            ) : (
              <div
                key={s.id}
                className={"hd-svc" + (svcOn ? " on" : " off")}
                aria-label={`${s.name} ${addr} — ${svcOn ? "online" : "offline"}`}
              >
                <span className="led" aria-hidden />
                <span className="nm">
                  <span className="name">{s.name}</span>
                  <span className="addr">{addr}</span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
