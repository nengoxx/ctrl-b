import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Subscribe to the live activity feed (SSE). Any recorded Event — a UI action now, an agent or
// automation action later — refreshes the fleet so all open clients converge. The browser's
// EventSource auto-reconnects on drop; the canonical history is always GET /api/events.

export function useEventStream(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    const onEvent = () => {
      qc.invalidateQueries({ queryKey: ["hosts"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    };
    es.addEventListener("event", onEvent);
    return () => {
      es.removeEventListener("event", onEvent);
      es.close();
    };
  }, [qc]);
}
