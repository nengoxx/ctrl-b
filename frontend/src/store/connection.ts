// Live state of the activity-stream SSE connection (driven by hooks/useEvents.ts).
// Same dependency-free external-store shape as store/confirm.ts and store/toast.ts.
//
// Drives the small "reconnecting…" / "offline" badge in AppBar so the owner can see
// when the live feed has dropped without checking devtools. Today there's only one
// consumer (the SSE event stream); if a future stream (e.g. agent chat) wants the same
// surfacing it can either add a second field here or compose into a single aggregate —
// kept tiny on purpose, easy to widen when needed.

import { createStore } from "./createStore";

export type ConnectionState = "connected" | "reconnecting" | "disconnected";

const { emit, useStore } = createStore();
let state: ConnectionState = "connected";

export function setConnection(s: ConnectionState): void {
  if (state === s) return;
  state = s;
  emit();
}

/** Read the current SSE connection state. Subscribe-flavored. */
export function useConnection(): ConnectionState {
  return useStore(() => state);
}
