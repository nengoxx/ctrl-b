import { Laptop, Moon, Network, Power, Radio, Server, Shield, Zap } from "lucide-react";
import type { Host, Service } from "../types/models";
import { StatusPill } from "./StatusPill";

type Props = {
  hosts: Host[];
  services: Service[];
  selectedHostId: string;
  onSelectHost: (hostId: string) => void;
  onWake: (hostId: string) => void;
  onShutdown: (hostId: string) => void;
  onPing: (hostId: string) => void;
};

export function HostList({
  hosts,
  services,
  selectedHostId,
  onSelectHost,
  onWake,
  onShutdown,
  onPing,
}: Props) {
  return (
    <section className="panel hosts-panel">
      <div className="panel-heading">
        <div>
          <h2>Hosts</h2>
          <p>LAN and tailnet reachability</p>
        </div>
      </div>

      <div className="host-list">
        {hosts.map((host) => {
          const hostServices = services.filter((service) => service.hostId === host.id);
          const runningServices = hostServices.filter((service) => service.status === "running").length;
          const HostIcon = host.os === "windows" ? Laptop : Server;

          return (
            <article
              className={selectedHostId === host.id ? "host-row selected" : "host-row"}
              key={host.id}
              onClick={() => onSelectHost(host.id)}
            >
              <button
                className="host-main"
                onClick={() => onSelectHost(host.id)}
                type="button"
              >
                <span className="host-icon">
                  <HostIcon size={18} />
                </span>
                <span className="host-copy">
                  <strong>{host.name}</strong>
                  <span>{host.os} / {runningServices}/{hostServices.length} services</span>
                </span>
              </button>

              <div className="host-meta">
                <StatusPill status={host.status} />
                <span className="address">
                  <Network size={14} />
                  {host.tailnetName}
                </span>
                <span className="address muted">{host.lanAddress}</span>
                <span className="address muted">
                  <Shield size={14} />
                  {host.lastSeen}
                </span>
              </div>

              <div className="host-load" aria-label={`${host.name} load ${host.load}%`}>
                <span style={{ width: `${host.load}%` }} />
              </div>

              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                <button className="subtle-action" onClick={() => onPing(host.id)} type="button">
                  <Radio size={15} />
                  Ping
                </button>
                <button
                  className="subtle-action"
                  disabled={host.status === "online" || host.status === "starting"}
                  onClick={() => onWake(host.id)}
                  type="button"
                >
                  <Zap size={15} />
                  Wake
                </button>
                <button
                  className="subtle-action danger-text"
                  disabled={host.status !== "online"}
                  onClick={() => onShutdown(host.id)}
                  type="button"
                >
                  {host.status === "sleeping" ? <Moon size={15} /> : <Power size={15} />}
                  Shutdown
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
