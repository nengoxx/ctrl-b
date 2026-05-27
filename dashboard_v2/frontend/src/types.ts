// Mirror of the backend domain (DESIGN.md §2, §13). Phase 1 = fleet read path only.

export type OSType = "windows" | "linux" | "macos";

export interface HostStatus {
  host_id: string;
  online: boolean;
  ping_ms: number | null;
  last_seen: string | null; // ISO 8601 UTC
  checked_at: string;
  error: string | null;
}

export interface Host {
  id: string;
  name: string;
  ip: string;
  mac: string | null;
  ssh_username: string | null;
  ssh_port: number;
  os_type: OSType;
  role: string | null;
  tags: string[];
  status: HostStatus | null;
}

export interface ServerInfo {
  port: number;
  debug: boolean;
  poll_seconds: number;
}
