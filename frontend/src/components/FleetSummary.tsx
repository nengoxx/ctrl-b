import { memo, useMemo } from "react";

import type { Host } from "../types";

// Fleet summary strip — awake count, average ping over online hosts, poll cycle.
//
// Memoized (Slice 2): `hosts` reference changes every poll (because `checked_at` ticks), so the
// memo doesn't help *across polls*. It DOES bail correctly across the much more frequent
// non-poll renders of FleetTab — featured-cycle ticks, UI toggles, child opens. The filter+reduce
// is also wrapped in `useMemo` (already shipped in Slice 1) so polls only recompute the
// derivation, not the rest of the subtree.

interface Props {
  hosts: Host[];
  pollSeconds: number;
}

function FleetSummaryImpl({ hosts, pollSeconds }: Props) {
  // Memoize the awake count + avg ping derivation so a re-render of FleetTab that didn't
  // change `hosts` (e.g. featured cycle, UI toggle) doesn't re-filter/reduce the array.
  // TanStack's structural sharing keeps `hosts` stable across non-poll renders.
  const { awakeCount, avg } = useMemo(() => {
    const awake = hosts.filter((h) => h.status?.online);
    const pings = awake.map((h) => h.status?.ping_ms).filter((p): p is number => p != null);
    const a = pings.length ? pings.reduce((x, y) => x + y, 0) / pings.length : 0;
    return { awakeCount: awake.length, avg: a };
  }, [hosts]);

  return (
    <div className="summary">
      <div className="s">
        <div className="v">
          {awakeCount}
          <small>/{hosts.length}</small>
        </div>
        <div className="l">awake</div>
      </div>
      <div className="s cyan">
        <div className="v">
          {avg.toFixed(1)}
          <small>ms</small>
        </div>
        <div className="l">avg ping</div>
      </div>
      <div className="s violet">
        <div className="v">
          {pollSeconds}
          <small>s</small>
        </div>
        <div className="l">poll cycle</div>
      </div>
    </div>
  );
}

export const FleetSummary = memo(FleetSummaryImpl);
