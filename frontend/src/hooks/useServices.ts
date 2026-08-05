import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";
import type { Service } from "../types";

// Services + derived liveness, polled at the same cadence as the fleet (DESIGN.md §13). The list
// is small and shared across rows; FleetTab groups it by host_id and hands each DeviceRow its own.

/** Both parameters are per-OBSERVER (the `useMediaIndex` convention), because the fleet is not the only
 *  consumer since D53 M3: the media gallery reads the same list to derive its service-icon KEYS.
 *
 *  `pollSeconds: false` = read it, do not drive a poll — the right answer for a consumer that wants the
 *  identities rather than the liveness, since the cadence of a SHARED query should be set by whoever
 *  actually needs it to move. `enabled: false` goes further and adds no fetcher at all, which is what
 *  lets that consumer call the hook unconditionally (rules of hooks) and pay only where it applies. */
export function useServices(pollSeconds: number | false, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["services"],
    queryFn: () => getJSON<Service[]>("/api/services"),
    refetchInterval: pollSeconds === false ? false : Math.max(1, pollSeconds) * 1000,
    ...opts,
  });
}
