import type { FleetAction } from "../../hooks/useActions";
import { hostDetailFacts } from "../../lib/hostDetail";
import { rebaseServiceUrl, serviceBase } from "../../lib/serviceBase";
import { ServiceIcon } from "../../theme-engine/kit/ServiceIcon";
import type { Host, Service } from "../../types";

// Frontier host-detail sheet content (F3) — rendered inside the shared <BottomSheet> (the C3 primitive cosmos
// pioneered; frontier reuses it). Ports the prototype's `renderSheet` markup faithfully: an art BANNER hero
// (the same rig image + license plate the map card shows), an honest 4-up stat grid, an action bar, and the
// per-service list. A PURE presentation of `useFleet` data (cosmos's C3b shape): it takes the host + its
// services + the rig art/plate + the `run`/`busy` action handles from FrontierFleet — NO data fetching, no
// store access. Frontier-specific markup (D7/§10.1: each presentation owns its markup; the shared part is
// `useFleet` + the action chokepoint). Richer than the prototype's host-level up/down — services carry their
// OWN status here (the prototype only knew the host's state).

interface Props {
  host: Host;
  services: Service[];
  art: string; // the rig art URL — the SAME asset the map/grid card shows (passed from FrontierFleet's placement)
  plate: string; // the license plate — the SAME as the card
  busy: boolean; // host action in flight (disables the bar)
  run: (action: FleetAction, host: Host) => Promise<void>;
  titleId: string; // aria-labelledby target the sheet points at (the host name in the banner)
}

// "Uptime" is DEFERRED — the backend doesn't collect boot time yet, so the tile shows "—" and is wired to
// become additive later (the cosmos ALIVE_PLACEHOLDER precedent / memory cosmos-uptime-deferred). The
// prototype's Load/Temp tiles are dropped entirely (owner ruling): no backend seam feeds them, so an honest
// grid shows Ping/Uptime/Services/Seen instead of inventing numbers.
const UPTIME_PLACEHOLDER = "—";

// Action-bar / service icons — inline SVG (frontier uses no icon lib; the whole theme draws inline, like the
// prototype). 24-viewBox, 2.4 round stroke, currentColor so each button's color drives the glyph (the
// prototype's own icon style). Power is the Wake glyph; Reboot reuses the circular-arrows glyph (from
// CosmosHostDetail's IconReboot), the universal restart mark.
const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const IconPower = () => (
  <svg width={13} height={13} {...ICON} aria-hidden>
    <path d="M12 3v9M6.5 7a8 8 0 1 0 11 0" />
  </svg>
);
const IconReboot = () => (
  <svg width={13} height={13} {...ICON} aria-hidden>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);
const IconArrow = () => (
  <svg width={11} height={11} {...ICON} aria-hidden>
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
);

