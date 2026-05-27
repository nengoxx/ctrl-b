import type { HostStatus, ServiceStatus } from "../types/models";

type Props = {
  status: HostStatus | ServiceStatus;
};

const labels: Record<HostStatus | ServiceStatus, string> = {
  online: "Online",
  sleeping: "Sleeping",
  offline: "Offline",
  starting: "Starting",
  stopping: "Stopping",
  running: "Running",
  stopped: "Stopped",
  degraded: "Degraded",
};

export function StatusPill({ status }: Props) {
  return <span className={`status-pill status-${status}`}>{labels[status]}</span>;
}
