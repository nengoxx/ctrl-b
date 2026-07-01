import type { MouseEvent } from "react";

import { useFleet } from "../../hooks/useFleet";
import { relativeTime } from "../../lib/relativeTime";
import type { Host, Service } from "../../types";

// Kit Fleet view (D29 §14.4) — the standard device-list Fleet for reskin themes (minimal now; phosphor/
// observatory-list later), so DefaultRoot defaults its Fleet section to this. A PURE CONSUMER of the
// headless `useFleet` controller (hosts/services/featured/open + wake/stop actions via the typed-action
// `run`) — no new data logic, no store bypass. Deliberately minimal: a device list + a 3-stat summary,
// REAL host fields only (ping / last-seen / mac / services), NO Hero, NO now-monitoring card, NO waveform.

/** Action-button clicks must not also toggle the row's expand. */
function act(e: MouseEvent, fn: () => void) {
  e.stopPropagation();
  fn();
}

interface Props {
  active: boolean;
}

export function KitFleet({ active }: Props) {
  const { hosts, svcByHost, open, isLoading, error, busy, run, toggleRow } = useFleet();

  // Summary stats — all derived from real data (no mock uptime/cpu/temp).
  const total = hosts.length;
  const awake = hosts.filter((h) => h.status?.online).length;
  const pings = hosts.map((h) => h.status?.ping_ms).filter((p): p is number => p != null);
  const avgPing = pings.length
    ? (pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(1)
    : null;
  const allSvc = hosts.flatMap((h) => svcByHost.get(h.id) ?? []);
  const svcUp = allSvc.filter((s) => s.status?.online).length;

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 Fleet"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      <div className="kit-sec">
        <span className="t">Fleet</span>
        <span className="grow" />
        <span className="hint">{isLoading ? "polling…" : "tap for services"}</span>
      </div>

      <div className="kit-wrap">
        <div className="kit-devices">
          {error && <div className="kit-empty">backend unreachable — {error.message}</div>}
          {!error && !total && !isLoading && (
            <div className="kit-empty">no hosts in config.yaml</div>
          )}
          {hosts.map((h, i) => (
            <DeviceRow
              key={h.id}
              host={h}
              services={svcByHost.get(h.id) ?? []}
              open={open.has(h.id)}
              busy={busy.has(h.id)}
              onToggle={() => toggleRow(h.id, i)}
              onWake={() => run("wake", h)}
              onStop={() => run("shutdown", h)}
            />
          ))}
        </div>

        {total > 0 && (
          <div className="kit-summary">
            <div className="s">
              <div className="v">
                {awake}
                <small>/{total}</small>
              </div>
              <div className="l">Awake</div>
            </div>
            <div className="s">
              <div className="v">
                {avgPing ?? "—"}
                {avgPing && <small>ms</small>}
              </div>
              <div className="l">Avg ping</div>
            </div>
            <div className="s">
              <div className="v">
                {svcUp}
                <small>/{allSvc.length}</small>
              </div>
              <div className="l">Services up</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}

interface RowProps {
  host: Host;
  services: Service[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onWake: () => void;
  onStop: () => void;
}

function DeviceRow({ host, services, open, busy, onToggle, onWake, onStop }: RowProps) {
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms ?? null;
  const svcCount = services.length ? ` · ${services.length} svc` : "";
  // role · os (+ svc); "dormant" only when offline. Ping moved to the expanded meta (next to Last seen);
  // the LED conveys online at a glance, so the collapsed subtitle no longer carries it. Null role drops out.
  const sub =
    [host.role, host.os_type, online ? null : "dormant"].filter(Boolean).join(" · ") + svcCount;

  return (
    <div
      className={
        "kit-device " + (online ? "on" : "off") + (open ? " open" : "") + (busy ? " busy" : "")
      }
      data-name={host.name}
    >
      {/* div+onClick (not a button) so the inner action/chevron buttons aren't nested-interactive. */}
      <div className="row1" onClick={onToggle}>
        <span className="led" />
        <span className="nm">
          <span className="name">{host.name}</span>
          <span className="role">{sub}</span>
        </span>
        {online ? (
          <button
            className="act stop"
            aria-label={`shut down ${host.name}`}
            disabled={busy}
            onClick={(e) => act(e, onStop)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3v9" />
              <path d="M6.4 7.4a8 8 0 1 0 11.2 0" />
            </svg>
          </button>
        ) : (
          <button
            className="act wake"
            aria-label={`wake ${host.name}`}
            disabled={busy}
            onClick={(e) => act(e, onWake)}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="chev"
          aria-expanded={open}
          aria-label={`${open ? "collapse" : "expand"} ${host.name} details`}
          onClick={(e) => act(e, onToggle)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="body">
          <div className="meta">
            <span className="k">IP</span>
            <span className="v">{host.ip}</span>
            <span className="k">MAC</span>
            <span className="v">{host.mac ?? "—"}</span>
            <span className="k">Last seen</span>
            <span className="v">{online ? "now" : relativeTime(host.status?.last_seen)}</span>
            <span className="k">Ping</span>
            <span className="v">{online && ping != null ? `${ping} ms` : "—"}</span>
          </div>
          <div className="svcs">
            {services.length === 0 ? (
              <div className="no-svc">No services on this machine</div>
            ) : (
              services.map((s) => {
                const svcOn = !!s.status?.online;
                const addr = `${host.name}:${s.port ?? "—"}`;
                return svcOn && s.url ? (
                  <a
                    key={s.id}
                    className="srow on"
                    href={s.url}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="led" />
                    <span className="nm2">
                      <span className="name">{s.name}</span>
                      <span className="addr">{addr}</span>
                    </span>
                    <span className="arrow" aria-hidden>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </span>
                  </a>
                ) : (
                  <div key={s.id} className="srow off" aria-label={`${s.name} ${addr} — offline`}>
                    <span className="led" />
                    <span className="nm2">
                      <span className="name">{s.name}</span>
                      <span className="addr">{addr}</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
