import { memo } from "react";

import type { Host } from "../../types";
import { SKY_INNER_HTML } from "./heroScene";
import { Waveform } from "./Waveform";

// The hero: animated scene (sun/grid/skyline) + the "now monitoring" panel for the featured
// host + the live waveform + the carousel dots. Ported from vapor.html's .hero + renderNow().

// Sky is content-free (decorative SVG only) — memoized so the featured-cycle re-render of
// <Hero> never reconciles the sun/skyline subtree. The sun's `float` animation runs on the
// compositor; keeping its container out of every render avoids competing with the main
// thread when the rest of the hero updates.
const Sky = memo(function Sky() {
  return (
    <>
      <div className="sky" dangerouslySetInnerHTML={{ __html: SKY_INNER_HTML }} />
      <div className="grid" />
      <div className="horizon" />
    </>
  );
});

interface Props {
  hosts: Host[];
  featured: number;
  onFeature: (i: number) => void;
  heroOn: boolean;
  waveformOn: boolean;
}

function macParts(mac: string | null): { head: string; tail: string } {
  if (!mac) return { head: "—", tail: "" };
  const segs = mac.split(":");
  return { head: segs[0] ?? mac, tail: segs.slice(-2).join(":") };
}

function subnetOf(ip: string): string {
  const octets = ip.split(".");
  return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.0/24` : ip;
}

// The "now monitoring" panel content. Memoized on PRIMITIVE props (Slice 2): a Hero re-render
// that didn't change any of these (e.g. a UI store change that flipped heroOn but kept the
// featured host) bails out shallow-equal — no DOM diff for the stats subtree. Across polls only
// the values that actually changed (usually just `ping`) drive a re-render.
interface NowPanelProps {
  subnet: string;
  name: string;
  role: string;
  online: boolean;
  ping: number | null;
  macHead: string;
  macTail: string;
  sshPort: number;
  sshUser: string;
  waveformOn: boolean;
}
const NowPanel = memo(function NowPanel({
  subnet,
  name,
  role,
  online,
  ping,
  macHead,
  macTail,
  sshPort,
  sshUser,
  waveformOn,
}: NowPanelProps) {
  return (
    <>
      <div className="eyebrow">// now monitoring · {subnet}</div>
      <div className="row">
        <div>
          <div className="name" id="now-name">
            {name}
          </div>
          <div className="role" id="now-role">
            {role}
          </div>
        </div>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="v">
            {online && ping != null ? (
              <>
                {ping}
                <small>ms</small>
              </>
            ) : (
              <>
                —<small> ms</small>
              </>
            )}
          </div>
          <div className="l">ping</div>
        </div>
        <div className="stat">
          <div className="v">{online ? "live" : "—"}</div>
          <div className="l">last seen</div>
        </div>
        <div className="stat">
          <div className="v mac">
            {macHead}
            <small>…</small>
            {macTail}
          </div>
          <div className="l">mac</div>
        </div>
        <div className="stat">
          <div className="v">
            :{sshPort}
            <small> {sshUser}</small>
          </div>
          <div className="l">ssh</div>
        </div>
      </div>
      {waveformOn && <Waveform online={online} ping={ping} />}
    </>
  );
});

export function Hero({ hosts, featured, onFeature, heroOn, waveformOn }: Props) {
  const host = hosts[featured];
  const online = !!host?.status?.online;
  const ping = host?.status?.ping_ms ?? null;
  const mac = macParts(host?.mac ?? null);

  return (
    <div className="hero">
      {heroOn && <Sky />}
      <div className="now">
        <NowPanel
          subnet={host ? subnetOf(host.ip) : "—"}
          name={host?.name ?? "—"}
          role={host ? `${host.os_type} · ${host.ip}` : "no hosts configured"}
          online={online}
          ping={ping}
          macHead={mac.head}
          macTail={mac.tail}
          sshPort={host?.ssh_port ?? 22}
          sshUser={host?.ssh_username ?? ""}
          waveformOn={waveformOn}
        />
        {/* F14 — each dot is a real <button> so keyboard tab reaches it. role="tab"
            + aria-selected gives screen readers the carousel-selector semantic. */}
        <div className="now-dots" id="now-dots" role="tablist" aria-label="featured host">
          {hosts.map((h, i) => (
            <button
              key={h.id}
              type="button"
              role="tab"
              aria-selected={i === featured}
              aria-label={`feature ${h.name}`}
              className={i === featured ? "active" : ""}
              onClick={() => onFeature(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
