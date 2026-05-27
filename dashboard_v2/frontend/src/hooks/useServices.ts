import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";
import type { Service } from "../types";

// Services + derived liveness, polled at the same cadence as the fleet (DESIGN.md §13). The list
// is small and shared across rows; FleetTab groups it by host_id and hands each DeviceRow its own.

export function useServices(pollSeconds: number) {
  return useQuery({
    queryKey: ["services"],
    queryFn: () => getJSON<Service[]>("/api/services"),
    refetchInterval: Math.max(1, pollSeconds) * 1000,
  });
}
