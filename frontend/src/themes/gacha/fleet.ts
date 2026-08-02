// The gacha Fleet's pure DERIVATIONS (D52 / GACHA_PLAN §6.1–§6.4) — the card geometry rule, the rate pill's
// and the counter's loading semantics, and the templated promo/plate copy. Pure and React-free for the same
// reason `roster.ts` and `stars.ts` are: the §7 acceptance-matrix rows they own (0 / 1 / many hosts, a fleet
// that has not resolved yet, a host with no role) are then ordinary unit tests rather than render assertions.

import type { Host } from "../../types";
import { GACHA_COPY, SCENE_TITLES } from "./copy";

/** A capsule card's shape in the track. The prototype's three: `pair` is the default 3/4 portrait (two per
 *  row), `feat` and `wide` both span the full width at their own aspect ratios. */
export type CapsuleShape = "feat" | "pair" | "wide";

/** The card-geometry rule (Q8.10, ruled by the main seat; eyeball-tunable at the G1 gate).
 *
 *  host[0] is the FEATURED card, the rest fall into 3/4 pairs, and a trailing ODD host takes the wide slot
 *  rather than sitting alone in a half-width column with a hole beside it. At four hosts that reproduces the
 *  prototype exactly — feat, a pair, then wide (index.html:10-13) — which is what makes this a port rather
 *  than an invention; at every other count it is the same rule, so the track never has a ragged row.
 *
 *  A pure function of the COUNT alone: it must not depend on which hosts are online, or the layout would
 *  re-shuffle on a poll. */
export function cardShapes(hostCount: number): CapsuleShape[] {
  if (!Number.isFinite(hostCount) || hostCount <= 0) return [];
  const n = Math.floor(hostCount);
  const trailingOdd = (n - 1) % 2 === 1; // the hosts AFTER the featured one don't pair up evenly
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? "feat" : i === n - 1 && trailingOdd ? "wide" : "pair",
  );
}

/** Has the fleet query produced an answer yet? The §6.3 rule the pill and the counter share: while the first
 *  poll is in flight, "0 online" is a LIE, not a state — so it renders held until something real arrives.
 *  Cached data from a previous success counts as resolved even while a background refetch is erroring
 *  (TanStack keeps the data; the surface must not collapse — Codex R4-4). A hard failure with no data ever is
 *  unresolved, which is also the hero-only case.
 *
 *  `hasData` is the QUERY's own fact (`useFleet.hasData`), not a host count: a fleet that legitimately
 *  answered with zero machines and then hit a background refetch error has answered, and counting hosts
 *  would call that unresolved and blank a pill that was reading a true 0.0% a second earlier. */
export function hostsResolved(isLoading: boolean, error: unknown, hasData: boolean): boolean {
  return hasData || (!isLoading && !error);
}

/** What an unresolved number reads as. An ASCII hyphen rather than the kit's usual em dash, and that is a
 *  FENCE consequence, not a style choice: gacha's TypeScript may contain no non-ASCII outside `copy.ts`
 *  (`gachaChrome.test.ts`), and an em dash cannot join `copy.ts` without growing the frozen font subset —
 *  which means regenerating all twelve committed woff2 files for one dash. */
const PENDING = "-";

/** The rate pill (§6.3): the star mode's ceiling + the live count of ONLINE hosts as a gacha drop rate.
 *  The prototype's own format, `★3 RATE 3.0%` (index.html:7), with the mode and the count made live. */
export function rateText(maxStars: number, onlineCount: number, resolved: boolean): string {
  return `${GACHA_COPY.star}${maxStars} RATE ${resolved ? onlineCount.toFixed(1) : PENDING}%`;
}

/** The track counter — the prototype's zero-padded `04 / 04` (online / total), and a held pair until the
 *  fleet resolves. Zero-padding is the prototype's look and stops the head jittering between 9 and 10
 *  hosts; past 99 the natural width takes over. */
export function counterText(onlineCount: number, total: number, resolved: boolean): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return resolved ? `${pad(onlineCount)} / ${pad(total)}` : `${PENDING} / ${PENDING}`;
}

/** A capsule card's plate subtitle — the prototype's `ROLE · 18 ms`, and `ROLE · 待機中` when the machine is
 *  asleep (index.html:10-13; 待機中 = "standing by", the one frozen JP string on a card). Role falls back to
 *  the OS when a machine declares none, which is the same pair the Kit's own device row uses. A missing ping
 *  on an online host drops the segment rather than printing an em dash: the plate is a nameplate, not a
 *  metrics row. */
export function plateSub(host: Host): string {
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms;
  const role = (host.role ?? host.os_type).toUpperCase();
  const state = online ? (ping == null ? null : `${ping} ms`) : GACHA_COPY.cardSleeping;
  return state === null ? role : `${role} ${GACHA_COPY.sep} ${state}`;
}

/** The accessible name for the two surfaces that OPEN a machine — a capsule card and its promo slide. One
 *  function because they are one action (the shared `openHost` seam), and their names must not drift apart.
 *
 *  It carries the liveness because an `aria-label` REPLACES an element's content: the card's ONLINE /
 *  SLEEPING chip is real text inside the button, and labelling the button "open X dossier" alone would
 *  silently drop it from the accessible name. The frontier fleet's own `name — online/asleep` labels are the
 *  in-repo precedent for spelling the state out. */
export function openLabel(name: string, online: boolean): string {
  return `open ${name} dossier, ${online ? "online" : "sleeping"}`;
}

/** A banner SCENE slide's display line: its name from the ruled `SCENE_TITLES` pool, picked by POSITION
 *  and never by filename. Cycling means a folder of any size is titled deterministically — the ninth drop
 *  wraps to the pool's head rather than falling back to a number — and the owner authors nothing per
 *  image. A nonsense position resolves to the first title rather than throwing on a render path. */
export function sceneTitle(position: number): string {
  const n = SCENE_TITLES.length;
  const i = Number.isFinite(position) ? ((Math.trunc(position) % n) + n) % n : 0;
  return SCENE_TITLES[i];
}

/** A promo slide's templated copy (§6.4 / the R8 amendment): the tag pill and the JP caption are per-STATE
 *  templates, and the display line is the host's own name. The exact strings are frozen in `copy.ts` — the
 *  owner's pick at the G1 eyeball is a value edit there, not a change here. */
export function promoCopy(online: boolean): { tag: string; caption: string } {
  return online
    ? { tag: GACHA_COPY.promoTagOnline, caption: GACHA_COPY.promoCaptionOnline }
    : { tag: GACHA_COPY.promoTagSleeping, caption: GACHA_COPY.promoCaptionSleeping };
}