export function FrontierHostDetail({ host, services, art, plate, busy, run, titleId }: Props) {
  // The values every theme's detail sheet derives the same way (council M6) — shared in lib/hostDetail.ts;
  // frontier's own WORDING (the meta tail, the services heading) composes from them right here.
  const { online, ping, ratio, seen } = hostDetailFacts(host, services);

  // Meta line — role · ip, then a live tail: online adds the ping (only when a value exists); offline reads as
  // WOL-ready when the host has a MAC to wake it, else powered down. Segments joined by " · " (prototype .ro2).
  const meta = [host.role ?? host.os_type, host.ip];
  if (host.vpn_host) meta.push(host.vpn_host); // D3 slice 2 — the VPN/overlay address, next to the LAN ip
  if (online) {
    if (ping != null) meta.push(`${ping} ms`);
  } else {
    meta.push(host.mac ? "wake-on-LAN ready" : "powered down");
  }

  // The services-section heading text (owner eyeball r4: re-homed off the action bar so the pills align as one
  // tidy row): honest service tally when online, the WOL/power state when asleep.
  const info = online
    ? ratio
      ? `${ratio} services up`
      : "no services parked"
    : host.mac
      ? "Powered down · WOL armed"
      : "Powered down";

  return (
    <div className="frontier-hd">
      {/* data-bs-peek: the PEEK detent ends here — the sheet opens showing the banner (name/status/plate) + the
          meta line; drag-up reveals the stats, actions + services. */}
      <div data-bs-peek>
        <div className={"banner" + (online ? "" : " dim")}>
          <div className="img" style={{ backgroundImage: `url(${art})` }} />
          <div className="ov" />
          <div className={"stat" + (online ? "" : " off")}>
            <span className="led" aria-hidden />
            {online ? "Online" : "Dormant"}
          </div>
          <h2 className="nm" id={titleId}>
            {host.name}
          </h2>
          <div className="plate">{plate}</div>
        </div>
        <div className="ro2">{meta.join(" · ")}</div>
      </div>

      {/* Honest 4-up stat grid (owner ruling): Ping + Services + Seen are real; Uptime awaits a backend seam. */}
      <div className="stats">
        <div className="stat4">
          <div className="v">
            {online && ping != null ? ping : "—"}
            {online && ping != null && <small>ms</small>}
          </div>
          <div className="l">Ping</div>
        </div>
        <div className="stat4">
          <div className="v">{UPTIME_PLACEHOLDER}</div>
          <div className="l">Uptime</div>
        </div>
        <div className="stat4">
          <div className="v">{ratio ?? "—"}</div>
          <div className="l">Services</div>
        </div>
        <div className="stat4">
          <div className="v">{seen}</div>
          <div className="l">Seen</div>
        </div>
      </div>

      {/* Action bar — Reboot + Shut down when online, Wake rig when asleep. The typed-action `run` handles the
          confirm dialog (shutdown/reboot) + optimistic flips + toasts; `busy` disables the bar (the prototype's
          `.busy` dim is keyed off :disabled in CSS — the class is carried for prototype parity). */}
      <div className="actbar">
        {online ? (
          <>
            <button
              className={"pill wake" + (busy ? " busy" : "")}
              disabled={busy}
              onClick={() => run("reboot", host)}
            >
              <IconReboot />
              Reboot
            </button>
            <button
              className={"pill stop" + (busy ? " busy" : "")}
              disabled={busy}
              onClick={() => run("shutdown", host)}
            >
              Shut down
            </button>
          </>
        ) : (
          <button
            className={"pill wake" + (busy ? " busy" : "")}
            disabled={busy}
            onClick={() => run("wake", host)}
          >
            <IconPower />
            Wake rig
          </button>
        )}
      </div>

      {/* The section heading carries the honest summary (owner eyeball r4): the old "Services on {host.name}"
          caption + the action-bar `.info` line were duplicate captions — one heading now, the `info` string. */}
      <div className="svc-h">{info}</div>
      <div className="svcs">
        {services.length === 0 ? (
          <div className="svc-empty">No services parked on this rig</div>
        ) : (
          services.map((s) => {
            const svcOn = !!s.status?.online;
            const addr = `${host.ip}:${s.port ?? "—"}`;
            return svcOn && s.url ? (
              <a
                key={s.id}
                className="svc up"
                href={rebaseServiceUrl(s.url, serviceBase(host, window.location))}
                target="_blank"
                rel="noopener"
              >
                <span className="led" aria-hidden />
                {/* The owner's icon for this service (D53 M3) — nothing at all when they have dropped
                    none, which is every fresh install. */}
                <ServiceIcon service={s} />
                <span className="info">
                  <span className="nm">{s.name}</span>
                  <span className="ad">{addr}</span>
                </span>
                <span className="go">
                  Open
                  <IconArrow />
                </span>
              </a>
            ) : (
              <div
                key={s.id}
                className={"svc" + (svcOn ? " up" : " down")}
                role="group"
                aria-label={`${s.name} ${addr} — ${svcOn ? "online" : "offline"}`}
              >
                <span className="led" aria-hidden />
                <ServiceIcon service={s} />
                <span className="info">
                  <span className="nm">{s.name}</span>
                  <span className="ad">{addr}</span>
                </span>
                {!svcOn && <span className="go">Offline</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
