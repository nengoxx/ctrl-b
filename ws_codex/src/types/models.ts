export type HostStatus = "online" | "sleeping" | "offline" | "starting" | "stopping";
export type ServiceStatus = "running" | "stopped" | "degraded" | "starting";
export type OsType = "windows" | "linux";
export type MobileTab = "hosts" | "services" | "agent" | "log";

export interface Host {
  id: string;
  name: string;
  os: OsType;
  status: HostStatus;
  lanAddress: string;
  tailnetName: string;
  lastSeen: string;
  uptime: string;
  load: number;
  tags: string[];
}

export interface Service {
  id: string;
  hostId: string;
  name: string;
  project: string;
  kind: string;
  status: ServiceStatus;
  port: number;
  url: string;
  description: string;
  cpu: number;
  memory: number;
  updatedAt: string;
}

export interface ActionEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  level: "info" | "success" | "warning" | "danger";
}

export interface ChatMessage {
  id: string;
  speaker: "user" | "agent";
  text: string;
  time: string;
}
