import { memo, type MouseEvent } from "react";

import type { FleetAction } from "../../hooks/useActions";
import { rebaseServiceUrl, serviceBase } from "../../lib/serviceBase";
import type { Host, Service } from "../../types";

// One fleet row + its expandable dropdown (services + kv detail + wake/stop buttons), ported from
// vapor.html renderDevices(). Phase 3 fills the dropdown's service list: each service is the
// Vapor `.svc-row` (led + name + host:port addr + ↗/— arrow linking to the service URL when up),
// falling back to the "no services declared" empty state. Phase 2 wires the wake/stop/ping
// buttons to real actions via `onAction`; `busy` drives the ◐ spinner (.dev.busy .sub::after).

const EQ_ON = [8, 16, 22, 12, 20, 10, 18, 14];
//: A pre-sliced view of EQ_ON for the online row (which has wake+reboot+shutdown sharing the
//  row width, so the eq is trimmed to 5 bars). Hoisted as a module constant so each row render
//  doesn't allocate a fresh array.
const EQ_ON_TRIMMED = EQ_ON.slice(0, 5);

interface Props {
  host: Host;
  services: Service[];
  index: number;
  featured: boolean;
  open: boolean;
  busy: boolean;
  // Host-PARAMETERIZED (not pre-bound to this row) so FleetTab can pass the controller's stable `toggleRow`
  // / `run` refs directly — a per-row `() => toggleRow(id, i)` closure would be a fresh prop each render and
  // defeat `memo`. The row supplies its own host/index back to the callback (see `toggle`/`invoke` below).
  onToggle: (id: string, index: number) => void;
  onAction: (action: FleetAction, host: Host) => void;
}

/** Stop an action-button click from also toggling the row (belt-and-braces; the toggle is now the
 *  chevron button, a sibling of the action buttons, so a click no longer bubbles into it anyway). */
function act(e: MouseEvent, fn: () => void) {
  e.stopPropagation();
  fn();
}

function DeviceRowImpl({ host, services, index, featured, open, busy, onToggle, onAction }: Props) {
  // Re-bind the host-parameterized callbacks to THIS row. These closures are recreated each render, but
  // they're only handed to DOM elements (not memoized children), so their identity is irrelevant to perf —
  // the memo barrier is on `DeviceRow`'s incoming props, which stay stable.
  const toggle = () => onToggle(host.id, index);
  const invoke = (action: FleetAction) => onAction(action, host);
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms ?? null;
  // Vantage-aware base for OUTBOUND links (D3 slice 2): over a VPN origin the LAN ip may be
  // unreachable, so links prefer vpn_host. Display strings below stay on `ip` (that's the LAN fact).
  const base = serviceBase(host, window.location);
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
      {/* D25 — the row header is a plain `<div onClick>` (a div with a click handler is NOT a
          "button containing buttons", so it sidesteps the old nested-interactive without losing the
          tap-anywhere-to-toggle behavior). Keyboard operability comes from the chevron `<button>` below;
          the action buttons stop propagation so they act without toggling. */}
      <div className="top" onClick={toggle}>
        <span className="led" />
        <div className="info">
          <div className="name">{host.name}</div>
          <div className="sub">{sub}</div>
        </div>
        <div className="eq">
          {/* Online shows TWO action buttons (reboot + shutdown), so trim the bars to make room;
              offline (wake only) keeps the full set. */}
          {(online ? EQ_ON_TRIMMED : EQ_ON).map((h, i) =>
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
              onClick={(e) => act(e, () => invoke("reboot"))}
            />
            <button
              className="act stop"
              data-act="shutdown"
              aria-label={`shutdown ${host.name}`}
              disabled={busy}
              onClick={(e) => act(e, () => invoke("shutdown"))}
            />
          </div>
        ) : (
          <button
            className="act wake"
            data-act="wake"
            aria-label={`wake ${host.name}`}
            disabled={busy}
            onClick={(e) => act(e, () => invoke("wake"))}
          />
        )}
        <button
          type="button"
          className="chev"
          aria-expanded={open}
          aria-label={`${open ? "collapse" : "expand"} ${host.name} details`}
          onClick={(e) => act(e, toggle)}
        >
          ›
        </button>
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
                href={rebaseServiceUrl(s.url, base)}
                target="_blank"
                rel="noopener"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="led" />
                <div className="info">
                  <div className="name">{s.name}</div>
                  <div className="addr">{addr}</div>
                </div>
                <span className="arrow" aria-hidden>
                  ↗
                </span>
              </a>
            ) : (
              // F27: the offline state is visual-only (faded + dash); an aria-label gives screen
              // readers the cue the online row gets from being a link. Low-pri, single-line.
              // A3 (F5 Gate A): role="group" makes the labelled roleless div reliably announced (AT
              // skips aria-label on a plain <div>); the "— offline" text conveys state without color.
              <div
                key={s.id}
                className="svc-row off"
                role="group"
                aria-label={`${s.name} ${addr} — offline`}
              >
                <span className="led" />
                <div className="info">
                  <div className="name">{s.name}</div>
                  <div className="addr">{addr}</div>
                </div>
                <span className="arrow" aria-hidden>
                  —
                </span>
              </div>
            );
          })
        )}
        <div className="details">
          <div className="kvgrid">
            <div className="k">ip</div>
            <div className="v">{host.ip}</div>
            {host.vpn_host ? (
              <>
                <div className="k">vpn</div>
                <div className="v">{host.vpn_host}</div>
              </>
            ) : null}
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
          <button onClick={(e) => act(e, () => invoke("ping"))}>$ ping</button>
          <button onClick={(e) => e.stopPropagation()}>› ssh</button>
          {online ? (
            <a
              className="open"
              href={`http://${base}`}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
            >
              ↗ http://{base}
            </a>
          ) : (
            <button disabled={busy} onClick={(e) => act(e, () => invoke("wake"))}>
              wake
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// memo barrier — re-renders only when THIS row's data changes. The fleet poll / featured-cycle re-renders
// FleetTab (new `featured`, maybe new host objects), but a row whose host/services/open/busy/featured are
// reference-equal bails. Effective because: the callbacks are stable controller refs, `services` is the
// memoized per-host array (useFleet), and `featured`/`open`/`busy` resolve to primitives in FleetTab.
export const DeviceRow = memo(DeviceRowImpl);
