// The host-detail DERIVATION shared by every theme's detail sheet (council M6, GACHA_PLAN §4.8) — the
// pure values a sheet reads off a host + its live services, with no markup and no opinion about wording.
//
// WHY IT EXISTS: cosmos's C3b sheet and frontier's F3 sheet derived the same handful of facts in
// byte-similar lines (online, ping, the up-count, the `up/total` ratio, the last-seen fallback), and
// gacha's G2 dossier would have been the third copy — the rule of three. Extracting the VALUES keeps the
// D31 band intact: markup stays per-theme (each presentation owns its JSX), only the arithmetic is shared.
//
// WHAT IS DELIBERATELY *NOT* HERE — the two themes' PROSE. Frontier's meta line ("wake-on-LAN ready",
// "powered down") and its services heading ("no services parked", "Powered down · WOL armed") are written
// in frontier's badlands voice and have no cosmos counterpart, so they are not a shared derivation; they
// compose in FrontierHostDetail from the facts below. Same reason a theme's own placeholder for an
// unresolved value is its own: cosmos shows the deferred-uptime dash where frontier shows "now" (see
// `seen` vs `lastSeen`), and unifying that would silently change one of them.

import { relativeTime } from "./relativeTime";
import type { Host, Service } from "../types";

export interface HostDetailFacts {
  /** Is the machine up? (`host.status` absent counts as offline — a host that has never been polled.) */
  online: boolean;
  /** Round-trip ms from the last poll, or null (offline, or an online host with no measurement). */
  ping: number | null;
  /** How many of the passed services are up right now. */
  upCount: number;
  /** How many services were passed (their LIVE list — not the host's configured `services` array). */
  total: number;
  /** `"2/3"` — the up/total ratio, or null when the host has no services at all (each theme renders its
   *  own placeholder for that: frontier a dash, cosmos nothing). */
  ratio: string | null;
  /** The "last contact" value a sheet shows: `"now"` while the machine is up, else the relative time of
   *  its last sighting. Frontier's Seen tile reads exactly this. */
  seen: string;
  /** The relative last-seen ALONE, without the online special case — for a sheet whose online branch
   *  shows something else (cosmos puts the deferred-uptime placeholder there). */
  lastSeen: string;
}

/** Derive a detail sheet's shared values from a host and its live services. Pure: same inputs, same
 *  output, no clock reads beyond `relativeTime`'s own (which is what makes "3h ago" relative). */
export function hostDetailFacts(host: Host, services: Service[]): HostDetailFacts {
  const online = !!host.status?.online;
  const upCount = services.filter((s) => s.status?.online).length;
  const total = services.length;
  const lastSeen = relativeTime(host.status?.last_seen);
  return {
    online,
    ping: host.status?.ping_ms ?? null,
    upCount,
    total,
    ratio: total > 0 ? `${upCount}/${total}` : null,
    seen: online ? "now" : lastSeen,
    lastSeen,
  };
}
