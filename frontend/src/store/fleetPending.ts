// Pending power transitions (2026-08-30, owner-ruled; sol-reviewed BUILD WITH CHANGES) — the per-host
// "a power action was dispatched and the polls have not caught up yet" state, app-wide.
//
// WHY THIS EXISTS. Wake-on-LAN is an unacknowledgeable UDP broadcast and a woken machine boots for
// 30–60s; an SSH shutdown is ACCEPTED in ~1–3s while the machine stays pingable for tens of seconds
// more. Both actions therefore have a window in which the freshest poll actively CONTRADICTS what the
// user just did — and the app used to let that stale truth win instantly (the WAKING chip died with
// the HTTP round-trip; a shutdown's optimistic offline was overwritten by the settle-time refetch and
// bounced back online). The field-settled cure is Home Assistant's assumed-state grace period
// (home-assistant/core#86735): HOLD the assumed state until the polls AGREE or a bounded window
// expires. "Pending" here is exactly that grace record.
//
// STORE-BACKED, not hook state, for the store/fleet.ts reason verbatim: SIX components call
// `useFleet()` independently (every theme's fleet body + gacha's dossier/track), so hook-local state
// fragments per instance — and a minutes-long window must survive a theme switch. Module timers, one
// per host, expire the assumption; poll agreement (reconcilePending, called from useFleet's data
// effect) clears it early.
//
// OWNERSHIP TOKENS (sol MED-2): overlapping dispatches from two hook instances can interleave — a
// STALE failure handler must not clear a NEWER action's entry. `beginPending` returns a token;
// `clearPending` with a token only clears the entry it began (the GachaFleet `gen` / viewTransition
// `stampOwner` idiom). The expiry timer carries its own token for the same reason: a replaced entry's
// old timer must never kill its successor.
//
// Reboot is deliberately NOT a kind yet — it is this model's third direction (down, then up) and the
// `kind` union extends to it later without reshaping anything (the extend-not-migrate rule).

import type { Host } from "../types";
import { createStore } from "./createStore";

export type PendingKind = "wake" | "shutdown";

export interface PendingEntry {
  kind: PendingKind;
  token: number;
}

// The grace ceilings, per direction (HA #86735: "configurable separately for power-on and power-off").
// Agreement clears earlier in the normal case — these bound the FAILURE path (a packet lost, a machine
// that never comes up/down), so the assumed state cannot lie forever. Sized by the review's own math:
// wake = 2.76× the worst stated boot+poll bound (owner-ruled "a couple/three minutes"); shutdown =
// 1.88× worst accept+shutdown+poll. Constants until the owner asks for a knob.
export const WAKE_WINDOW_MS = 180_000;
export const SHUTDOWN_WINDOW_MS = 90_000;

const { emit, useStore } = createStore();

let pending: ReadonlyMap<string, PendingEntry> = new Map();
let seq = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function disarm(id: string): void {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
}

/** Record a dispatched power action. Last action wins: a newer dispatch replaces the entry (and its
 *  timer) outright. Returns the ownership token the dispatcher's failure path must pass back. */
export function beginPending(id: string, kind: PendingKind): number {
  const token = ++seq;
  const next = new Map(pending);
  next.set(id, { kind, token });
  pending = next;
  disarm(id);
  timers.set(
    id,
    setTimeout(
      () => clearPending(id, token),
      kind === "wake" ? WAKE_WINDOW_MS : SHUTDOWN_WINDOW_MS,
    ),
  );
  emit();
  return token;
}

/** Drop a host's pending entry. With a token, only the entry that token began is cleared (a stale
 *  owner's clear no-ops); without one, unconditional — that form is for reconciliation, which acts on
 *  observed truth rather than on a dispatch it owns. No-op safe. */
export function clearPending(id: string, token?: number): void {
  const entry = pending.get(id);
  if (!entry) return;
  if (token !== undefined && entry.token !== token) return;
  const next = new Map(pending);
  next.delete(id);
  pending = next;
  disarm(id);
  emit();
}

/** Poll agreement + liveness pruning, called with every hosts answer: a pending wake is DONE when the
 *  host is observed online, a pending shutdown when it is observed offline, and any entry whose host
 *  left the config dies with it. Idempotent — six useFleet instances all call this and only a real
 *  deletion emits. */
export function reconcilePending(hosts: readonly Host[]): void {
  if (pending.size === 0) return;
  const byId = new Map(hosts.map((h) => [h.id, !!h.status?.online]));
  let next: Map<string, PendingEntry> | null = null;
  for (const [id, entry] of pending) {
    const online = byId.get(id);
    const agreed = online === undefined || (entry.kind === "wake" ? online : !online);
    if (agreed) {
      next ??= new Map(pending);
      next.delete(id);
      disarm(id);
    }
  }
  if (next) {
    pending = next;
    emit();
  }
}

/** Present hosts THROUGH the pending assumptions (the HA assumed-state rule): a pending-shutdown host
 *  is offline no matter what the poll says. A pending wake changes nothing here — its host IS offline,
 *  and presentation (chips) ranks observed-online above a stale WAKING. Pure; returns the input array
 *  untouched when nothing overlays, so memoized consumers keep referential stability. */
export function overlayPending(
  hosts: Host[],
  map: ReadonlyMap<string, PendingEntry> = pending,
): Host[] {
  if (map.size === 0) return hosts;
  let changed = false;
  const out = hosts.map((h) => {
    if (map.get(h.id)?.kind !== "shutdown" || !h.status?.online) return h;
    changed = true;
    return { ...h, status: { ...h.status, online: false } };
  });
  return changed ? out : hosts;
}

/** Reactive read — the stable map reference (replaced only on real writes, per the createStore
 *  snapshot contract). */
export function usePendingFleet(): ReadonlyMap<string, PendingEntry> {
  return useStore(() => pending);
}

/** Non-reactive snapshot, for engines outside the render path (the carousel cycle). */
export function pendingSnapshot(): ReadonlyMap<string, PendingEntry> {
  return pending;
}
