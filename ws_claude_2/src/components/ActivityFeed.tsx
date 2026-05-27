import { useEvents } from "../api/queries";
import { LevelIcon } from "./primitives";
import { relTime, clockTime } from "../lib/format";

// Shared activity feed. Lives under Services and on the Overview rather than in a
// tab of its own. `limit` trims it for compact placements.
export function ActivityFeed({ limit, compact }: { limit?: number; compact?: boolean }) {
  const { data: events, isLoading } = useEvents();
  if (isLoading) return <div className="empty">Loading activity…</div>;
  const list = (events ?? []).slice(0, limit ?? 999);

  return (
    <div className="feed">
      {list.map((e) => (
        <div className="feed-row" key={e.id}>
          <span className={`fi ${e.level}`}><LevelIcon level={e.level} size={compact ? 14 : 15} /></span>
          <div className="fmsg" style={compact ? { fontSize: 12.5 } : undefined}>
            <div>{e.message}</div>
            {!compact && (
              <div className="fmeta">
                <span className="src-chip">{e.source}</span>
                {e.target && <span className="mono">{e.target}</span>}
              </div>
            )}
          </div>
          <span className="ftime" title={clockTime(e.ts)}>{relTime(e.ts)}</span>
        </div>
      ))}
      {list.length === 0 && <div className="empty">No activity yet.</div>}
    </div>
  );
}
