// API surface the UI depends on. The mock implementation lives in mock.ts.
// Swapping to the real FastAPI backend means writing one HTTP-backed object
// with this same shape and changing the import in queries.ts.

import type {
  ActionType,
  ActivityEvent,
  ChatMessage,
  Host,
  Service,
} from "../types";

export interface CtrlbApi {
  listHosts(): Promise<Host[]>;
  listServices(): Promise<Service[]>;
  listEvents(): Promise<ActivityEvent[]>;

  // Typed actions — never raw shell. Returns the resulting event.
  runHostAction(hostId: string, action: ActionType): Promise<ActivityEvent>;
  runServiceAction(serviceId: string, action: ActionType): Promise<ActivityEvent>;

  sendChat(content: string): Promise<ChatMessage>;
}
