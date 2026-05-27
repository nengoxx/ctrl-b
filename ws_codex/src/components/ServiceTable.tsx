import { ExternalLink, Filter, RotateCw, Square } from "lucide-react";
import type { Host, Service } from "../types/models";
import { StatusPill } from "./StatusPill";

type Props = {
  hosts: Host[];
  services: Service[];
  selectedHostId: string;
  selectedProject: string;
  onProjectChange: (project: string) => void;
  onRestart: (serviceId: string) => void;
  onStop: (serviceId: string) => void;
  onOpen: (serviceId: string) => void;
};

export function ServiceTable({
  hosts,
  services,
  selectedHostId,
  selectedProject,
  onProjectChange,
  onRestart,
  onStop,
  onOpen,
}: Props) {
  const projects = ["All", ...Array.from(new Set(services.map((service) => service.project)))];
  const hostName = (hostId: string) => hosts.find((host) => host.id === hostId)?.name ?? hostId;

  return (
    <section className="panel services-panel">
      <div className="panel-heading">
        <div>
          <h2>Services</h2>
          <p>{selectedHostId === "all" ? "All configured services" : `Filtered to ${hostName(selectedHostId)}`}</p>
        </div>
        <div className="filter-row" aria-label="Service project filter">
          <Filter size={15} />
          {projects.map((project) => (
            <button
              className={project === selectedProject ? "filter-chip active" : "filter-chip"}
              key={project}
              onClick={() => onProjectChange(project)}
              type="button"
            >
              {project}
            </button>
          ))}
        </div>
      </div>

      <div className="service-table" role="table" aria-label="Services">
        <div className="service-head" role="row">
          <span>Name</span>
          <span>Host</span>
          <span>Status</span>
          <span>Port</span>
          <span>Load</span>
          <span>Actions</span>
        </div>

        {services.map((service) => (
          <article className="service-row" key={service.id} role="row">
            <div className="service-name">
              <strong>{service.name}</strong>
              <span>{service.description}</span>
            </div>
            <span>{hostName(service.hostId)}</span>
            <span>
              <StatusPill status={service.status} />
            </span>
            <span>{service.port > 0 ? service.port : "local"}</span>
            <span className="load-pair">{service.cpu}% / {service.memory}%</span>
            <span className="table-actions">
              <button className="icon-button small" onClick={() => onOpen(service.id)} title="Open mock URL" type="button">
                <ExternalLink size={15} />
              </button>
              <button
                className="icon-button small"
                disabled={service.status === "starting"}
                onClick={() => onRestart(service.id)}
                title="Restart service"
                type="button"
              >
                <RotateCw size={15} />
              </button>
              <button
                className="icon-button small danger-text"
                disabled={service.status === "stopped"}
                onClick={() => onStop(service.id)}
                title="Stop service"
                type="button"
              >
                <Square size={14} />
              </button>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
