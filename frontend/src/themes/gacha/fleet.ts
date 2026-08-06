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

/** The `NEW` ribbon's host — a DEMO (G6 item iv, owner-ruled: no semantics, no data seam; the owner
 *  decides keep/drop/meaning at the device round). The prototype hangs a third `state` value on one
 *  fixture card and no live field feeds it, so exactly one machine in the track wears the ribbon and the
 *  choice is arbitrary.
 *
 *  The RULE it has to obey is the interesting part: the pick is made ONCE and STICKS until that host
 *  leaves the fleet — never re-rolled on a poll re-render, or the ribbon would hop from card to card
 *  every few seconds. So this is a pure REDUCER over (the current host ids, the current pick): it keeps a
 *  live pick, re-rolls only when there is none or the picked machine is gone, and an empty fleet resolves
 *  to `null` (no ribbon). `rand` is injected so the rule is testable without stubbing Math.random. */
export function pickRibbonHost(
  hostIds: readonly string[],
  current: string | null,
  rand: () => number = Math.random,
): string | null {
  if (hostIds.length === 0) return null;
  if (current !== null && hostIds.includes(current)) return current;
  // clamp: a `rand` that returns exactly 1 (or anything out of range) must not index past the end
  const i = Math.min(hostIds.length - 1, Math.max(0, Math.floor(rand() * hostIds.length)));
  return hostIds[i];
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

/** What the G1 chrome reads while the fleet is still loading — the rate pill and the counter (§6.3), both
 *  owner-eyeballed with this ASCII hyphen. The DOSSIER's held metrics are different: §4.8 rules a literal
 *  em dash there, which lives in `copy.ts` (`metricPending`) because gacha TS outside copy.ts is
 *  ASCII-fenced. (The original claim that an em dash would force a font regen was wrong — the latin faces
 *  carry U+2014 in their `U+2000-206F` range; the JP subsets gained it at the same regen that recorded
 *  this.) */
export const PENDING = "-";

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
  const state = online ? (ping == null ? null : pingText(ping)) : GACHA_COPY.cardSleeping;
  return state === null ? roleLabel(host) : `${roleLabel(host)} ${GACHA_COPY.sep} ${state}`;
}

/** A ping, as the arcade prints it — the ONE formatter behind the capsule plate and the dossier's Ping
 *  tile, so a machine never reads two different latencies on two surfaces.
 *
 *  The prototype's fixture pings are tidy integers ("18 ms"); a real backend is not. The machine ctrl-b
 *  runs on answers its own ping in FRACTIONS of a millisecond, and `${0.025} ms` is both ugly and
 *  meaningless at plate size — so anything under a millisecond reads as the honest bound instead, and
 *  everything else rounds to whole milliseconds (the resolution a ping poll actually carries). */
export function pingText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return PENDING;
  return ms < 1 ? "<1 ms" : `${Math.round(ms)} ms`;
}

/** The unit DOSSIER's subtitle (G2) — the prototype's `Workstation · ONLINE` line under the machine name
 *  (index.html:28, `${role} · ${status}`). Same role fallback as a capsule plate, and the state spelled in
 *  the same two words the card's chip uses, so the two surfaces describe a machine identically. */
export function dossierSub(host: Host, online: boolean): string {
  return `${roleLabel(host)} ${GACHA_COPY.sep} ${online ? "ONLINE" : "SLEEPING"}`;
}

/** A machine's role in the arcade's voice: its configured role, falling back to the OS when it declares
 *  none — the same pair the Kit's own device row uses. Upper-case because every gacha caption is. */
function roleLabel(host: Host): string {
  return (host.role ?? host.os_type).toUpperCase();
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

/** The dossier's dismiss label. ONE string, two controls: the kit sheet's own sr-only close button and the
 *  theme's visible corner (the prototype's `.close-detail`, owner-restored 2026-08-02). They do the same
 *  thing to the same sheet, so they say the same thing — a second wording would read as a second action. */
export const CLOSE_DOSSIER_LABEL = "Close unit dossier";

/** The dossier PORTRAIT's own name, once it becomes a real button (the art showcase, owner request
 *  2026-08-02). An ACTION, phrased like one — the sibling of `openLabel` above, and deliberately not the
 *  same string as the surface it opens (`artViewLabel`): a control says what it does, a dialog says what
 *  it is. It carries the machine's name for the same reason the capsule's does — a screen reader hearing
 *  "show art full screen" alone could not tell WHICH unit's dossier it is in. */
export function showArtLabel(name: string): string {
  return `show ${name} art full screen`;
}

/** The full-screen art view's own accessible name (the `role="dialog"` label). */
export function artViewLabel(name: string): string {
  return `${name} art, full screen`;
}

/** The art view's dismiss label. Its own wording rather than `CLOSE_DOSSIER_LABEL`: this closes the ART,
 *  and the dossier it stands on stays open behind it — one name per thing dismissed. */
export const CLOSE_ART_LABEL = "Close art view";

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
