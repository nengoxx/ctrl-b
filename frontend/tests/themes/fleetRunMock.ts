import { vi } from "vitest";

import type { FleetAction } from "../../src/hooks/useActions";
import { beginPending, clearPending } from "../../src/store/fleetPending";
import type { Host } from "../../src/types";

// The gacha fleet fixtures' stand-in for `useFleet().run` (2026-08-30). Since the pending-transition
// store landed, a WAKING chip and the cover's develop theatre are licensed by a RECORD in
// `store/fleetPending`, not by a promise being unsettled — so a fixture whose `run` is a bare
// `vi.fn()` would render a fleet where a wake never happened. This mirrors `useFleetActions.run`'s
// dispatch contract exactly, and only that: the record begins SYNCHRONOUSLY at dispatch, survives the
// settle, and is handed back — token-guarded — only when the request fails or throws. Everything else
// `run` really does (the confirm gate, the toasts, the request-busy set, the query invalidation) is
// out of these files' frame and stays out.
//
// One helper rather than six copies: every gacha fleet suite mocks `useFleet` to a static view, and
// the dispatch contract is one fact — a per-file copy would let them drift apart the next time the
// store's rules move.

/** How the mocked request BEHAVES once dispatched — `true` = the action reported ok. Overridden by the
 *  cases that need a request still in the air (a promise the test resolves itself), one that fails
 *  (`false`) or one that throws. */
export type RunOutcome = (action: FleetAction, host: Host) => Promise<boolean>;

const OK: RunOutcome = () => Promise.resolve(true);

/** A `run` that drives the real pending store exactly as production's does. */
export function dispatchingRun(outcome: RunOutcome = OK) {
  return vi.fn(async (action: FleetAction, host: Host): Promise<boolean> => {
    const token = action === "wake" || action === "shutdown" ? beginPending(host.id, action) : null;
    try {
      const ok = await outcome(action, host);
      if (!ok && token !== null) clearPending(host.id, token);
      return ok;
    } catch {
      if (token !== null) clearPending(host.id, token);
      return false;
    }
  });
}
