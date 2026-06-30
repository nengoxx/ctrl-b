// The contract the UI depends on. The mock implementation lives in mock.ts.
// Going live = writing one HTTP-backed object with this exact shape (calling
// the FastAPI routes in ws_codex_2/docs/SPEC.md) and changing the import in
// queries.ts. Nothing in the views imports the mock directly.

import type {
  ActionType,
  ActivityEvent,
  ChatMessage,
  Host,
  Project,
  Service,
} from "../types";

export interface AgentReply {
  message: ChatMessage;
  // Events the agent's tool calls produced, so the UI can refresh affected data.
  events: ActivityEvent[];
}

export interface CtrlbApi {
  listProjects(): Promise<Project[]>;
  listHosts(): Promise<Host[]>;
  listServices(): Promise<Service[]>;
  listEvents(): Promise<ActivityEvent[]>;

  // Typed actions only — never raw shell. Each returns the resulting event.
  runHostAction(hostId: string, action: ActionType): Promise<ActivityEvent>;
  runServiceAction(serviceId: string, action: ActionType): Promise<ActivityEvent>;

  // Maps to POST /api/agent/chat. The backend gives the model the typed action
  // registry + SearXNG MCP as tools and streams a reply; here it's mocked.
  sendChat(content: string): Promise<AgentReply>;
}
