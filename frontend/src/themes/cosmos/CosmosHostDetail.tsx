import type { FleetAction } from "../../hooks/useActions";
import { hostDetailFacts } from "../../lib/hostDetail";
import { rebaseServiceUrl, serviceBase } from "../../lib/serviceBase";
import type { Host, Service } from "../../types";
import { assignBanners } from "./serviceBanners";

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
  // Step to the prev (-1) / next (+1) planet WITHOUT closing the sheet (the same select path a tap-another-
  // planet swap uses). OPTIONAL — omit it (or a single-planet fleet) and the chevrons don't render, keeping
  // the component pure + backward-compatible. CosmosFleet wires it to stepId(hosts) over the LIVE selection.
  onStep?: (dir: 1 | -1) => void;
}

// "Alive / time-alive" (uptime) is DEFERRED — the backend doesn't collect boot time yet; the slot shows "—"
// and is wired so it becomes additive later (COSMOS_HANDOFF §10.4 / memory cosmos-uptime-deferred).
const ALIVE_PLACEHOLDER = "—";

// Action-bar icons — inline SVG (cosmos uses no icon lib; the whole theme draws inline, like the prototype).
// 24-viewBox, 2px round stroke, currentColor so each button's color drives the glyph. Power doubles for
// Wake (accent) and Shut down (danger) — same universal on/off glyph, disambiguated by color + context.
const ICON = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const IconPower = () => (
  <svg {...ICON} aria-hidden>
    <path d="M12 2v10" />
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
  </svg>
);
const IconReboot = () => (
  <svg {...ICON} aria-hidden>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);
const IconPing = () => (
  <svg {...ICON} aria-hidden>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
// Planet-switcher chevrons flanking the name — thin clean glyphs (NOT filled arrows), tuned for the sheet's
// dot-grid card. Larger than the action icons so they read as a control at the header scale.
const CHEV = { ...ICON, width: 24, height: 24 } as const; // owner-tuned 20→24 (2026-07-15)
const IconChevLeft = () => (
  <svg {...CHEV} aria-hidden>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const IconChevRight = () => (
  <svg {...CHEV} aria-hidden>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export function CosmosHostDetail({ host, services, busy, run, titleId, onStep }: Props) {
  // The values every theme's detail sheet derives the same way (council M6) — shared in lib/hostDetail.ts.
  // Cosmos reads `lastSeen` rather than the shared `seen`, because its ONLINE branch shows the deferred
  // uptime placeholder where frontier shows "now" — a real difference between the two sheets, kept.
  const { online, ping, lastSeen, ratio: svcCount } = hostDetailFacts(host, services);

  // Online → "alive" (uptime, deferred → "—"); offline → last seen. Shown next to the status, no caption.
  const aliveOrSeen = online ? ALIVE_PLACEHOLDER : lastSeen;
  // Distinct decorative banner per service (de-duped within this host so it never repeats — see assignBanners).
  const banners = assignBanners(services.map((s) => s.id));

  return (
    <div className="cosmos-hd">
      {/* data-bs-peek: the PEEK detent ends here — the sheet opens showing the name + this compact info
          (status · alive/seen · services, then the id line); drag-up reveals the actions + services. */}
      <div className="hd-head" data-bs-peek>
        {/* Name row: prev-chevron · name · next-chevron. The chevrons live INSIDE the [data-bs-peek] marker,
            so BottomSheet's applyInert — which inerts only the peek marker's FOLLOWING siblings — never
            inerts them: they're usable immediately at the peek detent. Rendered only when onStep is wired
            (a multi-planet fleet). */}
        <div className="hd-namerow">
          {onStep && (
            <button className="hd-chev" aria-label="Previous planet" onClick={() => onStep(-1)}>
              <IconChevLeft />
            </button>
          )}
          <h2 className="hd-name" id={titleId}>
            {host.name}
          </h2>
          {onStep && (
            <button className="hd-chev" aria-label="Next planet" onClick={() => onStep(1)}>
              <IconChevRight />
            </button>
          )}
        </div>
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
          {host.vpn_host ? <span>{host.vpn_host}</span> : null}
          <span>{host.mac ?? "—"}</span>
        </div>
      </div>

      {/* action bar — Wake when offline; Reboot + Shutdown when online; Ping always. The PRIMARY action (Wake /
          Reboot) is the glowing accent pill; Shut down is a danger ghost; Ping a quiet ghost. The typed-action
          `run` handles the confirm dialog (shutdown/reboot) + optimistic flips + toasts; `busy` disables it. */}
      <div className="hd-actions">
        {online ? (
          <>
            <button className="hd-act primary" disabled={busy} onClick={() => run("reboot", host)}>
              <IconReboot />
              Reboot
            </button>
            <button
              className="hd-act danger icon-only"
              aria-label="Shut down"
              disabled={busy}
              onClick={() => run("shutdown", host)}
            >
              <IconPower />
            </button>
          </>
        ) : (
          <button className="hd-act primary" disabled={busy} onClick={() => run("wake", host)}>
            <IconPower />
            Wake
          </button>
        )}
        <button className="hd-act" disabled={busy} onClick={() => run("ping", host)}>
          <IconPing />
          Ping
        </button>
      </div>

      {/* a soft hairline (≈70% width, fades at both ends) separates the actions from the services — the old
          "Services / N up" header is dropped to compact this region (the up-count still shows in the glance). */}
      <div className="hd-sep" aria-hidden />
      <div className="hd-svcs">
        {services.length === 0 ? (
          <div className="hd-svc-empty">No services on this world</div>
        ) : (
          services.map((s) => {
            const svcOn = !!s.status?.online;
            const addr = `${host.name}:${s.port ?? "—"}`;
            const bannerUrl = banners.get(s.id);
            const bannerStyle = bannerUrl
              ? { ["--svc-banner" as string]: `url(${bannerUrl})` }
              : undefined;
            return svcOn && s.url ? (
              <a
                key={s.id}
                className="hd-svc on"
                href={rebaseServiceUrl(s.url, serviceBase(host, window.location))}
                target="_blank"
                rel="noopener"
                style={bannerStyle}
              >
                <span className="led" aria-hidden />
                <span className="nm">
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
              <div
                key={s.id}
                className={"hd-svc" + (svcOn ? " on" : " off")}
                role="group"
                aria-label={`${s.name} ${addr} — ${svcOn ? "online" : "offline"}`}
                style={bannerStyle}
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
