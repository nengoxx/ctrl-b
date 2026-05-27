import { SKY_INNER_HTML } from "../theme/heroScene";
import type { Host } from "../types";
import { Waveform } from "./Waveform";

// The hero: animated scene (sun/grid/skyline) + the "now monitoring" panel for the featured
// host + the live waveform + the carousel dots. Ported from vapor.html's .hero + renderNow().

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

export function Hero({ hosts, featured, onFeature, heroOn, waveformOn }: Props) {
  const host = hosts[featured];
  const online = !!host?.status?.online;
  const ping = host?.status?.ping_ms ?? null;
  const mac = macParts(host?.mac ?? null);

  return (
    <div className="hero">
      {heroOn && (
        <>
          <div className="sky" dangerouslySetInnerHTML={{ __html: SKY_INNER_HTML }} />
          <div className="grid" />
          <div className="horizon" />
        </>
      )}
      <div className="now">
        <div className="eyebrow">// now monitoring · {host ? subnetOf(host.ip) : "—"}</div>
        <div className="row">
          <div>
            <div className="name" id="now-name">
              {host?.name ?? "—"}
            </div>
            <div className="role" id="now-role">
              {host ? `${host.os_type} · ${host.ip}` : "no hosts configured"}
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
              {mac.head}
              <small>…</small>
              {mac.tail}
            </div>
            <div className="l">mac</div>
          </div>
          <div className="stat">
            <div className="v">
              :{host?.ssh_port ?? 22}
              <small> {host?.ssh_username ?? ""}</small>
            </div>
            <div className="l">ssh</div>
          </div>
        </div>
        {waveformOn && <Waveform online={online} ping={ping} />}
        <div className="now-dots" id="now-dots">
          {hosts.map((h, i) => (
            <div
              key={h.id}
              className={i === featured ? "active" : ""}
              onClick={() => onFeature(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
